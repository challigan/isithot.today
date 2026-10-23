/**
 * Apple's push notification service (APNs), for the apps' snow notifications: the team key's
 * provider token and an HTTP/2 sender, with Node's built-ins only. The keys live in Netlify's
 * environment (Functions scope) and the `apns-smoke` GitHub environment, never in the repo, and
 * nothing here logs a key, a token or a device token.
 */
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { connect, type ClientHttp2Session } from 'node:http2';
import type { EnvGetter } from './config';

export type ApnsEnv = 'sandbox' | 'production';

/** Apple's two push services: development builds use the sandbox, TestFlight and the App Store production. */
export const APNS_ORIGINS: Record<ApnsEnv, string> = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
};

/** Each app's push topic is its bundle ID. */
export const APNS_TOPICS = { snow: 'today.willitsnow.app' } as const;

export interface ApnsKey {
  teamId: string;
  keyId: string;
  /** The key's PEM, rebuilt by `apnsKeyPem`. */
  pem: string;
}

const BEGIN = '-----BEGIN PRIVATE KEY-----';
const END = '-----END PRIVATE KEY-----';

/**
 * The key's PEM from its setting: the .p8 file's text however pasting left its line breaks (Carl
 * stores them from his iPhone), or the file in base64. The same rule as scripts/asc.mjs `keyPem`.
 */
export function apnsKeyPem(value: string): string {
  let text = value.trim();
  if (!text.includes(BEGIN)) text = Buffer.from(text, 'base64').toString('utf8');
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start < 0 || end < start) {
    throw new Error(`not a .p8 key: paste the file's text, from ${BEGIN} to ${END}`);
  }
  const body = text.slice(start + BEGIN.length, end).replace(/\s+/g, '');
  return `${BEGIN}\n${body.match(/.{1,64}/g)?.join('\n') ?? ''}\n${END}\n`;
}

const KEY_VARS: Record<ApnsEnv, { id: string; key: string }> = {
  sandbox: { id: 'APNS_KEY_ID_SANDBOX', key: 'APNS_KEY_SANDBOX' },
  production: { id: 'APNS_KEY_ID_PRODUCTION', key: 'APNS_KEY_PRODUCTION' },
};

/** One environment's key from the settings, or the names of the settings missing. */
export function apnsKey(env: EnvGetter, which: ApnsEnv): ApnsKey | { missing: string[] } {
  const names = ['APNS_TEAM_ID', KEY_VARS[which].id, KEY_VARS[which].key];
  const [teamId, keyId, key] = names.map((n) => env(n)?.trim() ?? '');
  const missing = names.filter((_, i) => ![teamId, keyId, key][i]);
  if (missing.length) return { missing };
  return { teamId: teamId!, keyId: keyId!, pem: apnsKeyPem(key!) };
}

/**
 * The provider token APNs takes in place of a certificate: an ES256 JWT naming the key and the
 * team. Apple accepts one for an hour and refuses new ones more often than every 20 minutes, so
 * the full job reuses each for up to 50 minutes.
 */
export function providerToken(key: ApnsKey, now: number): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${part({ alg: 'ES256', kid: key.keyId })}.${part({
    iss: key.teamId,
    iat: Math.floor(now / 1000),
  })}`;
  // JWTs want the raw r and s, not DER.
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: createPrivateKey(key.pem),
    dsaEncoding: 'ieee-p1363',
  });
  return `${unsigned}.${signature.toString('base64url')}`;
}

export interface ApnsPush {
  /** The device token, hex. */
  device: string;
  topic: string;
  payload: unknown;
  /** 5 sends when power allows (the evening), 10 at once (the morning). */
  priority: 5 | 10;
  /** When Apple stops trying, in Unix seconds; 0 means now or never. */
  expiration: number;
  collapseId?: string;
}

export interface ApnsResult {
  status: number;
  /** Apple's reason for a refusal ("BadDeviceToken", "Unregistered"…), or null. */
  reason: string | null;
  /** For 410: when the token stopped being valid, ms since the epoch. */
  timestamp: number | null;
}

export interface ApnsSender {
  send(jwt: string, push: ApnsPush): Promise<ApnsResult>;
  close(): void;
}

/**
 * An HTTP/2 session to APNs. `origin` is one of `APNS_ORIGINS`, or a test's fake. Each send
 * rejects on a network error or after `timeoutMs`.
 */
export function apnsSender(origin: string, timeoutMs = 10_000): ApnsSender {
  let session: ClientHttp2Session | null = null;
  const open = (): ClientHttp2Session => {
    if (session && !session.closed && !session.destroyed) return session;
    const s = connect(origin);
    // Failures surface on each request; this keeps one from crashing the process.
    s.on('error', () => {});
    session = s;
    return s;
  };
  return {
    send(jwt, push) {
      return new Promise((resolve, reject) => {
        const req = open().request({
          ':method': 'POST',
          ':path': `/3/device/${push.device}`,
          authorization: `bearer ${jwt}`,
          'apns-topic': push.topic,
          'apns-push-type': 'alert',
          'apns-priority': String(push.priority),
          'apns-expiration': String(push.expiration),
          'apns-id': randomUUID(),
          ...(push.collapseId ? { 'apns-collapse-id': push.collapseId } : {}),
        });
        let status = 0;
        let body = '';
        req.setTimeout(timeoutMs, () => {
          req.close();
          reject(new Error(`APNs did not answer within ${timeoutMs} ms`));
        });
        req.on('response', (headers) => {
          status = Number(headers[':status']);
        });
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
          body += chunk;
        });
        req.on('end', () => {
          let parsed: { reason?: unknown; timestamp?: unknown } = {};
          try {
            parsed = body ? (JSON.parse(body) as typeof parsed) : {};
          } catch {
            // Apple always answers JSON; anything else is reported by status alone.
          }
          resolve({
            status,
            reason: typeof parsed.reason === 'string' ? parsed.reason : null,
            timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : null,
          });
        });
        req.on('error', reject);
        req.end(JSON.stringify(push.payload));
      });
    },
    close() {
      session?.close();
      session = null;
    },
  };
}

/** A made-up device token: Apple refuses it, and nothing reaches a phone. */
export const SMOKE_DEVICE = '0'.repeat(64);

export interface SmokeResult {
  ok: boolean;
  /** One line for the log, without the key, its token or any device token. */
  line: string;
}

/**
 * One push to a made-up device with the sandbox key. Apple answering `400 BadDeviceToken` proves
 * the whole path: egress, TLS, HTTP/2, and that Apple took the key's token (a bad token is 403).
 */
export async function apnsSmoke(
  env: EnvGetter,
  { now, origin = APNS_ORIGINS.sandbox }: { now: number; origin?: string },
): Promise<SmokeResult> {
  let jwt: string;
  try {
    const key = apnsKey(env, 'sandbox');
    if ('missing' in key) return { ok: false, line: `missing ${key.missing.join(', ')}` };
    jwt = providerToken(key, now);
  } catch (err) {
    // The setting holds something other than a key; the message never quotes it.
    return { ok: false, line: `APNS_KEY_SANDBOX: ${(err as Error).message}` };
  }
  const sender = apnsSender(origin);
  try {
    const result = await sender.send(jwt, {
      device: SMOKE_DEVICE,
      topic: APNS_TOPICS.snow,
      payload: { aps: { alert: { title: 'Test', body: 'A test that never reaches a phone.' } } },
      priority: 5,
      expiration: 0,
    });
    return smokeVerdict(result);
  } catch (err) {
    return { ok: false, line: `no answer from APNs: ${(err as Error).message}` };
  } finally {
    sender.close();
  }
}

/** What Apple's answer to the made-up device says about the key and the path to Apple. */
export function smokeVerdict({ status, reason }: ApnsResult): SmokeResult {
  const answer = `${status}${reason ? ` ${reason}` : ''}`;
  if (status === 400 && reason === 'BadDeviceToken') {
    return {
      ok: true,
      line: `${answer}, as expected: Apple took the key's token and refused the made-up device`,
    };
  }
  const hint =
    status === 403
      ? `Apple refused the key's token: check that APNS_TEAM_ID and APNS_KEY_ID_SANDBOX belong to the sandbox key, and that ${APNS_TOPICS.snow} is registered under the team`
      : status === 400 && /Topic/.test(reason ?? '')
        ? `Apple refused the topic: register ${APNS_TOPICS.snow} under the team`
        : 'expected 400 BadDeviceToken';
  return { ok: false, line: `${answer}: Apple answered, so the path to it works, but ${hint}` };
}

export interface AlertsRunInput {
  env: EnvGetter;
  /** Netlify deploy context: "production", "deploy-preview", "branch-deploy" or "dev". */
  deployContext: string | undefined;
  now: number;
  /** Where the smoke push goes; tests point it at a fake. */
  origin?: string;
}

/**
 * The scheduled run, every 15 minutes, until the full job lands: one log line. On a deploy preview
 * with ALERTS_SMOKE=1 (never in production, whatever the setting) it also sends the smoke push,
 * so pressing "Run now" there shows whether a Netlify function can reach APNs.
 */
export async function alertsRun({
  env,
  deployContext,
  now,
  origin,
}: AlertsRunInput): Promise<string> {
  if (deployContext === 'production' || env('ALERTS_SMOKE')?.trim() !== '1') {
    return 'alerts-run: disabled';
  }
  const smoke = await apnsSmoke(env, { now, ...(origin ? { origin } : {}) });
  return `alerts-run: smoke ${smoke.ok ? 'passed' : 'failed'}: ${smoke.line}`;
}
