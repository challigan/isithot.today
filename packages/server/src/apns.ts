/**
 * Apple's push notification service (APNs), for the apps' snow notifications: the team key's
 * provider token and an HTTP/2 sender, with Node's built-ins only. The keys live in Netlify's
 * environment (Functions scope) and the `apns-smoke` GitHub environment, never in the repo, and
 * nothing here logs a key, a token or a device token.
 */
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { connect, type ClientHttp2Session } from 'node:http2';
import { localDateTime } from '@isithot/core';
import {
  forgetRegistration,
  idPrefix,
  jwtKey,
  redact,
  type AlertStore,
  type RegistrationStamp,
} from './alertStore';
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
  /** The `apns-id`, a UUID; a fresh one when absent. */
  id?: string;
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
  /** How many streams the open session allows at once (Apple's SETTINGS), when known. */
  maxConcurrentStreams?(): number | undefined;
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
          'apns-id': push.id ?? randomUUID(),
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
    maxConcurrentStreams() {
      return session && !session.destroyed
        ? session.remoteSettings.maxConcurrentStreams
        : undefined;
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
  // Says why, so a preview check that does not send shows what it saw.
  if (deployContext === 'production') return 'alerts-run: disabled (production)';
  const setting = env('ALERTS_SMOKE')?.trim();
  if (setting !== '1') {
    const where = deployContext ?? 'unknown context';
    return `alerts-run: disabled (${where}, ALERTS_SMOKE ${setting ? 'is not 1' : 'unset'})`;
  }
  const smoke = await apnsSmoke(env, { now, ...(origin ? { origin } : {}) });
  return `alerts-run: smoke ${smoke.ok ? 'passed' : 'failed'}: ${smoke.line}`;
}

// ---- The full job's push layer (iOS build spec, section 8.5) ----

/**
 * How long a provider token is reused, ms. Apple takes one for an hour and refuses a new one
 * sooner than 20 minutes after the last (429 TooManyProviderTokenUpdates); runs come every 15
 * minutes, so each environment's token is shared through the store.
 */
export const PROVIDER_TOKEN_REUSE_MS = 50 * 60 * 1000;

/** What `apns/v1/jwt/<env>` holds: the token, and when it was made in Unix seconds. */
export interface StoredProviderToken {
  jwt: string;
  iat: number;
}

/** One run's provider tokens, shared with other runs through the store. */
export interface ProviderTokens {
  /**
   * The token for an environment: the stored one while it is under 50 minutes old and made with
   * this key, otherwise a new one, which is stored. Asked twice, it reads the store once. Rejects
   * when there is no key for the environment, or the key cannot sign.
   */
  get(env: ApnsEnv): Promise<string>;
  /** Apple refused `jwt`: forget it, here and in the store, unless the store already holds another. */
  drop(env: ApnsEnv, jwt: string): Promise<void>;
}

const decodePart = (part: string | undefined): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(Buffer.from(part ?? '', 'base64url').toString('utf8'));
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Whether a stored token may be sent again: recent, and made with this key for this team. */
function reusable(stored: unknown, key: ApnsKey, now: number): stored is StoredProviderToken {
  if (!stored || typeof stored !== 'object') return false;
  const { jwt, iat } = stored as Partial<StoredProviderToken>;
  if (typeof jwt !== 'string' || typeof iat !== 'number') return false;
  const age = now - iat * 1000;
  // A minute's grace for another instance's clock running ahead.
  if (age < -60_000 || age >= PROVIDER_TOKEN_REUSE_MS) return false;
  const [header, claims] = jwt.split('.');
  const h = decodePart(header);
  const c = decodePart(claims);
  return h?.kid === key.keyId && c?.iss === key.teamId && c?.iat === iat;
}

export function providerTokens({
  store,
  keys,
  now,
}: {
  store: AlertStore;
  keys: Partial<Record<ApnsEnv, ApnsKey>>;
  now: number;
}): ProviderTokens {
  const held = new Map<ApnsEnv, Promise<string>>();
  const fetchOrMake = async (env: ApnsEnv): Promise<string> => {
    const key = keys[env];
    if (!key) throw new Error(`no ${env} key`);
    let stored: unknown = null;
    try {
      stored = await store.get<StoredProviderToken>(jwtKey(env));
    } catch {
      // Unknown, so make one (the store has logged why).
    }
    if (reusable(stored, key, now)) return stored.jwt;
    const jwt = providerToken(key, now);
    try {
      await store.set(jwtKey(env), { jwt, iat: Math.floor(now / 1000) });
    } catch {
      // This run uses it anyway; the next makes its own.
    }
    return jwt;
  };
  return {
    get(env) {
      let token = held.get(env);
      if (!token) {
        token = fetchOrMake(env);
        held.set(env, token);
        token.catch(() => held.delete(env));
      }
      return token;
    },
    async drop(env, jwt) {
      held.delete(env);
      let stored: StoredProviderToken | null | undefined;
      try {
        stored = await store.get<StoredProviderToken>(jwtKey(env));
      } catch {
        stored = undefined;
      }
      // Gone already, or another run has made a new one since: leave it.
      if (stored === null || (stored && stored.jwt !== jwt)) return;
      try {
        await store.delete(jwtKey(env));
      } catch {
        // The next 403 drops it again.
      }
    },
  };
}

/** The never-send hours at the place, end exclusive: `ALERTS.quiet` ({ from: 21, to: 7 }). */
export interface QuietHours {
  from: number;
  to: number;
}

const zones = new Map<string, boolean>();

function knownZone(tz: string): boolean {
  let known = zones.get(tz);
  if (known === undefined) {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: tz });
      known = true;
    } catch {
      known = false;
    }
    zones.set(tz, known);
  }
  return known;
}

/**
 * Whether it is quiet hours at the place (21:00 to 06:59 with `ALERTS.quiet`). The local time is
 * core's `localDateTime`; a zone Intl does not know counts as quiet, since its hour is unknown.
 */
export function inQuietHours(tz: string, now: number, quiet: QuietHours): boolean {
  if (!knownZone(tz)) return true;
  const { hours } = localDateTime(tz, new Date(now));
  return quiet.from > quiet.to
    ? hours >= quiet.from || hours < quiet.to
    : hours >= quiet.from && hours < quiet.to;
}

/** Apple's limit for a notification's payload, bytes. */
export const APNS_PAYLOAD_LIMIT = 4096;

export type AlertPushKind = 'evening' | 'morning';

/** A notification's payload (section 8.5): Apple's `aps`, then what a tap needs. */
export interface AlertPayload {
  aps: {
    alert: { title: string; body: string };
    sound: 'default';
    'thread-id': string;
    'interruption-level': 'active';
    'relevance-score': number;
  };
  topic: string;
  kind: AlertPushKind;
  /** The local date the notification is about. */
  date: string;
  view: 'today';
  /** The registration's canonical today query: a tap opens that place. */
  place: string;
  name: string;
}

/** What the push layer reads of a registration record (section 8.2). */
export interface PushRecord extends RegistrationStamp {
  env: ApnsEnv;
  token: string;
  query: string;
  name: string;
  appVersion?: string;
}

export interface AlertPushInput {
  /** The registration: its app names the topic header; its token, query and name go in the push. */
  record: Pick<PushRecord, 'app' | 'token' | 'query' | 'name'>;
  /** What core's `snowAlert` decided: the words, and the relevance (deep 1.0 … possible 0.3). */
  alert: { title: string; body: string; relevance: number };
  /** The weather topic, "snow": the payload's topic and thread. */
  topic: string;
  kind: AlertPushKind;
  /** The local date the notification is about, YYYY-MM-DD. */
  date: string;
  /** Core's `collapseId(topic, kind, date)`, "snow-evening-2026-12-02"; at most 64 bytes. */
  collapseId: string;
  /** When Apple stops trying, in Unix seconds: core's `expiresAt` (21:00 at the place for the evening, 11:00 for the morning). */
  expiration: number;
  /** `ALERTS.apnsPriority[kind]`: 5 for the evening, 10 for the morning. */
  priority: 5 | 10;
  /** The `apns-id`; a fresh UUID unless given. */
  id?: string;
}

export type AlertPush = ApnsPush & { id: string; payload: AlertPayload };

/**
 * One notification's push: the headers' values and the payload, exactly as section 8.5 has
 * them. Throws for an app with no topic, an expiration that is not whole Unix seconds, a collapse
 * id over 64 bytes, or a payload over Apple's 4,096 bytes, so nothing is claimed for a push that
 * cannot go.
 */
export function alertPush(input: AlertPushInput): AlertPush {
  const { record, alert } = input;
  const topic = Object.hasOwn(APNS_TOPICS, record.app)
    ? APNS_TOPICS[record.app as keyof typeof APNS_TOPICS]
    : undefined;
  if (!topic) throw new Error(`no APNs topic for the app "${record.app}"`);
  if (!Number.isInteger(input.expiration) || input.expiration < 0 || input.expiration > 1e10) {
    throw new Error('the expiration must be whole Unix seconds');
  }
  if (Buffer.byteLength(input.collapseId) > 64) throw new Error('the collapse id is over 64 bytes');
  const payload: AlertPayload = {
    aps: {
      alert: { title: alert.title, body: alert.body },
      sound: 'default',
      'thread-id': input.topic,
      'interruption-level': 'active',
      'relevance-score': alert.relevance,
    },
    topic: input.topic,
    kind: input.kind,
    date: input.date,
    view: 'today',
    place: record.query,
    name: record.name,
  };
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  if (bytes > APNS_PAYLOAD_LIMIT)
    throw new Error(`the payload is ${bytes} bytes, over Apple's limit`);
  return {
    device: record.token,
    topic,
    payload,
    priority: input.priority,
    expiration: input.expiration,
    collapseId: input.collapseId,
    id: input.id ?? randomUUID(),
  };
}

/**
 * What an answer from Apple means for the registration and its claim (section 8.5):
 * - "sent": 200, keep the claim;
 * - "forget": delete the registration (410 Unregistered or ExpiredToken, unless Apple's
 *   timestamp is older than the record's `updatedAt`; 400 BadDeviceToken or
 *   DeviceTokenNotForTopic);
 * - "keep": keep the registration and the claim (a 410 from before the app registered again, and
 *   any other 4xx, which is a bug to log rather than retry every 15 minutes);
 * - "retry": release the claim for the next run (429, 5xx);
 * - "reauth": a 403, Apple refusing the provider token: drop it, release the claim, never delete.
 */
export function classifyApns(
  result: ApnsResult,
  record: Pick<RegistrationStamp, 'updatedAt'>,
): 'sent' | 'forget' | 'keep' | 'retry' | 'reauth' {
  const { status, reason, timestamp } = result;
  if (status === 200) return 'sent';
  if (status === 410 && (reason === 'Unregistered' || reason === 'ExpiredToken')) {
    return timestamp !== null && timestamp < Date.parse(record.updatedAt) ? 'keep' : 'forget';
  }
  if (status === 400 && (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic')) {
    return 'forget';
  }
  if (status === 403) return 'reauth';
  if (status === 429 || status >= 500) return 'retry';
  return 'keep';
}

/** One notification to send: the registration as read, its claim key and its push. */
export interface Delivery {
  record: PushRecord;
  /** `sentKey(localDate, topic, kind, app, id)`, claimed with `onlyIfNew` just before the push. */
  claimKey: string;
  push: AlertPush;
}

/**
 * What became of a delivery.
 * - "sent": Apple took it; the claim stays.
 * - "deleted": Apple refused the device, and the registration is gone.
 * - "kept": Apple refused it, but the registration stays (it changed since it was read, the delete
 *   failed, or the refusal is not the device's fault); the claim stays.
 * - "released": Apple could not take it now (403, 429, 5xx, no answer); the claim was released for
 *   the next run.
 * - "held": as "released", but the release failed, so the claim stays: not retried today.
 * - "taken": another run holds the claim; nothing sent.
 * - "deferred": not tried in this run (the claim could not be written, there is no key or token
 *   for its environment, its environment stopped, or the deadline passed); nothing claimed.
 * - "quiet": quiet hours at the place; nothing claimed or sent.
 * - "logged": a dry run wrote it to the log instead.
 */
export type DeliveryOutcome =
  'sent' | 'deleted' | 'kept' | 'released' | 'held' | 'taken' | 'deferred' | 'quiet' | 'logged';

export const DELIVERY_OUTCOMES: readonly DeliveryOutcome[] = [
  'sent',
  'deleted',
  'kept',
  'released',
  'held',
  'taken',
  'deferred',
  'quiet',
  'logged',
];

/**
 * Whether nothing is left to do for the delivery today: false for "released" and "deferred",
 * which the next run tries again, so their zone is not marked done.
 */
export function deliveryFinished(outcome: DeliveryOutcome): boolean {
  return outcome !== 'released' && outcome !== 'deferred';
}

export interface DeliveryResult {
  delivery: Delivery;
  outcome: DeliveryOutcome;
  /** Apple's status, or null when there was no answer or no push. */
  status: number | null;
  reason: string | null;
}

export interface SendAlertsInput {
  store: AlertStore;
  deliveries: readonly Delivery[];
  /** Each environment's key (`apnsKey`); an environment without one is deferred. */
  keys: Partial<Record<ApnsEnv, ApnsKey>>;
  /** The run's one moment, ms: the claims' time, the provider token's and the quiet-hours check's. */
  now: number;
  /** `ALERTS.apnsConcurrency`: at most this many pushes at once per session. */
  apnsConcurrency: number;
  /** `ALERTS.quiet`. */
  quiet: QuietHours;
  /** One line per event worth a line; ids are cut to a prefix, and no token or place query is ever in one. */
  log: (line: string) => void;
  /** Opens one environment's session; `apnsSender(APNS_ORIGINS[env])` unless a test points elsewhere. */
  connect?: (env: ApnsEnv) => ApnsSender;
  /** The run's provider tokens, shared with a test send; made from `store` and `keys` when absent. */
  tokens?: ProviderTokens;
  /** Log each notification instead: no claim, no token, no push. */
  dryRun?: boolean;
  /** Start no push after this time by `clock` (ms); the rest are deferred. */
  deadline?: number;
  clock?: () => number;
}

export interface SendAlertsResult {
  /** One per delivery, in their order. */
  results: DeliveryResult[];
  counts: Record<DeliveryOutcome, number>;
}

/** A registration as a log names it: "snow.3f9c1a2b…". */
const who = ({ record }: Delivery): string => `${record.app}.${idPrefix(record.id)}`;

const answer = (status: number, reason: string | null): string =>
  `${status}${reason ? ` ${reason}` : ''}`;

/**
 * Sends the notifications: one HTTP/2 session per APNs environment, the first push alone (Apple
 * allows one stream until a push with a valid provider token), then up to
 * min(`apnsConcurrency`, the session's maximum concurrent streams) at once. Each push is claimed
 * just before it goes, and Apple's answer is acted on (`classifyApns`). Refuses any delivery in
 * quiet hours at its place. A 403, a token-update 429 or no answer at all stops that environment
 * for the run: what is left there is deferred, unclaimed.
 */
export async function sendAlerts(input: SendAlertsInput): Promise<SendAlertsResult> {
  const { store, deliveries, now } = input;
  const say = (line: string): void => input.log(redact(line));
  const clock = input.clock ?? Date.now;
  const tokens = input.tokens ?? providerTokens({ store, keys: input.keys, now });
  const connect = input.connect ?? ((env: ApnsEnv) => apnsSender(APNS_ORIGINS[env]));
  const results: DeliveryResult[] = new Array<DeliveryResult>(deliveries.length);
  const settle = (
    i: number,
    outcome: DeliveryOutcome,
    status: number | null = null,
    reason: string | null = null,
  ): void => {
    results[i] = { delivery: deliveries[i]!, outcome, status, reason };
  };

  const byEnv = new Map<ApnsEnv, number[]>();
  deliveries.forEach((d, i) => {
    const { push, record } = d;
    if (inQuietHours(record.tz, now, input.quiet)) {
      say(`alerts: error: refused ${who(d)}: quiet hours in ${record.tz}`);
      settle(i, 'quiet');
    } else if (input.dryRun) {
      const { kind, date, aps } = push.payload;
      say(
        `alerts: dry run: ${who(d)} ${record.env} ${kind} ${date}: ${aps.alert.title} / ${aps.alert.body}`,
      );
      settle(i, 'logged');
    } else {
      byEnv.set(record.env, [...(byEnv.get(record.env) ?? []), i]);
    }
  });

  const release = async (i: number): Promise<'released' | 'held'> => {
    try {
      await store.delete(deliveries[i]!.claimKey);
      return 'released';
    } catch {
      return 'held';
    }
  };

  const sendEnv = async (env: ApnsEnv, list: number[]): Promise<void> => {
    let jwt: string;
    try {
      jwt = await tokens.get(env);
    } catch (err) {
      say(
        `alerts: error: no ${env} provider token (${(err as Error).message}): ${list.length} deferred`,
      );
      for (const i of list) settle(i, 'deferred');
      return;
    }
    let sender: ApnsSender;
    try {
      sender = connect(env);
    } catch (err) {
      say(`alerts: error: no ${env} session (${(err as Error).message}): ${list.length} deferred`);
      for (const i of list) settle(i, 'deferred');
      return;
    }
    let stopped = false;
    const stop = (why: string): void => {
      if (!stopped) say(`alerts: error: stopped ${env} for this run: ${why}`);
      stopped = true;
    };

    /** Claims, sends and acts on the answer; true once Apple has taken the provider token. */
    const one = async (i: number): Promise<boolean> => {
      const d = deliveries[i]!;
      if (stopped || (input.deadline !== undefined && clock() >= input.deadline)) {
        settle(i, 'deferred');
        return false;
      }
      let claimed: boolean;
      try {
        claimed = await store.set(
          d.claimKey,
          { at: new Date(now).toISOString(), apnsId: d.push.id },
          { onlyIfNew: true },
        );
      } catch {
        // Not a claim (the store has logged why): send nothing; the next run tries again.
        settle(i, 'deferred');
        return false;
      }
      if (!claimed) {
        settle(i, 'taken');
        return false;
      }
      let result: ApnsResult;
      try {
        result = await sender.send(jwt, d.push);
      } catch (err) {
        stop(`no answer from APNs for ${who(d)}: ${(err as Error).message}`);
        settle(i, await release(i));
        return false;
      }
      const { status, reason } = result;
      const verdict = classifyApns(result, d.record);
      if (verdict === 'sent') {
        settle(i, 'sent', status, reason);
      } else if (verdict === 'forget') {
        const forgot = await forgetRegistration(store, d.record);
        const why = `${answer(status, reason)}, ${env}, app ${d.record.appVersion ?? 'unknown'}`;
        say(
          forgot === 'deleted'
            ? `alerts: deleted ${who(d)} (${why})`
            : forgot === 'changed'
              ? `alerts: kept ${who(d)} (${why}): it registered again since`
              : `alerts: error: could not delete ${who(d)} (${why})`,
        );
        settle(i, forgot === 'deleted' ? 'deleted' : 'kept', status, reason);
      } else if (verdict === 'keep') {
        say(
          status === 410
            ? `alerts: kept ${who(d)} (${answer(status, reason)}): it registered again since`
            : `alerts: error: APNs refused ${who(d)}: ${answer(status, reason)}; kept the claim`,
        );
        settle(i, 'kept', status, reason);
      } else if (verdict === 'reauth') {
        stop(`APNs refused the provider token (${answer(status, reason)})`);
        await tokens.drop(env, jwt);
        settle(i, await release(i), status, reason);
        return false;
      } else {
        const outcome = await release(i);
        const released =
          outcome === 'released' ? 'released the claim' : 'could not release the claim';
        say(`alerts: error: APNs ${answer(status, reason)} for ${who(d)}: ${released}`);
        settle(i, outcome, status, reason);
        // The token is too new for Apple: every push with it would fail the same way.
        if (reason === 'TooManyProviderTokenUpdates') {
          stop(`APNs ${answer(status, reason)}: the shared provider token is not being reused`);
        }
        // A 429 or 5xx says nothing of the token, so stay at one stream.
        return false;
      }
      return true;
    };

    try {
      let next = 0;
      let warm = false;
      while (next < list.length && !warm) warm = await one(list[next++]!);
      const width = Math.max(
        1,
        Math.min(input.apnsConcurrency, sender.maxConcurrentStreams?.() ?? input.apnsConcurrency),
      );
      await Promise.all(
        Array.from({ length: width }, async () => {
          while (next < list.length) await one(list[next++]!);
        }),
      );
    } finally {
      sender.close();
    }
  };

  await Promise.all([...byEnv].map(([env, list]) => sendEnv(env, list)));
  const counts = Object.fromEntries(DELIVERY_OUTCOMES.map((o) => [o, 0])) as Record<
    DeliveryOutcome,
    number
  >;
  for (const r of results) counts[r.outcome]++;
  return { results, counts };
}
