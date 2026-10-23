import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http2';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APNS_TOPICS,
  SMOKE_DEVICE,
  alertsRun,
  apnsKey,
  apnsKeyPem,
  apnsSender,
  apnsSmoke,
  providerToken,
  smokeVerdict,
} from '../src';
import { fakeApns, servers } from './fakeApns';

// A throwaway P-256 key, as Apple's .p8 files are.
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const PUBLIC = createPublicKey(privateKey);
const BODY = PEM.split('\n').slice(1, -2).join('');
const KEY = { teamId: 'TEAM123456', keyId: 'KEY1234567', pem: PEM };
const NOW = Date.UTC(2026, 9, 23, 9, 0, 0);
const ENV: Record<string, string> = {
  APNS_TEAM_ID: KEY.teamId,
  APNS_KEY_ID_SANDBOX: KEY.keyId,
  APNS_KEY_SANDBOX: PEM,
};
const env = (vars: Record<string, string>) => (name: string) => vars[name];

const parts = (jwt: string) => jwt.split('.');
const json = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
const signedBy = (jwt: string) => {
  const [header, claims, signature] = parts(jwt);
  return verify(
    'sha256',
    Buffer.from(`${header}.${claims}`),
    { key: PUBLIC, dsaEncoding: 'ieee-p1363' },
    Buffer.from(signature!, 'base64url'),
  );
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => resolve());
          // Close lingering sessions so close() can finish.
          (s as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
        }),
    ),
  );
});

/** Apple's answer to a push from the fake: the key's token checked, then the made-up device. */
const apple = (headers: IncomingHttpHeaders) => {
  const jwt = String(headers.authorization).replace(/^bearer /, '');
  if (!signedBy(jwt)) return { status: 403, body: { reason: 'InvalidProviderToken' } };
  return headers[':path'] === `/3/device/${SMOKE_DEVICE}`
    ? { status: 400, body: { reason: 'BadDeviceToken' } }
    : { status: 200 };
};

describe('apnsKeyPem', () => {
  it('takes the .p8 text however pasting left its line breaks, or its base64', () => {
    expect(apnsKeyPem(PEM)).toBe(PEM);
    expect(apnsKeyPem(PEM.replace(/\n/g, '\r\n'))).toBe(PEM);
    expect(apnsKeyPem(`-----BEGIN PRIVATE KEY----- ${BODY} -----END PRIVATE KEY-----`)).toBe(PEM);
    expect(apnsKeyPem(Buffer.from(PEM).toString('base64'))).toBe(PEM);
  });

  it('says what it wants for anything else', () => {
    expect(() => apnsKeyPem('not a key')).toThrow(/paste the file's text/);
  });
});

describe('apnsKey', () => {
  it("reads one environment's settings, trimmed", () => {
    const key = apnsKey(env({ ...ENV, APNS_TEAM_ID: ` ${KEY.teamId}\n` }), 'sandbox');
    expect(key).toEqual(KEY);
  });

  it('names the settings missing', () => {
    expect(apnsKey(env(ENV), 'production')).toEqual({
      missing: ['APNS_KEY_ID_PRODUCTION', 'APNS_KEY_PRODUCTION'],
    });
    expect(apnsKey(env({ APNS_KEY_SANDBOX: ' ' }), 'sandbox')).toEqual({
      missing: ['APNS_TEAM_ID', 'APNS_KEY_ID_SANDBOX', 'APNS_KEY_SANDBOX'],
    });
  });
});

describe('providerToken', () => {
  it('is an ES256 JWT naming the key and the team, signed by the key', () => {
    const jwt = providerToken(KEY, NOW + 999);
    const [header, claims] = parts(jwt);
    expect(json(header!)).toEqual({ alg: 'ES256', kid: KEY.keyId });
    expect(json(claims!)).toEqual({ iss: KEY.teamId, iat: NOW / 1000 });
    expect(signedBy(jwt)).toBe(true);
  });
});

describe('apnsSender', () => {
  const push = {
    device: 'ab'.repeat(32),
    topic: APNS_TOPICS.snow,
    payload: { aps: { alert: { title: 'Snow likely in Durham tomorrow', body: '1 to 2cm.' } } },
    priority: 5 as const,
    expiration: 1_790_000_000,
    collapseId: 'snow-evening-2026-12-02',
  };

  it("sends Apple's headers and the payload over HTTP/2, and reads a 200", async () => {
    const { origin, seen } = await fakeApns(apple);
    const sender = apnsSender(origin);
    const jwt = providerToken(KEY, NOW);
    const first = await sender.send(jwt, push);
    // A second push shares the session.
    await sender.send(jwt, { ...push, priority: 10, collapseId: undefined });
    sender.close();

    expect(first).toEqual({ status: 200, reason: null, timestamp: null });
    const [a, b] = seen;
    expect(a!.headers).toMatchObject({
      ':method': 'POST',
      ':path': `/3/device/${push.device}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': 'today.willitsnow.app',
      'apns-push-type': 'alert',
      'apns-priority': '5',
      'apns-expiration': '1790000000',
      'apns-collapse-id': 'snow-evening-2026-12-02',
    });
    expect(a!.headers['apns-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(a!.body)).toEqual(push.payload);
    expect(b!.headers['apns-priority']).toBe('10');
    expect(b!.headers['apns-collapse-id']).toBeUndefined();
    expect(b!.headers['apns-id']).not.toBe(a!.headers['apns-id']);
  });

  it("reads Apple's reason and a 410's timestamp", async () => {
    const { origin } = await fakeApns(() => ({
      status: 410,
      body: { reason: 'Unregistered', timestamp: 1_790_000_000_000 },
    }));
    const sender = apnsSender(origin);
    expect(await sender.send('jwt', push)).toEqual({
      status: 410,
      reason: 'Unregistered',
      timestamp: 1_790_000_000_000,
    });
    sender.close();
  });

  it('reports an answer that is not JSON by its status alone', async () => {
    const { origin } = await fakeApns(() => ({ status: 503, body: '<html>busy</html>' }));
    const sender = apnsSender(origin);
    expect(await sender.send('jwt', push)).toEqual({ status: 503, reason: null, timestamp: null });
    sender.close();
  });

  it('rejects when Apple cannot be reached', async () => {
    const { origin } = await fakeApns(apple);
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
    const sender = apnsSender(origin);
    await expect(sender.send('jwt', push)).rejects.toThrow();
    sender.close();
  });

  it('rejects when Apple does not answer in time', async () => {
    const { origin } = await fakeApns(() => 'hang');
    const sender = apnsSender(origin, 50);
    await expect(sender.send('jwt', push)).rejects.toThrow('APNs did not answer within 50 ms');
    sender.close();
  });
});

describe('smokeVerdict', () => {
  it('passes only on 400 BadDeviceToken', () => {
    expect(smokeVerdict({ status: 400, reason: 'BadDeviceToken', timestamp: null })).toEqual({
      ok: true,
      line: "400 BadDeviceToken, as expected: Apple took the key's token and refused the made-up device",
    });
  });

  it('says what to check for anything else, knowing Apple was reached', () => {
    const v = (status: number, reason: string | null) =>
      smokeVerdict({ status, reason, timestamp: null });
    expect(v(403, 'InvalidProviderToken')).toEqual({
      ok: false,
      line: "403 InvalidProviderToken: Apple answered, so the path to it works, but Apple refused the key's token: check that APNS_TEAM_ID and APNS_KEY_ID_SANDBOX belong to the sandbox key, and that today.willitsnow.app is registered under the team",
    });
    expect(v(400, 'TopicDisallowed').line).toBe(
      '400 TopicDisallowed: Apple answered, so the path to it works, but Apple refused the topic: register today.willitsnow.app under the team',
    );
    expect(v(200, null)).toEqual({
      ok: false,
      line: '200: Apple answered, so the path to it works, but expected 400 BadDeviceToken',
    });
  });
});

describe('apnsSmoke', () => {
  it('pushes once to the made-up device with the sandbox key, and passes on BadDeviceToken', async () => {
    const { origin, seen } = await fakeApns(apple);
    expect(await apnsSmoke(env(ENV), { now: NOW, origin })).toEqual({
      ok: true,
      line: "400 BadDeviceToken, as expected: Apple took the key's token and refused the made-up device",
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers).toMatchObject({
      ':path': `/3/device/${SMOKE_DEVICE}`,
      'apns-topic': 'today.willitsnow.app',
      'apns-expiration': '0',
    });
  });

  it('fails on a key Apple refuses', async () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    const { origin } = await fakeApns(apple);
    const smoke = await apnsSmoke(
      env({ ...ENV, APNS_KEY_SANDBOX: other.export({ type: 'pkcs8', format: 'pem' }) as string }),
      { now: NOW, origin },
    );
    expect(smoke.ok).toBe(false);
    expect(smoke.line).toMatch(/^403 InvalidProviderToken: /);
  });

  it('names missing settings and a key that is not a key, without sending', async () => {
    expect(await apnsSmoke(env({}), { now: NOW })).toEqual({
      ok: false,
      line: 'missing APNS_TEAM_ID, APNS_KEY_ID_SANDBOX, APNS_KEY_SANDBOX',
    });
    const notAKey = await apnsSmoke(env({ ...ENV, APNS_KEY_SANDBOX: 'oops' }), { now: NOW });
    expect(notAKey).toEqual({
      ok: false,
      line: expect.stringMatching(/^APNS_KEY_SANDBOX: not a \.p8 key/),
    });
    // A well-formed PEM whose body is not a key.
    const broken = await apnsSmoke(
      env({ ...ENV, APNS_KEY_SANDBOX: '-----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY-----' }),
      { now: NOW },
    );
    expect(broken.ok).toBe(false);
    expect(broken.line).toMatch(/^APNS_KEY_SANDBOX: /);
  });

  it('fails when Apple cannot be reached', async () => {
    const { origin } = await fakeApns(apple);
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
    const smoke = await apnsSmoke(env(ENV), { now: NOW, origin });
    expect(smoke.ok).toBe(false);
    expect(smoke.line).toMatch(/^no answer from APNs: /);
  });

  it('never puts the key, its token or a device token in its line', async () => {
    const { origin } = await fakeApns(apple);
    const { line } = await apnsSmoke(env(ENV), { now: NOW, origin });
    expect(line).not.toContain(BODY.slice(0, 20));
    expect(line).not.toContain(providerToken(KEY, NOW).slice(0, 20));
    expect(line).not.toContain(SMOKE_DEVICE);
  });
});

describe('alertsRun', () => {
  it('logs one line and sends nothing while switched off', async () => {
    const { origin, seen } = await fakeApns(apple);
    const run = (deployContext: string | undefined, vars = ENV) =>
      alertsRun({ env: env(vars), deployContext, now: NOW, origin });
    expect(await run('production')).toBe('alerts-run: disabled (production, ALERTS_ENABLED unset)');
    expect(await run('production', { ...ENV, ALERTS_ENABLED: 'yes' })).toBe(
      'alerts-run: disabled (production, ALERTS_ENABLED is not true)',
    );
    expect(await run('deploy-preview')).toBe(
      'alerts-run: disabled (deploy-preview, ALERTS_ENABLED unset, ALERTS_SMOKE unset)',
    );
    expect(await run('branch-deploy', { ...ENV, ALERTS_SMOKE: 'yes' })).toBe(
      'alerts-run: disabled (branch-deploy, ALERTS_ENABLED unset, ALERTS_SMOKE is not 1)',
    );
    expect(await run(undefined)).toBe(
      'alerts-run: disabled (unknown context, ALERTS_ENABLED unset, ALERTS_SMOKE unset)',
    );
    expect(seen).toHaveLength(0);
  });

  it('never smokes in production, whatever the setting', async () => {
    const { origin, seen } = await fakeApns(apple);
    const smokeOn = env({ ...ENV, ALERTS_SMOKE: '1' });
    expect(await alertsRun({ env: smokeOn, deployContext: 'production', now: NOW, origin })).toBe(
      'alerts-run: disabled (production, ALERTS_ENABLED unset)',
    );
    // Switched on, production runs the job instead (here without a Blobs store, so it stops).
    const on = env({ ...ENV, ALERTS_SMOKE: '1', ALERTS_ENABLED: 'true' });
    expect(await alertsRun({ env: on, deployContext: 'production', now: NOW, origin })).toMatch(
      /^alerts-run: error: no alert store \(/,
    );
    expect(seen).toHaveLength(0);
  });

  it('smokes on a deploy preview with ALERTS_SMOKE=1, and logs the result', async () => {
    const { origin, seen } = await fakeApns(apple);
    const run = (vars: Record<string, string>) =>
      alertsRun({ env: env(vars), deployContext: 'deploy-preview', now: NOW, origin });
    expect(await run({ ...ENV, ALERTS_SMOKE: ' 1\n' })).toBe(
      "alerts-run: smoke passed: 400 BadDeviceToken, as expected: Apple took the key's token and refused the made-up device",
    );
    expect(await run({ ALERTS_SMOKE: '1' })).toBe(
      'alerts-run: smoke failed: missing APNS_TEAM_ID, APNS_KEY_ID_SANDBOX, APNS_KEY_SANDBOX',
    );
    expect(seen).toHaveLength(1);
  });
});
