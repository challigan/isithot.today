import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ALERTS,
  ERROR_MESSAGES,
  collapseId,
  expiresAt,
  snowAlert,
  type TodayResponse,
} from '@isithot/core';
import {
  deviceTarget,
  herePlace,
  registrationBody,
  type HerePlace,
  type RegistrationBody,
} from '@isithot/client';
import {
  APNS_PAYLOAD_LIMIT,
  APNS_TOPICS,
  MemoryAlertStore,
  alertPush,
  idsKey,
  regKey,
  registrationId,
} from '@isithot/server';
import { APP_COPY } from '../src/appCopy';
import {
  DEVICE_FIXTURES,
  DEVICE_SETTINGS,
  DEVICE_TOKEN,
  PAYLOAD_FILES,
  deviceFixtureJson,
  makeDeviceFixture,
  payloadFiles,
  type DeviceFixture,
} from '../src/deviceFixtures';
import { FIXTURES, fixtureJson, makeFixture, type Fixture } from '../src/fixtures';

const spec = (name: string) => DEVICE_FIXTURES.find((s) => s.name === name)!;
const moment = (fixture: string) => FIXTURES.find((s) => s.name === fixture)!.now;

/** Every devices fixture, made once, as its file has it. */
const made = new Map<string, DeviceFixture>();
let durham: Fixture;
let payloads: Map<string, string>;
beforeAll(async () => {
  for (const s of DEVICE_FIXTURES) {
    made.set(s.name, JSON.parse(deviceFixtureJson(await makeDeviceFixture(s))));
  }
  durham = JSON.parse(
    fixtureJson(await makeFixture(FIXTURES.find((s) => s.name === 'durham-tomorrow')!)),
  );
  payloads = new Map(payloadFiles(durham).map((f) => [f.name, f.contents]));
});
const fixture = (name: string): DeviceFixture => made.get(name)!;
// The replies and payloads as their files have them: JSON, read loosely here, as the app will.
/* eslint-disable @typescript-eslint/no-explicit-any */
const body = (name: string): any => JSON.parse(fixture(name).text);

/** Each reply's status, the server's error code and its `Retry-After`. */
const TABLE: Record<string, [number, string | null, string | null]> = {
  'put-leeds': [200, null, null],
  'put-twice': [429, 'rate_limited', '50'],
  delete: [204, null, null],
  'test-sent': [202, null, null],
  'test-dryrun': [202, null, null],
  // 9:05am: 55 minutes to the next hour.
  'test-limited': [429, 'test_limited', String(55 * 60)],
  // 10pm: nine hours to 7am.
  'test-quiet': [409, 'quiet_hours', String(9 * 60 * 60)],
  'test-gone': [404, 'not_registered', null],
  'test-unregistered': [404, 'not_registered', null],
  'test-down': [503, 'push_unavailable', null],
  'rate-limited': [429, 'rate_limited', '60'],
  'put-here-ip': [200, null, null],
  'put-here-device': [200, null, null],
  'put-here-refresh': [200, null, null],
  'put-unlocated': [400, 'bad_location', null],
};

/**
 * 8.1's fixtures that 8.4 keeps, and never changes: their files' SHA-256, as 8.1 wrote them. Its
 * other version 1 PUTs (put-durham, put-device, put-kathmandu and put-bad-place) went in 8.4a.
 */
const AS_8_1_WROTE_THEM: Record<string, string> = {
  'put-leeds': 'aa2e4d3f5a0dabbc1c54df8ce94da3eca2996d9feb09eeea72e3b6f0dd6f2e3c',
  'put-twice': '269d541bedc0cd4c8d492bfe9420b04bf79580d974f862bfa6275daff975abb9',
  delete: 'b8da851e943d59103506998223a65121be16ab3787e3679f2f6ae062b8499d71',
  'test-sent': 'a557a65773ed955b17ef9027ce186e5ac99218660c993edaf328802a90d65765',
  'test-dryrun': '3c8771208763445485eb3d504aa211f91f3bea831817a2465a812268639deade',
  'test-limited': '20057b42bef3a042e61105bc5cf87546d492b73fe509fd533106ada7d73335e5',
  'test-quiet': '2a6af1840141c529535e4052eeb3bcb73c8e0c21a6905f166507b21ad9e8476c',
  'test-gone': 'e58cf86e092f1303661102ae2ca3a6b7bf9edb89c4cee409883881e49706c2ca',
  'test-unregistered': '61b76c90b802ead210ca3b56faebdef95b647f6d40c334216a9a5dbfe564932c',
  'test-down': '2369b6290171ff7ae075a26d565a746ccb925f3b40d9f66c6b95c4684c2f55d4',
  'rate-limited': '1d426b244f2fd5da9eb990954385e00a9dd67bb17132e2267937873740144ed2',
  'durham-evening.json': 'c934e62b5e0c4cbea418e23c5ae2618921ef7d5bd4784fbbdc92f3474bf3fb26',
  'durham-old.json': '92d56006e37c828e8c28f18e41b7f316636eb86da907bc32f09bee605349db97',
  'malformed.json': '6ab9e33c9270e572d201161f30fa5c1fb699d0c703430c9645fd7733723ad7b2',
  'evening.apns': 'b87c65a73e17c4989506a34e986f8a270584fc50fb99f6e41e398fd4702323f7',
};
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** 8.4's version 2 fixtures: each a whole set, where you are and no saved place. */
const SETS = ['put-here-ip', 'put-here-device', 'put-here-refresh', 'put-unlocated'];
const EVENING = { evening: true, morning: false, possible: false };
/** The cell Netlify's town for a connection in Leeds is, and the phone's own there. */
const LEEDS_CELL = 'lat=53.8&lon=-1.55&source=device';
const NOT_LOCATED =
  "We couldn't tell where you are from your internet connection. Try again later, or use your location.";

describe('devices fixtures', () => {
  it('names each file once, in the order they are written', () => {
    expect(DEVICE_FIXTURES.map((s) => s.name)).toEqual(Object.keys(TABLE));
  });

  it('each says what was asked, from where, when, and why, beside the reply as the server sent it', () => {
    for (const s of DEVICE_FIXTURES) {
      const f = fixture(s.name);
      expect(Object.keys(f), s.name).toEqual(['_fixture', 'status', 'retryAfter', 'text']);
      // Where Netlify placed the connection only when it did, so 8.1's files stay as they were.
      expect(Object.keys(f._fixture), s.name).toEqual(
        s.geo ? ['request', 'body', 'geo', 'now', 'note'] : ['request', 'body', 'now', 'note'],
      );
      expect(f._fixture, s.name).toEqual({
        request: s.request,
        body: s.body,
        ...(s.geo ? { geo: s.geo } : {}),
        now: s.now,
        note: s.note,
      });
      expect(s.note.length, s.name).toBeGreaterThan(0);
      expect(s.request, s.name).toMatch(
        /^(PUT|DELETE) \/api\/v1\/devices$|^POST \/api\/v1\/devices\/test$/,
      );
    }
  });

  it('answers each with the status, the code and the wait it is for', () => {
    for (const [name, [status, code, retryAfter]] of Object.entries(TABLE)) {
      const f = fixture(name);
      expect(f.status, name).toBe(status);
      expect(f.retryAfter, name).toBe(retryAfter);
      if (code) expect(body(name).error.code, name).toBe(code);
      else if (status === 204) expect(f.text, name).toBe('');
      else expect(body(name).error, name).toBeUndefined();
    }
  });

  it("one device, one set per fixture: where you are as 8.4's app sends it, and no saved place", () => {
    // One device, by a token no phone has.
    expect(DEVICE_TOKEN).toBe('0f'.repeat(32));
    for (const s of DEVICE_FIXTURES)
      expect((s.body as { token: string }).token, s.name).toBe(DEVICE_TOKEN);
    expect(body('put-leeds').id).toBe(registrationId('snow', DEVICE_TOKEN));
    expect(body('put-here-ip').id).toBe(registrationId('snow', DEVICE_TOKEN));
    for (const s of DEVICE_FIXTURES.filter((d) => d.request !== 'PUT /api/v1/devices')) {
      expect(s.body, s.name).toEqual({ app: 'snow', token: DEVICE_TOKEN });
    }
    // 8.1's one PUT left, version 1 as 8.1's builds send it (no `v`, one place), from the
    // sandbox, with the evening on: the registration the delete, the tests and the two 429s are
    // made after. No other version 1 body is left.
    expect(spec('put-leeds').body).toEqual({
      app: 'snow',
      platform: 'ios',
      env: 'sandbox',
      token: DEVICE_TOKEN,
      place: { place: 'leeds-gb' },
      units: 'c',
      alerts: { snow: EVENING },
      appVersion: '1.0 (42)',
    });
    for (const name of ['put-twice', 'rate-limited'])
      expect(spec(name).body, name).toEqual(spec('put-leeds').body);
    expect(
      DEVICE_FIXTURES.filter(
        (d) => d.request === 'PUT /api/v1/devices' && !SETS.includes(d.name),
      ).map((d) => d.name),
    ).toEqual(['put-leeds', 'put-twice', 'rate-limited']);
    expect(body('put-leeds').alerts).toEqual({ snow: EVENING });
    for (const s of DEVICE_FIXTURES.filter((d) => !SETS.includes(d.name))) {
      expect(s.geo, s.name).toBeUndefined();
      for (const before of s.before ?? []) expect(before.geo, s.name).toBeUndefined();
    }
    // 8.4's: each PUT one whole set.
    const sent = (here: HerePlace): RegistrationBody =>
      registrationBody({
        token: DEVICE_TOKEN,
        env: 'sandbox',
        here,
        units: 'c',
        prefs: EVENING,
        appVersion: '1.0 (42)',
      });
    // Without the phone's location: for the server to locate from the connection.
    const approximate = herePlace({ access: 'denied', fix: null, kept: null });
    expect(approximate).toEqual({ kind: 'ip' });
    expect(spec('put-here-ip').body).toEqual(sent(approximate));
    expect((spec('put-here-ip').body as RegistrationBody).here).toEqual({ source: 'ip' });
    // The phone's own location in Leeds, allowed, with a fix there.
    const leeds = herePlace({ access: 'granted', fix: deviceTarget(53.8, -1.55), kept: null });
    expect(spec('put-here-device').body).toEqual(sent(leeds));
    expect((spec('put-here-device').body as RegistrationBody).here).toEqual({
      lat: 53.8,
      lon: -1.55,
      source: 'device',
    });
    // The hourly refresh, and the set the server can't place, are the same set again.
    for (const name of ['put-here-refresh', 'put-unlocated'])
      expect(spec(name).body, name).toEqual(spec('put-here-ip').body);
    for (const name of SETS) {
      const b = spec(name).body as RegistrationBody;
      expect(b, name).toMatchObject({ v: 2, saved: [], alerts: { snow: EVENING } });
      expect(b, name).not.toHaveProperty('deviceTz');
    }
    for (const name of ['put-here-ip', 'put-here-device', 'put-here-refresh']) {
      expect(body(name).alerts, name).toEqual({ snow: EVENING });
    }
  });

  it('places the connection as Netlify does: in Leeds as ip-first-launch, then Newcastle, then in no town', () => {
    const ipFirst = FIXTURES.find((s) => s.name === 'ip-first-launch')!;
    expect(spec('put-here-ip').geo).toEqual(ipFirst.geo);
    expect(spec('put-here-ip').geo).toMatchObject({ city: 'Leeds', country: 'GB' });
    expect(spec('put-here-refresh').geo).toMatchObject({
      city: 'Newcastle upon Tyne',
      country: 'GB',
    });
    expect(spec('put-unlocated').geo).toEqual({ country: 'GB' });
    expect(spec('put-here-device').geo).toBeUndefined();
    // Each `before` as it was asked: put-here-ip's from Leeds, put-here-device's with no geo.
    expect(spec('put-here-refresh').before).toEqual([
      {
        request: 'PUT /api/v1/devices',
        body: spec('put-here-ip').body,
        geo: spec('put-here-ip').geo,
        now: moment('ip-first-launch'),
      },
    ]);
    expect(spec('put-unlocated').before).toEqual([
      {
        request: 'PUT /api/v1/devices',
        body: spec('put-here-device').body,
        now: moment('leeds-dry'),
      },
    ]);
  });

  it("names 8.1's place as the server does, at the moment of the answer the app shows", () => {
    expect(body('put-leeds').place).toEqual({
      name: 'Leeds',
      timezone: 'Europe/London',
      query: 'place=leeds-gb',
    });
    expect(spec('put-leeds').now).toBe(moment('leeds-dry'));
    expect(body('put-leeds').seenAt).toBe(spec('put-leeds').now);
    expect(Date.parse(spec('put-twice').now) - Date.parse(moment('leeds-dry'))).toBe(10_000);
  });

  it('names where you are as the server does: the cell, its zone, its country, what it follows', () => {
    const id = registrationId('snow', DEVICE_TOKEN);
    const leeds = { name: 'Leeds', timezone: 'Europe/London', query: LEEDS_CELL, country: 'GB' };
    // The whole set, as the app keeps it for Your privacy.
    expect(body('put-here-ip')).toEqual({
      id,
      deviceTz: null,
      here: { ...leeds, follows: 'ip' },
      saved: [],
      refused: [],
      alerts: { snow: EVENING },
      seenAt: moment('ip-first-launch'),
    });
    expect(Object.keys(body('put-here-ip'))).toEqual([
      'id',
      'deviceTz',
      'here',
      'saved',
      'refused',
      'alerts',
      'seenAt',
    ]);
    expect(body('put-here-device')).toEqual({
      ...body('put-here-ip'),
      here: { ...leeds, follows: 'device' },
      seenAt: moment('leeds-dry'),
    });
    // An hour later the connection is in Newcastle: the server locates it afresh, and names the
    // cell itself, as it does the phone's.
    expect(body('put-here-refresh')).toEqual({
      ...body('put-here-ip'),
      here: {
        name: 'Newcastle',
        timezone: 'Europe/London',
        query: 'lat=55&lon=-1.6&source=device',
        country: 'GB',
        follows: 'ip',
      },
      seenAt: spec('put-here-refresh').now,
    });
    expect(spec('put-here-ip').now).toBe(moment('ip-first-launch'));
    expect(spec('put-here-device').now).toBe(moment('leeds-dry'));
    expect(Date.parse(spec('put-here-refresh').now) - Date.parse(moment('ip-first-launch'))).toBe(
      ALERTS.hereRefreshMinutes * 60_000,
    );
    expect(Date.parse(spec('put-unlocated').now) - Date.parse(moment('leeds-dry'))).toBe(
      60 * 60_000,
    );
  });

  it("refuses where it can't place, in the server's words, after forgetting the whole set", async () => {
    expect(body('put-unlocated').error).toEqual({ code: 'bad_location', message: NOT_LOCATED });
    // put-here-device's registration is kept on its own; after put-unlocated's, nothing is,
    // the phone's location included.
    const kept = new MemoryAlertStore();
    await makeDeviceFixture(spec('put-here-device'), kept);
    const id = registrationId('snow', DEVICE_TOKEN);
    expect(kept.keys()).toEqual([idsKey('snow', id), regKey('Europe/London', 'snow', id)]);
    const forgotten = new MemoryAlertStore();
    await makeDeviceFixture(spec('put-unlocated'), forgotten);
    expect(forgotten.keys()).toEqual([]);
    // The hourly refresh moves where you are: one record, Newcastle's.
    const moved = new MemoryAlertStore();
    await makeDeviceFixture(spec('put-here-refresh'), moved);
    const records = moved.keys().filter((k) => k.startsWith('reg/'));
    expect(records).toHaveLength(1);
    expect(await moved.get(records[0]!)).toMatchObject({
      query: 'lat=55&lon=-1.6&source=device',
      follows: 'ip',
      locatedAt: spec('put-here-refresh').now,
    });
  });

  it("is 8.1's fixtures it keeps exactly as 8.1 wrote them, and adds 8.4's after them", () => {
    const names = DEVICE_FIXTURES.map((s) => s.name);
    const kept = Object.keys(AS_8_1_WROTE_THEM).filter((n) => !n.includes('.'));
    expect(names.slice(0, kept.length)).toEqual(kept);
    expect(names.slice(kept.length)).toEqual(SETS);
    for (const [name, hash] of Object.entries(AS_8_1_WROTE_THEM)) {
      const text = name.includes('.') ? payloads.get(name)! : deviceFixtureJson(fixture(name));
      expect(sha256(text), name).toBe(hash);
    }
  });

  it("refuses a second write in a minute, in the server's words", () => {
    expect(body('put-twice').error.message).toBe(
      'One change a minute for each device. Try again shortly.',
    );
  });

  it('says whether a test was sent, or only logged in the dry run', () => {
    expect(body('test-sent')).toEqual({ sent: true });
    expect(body('test-dryrun')).toEqual({ sent: false, dryRun: true });
    expect(spec('test-dryrun').dryRun).toBe(true);
    for (const s of DEVICE_FIXTURES)
      if (s.name !== 'test-dryrun') expect(s.dryRun, s.name).toBeUndefined();
  });

  it("refuses the test in the server's words: the hour's three, the quiet hours, Apple", () => {
    expect(body('test-limited').error.message).toBe(
      `That's ${ALERTS.testPerHour} test notifications this hour. Try again later.`,
    );
    expect(spec('test-limited').before).toHaveLength(1 + ALERTS.testPerHour);
    expect(body('test-quiet').error.message).toBe(APP_COPY.testQuiet);
    expect(spec('test-quiet').now).toBe('2026-12-01T22:00:00.000Z');
    expect(body('test-gone').error.message).toBe(
      'Apple refused this device, so it is no longer registered.',
    );
    expect(spec('test-gone').apple).toEqual({ status: 400, reason: 'BadDeviceToken' });
    expect(body('test-unregistered').error.message).toBe(
      "This device isn't registered for notifications.",
    );
    expect(spec('test-unregistered').before).toBeUndefined();
    expect(spec('test-down').apple).toEqual({ status: 503, reason: 'ServiceUnavailable' });
    expect(body('rate-limited').error.message).toBe(ERROR_MESSAGES.rate_limited);
    expect(spec('rate-limited').limited).toBe(true);
  });

  it('holds no part of the APNs key, nor any provider token', () => {
    const values = Object.values(DEVICE_SETTINGS).filter((v) => v.length > 5);
    expect(values.some((v) => v.includes('PRIVATE KEY'))).toBe(true);
    for (const [name, f] of made) {
      const text = deviceFixtureJson(f);
      for (const value of values) expect(text.includes(value), name).toBe(false);
      for (const line of DEVICE_SETTINGS.APNS_KEY_SANDBOX!.split('\n').filter(
        (l) => l.length > 20,
      )) {
        expect(text.includes(line), name).toBe(false);
      }
      expect(text, name).not.toMatch(/PRIVATE KEY|bearer|eyJ/);
    }
  });

  it('is the same reply every time it is made', async () => {
    for (const s of DEVICE_FIXTURES) {
      expect(deviceFixtureJson(await makeDeviceFixture(s)), s.name).toBe(
        deviceFixtureJson(fixture(s.name)),
      );
    }
  });

  it('fails loudly when a request before the one it is for does not succeed', async () => {
    const bad = { ...spec('put-unlocated') };
    await expect(makeDeviceFixture({ ...spec('test-sent'), before: [bad] })).rejects.toThrow(
      /^test-sent: PUT \/api\/v1\/devices was answered 400: .*bad_location/,
    );
  });
});

describe('notification payloads', () => {
  const payload = (name: string): any => JSON.parse(payloads.get(name)!);
  const SNOW_APP_ID = /^SNOW_APP_ID = (\S+)$/m.exec(
    readFileSync(new URL('../../../apps/ios/Configs/Snow.xcconfig', import.meta.url), 'utf8'),
  )?.[1];

  it('writes the three payloads and the simulator’s file, in that order', () => {
    expect(PAYLOAD_FILES).toEqual([
      'durham-evening.json',
      'durham-old.json',
      'malformed.json',
      'evening.apns',
    ]);
    expect(payloadFiles(durham).map((f) => f.name)).toEqual(PAYLOAD_FILES);
    for (const contents of payloads.values()) {
      expect(contents.endsWith('}\n')).toBe(true);
      expect(contents).toBe(`${JSON.stringify(JSON.parse(contents), null, 2)}\n`);
    }
  });

  it("is the server's evening push for Durham, made from durham-tomorrow's answer", () => {
    const record = { app: 'snow', token: DEVICE_TOKEN, query: 'place=durham-gb', name: 'Durham' };
    const alert = snowAlert(
      (durham as TodayResponse).snow!,
      'evening',
      { evening: true, morning: false, possible: false },
      'Durham',
    )!;
    const tz = durham.location.timezone;
    const { payload: pushed } = alertPush({
      record,
      alert,
      topic: 'snow',
      kind: 'evening',
      date: alert.date,
      collapseId: collapseId('snow', 'evening', alert.date),
      expiration: expiresAt(tz, 'evening', durham.snow!.days[0]!.date),
      priority: ALERTS.apnsPriority.evening,
    });
    expect(payload('durham-evening.json')).toEqual(pushed);
    // The day the answer is about, tomorrow at 6:05pm on the 16th.
    expect(pushed.date).toBe('2026-12-17');
    expect(pushed.date).toBe(durham.snow!.days[1]!.date);
    // A tap opens the place durham-tomorrow is about, Durham's city page, under its name: the
    // query and name the server stores for a city page, as put-leeds's reply has Leeds's.
    expect(durham.location).toMatchObject({ slug: 'durham-gb', name: 'Durham' });
    expect(pushed).toMatchObject({
      place: `place=${durham.location.slug}`,
      name: durham.location.name,
    });
    expect(body('put-leeds').place).toMatchObject({ query: 'place=leeds-gb', name: 'Leeds' });
  });

  it('has one long past and one not a date, each otherwise the same', () => {
    const evening = payload('durham-evening.json');
    expect(payload('durham-old.json')).toEqual({ ...evening, date: '2026-12-10' });
    expect(payload('malformed.json')).toEqual({ ...evening, date: '2026-02-30' });
    expect(Object.keys(payload('durham-old.json'))).toEqual(Object.keys(evening));
  });

  it("gives the simulator the app's bundle ID first, within Apple's limit, in snow's words", () => {
    const apns = payload('evening.apns');
    expect(SNOW_APP_ID).toBeDefined();
    expect(Object.keys(apns)[0]).toBe('Simulator Target Bundle');
    expect(apns['Simulator Target Bundle']).toBe(SNOW_APP_ID);
    expect(apns['Simulator Target Bundle']).toBe(APNS_TOPICS.snow);
    const { 'Simulator Target Bundle': _, ...rest } = apns;
    expect(rest).toEqual(payload('durham-evening.json'));
    expect(Buffer.byteLength(payloads.get('evening.apns')!)).toBeLessThanOrEqual(
      APNS_PAYLOAD_LIMIT,
    );
    expect(APNS_PAYLOAD_LIMIT).toBe(4096);
    // The copy rules' patterns (copy.test.ts): snow only, and never "alert", "warning" or "danger".
    const { title, body: words } = apns.aps.alert as { title: string; body: string };
    for (const text of [title, words]) {
      expect(text).not.toMatch(/alert|warning|danger/i);
      expect(text).not.toMatch(
        /\b(websites?|isithot|isitwet|isitwindy|hot|wet|wind|windy|rain|rainy|android)\b/i,
      );
    }
    expect(title).toMatch(/Durham/);
  });
});

describe('deviceFixtureJson', () => {
  it('writes two-space JSON in the given key order, then a newline', () => {
    expect(deviceFixtureJson({ b: 1, a: { c: null } })).toBe(
      '{\n  "b": 1,\n  "a": {\n    "c": null\n  }\n}\n',
    );
  });
});
