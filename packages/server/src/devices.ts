/**
 * The apps' notification registrations (iOS build spec, sections 8.2 and 8.3):
 * - `PUT /api/v1/devices` registers a device's push token for a place, its units and its
 *   switches, or forgets it when every switch is off;
 * - `DELETE /api/v1/devices` forgets it;
 * - `POST /api/v1/devices/test` sends one notification now.
 *
 * There are no accounts: the push token is the credential, and a registration's id is the first
 * 32 hex characters of sha256(app + ':' + token).
 *
 * **What is stored** (Blobs store `isithot-alerts`): the record at `reg/v1/<tz>/<app>.<id>`, and at
 * `ids/v1/<app>.<id>` the zone it is in. Only these handlers write either key, and each write
 * replaces the value whole. While a move between zones is unfinished, the ids key also names the
 * zones left (`from`). So a DELETE that follows a move cut short by a failure still finds every
 * copy:
 * 1. the ids key, naming the new zone and the old;
 * 2. the record in the new zone;
 * 3. delete the old records;
 * 4. the ids key again, naming the new zone only.
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
  localDate,
  localDateTime,
  snowAlert,
  testAlert,
  type ApiSnow,
  type TodayResponse,
  type TopicAlertPrefs,
  type Units,
} from '@isithot/core';
import { alertsDryRun, type AlertRecord } from './alerts';
import {
  AlertStoreError,
  SafeAlertStore,
  claimTestSend,
  createBlobsAlertStore,
  idPrefix,
  idsKey,
  redact,
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
} from './apns';
import { createDeps, type Platform, type ServerDeps } from './deps';
import { NO_STORE } from './http';
import { getToday, locateCity, locateFromCoords, type Located } from './today';

/** The apps a registration may name. One registration per install per app. */
export const DEVICE_APPS = ['snow', 'wet', 'wind', 'hot', 'all'] as const;
export type DeviceApp = (typeof DEVICE_APPS)[number];

/** The apps whose notifications are live: snow's only. */
export const LIVE_DEVICE_APPS: readonly DeviceApp[] = ['snow'];

export const DEVICE_LIMITS = {
  /** The largest body, bytes. */
  bodyBytes: 2048,
  /**
   * At most one write per id in this long, ms. Netlify's rule (below) may not apply on every plan,
   * so the handler checks too. A delete is never refused.
   */
  writeEveryMs: 60_000,
  /** Netlify's rule on both functions: requests a minute per IP on each domain. */
  perMinute: 10,
  /** How long a test waits for the forecast before sending the fixed words, ms. */
  testForecastWaitMs: 3_000,
  /** How long a test waits for Apple's answer, ms. */
  testApnsTimeoutMs: 5_000,
  /** How long Apple keeps trying to deliver a test notification, seconds. */
  testExpirySeconds: 15 * 60,
} as const;

/** The fixed test notification's collapse id: a second test replaces the first on the phone. */
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

/** The body of `DELETE /api/v1/devices` and `POST /api/v1/devices/test`. */
export interface DeviceIdentity {
  app: DeviceApp;
  token: string;
}

/**
 * What `ids/v1/<app>.<id>` holds: the registration's zone and, while a move between zones is
 * unfinished, the zones it left.
 */
export interface DeviceIdsEntry {
  tz: string;
  from?: string[];
}

/**
 * A registration, as `reg/v1/<tz>/<app>.<id>` holds it (section 8.2). It is the run's
 * `AlertRecord`, narrowed, so what these handlers write is what the run reads.
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
}

/** `PUT /api/v1/devices`'s answer, which the app shows in "Your privacy". */
export interface DeviceResponse {
  id: string;
  place: { name: string; timezone: string; query: string };
  alerts: { snow: TopicAlertPrefs };
  seenAt: string;
}

/**
 * `POST /api/v1/devices/test`'s answer. `dryRun` (with `sent: false`) only in a dry run, until
 * ALERTS_DRY_RUN is false (`alertsDryRun`).
 */
export interface DeviceTestResponse {
  sent: boolean;
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

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function checkAppVersion(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > 40 || CONTROL.test(value)) {
    return bad('appVersion must be text of at most 40 characters.');
  }
  return value.trim() || undefined;
}

/**
 * The place, in one of its three forms. As with `/api/v1/today`, coordinates win over a slug; a
 * place with neither (the IP location's empty form) is refused, since notifications are for a
 * place someone chose.
 */
function checkPlace(value: unknown): DevicePlace {
  if (!isObject(value)) return badLocation(MESSAGES.noPlace);
  if (value.lat !== undefined || value.lon !== undefined) {
    const { lat, lon, source } = value;
    if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) {
      return badLocation('place.lat and place.lon must be numbers.');
    }
    if (source === 'device') return { lat, lon, source };
    if (source !== 'search') return badLocation('place.source must be search or device.');
    const place: Extract<DevicePlace, { source: 'search' }> = { lat, lon, source };
    for (const key of ['name', 'region', 'country'] as const) {
      const text = value[key];
      if (text === undefined || text === null) continue;
      if (typeof text !== 'string') return badLocation(`place.${key} must be text.`);
      place[key] = text;
    }
    for (const key of ['geonameId', 'elevation'] as const) {
      const number = value[key];
      if (number === undefined || number === null) continue;
      if (!isFiniteNumber(number)) return badLocation(`place.${key} must be a number.`);
      place[key] = number;
    }
    return place;
  }
  if (value.place !== undefined) {
    if (typeof value.place !== 'string' || !value.place.trim()) {
      return badLocation('place.place must be a city slug.');
    }
    return { place: value.place.trim() };
  }
  return badLocation(MESSAGES.noPlace);
}

/** The whole body checked, field by field, before anything is read or written. */
function checkPut(body: unknown): DevicePutBody {
  if (!isObject(body)) return bad('The body must be a JSON object.');
  const app = checkApp(body.app);
  if (body.platform !== 'ios') bad('platform must be ios.');
  const env = body.env;
  if (env !== 'sandbox' && env !== 'production') return bad('env must be sandbox or production.');
  const token = checkToken(body.token);
  const units = body.units;
  if (units !== 'c' && units !== 'f') return bad('units must be c or f.');
  const alerts = { snow: checkPrefs(body.alerts) };
  const appVersion = checkAppVersion(body.appVersion);
  const place = checkPlace(body.place);
  const out: DevicePutBody = { app, platform: 'ios', env, token, place, units, alerts };
  if (appVersion) out.appVersion = appVersion;
  return out;
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

/** Locates the place as `/api/v1/today` would, and gives its canonical query. */
async function canonicalQuery(place: DevicePlace): Promise<string> {
  if ('place' in place) {
    const city = locateCity(place.place);
    return city ? canonicalPlaceQuery(city) : badLocation(ERROR_MESSAGES.not_found);
  }
  const params = new URLSearchParams({ lat: String(place.lat), lon: String(place.lon) });
  if (place.source === 'search') {
    if (place.name !== undefined) params.set('name', place.name);
    if (place.region !== undefined) params.set('region', place.region);
    if (place.country !== undefined) params.set('country', place.country);
    if (place.geonameId !== undefined) params.set('geonameId', String(place.geonameId));
    if (place.elevation !== undefined) params.set('elevation', String(place.elevation));
  }
  params.set('source', place.source);
  const located = await locateFromCoords(params);
  return located ? canonicalPlaceQuery(located) : badLocation(ERROR_MESSAGES.bad_location);
}

// ---- The store ----

/** Every zone an ids key names, its own first; none for anything malformed. */
function zonesOf(where: unknown): string[] {
  if (!isObject(where)) return [];
  const from = Array.isArray(where.from) ? where.from : [];
  return [...new Set([where.tz, ...from].filter((z): z is string => typeof z === 'string'))];
}

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

interface Found {
  /** What the ids key holds, or null. */
  where: unknown;
  /** The newest record it points at (its own zone first), or null. */
  record: DeviceRecord | null;
}

async function findRegistration(store: AlertStore, app: DeviceApp, id: string): Promise<Found> {
  const where = await store.get<unknown>(idsKey(app, id));
  for (const zone of zonesOf(where)) {
    const record = await store.get<unknown>(regKey(zone, app, id));
    if (isRecord(record)) return { where, record };
  }
  return { where, record: null };
}

/** Writes the record (steps 1 to 4 above); gives the zones it left. */
async function saveRegistration(
  store: AlertStore,
  record: DeviceRecord,
  where: unknown,
): Promise<string[]> {
  const { app, id, tz } = record;
  const left = zonesOf(where).filter((zone) => zone !== tz);
  const current = isObject(where) && where.tz === tz && where.from === undefined;
  if (!current) {
    const naming: DeviceIdsEntry = left.length ? { tz, from: left } : { tz };
    await store.set(idsKey(app, id), naming);
  }
  await store.set(regKey(tz, app, id), record);
  for (const zone of left) await store.delete(regKey(zone, app, id));
  if (left.length) await store.set(idsKey(app, id), { tz } satisfies DeviceIdsEntry);
  return left;
}

// ---- Each request ----

interface Job {
  /** For `getToday`: its log lines lose the grid cells in its cache keys (`placeLess`). */
  deps: ServerDeps;
  /** The request's one moment, ms. */
  now: number;
  log: (line: string) => void;
  store(): AlertStore;
}

/**
 * A line without the coordinates in it: `getToday` names a forecast or climate cache entry by its
 * grid cell ("forecast/v7/54.80,-1.60/50"), which here is a registration's place.
 */
export function placeLess(line: string): string {
  return line.replace(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g, '<place>');
}

function begin(platform: DevicesPlatform): Job {
  const deps = platform.deps ?? { ...createDeps(platform), climateWaitMs: 0 };
  const log = (line: string): void => deps.log(redact(line));
  const onError = (err: AlertStoreError): void => log(err.message);
  let store: AlertStore | undefined;
  return {
    deps: { ...deps, log: (line) => log(placeLess(line)) },
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
  let log = (line: string): void => console.log(`[isithot] ${redact(line)}`);
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
    log(placeLess(`devices: error: ${(err as Error)?.message ?? String(err)}`));
    return errorReply(
      new DeviceError(500, 'server_error', 'Something went wrong. Try again later.'),
    );
  }
}

/** A registration as a log names it: "snow.3f9c1a2b…". */
const who = (app: string, id: string): string => `${app}.${idPrefix(id)}`;

/** Deletes every copy of a registration and its ids key; nothing stored is fine. */
async function forget(r: Job, app: DeviceApp, id: string): Promise<void> {
  const store = r.store();
  const where = await store.get<unknown>(idsKey(app, id));
  if (where === null) {
    r.log(`devices: nothing to delete for ${who(app, id)}`);
    return;
  }
  for (const zone of zonesOf(where)) await store.delete(regKey(zone, app, id));
  await store.delete(idsKey(app, id));
  r.log(`devices: deleted ${who(app, id)}`);
}

/**
 * `PUT /api/v1/devices`: checks the body, then registers the device for its place (200 with
 * `DeviceResponse`), or forgets it when the evening and morning switches are both off
 * (204: "also when snow is possible" only widens those two). Refuses a second write for the same
 * id within a minute (429 `rate_limited`).
 */
export function handleDevicePut(request: Request, platform: DevicesPlatform): Promise<Response> {
  return answer(platform, async (r) => {
    const body = checkPut(await readJson(request));
    const { app, alerts } = body;
    const id = registrationId(app, body.token);
    if (!alerts.snow.evening && !alerts.snow.morning) {
      await forget(r, app, id);
      return noContent();
    }
    const store = r.store();
    const found = await findRegistration(store, app, id);
    if (found.record) {
      const age = r.now - Date.parse(found.record.updatedAt);
      if (age > -DEVICE_LIMITS.writeEveryMs && age < DEVICE_LIMITS.writeEveryMs) {
        r.log(`devices: refused ${who(app, id)}: written ${Math.round(age / 1000)} s ago`);
        fail(429, 'rate_limited', 'One change a minute for each device. Try again shortly.', {
          'Retry-After': String(Math.ceil((DEVICE_LIMITS.writeEveryMs - age) / 1000)),
        });
      }
    }
    const query = await canonicalQuery(body.place);
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
      createdAt: found.record?.createdAt ?? at,
      updatedAt: at,
      seenAt: at,
    };
    if (body.appVersion) record.appVersion = body.appVersion;
    const left = await saveRegistration(store, record, found.where);
    r.log(
      left.length
        ? `devices: moved ${who(app, id)} to ${record.tz} from ${left.join(', ')}`
        : `devices: ${found.record ? 'updated' : 'registered'} ${who(app, id)} in ${record.tz}`,
    );
    const reply: DeviceResponse = {
      id,
      place: { name: record.name, timezone: record.tz, query },
      alerts,
      seenAt: at,
    };
    return json(200, reply);
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
 * A test in the quiet hours at the place (21:00 to 06:59 by core's `inQuietHours`, the sender's
 * own rule): 409 `quiet_hours`, with `Retry-After` to when they end there.
 */
function quietHours(r: Job, record: DeviceRecord, name: string): never {
  const { from, to } = ALERTS.quiet;
  const hours = localDateTime(record.tz, new Date(r.now)).hours;
  r.log(`devices: test not sent to ${name}: quiet hours in ${record.tz}`);
  const until = hourName(to);
  return fail(
    409,
    'quiet_hours',
    `Nothing is sent from ${hourName(from)} to ${until} at the place. Try again after ${until} there.`,
    { 'Retry-After': String(Math.ceil(((to - hours + 24) % 24) * 3600)) },
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
 * The test's push: tomorrow's real evening notification when the rule sends one for the place
 * (with the record's "possible" choice, whatever its evening switch says), else the fixed words.
 * Priority 10 and a short expiry, since someone is waiting for it.
 */
async function testPush(
  r: Job,
  record: DeviceRecord,
  waitMs: number,
): Promise<{ push: AlertPush; real: boolean }> {
  const snow = await snowFor(r, record, waitMs);
  const prefs = { ...record.alerts.snow, evening: true };
  const real = snow ? snowAlert(snow, 'evening', prefs, record.name) : null;
  const push = alertPush({
    record,
    alert: real ?? { ...testAlert(record.name), relevance: SNOW_RELEVANCE.maybesnow },
    topic: 'snow',
    kind: 'evening',
    date: real?.date ?? localDate(record.tz, new Date(r.now)),
    collapseId: real ? collapseId('snow', 'evening', real.date) : TEST_COLLAPSE_ID,
    expiration: Math.floor(r.now / 1000) + DEVICE_LIMITS.testExpirySeconds,
    priority: 10,
  });
  return { push, real: real !== null };
}

/**
 * `POST /api/v1/devices/test` with `{ app, token }`: one notification now for the registered
 * place (202 `{ sent: true }`). It goes through the run's sender (`sendAlerts`), so Apple's
 * answers are acted on as the run acts on them, and the provider token is the run's.
 * - 404 `not_registered` without a registration, or once Apple has refused the device;
 * - 409 `quiet_hours` from 21:00 to 06:59 at the place, when nothing is ever sent;
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
    const { record } = await findRegistration(store, app, id);
    if (!record) return fail(404, 'not_registered', MESSAGES.notRegistered);
    // Before the hour's slot is claimed, so a test pressed at night costs none of the three.
    if (inQuietHours(record.tz, new Date(r.now))) quietHours(r, record, name);
    const dryRun = alertsDryRun(platform.env, platform.deployContext, 'test');
    const env = record.env;
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
    const { push, real } = await testPush(
      r,
      record,
      platform.testForecastWaitMs ?? DEVICE_LIMITS.testForecastWaitMs,
    );
    const words = real ? 'the evening notification' : 'the test words';

    // The slot claimed above counts it, so the push itself goes unclaimed.
    const { results } = await sendAlerts({
      store,
      deliveries: [{ record, claimKey: null, push }],
      keys,
      now: r.now,
      apnsConcurrency: 1,
      quiet: ALERTS.quiet,
      log: r.log,
      connect:
        platform.connect ??
        ((e: ApnsEnv) => apnsSender(APNS_ORIGINS[e], DEVICE_LIMITS.testApnsTimeoutMs)),
      dryRun,
    });
    const outcome = results[0]?.outcome;
    // The sender has logged what Apple said, if it said anything worth a line.
    const why = outcome === 'logged' ? 'a dry run' : String(outcome);
    r.log(
      outcome === 'sent'
        ? `devices: test sent to ${name} (${env}, ${words})`
        : `devices: test not sent to ${name} (${env}, ${words}): ${why}`,
    );
    switch (outcome) {
      case 'sent':
        return json(202, { sent: true } satisfies DeviceTestResponse);
      case 'logged':
        return json(202, { sent: false, dryRun: true } satisfies DeviceTestResponse);
      case 'deleted':
        return fail(
          404,
          'not_registered',
          'Apple refused this device, so it is no longer registered.',
        );
      case 'kept':
        return fail(502, 'push_refused', 'Apple refused the test notification.');
      case 'quiet':
        // Checked above at the same moment, so never; the sender asserts it all the same.
        return quietHours(r, record, name);
      default:
        // Released (403, 429, 5xx, no answer) or deferred (no provider token, no session).
        return pushDown();
    }
  });
}
