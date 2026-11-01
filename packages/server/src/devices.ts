/**
 * The apps' notification registrations (iOS build spec, sections 8.2 and 8.3):
 * - `PUT /api/v1/devices` registers a device's push token for its places, its units and its
 *   switches, or forgets it when every switch is off;
 * - `DELETE /api/v1/devices` forgets it;
 * - `POST /api/v1/devices/test` sends a notification now for each of up to two of its places.
 *
 * There are no accounts: the push token is the credential, and a registration's id is the first
 * 32 hex characters of sha256(app + ':' + token).
 *
 * **What is stored** (Blobs store `isithot-alerts`): a record for each place, in its own zone's
 * directory: the free place ("where you are": the phone's location, or the town its connection is
 * in) at `reg/v1/<tz>/<app>.<id>`, and each saved place at `reg/v1/<tz>/<app>.<id>.<pid>`
 * (`placeId`). At `ids/v1/<app>.<id>`, every key the device has, with the salt of its pids
 * (`DeviceIdsEntry`). Only these handlers write either kind of key, and each write replaces the
 * value whole. The ids key names a record before it is written, and until it is deleted. So a
 * DELETE that follows a registration cut short by a failure still finds every copy:
 * 1. delete the places the set no longer has (the ids key names them); a new salt is stored then,
 *    in an ids key naming what is left, and read back after the lookups;
 * 2. the ids key, naming the places about to be written and the zones the free place is leaving;
 * 3. the records;
 * 4. delete the free place's copy in a zone it left;
 * 5. the ids key again, naming what is there; with nothing there, it is deleted.
 * A v1 body (8.1's builds) is one place: its saved places are deleted first, then 2 to 5.
 *
 * **Failures.** The store either confirms a call or fails it (alertStore.ts). Any failure is a
 * `503 store_unavailable`, never a 200 for a write that did not land. Logs carry id prefixes,
 * zones and Apple's answers; never a device token, a provider token, a key, a full id, a place
 * query or coordinates.
 */
import {
  ALERTS,
  COPY,
  ERROR_MESSAGES,
  SNOW_RELEVANCE,
  collapseId,
  inQuietHours,
  isFiniteNumber,
  isValidLatLon,
  localDate,
  localDateTime,
  snowAlert,
  testAlert,
  threadId,
  type ApiLocation,
  type ApiSnow,
  type TodayResponse,
  type TopicAlertPrefs,
  type Units,
} from '@isithot/core';
import { alertsDryRun, scrub, type AlertRecord } from './alerts';
import {
  AlertStoreError,
  SafeAlertStore,
  claimTestSend,
  createBlobsAlertStore,
  idPrefix,
  idsKey,
  keysOf,
  newSalt,
  parseRegKey,
  placeId,
  regKey,
  registrationId,
  type AlertStore,
} from './alertStore';
import {
  APNS_ORIGINS,
  alertPush,
  apnsKey,
  apnsSender,
  sendAlerts,
  type AlertPush,
  type ApnsEnv,
  type ApnsKey,
  type ApnsSender,
  type Delivery,
} from './apns';
import { createDeps, type Platform, type ServerDeps } from './deps';
import { NO_STORE } from './http';
import {
  getToday,
  locateCity,
  locateFromCoords,
  locateFromIpOnly,
  type Located,
  type VisitorGeo,
} from './today';

/** The apps a registration may name. One registration per install per app. */
export const DEVICE_APPS = ['snow', 'wet', 'wind', 'hot', 'all'] as const;
export type DeviceApp = (typeof DEVICE_APPS)[number];

/** The apps whose notifications are live: snow's only. */
export const LIVE_DEVICE_APPS: readonly DeviceApp[] = ['snow'];

export const DEVICE_LIMITS = {
  /**
   * The largest body, bytes: ten searched places with 80-character names and regions in 3-byte
   * characters are about 6.6 KB.
   */
  bodyBytes: 8192,
  /**
   * At most one write per id in this long, ms. Netlify's rule (below) may not apply on every plan,
   * so the handler checks too. A delete is never refused.
   */
  writeEveryMs: 60_000,
  /** Netlify's rule on both functions: requests a minute per IP on each domain. */
  perMinute: 10,
  /**
   * How long a registration waits for its new places' forecasts (their zones and names), all at
   * once, ms: each takes at most about 7.5 s, and the app waits 12 s for the whole PUT, so its
   * reads and writes either side still leave time for the answer to reach it.
   */
  putLookupMs: 8_000,
  /** Records a registration writes, or deletes, at once. */
  writesAtOnce: 4,
  /** How long a test waits for the forecasts before sending the fixed words, ms. */
  testForecastWaitMs: 3_000,
  /** How long a test waits for Apple's answer, ms. */
  testApnsTimeoutMs: 5_000,
  /** A test starts no push this long after its first, ms: two fit well inside Netlify's 30 s. */
  testDeadlineMs: 8_000,
  /** How long Apple keeps trying to deliver a test notification, seconds. */
  testExpirySeconds: 15 * 60,
} as const;

/**
 * The fixed test notification's collapse id: a second test replaces the first on the phone. A
 * saved place's has its pid after it, "snow-test-1a2b3c4d5e6f".
 */
export const TEST_COLLAPSE_ID = 'snow-test';

/** A registration's place: the three forms `/api/v1/today` takes. */
export type DevicePlace =
  | { place: string }
  | {
      lat: number;
      lon: number;
      source: 'search';
      name?: string;
      region?: string;
      country?: string;
      geonameId?: number;
      elevation?: number;
    }
  | { lat: number; lon: number; source: 'device' };

/** The body of `PUT /api/v1/devices`, as checked (the token in lower case). */
export interface DevicePutBody {
  app: DeviceApp;
  platform: 'ios';
  env: ApnsEnv;
  token: string;
  place: DevicePlace;
  units: Units;
  alerts: { snow: TopicAlertPrefs };
  appVersion?: string;
}

/**
 * Where the phone is, in a version 2 body: the town its connection is in, which the server
 * locates (`source: 'ip'`, no place), or its own location.
 */
export type DeviceHere = { source: 'ip' } | { lat: number; lon: number; source: 'device' };

/** A saved place in a version 2 body: a city page or a searched place, never the phone's location. */
export type DeviceSavedPlace = Exclude<DevicePlace, { source: 'device' }>;

/**
 * The body of a version 2 `PUT /api/v1/devices` (8.4's builds): the device's whole set, which
 * replaces what is stored. Without `v`, a body is 8.1's (`DevicePutBody`), answered as before.
 */
export interface DevicePutBodyV2 extends Omit<DevicePutBody, 'place'> {
  v: 2;
  here: DeviceHere;
  /** At most `ALERTS.savedPlacesMax`, most recently saved last. */
  saved: DeviceSavedPlace[];
  /** The phone's own zone, sent only with a saved place; absent when it isn't one the server knows. */
  deviceTz?: string;
}

/** The body of `DELETE /api/v1/devices` and `POST /api/v1/devices/test`. */
export interface DeviceIdentity {
  app: DeviceApp;
  token: string;
}

/**
 * What `ids/v1/<app>.<id>` holds, version 1 (8.1's, and a v1 body's): the registration's zone
 * and, while a move between zones is unfinished, the zones it left.
 */
export interface DeviceIdsEntryV1 {
  tz: string;
  from?: string[];
}

/**
 * Version 2, a v2 body's: the device's set. `tz` and `from` mean for the free record what they
 * mean in version 1, so main's code rolled back still finds it; `saved` names the saved records'
 * keys. `leaving` would name keys being removed: it is read (`keysOf`), but these handlers delete
 * a place before the entry stops naming it, so they never need to write it. `salt` keys the pids
 * (`placeId`) and is kept nowhere else. `updatedAt` moves only when a registration has fully
 * succeeded, for the one-write-a-minute rule.
 */
export interface DeviceIdsEntryV2 {
  v: 2;
  tz?: string;
  from?: string[];
  saved: string[];
  leaving?: string[];
  salt: string;
  updatedAt?: string;
}

/** What `ids/v1/<app>.<id>` holds; `keysOf` gives every key either version names. */
export type DeviceIdsEntry = DeviceIdsEntryV1 | DeviceIdsEntryV2;

/**
 * A registration, as `reg/v1/<tz>/<app>.<id>` (the free place) or `reg/v1/<tz>/<app>.<id>.<pid>`
 * (a saved place) holds it (section 8.2). It is the run's `AlertRecord`, narrowed, so what these
 * handlers write is what the run reads.
 */
export interface DeviceRecord extends AlertRecord {
  v: 1;
  app: DeviceApp;
  platform: 'ios';
  /** The canonical `/api/v1/today` place query: "place=leeds-gb". */
  query: string;
  /** The place's `location.name` ("Your location" for a device location with no town). */
  name: string;
  tz: string;
  units: Units;
  alerts: { snow: TopicAlertPrefs };
  createdAt: string;
  updatedAt: string;
  seenAt: string;
  /**
   * The free place only: what it follows, the phone's location or its internet connection.
   * Absent on an 8.1 record.
   */
  follows?: 'device' | 'ip';
  /** The free place only, when it follows the connection: when it was last located, ISO. */
  locatedAt?: string;
  /** The forecast's country code, or null without one. */
  country?: string | null;
}

/** `PUT /api/v1/devices`'s answer to a v1 body, which 8.1's app shows in "Your privacy". */
export interface DeviceResponse {
  id: string;
  place: { name: string; timezone: string; query: string };
  alerts: { snow: TopicAlertPrefs };
  seenAt: string;
}

/** One of a set's places as the answer to a version 2 body names it. */
export interface DevicePlaceReply {
  name: string;
  timezone: string;
  query: string;
  /** The forecast's country code, or null without one. */
  country: string | null;
}

/** `PUT /api/v1/devices`'s answer to a version 2 body: the set as stored, for "Your privacy". */
export interface DeviceResponseV2 {
  id: string;
  /** The phone's zone while a saved place keeps it, else null. */
  deviceTz: string | null;
  /** The free place, or null when there is none. */
  here: (DevicePlaceReply & { follows: 'device' | 'ip' }) | null;
  /** The saved places, in the body's order. */
  saved: Array<{ pid: string } & DevicePlaceReply>;
  /** The saved places dropped: each one's index in the body, and why (a city page that's gone). */
  refused: Array<{ index: number; code: 'not_found' }>;
  alerts: { snow: TopicAlertPrefs };
  seenAt: string;
}

/**
 * `POST /api/v1/devices/test`'s answer. `count` only when more than one was sent; `dryRun` (with
 * `sent: false`) only in a dry run, until ALERTS_DRY_RUN is false (`alertsDryRun`).
 */
export interface DeviceTestResponse {
  sent: boolean;
  count?: number;
  dryRun?: true;
}

export type DeviceErrorCode =
  | 'bad_request'
  | 'app_not_live'
  | 'bad_location'
  | 'too_large'
  | 'not_registered'
  | 'method_not_allowed'
  | 'rate_limited'
  | 'test_limited'
  | 'quiet_hours'
  | 'upstream_unavailable'
  | 'store_unavailable'
  | 'push_unavailable'
  | 'push_refused'
  | 'server_error';

/** What the hosting platform and the tests give the devices handlers. */
export interface DevicesPlatform extends Platform {
  /** The notifications' store. By default Blobs: site-wide in production, the deploy's elsewhere. */
  store?: AlertStore;
  /** Forecasts, the clock and the log; by default `createDeps(platform)`. */
  deps?: ServerDeps;
  /** Opens a session to APNs for a test; by default Apple's, for the record's environment. */
  connect?: (env: ApnsEnv) => ApnsSender;
  /** `DEVICE_LIMITS.testForecastWaitMs` unless a test shortens it. */
  testForecastWaitMs?: number;
  /** `DEVICE_LIMITS.putLookupMs` unless a test shortens it. */
  putLookupMs?: number;
  /**
   * Where the request's connection is (Netlify's `context.geo`, as `/api/v1/today` has it): a
   * version 2 body's free place when the phone's location isn't shared.
   */
  geo?: VisitorGeo | null;
}

class DeviceError extends Error {
  constructor(
    readonly status: number,
    readonly code: DeviceErrorCode,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

const fail = (
  status: number,
  code: DeviceErrorCode,
  message: string,
  headers?: Record<string, string>,
): never => {
  throw new DeviceError(status, code, message, headers);
};

const MESSAGES = {
  noPlace: 'Choose a place for notifications: a town, or your location.',
  notLocated:
    "We couldn't tell where you are from your internet connection. Try again later, or use your location.",
  newPlaces: `Up to ${ALERTS.newPlacesPerPut} new places are added at a time. Try again in a minute.`,
  storeDown: "Notifications can't be changed just now. Try again shortly.",
  pushDown: "Test notifications can't be sent just now. Try again later.",
  notRegistered: "This device isn't registered for notifications.",
} as const;

const bad = (message: string): never => fail(400, 'bad_request', message);
const badLocation = (message: string): never => fail(400, 'bad_location', message);
const pushDown = (): never => fail(503, 'push_unavailable', MESSAGES.pushDown);

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      ...NO_STORE,
      ...headers,
    },
  });
}

const errorReply = (err: DeviceError): Response =>
  json(err.status, { error: { code: err.code, message: err.message } }, err.headers);

const noContent = (): Response => new Response(null, { status: 204, headers: { ...NO_STORE } });

// ---- Reading and checking a body ----

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The body as JSON, at most `DEVICE_LIMITS.bodyBytes`. */
async function readJson(request: Request): Promise<unknown> {
  const tooLarge = (): never =>
    fail(413, 'too_large', `The body must be at most ${DEVICE_LIMITS.bodyBytes} bytes.`);
  if (Number(request.headers.get('content-length')) > DEVICE_LIMITS.bodyBytes) tooLarge();
  let bytes: ArrayBuffer;
  try {
    bytes = await request.arrayBuffer();
  } catch {
    return bad('The body could not be read.');
  }
  if (bytes.byteLength > DEVICE_LIMITS.bodyBytes) tooLarge();
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return bad('The body must be JSON.');
  }
}

function checkApp(value: unknown): DeviceApp {
  const app = DEVICE_APPS.find((a) => a === value);
  if (!app) return bad('Unknown app.');
  if (!LIVE_DEVICE_APPS.includes(app)) {
    return fail(400, 'app_not_live', 'Only the snow app has notifications so far.');
  }
  return app;
}

const TOKEN = /^[0-9a-f]{64,200}$/i;

/** The push token, hex, in lower case: one device always has the one id. */
function checkToken(value: unknown): string {
  if (typeof value !== 'string' || !TOKEN.test(value)) {
    return bad('token must be 64 to 200 hex characters.');
  }
  return value.toLowerCase();
}

function checkIdentity(body: unknown): DeviceIdentity {
  if (!isObject(body)) return bad('The body must be a JSON object.');
  return { app: checkApp(body.app), token: checkToken(body.token) };
}

function checkPrefs(alerts: unknown): TopicAlertPrefs {
  const snow = isObject(alerts) ? alerts.snow : undefined;
  if (!isObject(snow)) {
    return bad('alerts.snow must hold the evening, morning and possible switches.');
  }
  const { evening, morning, possible } = snow;
  if (
    typeof evening !== 'boolean' ||
    typeof morning !== 'boolean' ||
    typeof possible !== 'boolean'
  ) {
    return bad('alerts.snow.evening, morning and possible must each be true or false.');
  }
  return { evening, morning, possible };
}

/**
 * What an app version may hold ("1.0 (112)"). It is logged with Apple's refusals, so nothing else
 * gets in: not a control, a line separator or a direction override, which could forge a log line
 * or reverse how one reads.
 */
const APP_VERSION = /^[0-9A-Za-z .()_+-]*$/;

function checkAppVersion(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > 40 || !APP_VERSION.test(value)) {
    return bad('appVersion must be a version such as 1.0 (112), at most 40 characters.');
  }
  return value.trim() || undefined;
}

/**
 * The place, in one of its three forms, as `field` of the body. As with `/api/v1/today`,
 * coordinates win over a slug; a place with neither (the IP location's empty form) is refused,
 * since notifications are for a place someone chose. A v1 body's refusals are `bad_location`, a
 * version 2 body's saved places' `bad_request` (`refuse`).
 */
function checkPlace(
  value: unknown,
  field = 'place',
  refuse: (message: string) => never = badLocation,
): DevicePlace {
  if (!isObject(value)) return refuse(MESSAGES.noPlace);
  if (value.lat !== undefined || value.lon !== undefined) {
    const { lat, lon, source } = value;
    if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) {
      return refuse(`${field}.lat and ${field}.lon must be numbers.`);
    }
    if (source === 'device') return { lat, lon, source };
    if (source !== 'search') return refuse(`${field}.source must be search or device.`);
    const place: Extract<DevicePlace, { source: 'search' }> = { lat, lon, source };
    for (const key of ['name', 'region', 'country'] as const) {
      const text = value[key];
      if (text === undefined || text === null) continue;
      if (typeof text !== 'string') return refuse(`${field}.${key} must be text.`);
      place[key] = text;
    }
    for (const key of ['geonameId', 'elevation'] as const) {
      const number = value[key];
      if (number === undefined || number === null) continue;
      if (!isFiniteNumber(number)) return refuse(`${field}.${key} must be a number.`);
      place[key] = number;
    }
    return place;
  }
  if (value.place !== undefined) {
    if (typeof value.place !== 'string' || !value.place.trim()) {
      return refuse(`${field}.place must be a city slug.`);
    }
    return { place: value.place.trim() };
  }
  return refuse(MESSAGES.noPlace);
}

/**
 * Where the phone is: `{ source: 'ip' }` alone, for the server to locate from the connection, or
 * the phone's location. Never a town or a searched place, which are saved places.
 */
function checkHere(value: unknown): DeviceHere {
  const where = 'here must be { "source": "ip" } or the phone\'s location.';
  if (!isObject(value)) return bad(where);
  const { lat, lon, source } = value;
  if (source === 'ip') {
    if (lat !== undefined || lon !== undefined || value.place !== undefined) {
      return bad('here from the connection has no place: the server locates it.');
    }
    return { source };
  }
  if (source !== 'device') return bad(where);
  if (!isValidLatLon(lat, lon)) return bad('here.lat and here.lon must be a point on Earth.');
  return { lat: lat as number, lon: lon as number, source };
}

/** The saved places: at most `ALERTS.savedPlacesMax`, each a city page or a searched place. */
function checkSaved(value: unknown): DeviceSavedPlace[] {
  if (!Array.isArray(value) || value.length > ALERTS.savedPlacesMax) {
    return bad(`saved must be a list of at most ${ALERTS.savedPlacesMax} places.`);
  }
  return value.map((entry, i) => {
    const field = `saved[${i}]`;
    const place = checkPlace(entry, field, bad);
    if ('place' in place) return place;
    if (place.source === 'device') return bad(`${field} must be a town or a searched place.`);
    if (!isValidLatLon(place.lat, place.lon)) {
      return bad(`${field}.lat and ${field}.lon must be a point on Earth.`);
    }
    return place;
  });
}

/**
 * The phone's zone, in the form the server's ICU names it, when it is one: anything else (a zone
 * newer than the server's ICU, say) is treated as absent, never a refusal.
 */
function checkDeviceTz(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 64) return undefined;
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/**
 * The whole body checked, field by field, before anything is read or written: version 2 with
 * `v: 2`, 8.1's without `v`.
 */
function checkPut(body: unknown): DevicePutBody | DevicePutBodyV2 {
  if (!isObject(body)) return bad('The body must be a JSON object.');
  if (body.v !== undefined && body.v !== 2) return bad('v must be 2, or absent for version 1.');
  const app = checkApp(body.app);
  if (body.platform !== 'ios') bad('platform must be ios.');
  const env = body.env;
  if (env !== 'sandbox' && env !== 'production') return bad('env must be sandbox or production.');
  const token = checkToken(body.token);
  const units = body.units;
  if (units !== 'c' && units !== 'f') return bad('units must be c or f.');
  const alerts = { snow: checkPrefs(body.alerts) };
  const appVersion = checkAppVersion(body.appVersion);
  const shared: Omit<DevicePutBody, 'place'> = { app, platform: 'ios', env, token, units, alerts };
  if (appVersion) shared.appVersion = appVersion;
  if (body.v === 2) {
    const set: DevicePutBodyV2 = {
      v: 2,
      ...shared,
      here: checkHere(body.here),
      saved: checkSaved(body.saved),
    };
    const deviceTz = checkDeviceTz(body.deviceTz);
    if (deviceTz) set.deviceTz = deviceTz;
    return set;
  }
  return { ...shared, place: checkPlace(body.place) };
}

// ---- The place ----

/**
 * The place's canonical today query, from what `locateCity` or `locateFromCoords` made of it:
 * the city's slug, or the coordinates rounded to the forecast grid with a searched place's
 * cleaned name, region, country, GeoNames id and height (a device location's point only). The
 * order is the client's (`todayQuery`), so the app reads it back as the same place.
 */
export function canonicalPlaceQuery(located: Located): string {
  if (located.source === 'city' && located.slug) {
    return new URLSearchParams({ place: located.slug }).toString();
  }
  const q = new URLSearchParams({ lat: String(located.lat), lon: String(located.lon) });
  if (located.source === 'search') {
    // Without a name and a town near enough to lend one, the server says "Your location".
    if (located.name !== COPY.yourLocation) q.set('name', located.name);
    if (located.region) q.set('region', located.region);
    if (located.country) q.set('country', located.country);
    if (located.geonameId) q.set('geonameId', String(located.geonameId));
    if (located.elevation !== undefined) q.set('elevation', String(located.elevation));
  }
  q.set('source', located.source === 'search' ? 'search' : 'device');
  return q.toString();
}

/** A place as located: its canonical query, and its point on the forecast's grid. */
interface Spot {
  query: string;
  lat: number;
  lon: number;
}

/**
 * Locates the place as `/api/v1/today` would; null for a slug with no page, or coordinates it
 * can't use.
 */
async function locate(place: DevicePlace): Promise<Spot | null> {
  let located: Located | null;
  if ('place' in place) {
    located = locateCity(place.place);
  } else {
    const params = new URLSearchParams({ lat: String(place.lat), lon: String(place.lon) });
    if (place.source === 'search') {
      if (place.name !== undefined) params.set('name', place.name);
      if (place.region !== undefined) params.set('region', place.region);
      if (place.country !== undefined) params.set('country', place.country);
      if (place.geonameId !== undefined) params.set('geonameId', String(place.geonameId));
      if (place.elevation !== undefined) params.set('elevation', String(place.elevation));
    }
    params.set('source', place.source);
    located = await locateFromCoords(params);
  }
  return located && { query: canonicalPlaceQuery(located), lat: located.lat, lon: located.lon };
}

/** Locates the place as `/api/v1/today` would, and gives its canonical query. */
async function canonicalQuery(place: DevicePlace): Promise<string> {
  const spot = await locate(place);
  if (spot) return spot.query;
  return badLocation('place' in place ? ERROR_MESSAGES.not_found : ERROR_MESSAGES.bad_location);
}

/** A device point's own, from its canonical query ("lat=53.8&lon=-1.55&source=device"). */
function spotOf(query: string): Spot {
  const params = new URLSearchParams(query);
  return { query, lat: Number(params.get('lat')), lon: Number(params.get('lon')) };
}

// ---- The store ----

function isRecord(value: unknown): value is DeviceRecord {
  return (
    isObject(value) &&
    typeof value.token === 'string' &&
    (value.env === 'sandbox' || value.env === 'production') &&
    typeof value.query === 'string' &&
    typeof value.name === 'string' &&
    typeof value.tz === 'string' &&
    (value.units === 'c' || value.units === 'f') &&
    typeof value.updatedAt === 'string' &&
    isObject(value.alerts) &&
    isObject(value.alerts.snow)
  );
}

const isSet = (entry: unknown): entry is DeviceIdsEntryV2 => isObject(entry) && entry.v === 2;

/** A version 2 entry's salt (`newSalt`), or null. */
const saltOf = (entry: unknown): string | null =>
  isSet(entry) && /^[0-9a-f]{32}$/.test(String(entry.salt)) ? entry.salt : null;

/** A saved place's pid from its key; undefined for the free place's, or any other key. */
const pidOf = (key: string): string | undefined => parseRegKey(key)?.pid;

/** What a device has stored. */
interface Stored {
  /** What the ids key holds, or null. */
  entry: unknown;
  /** The free place's record: the first its ids key names (its own zone first), or null. */
  free: DeviceRecord | null;
  /** Each saved place's record by pid, with the key it is at: the first its ids key names. */
  saved: Map<string, { key: string; record: DeviceRecord }>;
  /** Every key the ids key names that holds anything, a record or not, in its order. */
  held: string[];
}

/** The ids key, then every record it names, at once. */
async function readStored(store: AlertStore, app: DeviceApp, id: string): Promise<Stored> {
  const entry = await store.get<unknown>(idsKey(app, id));
  const keys = keysOf(entry, app, id);
  const values = await Promise.all(keys.map((key) => store.get<unknown>(key)));
  const stored: Stored = { entry, free: null, saved: new Map(), held: [] };
  keys.forEach((key, i) => {
    const value = values[i];
    if (value === null || value === undefined) return;
    stored.held.push(key);
    if (!isRecord(value)) return;
    const pid = pidOf(key);
    if (!pid) {
      stored.free ??= value;
    } else if (!stored.saved.has(pid)) {
      stored.saved.set(pid, { key, record: { ...value, slot: pid } });
    }
  });
  return stored;
}

/**
 * Runs `run` on each item, `width` at once. After a failure it starts no more, and waits for
 * those under way before throwing it, so nothing lands after the request has been answered.
 */
async function eachAtOnce<T>(
  items: readonly T[],
  width: number,
  run: (item: T) => Promise<unknown>,
): Promise<void> {
  let next = 0;
  const failures: unknown[] = [];
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length && !failures.length) {
        try {
          await run(items[next++]!);
        } catch (err) {
          failures.push(err);
        }
      }
    }),
  );
  if (failures.length) throw failures[0];
}

/** The zones of the free place's keys among `keys`, in their order. */
const freeZones = (keys: readonly string[]): string[] =>
  keys.flatMap((key) => {
    const reg = parseRegKey(key);
    return reg && !reg.pid ? [reg.tz] : [];
  });

/** Writes a v1 body's record (steps 2 to 5 above); gives the zones it left. */
async function saveRegistration(
  store: AlertStore,
  record: DeviceRecord,
  where: unknown,
): Promise<string[]> {
  const { app, id, tz } = record;
  const left = freeZones(keysOf(where, app, id)).filter((zone) => zone !== tz);
  // A version 2 entry is replaced: a v1 body holds one place, and no salt.
  const current = isObject(where) && !isSet(where) && where.tz === tz && where.from === undefined;
  if (!current) {
    const naming: DeviceIdsEntry = left.length ? { tz, from: left } : { tz };
    await store.set(idsKey(app, id), naming);
  }
  await store.set(regKey(tz, app, id), record);
  for (const zone of left) await store.delete(regKey(zone, app, id));
  if (left.length) await store.set(idsKey(app, id), { tz } satisfies DeviceIdsEntry);
  return left;
}

/**
 * The version 2 ids entry naming `keys` (the free place's zones, the first its own, then the
 * saved places' keys), with the salt, and `updatedAt` once a registration has fully succeeded.
 */
function naming(keys: readonly string[], salt: string, updatedAt?: string): DeviceIdsEntryV2 {
  const [tz, ...from] = freeZones(keys);
  return {
    v: 2,
    ...(tz ? { tz } : {}),
    ...(from.length ? { from } : {}),
    saved: keys.filter((key) => pidOf(key) !== undefined),
    salt,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

// ---- Each request ----

interface Job {
  /** For `getToday`, logging through `log`. */
  deps: ServerDeps;
  /** The request's one moment, ms. */
  now: number;
  /** Every line the request logs, the forecast code's and the cache's included (`placeLess`). */
  log: (line: string) => void;
  store(): AlertStore;
}

/**
 * A line fit for a public log: the run's `scrub` (ids cut short, no provider token, no grid
 * cell, no `lat=`, `lon=` or `apikey=`), and no other pair of numbers either ("54,-1"). The
 * forecast code and the cache name an entry by its grid cell ("forecast/v7/54.80,-1.60/50"),
 * which here is a registration's place.
 */
export function placeLess(line: string): string {
  return scrub(line).replace(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g, '<place>');
}

/** Where a request's lines go: the given dependencies' log, the platform's, or the console. */
function sinkOf(platform: DevicesPlatform): (line: string) => void {
  return platform.deps?.log ?? platform.log ?? ((line) => console.log(`[isithot] ${line}`));
}

function begin(platform: DevicesPlatform): Job {
  const sink = sinkOf(platform);
  const log = (line: string): void => sink(placeLess(line));
  // `createDeps`'s own lines go through `log` too: a slow cache read names its key's grid cell.
  const deps = platform.deps ?? { ...createDeps({ ...platform, log }), climateWaitMs: 0 };
  const onError = (err: AlertStoreError): void => log(err.message);
  let store: AlertStore | undefined;
  return {
    deps: { ...deps, log },
    now: deps.now().getTime(),
    log,
    store() {
      if (store) return store;
      if (platform.store) {
        store = new SafeAlertStore(platform.store, onError);
        return store;
      }
      try {
        // Previews, branch deploys and `netlify dev` get the deploy's own store, never production's.
        store = createBlobsAlertStore(platform.deployContext === 'production', { onError });
      } catch (err) {
        log(`devices: error: no alert store (${(err as Error).message})`);
        return fail(503, 'store_unavailable', MESSAGES.storeDown);
      }
      return store;
    },
  };
}

/** Runs one request, turning every refusal and failure into its JSON error. */
async function answer(
  platform: DevicesPlatform,
  run: (r: Job) => Promise<Response>,
): Promise<Response> {
  let log = (line: string): void => sinkOf(platform)(placeLess(line));
  try {
    const r = begin(platform);
    log = r.log;
    return await run(r);
  } catch (err) {
    if (err instanceof DeviceError) return errorReply(err);
    if (err instanceof AlertStoreError) {
      // Already logged by the store, once.
      return errorReply(new DeviceError(503, 'store_unavailable', MESSAGES.storeDown));
    }
    log(`devices: error: ${(err as Error)?.message ?? String(err)}`);
    return errorReply(
      new DeviceError(500, 'server_error', 'Something went wrong. Try again later.'),
    );
  }
}

/** A registration as a log names it: "snow.3f9c1a2b…", and a saved place's "snow.3f9c1a2b….1a2b3c4d5e6f". */
const who = (app: string, id: string, slot?: string): string =>
  `${app}.${idPrefix(id)}${slot ? `.${slot}` : ''}`;

const DAY = 86_400_000;

const unique = (keys: readonly string[]): string[] => [...new Set(keys)];

/** Deletes every place of a device, then its ids key (with the salt); nothing stored is fine. */
async function forget(r: Job, app: DeviceApp, id: string): Promise<void> {
  const store = r.store();
  const entry = await store.get<unknown>(idsKey(app, id));
  if (entry === null) {
    r.log(`devices: nothing to delete for ${who(app, id)}`);
    return;
  }
  await eachAtOnce(keysOf(entry, app, id), DEVICE_LIMITS.writesAtOnce, (key) => store.delete(key));
  await store.delete(idsKey(app, id));
  r.log(`devices: deleted ${who(app, id)}`);
}

/**
 * One write a minute for each device (429 `rate_limited`), timed from its last registration that
 * fully succeeded: a version 2 entry's `updatedAt`, else the record's (8.1's). A time in the
 * future, from another clock, counts too.
 */
function holdBack(r: Job, app: DeviceApp, id: string, stored: Stored): void {
  const written = isSet(stored.entry) ? stored.entry.updatedAt : stored.free?.updatedAt;
  if (typeof written !== 'string') return;
  const age = r.now - Date.parse(written);
  if (age > -DEVICE_LIMITS.writeEveryMs && age < DEVICE_LIMITS.writeEveryMs) {
    r.log(`devices: refused ${who(app, id)}: written ${Math.round(age / 1000)} s ago`);
    fail(429, 'rate_limited', 'One change a minute for each device. Try again shortly.', {
      'Retry-After': String(Math.ceil((DEVICE_LIMITS.writeEveryMs - age) / 1000)),
    });
  }
}

/**
 * A v1 body (8.1's builds), registered as before for its one place, which replaces the set: any
 * saved places go first, before anything can fail, and the ids key becomes version 1's again.
 */
async function putPlace(r: Job, body: DevicePutBody, id: string): Promise<Response> {
  const { app, alerts } = body;
  const store = r.store();
  const stored = await readStored(store, app, id);
  holdBack(r, app, id, stored);
  const query = await canonicalQuery(body.place);
  const saved = stored.held.filter((key) => pidOf(key) !== undefined);
  await eachAtOnce(saved, DEVICE_LIMITS.writesAtOnce, (key) => store.delete(key));
  // The zone comes with the forecast (Open-Meteo's timezone=auto), normally a cache hit: the app
  // has just shown the place.
  const today = await getToday(new URLSearchParams(`${query}&units=${body.units}`), null, r.deps);
  if (today.status !== 200) {
    return fail(503, 'upstream_unavailable', ERROR_MESSAGES.upstream_unavailable);
  }
  const { location } = today.body as TodayResponse;
  const at = new Date(r.now).toISOString();
  const record: DeviceRecord = {
    v: 1,
    id,
    app,
    platform: 'ios',
    env: body.env,
    token: body.token,
    query,
    name: location.name,
    tz: location.timezone,
    units: body.units,
    alerts,
    createdAt: stored.free?.createdAt ?? at,
    updatedAt: at,
    seenAt: at,
  };
  if (body.appVersion) record.appVersion = body.appVersion;
  const left = await saveRegistration(store, record, stored.entry);
  r.log(
    left.length
      ? `devices: moved ${who(app, id)} to ${record.tz} from ${left.join(', ')}`
      : `devices: ${stored.free ? 'updated' : 'registered'} ${who(app, id)} in ${record.tz}`,
  );
  const reply: DeviceResponse = {
    id,
    place: { name: record.name, timezone: record.tz, query },
    alerts,
    seenAt: at,
  };
  return json(200, reply);
}

/** The free place as a version 2 registration finds it: where, and what it follows. */
interface Here extends Spot {
  follows: 'device' | 'ip';
  /** When the connection last located it. */
  locatedAt?: string;
}

/**
 * The free place ("where you are"), with no forecast: the phone's location; else the town the
 * request's connection is in (`locateFromIpOnly`), as a point on the grid; else the place a
 * connection gave, for `ALERTS.ipPlaceKeepDays` after it was located; else none. A device point,
 * or an 8.1 record, is never kept without a fix (decisions 4 and 5).
 */
async function herePlace(
  r: Job,
  here: DeviceHere,
  stored: DeviceRecord | null,
  geo: VisitorGeo | null,
): Promise<Here | null> {
  if (here.source === 'device') {
    const spot = await locate(here);
    return spot && { ...spot, follows: 'device' };
  }
  const town = await locateFromIpOnly(geo);
  if (town) {
    const spot = await locate({ lat: town.lat, lon: town.lon, source: 'device' });
    return spot && { ...spot, follows: 'ip', locatedAt: new Date(r.now).toISOString() };
  }
  if (stored?.follows !== 'ip' || typeof stored.locatedAt !== 'string') return null;
  const age = r.now - Date.parse(stored.locatedAt);
  if (!(age < ALERTS.ipPlaceKeepDays * DAY)) return null;
  return { ...spotOf(stored.query), follows: 'ip', locatedAt: stored.locatedAt };
}

/** A saved place of the set: where the body has it, and its pid. */
interface Slot extends Spot {
  index: number;
  pid: string;
}

/**
 * The saved places, with no forecast, each with its pid from the salt: two that are one place
 * count once, and a city page that has gone is refused while the rest are kept (decision 34).
 */
async function savedSlots(
  saved: readonly DeviceSavedPlace[],
  salt: string,
): Promise<{ slots: Slot[]; refused: DeviceResponseV2['refused'] }> {
  const slots: Slot[] = [];
  const refused: DeviceResponseV2['refused'] = [];
  for (const [index, place] of saved.entries()) {
    const spot = await locate(place);
    if (!spot) {
      refused.push({ index, code: 'not_found' });
      continue;
    }
    if (slots.some((slot) => slot.query === spot.query)) continue;
    slots.push({ ...spot, index, pid: '' });
  }
  pidsFrom(slots, salt);
  return { slots, refused };
}

/** Gives each saved place its pid from the salt, again when the salt changes. */
function pidsFrom(slots: Slot[], salt: string): void {
  const pids = new Set<string>();
  for (const slot of slots) {
    slot.pid = placeId(salt, slot.query);
    // About one registration in 6 × 10^12: two places are never merged into one record.
    if (pids.has(slot.pid)) throw new Error(`two saved places share the pid ${slot.pid}`);
    pids.add(slot.pid);
  }
}

/**
 * Each query's place (its zone, name and country) from its forecast, all at once under one
 * budget; null for one that failed or wasn't back in time.
 */
async function lookUp(
  r: Job,
  queries: readonly string[],
  units: Units,
  budgetMs: number,
): Promise<Array<ApiLocation | null>> {
  if (!queries.length) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
  });
  try {
    return await Promise.all(
      queries.map((query) =>
        Promise.race([
          getToday(new URLSearchParams(`${query}&units=${units}`), null, r.deps).then((today) =>
            today.status === 200 ? (today.body as TodayResponse).location : null,
          ),
          late,
        ]),
      ),
    );
  } finally {
    clearTimeout(timer);
  }
}

/** What a record says of its place, kept as it is or new from a forecast. */
interface Placed {
  name: string;
  tz: string;
  country: string | null;
}

const placedFrom = (record: DeviceRecord): Placed => ({
  name: record.name,
  tz: record.tz,
  country: record.country ?? null,
});

const placedAt = (location: ApiLocation): Placed => ({
  name: location.name,
  tz: location.timezone,
  country: location.country,
});

/**
 * A version 2 body (8.4's builds): the device's set, which replaces what is stored (section
 * 3.3). The places it no longer has are deleted first, before any lookup can fail (decision 32);
 * only places new to the set are looked up, at most `ALERTS.newPlacesPerPut` saved ones (429 for
 * the rest), under one budget (503 for a failure, with the rest written).
 */
async function putSet(
  r: Job,
  body: DevicePutBodyV2,
  id: string,
  platform: DevicesPlatform,
): Promise<Response> {
  const { app, alerts } = body;
  const store = r.store();
  const at = new Date(r.now).toISOString();
  const stored = await readStored(store, app, id);
  holdBack(r, app, id, stored);
  const kept = isSet(stored.entry) ? stored.entry : null;
  const keptSalt = saltOf(stored.entry);
  let salt = keptSalt ?? newSalt();
  const here = await herePlace(r, body.here, stored.free, platform.geo ?? null);
  const { slots, refused } = await savedSlots(body.saved, salt);
  if (!here && !slots.length) {
    r.log(`devices: nothing to keep for ${who(app, id)}: not located, and no saved place`);
    await forget(r, app, id);
    return badLocation(MESSAGES.notLocated);
  }

  // 1. The places the set no longer has; and the free place when there is none, or when it was the
  // phone's location (or 8.1's) and the phone's location isn't shared now. A free place that
  // moves is deleted only once its successor is written.
  const pids = new Set(slots.map((slot) => slot.pid));
  const dropFree = !here || (here.follows === 'ip' && stored.free?.follows !== 'ip');
  const gone = stored.held.filter((key) => {
    const pid = pidOf(key);
    return pid ? !pids.has(pid) || stored.saved.get(pid)?.key !== key : dropFree;
  });
  await eachAtOnce(gone, DEVICE_LIMITS.writesAtOnce, (key) => store.delete(key));
  const removed = new Set(gone);
  const freeLeft = stored.held.filter((key) => !removed.has(key) && pidOf(key) === undefined);
  const previous = typeof kept?.updatedAt === 'string' ? kept.updatedAt : undefined;
  /** What the ids key holds, as far as this registration knows. */
  let current: unknown = stored.entry;
  // A new salt is stored before the lookups, so another registration of this device overlapping
  // this one (an app's retry, say) finds it below; a new device's only if no other is there yet.
  const salting = !keptSalt && slots.length > 0;
  if (salting) {
    const first = naming(freeLeft, salt, previous);
    const onlyIfNew = stored.entry === null;
    if (await store.set(idsKey(app, id), first, { onlyIfNew })) current = first;
  }

  // Lookups only for places new to the set: one whose query is its stored record's keeps that
  // record's zone, name and country.
  const freeKnown = here && stored.free?.query === here.query ? stored.free : null;
  const known = (slot: Slot): DeviceRecord | undefined => {
    const record = stored.saved.get(slot.pid)?.record;
    return record?.query === slot.query ? record : undefined;
  };
  const fresh = slots.filter((slot) => !known(slot));
  const added = fresh.slice(0, ALERTS.newPlacesPerPut);
  const heldBack = fresh.length - added.length;
  const askFree = here !== null && !freeKnown;
  const found = await lookUp(
    r,
    [...(askFree ? [here.query] : []), ...added.map((slot) => slot.query)],
    body.units,
    platform.putLookupMs ?? DEVICE_LIMITS.putLookupMs,
  );
  const foundFree = askFree ? (found[0] ?? null) : null;
  const foundSaved = askFree ? found.slice(1) : found;
  const failed = found.filter((location) => location === null).length;
  // The salt as stored now: one an overlapping registration stored first is taken, so each saved
  // place still has one pid, and one record.
  if (salting) {
    current = await store.get<unknown>(idsKey(app, id));
    const theirs = saltOf(current);
    if (theirs && theirs !== salt) {
      salt = theirs;
      pidsFrom(slots, salt);
    }
  }

  /** A record of the set, stamped as every record this registration writes. */
  const make = (query: string, placed: Placed, createdAt: string | undefined): DeviceRecord => {
    const made: DeviceRecord = {
      v: 1,
      id,
      app,
      platform: 'ios',
      env: body.env,
      token: body.token,
      query,
      name: placed.name,
      tz: placed.tz,
      units: body.units,
      alerts,
      createdAt: createdAt ?? at,
      updatedAt: at,
      seenAt: at,
    };
    if (body.appVersion) made.appVersion = body.appVersion;
    return made;
  };
  const savedWritten: DeviceRecord[] = [];
  for (const slot of slots) {
    const record = known(slot);
    const i = added.indexOf(slot);
    const location = i >= 0 ? foundSaved[i] : null;
    const placed = record ? placedFrom(record) : location ? placedAt(location) : null;
    // Held back by the cap, or not looked up.
    if (!placed) continue;
    const made = make(slot.query, placed, record?.createdAt);
    made.slot = slot.pid;
    made.country = placed.country;
    if (body.deviceTz) made.deviceTz = body.deviceTz;
    savedWritten.push(made);
  }
  const freePlaced = freeKnown ? placedFrom(freeKnown) : foundFree ? placedAt(foundFree) : null;
  const freeWritten =
    here && freePlaced ? make(here.query, freePlaced, stored.free?.createdAt) : null;
  if (freeWritten && here && freePlaced) {
    freeWritten.follows = here.follows;
    if (here.locatedAt) freeWritten.locatedAt = here.locatedAt;
    // One town under two names: only the saved place's notification goes (decision 23).
    const twin = slots.find(
      (slot) =>
        slot.lat === here.lat &&
        slot.lon === here.lon &&
        savedWritten.some((saved) => saved.slot === slot.pid),
    );
    if (twin) freeWritten.shadowedBy = twin.pid;
    freeWritten.country = freePlaced.country;
  }

  const keyOf = (record: DeviceRecord): string => regKey(record.tz, app, id, record.slot);
  const freeKey = freeWritten ? [keyOf(freeWritten)] : [];
  const savedKeys = savedWritten.map(keyOf);
  // The free place kept as it was (its successor not looked up) and shadowed by a saved place
  // that has gone: re-stamped without `shadowedBy`, so it notifies again (decision 23).
  const shadow = stored.free?.shadowedBy;
  const unshadowed =
    !freeWritten &&
    stored.free &&
    typeof shadow === 'string' &&
    freeLeft.includes(regKey(stored.free.tz, app, id)) &&
    !savedWritten.some((saved) => saved.slot === shadow)
      ? { ...stored.free, updatedAt: at, seenAt: at }
      : null;
  if (unshadowed) delete unshadowed.shadowedBy;
  const records = [
    ...(freeWritten ? [freeWritten] : []),
    ...(unshadowed ? [unshadowed] : []),
    ...savedWritten,
  ];
  // 2. The ids key names every record before it is written, and the salt before any pid is used.
  const named = new Set(keysOf(stored.entry, app, id));
  if (
    records.length &&
    (salt !== kept?.salt || [...freeKey, ...savedKeys].some((key) => !named.has(key)))
  ) {
    const entry = naming(unique([...freeKey, ...freeLeft, ...savedKeys]), salt, previous);
    if (JSON.stringify(entry) !== JSON.stringify(current)) await store.set(idsKey(app, id), entry);
  }
  // 3. Every record, with one stamp.
  await eachAtOnce(records, DEVICE_LIMITS.writesAtOnce, (record) =>
    store.set(keyOf(record), record),
  );
  // 4. The free place's copies in zones it left, now that its successor is written.
  const moved = freeWritten ? freeLeft.filter((key) => key !== freeKey[0]) : [];
  await eachAtOnce(moved, DEVICE_LIMITS.writesAtOnce, (key) => store.delete(key));
  // 5. The ids key naming what is there, timed for the minute's rule only once all of it is.
  // Always written, as the run may have forgotten the device meanwhile (`forgetDevice`); with
  // nothing there, deleted, if as this registration left it, so a device with no place keeps
  // nothing.
  const complete = failed === 0 && heldBack === 0;
  const there = unique([...(freeWritten ? freeKey : freeLeft), ...savedKeys]);
  if (there.length) {
    await store.set(idsKey(app, id), naming(there, salt, complete ? at : previous));
  } else if (current !== null) {
    const now = await store.get<unknown>(idsKey(app, id));
    if (JSON.stringify(now) === JSON.stringify(current)) await store.delete(idsKey(app, id));
  }

  const zones = new Set(savedWritten.map((record) => record.tz)).size;
  const counts =
    `${savedWritten.length} saved, ${zones} zone${zones === 1 ? '' : 's'}` +
    (failed ? `; ${failed} not looked up` : '') +
    (heldBack ? `; ${heldBack} held back` : '') +
    (refused.length ? `; ${refused.length} refused` : '');
  // Every zone the free place has left, whether its copy there went first or last.
  const left = freeWritten ? freeZones(stored.held).filter((zone) => zone !== freeWritten.tz) : [];
  const where = freeWritten
    ? `in ${freeWritten.tz}`
    : here
      ? '(where it is not looked up)'
      : '(not located)';
  r.log(
    freeWritten && left.length
      ? `devices: moved ${who(app, id)} to ${freeWritten.tz} from ${left.join(', ')}, ${counts}`
      : `devices: ${stored.held.length ? 'updated' : 'registered'} ${who(app, id)} ${where}, ${counts}`,
  );
  if (failed) return fail(503, 'upstream_unavailable', ERROR_MESSAGES.upstream_unavailable);
  if (heldBack) {
    return fail(429, 'rate_limited', MESSAGES.newPlaces, {
      'Retry-After': String(DEVICE_LIMITS.writeEveryMs / 1000),
    });
  }
  const reply: DeviceResponseV2 = {
    id,
    deviceTz: savedWritten.length ? (body.deviceTz ?? null) : null,
    here:
      freeWritten && here
        ? {
            name: freeWritten.name,
            timezone: freeWritten.tz,
            query: freeWritten.query,
            country: freePlaced?.country ?? null,
            follows: here.follows,
          }
        : null,
    saved: savedWritten.map((record) => ({
      pid: record.slot!,
      name: record.name,
      timezone: record.tz,
      query: record.query,
      country: record.country ?? null,
    })),
    refused,
    alerts,
    seenAt: at,
  };
  return json(200, reply);
}

/**
 * `PUT /api/v1/devices`: checks the body, then registers the device: a version 2 body for its
 * set (200 with `DeviceResponseV2`), an 8.1 body for its one place (200 with `DeviceResponse`).
 * Forgets it when the evening and morning switches are both off (204: "also when snow is
 * possible" only widens those two). Refuses a second write for the same id within a minute
 * (429 `rate_limited`).
 */
export function handleDevicePut(request: Request, platform: DevicesPlatform): Promise<Response> {
  return answer(platform, async (r) => {
    const body = checkPut(await readJson(request));
    const id = registrationId(body.app, body.token);
    if (!body.alerts.snow.evening && !body.alerts.snow.morning) {
      await forget(r, body.app, id);
      return noContent();
    }
    return 'v' in body ? putSet(r, body, id, platform) : putPlace(r, body, id);
  });
}

/** `DELETE /api/v1/devices` with `{ app, token }`: 204, whether or not anything was stored. */
export function handleDeviceDelete(request: Request, platform: DevicesPlatform): Promise<Response> {
  return answer(platform, async (r) => {
    const { app, token } = checkIdentity(await readJson(request));
    await forget(r, app, registrationId(app, token));
    return noContent();
  });
}

/** `/api/v1/devices`: PUT registers, DELETE forgets. */
export function handleDevices(request: Request, platform: DevicesPlatform): Promise<Response> {
  if (request.method === 'PUT') return handleDevicePut(request, platform);
  if (request.method === 'DELETE') return handleDeviceDelete(request, platform);
  return Promise.resolve(
    json(
      405,
      { error: { code: 'method_not_allowed', message: 'Use PUT or DELETE.' } },
      { Allow: 'PUT, DELETE' },
    ),
  );
}

// ---- The test send ----

/** An hour of the day as the quiet hours' message says it: 21 is "9pm", 7 is "7am". */
const hourName = (h: number): string => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;

/**
 * A test in the quiet hours (21:00 to 06:59 by core's `inQuietHours`, the sender's own rule):
 * 409 `quiet_hours`, with `Retry-After` to when they end. By the phone's clock (`onPhone`) when
 * a saved place is tested, else at the place, in the words 8.1's app shows.
 */
function quietHours(r: Job, tz: string, name: string, onPhone: boolean): never {
  const { from, to } = ALERTS.quiet;
  const hours = localDateTime(tz, new Date(r.now)).hours;
  // A saved place's test can take the zone from the saved place, which is never logged.
  r.log(`devices: test not sent to ${name}: quiet hours ${onPhone ? 'on the phone' : `in ${tz}`}`);
  const until = hourName(to);
  return fail(
    409,
    'quiet_hours',
    onPhone
      ? `Nothing is sent from ${hourName(from)} to ${until} on your iPhone. Try again after ${until}.`
      : `Nothing is sent from ${hourName(from)} to ${until} at the place. Try again after ${until} there.`,
    // In whole minutes, as the clock reads: 3.91666… hours is 235 minutes, not 14,100.000…2 s.
    { 'Retry-After': String(Math.round(((to - hours + 24) % 24) * 60) * 60) },
  );
}

/** The key for the record's APNs environment; a missing or unreadable one is a 503. */
function pushKey(r: Job, platform: Platform, env: ApnsEnv): ApnsKey {
  let key: ApnsKey | { missing: string[] };
  try {
    key = apnsKey(platform.env, env);
  } catch (err) {
    // The setting holds something other than a key; the message never quotes it.
    r.log(`devices: error: the ${env} APNs key: ${(err as Error).message}`);
    return pushDown();
  }
  if ('missing' in key) {
    r.log(`devices: error: no ${env} APNs key: missing ${key.missing.join(', ')}`);
    return pushDown();
  }
  return key;
}

/** The place's snow answer for the record's query and units, or null after `waitMs` or a failure. */
async function snowFor(r: Job, record: DeviceRecord, waitMs: number): Promise<ApiSnow | null> {
  const params = new URLSearchParams(`${record.query}&units=${record.units}`);
  const asked = getToday(params, null, r.deps).then(
    (result) => (result.status === 200 ? ((result.body as TodayResponse).snow ?? null) : null),
    () => null,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs);
  });
  try {
    return await Promise.race([asked, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A place's test push: tomorrow's real evening notification when the rule sends one for the
 * place (with the record's "possible" choice, whatever its evening switch says), else the fixed
 * words. A saved place's has its own collapse id and thread. Priority 10 and a short expiry,
 * since someone is waiting for it.
 */
async function testPush(
  r: Job,
  record: DeviceRecord,
  waitMs: number,
): Promise<{ push: AlertPush; real: boolean }> {
  const snow = await snowFor(r, record, waitMs);
  const prefs = { ...record.alerts.snow, evening: true };
  const real = snow ? snowAlert(snow, 'evening', prefs, record.name) : null;
  const { slot } = record;
  const push = alertPush({
    record,
    alert: real ?? { ...testAlert(record.name), relevance: SNOW_RELEVANCE.maybesnow },
    topic: 'snow',
    kind: 'evening',
    date: real?.date ?? localDate(record.tz, new Date(r.now)),
    collapseId: real
      ? collapseId('snow', 'evening', real.date, slot)
      : slot
        ? `${TEST_COLLAPSE_ID}-${slot}`
        : TEST_COLLAPSE_ID,
    thread: threadId('snow', slot),
    expiration: Math.floor(r.now / 1000) + DEVICE_LIMITS.testExpirySeconds,
    priority: 10,
  });
  return { push, real: real !== null };
}

/** The last saved place the ids key names whose record is there: the one saved most recently. */
function lastSaved(stored: Stored): DeviceRecord | null {
  const named = isSet(stored.entry) && Array.isArray(stored.entry.saved) ? stored.entry.saved : [];
  for (const key of [...named].reverse()) {
    const pid = typeof key === 'string' ? pidOf(key) : undefined;
    const found = pid ? stored.saved.get(pid) : undefined;
    if (found?.key === key) return found.record;
  }
  return null;
}

/**
 * `POST /api/v1/devices/test` with `{ app, token }`: a notification now for where the phone is
 * (unless a saved place stands for it) and for the saved place saved last, never more than two,
 * on one of the hour's tests (202 `{ sent: true }`, with `count: 2` for two). They go through the
 * run's sender (`sendAlerts`), one after another on one session, so Apple's answers are acted on
 * as the run acts on them, and the provider token is the run's.
 * - 404 `not_registered` without a registration, or once Apple has refused the device;
 * - 409 `quiet_hours` from 21:00 to 06:59 on the phone (at the place with no saved place);
 * - 429 `test_limited` after `ALERTS.testPerHour` in the hour (UTC) for the id;
 * - 503 `push_unavailable` without the environment's key, or when Apple can't take it now;
 * - 502 `push_refused` for any other refusal.
 */
export function handleDeviceTest(request: Request, platform: DevicesPlatform): Promise<Response> {
  return answer(platform, async (r) => {
    const { app, token } = checkIdentity(await readJson(request));
    const id = registrationId(app, token);
    const name = who(app, id);
    const store = r.store();
    const stored = await readStored(store, app, id);
    const saved = lastSaved(stored);
    const { free } = stored;
    const records = [
      ...(free && !(free.shadowedBy && saved) ? [free] : []),
      ...(saved ? [saved] : []),
    ];
    if (!records.length) return fail(404, 'not_registered', MESSAGES.notRegistered);
    // The phone's own clock: its zone as a saved place keeps it, else where it is.
    const phoneTz = saved?.deviceTz ?? free?.tz ?? records[0]!.tz;
    // Before the hour's slot is claimed, so a test pressed at night costs none of the three.
    if (inQuietHours(phoneTz, new Date(r.now))) quietHours(r, phoneTz, name, saved !== null);
    const dryRun = alertsDryRun(platform.env, platform.deployContext, 'test');
    const env = records[0]!.env;
    // Before the claim, so a missing key costs no test.
    const keys: Partial<Record<ApnsEnv, ApnsKey>> = {};
    if (!dryRun) keys[env] = pushKey(r, platform, env);
    if (!(await claimTestSend(store, id, r.now, ALERTS.testPerHour))) {
      const toNextHour = 3600 - Math.floor((r.now % 3_600_000) / 1000);
      return fail(
        429,
        'test_limited',
        `That's ${ALERTS.testPerHour} test notifications this hour. Try again later.`,
        { 'Retry-After': String(toNextHour) },
      );
    }
    // Their forecasts at once, under the one wait.
    const waitMs = platform.testForecastWaitMs ?? DEVICE_LIMITS.testForecastWaitMs;
    const pushes = await Promise.all(records.map((record) => testPush(r, record, waitMs)));
    // The slot claimed above counts them, so the pushes themselves go unclaimed. The sender's
    // quiet hours are the phone's, as above.
    const deliveries: Delivery[] = records.map((record, i) => ({
      record,
      claimKey: null,
      push: pushes[i]!.push,
      quietTz: phoneTz,
    }));
    // One after another, on one session; once Apple refuses the token, the sender forgets the
    // phone and sends it nothing more.
    const clock = (): number => r.deps.now().getTime();
    const { results } = await sendAlerts({
      store,
      deliveries,
      keys,
      now: r.now,
      apnsConcurrency: 1,
      quiet: ALERTS.quiet,
      log: r.log,
      connect:
        platform.connect ??
        ((e: ApnsEnv) => apnsSender(APNS_ORIGINS[e], DEVICE_LIMITS.testApnsTimeoutMs)),
      deadline: clock() + DEVICE_LIMITS.testDeadlineMs,
      clock,
      dryRun,
    });
    const outcomes = results.map(({ outcome }, i) => {
      const record = records[i]!;
      const whom = who(app, id, record.slot);
      const words = pushes[i]!.real ? 'the evening notification' : 'the test words';
      // The sender has logged what Apple said, if it said anything worth a line.
      const why = outcome === 'logged' ? 'a dry run' : outcome;
      r.log(
        outcome === 'sent'
          ? `devices: test sent to ${whom} (${record.env}, ${words})`
          : `devices: test not sent to ${whom} (${record.env}, ${words}): ${why}`,
      );
      return outcome;
    });
    const sent = outcomes.filter((outcome) => outcome === 'sent').length;
    if (outcomes.includes('deleted')) {
      return fail(
        404,
        'not_registered',
        'Apple refused this device, so it is no longer registered.',
      );
    }
    if (sent > 1) return json(202, { sent: true, count: sent } satisfies DeviceTestResponse);
    if (sent) return json(202, { sent: true } satisfies DeviceTestResponse);
    if (outcomes.includes('logged')) {
      return json(202, { sent: false, dryRun: true } satisfies DeviceTestResponse);
    }
    if (outcomes.includes('kept')) {
      return fail(502, 'push_refused', 'Apple refused the test notification.');
    }
    // Checked above at the same moment, so never; the sender asserts it all the same.
    if (outcomes.includes('quiet')) return quietHours(r, phoneTz, name, saved !== null);
    // Released (403, 429, 5xx, no answer) or deferred (no provider token, no session).
    return pushDown();
  });
}
