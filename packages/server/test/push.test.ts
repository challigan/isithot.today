import { createPublicKey, generateKeyPairSync, verify, type KeyObject } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http2';
import { betweenLine, snowAgreementLine, snowAmountLine } from '@isithot/core';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  APNS_PAYLOAD_LIMIT,
  CITIES,
  DELIVERY_OUTCOMES,
  MemoryAlertStore,
  PROVIDER_TOKEN_REUSE_MS,
  SafeAlertStore,
  alertPush,
  apnsSender,
  classifyApns,
  deliveryFinished,
  idsKey,
  jwtKey,
  providerToken,
  providerTokens,
  regKey,
  registrationId,
  sendAlerts,
  sentKey,
  type AlertPushInput,
  type AlertStore,
  type ApnsEnv,
  type ApnsKey,
  type ApnsSender,
  type Delivery,
  type PushRecord,
  type SendAlertsInput,
  type StoredProviderToken,
} from '../src';
import { closeFakes, fakeApns, type FakeReply } from './fakeApns';

afterEach(closeFakes);

// Throwaway P-256 keys, one per environment, as Apple's .p8 files are.
const makeKey = (keyId: string): { key: ApnsKey; publicKey: KeyObject } => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  return { key: { teamId: 'TEAM123456', keyId, pem }, publicKey: createPublicKey(privateKey) };
};
const SANDBOX = makeKey('SANDBOX001');
const PRODUCTION = makeKey('PRODUCT001');
const KEYS: Record<ApnsEnv, ApnsKey> = { sandbox: SANDBOX.key, production: PRODUCTION.key };
const PUBLIC: Record<string, KeyObject> = {
  [SANDBOX.key.keyId]: SANDBOX.publicKey,
  [PRODUCTION.key.keyId]: PRODUCTION.publicKey,
};

/** 18:05 in Durham on 1 December 2026: the evening window. */
const NOW = Date.UTC(2026, 11, 1, 18, 5, 0);
const MINUTE = 60 * 1000;
const LOCAL_DATE = '2026-12-01';
const EXPIRES = Date.UTC(2026, 11, 1, 21, 0, 0) / 1000;
const DURHAM = {
  title: 'Snow likely in Durham tomorrow',
  body: '1 to 2cm of snow. Mostly between 2am and 6am. 5 of 6 forecasts expect snow.',
  relevance: 0.6,
};

/** A 64-hex device token whose first two characters tell the fake how to answer. */
const token = (script: string, n = 0): string =>
  `${script}${n.toString(16).padStart(4, '0')}${'c'.repeat(58)}`;

function record(device: string, over: Partial<PushRecord> = {}): PushRecord {
  return {
    id: registrationId('snow', device),
    app: 'snow',
    env: 'sandbox',
    token: device,
    tz: 'Europe/London',
    query: 'place=durham-gb',
    name: 'Durham',
    updatedAt: '2026-11-20T19:02:11.000Z',
    seenAt: '2026-11-28T08:00:00.000Z',
    appVersion: '1.0 (7)',
    ...over,
  };
}

const pushFor = (r: PushRecord, over: Partial<AlertPushInput> = {}) =>
  alertPush({
    record: r,
    alert: DURHAM,
    topic: 'snow',
    kind: 'evening',
    date: '2026-12-02',
    collapseId: 'snow-evening-2026-12-02',
    expiration: EXPIRES,
    priority: 5,
    ...over,
  });

const delivery = (r: PushRecord): Delivery => ({
  record: r,
  claimKey: sentKey(LOCAL_DATE, 'snow', 'evening', r.app, r.id),
  push: pushFor(r),
});

/** The store as the devices handler leaves it: the record and its ids key. */
async function seed(store: AlertStore, ...records: PushRecord[]): Promise<void> {
  for (const r of records) {
    await store.set(regKey(r.tz, r.app, r.id), { v: 1, ...r, units: 'c' });
    await store.set(idsKey(r.app, r.id), { tz: r.tz });
  }
}

/** Every line logged and every store error, for the check that nothing secret is in them. */
const logged: string[] = [];
const log = (line: string) => logged.push(line);

const signed = (jwt: string): boolean => {
  const [header, claims, signature] = jwt.split('.');
  const kid = JSON.parse(Buffer.from(header ?? '', 'base64url').toString('utf8')).kid as string;
  const key = PUBLIC[kid];
  return (
    !!key &&
    verify(
      'sha256',
      Buffer.from(`${header}.${claims}`),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature ?? '', 'base64url'),
    )
  );
};

/** Apple, scripted by each device token's first two characters; anything else is a 200. */
function apple(script: Record<string, FakeReply>) {
  return (headers: IncomingHttpHeaders, body: string): FakeReply => {
    if (!signed(String(headers.authorization).replace(/^bearer /, ''))) {
      return { status: 403, body: { reason: 'InvalidProviderToken' } };
    }
    if (headers['apns-topic'] !== 'today.willitsnow.app') {
      return { status: 400, body: { reason: 'BadTopic' } };
    }
    if (Buffer.byteLength(body) > 4096) return { status: 413, body: { reason: 'PayloadTooLarge' } };
    const device = String(headers[':path']).split('/').pop()!;
    return script[device.slice(0, 2)] ?? { status: 200 };
  };
}

const devicesSeen = (seen: { headers: IncomingHttpHeaders }[]) =>
  seen.map((s) => String(s.headers[':path']).split('/').pop());

/** One run against the fake; every line it logs also goes to `logged`. */
async function run(
  origin: string,
  { log: also, ...over }: Partial<SendAlertsInput> & Pick<SendAlertsInput, 'store' | 'deliveries'>,
) {
  return sendAlerts({
    keys: KEYS,
    now: NOW,
    apnsConcurrency: 20,
    quiet: { from: 21, to: 7 },
    connect: () => apnsSender(origin, 2000),
    ...over,
    log: (line) => {
      log(line);
      also?.(line);
    },
  });
}

describe('alertPush', () => {
  it("builds section 8.5's payload exactly, and its headers' values", () => {
    const push = pushFor(record(token('a0')));
    expect(JSON.stringify(push.payload)).toBe(
      JSON.stringify({
        aps: {
          alert: {
            title: 'Snow likely in Durham tomorrow',
            body: '1 to 2cm of snow. Mostly between 2am and 6am. 5 of 6 forecasts expect snow.',
          },
          sound: 'default',
          'thread-id': 'snow',
          'interruption-level': 'active',
          'relevance-score': 0.6,
        },
        topic: 'snow',
        kind: 'evening',
        date: '2026-12-02',
        view: 'today',
        place: 'place=durham-gb',
        name: 'Durham',
      }),
    );
    expect(push).toMatchObject({
      device: token('a0'),
      topic: 'today.willitsnow.app',
      priority: 5,
      expiration: EXPIRES,
      collapseId: 'snow-evening-2026-12-02',
    });
    expect(push.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // A fresh apns-id each time, unless one is given.
    expect(pushFor(record(token('a0'))).id).not.toBe(push.id);
    expect(pushFor(record(token('a0')), { id: 'given' }).id).toBe('given');
  });

  it('sends those headers, and the apns-id it was given', async () => {
    const { origin, seen } = await fakeApns(apple({}));
    const sender = apnsSender(origin);
    const r = record(token('a0'));
    const evening = pushFor(r);
    const morning = pushFor(r, {
      kind: 'morning',
      date: '2026-12-01',
      collapseId: 'snow-morning-2026-12-01',
      expiration: Date.UTC(2026, 11, 1, 11, 0, 0) / 1000,
      priority: 10,
    });
    const jwt = providerToken(KEYS.sandbox, NOW);
    expect(sender.maxConcurrentStreams?.()).toBeUndefined();
    await sender.send(jwt, evening);
    expect(sender.maxConcurrentStreams?.()).toBeGreaterThan(0);
    await sender.send(jwt, morning);
    sender.close();
    expect(seen[0]!.headers).toMatchObject({
      ':path': `/3/device/${token('a0')}`,
      'apns-push-type': 'alert',
      'apns-topic': 'today.willitsnow.app',
      'apns-priority': '5',
      'apns-expiration': String(EXPIRES),
      'apns-collapse-id': 'snow-evening-2026-12-02',
      'apns-id': evening.id,
    });
    expect(seen[1]!.headers).toMatchObject({
      'apns-priority': '10',
      'apns-expiration': String(Date.UTC(2026, 11, 1, 11, 0, 0) / 1000),
      'apns-collapse-id': 'snow-morning-2026-12-01',
      'apns-id': morning.id,
    });
    expect(JSON.parse(seen[1]!.body)).toMatchObject({ kind: 'morning', date: '2026-12-01' });
  });

  it('stays at or under 1,024 bytes for the longest place names', () => {
    const longest = [...CITIES].sort(
      (a, b) => Buffer.byteLength(b.name) - Buffer.byteLength(a.name),
    )[0]!;
    const longestSlug = [...CITIES].sort((a, b) => b.slug.length - a.slug.length)[0]!;
    expect(longest.name).toBe('Las Palmas de Gran Canaria');
    // The longest body the copy makes: a wide range, still to come, until midnight.
    const body = `${snowAmountLine({ low: 25, high: 100 }, 'cm', true)} ${betweenLine(10, 23)} ${snowAgreementLine(5, 6)}.`;
    // A searched place at the server's 80-character limits for its name and region.
    const searched = new URLSearchParams({
      lat: '-54.80',
      lon: '-123.45',
      name: 'N'.repeat(80),
      region: 'R'.repeat(80),
      country: 'GB',
      geonameId: '1234567890',
      elevation: '1234',
      source: 'search',
    }).toString();
    const places = [
      { query: `place=${longest.slug}`, name: longest.name },
      { query: `place=${longestSlug.slug}`, name: longestSlug.name },
      { query: searched, name: 'N'.repeat(80) },
      { query: 'lat=-54.80&lon=-123.45&source=device', name: 'Your location' },
    ];
    for (const place of places) {
      const push = pushFor(record(token('a0'), place), {
        alert: { title: `Heavy snow likely in ${place.name} tomorrow`, body, relevance: 0.8 },
        kind: 'morning',
      });
      expect(Buffer.byteLength(JSON.stringify(push.payload))).toBeLessThanOrEqual(1024);
    }
    // The Durham example is about the size the spec gives.
    expect(Buffer.byteLength(JSON.stringify(pushFor(record(token('a0'))).payload))).toBeLessThan(
      400,
    );
  });

  it("stays inside Apple's 4,096 bytes even for 80 three-byte characters of name and region", () => {
    const name = '雪'.repeat(80);
    const query = new URLSearchParams({
      lat: '35.70',
      lon: '139.70',
      name,
      region: name,
      source: 'search',
    });
    const push = pushFor(record(token('a0'), { query: query.toString(), name }), {
      alert: { title: `Heavy snow likely in ${name} tomorrow`, body: DURHAM.body, relevance: 0.8 },
    });
    expect(Buffer.byteLength(JSON.stringify(push.payload))).toBeLessThanOrEqual(APNS_PAYLOAD_LIMIT);
  });

  it('refuses a push that cannot go, before anything is claimed', () => {
    const r = record(token('a0'));
    expect(() => pushFor({ ...r, app: 'wind' })).toThrow('no APNs topic for the app "wind"');
    expect(() => pushFor(r, { expiration: EXPIRES * 1000 })).toThrow(/whole Unix seconds/);
    expect(() => pushFor(r, { expiration: 1.5 })).toThrow(/whole Unix seconds/);
    expect(() => pushFor(r, { expiration: -1 })).toThrow(/whole Unix seconds/);
    expect(() => pushFor(r, { collapseId: 'x'.repeat(65) })).toThrow(/over 64 bytes/);
    expect(() =>
      pushFor(r, { alert: { ...DURHAM, body: 'x'.repeat(APNS_PAYLOAD_LIMIT) } }),
    ).toThrow(/over Apple's limit/);
  });
});

// The quiet hours' own cases are core's (packages/core/test/alerts.test.ts): the sender uses
// core's `inQuietHours`, so the run and the sender share one rule.

describe('classifyApns', () => {
  const r = { updatedAt: '2026-11-20T19:02:11.000Z' };
  const c = (status: number, reason: string | null = null, timestamp: number | null = null) =>
    classifyApns({ status, reason, timestamp }, r);

  it("follows section 8.5's table", () => {
    expect(c(200)).toBe('sent');
    expect(c(410, 'Unregistered', Date.parse('2026-11-21T00:00:00Z'))).toBe('forget');
    expect(c(410, 'ExpiredToken')).toBe('forget');
    // The app registered again after Apple found the token gone.
    expect(c(410, 'Unregistered', Date.parse('2026-11-20T19:02:10.000Z'))).toBe('keep');
    expect(c(410, 'SomethingNew')).toBe('keep');
    expect(c(400, 'BadDeviceToken')).toBe('forget');
    expect(c(400, 'DeviceTokenNotForTopic')).toBe('forget');
    for (const reason of [
      'ExpiredProviderToken',
      'InvalidProviderToken',
      'MissingProviderToken',
      'Forbidden',
    ]) {
      expect(c(403, reason)).toBe('reauth');
    }
    expect(c(429, 'TooManyRequests')).toBe('retry');
    expect(c(429, 'TooManyProviderTokenUpdates')).toBe('retry');
    expect(c(500, 'InternalServerError')).toBe('retry');
    expect(c(503, 'ServiceUnavailable')).toBe('retry');
    for (const [status, reason] of [
      [400, 'BadTopic'],
      [400, 'BadCollapseId'],
      [400, 'BadExpirationDate'],
      [404, 'BadPath'],
      [405, 'MethodNotAllowed'],
      [413, 'PayloadTooLarge'],
    ] as const) {
      expect(c(status, reason)).toBe('keep');
    }
  });

  it('says which outcomes leave work for the next run', () => {
    expect(DELIVERY_OUTCOMES.filter((o) => !deliveryFinished(o))).toEqual(['released', 'deferred']);
  });
});

describe('providerTokens', () => {
  /** A memory store that counts its calls. */
  function counted(inner = new MemoryAlertStore()) {
    const calls = { get: 0, set: 0, delete: 0 };
    const store: AlertStore = {
      get: (key) => (calls.get++, inner.get(key)),
      set: (key, value, options) => (calls.set++, inner.set(key, value, options)),
      list: (prefix, options) => inner.list(prefix, options),
      delete: (key) => (calls.delete++, inner.delete(key)),
    };
    return { store, inner, calls };
  }
  const iatOf = (jwt: string) =>
    JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8')).iat as number;

  it('makes one, stores it, and reads the store once per run', async () => {
    const { store, inner, calls } = counted();
    const tokens = providerTokens({ store, keys: KEYS, now: NOW });
    const [a, b] = await Promise.all([tokens.get('sandbox'), tokens.get('sandbox')]);
    expect(a).toBe(b);
    expect(signed(a)).toBe(true);
    expect(calls).toEqual({ get: 1, set: 1, delete: 0 });
    expect(await inner.get(jwtKey('sandbox'))).toEqual({ jwt: a, iat: NOW / 1000 });
    expect(await tokens.get('production')).not.toBe(a);
  });

  it('is reused by later runs under 50 minutes, and replaced at 50', async () => {
    const { store, inner, calls } = counted();
    const first = await providerTokens({ store, keys: KEYS, now: NOW }).get('sandbox');
    const later = await providerTokens({ store, keys: KEYS, now: NOW + 49 * MINUTE }).get(
      'sandbox',
    );
    expect(later).toBe(first);
    expect(calls.set).toBe(1);
    expect(PROVIDER_TOKEN_REUSE_MS).toBe(50 * MINUTE);
    const fresh = await providerTokens({ store, keys: KEYS, now: NOW + 50 * MINUTE }).get(
      'sandbox',
    );
    expect(fresh).not.toBe(first);
    expect(iatOf(fresh)).toBe((NOW + 50 * MINUTE) / 1000);
    expect(await inner.get(jwtKey('sandbox'))).toEqual({ jwt: fresh, iat: iatOf(fresh) });
  });

  it("never reuses another key's token, a malformed one, or one from the future", async () => {
    const inner = new MemoryAlertStore();
    const tokens = () => providerTokens({ store: inner, keys: KEYS, now: NOW });
    const stored: StoredProviderToken[] = [
      { jwt: providerToken(KEYS.production, NOW), iat: NOW / 1000 },
      { jwt: providerToken({ ...KEYS.sandbox, teamId: 'OTHERTEAM1' }, NOW), iat: NOW / 1000 },
      { jwt: providerToken(KEYS.sandbox, NOW - MINUTE), iat: NOW / 1000 },
      { jwt: providerToken(KEYS.sandbox, NOW + 10 * MINUTE), iat: (NOW + 10 * MINUTE) / 1000 },
      { jwt: 'not.a.token', iat: NOW / 1000 },
      // Parts that decode to JSON, but not to objects.
      { jwt: 'MQ.MQ.c2ln', iat: NOW / 1000 },
      { jwt: '', iat: NOW / 1000 },
    ];
    for (const value of [...stored, { jwt: 1 }, 'text', null]) {
      await inner.set(jwtKey('sandbox'), value);
      const jwt = await tokens().get('sandbox');
      expect(stored.map((s) => s.jwt)).not.toContain(jwt);
      expect(signed(jwt) && iatOf(jwt) === NOW / 1000).toBe(true);
    }
    // A minute's grace for another instance's clock.
    const ahead = providerToken(KEYS.sandbox, NOW + 30_000);
    await inner.set(jwtKey('sandbox'), { jwt: ahead, iat: iatOf(ahead) });
    expect(await tokens().get('sandbox')).toBe(ahead);
  });

  it('still makes a token when the store fails, and rejects without a key', async () => {
    const errors: string[] = [];
    const down = new SafeAlertStore(
      {
        get: () => Promise.reject(new Error('down')),
        set: () => Promise.reject(new Error('down')),
        list: () => Promise.reject(new Error('down')),
        delete: () => Promise.reject(new Error('down')),
      },
      (e) => errors.push(e.message),
    );
    const tokens = providerTokens({ store: down, keys: { sandbox: KEYS.sandbox }, now: NOW });
    expect(signed(await tokens.get('sandbox'))).toBe(true);
    expect(errors).toEqual([
      'alert store: get apns/v1/jwt/sandbox: down',
      'alert store: set apns/v1/jwt/sandbox: down',
    ]);
    await expect(tokens.get('production')).rejects.toThrow('no production key');
    // A failure is not kept: the next ask tries again.
    await expect(tokens.get('production')).rejects.toThrow('no production key');
    await tokens.drop('sandbox', 'x');
    const broken = providerTokens({
      store: new MemoryAlertStore(),
      keys: { sandbox: { ...KEYS.sandbox, pem: 'not a key' } },
      now: NOW,
    });
    await expect(broken.get('sandbox')).rejects.toThrow();
  });

  it('drops the refused token, but not one another run has made since', async () => {
    const { store, inner } = counted();
    const tokens = providerTokens({ store, keys: KEYS, now: NOW });
    const refused = await tokens.get('sandbox');
    await tokens.drop('sandbox', refused);
    expect(await inner.get(jwtKey('sandbox'))).toBeNull();
    // Already gone: nothing to do.
    await tokens.drop('sandbox', refused);
    // Asked again, it makes a new one.
    const next = await tokens.get('sandbox');
    expect(next).not.toBe(refused);
    // Another run made a newer one in the meantime: keep it.
    const newer = { jwt: providerToken(KEYS.sandbox, NOW + MINUTE), iat: (NOW + MINUTE) / 1000 };
    await inner.set(jwtKey('sandbox'), newer);
    await tokens.drop('sandbox', next);
    expect(await inner.get(jwtKey('sandbox'))).toEqual(newer);
  });
});

describe('sendAlerts', () => {
  it('sends, keeps the claim with its apns-id, and never sends twice', async () => {
    const { origin, seen } = await fakeApns(apple({}));
    const store = new MemoryAlertStore();
    const r = record(token('a0'));
    await seed(store, r);
    const d = delivery(r);
    const first = await run(origin, { store, deliveries: [d] });
    expect(first.results).toEqual([{ delivery: d, outcome: 'sent', status: 200, reason: null }]);
    expect(first.counts).toMatchObject({ sent: 1, deleted: 0, released: 0, deferred: 0 });
    expect(await store.get(d.claimKey)).toEqual({
      at: '2026-12-01T18:05:00.000Z',
      apnsId: d.push.id,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers['apns-id']).toBe(d.push.id);
    expect(JSON.parse(seen[0]!.body)).toEqual(d.push.payload);
    // The next run in the window (18:20) finds the claim.
    const again = await run(origin, { store, deliveries: [delivery(r)], now: NOW + 15 * MINUTE });
    expect(again.results[0]!.outcome).toBe('taken');
    expect(seen).toHaveLength(1);
  });

  it('sends each notification once when two runs overlap', async () => {
    const { origin, seen } = await fakeApns(apple({}), { delayMs: 5 });
    const store = new MemoryAlertStore();
    const records = Array.from({ length: 6 }, (_, i) => record(token('a0', i)));
    await seed(store, ...records);
    const [a, b] = await Promise.all([
      run(origin, { store, deliveries: records.map(delivery) }),
      run(origin, { store, deliveries: records.map(delivery) }),
    ]);
    expect(a.counts.sent + b.counts.sent).toBe(6);
    expect(a.counts.taken + b.counts.taken).toBe(6);
    expect(new Set(devicesSeen(seen)).size).toBe(6);
    expect(seen).toHaveLength(6);
  });

  it('deletes on 410 and keeps the claim, unless the app registered again since', async () => {
    const gone = Date.parse('2026-12-01T18:00:00Z');
    const { origin } = await fakeApns(
      apple({ de: { status: 410, body: { reason: 'Unregistered', timestamp: gone } } }),
    );
    const store = new MemoryAlertStore();
    const dead = record(token('de', 1));
    const reRegistered = record(token('de', 2), { updatedAt: '2026-12-01T18:01:00.000Z' });
    const refreshed = record(token('de', 3));
    await seed(store, dead, reRegistered, { ...refreshed, seenAt: '2026-12-01T18:04:00.000Z' });
    const { results } = await run(origin, {
      store,
      deliveries: [dead, reRegistered, refreshed].map(delivery),
    });
    expect(results.map((x) => [x.outcome, x.status, x.reason])).toEqual([
      ['deleted', 410, 'Unregistered'],
      ['kept', 410, 'Unregistered'],
      ['kept', 410, 'Unregistered'],
    ]);
    expect(await store.get(regKey(dead.tz, 'snow', dead.id))).toBeNull();
    expect(await store.get(idsKey('snow', dead.id))).toBeNull();
    expect(await store.get(regKey(reRegistered.tz, 'snow', reRegistered.id))).not.toBeNull();
    expect(await store.get(regKey(refreshed.tz, 'snow', refreshed.id))).not.toBeNull();
    for (const x of results) expect(await store.get(x.delivery.claimKey)).not.toBeNull();
  });

  it('deletes on BadDeviceToken and DeviceTokenNotForTopic, logging env and app version', async () => {
    const { origin } = await fakeApns(
      apple({
        b0: { status: 400, body: { reason: 'BadDeviceToken' } },
        b1: { status: 400, body: { reason: 'DeviceTokenNotForTopic' } },
      }),
    );
    const store = new MemoryAlertStore();
    const bad = record(token('b0'));
    const notForTopic = record(token('b1'), { env: 'production', appVersion: undefined });
    await seed(store, bad, notForTopic);
    const lines: string[] = [];
    const { counts } = await run(origin, {
      store,
      deliveries: [bad, notForTopic].map(delivery),
      log: (line) => lines.push(line),
    });
    expect(counts.deleted).toBe(2);
    expect(store.keys().filter((k) => !k.startsWith('sent/') && !k.startsWith('apns/'))).toEqual(
      [],
    );
    // The two environments' sessions run side by side, so their lines come in either order.
    expect(lines.sort()).toEqual(
      [
        `alerts: deleted snow.${bad.id.slice(0, 8)}… (400 BadDeviceToken, sandbox, app 1.0 (7))`,
        `alerts: deleted snow.${notForTopic.id.slice(0, 8)}… (400 DeviceTokenNotForTopic, production, app unknown)`,
      ].sort(),
    );
  });

  it('keeps a refused registration it cannot delete', async () => {
    const { origin } = await fakeApns(
      apple({ b0: { status: 400, body: { reason: 'BadDeviceToken' } } }),
    );
    const inner = new MemoryAlertStore();
    const bad = record(token('b0'));
    await seed(inner, bad);
    const store = new SafeAlertStore(
      {
        get: (key) => (key.startsWith('reg/') ? Promise.reject(new Error('down')) : inner.get(key)),
        set: (key, value, options) => inner.set(key, value, options),
        list: (prefix, options) => inner.list(prefix, options),
        delete: (key) => inner.delete(key),
      },
      (e) => log(e.message),
    );
    const lines: string[] = [];
    const { results } = await run(origin, {
      store,
      deliveries: [delivery(bad)],
      log: (l) => lines.push(l),
    });
    expect(results[0]!.outcome).toBe('kept');
    expect(lines).toEqual([
      `alerts: error: could not delete snow.${bad.id.slice(0, 8)}… (400 BadDeviceToken, sandbox, app 1.0 (7))`,
    ]);
    expect(await inner.get(regKey(bad.tz, 'snow', bad.id))).not.toBeNull();
  });

  it('on a 403 drops the shared token, releases the claim, never deletes, and stops that environment', async () => {
    const { origin, seen } = await fakeApns(
      apple({ f3: { status: 403, body: { reason: 'ExpiredProviderToken' } } }),
    );
    const store = new MemoryAlertStore();
    const refused = record(token('f3'));
    const waiting = [record(token('a0', 1)), record(token('a0', 2))];
    const elsewhere = record(token('a0', 3), { env: 'production' });
    await seed(store, refused, ...waiting, elsewhere);
    const lines: string[] = [];
    const { results, counts } = await run(origin, {
      store,
      deliveries: [refused, ...waiting, elsewhere].map(delivery),
      log: (l) => lines.push(l),
    });
    expect(results.map((x) => x.outcome)).toEqual(['released', 'deferred', 'deferred', 'sent']);
    expect(counts).toMatchObject({ released: 1, deferred: 2, sent: 1 });
    expect(devicesSeen(seen).sort()).toEqual([token('a0', 3), token('f3')]);
    // The sandbox token is gone; production's stays. No registration was touched.
    expect(await store.get(jwtKey('sandbox'))).toBeNull();
    expect(await store.get(jwtKey('production'))).not.toBeNull();
    for (const r of [refused, ...waiting]) {
      expect(await store.get(regKey(r.tz, 'snow', r.id))).not.toBeNull();
      expect(await store.get(delivery(r).claimKey)).toBeNull();
    }
    expect(lines).toEqual([
      'alerts: error: stopped sandbox for this run: APNs refused the provider token (403 ExpiredProviderToken)',
    ]);
    // The next run makes a new token and sends what was left.
    const next = await run(origin, {
      store,
      deliveries: waiting.map(delivery),
      now: NOW + 15 * MINUTE,
    });
    expect(next.counts.sent).toBe(2);
  });

  it('says once that it stopped, when pushes side by side are refused together', async () => {
    const { origin } = await fakeApns(
      apple({ f3: { status: 403, body: { reason: 'InvalidProviderToken' } } }),
      { delayMs: 20 },
    );
    const store = new MemoryAlertStore();
    const records = [record(token('a0')), record(token('f3', 1)), record(token('f3', 2))];
    await seed(store, ...records);
    const lines: string[] = [];
    const { results } = await run(origin, {
      store,
      deliveries: records.map(delivery),
      log: (l) => lines.push(l),
    });
    expect(results.map((x) => x.outcome)).toEqual(['sent', 'released', 'released']);
    expect(lines).toEqual([
      'alerts: error: stopped sandbox for this run: APNs refused the provider token (403 InvalidProviderToken)',
    ]);
    expect(await store.get(jwtKey('sandbox'))).toBeNull();
  });

  it('releases the claim on 429 and 5xx at one stream, and the next run sends', async () => {
    const script: Record<string, FakeReply> = {
      '59': { status: 503, body: { reason: 'ServiceUnavailable' } },
      '50': { status: 500, body: { reason: 'InternalServerError' } },
      '42': { status: 429, body: { reason: 'TooManyRequests' } },
    };
    const { origin, seen, stats } = await fakeApns(apple(script), { delayMs: 10 });
    const store = new MemoryAlertStore();
    const records = [record(token('59')), record(token('50')), record(token('42'))];
    await seed(store, ...records);
    const first = await run(origin, { store, deliveries: records.map(delivery) });
    expect(first.results.map((x) => [x.outcome, x.status])).toEqual([
      ['released', 503],
      ['released', 500],
      ['released', 429],
    ]);
    // Apple never took the token, so the pushes went one at a time.
    expect(stats.maxInFlight).toBe(1);
    for (const r of records) expect(await store.get(delivery(r).claimKey)).toBeNull();
    for (const key of Object.keys(script)) delete script[key];
    const next = await run(origin, {
      store,
      deliveries: records.map(delivery),
      now: NOW + 15 * MINUTE,
    });
    expect(next.counts.sent).toBe(3);
    expect(seen).toHaveLength(6);
  });

  it('stops an environment that Apple says updates its token too often', async () => {
    const { origin } = await fakeApns(
      apple({ '43': { status: 429, body: { reason: 'TooManyProviderTokenUpdates' } } }),
    );
    const store = new MemoryAlertStore();
    const records = [record(token('43')), record(token('a0'))];
    await seed(store, ...records);
    const lines: string[] = [];
    const { results } = await run(origin, {
      store,
      deliveries: records.map(delivery),
      log: (l) => lines.push(l),
    });
    expect(results.map((x) => x.outcome)).toEqual(['released', 'deferred']);
    expect(lines[1]).toBe(
      'alerts: error: stopped sandbox for this run: APNs 429 TooManyProviderTokenUpdates: the shared provider token is not being reused',
    );
  });

  it('keeps the claim and the registration on any other 4xx, and says so', async () => {
    const { origin } = await fakeApns(
      apple({
        '13': { status: 413, body: { reason: 'PayloadTooLarge' } },
        ba: { status: 400, body: { reason: 'BadCollapseId' } },
        '04': { status: 404 },
      }),
    );
    const store = new MemoryAlertStore();
    const records = [record(token('13')), record(token('ba')), record(token('04'))];
    await seed(store, ...records);
    const lines: string[] = [];
    const { results } = await run(origin, {
      store,
      deliveries: records.map(delivery),
      apnsConcurrency: 1,
      log: (l) => lines.push(l),
    });
    expect(results.map((x) => x.outcome)).toEqual(['kept', 'kept', 'kept']);
    for (const r of records) {
      expect(await store.get(delivery(r).claimKey)).not.toBeNull();
      expect(await store.get(regKey(r.tz, 'snow', r.id))).not.toBeNull();
    }
    expect(lines).toEqual([
      `alerts: error: APNs refused snow.${records[0]!.id.slice(0, 8)}…: 413 PayloadTooLarge; kept the claim`,
      `alerts: error: APNs refused snow.${records[1]!.id.slice(0, 8)}…: 400 BadCollapseId; kept the claim`,
      `alerts: error: APNs refused snow.${records[2]!.id.slice(0, 8)}…: 404; kept the claim`,
    ]);
  });

  it('releases the claim and stops the environment when Apple does not answer', async () => {
    const { origin } = await fakeApns(apple({ ee: 'hang' }));
    const store = new MemoryAlertStore();
    const records = [record(token('ee')), record(token('a0'))];
    await seed(store, ...records);
    const lines: string[] = [];
    const { results } = await run(origin, {
      store,
      deliveries: records.map(delivery),
      connect: () => apnsSender(origin, 50),
      log: (l) => lines.push(l),
    });
    expect(results.map((x) => [x.outcome, x.status])).toEqual([
      ['released', null],
      ['deferred', null],
    ]);
    expect(lines).toEqual([
      `alerts: error: stopped sandbox for this run: no answer from APNs for snow.${records[0]!.id.slice(0, 8)}…: APNs did not answer within 50 ms`,
    ]);
    await closeFakes();
    // Nothing listening at all.
    const unreachable = await run(origin, { store, deliveries: records.map(delivery) });
    expect(unreachable.results.map((x) => x.outcome)).toEqual(['released', 'deferred']);
  });

  it('holds the claim when its release fails: not retried today', async () => {
    const { origin } = await fakeApns(apple({ '59': { status: 503 } }));
    const inner = new MemoryAlertStore();
    const r = record(token('59'));
    await seed(inner, r);
    const store = new SafeAlertStore(
      {
        get: (key) => inner.get(key),
        set: (key, value, options) => inner.set(key, value, options),
        list: (prefix, options) => inner.list(prefix, options),
        delete: (key) =>
          key.startsWith('sent/') ? Promise.reject(new Error('down')) : inner.delete(key),
      },
      (e) => log(e.message),
    );
    const lines: string[] = [];
    const { results } = await run(origin, {
      store,
      deliveries: [delivery(r)],
      log: (l) => lines.push(l),
    });
    expect(results[0]!.outcome).toBe('held');
    expect(deliveryFinished('held')).toBe(true);
    expect(lines).toEqual([
      `alerts: error: APNs 503 for snow.${r.id.slice(0, 8)}…: could not release the claim`,
    ]);
    expect(await inner.get(delivery(r).claimKey)).not.toBeNull();
  });

  it('sends nothing for a claim the store did not confirm', async () => {
    const { origin, seen } = await fakeApns(apple({}));
    const inner = new MemoryAlertStore();
    const records = [record(token('a0', 1)), record(token('a0', 2))];
    await seed(inner, ...records);
    const errors: string[] = [];
    const store = new SafeAlertStore(
      {
        get: (key) => inner.get(key),
        set: (key, value, options) =>
          key.startsWith('sent/') ? new Promise<boolean>(() => {}) : inner.set(key, value, options),
        list: (prefix, options) => inner.list(prefix, options),
        delete: (key) => inner.delete(key),
      },
      (e) => (errors.push(e.message), log(e.message)),
      20,
    );
    const { results } = await run(origin, { store, deliveries: records.map(delivery) });
    expect(results.map((x) => x.outcome)).toEqual(['deferred', 'deferred']);
    expect(seen).toHaveLength(0);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(
      /^alert store: set sent\/v1\/2026-12-01\/snow\.evening\/snow\.[0-9a-f]{8}…: timed out after 20 ms$/,
    );
  });

  it('defers an environment with no key, or a key that cannot sign', async () => {
    const { origin, seen } = await fakeApns(apple({}));
    const store = new MemoryAlertStore();
    const records = [record(token('a0', 1), { env: 'production' }), record(token('a0', 2))];
    await seed(store, ...records);
    const lines: string[] = [];
    const { results } = await run(origin, {
      store,
      deliveries: records.map(delivery),
      keys: { sandbox: { ...KEYS.sandbox, pem: 'not a key' } },
      log: (l) => lines.push(l),
    });
    expect(results.map((x) => x.outcome)).toEqual(['deferred', 'deferred']);
    expect(seen).toHaveLength(0);
    expect(lines.sort()).toEqual([
      'alerts: error: no production provider token (no production key): 1 deferred',
      expect.stringMatching(/^alerts: error: no sandbox provider token \(.+\): 1 deferred$/),
    ]);
    expect(store.keys().filter((k) => k.startsWith('sent/'))).toEqual([]);
  });

  it('defers an environment whose session cannot be opened', async () => {
    const store = new MemoryAlertStore();
    const r = record(token('a0'));
    const lines: string[] = [];
    const { results } = await run('http://unused', {
      store,
      deliveries: [delivery(r)],
      connect: () => {
        throw new Error('bad origin');
      },
      log: (l) => lines.push(l),
    });
    expect(results[0]!.outcome).toBe('deferred');
    expect(lines).toEqual(['alerts: error: no sandbox session (bad origin): 1 deferred']);
    expect(store.keys()).toEqual([jwtKey('sandbox')]);
  });

  it('sends the first push alone, then up to apnsConcurrency at once', async () => {
    const { origin, seen, stats } = await fakeApns(apple({}), { delayMs: 30 });
    const store = new MemoryAlertStore();
    const records = Array.from({ length: 12 }, (_, i) => record(token('a0', i)));
    // Another run holds the first claim: the first push is the second delivery's.
    await store.set(
      delivery(records[0]!).claimKey,
      { at: 'earlier', apnsId: 'x' },
      { onlyIfNew: true },
    );
    const { counts } = await run(origin, {
      store,
      deliveries: records.map(delivery),
      apnsConcurrency: 4,
    });
    expect(counts).toMatchObject({ taken: 1, sent: 11 });
    expect(seen.map((s) => s.inFlight).slice(0, 5)).toEqual([1, 1, 2, 3, 4]);
    expect(stats.maxInFlight).toBe(4);
    expect(stats.sessions).toBe(1);
  });

  it("never asks for more streams than the session's maximum", async () => {
    const { origin, seen, stats } = await fakeApns(apple({}), {
      delayMs: 30,
      settings: { maxConcurrentStreams: 3 },
    });
    const store = new MemoryAlertStore();
    const records = Array.from({ length: 10 }, (_, i) => record(token('a0', i)));
    // Node queues requests past the server's limit by itself, so count them on this side.
    const waiting = { now: 0, most: 0 };
    const counted = (sender: ApnsSender): ApnsSender => ({
      ...sender,
      async send(jwt, push) {
        waiting.most = Math.max(waiting.most, ++waiting.now);
        try {
          return await sender.send(jwt, push);
        } finally {
          waiting.now--;
        }
      },
    });
    const { counts } = await run(origin, {
      store,
      deliveries: records.map(delivery),
      apnsConcurrency: 20,
      connect: () => counted(apnsSender(origin)),
    });
    expect(counts.sent).toBe(10);
    expect(seen[0]!.inFlight).toBe(1);
    expect(waiting.most).toBe(3);
    expect(stats.maxInFlight).toBe(3);
  });

  it('opens one session per APNs environment, each with its own key', async () => {
    const { origin, seen, stats } = await fakeApns(apple({}));
    const store = new MemoryAlertStore();
    const records = [
      ...Array.from({ length: 3 }, (_, i) => record(token('a0', i))),
      ...Array.from({ length: 3 }, (_, i) => record(token('a1', i), { env: 'production' })),
    ];
    const envs: ApnsEnv[] = [];
    const { counts } = await run(origin, {
      store,
      deliveries: records.map(delivery),
      connect: (env) => (envs.push(env), apnsSender(origin)),
    });
    expect(counts.sent).toBe(6);
    expect(envs.sort()).toEqual(['production', 'sandbox']);
    expect(stats.sessions).toBe(2);
    const kids = seen.map((s) => {
      const header = String(s.headers.authorization)
        .replace(/^bearer /, '')
        .split('.')[0]!;
      const kid = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')).kid as string;
      return [String(s.headers[':path']).slice(10, 12), kid];
    });
    expect(new Set(kids.map((k) => k.join(' ')))).toEqual(
      new Set(['a0 SANDBOX001', 'a1 PRODUCT001']),
    );
  });

  it('refuses to send in quiet hours at the place', async () => {
    const { origin, seen } = await fakeApns(apple({}));
    const store = new MemoryAlertStore();
    // 18:05 UTC on 1 December.
    const zones = [
      'Europe/London',
      'Asia/Tokyo',
      'America/New_York',
      'Asia/Kolkata',
      'Mars/Olympus_Mons',
    ];
    const records = zones.map((tz, i) => record(token('a0', i), { tz }));
    const lines: string[] = [];
    const { results } = await run(origin, {
      store,
      deliveries: records.map(delivery),
      log: (l) => lines.push(l),
    });
    // London 18:05, Tokyo 03:05, New York 13:05, Kolkata 23:35; an unknown zone reads as UTC,
    // 18:05, as the run's windows read it.
    expect(results.map((x) => x.outcome)).toEqual(['sent', 'quiet', 'sent', 'quiet', 'sent']);
    expect(devicesSeen(seen)).toEqual([token('a0', 0), token('a0', 2), token('a0', 4)]);
    expect(store.keys().filter((k) => k.startsWith('sent/'))).toHaveLength(3);
    expect(lines).toEqual([
      `alerts: error: refused snow.${records[1]!.id.slice(0, 8)}…: quiet hours in Asia/Tokyo`,
      `alerts: error: refused snow.${records[3]!.id.slice(0, 8)}…: quiet hours in Asia/Kolkata`,
    ]);

    // At 22:05 UTC the unknown zone is in its quiet hours by UTC's clock, and is refused.
    const late = record(token('a0', 5), { tz: 'Mars/Olympus_Mons' });
    const night = await run(origin, {
      store,
      deliveries: [delivery(late)],
      now: NOW + 4 * 60 * MINUTE,
      log: (l) => lines.push(l),
    });
    expect(night.results.map((x) => x.outcome)).toEqual(['quiet']);
    expect(lines.at(-1)).toBe(
      `alerts: error: refused snow.${late.id.slice(0, 8)}…: quiet hours in Mars/Olympus_Mons`,
    );
    expect(seen).toHaveLength(3);
  });

  it('in a dry run logs each notification instead: no claim, no token, no push', async () => {
    const { origin, seen } = await fakeApns(apple({}));
    const store = new MemoryAlertStore();
    const r = record(token('a0'));
    const lines: string[] = [];
    const { results } = await run(origin, {
      store,
      deliveries: [delivery(r)],
      keys: {},
      dryRun: true,
      log: (l) => lines.push(l),
    });
    expect(results[0]!.outcome).toBe('logged');
    expect(deliveryFinished('logged')).toBe(true);
    expect(lines).toEqual([
      `alerts: dry run: snow.${r.id.slice(0, 8)}… sandbox evening 2026-12-02: Snow likely in Durham tomorrow / 1 to 2cm of snow. Mostly between 2am and 6am. 5 of 6 forecasts expect snow.`,
    ]);
    expect(store.keys()).toEqual([]);
    expect(seen).toHaveLength(0);
  });

  it('starts no push after the deadline', async () => {
    const { origin } = await fakeApns(apple({}));
    const store = new MemoryAlertStore();
    const records = Array.from({ length: 5 }, (_, i) => record(token('a0', i)));
    let tick = 0;
    const { results } = await run(origin, {
      store,
      deliveries: records.map(delivery),
      apnsConcurrency: 1,
      deadline: 2,
      clock: () => tick++,
    });
    expect(results.map((x) => x.outcome)).toEqual([
      'sent',
      'sent',
      'deferred',
      'deferred',
      'deferred',
    ]);
    expect(store.keys().filter((k) => k.startsWith('sent/'))).toHaveLength(2);
  });

  it('never logs a device token, a provider token, a key, a full id or coordinates', async () => {
    const { origin } = await fakeApns(
      apple({
        b0: { status: 400, body: { reason: 'BadDeviceToken' } },
        f3: { status: 403, body: { reason: 'InvalidProviderToken' } },
        ee: 'hang',
      }),
    );
    const device = { query: 'lat=53.80&lon=-1.55&source=device', name: 'Your location' };
    const records = [
      record(token('b0'), device),
      record(token('a0'), { ...device, env: 'production' }),
      record(token('f3'), { ...device, env: 'production' }),
      record(token('ee'), { ...device, tz: 'Asia/Tokyo' }),
    ];
    const store = new SafeAlertStore(new MemoryAlertStore(), (e) => log(e.message));
    await seed(store, ...records);
    await run(origin, { store, deliveries: records.map(delivery) });
    await run(origin, { store, deliveries: records.map(delivery), dryRun: true });
  });

  afterAll(() => {
    // Every line the tests above logged, and every store error.
    expect(logged.length).toBeGreaterThan(10);
    const secrets = [
      ...[SANDBOX, PRODUCTION].map(({ key }) => key.pem.split('\n')[1]!.slice(0, 16)),
      providerToken(KEYS.sandbox, NOW).split('.')[0]!,
    ];
    for (const line of logged) {
      expect(line).not.toMatch(/[0-9a-f]{32}/i);
      expect(line).not.toMatch(/eyJ/);
      expect(line).not.toMatch(/53\.8|-1\.55|lat=|lon=/);
      for (const secret of secrets) expect(line).not.toContain(secret);
    }
  });
});
