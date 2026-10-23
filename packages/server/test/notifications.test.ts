/**
 * The notifications end to end: a registration made through the devices handlers is the one the
 * run reads and notifies, and the test endpoint and the run share Apple's provider token. Both
 * halves use one memory store, synthetic forecasts at a moving clock, and the in-process fake APNs.
 */
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http2';
import { createSyntheticFetch } from '@isithot/providers';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  CITIES,
  MemoryAlertStore,
  MemoryKV,
  apnsKey,
  apnsSender,
  handleDeviceDelete,
  handleDevicePut,
  handleDeviceTest,
  jwtKey,
  resolveServerConfig,
  runAlerts,
  sentKey,
  type ApnsKey,
  type DeviceResponse,
  type DevicesPlatform,
  type RunAlertsOptions,
  type ServerDeps,
} from '../src';
import { closeFakes, fakeApns, type FakeReply } from './fakeApns';

afterEach(closeFakes);

const MINUTE = 60_000;
/** 18:05 at the place on 11 November 2026 (London is on GMT): snow likely in Durham tomorrow. */
const SNOWY = Date.UTC(2026, 10, 11, 18, 5);

// A throwaway P-256 sandbox key, as Apple's .p8 is.
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PUBLIC = createPublicKey(privateKey);
const SETTINGS: Record<string, string> = {
  APNS_TEAM_ID: 'TEAM123456',
  APNS_KEY_ID_SANDBOX: 'SANDBOX001',
  APNS_KEY_SANDBOX: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  ALERTS_DRY_RUN: 'false',
};
const env = (name: string): string | undefined => SETTINGS[name];

const TOKENS: string[] = [];
/** A 64-hex device token of its own for each `n`. */
const token = (n: number): string => {
  const t = `ab${n.toString(16).padStart(6, '0')}${'d'.repeat(56)}`;
  TOKENS.push(t);
  return t;
};

/** Every line the handlers and the runs logged, for the check that nothing secret is in them. */
const logged: string[] = [];

const bearer = (headers: IncomingHttpHeaders): string =>
  String(headers.authorization).replace(/^bearer /, '');

/** Apple: a 200 for a push signed with the sandbox key, a 403 otherwise. */
const apple = (headers: IncomingHttpHeaders): FakeReply => {
  const [header, claims, signature] = bearer(headers).split('.');
  const ok = verify(
    'sha256',
    Buffer.from(`${header}.${claims}`),
    { key: PUBLIC, dsaEncoding: 'ieee-p1363' },
    Buffer.from(signature ?? '', 'base64url'),
  );
  return ok ? { status: 200 } : { status: 403, body: { reason: 'InvalidProviderToken' } };
};

/** The devices handlers and the run, side by side, as Netlify runs them. */
async function world() {
  const fake = await fakeApns(apple);
  let now = SNOWY;
  const deps: ServerDeps = {
    config: resolveServerConfig(() => undefined),
    // One forecast cache for both, as Blobs is in production.
    cache: new MemoryKV(),
    fetch: createSyntheticFetch(CITIES, () => new Date(now)),
    now: () => new Date(now),
    waitUntil: (p) => void p.catch(() => {}),
    log: (line) => logged.push(line),
    climateWaitMs: 0,
  };
  const store = new MemoryAlertStore();
  const platform: DevicesPlatform = {
    env,
    deployContext: 'production',
    deps,
    store,
    connect: () => apnsSender(fake.origin, 2000),
  };
  const key = apnsKey(env, 'sandbox') as ApnsKey;
  const call = (method: string, path: string, body: unknown): Request =>
    new Request(`https://willitsnow.today/api/v1/${path}`, {
      method,
      body: JSON.stringify(body),
    });
  return {
    fake,
    store,
    /** Moves the clock. */
    at(t: number): void {
      now = t;
    },
    async put(
      t: string,
      place: unknown,
      over: { units?: 'c' | 'f'; evening?: boolean; morning?: boolean } = {},
    ): Promise<DeviceResponse> {
      const { units = 'c', evening = true, morning = false } = over;
      const reply = await handleDevicePut(
        call('PUT', 'devices', {
          app: 'snow',
          platform: 'ios',
          env: 'sandbox',
          token: t,
          place,
          units,
          alerts: { snow: { evening, morning, possible: false } },
          appVersion: '1.0 (112)',
        }),
        platform,
      );
      expect(reply.status).toBe(200);
      return (await reply.json()) as DeviceResponse;
    },
    remove: (t: string) =>
      handleDeviceDelete(call('DELETE', 'devices', { app: 'snow', token: t }), platform),
    test: (t: string) =>
      handleDeviceTest(call('POST', 'devices/test', { app: 'snow', token: t }), platform),
    /** The scheduled run at `t`, sending for real to the fake. */
    run(t: number, over: Partial<RunAlertsOptions> = {}) {
      now = t;
      return runAlerts({
        deps,
        store,
        sender: () => apnsSender(fake.origin, 2000),
        keys: { sandbox: key },
        now: t,
        budgetMs: 20_000,
        dryRun: false,
        clock: () => 0,
        log: (line) => logged.push(line),
        ...over,
      });
    },
    /** The device each push went to, in order. */
    devices: () => fake.seen.map((s) => String(s.headers[':path']).split('/').pop()),
    payloads: () => fake.seen.map((s) => JSON.parse(s.body) as Record<string, unknown>),
  };
}

const registrations = (store: MemoryAlertStore) =>
  store.keys().filter((k) => k.startsWith('reg/') || k.startsWith('ids/'));

describe('a registration from PUT to the push', () => {
  it("is notified by the run at the place's 18:05, and a DELETE stops the next day's", async () => {
    const w = await world();
    const t = token(1);
    // The app registers in the afternoon.
    w.at(SNOWY - 35 * MINUTE);
    const reply = await w.put(t, { place: 'durham-gb' });
    expect(reply.place).toEqual({
      name: 'Durham',
      timezone: 'Europe/London',
      query: 'place=durham-gb',
    });

    const first = await w.run(SNOWY);
    expect(first).toMatchObject({
      zones: 1,
      records: 1,
      groups: 1,
      sent: 1,
      deleted: 0,
      errors: 0,
      done: 1,
      stopped: null,
    });
    expect(w.fake.seen).toHaveLength(1);
    const { headers, body } = w.fake.seen[0]!;
    expect(JSON.parse(body)).toEqual({
      aps: {
        alert: {
          title: 'Snow likely in Durham tomorrow',
          body: '1 to 2cm of snow. Mostly between 2am and 7am. 5 of 6 forecasts expect snow.',
        },
        sound: 'default',
        'thread-id': 'snow',
        'interruption-level': 'active',
        'relevance-score': 0.6,
      },
      topic: 'snow',
      kind: 'evening',
      date: '2026-11-12',
      view: 'today',
      place: 'place=durham-gb',
      name: 'Durham',
    });
    expect(headers).toMatchObject({
      ':path': `/3/device/${t}`,
      'apns-topic': 'today.willitsnow.app',
      'apns-push-type': 'alert',
      'apns-priority': '5',
      // 21:00 at the place.
      'apns-expiration': String(Date.UTC(2026, 10, 11, 21) / 1000),
      'apns-collapse-id': 'snow-evening-2026-11-12',
    });
    // The run read the handler's record as written: its id, zone, units and name.
    expect(first.notifications).toEqual([
      {
        app: 'snow',
        id: reply.id,
        tz: 'Europe/London',
        kind: 'evening',
        units: 'c',
        date: '2026-11-12',
        name: 'Durham',
        title: 'Snow likely in Durham tomorrow',
        body: '1 to 2cm of snow. Mostly between 2am and 7am. 5 of 6 forecasts expect snow.',
        forced: false,
        outcome: 'sent',
      },
    ]);
    // 18:20: once is enough.
    expect(await w.run(SNOWY + 15 * MINUTE)).toMatchObject({ zones: 0, sent: 0 });

    // The next morning the app deletes its registration; another device registers in Durham.
    w.at(SNOWY + 15 * 60 * MINUTE);
    expect((await w.remove(t)).status).toBe(204);
    expect(registrations(w.store)).toEqual([]);
    const other = token(2);
    const kept = await w.put(other, { place: 'durham-gb' });

    // The next evening both are forced, so either would get a notification whatever the forecast:
    // only the one still registered does.
    const next = await w.run(SNOWY + 24 * 60 * MINUTE, {
      forceIds: [reply.id.slice(0, 12), kept.id.slice(0, 12)],
    });
    expect(next).toMatchObject({ zones: 1, records: 1, sent: 1, forced: 1, errors: 0 });
    expect(w.devices()).toEqual([t, other]);
    expect(w.store.keys().filter((k) => k.startsWith('sent/v1/2026-11-12/'))).toEqual([
      sentKey('2026-11-12', 'snow', 'evening', 'snow', kept.id),
    ]);
  });

  it('carries every place form and both units through, as the handler canonicalised them', async () => {
    const w = await world();
    w.at(SNOWY - 60 * MINUTE);
    const city = token(10);
    const fahrenheit = token(11);
    const searched = token(12);
    const device = token(13);
    const leeds = token(14);
    const morningOnly = token(15);
    const replies = {
      [city]: await w.put(city, { place: 'durham-gb' }),
      [fahrenheit]: await w.put(fahrenheit, { place: 'durham-gb' }, { units: 'f' }),
      [searched]: await w.put(searched, {
        lat: 54.97,
        lon: -2.1,
        name: 'Hexham',
        region: 'England',
        country: 'GB',
        source: 'search',
      }),
      [device]: await w.put(device, { lat: 54.8, lon: -1.6, source: 'device' }),
    };
    // Leeds has no snow tomorrow; the morning-only device waits for 07:00.
    await w.put(leeds, { place: 'leeds-gb' });
    await w.put(morningOnly, { place: 'durham-gb' }, { evening: false, morning: true });

    const result = await w.run(SNOWY);
    expect(result).toMatchObject({ zones: 1, records: 6, groups: 5, sent: 4, errors: 0 });
    expect(w.devices().sort()).toEqual([city, fahrenheit, searched, device].sort());
    for (const [i, seen] of w.fake.seen.entries()) {
      const to = w.devices()[i]!;
      const { place } = replies[to]!;
      // The tap opens the place the app was told it registered, by its canonical query.
      expect(JSON.parse(seen.body)).toMatchObject({ place: place.query, name: place.name });
      expect(Buffer.byteLength(seen.body)).toBeLessThanOrEqual(1024);
    }
    const words = Object.fromEntries(
      w.fake.seen.map((s, i) => [
        w.devices()[i]!,
        (JSON.parse(s.body) as { aps: { alert: unknown } }).aps.alert,
      ]),
    );
    expect(replies[searched]!.place.query).toBe(
      'lat=54.95&lon=-2.1&name=Hexham&region=England&country=GB&source=search',
    );
    expect(replies[device]!.place).toEqual({
      name: 'Durham',
      timezone: 'Europe/London',
      query: 'lat=54.8&lon=-1.6&source=device',
    });
    expect(words[searched]).toMatchObject({ title: 'Snow likely in Hexham tomorrow' });
    expect(words[device]).toMatchObject({ title: 'Snow likely in Durham tomorrow' });
    expect(words[city]).toEqual({
      title: 'Snow likely in Durham tomorrow',
      body: '1 to 2cm of snow. Mostly between 2am and 7am. 5 of 6 forecasts expect snow.',
    });
    expect(words[fahrenheit]).toEqual({
      title: 'Snow likely in Durham tomorrow',
      body: 'About 0.5in of snow. Mostly between 2am and 7am. 5 of 6 forecasts expect snow.',
    });
  });

  it('follows a move to another zone: the run finds it only where it now is', async () => {
    const w = await world();
    const t = token(20);
    w.at(SNOWY - 60 * MINUTE);
    const before = await w.put(t, { place: 'durham-gb' });
    w.at(SNOWY - 50 * MINUTE);
    const after = await w.put(t, { place: 'new-york-city-us' });
    expect(after.id).toBe(before.id);
    // Synthetic forecasts give New York a fixed offset, five hours behind GMT.
    expect(after.place).toEqual({
      name: 'New York',
      timezone: 'Etc/GMT+5',
      query: 'place=new-york-city-us',
    });
    const forceIds = [after.id.slice(0, 12)];

    // 18:05 in London: nothing is registered there any more.
    expect(await w.run(SNOWY, { forceIds })).toMatchObject({ zones: 0, records: 0, sent: 0 });
    // 18:05 in New York (23:05 GMT).
    const there = await w.run(SNOWY + 5 * 60 * MINUTE, { forceIds });
    expect(there).toMatchObject({ zones: 1, records: 1, sent: 1, forced: 1, errors: 0 });
    expect(w.devices()).toEqual([t]);
    expect(w.payloads()[0]).toMatchObject({
      place: 'place=new-york-city-us',
      name: 'New York',
      kind: 'evening',
    });
  });
});

describe('the test endpoint and the run', () => {
  it("share Apple's provider token through the store, whichever makes it first", async () => {
    const w = await world();
    const a = token(30);
    const b = token(31);
    w.at(SNOWY - 30 * MINUTE);
    await w.put(a, { place: 'durham-gb' });
    await w.put(b, { place: 'durham-gb' });

    // The test makes the token at 17:40 and stores it.
    w.at(SNOWY - 25 * MINUTE);
    expect((await w.test(a)).status).toBe(202);
    const made = await w.store.get<{ jwt: string; iat: number }>(jwtKey('sandbox'));
    expect(made).toMatchObject({ iat: (SNOWY - 25 * MINUTE) / 1000 });

    // The run at 18:05 sends both evening notifications with it, and makes none of its own.
    expect(await w.run(SNOWY)).toMatchObject({ sent: 2, errors: 0 });
    // And a test after the run still uses it.
    w.at(SNOWY + 20 * MINUTE);
    expect((await w.test(b)).status).toBe(202);
    expect(w.fake.seen).toHaveLength(4);
    expect(w.fake.seen.map((s) => bearer(s.headers))).toEqual(Array(4).fill(made!.jwt));
    expect(await w.store.get(jwtKey('sandbox'))).toEqual(made);

    // The other way round: a run's token is a later test's.
    const v = await world();
    const c = token(32);
    v.at(SNOWY - 30 * MINUTE);
    await v.put(c, { place: 'durham-gb' });
    expect(await v.run(SNOWY)).toMatchObject({ sent: 1 });
    const runs = await v.store.get<{ jwt: string; iat: number }>(jwtKey('sandbox'));
    expect(runs).toMatchObject({ iat: SNOWY / 1000 });
    v.at(SNOWY + 30 * MINUTE);
    expect((await v.test(c)).status).toBe(202);
    expect(v.fake.seen.map((s) => bearer(s.headers))).toEqual([runs!.jwt, runs!.jwt]);
    expect(runs!.jwt).not.toBe(made!.jwt);
  });
});

afterAll(() => {
  expect(logged.length).toBeGreaterThan(10);
  for (const line of logged) {
    expect(line).not.toMatch(/[0-9a-f]{32}/i);
    expect(line).not.toMatch(/eyJ/);
    expect(line).not.toMatch(/place=|lat=|lon=|\d\.\d+,\s*-?\d/);
    for (const t of TOKENS) expect(line).not.toContain(t.slice(0, 16));
  }
});
