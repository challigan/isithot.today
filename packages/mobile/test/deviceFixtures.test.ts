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
import { registrationBody, type RegistrationBody } from '@isithot/client';
import { APNS_PAYLOAD_LIMIT, APNS_TOPICS, alertPush, registrationId } from '@isithot/server';
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
  'put-durham': [200, null, null],
  'put-device': [200, null, null],
  'put-kathmandu': [200, null, null],
  'put-bad-place': [400, 'bad_location', null],
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
};

describe('devices fixtures', () => {
  it('names each file once, in the order they are written', () => {
    expect(DEVICE_FIXTURES.map((s) => s.name)).toEqual(Object.keys(TABLE));
  });

  it('each says what was asked, when, and why, beside the reply as the server sent it', () => {
    for (const s of DEVICE_FIXTURES) {
      const f = fixture(s.name);
      expect(Object.keys(f), s.name).toEqual(['_fixture', 'status', 'retryAfter', 'text']);
      expect(f._fixture, s.name).toEqual({
        request: s.request,
        body: s.body,
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

  it('registers one device, by a token no phone has', () => {
    expect(DEVICE_TOKEN).toBe('0f'.repeat(32));
    for (const s of DEVICE_FIXTURES)
      expect((s.body as { token: string }).token, s.name).toBe(DEVICE_TOKEN);
    expect(body('put-leeds').id).toBe(registrationId('snow', DEVICE_TOKEN));
  });

  it('puts each place as the app sends it, from the sandbox, with the evening switched on', () => {
    const evening = { evening: true, morning: false, possible: false };
    const put = (name: string, place: Parameters<typeof registrationBody>[0]['place']) =>
      expect(spec(name).body, name).toEqual(
        registrationBody({
          token: DEVICE_TOKEN,
          env: 'sandbox',
          place,
          units: 'c',
          prefs: evening,
          appVersion: '1.0 (42)',
        }),
      );
    put('put-leeds', { kind: 'city', slug: 'leeds-gb' });
    put('put-durham', { kind: 'city', slug: 'durham-gb' });
    put('put-device', { kind: 'coords', source: 'device', lat: 53.8, lon: -1.55 });
    put('put-kathmandu', {
      kind: 'coords',
      source: 'search',
      lat: 27.7,
      lon: 85.3,
      name: 'Kathmandu',
      country: 'NP',
    });
    expect((spec('put-bad-place').body as RegistrationBody).place).toEqual({ place: 'nowhere-xx' });
    for (const name of ['put-twice', 'rate-limited'])
      expect(spec(name).body).toEqual(spec('put-leeds').body);
    for (const s of DEVICE_FIXTURES.filter((d) => d.request !== 'PUT /api/v1/devices')) {
      expect(s.body, s.name).toEqual({ app: 'snow', token: DEVICE_TOKEN });
    }
    // Each reply echoes the switches it was sent.
    for (const name of ['put-leeds', 'put-durham', 'put-device', 'put-kathmandu']) {
      expect(body(name).alerts, name).toEqual({ snow: evening });
    }
  });

  it('names each place as the server does, at the moment of the answer the app shows', () => {
    const place = (name: string) => body(name).place;
    expect(place('put-leeds')).toEqual({
      name: 'Leeds',
      timezone: 'Europe/London',
      query: 'place=leeds-gb',
    });
    expect(place('put-durham')).toEqual({
      name: 'Durham',
      timezone: 'Europe/London',
      query: 'place=durham-gb',
    });
    expect(place('put-device')).toMatchObject({
      timezone: 'Europe/London',
      query: 'lat=53.8&lon=-1.55&source=device',
    });
    // The place's own zone, as kathmandu-0545 has it.
    expect(place('put-kathmandu')).toEqual({
      name: 'Kathmandu',
      timezone: 'Asia/Kathmandu',
      query: 'lat=27.7&lon=85.3&name=Kathmandu&country=NP&source=search',
    });
    expect(spec('put-leeds').now).toBe(moment('leeds-dry'));
    expect(spec('put-durham').now).toBe(moment('durham-tomorrow'));
    expect(spec('put-device').now).toBe(moment('leeds-dry'));
    expect(spec('put-kathmandu').now).toBe(moment('kathmandu-0545'));
    for (const name of ['put-leeds', 'put-durham', 'put-device', 'put-kathmandu']) {
      expect(body(name).seenAt, name).toBe(spec(name).now);
    }
    expect(Date.parse(spec('put-twice').now) - Date.parse(moment('leeds-dry'))).toBe(10_000);
  });

  it("refuses a place with no page, and a second write in a minute, in the server's words", () => {
    expect(body('put-bad-place').error.message).toBe(ERROR_MESSAGES.not_found);
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
    const bad = { ...spec('put-bad-place') };
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
    // A tap opens the place put-durham registered, under its name.
    const durhamPlace = body('put-durham').place;
    expect(pushed).toMatchObject({ place: durhamPlace.query, name: durhamPlace.name });
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
