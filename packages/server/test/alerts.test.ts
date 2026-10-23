import { createPublicKey, generateKeyPairSync, verify, type KeyObject } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http2';
import { alertWindows, inQuietHours, type AlertKind } from '@isithot/core';
import { createSyntheticFetch, type FetchLike } from '@isithot/providers';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  CITIES,
  MemoryAlertStore,
  MemoryKV,
  PUSH_GRACE_MS,
  alertsDryRun,
  alertsRun,
  apnsSender,
  cleanupKey,
  doneKey,
  forceIdsFrom,
  idsKey,
  judgedKey,
  jwtKey,
  providerToken,
  regKey,
  registrationId,
  resolveServerConfig,
  runAlerts,
  runSummary,
  sentKey,
  type AlertRecord,
  type AlertStore,
  type ApnsEnv,
  type ApnsKey,
  type KV,
  type RunAlertsOptions,
  type ServerDeps,
} from '../src';
import { closeFakes, fakeApns, type FakeReply } from './fakeApns';

afterEach(closeFakes);

// Throwaway P-256 keys, one per environment, as Apple's .p8 files are.
const makeKey = (keyId: string): { key: ApnsKey; publicKey: KeyObject; pem: string } => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  return {
    key: { teamId: 'TEAM123456', keyId, pem },
    publicKey: createPublicKey(privateKey),
    pem,
  };
};
const SANDBOX = makeKey('SANDBOX001');
const PRODUCTION = makeKey('PRODUCT001');
const KEYS: Record<ApnsEnv, ApnsKey> = { sandbox: SANDBOX.key, production: PRODUCTION.key };
const PUBLIC: Record<string, KeyObject> = {
  [SANDBOX.key.keyId]: SANDBOX.publicKey,
  [PRODUCTION.key.keyId]: PRODUCTION.publicKey,
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** 18:05 BST on 18 October 2026: synthetic data has snow likely in Durham tomorrow. */
const EVENING = '2026-10-18T17:05:00Z';
const LATER = '2026-10-18T17:20:00Z';
const DURHAM = {
  title: 'Snow likely in Durham tomorrow',
  body: '1 to 2cm of snow. Mostly between 2am and 6am. 5 of 6 forecasts expect snow.',
};
const CREATED = '2026-10-01T09:00:00.000Z';

/** A 64-hex device token whose first two characters tell the fake how to answer. */
const token = (script: string, n = 0): string =>
  `${script}${n.toString(16).padStart(4, '0')}${'c'.repeat(58)}`;

/** A registration as the devices handler writes it. */
function registration(device: string, over: Partial<AlertRecord> = {}): AlertRecord {
  return {
    v: 1,
    id: registrationId('snow', device),
    app: 'snow',
    platform: 'ios',
    env: 'sandbox',
    token: device,
    query: 'place=durham-gb',
    name: 'Durham',
    tz: 'Europe/London',
    units: 'c',
    alerts: { snow: { evening: true, morning: true, possible: false } },
    createdAt: CREATED,
    updatedAt: CREATED,
    seenAt: '2026-10-17T08:00:00.000Z',
    appVersion: '1.0 (7)',
    ...over,
  };
}

/** City pages in the UK, as registrations: none has snow at EVENING. */
const place = (slug: string): Pick<AlertRecord, 'query' | 'name'> => ({
  query: `place=${slug}`,
  name: CITIES.find((c) => c.slug === slug)!.name,
});
const DRY = ['london-gb', 'leeds-gb', 'york-gb', 'manchester-gb', 'bristol-gb', 'oxford-gb'];

async function seed(store: AlertStore, ...records: AlertRecord[]): Promise<void> {
  for (const r of records) {
    await store.set(regKey(r.tz, r.app, r.id), r);
    await store.set(idsKey(r.app, r.id), { tz: r.tz });
  }
}

/** `getToday`'s dependencies at a fixed moment, on synthetic forecasts. */
function depsAt(at: number, cache: KV = new MemoryKV(5000), fetch?: FetchLike): ServerDeps {
  const now = () => new Date(at);
  return {
    config: resolveServerConfig(() => undefined),
    cache,
    fetch: fetch ?? createSyntheticFetch(CITIES, now),
    now,
    waitUntil: (p) => void p.catch(() => {}),
    log: () => {},
  };
}

/** Every line logged in this file, for the check that nothing secret is in any of them. */
const logged: string[] = [];

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
function apple(script: Record<string, FakeReply | (() => FakeReply)> = {}) {
  return (headers: IncomingHttpHeaders): FakeReply => {
    if (!signed(String(headers.authorization).replace(/^bearer /, ''))) {
      return { status: 403, body: { reason: 'InvalidProviderToken' } };
    }
    const device = String(headers[':path']).split('/').pop()!;
    const reply = script[device.slice(0, 2)] ?? { status: 200 };
    return typeof reply === 'function' ? reply() : reply;
  };
}

const devices = (seen: { headers: IncomingHttpHeaders }[]) =>
  seen.map((s) => String(s.headers[':path']).split('/').pop()).sort();

type RunAt = Partial<RunAlertsOptions> & {
  store: AlertStore;
  origin: string;
  cache?: KV;
  fetch?: FetchLike;
  lines?: string[];
};

/** One run at `iso` against the fake; every line it logs also goes to `logged`. */
function runAt(iso: string, { store, origin, cache, fetch, lines, ...over }: RunAt) {
  const at = Date.parse(iso);
  return runAlerts({
    deps: depsAt(at, cache, fetch),
    store,
    sender: () => apnsSender(origin, 2000),
    keys: KEYS,
    now: at,
    budgetMs: 20_000,
    dryRun: false,
    clock: () => 0,
    ...over,
    log: (line) => {
      logged.push(line);
      lines?.push(line);
    },
  });
}

const sentKeys = (store: MemoryAlertStore) => store.keys().filter((k) => k.startsWith('sent/'));

type Op = 'get' | 'set' | 'list' | 'delete';

/**
 * A store as one run sees it: `before(op, key)` may hold a call until what it returns resolves, and
 * `after(op, key)` hears of each call that has landed.
 */
function view(
  inner: AlertStore,
  hooks: {
    before?: (op: Op, key: string) => Promise<unknown> | undefined;
    after?: (op: Op, key: string) => void;
  },
): AlertStore {
  const call = async <T>(op: Op, key: string, run: () => Promise<T>): Promise<T> => {
    await hooks.before?.(op, key);
    const out = await run();
    hooks.after?.(op, key);
    return out;
  };
  return {
    get: <T>(key: string) => call('get', key, () => inner.get<T>(key)),
    set: (key, value, options) => call('set', key, () => inner.set(key, value, options)),
    list: (prefix, options) => call('list', prefix, () => inner.list(prefix, options)),
    delete: (key) => call('delete', key, () => inner.delete(key)),
  };
}

describe('runAlerts: the evening', () => {
  it('sends once at 18:05 and not again at 18:20, with the payload and headers of section 8.5', async () => {
    const { origin, seen } = await fakeApns(apple());
    const store = new MemoryAlertStore();
    const durham = registration(token('a0'));
    const london = registration(token('a0', 1), place('london-gb'));
    await seed(store, durham, london);
    const lines: string[] = [];

    const first = await runAt(EVENING, { store, origin, lines });
    expect(first).toMatchObject({
      zones: 1,
      records: 2,
      groups: 2,
      fetches: 2,
      sent: 1,
      deleted: 0,
      errors: 0,
      done: 1,
      stopped: null,
      cleaned: null,
    });
    expect(lines).toEqual([]);
    expect(runSummary(first)).toBe(
      'alerts-run: zones 1, records 2, groups 2, fetches 2, sent 1, deleted 0, errors 0; 0 ms',
    );
    expect(seen).toHaveLength(1);
    expect(JSON.parse(seen[0]!.body)).toEqual({
      aps: {
        alert: DURHAM,
        sound: 'default',
        'thread-id': 'snow',
        'interruption-level': 'active',
        'relevance-score': 0.6,
      },
      topic: 'snow',
      kind: 'evening',
      date: '2026-10-19',
      view: 'today',
      place: 'place=durham-gb',
      name: 'Durham',
    });
    expect(seen[0]!.headers).toMatchObject({
      ':path': `/3/device/${durham.token}`,
      'apns-topic': 'today.willitsnow.app',
      'apns-push-type': 'alert',
      'apns-priority': '5',
      // 21:00 BST.
      'apns-expiration': String(Date.UTC(2026, 9, 18, 20) / 1000),
      'apns-collapse-id': 'snow-evening-2026-10-19',
    });
    expect(sentKeys(store)).toEqual([sentKey('2026-10-18', 'snow', 'evening', 'snow', durham.id)]);
    expect(await store.get(doneKey('2026-10-18', 'evening', 'Europe/London'))).toEqual({
      at: new Date(EVENING).toISOString(),
      count: 2,
    });

    // 18:20: the zone is done for the evening.
    const second = await runAt(LATER, { store, origin, lines });
    expect(second).toMatchObject({ zones: 0, records: 0, groups: 0, sent: 0 });
    expect(seen).toHaveLength(1);

    // Without the marker, the claim still stops a second notification, unread.
    await store.delete(doneKey('2026-10-18', 'evening', 'Europe/London'));
    const third = await runAt(LATER, { store, origin, lines });
    expect(third).toMatchObject({ zones: 1, records: 1, groups: 1, sent: 0, done: 1 });
    expect(seen).toHaveLength(1);
    expect(lines).toEqual([]);
  });

  it('sends each notification once when two runs overlap', async () => {
    const { origin, seen } = await fakeApns(apple(), { delayMs: 20 });
    const store = new MemoryAlertStore();
    const records = [0, 1, 2].map((n) => registration(token('a0', n)));
    await seed(store, ...records);
    const [a, b] = await Promise.all([
      runAt(EVENING, { store, origin }),
      runAt(EVENING, { store, origin }),
    ]);
    expect(devices(seen)).toEqual(records.map((r) => r.token).sort());
    expect(a.sent + b.sent).toBe(3);
    const outcomes = [...a.notifications, ...b.notifications].map((n) => n.outcome).sort();
    expect(outcomes).toEqual(['sent', 'sent', 'sent', 'taken', 'taken', 'taken']);
  });

  /** Apple keeps the first push waiting and then cannot take it; it takes every later one. */
  const slowThen503 = () => {
    let answers = 0;
    return fakeApns(
      apple({
        '53': () =>
          answers++ === 0
            ? { status: 503, body: { reason: 'ServiceUnavailable' } }
            : { status: 200 },
      }),
      { delayMs: 100 },
    );
  };
  const DONE = doneKey('2026-10-18', 'evening', 'Europe/London');

  it('sends what one of two overlapping runs claimed and then released, which the other found taken', async () => {
    const { origin, seen } = await slowThen503();
    const store = new MemoryAlertStore();
    await seed(store, registration(token('53')));
    const [a, b] = await Promise.all([
      runAt(EVENING, { store, origin }),
      runAt(EVENING, { store, origin }),
    ]);
    const outcomes = [...a.notifications, ...b.notifications].map((n) => n.outcome).sort();
    expect(outcomes).toEqual(['released', 'taken']);
    // The run that found it taken marked the zone done; the release took the marker back.
    expect(a.done + b.done).toBe(1);
    expect(await store.get(DONE)).toBeNull();
    const next = await runAt(LATER, { store, origin });
    expect(next).toMatchObject({ zones: 1, records: 1, sent: 1, done: 1 });
    expect(seen).toHaveLength(2);
  });

  it.each([
    ['before the release, which takes the marker back', false],
    ['after the release, and takes its marker back itself', true],
  ])(
    'sends what a run claimed and then released, when a run that skipped it marked the zone done %s',
    async (_when, late) => {
      const { origin, seen } = await slowThen503();
      const store = new MemoryAlertStore();
      await seed(store, registration(token('53')));
      let claimed!: () => void;
      const claim = new Promise<void>((resolve) => {
        claimed = resolve;
      });
      const a = runAt(EVENING, {
        store: view(store, {
          after: (op, key) => {
            if (op === 'set' && key.startsWith('sent/')) claimed();
          },
        }),
        origin,
      });
      // B starts while A holds the claim and waits for Apple, so it skips the registration unread.
      await claim;
      const b = await runAt(EVENING, {
        store: late
          ? view(store, { before: (op, key) => (op === 'set' && key === DONE ? a : undefined) })
          : store,
        origin,
      });
      const first = await a;
      expect(first.notifications.map((n) => n.outcome)).toEqual(['released']);
      expect(b).toMatchObject({ zones: 1, records: 0, done: late ? 0 : 1 });
      expect(await store.get(DONE)).toBeNull();
      const next = await runAt(LATER, { store, origin });
      expect(next).toMatchObject({ zones: 1, records: 1, sent: 1, done: 1 });
      expect(seen).toHaveLength(2);
    },
  );

  it('reads °F as the page does, and fetches a place once for both units', async () => {
    const { origin, seen } = await fakeApns(apple());
    const store = new MemoryAlertStore();
    const c = registration(token('a0'));
    const f = registration(token('a0', 1), { units: 'f' });
    await seed(store, c, f);
    const result = await runAt(EVENING, { store, origin });
    expect(result).toMatchObject({ groups: 2, fetches: 1, sent: 2 });
    const bodies = Object.fromEntries(
      seen.map((s) => [
        String(s.headers[':path']).split('/').pop(),
        JSON.parse(s.body).aps.alert.body as string,
      ]),
    );
    expect(bodies).toEqual({
      [c.token]: DURHAM.body,
      [f.token]: 'About 0.5in of snow. Mostly between 2am and 6am. 5 of 6 forecasts expect snow.',
    });
  });

  it('sends "Snow possible" only to those who asked, and nothing with the switch off', async () => {
    const { origin, seen } = await fakeApns(apple());
    const store = new MemoryAlertStore();
    const asked = registration(token('a0'), {
      ...place('kendal-gb'),
      alerts: { snow: { evening: true, morning: false, possible: true } },
    });
    const notAsked = registration(token('a0', 1), place('kendal-gb'));
    const eveningOff = registration(token('a0', 2), {
      alerts: { snow: { evening: false, morning: true, possible: true } },
    });
    await seed(store, asked, notAsked, eveningOff);
    const result = await runAt(EVENING, { store, origin });
    expect(devices(seen)).toEqual([asked.token]);
    expect(result.notifications.map((n) => n.title)).toEqual(['Snow possible in Kendal tomorrow']);
    expect(JSON.parse(seen[0]!.body).aps['relevance-score']).toBe(0.3);
    // The switched-off record is read but not judged; the zone is still finished.
    expect(result).toMatchObject({ records: 3, groups: 1, done: 1 });
  });
});

describe('runAlerts: the morning', () => {
  it('says "Snowing in Leeds now" while it snows, at priority 10 until 11:00', async () => {
    const { origin, seen } = await fakeApns(apple());
    const store = new MemoryAlertStore();
    const leeds = registration(token('a0'), {
      ...place('leeds-gb'),
      seenAt: '2026-11-20T08:00:00.000Z',
    });
    const morningOff = registration(token('a0', 1), {
      ...place('leeds-gb'),
      alerts: { snow: { evening: true, morning: false, possible: false } },
    });
    await seed(store, leeds, morningOff);
    const result = await runAt('2026-11-24T07:05:00Z', { store, origin });
    expect(result).toMatchObject({ zones: 1, records: 2, groups: 1, sent: 1, done: 1 });
    expect(devices(seen)).toEqual([leeds.token]);
    const payload = JSON.parse(seen[0]!.body);
    expect(payload.aps.alert).toEqual({
      title: 'Snowing in Leeds now',
      body: 'About 1cm still to come. Easing off by about 9am. 6 of 6 forecasts expect snow.',
    });
    expect(payload).toMatchObject({ kind: 'morning', date: '2026-11-24', place: 'place=leeds-gb' });
    expect(seen[0]!.headers).toMatchObject({
      'apns-priority': '10',
      'apns-expiration': String(Date.UTC(2026, 10, 24, 11) / 1000),
      'apns-collapse-id': 'snow-morning-2026-11-24',
    });
  });

  it('says "Snow likely in Armagh today" when snow is still to come', async () => {
    const { origin, seen } = await fakeApns(apple());
    const store = new MemoryAlertStore();
    const armagh = registration(token('a0'), place('armagh-gb'));
    await seed(store, armagh);
    await runAt('2026-11-09T07:05:00Z', { store, origin });
    expect(JSON.parse(seen[0]!.body).aps.alert).toEqual({
      title: 'Snow likely in Armagh today',
      body: 'A dusting still to come. Most likely around 7am. 5 of 6 forecasts expect snow.',
    });
  });
});

describe('runAlerts: the windows', () => {
  /** Whether a forced registration in `tz` is due, and sent, at each moment, from a fresh store. */
  async function dueAt(tz: string, query: string, moments: string[]) {
    const { origin } = await fakeApns(apple());
    const out: [string, number, number][] = [];
    for (const iso of moments) {
      const store = new MemoryAlertStore();
      const r = registration(token('a0'), { tz, query, name: 'Here' });
      await seed(store, r);
      const result = await runAt(iso, { store, origin, forceIds: [r.id.slice(0, 8)] });
      out.push([iso, result.zones, result.sent]);
    }
    return out;
  }

  it("opens Kathmandu's at 12:15 and 01:15 UTC (UTC+5:45)", async () => {
    const query = 'lat=27.70&lon=85.30&name=Kathmandu&country=NP&source=search';
    expect(
      await dueAt('Asia/Kathmandu', query, [
        '2026-12-01T12:00:00Z',
        '2026-12-01T12:15:00Z',
        '2026-12-01T14:00:00Z',
        '2026-12-01T14:15:00Z',
        '2026-12-01T01:00:00Z',
        '2026-12-01T01:15:00Z',
        '2026-12-01T03:00:00Z',
        '2026-12-01T03:15:00Z',
      ]),
    ).toEqual([
      ['2026-12-01T12:00:00Z', 0, 0],
      ['2026-12-01T12:15:00Z', 1, 1],
      ['2026-12-01T14:00:00Z', 1, 1],
      ['2026-12-01T14:15:00Z', 0, 0],
      ['2026-12-01T01:00:00Z', 0, 0],
      ['2026-12-01T01:15:00Z', 1, 1],
      ['2026-12-01T03:00:00Z', 1, 1],
      ['2026-12-01T03:15:00Z', 0, 0],
    ]);
  });

  it("opens Adelaide's at 07:30 and 20:30 UTC in summer (UTC+10:30)", async () => {
    const query = 'lat=-34.95&lon=138.60&name=Adelaide&country=AU&source=search';
    expect(
      await dueAt('Australia/Adelaide', query, [
        '2026-12-01T07:15:00Z',
        '2026-12-01T07:30:00Z',
        '2026-12-01T09:15:00Z',
        '2026-12-01T09:30:00Z',
        '2026-12-01T20:15:00Z',
        '2026-12-01T20:30:00Z',
        '2026-12-01T22:15:00Z',
        '2026-12-01T22:30:00Z',
      ]),
    ).toEqual([
      ['2026-12-01T07:15:00Z', 0, 0],
      ['2026-12-01T07:30:00Z', 1, 1],
      ['2026-12-01T09:15:00Z', 1, 1],
      ['2026-12-01T09:30:00Z', 0, 0],
      ['2026-12-01T20:15:00Z', 0, 0],
      ['2026-12-01T20:30:00Z', 1, 1],
      ['2026-12-01T22:15:00Z', 1, 1],
      ['2026-12-01T22:30:00Z', 0, 0],
    ]);
  });

  it('never sends from 21:00 to 06:59 at the place, and sends each window once a day', async () => {
    const { origin, seen } = await fakeApns(apple());
    const store = new MemoryAlertStore();
    const cache = new MemoryKV(5000);
    const places: [string, string][] = [
      ['Europe/London', 'place=durham-gb'],
      ['America/New_York', 'place=new-york-city-us'],
      ['Asia/Kathmandu', 'lat=27.70&lon=85.30&name=Kathmandu&country=NP&source=search'],
      ['Australia/Adelaide', 'lat=-34.95&lon=138.60&name=Adelaide&country=AU&source=search'],
      ['Pacific/Kiritimati', 'lat=1.85&lon=-157.40&name=Kiritimati&country=KI&source=search'],
    ];
    const records = places.map(([tz, query], i) =>
      registration(token('a0', i), { tz, query, name: 'Here', seenAt: '2026-11-30T08:00:00Z' }),
    );
    await seed(store, ...records);
    const tzOf = new Map(records.map((r) => [r.token, r.tz]));
    const pushes: { tz: string; at: number; kind: AlertKind }[] = [];
    const start = Date.parse('2026-12-01T00:00:00Z');
    for (let at = start; at < start + 2 * DAY; at += 15 * MINUTE) {
      const before = seen.length;
      await runAt(new Date(at).toISOString(), {
        store,
        origin,
        cache,
        forceIds: records.map((r) => r.id),
      });
      for (const s of seen.slice(before)) {
        const device = String(s.headers[':path']).split('/').pop()!;
        pushes.push({ tz: tzOf.get(device)!, at, kind: JSON.parse(s.body).kind });
      }
    }
    // Every zone, both windows, both days (less a window that opened before the first run).
    expect(pushes.length).toBeGreaterThanOrEqual(places.length * 3);
    const once = new Set<string>();
    for (const { tz, at, kind } of pushes) {
      const clock = alertWindows(tz, new Date(at));
      expect(inQuietHours(tz, new Date(at)), `${tz} ${new Date(at).toISOString()}`).toBe(false);
      expect(clock.kind).toBe(kind);
      // The first run in the window sends it (New York's evening is open at the very first).
      if (at > start) expect(alertWindows(tz, new Date(at - 15 * MINUTE)).kind).not.toBe(kind);
      const day = `${tz} ${clock.date} ${kind}`;
      expect(once.has(day), day).toBe(false);
      once.add(day);
    }
    for (const [tz] of places) expect(pushes.filter((p) => p.tz === tz).length).toBeGreaterThan(2);
  }, 60_000);
});

describe('runAlerts: Apple refusals', () => {
  it('deletes on 410, but keeps a record that registered again since', async () => {
    const refused = Date.parse('2026-10-18T12:00:00Z');
    const { origin, seen } = await fakeApns(
      apple({ '41': { status: 410, body: { reason: 'Unregistered', timestamp: refused } } }),
    );
    const store = new MemoryAlertStore();
    const gone = registration(token('41'));
    const back = registration(token('41', 1), { updatedAt: '2026-10-18T15:00:00.000Z' });
    await seed(store, gone, back);
    const lines: string[] = [];
    const result = await runAt(EVENING, { store, origin, lines });
    expect(seen).toHaveLength(2);
    expect(result).toMatchObject({ sent: 0, deleted: 1, errors: 0, done: 1 });
    expect(await store.get(regKey(gone.tz, 'snow', gone.id))).toBeNull();
    expect(await store.get(idsKey('snow', gone.id))).toBeNull();
    expect(await store.get(regKey(back.tz, 'snow', back.id))).not.toBeNull();
    expect(lines.sort()).toEqual(
      [
        `alerts: deleted snow.${gone.id.slice(0, 8)}… (410 Unregistered, sandbox, app 1.0 (7))`,
        `alerts: kept snow.${back.id.slice(0, 8)}… (410 Unregistered): it registered again since`,
      ].sort(),
    );
  });

  it('releases the claim on a 503, and the next run sends', async () => {
    let answers = 0;
    const { origin, seen } = await fakeApns(
      apple({
        '53': () =>
          answers++ === 0
            ? { status: 503, body: { reason: 'ServiceUnavailable' } }
            : { status: 200 },
      }),
    );
    const store = new MemoryAlertStore();
    const r = registration(token('53'));
    await seed(store, r);
    const first = await runAt(EVENING, { store, origin });
    expect(first).toMatchObject({ sent: 0, errors: 1, done: 0 });
    expect(runSummary(first)).toContain('1 zone left for the next run;');
    expect(sentKeys(store)).toEqual([]);
    const second = await runAt(LATER, { store, origin });
    expect(second).toMatchObject({ zones: 1, sent: 1, errors: 0, done: 1 });
    expect(seen).toHaveLength(2);
    expect(sentKeys(store)).toHaveLength(1);
  });

  it('never deletes on a 403: it drops the token, releases the claim and retries', async () => {
    let refuse = true;
    const { origin, seen } = await fakeApns(
      apple({
        f3: () =>
          refuse ? { status: 403, body: { reason: 'InvalidProviderToken' } } : { status: 200 },
      }),
    );
    const store = new MemoryAlertStore();
    const r = registration(token('f3'));
    await seed(store, r);
    for (const iso of [EVENING, LATER]) {
      const result = await runAt(iso, { store, origin });
      expect(result).toMatchObject({ sent: 0, deleted: 0, done: 0 });
      expect(await store.get(regKey(r.tz, 'snow', r.id))).not.toBeNull();
      expect(await store.get(jwtKey('sandbox'))).toBeNull();
      expect(sentKeys(store)).toEqual([]);
    }
    refuse = false;
    const third = await runAt('2026-10-18T17:35:00Z', { store, origin });
    expect(third).toMatchObject({ sent: 1, done: 1 });
    expect(seen).toHaveLength(3);
  });
});

describe('runAlerts: limits', () => {
  /** Six forced registrations at six different UK places, in one zone. */
  async function sixPlaces(store: AlertStore) {
    const records = DRY.map((slug, i) => registration(token('a0', i), place(slug)));
    await seed(store, ...records);
    return { records, forceIds: records.map((r) => r.id.slice(0, 12)) };
  }

  it('starts no group after the budget, and the next run finishes the zone', async () => {
    const { origin, seen } = await fakeApns(apple());
    const store = new MemoryAlertStore();
    const { forceIds } = await sixPlaces(store);
    // Each forecast fetched takes a second; the budget is a second and a half.
    let t = 0;
    const at = Date.parse(EVENING);
    const synthetic = createSyntheticFetch(CITIES, () => new Date(at));
    const slow: FetchLike = (url, init) => {
      if (url.includes('/forecast')) t += 1000;
      return synthetic(url, init);
    };
    const first = await runAt(EVENING, {
      store,
      origin,
      forceIds,
      fetch: slow,
      budgetMs: 1500,
      clock: () => t,
    });
    // The four workers start a group each before any second has passed, then stop.
    expect(first).toMatchObject({ zones: 1, groups: 4, sent: 4, done: 0, stopped: 'budget' });
    expect(runSummary(first)).toBe(
      'alerts-run: zones 1, records 6, groups 4, fetches 4, sent 4, deleted 0, errors 0; ' +
        '4 forced; 1 zone left for the next run (out of time); 4000 ms',
    );
    const second = await runAt(LATER, { store, origin, forceIds });
    expect(second).toMatchObject({ zones: 1, records: 2, groups: 2, sent: 2, done: 1 });
    expect(seen).toHaveLength(6);
    expect((await runAt('2026-10-18T17:35:00Z', { store, origin, forceIds })).zones).toBe(0);
  });

  it('starts no group past the forecast-fetch cap, and later runs carry on', async () => {
    const { origin, seen } = await fakeApns(apple());
    const store = new MemoryAlertStore();
    const cache = new MemoryKV(5000);
    const { forceIds } = await sixPlaces(store);
    const runs = [];
    for (const iso of [EVENING, LATER, '2026-10-18T17:35:00Z', '2026-10-18T17:50:00Z']) {
      runs.push(await runAt(iso, { store, origin, cache, forceIds, maxFetches: 2 }));
    }
    expect(runs.map((r) => [r.groups, r.fetches, r.sent, r.done, r.stopped])).toEqual([
      [2, 2, 2, 0, 'fetches'],
      [2, 2, 2, 0, 'fetches'],
      [2, 2, 2, 1, null],
      [0, 0, 0, 0, null],
    ]);
    expect(runSummary(runs[0]!)).toContain('1 zone left for the next run (fetch cap 2)');
    expect(seen).toHaveLength(6);
  });

  it('judges each registration once a window, so a zone past the cap still finishes in it', async () => {
    const { origin, seen } = await fakeApns(apple());
    const store = new MemoryAlertStore();
    const cache = new MemoryKV(5000);
    // More places with no snow than four runs at the cap can judge in the hour the forecast cache
    // keeps a forecast, and Durham, where snow is likely, read last.
    const slugs = [...DRY, 'liverpool-gb', 'nottingham-gb', 'sheffield-gb', 'glasgow-gb'];
    const dry = slugs.map((slug, i) => registration(token('a0', i), place(slug)));
    const highest = dry.map((r) => r.id).sort()[dry.length - 1]!;
    let n = dry.length;
    let durham = registration(token('a0', n));
    while (durham.id < highest) durham = registration(token('a0', ++n));
    await seed(store, ...dry, durham);
    const runs = [];
    // Every run of the evening window, 18:05 to 19:50.
    for (let k = 0; k < 8; k++) {
      const iso = new Date(Date.parse(EVENING) + k * 15 * MINUTE).toISOString();
      runs.push(await runAt(iso, { store, origin, cache, maxFetches: 2 }));
    }
    expect(runs.map((r) => [r.zones, r.records, r.groups, r.sent, r.done])).toEqual([
      [1, 11, 2, 0, 0],
      [1, 9, 2, 0, 0],
      [1, 7, 2, 0, 0],
      [1, 5, 2, 0, 0],
      [1, 3, 2, 0, 0],
      [1, 1, 1, 1, 1],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ]);
    expect(devices(seen)).toEqual([durham.token]);
    expect(store.keys().filter((k) => k.startsWith('judged/'))).toEqual(
      dry.map((r) => judgedKey('2026-10-18', 'snow', 'evening', 'snow', r.id)).sort(),
    );
  });

  it('logs each notification once a window in a dry run, though the cap leaves the zone for later', async () => {
    const { origin, seen } = await fakeApns(apple());
    const store = new MemoryAlertStore();
    const cache = new MemoryKV(5000);
    const { forceIds } = await sixPlaces(store);
    const lines: string[] = [];
    const runs = [];
    for (const iso of [EVENING, LATER, '2026-10-18T17:35:00Z', '2026-10-18T17:50:00Z']) {
      runs.push(
        await runAt(iso, { store, origin, cache, forceIds, maxFetches: 2, dryRun: true, lines }),
      );
    }
    expect(runs.map((r) => [r.records, r.logged, r.done])).toEqual([
      [6, 2, 0],
      [4, 2, 0],
      [2, 2, 1],
      [0, 0, 0],
    ]);
    const logs = lines.filter((l) => l.startsWith('alerts: dry run:'));
    expect(new Set(logs).size).toBe(6);
    expect(logs).toHaveLength(6);
    expect(seen).toHaveLength(0);
    expect(sentKeys(store)).toEqual([]);
  });

  it('allows 60 fetches a run on the free API and 300 with a key', async () => {
    const store = new MemoryAlertStore();
    const at = Date.parse(EVENING);
    const base = { store, sender: () => apnsSender('http://localhost:9', 10), keys: {} };
    const free = await runAlerts({ ...base, deps: depsAt(at), budgetMs: 1000, dryRun: true });
    const paid = await runAlerts({
      ...base,
      deps: { ...depsAt(at), config: resolveServerConfig(() => 'key') },
      budgetMs: 1000,
      dryRun: true,
    });
    expect([free.maxFetches, paid.maxFetches]).toEqual([60, 300]);
  });

  it('deletes a registration not seen for 90 days, whatever its switches', async () => {
    const { origin, seen } = await fakeApns(apple());
    const store = new MemoryAlertStore();
    const at = Date.parse(EVENING);
    const iso = (ms: number) => new Date(ms).toISOString();
    const stale = registration(token('a0'), { seenAt: iso(at - 91 * DAY) });
    const staleOff = registration(token('a0', 1), {
      seenAt: iso(at - 91 * DAY),
      alerts: { snow: { evening: false, morning: true, possible: false } },
    });
    const recent = registration(token('a0', 2), { seenAt: iso(at - 89 * DAY) });
    await seed(store, stale, staleOff, recent);
    const lines: string[] = [];
    const result = await runAt(EVENING, { store, origin, lines });
    expect(result).toMatchObject({ records: 3, sent: 1, deleted: 2, errors: 0, done: 1 });
    expect(devices(seen)).toEqual([recent.token]);
    for (const r of [stale, staleOff]) {
      expect(await store.get(regKey(r.tz, 'snow', r.id))).toBeNull();
      expect(await store.get(idsKey('snow', r.id))).toBeNull();
    }
    expect(lines.sort()).toEqual(
      [stale, staleOff]
        .map((r) => `alerts-run: deleted snow.${r.id.slice(0, 8)}… (not seen for 90 days)`)
        .sort(),
    );
  });
});

describe('runAlerts: ALERTS_FORCE_IDS', () => {
  it('sends the forced the real notification, or else the test one, once a window', async () => {
    const { origin, seen } = await fakeApns(apple());
    const store = new MemoryAlertStore();
    const snowy = registration(token('a0'));
    const dry = registration(token('a0', 1), place('london-gb'));
    const unforced = registration(token('a0', 2), place('leeds-gb'));
    const switchedOff = registration(token('a0', 3), {
      ...place('york-gb'),
      alerts: { snow: { evening: false, morning: true, possible: false } },
    });
    await seed(store, snowy, dry, unforced, switchedOff);
    const forceIds = [snowy, dry, switchedOff].map((r) => r.id.slice(0, 8).toUpperCase());
    const first = await runAt(EVENING, { store, origin, forceIds });
    expect(first).toMatchObject({ sent: 2, forced: 2, done: 1 });
    expect(devices(seen)).toEqual([snowy.token, dry.token].sort());
    const byDevice = new Map(
      seen.map((s) => [String(s.headers[':path']).split('/').pop(), JSON.parse(s.body)]),
    );
    expect(byDevice.get(snowy.token).aps.alert).toEqual(DURHAM);
    expect(byDevice.get(dry.token)).toMatchObject({
      aps: {
        alert: {
          title: 'Test notification',
          body: "Notifications are working. We'll tell you when snow is likely in London.",
        },
        'relevance-score': 0.3,
      },
      kind: 'evening',
      date: '2026-10-19',
      place: 'place=london-gb',
      name: 'London',
    });
    expect(runSummary(first)).toContain('; 2 forced;');
    // Once a window: nothing more at 18:20, even without the zone's marker.
    await store.delete(doneKey('2026-10-18', 'evening', 'Europe/London'));
    expect((await runAt(LATER, { store, origin, forceIds })).sent).toBe(0);
    expect(seen).toHaveLength(2);
  });

  it('reads the setting as 8 to 32 hex characters a prefix', () => {
    expect(forceIdsFrom(undefined)).toEqual({ ids: [], ignored: 0 });
    expect(forceIdsFrom(' 3F9C1A2B, abcdef0123456789 ,,')).toEqual({
      ids: ['3f9c1a2b', 'abcdef0123456789'],
      ignored: 0,
    });
    // Too short would force many registrations at once; too long or not hex is a typo.
    expect(forceIdsFrom('3f9c,xyz12345,3f9c1a2b')).toEqual({ ids: ['3f9c1a2b'], ignored: 2 });
    expect(forceIdsFrom('a'.repeat(33))).toEqual({ ids: [], ignored: 1 });
  });
});

describe('runAlerts: the dry run', () => {
  it('logs each notification instead: nothing sent, nothing claimed', async () => {
    const { origin, seen } = await fakeApns(apple());
    const store = new MemoryAlertStore();
    const r = registration(token('a0'));
    await seed(store, r);
    const lines: string[] = [];
    const result = await runAt(EVENING, { store, origin, lines, dryRun: true });
    expect(result).toMatchObject({ sent: 0, logged: 1, done: 1 });
    expect(seen).toHaveLength(0);
    expect(sentKeys(store)).toEqual([]);
    expect(await store.get(jwtKey('sandbox'))).toBeNull();
    expect(lines).toEqual([
      `alerts: dry run: snow.${r.id.slice(0, 8)}… sandbox evening 2026-10-19: ${DURHAM.title} / ${DURHAM.body}`,
    ]);
    expect(runSummary(result)).toBe(
      'alerts-run: zones 1, records 1, groups 1, fetches 1, sent 0, deleted 0, errors 0; dry run, 1 logged; 0 ms',
    );
    // The zone's marker is written, so each notification is logged once a window.
    expect((await runAt(LATER, { store, origin, dryRun: true })).logged).toBe(0);
  });
});

describe('runAlerts: the cleanup', () => {
  const id = registrationId('snow', token('a0'));
  const KEYS_BY_DATE = (date: string) => [
    sentKey(date, 'snow', 'evening', 'snow', id),
    sentKey(date, 'snow', 'morning', 'snow', id),
    judgedKey(date, 'snow', 'evening', 'snow', id),
    judgedKey(date, 'snow', 'morning', 'snow', id),
    doneKey(date, 'evening', 'Europe/London'),
    doneKey(date, 'morning', 'Pacific/Kiritimati'),
    `test/v1/${id}/${date}T10.1`,
  ];
  const DATES = ['2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01'];

  async function oldKeys(store: AlertStore) {
    for (const date of DATES) for (const key of KEYS_BY_DATE(date)) await store.set(key, {});
  }

  it('deletes sent/, judged/, done/ and test/ keys over 2 days old, in the first run after 03:00 UTC', async () => {
    const { origin } = await fakeApns(apple());
    const store = new MemoryAlertStore();
    await oldKeys(store);
    // Not before 03:00.
    expect((await runAt('2026-12-01T02:45:00Z', { store, origin })).cleaned).toBeNull();
    const first = await runAt('2026-12-01T03:00:00Z', { store, origin });
    expect(first.cleaned).toBe(14);
    expect(runSummary(first)).toContain('; cleanup deleted 14 old keys;');
    expect(store.keys()).toEqual(
      [
        ...['2026-11-29', '2026-11-30', '2026-12-01'].flatMap(KEYS_BY_DATE),
        cleanupKey('2026-12-01'),
      ].sort(),
    );
    // Once a day.
    await store.set(sentKey('2026-11-20', 'snow', 'evening', 'snow', id), {});
    expect((await runAt('2026-12-01T03:15:00Z', { store, origin })).cleaned).toBeNull();
    expect(await store.get(sentKey('2026-11-20', 'snow', 'evening', 'snow', id))).not.toBeNull();
  });

  it('lets the next run in the hour carry on with a cleanup cut short', async () => {
    const { origin } = await fakeApns(apple());
    const store = new MemoryAlertStore();
    await oldKeys(store);
    // Out of time at once.
    const cut = await runAt('2026-12-01T03:00:00Z', { store, origin, budgetMs: -PUSH_GRACE_MS });
    expect(cut.cleaned).toBe(0);
    expect(await store.get(cleanupKey('2026-12-01'))).toBeNull();
    const next = await runAt('2026-12-01T03:15:00Z', { store, origin });
    expect(next.cleaned).toBe(14);
    expect(await store.get(cleanupKey('2026-12-01'))).not.toBeNull();
  });
});

/** A memory store whose calls fail when `fails(op, key)` says so. */
class Flaky extends MemoryAlertStore {
  constructor(private readonly fails: (op: string, key: string) => boolean) {
    super();
  }

  private check(op: string, key: string): void {
    if (this.fails(op, key)) throw new Error(`${op} failed`);
  }

  override async get<T>(key: string): Promise<T | null> {
    this.check('get', key);
    return super.get<T>(key);
  }

  override async set(
    key: string,
    value: unknown,
    options?: { onlyIfNew?: boolean },
  ): Promise<boolean> {
    this.check('set', key);
    return super.set(key, value, options);
  }

  override async list(prefix: string, options?: { directories?: boolean }) {
    this.check('list', prefix);
    return super.list(prefix, options);
  }

  override async delete(key: string): Promise<void> {
    this.check('delete', key);
    return super.delete(key);
  }
}
const flaky = (fails: (op: string, key: string) => boolean) => new Flaky(fails);

describe('runAlerts: failures', () => {
  it('stops at once when the zones cannot be listed, and says so', async () => {
    const { origin, seen } = await fakeApns(apple());
    const store = flaky((op, key) => op === 'list' && key === 'reg/v1/');
    await seed(store, registration(token('a0')));
    const lines: string[] = [];
    const result = await runAt(EVENING, { store, origin, lines });
    expect(result).toMatchObject({ zones: 0, errors: 1 });
    expect(lines).toEqual(['alerts-run: error: list failed']);
    expect(seen).toHaveLength(0);
  });

  it('leaves alone a zone whose done markers or claims cannot be listed', async () => {
    const { origin, seen } = await fakeApns(apple());
    for (const prefix of ['done/v1/', 'sent/v1/']) {
      const store = flaky((op, key) => op === 'list' && key.startsWith(prefix));
      await seed(store, registration(token('a0')));
      const result = await runAt(EVENING, { store, origin });
      expect(result).toMatchObject({ zones: 1, records: 0, sent: 0, done: 0, errors: 1 });
    }
    expect(seen).toHaveLength(0);
  });

  it('sends the rest when one record cannot be read, and finishes the zone next run', async () => {
    const { origin, seen } = await fakeApns(apple());
    const unread = registration(token('a0'));
    const read = registration(token('a0', 1));
    let failing = true;
    const store = flaky(
      (op, key) => failing && op === 'get' && key === regKey(unread.tz, 'snow', unread.id),
    );
    await seed(store, unread, read);
    const first = await runAt(EVENING, { store, origin });
    expect(first).toMatchObject({ records: 1, sent: 1, done: 0, errors: 1 });
    failing = false;
    const second = await runAt(LATER, { store, origin });
    expect(second).toMatchObject({ records: 1, sent: 1, done: 1, errors: 0 });
    expect(devices(seen)).toEqual([unread.token, read.token].sort());
  });

  it('sends nothing on a claim the store did not confirm', async () => {
    const { origin, seen } = await fakeApns(apple());
    const store = flaky((op, key) => op === 'set' && key.startsWith('sent/'));
    await seed(store, registration(token('a0')));
    const result = await runAt(EVENING, { store, origin });
    expect(result).toMatchObject({ sent: 0, done: 0, errors: 1 });
    expect(result.notifications.map((n) => n.outcome)).toEqual(['deferred']);
    expect(seen).toHaveLength(0);
  });

  it('retries a forecast that failed, but not a place that no longer exists', async () => {
    const { origin, seen } = await fakeApns(apple());
    const store = new MemoryAlertStore();
    const durham = registration(token('a0'));
    const gone = registration(token('a0', 1), { query: 'place=atlantis-gb', name: 'Atlantis' });
    await seed(store, durham, gone);
    const at = Date.parse(EVENING);
    const synthetic = createSyntheticFetch(CITIES, () => new Date(at));
    let down = true;
    const fetch: FetchLike = (url, init) =>
      down && url.includes('/forecast')
        ? Promise.reject(new Error('fetch failed'))
        : synthetic(url, init);
    const lines: string[] = [];
    const first = await runAt(EVENING, { store, origin, fetch, lines });
    expect(first).toMatchObject({ groups: 2, sent: 0, done: 0, errors: 2 });
    expect(lines.filter((l) => l.startsWith('alerts-run: error:')).sort()).toEqual(
      [
        `alerts-run: error: no forecast for snow.${durham.id.slice(0, 8)}…: 503 upstream_unavailable (open-meteo: network error: Error: fetch failed (2 attempts))`,
        `alerts-run: error: no forecast for snow.${gone.id.slice(0, 8)}…: 404 not_found, so none today`,
      ].sort(),
    );
    down = false;
    const second = await runAt(LATER, { store, origin, fetch });
    expect(second).toMatchObject({ groups: 2, sent: 1, done: 1, errors: 1 });
    expect(devices(seen)).toEqual([durham.token]);
  });

  it('skips a record it cannot read, and says so', async () => {
    const { origin } = await fakeApns(apple());
    const store = new MemoryAlertStore();
    const r = registration(token('a0'));
    await store.set(regKey(r.tz, 'snow', r.id), { ...r, token: 'not hex' });
    const lines: string[] = [];
    const result = await runAt(EVENING, { store, origin, lines });
    expect(result).toMatchObject({ records: 1, groups: 0, errors: 1, done: 1 });
    expect(lines).toEqual([
      `alerts-run: error: snow.${r.id.slice(0, 8)}… in Europe/London is not a registration the run can read`,
    ]);
  });
});

describe('alertsRun: the switches', () => {
  const ENV: Record<string, string> = {
    APNS_TEAM_ID: 'TEAM123456',
    APNS_KEY_ID_SANDBOX: SANDBOX.key.keyId,
    APNS_KEY_SANDBOX: SANDBOX.pem,
    APNS_KEY_ID_PRODUCTION: PRODUCTION.key.keyId,
    APNS_KEY_PRODUCTION: PRODUCTION.pem,
    ALERTS_ENABLED: 'true',
  };
  const at = Date.parse(EVENING);

  async function scheduled(deployContext: string, vars: Record<string, string>) {
    const { origin, seen } = await fakeApns(apple());
    const store = new MemoryAlertStore();
    const r = registration(token('a0'), { env: 'production' });
    await seed(store, r);
    const lines: string[] = [];
    const line = await alertsRun({
      env: (name) => vars[name],
      deployContext,
      now: at,
      origin,
      store,
      deps: depsAt(at),
      clock: () => 0,
      log: (l) => {
        logged.push(l);
        lines.push(l);
      },
    });
    logged.push(line);
    return { line, lines, seen, store, r };
  }

  it('logs one line a run in production, and sends once ALERTS_DRY_RUN is false', async () => {
    const run = await scheduled('production', { ...ENV, ALERTS_DRY_RUN: ' False ' });
    expect(run.line).toBe(
      'alerts-run: zones 1, records 1, groups 1, fetches 1, sent 1, deleted 0, errors 0; 0 ms',
    );
    expect(run.lines).toEqual([]);
    expect(devices(run.seen)).toEqual([run.r.token]);
    // With the production key.
    const jwt = String(run.seen[0]!.headers.authorization).replace(/^bearer /, '');
    expect(JSON.parse(Buffer.from(jwt.split('.')[0]!, 'base64url').toString()).kid).toBe(
      PRODUCTION.key.keyId,
    );
  });

  it('is a dry run in production until ALERTS_DRY_RUN is false', async () => {
    for (const setting of [undefined, 'true', 'no']) {
      const vars = setting === undefined ? ENV : { ...ENV, ALERTS_DRY_RUN: setting };
      const run = await scheduled('production', vars);
      expect(run.line).toContain('; dry run, 1 logged;');
      expect(run.seen).toHaveLength(0);
    }
  });

  it('is always a dry run elsewhere, and says it ignored ALERTS_DRY_RUN', async () => {
    for (const context of ['deploy-preview', 'branch-deploy', 'dev']) {
      const run = await scheduled(context, { ...ENV, ALERTS_DRY_RUN: 'false' });
      expect(run.line).toContain('; dry run, 1 logged;');
      expect(run.lines[0]).toBe(
        `alerts-run: ALERTS_DRY_RUN is ignored on ${context}: only production sends`,
      );
      expect(run.seen).toHaveLength(0);
      expect(sentKeys(run.store)).toEqual([]);
    }
  });

  it('reads ALERTS_DRY_RUN by one rule for the run and the test endpoint', () => {
    const dry = (context: string | undefined, setting: string | undefined, by: 'run' | 'test') =>
      alertsDryRun((name) => (name === 'ALERTS_DRY_RUN' ? setting : undefined), context, by);
    for (const context of ['production', 'deploy-preview', 'branch-deploy', 'dev', undefined]) {
      // Nothing is sent unless it is false, in any context and by either sender.
      for (const setting of [undefined, '', 'true', 'TRUE', 'no', '0']) {
        expect(dry(context, setting, 'run')).toBe(true);
        expect(dry(context, setting, 'test')).toBe(true);
      }
      // A test follows false everywhere; the run sends only in production.
      for (const setting of ['false', ' False ', 'FALSE']) {
        expect(dry(context, setting, 'test')).toBe(false);
        expect(dry(context, setting, 'run')).toBe(context !== 'production');
      }
    }
  });

  it('forces the ids in ALERTS_FORCE_IDS, and counts an entry it cannot use', async () => {
    const r = registration(token('a0'), { env: 'production' });
    const run = await scheduled('production', {
      ...ENV,
      ALERTS_DRY_RUN: 'false',
      ALERTS_FORCE_IDS: `${r.id.slice(0, 10)},nope`,
    });
    expect(run.line).toBe(
      'alerts-run: zones 1, records 1, groups 1, fetches 1, sent 1, deleted 0, errors 1; 1 forced; 0 ms',
    );
    expect(run.lines).toEqual([
      'alerts-run: error: ALERTS_FORCE_IDS: ignored 1 entry that is not 8 to 32 hex characters',
    ]);
  });

  it('says which key is broken, without quoting it, and defers its pushes', async () => {
    const run = await scheduled('production', {
      ...ENV,
      ALERTS_DRY_RUN: 'false',
      APNS_KEY_PRODUCTION: 'oops',
    });
    expect(run.lines[0]).toMatch(/^alerts-run: error: the production key: not a \.p8 key/);
    expect(run.lines[1]).toBe(
      'alerts: error: no production provider token (no production key): 1 deferred',
    );
    expect(run.line).toContain('sent 0, deleted 0, errors 2; 1 zone left for the next run;');
    expect(run.seen).toHaveLength(0);
  });

  it('runs with ALERTS_SMOKE unset or not 1 on a preview, and smokes only with 1', async () => {
    const run = await scheduled('deploy-preview', { ...ENV, ALERTS_SMOKE: '0' });
    expect(run.line).toContain('; dry run, 1 logged;');
    const smoke = await scheduled('deploy-preview', { ...ENV, ALERTS_SMOKE: '1' });
    // The smoke push alone, to the made-up device: the fake takes it, so the smoke "fails".
    expect(smoke.line).toMatch(/^alerts-run: smoke failed: 200: Apple answered/);
    expect(smoke.seen).toHaveLength(1);
    expect(sentKeys(smoke.store)).toEqual([]);
  });
});

afterAll(() => {
  // Every line the tests above logged.
  expect(logged.length).toBeGreaterThan(20);
  const secrets = [
    ...[SANDBOX, PRODUCTION].map(({ pem }) => pem.split('\n')[1]!.slice(0, 16)),
    providerToken(KEYS.sandbox, Date.parse(EVENING)).split('.')[0]!,
    token('a0').slice(0, 20),
  ];
  for (const line of logged) {
    expect(line).not.toMatch(/[0-9a-f]{32}/i);
    expect(line).not.toMatch(/eyJ/);
    expect(line).not.toMatch(/place=|lat=|lon=|\d\.\d+,\s*-?\d/);
    for (const secret of secrets) expect(line).not.toContain(secret);
  }
});
