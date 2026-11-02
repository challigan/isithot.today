/**
 * The devices fixtures (iOS notifications, phases 8.1 and 8.4a): the real devices handlers'
 * replies to the app's requests (`PUT` and `DELETE /api/v1/devices`, `POST /api/v1/devices/test`),
 * on synthetic forecasts and a store in memory at a fixed moment, with Netlify's geo for the
 * request's connection where the fixture gives one, and Apple played by a stand-in that answers
 * as each fixture says. IsItCore's tests read each reply through the ports of client `syncReply`
 * and `testOutcome`, and the app's Debug builds answer the devices calls with them. Then the
 * notification payloads, what a phone receives, from the server's own `alertPush`.
 *
 * 8.1's fixtures (version 1 bodies, one place) are kept exactly as 8.1 wrote them; 8.4a's come
 * after them, each a whole set as 8.4's app sends it (version 2): where you are, and no saved
 * place.
 *
 * Nothing secret is in them. The APNs key is a throwaway one made for each run, which no reply
 * carries, and the device token is one no phone has. Nothing here touches the disk:
 * `scripts/mobile-generate.ts` writes the files.
 */
import { generateKeyPairSync } from 'node:crypto';
import { ALERTS, collapseId, expiresAt, snowAlert, type TodayResponse } from '@isithot/core';
import {
  deviceTarget,
  herePlace,
  registrationBody,
  type AlertPrefs,
  type HerePlace,
  type RegistrationBody,
} from '@isithot/client';
import { createSyntheticFetch, type FetchLike } from '@isithot/providers';
import {
  APNS_TOPICS,
  CITIES,
  MemoryAlertStore,
  MemoryKV,
  alertPush,
  handleDeviceDelete,
  handleDevicePut,
  handleDeviceTest,
  handleRateLimited,
  type ApnsSender,
  type DevicePlace,
  type DevicePutBody,
  type DevicesPlatform,
  type VisitorGeo,
} from '@isithot/server';
import { FIXTURES, fixedAt, relabelZone, type FixtureSpec } from './fixtures';

/** The one device every fixture registers: 64 hex characters, as Apple's tokens are, no phone's. */
export const DEVICE_TOKEN = '0f'.repeat(32);

/** The three devices requests, each as its method and path. */
export type DeviceRequestLine =
  'PUT /api/v1/devices' | 'DELETE /api/v1/devices' | 'POST /api/v1/devices/test';

/** A request as the app sends it: the method and path, and the JSON body. */
export interface DeviceRequest {
  request: DeviceRequestLine;
  body: RegistrationBody | DevicePutBody | { app: 'snow'; token: string };
  /**
   * Where Netlify places the request's connection (its `context.geo`, as the function passes
   * it): where you are when a version 2 body leaves it to the server. None if not given.
   */
  geo?: VisitorGeo;
  /** When it is made, ISO 8601 UTC: by default the moment of the fixture it comes before. */
  now?: string;
}

export interface DeviceFixtureSpec extends DeviceRequest {
  /** The file's name, without `.json`, in the fixtures' `Devices` folder. */
  name: string;
  /** The moment the server answers, ISO 8601 UTC. */
  now: string;
  /** What the reply shows, and why this moment. */
  note: string;
  /** Asked first, on the same store and in order; each must succeed. */
  before?: readonly DeviceRequest[];
  /** What Apple answers a test send; a 200 if not given. */
  apple?: { status: number; reason: string };
  /** `ALERTS_DRY_RUN` unset, as production has it until notifications are switched on. */
  dryRun?: true;
  /** Answered by Netlify's rate limit's rewrite (`handleRateLimited`), not by the handler. */
  limited?: true;
  /** The place's own time zone, where the synthetic source would give a whole-hour one. */
  zone?: string;
}

/**
 * A devices fixture as its file has it: what was asked, from where (only when the fixture gives
 * a geo), when and why, then the reply as the server sent it.
 */
export interface DeviceFixture {
  _fixture: {
    request: DeviceRequestLine;
    body: DeviceRequest['body'];
    geo?: VisitorGeo;
    now: string;
    note: string;
  };
  status: number;
  /** The reply's `Retry-After` header, or null. */
  retryAfter: string | null;
  /** The reply's body as text, '' for none. */
  text: string;
}

/** The today fixture whose moment, and whose place's zone, a devices fixture shares. */
function answer(name: string): FixtureSpec {
  const spec = FIXTURES.find((s) => s.name === name);
  if (!spec) throw new Error(`No fixture ${name}`);
  return spec;
}

const LEEDS_DRY = answer('leeds-dry').now;
const KATHMANDU = answer('kathmandu-0545');
const EVENING: AlertPrefs = { evening: true, morning: false, possible: false };

/**
 * 8.1's builds' PUT for `place`, version 1 (no `v`, one place), as 8.1's client
 * `registrationBody` made it: from the sandbox, in °C, with the evening switched on. The server
 * answers it until those builds expire; 8.4's app sends version 2 (`putHere`).
 */
const put = (place: DevicePlace): DeviceRequest => ({
  request: 'PUT /api/v1/devices',
  body: {
    app: 'snow',
    platform: 'ios',
    env: 'sandbox',
    token: DEVICE_TOKEN,
    place,
    units: 'c',
    alerts: { snow: { ...EVENING } },
    appVersion: '1.0 (42)',
  },
});
const PUT_LEEDS = put({ place: 'leeds-gb' });

/**
 * 8.4's PUT for where you are, as client `registrationBody` makes it (version 2): from the
 * sandbox, in °C, with the evening switched on, and no saved place; from a connection Netlify
 * places at `geo`, if given.
 */
const putHere = (here: HerePlace, geo?: VisitorGeo): DeviceRequest => ({
  request: 'PUT /api/v1/devices',
  body: registrationBody({
    token: DEVICE_TOKEN,
    env: 'sandbox',
    here,
    units: 'c',
    prefs: EVENING,
    appVersion: '1.0 (42)',
  }),
  ...(geo ? { geo } : {}),
});
/** Where you are without the phone's location, as client `herePlace` has it: approximate. */
const APPROXIMATE = herePlace({ access: 'denied', fix: null, kept: null });
/** The phone's own location in Leeds, allowed, with a fix there, as `herePlace` has it. */
const LEEDS_FIX = herePlace({ access: 'granted', fix: deviceTarget(53.8, -1.55), kept: null });
/** The first launch at approximate location: the screen the app shows, and Netlify's Leeds. */
const IP_FIRST = answer('ip-first-launch');
if (!IP_FIRST.geo) throw new Error('ip-first-launch has no geo');
/** Netlify's geo for a connection in Newcastle upon Tyne. */
const NEWCASTLE: VisitorGeo = {
  city: 'Newcastle upon Tyne',
  country: 'GB',
  region: 'England',
  lat: 54.9881,
  lon: -1.6194,
};
/** Netlify's geo for a connection it places in the UK, but in no town. */
const UK_ONLY: VisitorGeo = { country: 'GB' };
const PUT_HERE_IP = putHere(APPROXIMATE, IP_FIRST.geo);
const PUT_HERE_DEVICE = putHere(LEEDS_FIX);
const later = (at: string, minutes: number): string =>
  new Date(Date.parse(at) + minutes * 60_000).toISOString();
const IDENTITY = { app: 'snow', token: DEVICE_TOKEN } as const;
const TEST: DeviceRequest = { request: 'POST /api/v1/devices/test', body: IDENTITY };

/** Every devices fixture, in the order their files are written. */
export const DEVICE_FIXTURES: readonly DeviceFixtureSpec[] = [
  {
    name: 'put-leeds',
    ...PUT_LEEDS,
    now: LEEDS_DRY,
    note:
      'The first registration, for Leeds, a city page, with the evening switched on, at ' +
      'leeds-dry’s moment (9:05am on 1 December): the ID Your privacy shows, the place’s name, ' +
      'zone and query, and the switches the server holds.',
  },
  {
    name: 'put-durham',
    ...put({ place: 'durham-gb' }),
    now: answer('durham-tomorrow').now,
    note:
      'Durham, at durham-tomorrow’s moment (6:05pm on 16 December), the evening before the snow ' +
      'its notification is about (Payloads/durham-evening.json).',
  },
  {
    name: 'put-device',
    ...put({ lat: 53.8, lon: -1.55, source: 'device' }),
    now: LEEDS_DRY,
    note:
      'The phone’s own location in Leeds, on the 0.05° grid as the app sends it: the server ' +
      'names the cell itself, and the place follows the phone.',
  },
  {
    name: 'put-kathmandu',
    ...put({ lat: 27.7, lon: 85.3, source: 'search', name: 'Kathmandu', country: 'NP' }),
    now: KATHMANDU.now,
    zone: KATHMANDU.zone,
    note:
      'A searched place with no city page, Kathmandu, as choosing search-kathmandu’s result ' +
      'sends it: its point, name and country. Its zone is the place’s own (UTC+5:45), as ' +
      'kathmandu-0545 has it.',
  },
  {
    name: 'put-bad-place',
    ...put({ place: 'nowhere-xx' }),
    now: LEEDS_DRY,
    note:
      'A city page that doesn’t exist: 400 bad_location, in the server’s own words, which the ' +
      'app shows under the place.',
  },
  {
    name: 'put-twice',
    ...PUT_LEEDS,
    now: '2026-12-01T09:05:10.000Z',
    before: [{ ...PUT_LEEDS, now: LEEDS_DRY }],
    note:
      'put-leeds’s PUT again 10 seconds later: one write a minute for each device, so 429 ' +
      'rate_limited, with the 50 seconds left of the minute in Retry-After.',
  },
  {
    name: 'delete',
    request: 'DELETE /api/v1/devices',
    body: IDENTITY,
    now: LEEDS_DRY,
    before: [PUT_LEEDS],
    note:
      '"Turn off notifications and delete my data" after put-leeds: 204, with no body. The ' +
      'server answers the same when it holds nothing for the device.',
  },
  {
    name: 'test-sent',
    ...TEST,
    now: LEEDS_DRY,
    before: [PUT_LEEDS],
    note:
      'A test notification after put-leeds, with sending switched on and Apple taking it: 202, ' +
      'sent.',
  },
  {
    name: 'test-dryrun',
    ...TEST,
    now: LEEDS_DRY,
    before: [PUT_LEEDS],
    dryRun: true,
    note:
      'The same test with ALERTS_DRY_RUN unset, as production has it until notifications are ' +
      'switched on: 202, but only logged, so nothing was sent.',
  },
  {
    name: 'test-limited',
    ...TEST,
    now: LEEDS_DRY,
    before: [PUT_LEEDS, ...Array.from({ length: ALERTS.testPerHour }, () => TEST)],
    note:
      `A test after put-leeds and the hour’s ${ALERTS.testPerHour}: 429 test_limited, with the ` +
      '55 minutes to the next hour in Retry-After.',
  },
  {
    name: 'test-quiet',
    ...TEST,
    now: '2026-12-01T22:00:00.000Z',
    before: [PUT_LEEDS],
    note:
      'A test at 10pm in Leeds, after put-leeds: nothing is sent from 9pm to 7am at the place, ' +
      'so 409 quiet_hours, with the 9 hours to 7am in Retry-After.',
  },
  {
    name: 'test-gone',
    ...TEST,
    now: LEEDS_DRY,
    before: [PUT_LEEDS],
    apple: { status: 400, reason: 'BadDeviceToken' },
    note:
      'A test after put-leeds that Apple refuses as a token it doesn’t know: the server deletes ' +
      'the registration and answers 404 not_registered, so the app registers again.',
  },
  {
    name: 'test-unregistered',
    ...TEST,
    now: LEEDS_DRY,
    note: 'A test for a device with no registration: 404 not_registered.',
  },
  {
    name: 'test-down',
    ...TEST,
    now: LEEDS_DRY,
    before: [PUT_LEEDS],
    apple: { status: 503, reason: 'ServiceUnavailable' },
    note:
      'A test after put-leeds while Apple can’t take it: 503 push_unavailable, and the app says ' +
      'it couldn’t send one.',
  },
  {
    name: 'rate-limited',
    ...PUT_LEEDS,
    now: LEEDS_DRY,
    limited: true,
    note:
      'put-leeds’s PUT answered by Netlify’s rate limit, before the handler: 429 rate_limited, ' +
      'with a minute in Retry-After. A test send gets the same reply.',
  },
  // 8.4a: each a whole set, as 8.4's app sends it, where you are and no saved place.
  {
    name: 'put-here-ip',
    ...PUT_HERE_IP,
    now: IP_FIRST.now,
    note:
      'Where you are, without the phone’s location: the app sends no place, and the server ' +
      'locates the connection itself, in Leeds as Netlify says (as ip-first-launch’s platform ' +
      'does), keeping its 0.05° cell, at ip-first-launch’s moment (12:05pm on 1 December). The ' +
      'set the app keeps: where you are, its zone and country, what it follows (the ' +
      'connection), and no saved place.',
  },
  {
    name: 'put-here-device',
    ...PUT_HERE_DEVICE,
    now: LEEDS_DRY,
    note:
      'Where you are from the phone’s own location in Leeds, on the 0.05° grid as the app sends ' +
      'it, at leeds-dry’s moment: the server names the cell itself, and where you are follows ' +
      'the phone.',
  },
  {
    name: 'put-here-refresh',
    ...putHere(APPROXIMATE, NEWCASTLE),
    now: later(IP_FIRST.now, ALERTS.hereRefreshMinutes),
    before: [{ ...PUT_HERE_IP, now: IP_FIRST.now }],
    note:
      `put-here-ip’s set again ${ALERTS.hereRefreshMinutes} minutes later, as the app sends it ` +
      'on becoming active while where you are is approximate: the server locates the ' +
      'connection afresh, now in Newcastle upon Tyne as Netlify says, and where you are moves ' +
      'to that cell, which the server names Newcastle.',
  },
  {
    name: 'put-unlocated',
    ...putHere(APPROXIMATE, UK_ONLY),
    now: later(LEEDS_DRY, 60),
    before: [{ ...PUT_HERE_DEVICE, now: LEEDS_DRY }],
    note:
      'An hour after put-here-device, with location access turned off, the app sends where you ' +
      'are as approximate, and Netlify places the connection in the UK but in no town: the ' +
      'server deletes the phone’s location, has nothing left to keep, forgets the set and ' +
      'answers 400 bad_location in its own words, which the app shows. The Debug builds answer ' +
      'this to a set no other fixture has.',
  },
];

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

/**
 * The functions' settings for a sandbox send: a throwaway P-256 key, as Apple's .p8 files are,
 * made again on every run, and sending switched on.
 */
export const DEVICE_SETTINGS: Readonly<Record<string, string>> = {
  APNS_TEAM_ID: 'TEAM123456',
  APNS_KEY_ID_SANDBOX: 'SANDBOX001',
  APNS_KEY_SANDBOX: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  ALERTS_DRY_RUN: 'false',
};

/** Apple as `spec` has it answer a test send. Nothing leaves the process. */
function apple(spec: DeviceFixtureSpec): () => ApnsSender {
  const { status, reason } = spec.apple ?? { status: 200, reason: null };
  return () => ({
    send: () => Promise.resolve({ status, reason, timestamp: null }),
    close: () => {},
  });
}

/** `asked`, answered by the devices handler on `store`, at its moment, as `spec` has it. */
function ask(
  spec: DeviceFixtureSpec,
  asked: DeviceRequest,
  store: MemoryAlertStore,
  cache: MemoryKV,
): Promise<Response> {
  const at = new Date(asked.now ?? spec.now);
  let fetch: FetchLike = createSyntheticFetch(CITIES, () => at);
  if (spec.zone) fetch = relabelZone(fetch, spec.zone, at);
  const settings: Record<string, string | undefined> = {
    DATA_SOURCE: 'synthetic',
    ...DEVICE_SETTINGS,
    ...(spec.dryRun ? { ALERTS_DRY_RUN: undefined } : {}),
  };
  const platform: DevicesPlatform = {
    env: (name) => settings[name],
    deployContext: 'production',
    store,
    connect: apple(spec),
    geo: asked.geo ?? null,
  };
  platform.deps = fixedAt(at, fetch, cache)(platform);
  const [method, path] = asked.request.split(' ');
  const request = new Request(`https://willitsnow.today${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(asked.body),
  });
  if (method === 'POST') return handleDeviceTest(request, platform);
  return method === 'DELETE'
    ? handleDeviceDelete(request, platform)
    : handleDevicePut(request, platform);
}

/**
 * The server's reply to `spec`'s request, after its `before` requests, with `_fixture` first.
 * Each fixture has a store and a cache of its own, so none depends on one made before it; a test
 * may pass the store, to see what the requests left in it.
 */
export async function makeDeviceFixture(
  spec: DeviceFixtureSpec,
  store: MemoryAlertStore = new MemoryAlertStore(),
): Promise<DeviceFixture> {
  const cache = new MemoryKV();
  for (const asked of spec.before ?? []) {
    const res = await ask(spec, asked, store, cache);
    if (!res.ok) {
      throw new Error(
        `${spec.name}: ${asked.request} was answered ${res.status}: ${await res.text()}`,
      );
    }
  }
  const res = spec.limited ? handleRateLimited() : await ask(spec, spec, store, cache);
  return {
    _fixture: {
      request: spec.request,
      body: spec.body,
      ...(spec.geo ? { geo: spec.geo } : {}),
      now: spec.now,
      note: spec.note,
    },
    status: res.status,
    retryAfter: res.headers.get('retry-after'),
    text: await res.text(),
  };
}

/** A fixture or a payload as its file has it: two-space JSON in the given key order, a newline. */
export function deviceFixtureJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// ---- Notification payloads -------------------------------------------------------------------

/** The payloads' files, in the fixtures' `Payloads` folder, in the order they are written. */
export const PAYLOAD_FILES: readonly string[] = [
  'durham-evening.json',
  'durham-old.json',
  'malformed.json',
  'evening.apns',
];

/**
 * What a phone receives (the server's `alertPush`'s `payload`) for put-durham's registration and
 * the evening notification core's `snowAlert` makes from `durham`, durham-tomorrow's answer:
 * - `durham-evening.json`: that payload, about the 17th;
 * - `durham-old.json`: the same about the 10th, long past, which opens on the default view;
 * - `malformed.json`: the same about 30 February, not a date, which routes nowhere;
 * - `evening.apns`: durham-evening's payload for `simctl push`, the app's bundle ID first.
 */
export function payloadFiles(durham: TodayResponse): { name: string; contents: string }[] {
  const record = { app: 'snow', token: DEVICE_TOKEN, query: 'place=durham-gb', name: 'Durham' };
  const alert = durham.snow ? snowAlert(durham.snow, 'evening', EVENING, record.name) : null;
  const today = durham.snow?.days[0]?.date;
  if (!alert || !today) throw new Error('durham-tomorrow: no evening notification');
  const { payload } = alertPush({
    record,
    alert,
    topic: 'snow',
    kind: 'evening',
    date: alert.date,
    collapseId: collapseId('snow', 'evening', alert.date),
    expiration: expiresAt(durham.location.timezone, 'evening', today),
    priority: ALERTS.apnsPriority.evening,
  });
  const files = [
    payload,
    { ...payload, date: '2026-12-10' },
    { ...payload, date: '2026-02-30' },
    { 'Simulator Target Bundle': APNS_TOPICS.snow, ...payload },
  ];
  return files.map((p, i) => ({ name: PAYLOAD_FILES[i]!, contents: deviceFixtureJson(p) }));
}
