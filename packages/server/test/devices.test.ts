import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  verify,
  type KeyObject,
} from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { IncomingHttpHeaders } from 'node:http2';
import { createServer as createHttpServer } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setEnvironmentContext } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { ALERTS } from '@isithot/core';
import { createSyntheticFetch, type FetchLike } from '@isithot/providers';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CLIENT,
  PLACES,
  alertAction,
  deviceTarget,
  notificationRoute,
  registrationBody,
  searchTarget,
  targetKey,
  type AlertPrefs,
  type PlaceTarget,
  type RegistrationBody,
} from '../../client/src';
import {
  CITIES,
  DEVICE_LIMITS,
  MemoryAlertStore,
  MemoryKV,
  apnsSender,
  forgetDevice,
  handleDeviceDelete,
  handleDevicePut,
  handleDeviceTest,
  handleDevices,
  idsKey,
  jwtKey,
  placeId,
  regKey,
  registrationId,
  resolveServerConfig,
  type AlertListing,
  type AlertStore,
  type ApnsEnv,
  type ApnsSender,
  type DeviceIdsEntryV2,
  type DeviceRecord,
  type DevicesPlatform,
  type ServerDeps,
  type VisitorGeo,
} from '../src';
import type * as AlertStoreModule from '../src/alertStore';
import { closeFakes, fakeApns, type FakeReply } from './fakeApns';

// A pid is an HMAC, so two places sharing one can't be found: the test for it stands one in.
vi.mock('../src/alertStore', async (importOriginal) => {
  const actual = await importOriginal<typeof AlertStoreModule>();
  return { ...actual, placeId: vi.fn(actual.placeId) };
});

afterEach(closeFakes);

// ---- Fixtures ----

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const iso = (t: number): string => new Date(t).toISOString();

/** 18:05 in the UK on 11 November 2026 (GMT): snow is likely tomorrow in Durham and Hexham, not Leeds. */
const SNOWY = Date.UTC(2026, 10, 11, 18, 5);
/** 18:05 on 28 October 2026: snow is possible tomorrow in Durham (2 of 6 forecasts). */
const POSSIBLE = Date.UTC(2026, 9, 28, 18, 5);

// Throwaway P-256 keys, one per environment, as Apple's .p8 files are.
const makeKey = (keyId: string): { pem: string; publicKey: KeyObject; keyId: string } => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  return { pem, publicKey: createPublicKey(privateKey), keyId };
};
const SANDBOX = makeKey('SANDBOX001');
const PRODUCTION = makeKey('PRODUCT001');
const PUBLIC: Record<string, KeyObject> = {
  [SANDBOX.keyId]: SANDBOX.publicKey,
  [PRODUCTION.keyId]: PRODUCTION.publicKey,
};
/** The functions' settings: both keys, and sending switched on wherever the test runs. */
const SETTINGS: Record<string, string> = {
  APNS_TEAM_ID: 'TEAM123456',
  APNS_KEY_ID_SANDBOX: SANDBOX.keyId,
  APNS_KEY_SANDBOX: SANDBOX.pem,
  APNS_KEY_ID_PRODUCTION: PRODUCTION.keyId,
  APNS_KEY_PRODUCTION: PRODUCTION.pem,
  ALERTS_DRY_RUN: 'false',
};

/** Every token used, so the log check can look for any part of one. */
const TOKENS = new Set<string>();
/**
 * A 64-hex device token. Its first two characters tell the fake APNs how to answer (`apple`), and
 * `n` makes it a device of its own.
 */
const token = (script = 'aa', n = 0): string => {
  const t = `${script}${n.toString(16).padStart(6, '0')}${'c'.repeat(56)}`;
  TOKENS.add(t);
  return t;
};
const idOf = (t: string): string => registrationId('snow', t);

const LEEDS = { place: 'leeds-gb' };
const DURHAM = { place: 'durham-gb' };
const NEW_YORK = { place: 'new-york-city-us' };
const HEXHAM = {
  lat: 54.97,
  lon: -2.1,
  name: 'Hexham',
  region: 'England',
  country: 'GB',
  geonameId: 2647007,
  elevation: 50,
  source: 'search',
};
const HEXHAM_QUERY =
  'lat=54.95&lon=-2.1&name=Hexham&region=England&country=GB&geonameId=2647007&elevation=50&source=search';
const EVENING: AlertPrefs = { evening: true, morning: false, possible: false };

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    app: 'snow',
    platform: 'ios',
    env: 'sandbox',
    token: token(),
    place: LEEDS,
    units: 'c',
    alerts: { snow: EVENING },
    appVersion: '1.0 (112)',
    ...over,
  };
}

/** Every line any handler logged, and every store failure, for the check that nothing secret is in them. */
const logged: string[] = [];

interface World {
  store: MemoryAlertStore;
  platform: DevicesPlatform;
  /** Moves the clock. */
  at(t: number): void;
  /** The path of every forecast fetched. */
  forecasts: string[];
  lines: string[];
}

function world(
  o: {
    now?: number;
    settings?: Record<string, string | undefined>;
    deployContext?: string;
    store?: AlertStore | null;
    connect?: (env: ApnsEnv) => ApnsSender;
    fetch?: (synthetic: FetchLike) => FetchLike;
    testForecastWaitMs?: number;
    geo?: VisitorGeo | null;
    putLookupMs?: number;
  } = {},
): World {
  let now = o.now ?? SNOWY;
  const forecasts: string[] = [];
  const lines: string[] = [];
  const synthetic = createSyntheticFetch(CITIES, () => new Date(now));
  const counted: FetchLike = async (url, init) => {
    if (new URL(url).pathname.endsWith('/forecast')) forecasts.push(new URL(url).pathname);
    return synthetic(url, init);
  };
  const deps: ServerDeps = {
    config: resolveServerConfig(() => undefined),
    cache: new MemoryKV(),
    fetch: o.fetch ? o.fetch(counted) : counted,
    now: () => new Date(now),
    waitUntil: () => {},
    log: (line) => {
      lines.push(line);
      logged.push(line);
    },
    climateWaitMs: 0,
  };
  const store = new MemoryAlertStore();
  const settings = { ...SETTINGS, ...o.settings };
  const platform: DevicesPlatform = {
    env: (name) => settings[name],
    deployContext: o.deployContext ?? 'production',
    deps,
  };
  if (o.store !== null) platform.store = o.store ?? store;
  if (o.connect) platform.connect = o.connect;
  if (o.testForecastWaitMs !== undefined) platform.testForecastWaitMs = o.testForecastWaitMs;
  if (o.geo !== undefined) platform.geo = o.geo;
  if (o.putLookupMs !== undefined) platform.putLookupMs = o.putLookupMs;
  return {
    store,
    platform,
    at: (t) => {
      now = t;
    },
    forecasts,
    lines,
  };
}

const DEVICES = 'https://willitsnow.today/api/v1/devices';
const send = (method: string, b: unknown): Request =>
  new Request(method === 'POST' ? `${DEVICES}/test` : DEVICES, {
    method,
    body: typeof b === 'string' ? b : JSON.stringify(b),
  });
const put = (w: World, b: unknown) => handleDevicePut(send('PUT', b), w.platform);
const del = (w: World, b: unknown) => handleDeviceDelete(send('DELETE', b), w.platform);
const sendTest = (w: World, b: unknown) => handleDeviceTest(send('POST', b), w.platform);

const errorOf = async (r: Response) =>
  ((await r.json()) as { error: { code: string; message: string } }).error;

async function record(w: World, tz: string, t: string): Promise<DeviceRecord | null> {
  return w.store.get<DeviceRecord>(regKey(tz, 'snow', idOf(t)));
}

// ---- Version 2: a device's set ----

const DAY = 24 * HOUR;
const IP = { source: 'ip' };
/** Netlify's geo for a connection in Leeds: its 0.05° cell is Leeds city page's. */
const LEEDS_GEO: VisitorGeo = {
  city: 'Leeds',
  country: 'GB',
  region: 'England',
  lat: 53.7965,
  lon: -1.5478,
};
const LEEDS_CELL = 'lat=53.8&lon=-1.55&source=device';
const NEWCASTLE_GEO: VisitorGeo = {
  city: 'Newcastle upon Tyne',
  country: 'GB',
  region: 'England',
  lat: 54.9881,
  lon: -1.6194,
};
const NEW_YORK_GEO: VisitorGeo = {
  city: 'New York',
  country: 'US',
  region: 'New York',
  lat: 40.7128,
  lon: -74.006,
};
// Saved places in zones no free place has in these tests, so the log check can look for them.
const HELSINKI = { place: 'helsinki-fi' };
const TOKYO = { place: 'tokyo-jp' };
const REYKJAVIK = { place: 'reykjavik-is' };
const OSLO = { place: 'oslo-no' };
const KATHMANDU = { lat: 27.7, lon: 85.3, source: 'search', name: 'Kathmandu', country: 'NP' };
const KATHMANDU_QUERY = 'lat=27.7&lon=85.3&name=Kathmandu&country=NP&source=search';
const SAVED_ONLY_ZONES = ['Etc/GMT-2', 'Etc/GMT-9', 'Etc/GMT+1', 'Etc/GMT-1', 'Etc/GMT-6'];
/** Every zone a version 2 reply gave a saved place. */
const SAVED_ZONES = new Set<string>();

/** A version 2 body, as 8.4's app sends it: where the phone is from its connection, no saved place. */
function body2(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 2,
    app: 'snow',
    platform: 'ios',
    env: 'sandbox',
    token: token(),
    units: 'c',
    appVersion: '1.0 (130)',
    deviceTz: 'Europe/London',
    alerts: { snow: EVENING },
    here: IP,
    saved: [],
    ...over,
  };
}

interface PlaceReply {
  name: string;
  timezone: string;
  query: string;
  country: string | null;
}
interface Reply2 {
  id: string;
  deviceTz: string | null;
  here: (PlaceReply & { follows: 'device' | 'ip' }) | null;
  saved: Array<PlaceReply & { pid: string }>;
  refused: Array<{ index: number; code: string }>;
  alerts: { snow: AlertPrefs };
  seenAt: string;
}

/** `put`, noting the zones a 200's saved places are in for the log check. */
async function put2(w: World, b: unknown): Promise<Response> {
  const r = await put(w, b);
  if (r.status === 200) {
    for (const { timezone } of ((await r.clone().json()) as Reply2).saved) {
      SAVED_ZONES.add(timezone);
    }
  }
  return r;
}

const reply2 = async (r: Response): Promise<Reply2> => (await r.json()) as Reply2;
const idsOf = (w: World, t: string) => w.store.get<DeviceIdsEntryV2>(idsKey('snow', idOf(t)));
/** The device's ids key and records, sorted. */
const keysFor = (w: World, t: string) =>
  w.store.keys().filter((k) => /^(reg|ids)\//.test(k) && k.includes(idOf(t)));
const savedRecord = (w: World, tz: string, t: string, pid: string) =>
  w.store.get<DeviceRecord>(regKey(tz, 'snow', idOf(t), pid));
/** A record's fields in the order a registration writes them. */
const RECORD_KEYS = [
  'v',
  'id',
  'app',
  'platform',
  'env',
  'token',
  'query',
  'name',
  'tz',
  'units',
  'alerts',
  'createdAt',
  'updatedAt',
  'seenAt',
  'appVersion',
];

/** A store that fails the calls `failing` picks, and passes the rest to the memory store. */
function failing(
  inner: MemoryAlertStore,
  failing: (op: 'get' | 'set' | 'list' | 'delete', key: string) => boolean,
): AlertStore {
  const no = (op: string, key: string) => Promise.reject(new Error(`${op} ${key}: Blobs said 503`));
  return {
    get: <T>(key: string) => (failing('get', key) ? no('get', key) : inner.get<T>(key)),
    set: (key, value, options) =>
      failing('set', key) ? no('set', key) : inner.set(key, value, options),
    list: (prefix, options): Promise<AlertListing> =>
      failing('list', prefix) ? no('list', prefix) : inner.list(prefix, options),
    delete: (key) => (failing('delete', key) ? no('delete', key) : inner.delete(key)),
  };
}

// ---- The fake APNs ----

const signed = (jwt: string): string | null => {
  const [header, claims, signature] = jwt.split('.');
  const kid = JSON.parse(Buffer.from(header ?? '', 'base64url').toString('utf8')).kid as string;
  const key = PUBLIC[kid];
  const ok =
    !!key &&
    verify(
      'sha256',
      Buffer.from(`${header}.${claims}`),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature ?? '', 'base64url'),
    );
  return ok ? kid : null;
};

/** Apple, scripted by each device token's first two characters; anything else is a 200. */
function apple(script: Record<string, FakeReply> = {}) {
  return (headers: IncomingHttpHeaders): FakeReply => {
    if (!signed(String(headers.authorization).replace(/^bearer /, ''))) {
      return { status: 403, body: { reason: 'InvalidProviderToken' } };
    }
    if (headers['apns-topic'] !== 'today.willitsnow.app') {
      return { status: 400, body: { reason: 'BadTopic' } };
    }
    const device = String(headers[':path']).split('/').pop()!;
    return script[device.slice(0, 2)] ?? { status: 200 };
  };
}

async function withApple(
  script: Record<string, FakeReply> = {},
  over: Parameters<typeof world>[0] = {},
) {
  const fake = await fakeApns(apple(script));
  const envs: ApnsEnv[] = [];
  const w = world({
    connect: (env) => {
      envs.push(env);
      return apnsSender(fake.origin, 1000);
    },
    ...over,
  });
  const payloads = () => fake.seen.map((s) => JSON.parse(s.body) as Record<string, unknown>);
  return { w, fake, envs, payloads };
}

// ---- PUT: the body ----

describe('PUT /api/v1/devices: the body', () => {
  const coords = { lat: 53.8, lon: -1.55, source: 'device' };
  const cases: Array<[string, unknown, number, string]> = [
    ['not JSON', '{"app":', 400, 'bad_request'],
    ['empty', '', 400, 'bad_request'],
    ['a list', [body()], 400, 'bad_request'],
    ['null', null, 400, 'bad_request'],
    ['no app', body({ app: undefined }), 400, 'bad_request'],
    ['an unknown app', body({ app: 'rain' }), 400, 'bad_request'],
    ['the app in capitals', body({ app: 'SNOW' }), 400, 'bad_request'],
    ['an app not live yet: wet', body({ app: 'wet' }), 400, 'app_not_live'],
    ['an app not live yet: wind', body({ app: 'wind' }), 400, 'app_not_live'],
    ['an app not live yet: hot', body({ app: 'hot' }), 400, 'app_not_live'],
    ['an app not live yet: all', body({ app: 'all' }), 400, 'app_not_live'],
    ['android', body({ platform: 'android' }), 400, 'bad_request'],
    ['no platform', body({ platform: undefined }), 400, 'bad_request'],
    ['an unknown env', body({ env: 'development' }), 400, 'bad_request'],
    ['no env', body({ env: undefined }), 400, 'bad_request'],
    ['a token of 63 hex characters', body({ token: 'a'.repeat(63) }), 400, 'bad_request'],
    ['a token of 201 hex characters', body({ token: 'a'.repeat(201) }), 400, 'bad_request'],
    ['a token that is not hex', body({ token: 'g'.repeat(64) }), 400, 'bad_request'],
    ['a token with a space', body({ token: `${'a'.repeat(63)} ` }), 400, 'bad_request'],
    ['a token as a number', body({ token: 1234 }), 400, 'bad_request'],
    ['no token', body({ token: undefined }), 400, 'bad_request'],
    ['units k', body({ units: 'k' }), 400, 'bad_request'],
    ['no units', body({ units: undefined }), 400, 'bad_request'],
    ['no alerts', body({ alerts: undefined }), 400, 'bad_request'],
    ['alerts without snow', body({ alerts: {} }), 400, 'bad_request'],
    ['alerts.snow as true', body({ alerts: { snow: true } }), 400, 'bad_request'],
    [
      'a switch as text',
      body({ alerts: { snow: { ...EVENING, evening: 'true' } } }),
      400,
      'bad_request',
    ],
    ['a switch as 1', body({ alerts: { snow: { ...EVENING, morning: 1 } } }), 400, 'bad_request'],
    [
      'a switch missing',
      body({ alerts: { snow: { evening: true, morning: false } } }),
      400,
      'bad_request',
    ],
    ['appVersion as a number', body({ appVersion: 112 }), 400, 'bad_request'],
    ['appVersion too long', body({ appVersion: 'x'.repeat(41) }), 400, 'bad_request'],
    ['appVersion with a line break', body({ appVersion: '1.0\n(112)' }), 400, 'bad_request'],
    [
      'appVersion with a line separator',
      body({ appVersion: '1.0\u2028(112)' }),
      400,
      'bad_request',
    ],
    ['appVersion with a C1 control', body({ appVersion: '1.0\u0085(112)' }), 400, 'bad_request'],
    [
      'appVersion with a direction override',
      body({ appVersion: '1.0 \u202e(112)' }),
      400,
      'bad_request',
    ],
    ['no place', body({ place: undefined }), 400, 'bad_location'],
    ['a null place', body({ place: null }), 400, 'bad_location'],
    ["the IP location's empty place", body({ place: {} }), 400, 'bad_location'],
    ['an IP-style source alone', body({ place: { source: 'ip' } }), 400, 'bad_location'],
    ['a slug as the place', body({ place: 'leeds-gb' }), 400, 'bad_location'],
    ['an empty slug', body({ place: { place: ' ' } }), 400, 'bad_location'],
    ['a slug as a number', body({ place: { place: 7 } }), 400, 'bad_location'],
    ['an unknown slug', body({ place: { place: 'nowhere-xx' } }), 400, 'bad_location'],
    ['lat as text', body({ place: { ...coords, lat: '53.8' } }), 400, 'bad_location'],
    ['lat out of range', body({ place: { ...coords, lat: 91 } }), 400, 'bad_location'],
    ['lon out of range', body({ place: { ...coords, lon: -181 } }), 400, 'bad_location'],
    ['lat in exponent form', body({ place: { ...coords, lat: 1e21 } }), 400, 'bad_location'],
    ['lon alone', body({ place: { lon: -1.55, source: 'device' } }), 400, 'bad_location'],
    ['no source', body({ place: { lat: 53.8, lon: -1.55 } }), 400, 'bad_location'],
    ['source ip', body({ place: { ...coords, source: 'ip' } }), 400, 'bad_location'],
    ['a name as a number', body({ place: { ...HEXHAM, name: 5 } }), 400, 'bad_location'],
    ['a region as a list', body({ place: { ...HEXHAM, region: [] } }), 400, 'bad_location'],
    ['a geonameId as text', body({ place: { ...HEXHAM, geonameId: '1' } }), 400, 'bad_location'],
    ['an elevation as text', body({ place: { ...HEXHAM, elevation: '50' } }), 400, 'bad_location'],
  ];

  it.each(cases)('refuses %s (%i %s) and writes nothing', async (_name, b, status, code) => {
    const w = world();
    const r = await put(w, b);
    expect(r.status).toBe(status);
    expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(r.headers.get('cache-control')).toBe('no-store');
    const error = await errorOf(r);
    expect(error.code).toBe(code);
    expect(error.message).toMatch(/^\S.*\.$/);
    expect(w.store.keys()).toEqual([]);
    expect(w.forecasts).toEqual([]);
  });

  it('refuses a body over 8 KB (413), by its length or by its header', async () => {
    expect(DEVICE_LIMITS.bodyBytes).toBe(8192);
    const w = world();
    const sized = (bytes: number) => {
      const b = body({ token: token('aa', 1), padding: '' });
      const extra = bytes - JSON.stringify(b).length;
      return JSON.stringify({ ...b, padding: 'x'.repeat(extra) });
    };
    expect(sized(8193)).toHaveLength(8193);
    const over = await put(w, sized(8193));
    expect(over.status).toBe(413);
    expect((await errorOf(over)).code).toBe('too_large');
    expect(w.store.keys()).toEqual([]);
    const declared = new Request(DEVICES, {
      method: 'PUT',
      headers: { 'content-length': '16384' },
      body: JSON.stringify(body()),
    });
    expect((await handleDevicePut(declared, w.platform)).status).toBe(413);
    // Exactly 8,192 bytes is allowed; unknown fields are ignored.
    const exact = await put(w, sized(8192));
    expect(exact.status).toBe(200);
  });

  it('takes a token of 64 to 200 hex characters in either case, as one id', async () => {
    const w = world();
    const lower = `${'ab'.repeat(32)}`;
    TOKENS.add(lower);
    const r = await put(w, body({ token: lower.toUpperCase() }));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { id: string }).id).toBe(idOf(lower));
    expect((await record(w, 'Europe/London', lower))?.token).toBe(lower);
    const long = 'cd'.repeat(100);
    TOKENS.add(long);
    expect((await put(w, body({ token: long }))).status).toBe(200);
    expect((await record(w, 'Europe/London', long))?.token).toBe(long);
  });

  it('ignores fields it does not know, and stores no appVersion when there is none', async () => {
    const w = world();
    const t = token('aa', 2);
    const r = await put(w, body({ token: t, appVersion: undefined, extra: { deep: true } }));
    expect(r.status).toBe(200);
    const stored = await record(w, 'Europe/London', t);
    expect(stored).not.toHaveProperty('appVersion');
    expect(stored).not.toHaveProperty('extra');
  });
});

// ---- PUT: handling ----

describe('PUT /api/v1/devices: handling', () => {
  it('stores the record and answers exactly as section 8.2 says', async () => {
    const w = world();
    const t = token('aa', 10);
    const r = await put(w, body({ token: t }));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const at = iso(SNOWY);
    const id = idOf(t);
    expect(await r.json()).toEqual({
      id,
      place: { name: 'Leeds', timezone: 'Europe/London', query: 'place=leeds-gb' },
      alerts: { snow: EVENING },
      seenAt: at,
    });
    expect(w.store.keys()).toEqual([idsKey('snow', id), `reg/v1/Europe%2FLondon/snow.${id}`]);
    expect(await w.store.get(idsKey('snow', id))).toEqual({ tz: 'Europe/London' });
    const stored = await record(w, 'Europe/London', t);
    expect(stored).toEqual({
      v: 1,
      id,
      app: 'snow',
      platform: 'ios',
      env: 'sandbox',
      token: t,
      query: 'place=leeds-gb',
      name: 'Leeds',
      tz: 'Europe/London',
      units: 'c',
      alerts: { snow: EVENING },
      createdAt: at,
      updatedAt: at,
      seenAt: at,
      appVersion: '1.0 (112)',
    });
    // In the order section 8.2 lists them.
    expect(Object.keys(stored!)).toEqual([
      'v',
      'id',
      'app',
      'platform',
      'env',
      'token',
      'query',
      'name',
      'tz',
      'units',
      'alerts',
      'createdAt',
      'updatedAt',
      'seenAt',
      'appVersion',
    ]);
  });

  const forms: Array<[string, unknown, string, string, string]> = [
    ['a slug in any case', { place: 'Leeds-GB' }, 'place=leeds-gb', 'Leeds', 'Europe/London'],
    [
      'a device location, rounded again to 0.05°',
      { lat: 53.8123, lon: -1.5612, source: 'device' },
      'lat=53.8&lon=-1.55&source=device',
      'Leeds',
      'Europe/London',
    ],
    [
      'a device location with a name it keeps out of the query',
      { lat: 54.8, lon: -1.6, source: 'device', name: 'Somewhere' },
      'lat=54.8&lon=-1.6&source=device',
      'Durham',
      'Europe/London',
    ],
    [
      'a searched place, cleaned as /api/v1/today cleans it',
      { ...HEXHAM, name: '  Hexham\u0007 ', country: 'gb', elevation: 50.4 },
      HEXHAM_QUERY,
      'Hexham',
      'Europe/London',
    ],
    [
      'a searched place whose name and region hide line separators and direction overrides',
      { ...HEXHAM, name: '\u2028Hex\u202eham\u0085', region: 'Eng\u2029land\u200b' },
      HEXHAM_QUERY,
      'Hexham',
      'Europe/London',
    ],
    [
      'a searched place with an unusable country, which the nearest town gives',
      { lat: 54.95, lon: -2.1, name: 'Hexham', country: 'GBR', source: 'search' },
      'lat=54.95&lon=-2.1&name=Hexham&country=GB&source=search',
      'Hexham',
      'Europe/London',
    ],
    [
      'an unnamed searched place, named by the nearest town',
      { lat: 54.95, lon: -2.1, source: 'search' },
      'lat=54.95&lon=-2.1&name=Hexham&region=England&country=GB&geonameId=2647007&source=search',
      'Hexham',
      'Europe/London',
    ],
    [
      'an unnamed searched place with no town near',
      { lat: 1, lon: 2, source: 'search', region: null },
      'lat=1&lon=2&source=search',
      'Your location',
      'UTC',
    ],
    [
      'a device location with no town near',
      { lat: 1, lon: 2, source: 'device' },
      'lat=1&lon=2&source=device',
      'Your location',
      'UTC',
    ],
    [
      'coordinates over a slug, as /api/v1/today takes them',
      { place: 'leeds-gb', lat: 54.8, lon: -1.6, source: 'device' },
      'lat=54.8&lon=-1.6&source=device',
      'Durham',
      'Europe/London',
    ],
    ['a city in another zone', NEW_YORK, 'place=new-york-city-us', 'New York', 'Etc/GMT+5'],
  ];

  it.each(forms)('canonicalises %s', async (_name, place, query, name, tz) => {
    const w = world();
    const t = token('aa', 20);
    const r = await put(w, body({ token: t, place }));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { place: unknown }).place).toEqual({ name, timezone: tz, query });
    expect(await record(w, tz, t)).toMatchObject({ query, name, tz });
    // The canonical query is canonical: registering with it again gives the same.
    w.at(SNOWY + 2 * MINUTE);
    const again = Object.fromEntries(new URLSearchParams(query));
    const typed =
      'place' in again
        ? again
        : {
            ...again,
            lat: Number(again.lat),
            lon: Number(again.lon),
            ...(again.geonameId ? { geonameId: Number(again.geonameId) } : {}),
            ...(again.elevation ? { elevation: Number(again.elevation) } : {}),
          };
    const second = await put(w, body({ token: t, place: typed }));
    expect(((await second.json()) as { place: unknown }).place).toEqual({
      name,
      timezone: tz,
      query,
    });
  });

  it('reads the zone from the forecast, a cache hit for a place just asked about', async () => {
    const w = world();
    expect((await put(w, body({ token: token('aa', 30) }))).status).toBe(200);
    expect(w.forecasts).toHaveLength(1);
    expect((await put(w, body({ token: token('aa', 31), units: 'f' }))).status).toBe(200);
    expect(w.forecasts).toHaveLength(1);
  });

  it('keeps createdAt, and sets updatedAt and seenAt on every write', async () => {
    const w = world();
    const t = token('aa', 40);
    await put(w, body({ token: t }));
    w.at(SNOWY + 5 * MINUTE);
    const r = await put(
      w,
      body({ token: t, units: 'f', env: 'production', appVersion: '1.1 (2)' }),
    );
    expect(r.status).toBe(200);
    expect(((await r.json()) as { seenAt: string }).seenAt).toBe(iso(SNOWY + 5 * MINUTE));
    expect(await record(w, 'Europe/London', t)).toMatchObject({
      units: 'f',
      env: 'production',
      appVersion: '1.1 (2)',
      createdAt: iso(SNOWY),
      updatedAt: iso(SNOWY + 5 * MINUTE),
      seenAt: iso(SNOWY + 5 * MINUTE),
    });
  });

  it('a move to another zone deletes the old record; a move within one replaces it', async () => {
    const w = world();
    const t = token('aa', 50);
    const id = idOf(t);
    await put(w, body({ token: t }));
    w.at(SNOWY + 2 * MINUTE);
    const moved = await put(w, body({ token: t, place: NEW_YORK }));
    expect(moved.status).toBe(200);
    expect(w.store.keys()).toEqual([idsKey('snow', id), regKey('Etc/GMT+5', 'snow', id)]);
    expect(await w.store.get(idsKey('snow', id))).toEqual({ tz: 'Etc/GMT+5' });
    expect(await record(w, 'Etc/GMT+5', t)).toMatchObject({
      query: 'place=new-york-city-us',
      createdAt: iso(SNOWY),
    });
    expect(w.lines).toContain(
      `devices: moved snow.${id.slice(0, 8)}… to Etc/GMT+5 from Europe/London`,
    );

    w.at(SNOWY + 4 * MINUTE);
    await put(w, body({ token: t, place: LEEDS }));
    w.at(SNOWY + 6 * MINUTE);
    await put(w, body({ token: t, place: DURHAM }));
    expect(w.store.keys()).toEqual([idsKey('snow', id), regKey('Europe/London', 'snow', id)]);
    expect(await record(w, 'Europe/London', t)).toMatchObject({ query: 'place=durham-gb' });
    expect(await w.store.get(idsKey('snow', id))).toEqual({ tz: 'Europe/London' });
  });

  it('allows one write per id a minute (429 rate_limited), and never refuses a delete', async () => {
    const w = world();
    const t = token('aa', 60);
    expect((await put(w, body({ token: t }))).status).toBe(200);
    w.at(SNOWY + 59_500);
    const again = await put(w, body({ token: t, units: 'f' }));
    expect(again.status).toBe(429);
    expect(again.headers.get('retry-after')).toBe('1');
    expect((await errorOf(again)).code).toBe('rate_limited');
    expect(await record(w, 'Europe/London', t)).toMatchObject({
      units: 'c',
      updatedAt: iso(SNOWY),
    });
    // Another device is not held up.
    expect((await put(w, body({ token: token('aa', 61) }))).status).toBe(200);
    w.at(SNOWY + MINUTE);
    expect((await put(w, body({ token: t, units: 'f' }))).status).toBe(200);
    // Turning everything off goes through at once, as a DELETE does.
    w.at(SNOWY + MINUTE + 1000);
    const off = await put(w, body({ token: t, alerts: { snow: { ...EVENING, evening: false } } }));
    expect(off.status).toBe(204);
    expect(await record(w, 'Europe/London', t)).toBeNull();
    expect((await put(w, body({ token: t }))).status).toBe(200);
    expect((await del(w, { app: 'snow', token: t })).status).toBe(204);
    expect(await w.store.get(idsKey('snow', idOf(t)))).toBeNull();
  });

  it('a record written in the future by another clock still counts for a minute', async () => {
    const w = world();
    const t = token('aa', 62);
    w.at(SNOWY + 30_000);
    await put(w, body({ token: t }));
    w.at(SNOWY);
    const early = await put(w, body({ token: t }));
    expect(early.status).toBe(429);
    expect(early.headers.get('retry-after')).toBe('90');
  });

  it('every switch off is a delete (204), "possible" alone included, as the app decides', async () => {
    const w = world();
    const t = token('aa', 70);
    await put(w, body({ token: t }));
    const prefs = { evening: false, morning: false, possible: true };
    // The app's own rule: nothing switched on but "possible" means delete.
    expect(
      alertAction({
        prefs,
        permission: 'authorized',
        token: t,
        place: { kind: 'city', slug: 'leeds-gb' },
        units: 'c',
        last: { fingerprint: 'x', at: SNOWY },
        now: SNOWY,
        env: 'sandbox',
        appVersion: '1.0 (112)',
      }),
    ).toBe('delete');
    const r = await put(w, body({ token: t, alerts: { snow: prefs } }));
    expect(r.status).toBe(204);
    expect(await r.text()).toBe('');
    expect(w.store.keys()).toEqual([]);
    // With nothing stored, too.
    const none = { evening: false, morning: false, possible: false };
    expect((await put(w, body({ token: token('aa', 71), alerts: { snow: none } }))).status).toBe(
      204,
    );
    expect(w.forecasts).toHaveLength(1);
  });

  it('a forecast failure is a 503 upstream_unavailable, and nothing is stored', async () => {
    const w = world({
      fetch: (synthetic) => async (url, init) =>
        new URL(url).pathname.endsWith('/forecast')
          ? new Response('down', { status: 500 })
          : synthetic(url, init),
    });
    const r = await put(w, body({ token: token('aa', 80) }));
    expect(r.status).toBe(503);
    expect((await errorOf(r)).code).toBe('upstream_unavailable');
    expect(w.store.keys()).toEqual([]);
  });
});

// ---- Store failures ----

describe('the devices endpoints when the store fails', () => {
  it('a failed read is a 503 store_unavailable, with nothing written', async () => {
    const inner = new MemoryAlertStore();
    const w = world({ store: failing(inner, (op) => op === 'get') });
    const r = await put(w, body({ token: token('aa', 90) }));
    expect(r.status).toBe(503);
    expect(await errorOf(r)).toEqual({
      code: 'store_unavailable',
      message: "Notifications can't be changed just now. Try again shortly.",
    });
    expect(inner.keys()).toEqual([]);
    expect((await del(w, { app: 'snow', token: token('aa', 90) })).status).toBe(503);
    expect((await sendTest(w, { app: 'snow', token: token('aa', 90) })).status).toBe(503);
  });

  it('a failed write is a 503, never a 200, and a DELETE still finds what was written', async () => {
    const inner = new MemoryAlertStore();
    const t = token('aa', 91);
    const w = world({ store: failing(inner, (op, key) => op === 'set' && key.startsWith('reg/')) });
    const r = await put(w, body({ token: t }));
    expect(r.status).toBe(503);
    expect((await errorOf(r)).code).toBe('store_unavailable');
    // The ids key went first, so the delete knows where to look.
    expect(inner.keys()).toEqual([idsKey('snow', idOf(t))]);
    expect((await del(w, { app: 'snow', token: t })).status).toBe(204);
    expect(inner.keys()).toEqual([]);

    const noIds = world({
      store: failing(inner, (op, key) => op === 'set' && key.startsWith('ids/')),
    });
    expect((await put(noIds, body({ token: t }))).status).toBe(503);
    expect(inner.keys()).toEqual([]);
  });

  it('a move cut short leaves the ids key naming both zones, so nothing is left behind', async () => {
    const inner = new MemoryAlertStore();
    const t = token('aa', 92);
    const id = idOf(t);
    let breakDeletes = false;
    const w = world({ store: failing(inner, (op) => breakDeletes && op === 'delete') });
    await put(w, body({ token: t }));
    w.at(SNOWY + 2 * MINUTE);
    breakDeletes = true;
    const r = await put(w, body({ token: t, place: NEW_YORK }));
    expect(r.status).toBe(503);
    expect(await inner.get(idsKey('snow', id))).toEqual({
      tz: 'Etc/GMT+5',
      from: ['Europe/London'],
    });
    expect(inner.keys()).toEqual([
      idsKey('snow', id),
      regKey('Etc/GMT+5', 'snow', id),
      regKey('Europe/London', 'snow', id),
    ]);
    breakDeletes = false;
    // The device turns notifications off: every copy goes.
    expect((await del(w, { app: 'snow', token: t })).status).toBe(204);
    expect(inner.keys()).toEqual([]);

    // Or it registers again, which finishes the move.
    await put(w, body({ token: t }));
    w.at(SNOWY + 4 * MINUTE);
    breakDeletes = true;
    await put(w, body({ token: t, place: NEW_YORK }));
    breakDeletes = false;
    w.at(SNOWY + 6 * MINUTE);
    expect((await put(w, body({ token: t, place: NEW_YORK }))).status).toBe(200);
    expect(inner.keys()).toEqual([idsKey('snow', id), regKey('Etc/GMT+5', 'snow', id)]);
    expect(await inner.get(idsKey('snow', id))).toEqual({ tz: 'Etc/GMT+5' });
    expect(await inner.get<DeviceRecord>(regKey('Etc/GMT+5', 'snow', id))).toMatchObject({
      createdAt: iso(SNOWY + 2 * MINUTE),
    });
  });

  it('logs each failure once, with the id cut short', async () => {
    const inner = new MemoryAlertStore();
    const t = token('aa', 93);
    const w = world({ store: failing(inner, (op) => op === 'get') });
    await put(w, body({ token: t }));
    expect(w.lines).toEqual([
      `alert store: get ids/v1/snow.${idOf(t).slice(0, 8)}…: get ids/v1/snow.${idOf(t).slice(0, 8)}…: Blobs said 503`,
    ]);
  });

  it('without a Blobs environment, every endpoint is a 503, never a crash', async () => {
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    const w = world({ store: null });
    const t = token('aa', 94);
    for (const r of [
      await put(w, body({ token: t })),
      await del(w, { app: 'snow', token: t }),
      await sendTest(w, { app: 'snow', token: t }),
    ]) {
      expect(r.status).toBe(503);
      expect((await errorOf(r)).code).toBe('store_unavailable');
    }
    expect(w.lines[0]).toMatch(/^devices: error: no alert store \(.*Netlify Blobs/);
  });
});

// ---- DELETE ----

describe('DELETE /api/v1/devices', () => {
  it('removes both keys, and again is fine: 204 both times', async () => {
    const w = world();
    const t = token('aa', 100);
    const other = token('aa', 101);
    await put(w, body({ token: t }));
    await put(w, body({ token: other, place: NEW_YORK }));
    const r = await del(w, { app: 'snow', token: t });
    expect(r.status).toBe(204);
    expect(await r.text()).toBe('');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(w.store.keys()).toEqual([
      idsKey('snow', idOf(other)),
      regKey('Etc/GMT+5', 'snow', idOf(other)),
    ]);
    expect((await del(w, { app: 'snow', token: t })).status).toBe(204);
    expect((await del(w, { app: 'snow', token: token('aa', 102) })).status).toBe(204);
    // In either case; the platform, env and the rest are not needed.
    expect((await del(w, { ...body({ token: other.toUpperCase() }) })).status).toBe(204);
    expect(w.store.keys()).toEqual([]);
  });

  it('checks the app and the token', async () => {
    const w = world();
    const cases: Array<[unknown, number, string]> = [
      ['nope', 400, 'bad_request'],
      [{ app: 'snow' }, 400, 'bad_request'],
      [{ app: 'snow', token: 'abc' }, 400, 'bad_request'],
      [{ token: token() }, 400, 'bad_request'],
      [{ app: 'wind', token: token() }, 400, 'app_not_live'],
      [{ app: 'snow', token: token(), padding: 'x'.repeat(8192) }, 413, 'too_large'],
    ];
    for (const [b, status, code] of cases) {
      const r = await del(w, b);
      expect(r.status).toBe(status);
      expect((await errorOf(r)).code).toBe(code);
    }
  });

  it('a delete that fails is a 503, and the ids key stays so a retry finds the record', async () => {
    const inner = new MemoryAlertStore();
    const t = token('aa', 103);
    let broken = false;
    const w = world({ store: failing(inner, (op) => broken && op === 'delete') });
    await put(w, body({ token: t }));
    broken = true;
    expect((await del(w, { app: 'snow', token: t })).status).toBe(503);
    expect(inner.keys()).toHaveLength(2);
    broken = false;
    expect((await del(w, { app: 'snow', token: t })).status).toBe(204);
    expect(inner.keys()).toEqual([]);
  });

  it('handleDevices sends PUT and DELETE on, and refuses anything else', async () => {
    const w = world();
    const t = token('aa', 104);
    expect((await handleDevices(send('PUT', body({ token: t })), w.platform)).status).toBe(200);
    expect(
      (await handleDevices(send('DELETE', { app: 'snow', token: t }), w.platform)).status,
    ).toBe(204);
    const r = await handleDevices(new Request(DEVICES), w.platform);
    expect(r.status).toBe(405);
    expect(r.headers.get('allow')).toBe('PUT, DELETE');
    expect((await errorOf(r)).code).toBe('method_not_allowed');
  });
});

// ---- PUT, version 2: the body ----

describe('PUT /api/v1/devices, version 2: the body', () => {
  const coords = { lat: 53.8, lon: -1.55, source: 'device' };
  const cases: Array<[string, unknown]> = [
    ['another version', body2({ v: 3 })],
    ['the version as text', body2({ v: '2' })],
    ['no here', body2({ here: undefined })],
    ['here as null', body2({ here: null })],
    ['here as a city page', body2({ here: LEEDS })],
    ['here as a searched place', body2({ here: HEXHAM })],
    ['here with an unknown source', body2({ here: { source: 'gps' } })],
    ['coordinates with source ip', body2({ here: { ...coords, source: 'ip' } })],
    ['a slug with source ip', body2({ here: { place: 'leeds-gb', source: 'ip' } })],
    ['a device location without coordinates', body2({ here: { source: 'device' } })],
    ['a device location with lat as text', body2({ here: { ...coords, lat: '53.8' } })],
    ['a device location out of range', body2({ here: { ...coords, lat: 91 } })],
    ['no saved', body2({ saved: undefined })],
    ['saved as one place', body2({ saved: DURHAM })],
    [
      '11 saved places',
      body2({ saved: Array.from({ length: 11 }, (_, i) => ({ ...KATHMANDU, lat: 27 + i / 10 })) }),
    ],
    ['a saved device location', body2({ saved: [DURHAM, coords] })],
    ['a saved place with source ip', body2({ saved: [IP] })],
    ['an empty saved place', body2({ saved: [{}] })],
    ['a saved slug alone', body2({ saved: ['durham-gb'] })],
    ['a saved slug as a number', body2({ saved: [{ place: 7 }] })],
    ['a saved place out of range', body2({ saved: [{ ...HEXHAM, lon: 181 }] })],
    ['a saved name as a number', body2({ saved: [{ ...HEXHAM, name: 5 }] })],
    ['no token', body2({ token: undefined })],
    ['units k', body2({ units: 'k' })],
    ['a switch missing', body2({ alerts: { snow: { evening: true, morning: false } } })],
  ];

  it.each(cases)('refuses %s (400 bad_request) and writes nothing', async (_name, b) => {
    const w = world({ geo: LEEDS_GEO });
    const r = await put2(w, b);
    expect(r.status).toBe(400);
    const error = await errorOf(r);
    expect(error.code).toBe('bad_request');
    expect(error.message).toMatch(/^\S.*\.$/);
    expect(w.store.keys()).toEqual([]);
    expect(w.forecasts).toEqual([]);
  });

  it('takes each form of here, and saved places in every form but a location', async () => {
    const w = world({ geo: LEEDS_GEO });
    const t = token('a2', 1);
    const r = await put2(
      w,
      body2({
        token: t,
        saved: [{ place: 'Durham-GB' }, HEXHAM, { lat: 54.95, lon: -2.1, source: 'search' }],
      }),
    );
    expect(r.status).toBe(200);
    const reply = await reply2(r);
    expect(reply.here).toMatchObject({ name: 'Leeds', query: LEEDS_CELL, follows: 'ip' });
    expect(reply.saved.map((s) => [s.query, s.name])).toEqual([
      ['place=durham-gb', 'Durham'],
      [HEXHAM_QUERY, 'Hexham'],
      [
        'lat=54.95&lon=-2.1&name=Hexham&region=England&country=GB&geonameId=2647007&source=search',
        'Hexham',
      ],
    ]);
    // The phone's own location needs no geo, and keeps only its point.
    const device = await put2(
      world(),
      body2({
        token: token('a2', 2),
        here: { lat: 53.8123, lon: -1.5612, source: 'device', name: 'Somewhere' },
      }),
    );
    expect(device.status).toBe(200);
    expect((await reply2(device)).here).toEqual({
      name: 'Leeds',
      timezone: 'Europe/London',
      query: LEEDS_CELL,
      country: 'GB',
      follows: 'device',
    });
  });

  it('counts two saved places that are one place once, and drops a slug with no page into refused', async () => {
    const w = world({ geo: LEEDS_GEO });
    const t = token('a2', 3);
    const r = await put2(
      w,
      body2({
        token: t,
        saved: [{ place: 'nowhere-xx' }, DURHAM, { place: 'DURHAM-GB' }, { place: 'gone-xx' }],
      }),
    );
    expect(r.status).toBe(200);
    const reply = await reply2(r);
    expect(reply.saved.map((s) => s.query)).toEqual(['place=durham-gb']);
    expect(reply.refused).toEqual([
      { index: 0, code: 'not_found' },
      { index: 3, code: 'not_found' },
    ]);
    expect(keysFor(w, t)).toHaveLength(3);
  });

  it("takes as many saved places as the app's picker saves (decision 20)", () => {
    expect(ALERTS.savedPlacesMax).toBe(PLACES.savedMax);
  });

  it('takes a body of up to 8 KB: ten searched places with long names in 3-byte characters', async () => {
    const w = world({ geo: LEEDS_GEO });
    const t = token('a2', 4);
    const far = (i: number) => ({
      lat: 35 + i / 2,
      lon: 139.7,
      source: 'search',
      name: `${'雪'.repeat(79)}${i}`,
      region: '雪'.repeat(80),
      country: 'JP',
      geonameId: 900000 + i,
      elevation: 40,
    });
    const big = body2({
      token: t,
      saved: Array.from({ length: ALERTS.savedPlacesMax }, (_, i) => far(i)),
    });
    const bytes = Buffer.byteLength(JSON.stringify(big));
    expect(bytes).toBeGreaterThan(6000);
    expect(bytes).toBeLessThanOrEqual(DEVICE_LIMITS.bodyBytes);
    // Taken: the first new places are stored and the rest wait (the cap, below).
    expect((await put2(w, big)).status).toBe(429);
    expect(keysFor(w, t)).toHaveLength(2 + ALERTS.newPlacesPerPut);
  });

  it("keeps the phone's zone on saved places only, when it is one the server knows", async () => {
    const w = world({ geo: LEEDS_GEO });
    const cases: Array<[unknown, string | null]> = [
      ['Europe/London', 'Europe/London'],
      ['asia/tokyo', 'Asia/Tokyo'],
      ['Mars/Olympus_Mons', null],
      [`Europe/${'x'.repeat(58)}`, null],
      [7, null],
      ['', null],
      [undefined, null],
    ];
    let n = 0;
    for (const [deviceTz, kept] of cases) {
      const t = token('a2', 10 + n++);
      const r = await put2(w, body2({ token: t, deviceTz, saved: [DURHAM] }));
      expect(r.status).toBe(200);
      const reply = await reply2(r);
      expect(reply.deviceTz).toBe(kept);
      const saved = await savedRecord(w, 'Europe/London', t, reply.saved[0]!.pid);
      if (kept) expect(saved?.deviceTz).toBe(kept);
      else expect(saved).not.toHaveProperty('deviceTz');
      expect(await record(w, 'Europe/London', t)).not.toHaveProperty('deviceTz');
    }
    // Without a saved place, nothing keeps it.
    const none = await put2(w, body2({ token: token('a2', 30), deviceTz: 'Europe/London' }));
    expect((await reply2(none)).deviceTz).toBeNull();
  });
});

// ---- PUT, version 2: where you are ----

describe('PUT /api/v1/devices, version 2: where you are', () => {
  it('locates the free place from the connection, as a point on the grid, and answers with the set', async () => {
    const w = world({ geo: LEEDS_GEO });
    const t = token('a3', 1);
    const r = await put2(w, body2({ token: t }));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const at = iso(SNOWY);
    const id = idOf(t);
    expect(await r.json()).toEqual({
      id,
      deviceTz: null,
      here: {
        name: 'Leeds',
        timezone: 'Europe/London',
        query: LEEDS_CELL,
        country: 'GB',
        follows: 'ip',
      },
      saved: [],
      refused: [],
      alerts: { snow: EVENING },
      seenAt: at,
    });
    const stored = await record(w, 'Europe/London', t);
    expect(stored).toEqual({
      v: 1,
      id,
      app: 'snow',
      platform: 'ios',
      env: 'sandbox',
      token: t,
      query: LEEDS_CELL,
      name: 'Leeds',
      tz: 'Europe/London',
      units: 'c',
      alerts: { snow: EVENING },
      createdAt: at,
      updatedAt: at,
      seenAt: at,
      appVersion: '1.0 (130)',
      follows: 'ip',
      locatedAt: at,
      country: 'GB',
    });
    expect(Object.keys(stored!)).toEqual([...RECORD_KEYS, 'follows', 'locatedAt', 'country']);
    const entry = await idsOf(w, t);
    expect(entry).toEqual({
      v: 2,
      tz: 'Europe/London',
      saved: [],
      salt: expect.stringMatching(/^[0-9a-f]{32}$/),
      updatedAt: at,
    });
    expect(Object.keys(entry!)).toEqual(['v', 'tz', 'saved', 'salt', 'updatedAt']);
    expect(w.lines).toContain(
      `devices: registered snow.${id.slice(0, 8)}… in Europe/London, 0 saved, 0 zones`,
    );
  });

  it('is no place when the connection has coordinates but no town', async () => {
    const w = world({ geo: { country: 'GB', lat: 53.7965, lon: -1.5478 } });
    const t = token('a3', 2);
    const r = await put2(w, body2({ token: t, saved: [DURHAM] }));
    expect(r.status).toBe(200);
    const reply = await reply2(r);
    expect(reply.here).toBeNull();
    expect(await record(w, 'Europe/London', t)).toBeNull();
    const pid = reply.saved[0]!.pid;
    expect(await idsOf(w, t)).toEqual({
      v: 2,
      saved: [regKey('Europe/London', 'snow', idOf(t), pid)],
      salt: expect.stringMatching(/^[0-9a-f]{32}$/),
      updatedAt: iso(SNOWY),
    });
    expect(w.lines).toContain(
      `devices: registered snow.${idOf(t).slice(0, 8)}… (not located), 1 saved, 1 zone`,
    );
  });

  it("keeps a place located from the connection for 7 days when the connection can't be located, as it is", async () => {
    const w = world({ geo: LEEDS_GEO });
    const t = token('a3', 3);
    await put2(w, body2({ token: t }));
    const fetched = w.forecasts.length;
    w.platform.geo = null;
    w.at(SNOWY + 7 * DAY - MINUTE);
    const r = await put2(w, body2({ token: t, units: 'f' }));
    expect(r.status).toBe(200);
    expect((await reply2(r)).here).toEqual({
      name: 'Leeds',
      timezone: 'Europe/London',
      query: LEEDS_CELL,
      country: 'GB',
      follows: 'ip',
    });
    expect(await record(w, 'Europe/London', t)).toMatchObject({
      units: 'f',
      follows: 'ip',
      locatedAt: iso(SNOWY),
      createdAt: iso(SNOWY),
      updatedAt: iso(SNOWY + 7 * DAY - MINUTE),
    });
    expect(w.forecasts).toHaveLength(fetched);
    // Its locatedAt isn't refreshed, so 7 days after it was located it goes.
    w.at(SNOWY + 7 * DAY);
    const old = await put2(w, body2({ token: t, saved: [DURHAM] }));
    expect(old.status).toBe(200);
    expect((await reply2(old)).here).toBeNull();
    expect(await record(w, 'Europe/London', t)).toBeNull();
  });

  it("deletes the phone's location once it isn't shared, even when the connection can't stand in", async () => {
    let down = false;
    const w = world({
      fetch: (synthetic) => async (url, init) =>
        down && new URL(url).pathname.endsWith('/forecast')
          ? new Response('down', { status: 500 })
          : synthetic(url, init),
    });
    const leeds = { lat: 53.8, lon: -1.55, source: 'device' };
    const t = token('a3', 4);
    await put2(w, body2({ token: t, here: leeds, saved: [HELSINKI] }));
    expect(await record(w, 'Europe/London', t)).toMatchObject({ follows: 'device' });
    // Location revoked, and the connection not located: no free place.
    w.at(SNOWY + 2 * MINUTE);
    const r = await put2(w, body2({ token: t, here: IP, saved: [HELSINKI] }));
    expect(r.status).toBe(200);
    expect((await reply2(r)).here).toBeNull();
    expect(await record(w, 'Europe/London', t)).toBeNull();
    // Revoked again, with a connection in a cell whose forecast can't be had: 503, and the
    // phone's point is gone all the same.
    const n = token('a3', 5);
    w.at(SNOWY + 4 * MINUTE);
    await put2(w, body2({ token: n, here: leeds, saved: [HELSINKI] }));
    w.at(SNOWY + 6 * MINUTE);
    w.platform.geo = NEWCASTLE_GEO;
    down = true;
    const failed = await put2(w, body2({ token: n, here: IP, saved: [HELSINKI] }));
    expect(failed.status).toBe(503);
    expect((await errorOf(failed)).code).toBe('upstream_unavailable');
    expect(await record(w, 'Europe/London', n)).toBeNull();
    expect((await idsOf(w, n))?.tz).toBeUndefined();
  });

  it("deletes an 8.1 record the connection can't replace, and replaces one it can", async () => {
    const w = world();
    const t = token('a3', 6);
    expect((await put(w, body({ token: t, place: LEEDS }))).status).toBe(200);
    w.at(SNOWY + 2 * MINUTE);
    const r = await put2(w, body2({ token: t, saved: [HELSINKI] }));
    expect(r.status).toBe(200);
    expect((await reply2(r)).here).toBeNull();
    expect(await record(w, 'Europe/London', t)).toBeNull();

    const n = token('a3', 7);
    w.at(SNOWY);
    await put(w, body({ token: n, place: DURHAM }));
    w.at(SNOWY + 2 * MINUTE);
    w.platform.geo = LEEDS_GEO;
    expect((await put2(w, body2({ token: n }))).status).toBe(200);
    expect(keysFor(w, n)).toEqual([
      idsKey('snow', idOf(n)),
      regKey('Europe/London', 'snow', idOf(n)),
    ]);
    expect(await record(w, 'Europe/London', n)).toMatchObject({
      query: LEEDS_CELL,
      follows: 'ip',
      createdAt: iso(SNOWY),
    });
  });

  it('forgets the whole set when nothing is left to keep, then says why in words the app shows', async () => {
    const w = world({ geo: LEEDS_GEO });
    const t = token('a3', 8);
    await put2(w, body2({ token: t, saved: [HELSINKI] }));
    w.platform.geo = null;
    w.at(SNOWY + 8 * DAY);
    for (const saved of [[], [{ place: 'nowhere-xx' }]]) {
      const r = await put2(w, body2({ token: t, saved }));
      expect(r.status).toBe(400);
      expect(await errorOf(r)).toEqual({
        code: 'bad_location',
        message:
          "We couldn't tell where you are from your internet connection. Try again later, or use your location.",
      });
      expect(keysFor(w, t)).toEqual([]);
    }
    expect(w.forecasts).toHaveLength(2);
  });
});

// ---- PUT, version 2: the set ----

describe('PUT /api/v1/devices, version 2: the set', () => {
  it('writes each place in its own zone with one stamp, and the ids entry naming exactly them', async () => {
    const w = world({ geo: LEEDS_GEO });
    const t = token('a4', 1);
    const id = idOf(t);
    const r = await put2(w, body2({ token: t, saved: [DURHAM, KATHMANDU, TOKYO] }));
    expect(r.status).toBe(200);
    const at = iso(SNOWY);
    const salt = (await idsOf(w, t))!.salt;
    const durham = placeId(salt, 'place=durham-gb');
    const kathmandu = placeId(salt, KATHMANDU_QUERY);
    const tokyo = placeId(salt, 'place=tokyo-jp');
    expect(await r.json()).toEqual({
      id,
      deviceTz: 'Europe/London',
      here: {
        name: 'Leeds',
        timezone: 'Europe/London',
        query: LEEDS_CELL,
        country: 'GB',
        follows: 'ip',
      },
      saved: [
        {
          pid: durham,
          name: 'Durham',
          timezone: 'Europe/London',
          query: 'place=durham-gb',
          country: 'GB',
        },
        {
          pid: kathmandu,
          name: 'Kathmandu',
          timezone: 'Etc/GMT-6',
          query: KATHMANDU_QUERY,
          country: 'NP',
        },
        {
          pid: tokyo,
          name: 'Tokyo',
          timezone: 'Etc/GMT-9',
          query: 'place=tokyo-jp',
          country: 'JP',
        },
      ],
      refused: [],
      alerts: { snow: EVENING },
      seenAt: at,
    });
    const keys = [
      regKey('Europe/London', 'snow', id, durham),
      regKey('Etc/GMT-6', 'snow', id, kathmandu),
      regKey('Etc/GMT-9', 'snow', id, tokyo),
    ];
    expect(keysFor(w, t)).toEqual(
      [idsKey('snow', id), regKey('Europe/London', 'snow', id), ...keys].sort(),
    );
    expect(await idsOf(w, t)).toEqual({
      v: 2,
      tz: 'Europe/London',
      saved: keys,
      salt,
      updatedAt: at,
    });
    const saved = await savedRecord(w, 'Etc/GMT-6', t, kathmandu);
    expect(saved).toEqual({
      v: 1,
      id,
      app: 'snow',
      platform: 'ios',
      env: 'sandbox',
      token: t,
      query: KATHMANDU_QUERY,
      name: 'Kathmandu',
      tz: 'Etc/GMT-6',
      units: 'c',
      alerts: { snow: EVENING },
      createdAt: at,
      updatedAt: at,
      seenAt: at,
      appVersion: '1.0 (130)',
      slot: kathmandu,
      country: 'NP',
      deviceTz: 'Europe/London',
    });
    expect(Object.keys(saved!)).toEqual([...RECORD_KEYS, 'slot', 'country', 'deviceTz']);
    // Saved places only as counts: never their zones.
    expect(w.lines.at(-1)).toBe(
      `devices: registered snow.${id.slice(0, 8)}… in Europe/London, 3 saved, 3 zones`,
    );
  });

  it('adds and removes saved places, and moves the free place between zones', async () => {
    const w = world({ geo: LEEDS_GEO });
    const t = token('a4', 2);
    const id = idOf(t);
    await put2(w, body2({ token: t, saved: [DURHAM, KATHMANDU, TOKYO] }));
    const salt = (await idsOf(w, t))!.salt;
    const pid = (q: string) => placeId(salt, q);
    const fetched = w.forecasts.length;
    w.at(SNOWY + 2 * MINUTE);
    const r = await put2(w, body2({ token: t, saved: [TOKYO, HELSINKI] }));
    expect(r.status).toBe(200);
    expect((await reply2(r)).saved.map((s) => s.query)).toEqual([
      'place=tokyo-jp',
      'place=helsinki-fi',
    ]);
    // Only the new place was looked up; the one kept keeps its createdAt.
    expect(w.forecasts).toHaveLength(fetched + 1);
    expect(keysFor(w, t)).toEqual(
      [
        idsKey('snow', id),
        regKey('Europe/London', 'snow', id),
        regKey('Etc/GMT-9', 'snow', id, pid('place=tokyo-jp')),
        regKey('Etc/GMT-2', 'snow', id, pid('place=helsinki-fi')),
      ].sort(),
    );
    expect(await savedRecord(w, 'Etc/GMT-9', t, pid('place=tokyo-jp'))).toMatchObject({
      createdAt: iso(SNOWY),
      updatedAt: iso(SNOWY + 2 * MINUTE),
    });
    expect(w.lines.at(-1)).toBe(
      `devices: updated snow.${id.slice(0, 8)}… in Europe/London, 2 saved, 2 zones`,
    );

    w.at(SNOWY + 4 * MINUTE);
    w.platform.geo = NEW_YORK_GEO;
    expect((await put2(w, body2({ token: t, saved: [TOKYO, HELSINKI] }))).status).toBe(200);
    expect(keysFor(w, t)).toEqual(
      [
        idsKey('snow', id),
        regKey('Etc/GMT+5', 'snow', id),
        regKey('Etc/GMT-9', 'snow', id, pid('place=tokyo-jp')),
        regKey('Etc/GMT-2', 'snow', id, pid('place=helsinki-fi')),
      ].sort(),
    );
    expect(await record(w, 'Etc/GMT+5', t)).toMatchObject({ createdAt: iso(SNOWY), follows: 'ip' });
    expect((await idsOf(w, t))?.tz).toBe('Etc/GMT+5');
    expect(w.lines.at(-1)).toBe(
      `devices: moved snow.${id.slice(0, 8)}… to Etc/GMT+5 from Europe/London, 2 saved, 2 zones`,
    );
  });

  it('adds at most 3 new saved places a PUT: 429 with Retry-After 60, and the retry stores the rest', async () => {
    expect(ALERTS.newPlacesPerPut).toBe(3);
    const w = world({ geo: LEEDS_GEO });
    const t = token('a4', 3);
    const id = idOf(t);
    const four = [HELSINKI, TOKYO, REYKJAVIK, OSLO];
    const r = await put2(w, body2({ token: t, saved: four }));
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('60');
    expect(await errorOf(r)).toEqual({
      code: 'rate_limited',
      message: 'Up to 3 new places are added at a time. Try again in a minute.',
    });
    const salt = (await idsOf(w, t))!.salt;
    const key = (tz: string, slug: string) =>
      regKey(tz, 'snow', id, placeId(salt, `place=${slug}`));
    const three = [
      key('Etc/GMT-2', 'helsinki-fi'),
      key('Etc/GMT-9', 'tokyo-jp'),
      key('Etc/GMT+1', 'reykjavik-is'),
    ];
    // The first three in the body's order, with the free place; one forecast each.
    expect(keysFor(w, t)).toEqual(
      [idsKey('snow', id), regKey('Europe/London', 'snow', id), ...three].sort(),
    );
    expect(w.forecasts).toHaveLength(4);
    // Not a full success, so the minute's rule doesn't hold the retry back.
    expect(await idsOf(w, t)).toEqual({ v: 2, tz: 'Europe/London', saved: three, salt });
    expect(w.lines.at(-1)).toBe(
      `devices: registered snow.${id.slice(0, 8)}… in Europe/London, 3 saved, 3 zones; 1 held back`,
    );
    w.at(SNOWY + 1000);
    const retry = await put2(w, body2({ token: t, saved: four }));
    expect(retry.status).toBe(200);
    expect((await reply2(retry)).saved.map((s) => s.name)).toEqual([
      'Helsinki',
      'Tokyo',
      'Reykjavík',
      'Oslo',
    ]);
    expect(w.forecasts).toHaveLength(5);
    expect((await idsOf(w, t))?.updatedAt).toBe(iso(SNOWY + 1000));

    // Ten bells restored at once take four PUTs, a minute apart as the app retries.
    const ten = Array.from({ length: ALERTS.savedPlacesMax }, (_, i) => ({
      ...KATHMANDU,
      lat: 20 + i,
    }));
    const n = token('a4', 4);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      w.at(SNOWY + i * MINUTE);
      statuses.push((await put2(w, body2({ token: n, saved: ten }))).status);
    }
    expect(statuses).toEqual([429, 429, 429, 200]);
    expect(keysFor(w, n)).toHaveLength(2 + ALERTS.savedPlacesMax);
  });

  it('looks up the new places at once, under one budget: past it, 503 with the rest written', async () => {
    // One lookup takes at most about 7.5 s, and the app waits 12 s for the whole PUT: the rest
    // leaves room for the store's reads and writes either side, so a 503 reaches the app.
    expect(DEVICE_LIMITS.putLookupMs).toBe(8_000);
    expect(CLIENT.requestTimeoutMs - DEVICE_LIMITS.putLookupMs).toBeGreaterThanOrEqual(4_000);
    let slow = 'none';
    const w = world({
      geo: LEEDS_GEO,
      putLookupMs: 150,
      fetch: (synthetic) => (url, init) => {
        const u = new URL(url);
        if (!u.pathname.endsWith('/forecast')) return synthetic(url, init);
        const ms =
          slow === 'all'
            ? 60
            : slow === 'tokyo' && u.searchParams.get('longitude')?.startsWith('139')
              ? 400
              : 0;
        return new Promise<Response>((resolve) =>
          setTimeout(() => resolve(synthetic(url, init)), ms),
        );
      },
    });
    // Four lookups of 60 ms each fit a 150 ms budget only if they go at once.
    slow = 'all';
    const t = token('a4', 5);
    expect((await put2(w, body2({ token: t, saved: [HELSINKI, REYKJAVIK, OSLO] }))).status).toBe(
      200,
    );
    expect(keysFor(w, t)).toHaveLength(5);

    slow = 'tokyo';
    const n = token('a4', 6);
    const r = await put2(w, body2({ token: n, saved: [DURHAM, TOKYO] }));
    expect(r.status).toBe(503);
    expect((await errorOf(r)).code).toBe('upstream_unavailable');
    const salt = (await idsOf(w, n))!.salt;
    expect(keysFor(w, n)).toEqual(
      [
        idsKey('snow', idOf(n)),
        regKey('Europe/London', 'snow', idOf(n)),
        regKey('Europe/London', 'snow', idOf(n), placeId(salt, 'place=durham-gb')),
      ].sort(),
    );
    expect((await idsOf(w, n))?.updatedAt).toBeUndefined();
    expect(w.lines.at(-1)).toBe(
      `devices: registered snow.${idOf(n).slice(0, 8)}… in Europe/London, 1 saved, 1 zone; 1 not looked up`,
    );
  });

  it('reuses every zone on a heartbeat: no forecast, new stamps, createdAt kept', async () => {
    const w = world();
    const t = token('a4', 7);
    const b = body2({
      token: t,
      here: { lat: 53.8, lon: -1.55, source: 'device' },
      saved: [DURHAM, HELSINKI],
    });
    expect((await put2(w, b)).status).toBe(200);
    expect(w.forecasts).toHaveLength(3);
    // A week on: every forecast has gone stale in the cache, so a lookup would fetch.
    w.at(SNOWY + 7 * DAY);
    const r = await put2(w, b);
    expect(r.status).toBe(200);
    expect(w.forecasts).toHaveLength(3);
    const salt = (await idsOf(w, t))!.salt;
    for (const stored of [
      await record(w, 'Europe/London', t),
      await savedRecord(w, 'Europe/London', t, placeId(salt, 'place=durham-gb')),
      await savedRecord(w, 'Etc/GMT-2', t, placeId(salt, 'place=helsinki-fi')),
    ]) {
      expect(stored).toMatchObject({
        createdAt: iso(SNOWY),
        updatedAt: iso(SNOWY + 7 * DAY),
        seenAt: iso(SNOWY + 7 * DAY),
      });
    }
  });

  it('shadows the free place by a saved place in its cell, and stops once either goes', async () => {
    const w = world();
    const t = token('a4', 8);
    const leeds = { lat: 53.8, lon: -1.55, source: 'device' };
    await put2(w, body2({ token: t, here: leeds, saved: [DURHAM, LEEDS] }));
    const salt = (await idsOf(w, t))!.salt;
    expect(await record(w, 'Europe/London', t)).toMatchObject({
      shadowedBy: placeId(salt, 'place=leeds-gb'),
    });
    w.at(SNOWY + 2 * MINUTE);
    await put2(
      w,
      body2({ token: t, here: { lat: 54.8, lon: -1.6, source: 'device' }, saved: [DURHAM, LEEDS] }),
    );
    expect(await record(w, 'Europe/London', t)).toMatchObject({
      shadowedBy: placeId(salt, 'place=durham-gb'),
    });
    w.at(SNOWY + 4 * MINUTE);
    await put2(w, body2({ token: t, here: leeds, saved: [DURHAM] }));
    expect(await record(w, 'Europe/London', t)).not.toHaveProperty('shadowedBy');
    // A place from the connection is shadowed the same way.
    w.at(SNOWY + 6 * MINUTE);
    w.platform.geo = LEEDS_GEO;
    await put2(w, body2({ token: t, saved: [LEEDS] }));
    expect(await record(w, 'Europe/London', t)).toMatchObject({
      follows: 'ip',
      shadowedBy: placeId(salt, 'place=leeds-gb'),
    });
  });

  it('allows one change a minute per device: by its record for a v1 entry, by the entry for v2', async () => {
    const w = world({ geo: LEEDS_GEO });
    const t = token('a4', 9);
    await put(w, body({ token: t }));
    w.at(SNOWY + 30_000);
    const early = await put2(w, body2({ token: t }));
    expect(early.status).toBe(429);
    expect(early.headers.get('retry-after')).toBe('30');
    expect((await errorOf(early)).code).toBe('rate_limited');
    w.at(SNOWY + MINUTE);
    expect((await put2(w, body2({ token: t }))).status).toBe(200);
    w.at(SNOWY + MINUTE + 20_000);
    const again = await put2(w, body2({ token: t, units: 'f' }));
    expect(again.status).toBe(429);
    expect(again.headers.get('retry-after')).toBe('40');
    // A v1 body is held to the same minute.
    expect((await put(w, body({ token: t }))).status).toBe(429);
    expect(await record(w, 'Europe/London', t)).toMatchObject({ units: 'c' });
  });

  it('two saved places sharing a pid are a logged 500, never one record', async () => {
    const w = world({ geo: LEEDS_GEO });
    const t = token('a4', 10);
    vi.mocked(placeId).mockReturnValueOnce('0123456789ab').mockReturnValueOnce('0123456789ab');
    const r = await put2(w, body2({ token: t, saved: [DURHAM, HELSINKI] }));
    expect(r.status).toBe(500);
    expect((await errorOf(r)).code).toBe('server_error');
    expect(w.lines.at(-1)).toBe('devices: error: two saved places share the pid 0123456789ab');
    expect(keysFor(w, t)).toEqual([]);
  });
});

// ---- PUT, version 2: removals first ----

describe('PUT /api/v1/devices, version 2: removals first', () => {
  it('unstarring the last saved place with no geo leaves no saved record', async () => {
    const w = world({ geo: LEEDS_GEO });
    const t = token('a5', 1);
    await put2(w, body2({ token: t, saved: [HELSINKI] }));
    w.platform.geo = null;
    w.at(SNOWY + 2 * MINUTE);
    const r = await put2(w, body2({ token: t, saved: [] }));
    expect(r.status).toBe(200);
    expect((await reply2(r)).saved).toEqual([]);
    expect(keysFor(w, t)).toEqual([
      idsKey('snow', idOf(t)),
      regKey('Europe/London', 'snow', idOf(t)),
    ]);
  });

  it('a refund deletes the saved records, with the location shared or without geo', async () => {
    const w = world();
    const leeds = { lat: 53.8, lon: -1.55, source: 'device' };
    const t = token('a5', 2);
    await put2(w, body2({ token: t, here: leeds, saved: [HELSINKI, TOKYO] }));
    w.at(SNOWY + 2 * MINUTE);
    expect((await put2(w, body2({ token: t, here: leeds, saved: [] }))).status).toBe(200);
    expect(keysFor(w, t)).toEqual([
      idsKey('snow', idOf(t)),
      regKey('Europe/London', 'snow', idOf(t)),
    ]);

    const n = token('a5', 3);
    w.platform.geo = LEEDS_GEO;
    await put2(w, body2({ token: n, saved: [HELSINKI, TOKYO] }));
    w.platform.geo = null;
    w.at(SNOWY + 4 * MINUTE);
    expect((await put2(w, body2({ token: n, saved: [] }))).status).toBe(200);
    expect(keysFor(w, n)).toEqual([
      idsKey('snow', idOf(n)),
      regKey('Europe/London', 'snow', idOf(n)),
    ]);
  });

  it("removes within the minute too: a bell turned off, or the phone's location withdrawn, lands before the 429", async () => {
    const w = world();
    const leeds = { lat: 53.8, lon: -1.55, source: 'device' };
    const t = token('a5', 7);
    const id = idOf(t);
    // A bell turned on, and off again 20 s later (a mis-tap corrected, an unstar, a refund).
    expect((await put2(w, body2({ token: t, here: leeds, saved: [DURHAM] }))).status).toBe(200);
    w.at(SNOWY + 20_000);
    const off = await put2(w, body2({ token: t, here: leeds, saved: [] }));
    expect(off.status).toBe(429);
    expect(off.headers.get('retry-after')).toBe('40');
    expect(keysFor(w, t)).toEqual([idsKey('snow', id), regKey('Europe/London', 'snow', id)]);
    // The retry at Retry-After finds nothing more to remove.
    w.at(SNOWY + MINUTE);
    expect((await put2(w, body2({ token: t, here: leeds, saved: [] }))).status).toBe(200);
    expect(keysFor(w, t)).toEqual([idsKey('snow', id), regKey('Europe/London', 'snow', id)]);

    // The phone's location withdrawn 30 s after it was sent, with no geo: the point goes at once
    // (decision 4), the saved place stays, and the rest waits for the minute.
    const n = token('a5', 8);
    const nid = idOf(n);
    await put2(w, body2({ token: n, here: leeds, saved: [HELSINKI] }));
    const salt = (await idsOf(w, n))!.salt;
    w.at(SNOWY + MINUTE + 30_000);
    const withdrawn = await put2(w, body2({ token: n, here: IP, saved: [HELSINKI] }));
    expect(withdrawn.status).toBe(429);
    expect(keysFor(w, n)).toEqual([
      idsKey('snow', nid),
      regKey('Etc/GMT-2', 'snow', nid, placeId(salt, 'place=helsinki-fi')),
    ]);

    // And with nothing left to keep, the set is forgotten (decision 5), not refused.
    const o = token('a5', 9);
    await put2(w, body2({ token: o, here: leeds }));
    w.at(SNOWY + MINUTE + 50_000);
    const gone = await put2(w, body2({ token: o, here: IP }));
    expect(gone.status).toBe(400);
    expect((await errorOf(gone)).code).toBe('bad_location');
    expect(keysFor(w, o)).toEqual([]);
  });

  it('an unstar plus a failing new free cell still removes the place, and answers 503', async () => {
    let down = false;
    const w = world({
      geo: LEEDS_GEO,
      fetch: (synthetic) => async (url, init) =>
        down && new URL(url).pathname.endsWith('/forecast')
          ? new Response('down', { status: 500 })
          : synthetic(url, init),
    });
    const t = token('a5', 4);
    const id = idOf(t);
    await put2(w, body2({ token: t, saved: [HELSINKI, TOKYO] }));
    const salt = (await idsOf(w, t))!.salt;
    const helsinki = regKey('Etc/GMT-2', 'snow', id, placeId(salt, 'place=helsinki-fi'));
    w.at(SNOWY + MINUTE);
    w.platform.geo = NEWCASTLE_GEO;
    down = true;
    const r = await put2(w, body2({ token: t, saved: [HELSINKI] }));
    expect(r.status).toBe(503);
    expect((await errorOf(r)).code).toBe('upstream_unavailable');
    // Tokyo has gone; Leeds stays until its successor can be written; Helsinki is re-stamped.
    expect(keysFor(w, t)).toEqual(
      [idsKey('snow', id), regKey('Europe/London', 'snow', id), helsinki].sort(),
    );
    expect(await record(w, 'Europe/London', t)).toMatchObject({ query: LEEDS_CELL });
    expect(await w.store.get<DeviceRecord>(helsinki)).toMatchObject({
      updatedAt: iso(SNOWY + MINUTE),
    });
    expect(await idsOf(w, t)).toEqual({
      v: 2,
      tz: 'Europe/London',
      saved: [helsinki],
      salt,
      updatedAt: iso(SNOWY),
    });
    // The 503 didn't count as the minute's change: the retry 5 s on goes through, and finishes
    // the move.
    w.at(SNOWY + MINUTE + 5000);
    down = false;
    expect((await put2(w, body2({ token: t, saved: [HELSINKI] }))).status).toBe(200);
    expect(await record(w, 'Europe/London', t)).toMatchObject({
      query: 'lat=55&lon=-1.6&source=device',
    });
  });

  it('a failure at any step leaves the ids entry naming every copy, so a DELETE removes them all', async () => {
    const t = token('a5', 5);
    const id = idOf(t);
    let k = 0;
    let calls = 0;
    for (k = 1; k < 20; k++) {
      const inner = new MemoryAlertStore();
      let armed = false;
      calls = 0;
      const w = world({
        geo: LEEDS_GEO,
        store: failing(
          inner,
          (op, key) => armed && op !== 'get' && op !== 'list' && key.includes(id) && ++calls === k,
        ),
      });
      expect((await put2(w, body2({ token: t, saved: [DURHAM, HELSINKI] }))).status).toBe(200);
      // A move to another zone, a removal and an addition: every kind of write.
      w.at(SNOWY + 2 * MINUTE);
      w.platform.geo = NEW_YORK_GEO;
      armed = true;
      const r = await put2(w, body2({ token: t, saved: [HELSINKI, TOKYO] }));
      armed = false;
      if (r.status === 200) break;
      expect(r.status).toBe(503);
      expect((await errorOf(r)).code).toBe('store_unavailable');
      expect((await del(w, { app: 'snow', token: t })).status).toBe(204);
      expect(inner.keys().filter((key) => key.includes(id))).toEqual([]);
    }
    // Durham deleted; the ids entry naming the new places; three records; London's deleted;
    // the ids entry naming what is left.
    expect(calls).toBe(7);
    expect(k).toBe(8);
  });

  it('a lookup that throws is a 500, after the removals have landed', async () => {
    const w = world();
    const leeds = { lat: 53.8, lon: -1.55, source: 'device' };
    const t = token('a5', 6);
    const id = idOf(t);
    await put2(w, body2({ token: t, here: leeds, saved: [HELSINKI, TOKYO] }));
    const salt = (await idsOf(w, t))!.salt;
    // Location revoked and Tokyo unstarred, and the new cell's lookup throws.
    w.at(SNOWY + 2 * MINUTE);
    w.platform.geo = NEWCASTLE_GEO;
    w.platform.deps!.cache = {
      get: () => Promise.reject(new Error('the cache broke')),
      set: () => Promise.resolve(),
    };
    const r = await put2(w, body2({ token: t, here: IP, saved: [HELSINKI] }));
    expect(r.status).toBe(500);
    expect(w.lines.at(-1)).toBe('devices: error: the cache broke');
    expect(keysFor(w, t)).toEqual(
      [
        idsKey('snow', id),
        regKey('Etc/GMT-2', 'snow', id, placeId(salt, 'place=helsinki-fi')),
      ].sort(),
    );
  });
});

// ---- PUT, version 2: overlaps, and lookups that fail ----

describe('PUT /api/v1/devices, version 2: overlaps, and lookups that fail', () => {
  const leeds = { lat: 53.8, lon: -1.55, source: 'device' };
  /** A world whose forecasts fail while `down()` says so. */
  const downWorld = (down: () => boolean, o: { geo?: VisitorGeo } = {}) =>
    world({
      ...o,
      fetch: (synthetic) => async (url, init) =>
        down() && new URL(url).pathname.endsWith('/forecast')
          ? new Response('down', { status: 500 })
          : synthetic(url, init),
    });

  it('names what it wrote although the run forgot the device during its lookups, so a DELETE removes it all', async () => {
    let during: (() => Promise<void>) | null = null;
    const w = world({
      fetch: (synthetic) => async (url, init) => {
        const u = new URL(url);
        if (!u.pathname.endsWith('/forecast')) return synthetic(url, init);
        if (!u.searchParams.get('longitude')?.startsWith('139')) return synthetic(url, init);
        const run = during;
        during = null;
        await run?.();
        return new Response('down', { status: 500 });
      },
    });
    const t = token('a6', 1);
    const id = idOf(t);
    const { pid } = (await reply2(await put2(w, body2({ token: t, here: leeds, saved: [DURHAM] }))))
      .saved[0]!;
    const read = (await record(w, 'Europe/London', t))!;
    // The run forgets the phone (Apple refused it, say) while this PUT waits for Tokyo's forecast,
    // which fails.
    let forgot = '';
    during = async () => {
      forgot = await forgetDevice(w.store, 'snow', id, {
        tz: 'Europe/London',
        updatedAt: read.updatedAt,
        seenAt: read.seenAt,
      });
    };
    w.at(SNOWY + 2 * MINUTE);
    const r = await put2(w, body2({ token: t, here: leeds, saved: [DURHAM, TOKYO] }));
    expect(forgot).toBe('deleted');
    expect(r.status).toBe(503);
    const durham = regKey('Europe/London', 'snow', id, pid);
    expect(await idsOf(w, t)).toMatchObject({ tz: 'Europe/London', saved: [durham] });
    expect(keysFor(w, t)).toEqual([
      idsKey('snow', id),
      regKey('Europe/London', 'snow', id),
      durham,
    ]);
    expect((await del(w, { app: 'snow', token: t })).status).toBe(204);
    expect(keysFor(w, t)).toEqual([]);
  });

  it('two overlapping first registrations of one device share one salt, so each place is stored once', async () => {
    const w = world({
      fetch: (synthetic) => (url, init) =>
        new URL(url).pathname.endsWith('/forecast')
          ? new Promise<Response>((resolve) => setTimeout(() => resolve(synthetic(url, init)), 30))
          : synthetic(url, init),
    });
    // A new install, and an 8.1 install's first version 2 registration (an app's retry, say).
    const fresh = token('a6', 2);
    const upgraded = token('a6', 3);
    expect((await put(w, body({ token: upgraded }))).status).toBe(200);
    w.at(SNOWY + 2 * MINUTE);
    for (const t of [fresh, upgraded]) {
      const b = body2({ token: t, here: leeds, saved: [DURHAM] });
      const replies = await Promise.all([put2(w, b), put2(w, b)]);
      expect(replies.map((r) => r.status)).toEqual([200, 200]);
      const salt = (await idsOf(w, t))!.salt;
      expect(keysFor(w, t)).toEqual(
        [
          idsKey('snow', idOf(t)),
          regKey('Europe/London', 'snow', idOf(t)),
          regKey('Europe/London', 'snow', idOf(t), placeId(salt, 'place=durham-gb')),
        ].sort(),
      );
      expect((await del(w, { app: 'snow', token: t })).status).toBe(204);
      expect(keysFor(w, t)).toEqual([]);
    }
  });

  it("leaves every record of two overlapping first registrations named, though one's lookups fail, so a DELETE removes them all", async () => {
    /** Holds the calls `when` picks until `until` resolves, then passes them to `inner`. */
    const held = (
      inner: AlertStore,
      until: Promise<unknown>,
      when: (key: string, options?: { onlyIfNew?: boolean }) => boolean,
    ): AlertStore => ({
      get: (key) => inner.get(key),
      list: (prefix, options) => inner.list(prefix, options),
      delete: (key) => inner.delete(key),
      set: async (key, value, options) => {
        if (when(key, options)) await until;
        return inner.set(key, value, options);
      },
    });
    const failing =
      (fails: (u: URL) => boolean) =>
      (synthetic: FetchLike) =>
      async (url: string, init?: RequestInit) => {
        const u = new URL(url);
        return u.pathname.endsWith('/forecast') && fails(u)
          ? new Response('down', { status: 500 })
          : synthetic(url, init);
      };
    const durhamKeys = (store: MemoryAlertStore, t: string) =>
      store.keys().filter((k) => k.startsWith('reg/') && k.includes(idOf(t)) && pidKey(k));
    const pidKey = (key: string) => /\.[0-9a-f]{12}$/.test(key);
    const body = (t: string) => body2({ token: t, here: leeds, saved: [DURHAM] });

    // 1. Two bodies (a duplicate and a newer one, say): one with the phone's point and Durham,
    // answered 200; one with no place it can locate and Tokyo, whose lookup fails once the other
    // has answered.
    let release: () => void = () => {};
    const answered = new Promise<void>((resolve) => {
      release = resolve;
    });
    const w = world({
      fetch: (synthetic) => async (url, init) => {
        if (new URL(url).searchParams.get('longitude')?.startsWith('139')) {
          await answered;
          return new Response('down', { status: 500 });
        }
        return synthetic(url, init);
      },
    });
    const t = token('a6', 11);
    const id = idOf(t);
    const a = put2(w, body(t)).then((r) => {
      release();
      return r;
    });
    const b = put2(w, body2({ token: t, here: IP, saved: [TOKYO] }));
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.status, rb.status]).toEqual([200, 503]);
    const { pid } = (await reply2(ra)).saved[0]!;
    expect(await idsOf(w, t)).toMatchObject({
      tz: 'Europe/London',
      saved: [regKey('Europe/London', 'snow', id, pid)],
    });
    // The next registration keeps the one salt, so Durham has one record still.
    w.at(SNOWY + 2 * MINUTE);
    expect((await reply2(await put2(w, body(t)))).saved[0]!.pid).toBe(pid);
    expect(durhamKeys(w.store, t)).toHaveLength(1);
    expect((await del(w, { app: 'snow', token: t })).status).toBe(204);
    expect(keysFor(w, t)).toEqual([]);

    // 2 and 3. One body sent twice, reaching two function instances (each with its own forecast
    // cache): the second's salt write lands once the first has answered, and its lookups then
    // fail, all of them or only Durham's.
    for (const [n, fails] of [
      [12, () => true],
      [13, (u: URL) => u.searchParams.get('latitude')!.startsWith('54.')],
    ] as const) {
      let done: () => void = () => {};
      const first = new Promise<void>((resolve) => {
        done = resolve;
      });
      const one = world();
      const two = world({
        store: held(one.store, first, (_key, options) => options?.onlyIfNew === true),
        fetch: failing(fails),
      });
      const u = token('a6', n);
      const replies = await Promise.all([
        put2(one, body(u)).then((r) => {
          done();
          return r;
        }),
        put2(two, body(u)),
      ]);
      expect(replies.map((r) => r.status)).toEqual([200, 503]);
      const { pid: durham } = (await reply2(replies[0]!)).saved[0]!;
      expect(await idsOf(one, u)).toMatchObject({
        tz: 'Europe/London',
        saved: [regKey('Europe/London', 'snow', idOf(u), durham)],
      });
      expect((await del(one, { app: 'snow', token: u })).status).toBe(204);
      expect(keysFor(one, u)).toEqual([]);
    }
  });

  it('clears shadowedBy from a free place kept through a failed lookup once its saved place has gone', async () => {
    let down = false;
    const w = downWorld(() => down);
    const durhamCell = { lat: 54.8, lon: -1.6, source: 'device' };
    const t = token('a6', 4);
    await put2(w, body2({ token: t, here: leeds, saved: [LEEDS] }));
    const salt = (await idsOf(w, t))!.salt;
    const twin = placeId(salt, 'place=leeds-gb');
    expect(await record(w, 'Europe/London', t)).toMatchObject({ shadowedBy: twin });
    down = true;
    // It moves, and its new cell can't be looked up: kept as it was while Leeds is still saved,
    // with the set's stamp.
    w.at(SNOWY + MINUTE);
    expect((await put2(w, body2({ token: t, here: durhamCell, saved: [LEEDS] }))).status).toBe(503);
    expect(await record(w, 'Europe/London', t)).toMatchObject({
      query: LEEDS_CELL,
      shadowedBy: twin,
      updatedAt: iso(SNOWY + MINUTE),
    });
    // Leeds unstarred as well: its notification no longer goes, so where you are notifies again.
    w.at(SNOWY + 2 * MINUTE);
    expect((await put2(w, body2({ token: t, here: durhamCell, saved: [] }))).status).toBe(503);
    const kept = await record(w, 'Europe/London', t);
    expect(kept).toMatchObject({ query: LEEDS_CELL, updatedAt: iso(SNOWY + 2 * MINUTE) });
    expect(kept).not.toHaveProperty('shadowedBy');
    expect(keysFor(w, t)).toEqual(
      [idsKey('snow', idOf(t)), regKey('Europe/London', 'snow', idOf(t))].sort(),
    );
  });

  it('re-stamps a free place kept through a failed lookup with the set, so Apple refusing either place forgets the phone', async () => {
    const newcastle = { lat: 54.98, lon: -1.62, source: 'device' };
    for (const refused of ['free', 'saved'] as const) {
      let down = false;
      const w = downWorld(() => down);
      const t = token('a6', refused === 'free' ? 9 : 10);
      const id = idOf(t);
      await put2(w, body2({ token: t, here: leeds, saved: [TOKYO] }));
      const salt = (await idsOf(w, t))!.salt;
      const tokyo = regKey('Etc/GMT-9', 'snow', id, placeId(salt, 'place=tokyo-jp'));
      // It moves, and its new cell can't be looked up: Leeds is kept, with the set's stamp.
      w.at(SNOWY + 2 * MINUTE);
      down = true;
      expect((await put2(w, body2({ token: t, here: newcastle, saved: [TOKYO] }))).status).toBe(
        503,
      );
      const free = (await record(w, 'Europe/London', t))!;
      expect(free).toMatchObject({
        query: LEEDS_CELL,
        createdAt: iso(SNOWY),
        updatedAt: iso(SNOWY + 2 * MINUTE),
        seenAt: iso(SNOWY + 2 * MINUTE),
      });
      expect(await w.store.get(tokyo)).toMatchObject({ updatedAt: iso(SNOWY + 2 * MINUTE) });
      // The app is deleted, and Apple refuses one place's push: every place goes, and the salt.
      const trigger = refused === 'free' ? free : (await w.store.get<DeviceRecord>(tokyo))!;
      expect(
        await forgetDevice(w.store, 'snow', id, {
          tz: trigger.tz,
          ...(refused === 'saved' ? { slot: placeId(salt, 'place=tokyo-jp') } : {}),
          updatedAt: trigger.updatedAt,
          seenAt: trigger.seenAt,
        }),
      ).toBe('deleted');
      expect(keysFor(w, t)).toEqual([]);
    }
  });

  it('keeps nothing, not even an ids key, when a registration has no place it could look up', async () => {
    let down = true;
    const w = downWorld(() => down, { geo: LEEDS_GEO });
    // A new install whose every lookup fails, with a saved place or without.
    for (const [n, saved] of [
      [6, []],
      [7, [DURHAM]],
    ] as const) {
      const t = token('a6', n);
      const r = await put2(w, body2({ token: t, saved }));
      expect(r.status).toBe(503);
      expect(keysFor(w, t)).toEqual([]);
    }
    // 8.1's location, deleted once it isn't shared (decision 4), and the connection's cell can't
    // be looked up: nothing is left.
    down = false;
    const t = token('a6', 8);
    expect((await put(w, body({ token: t, place: leeds }))).status).toBe(200);
    down = true;
    w.at(SNOWY + 2 * MINUTE);
    w.platform.geo = NEWCASTLE_GEO;
    expect((await put2(w, body2({ token: t }))).status).toBe(503);
    expect(keysFor(w, t)).toEqual([]);
  });
});

// ---- Version 1 bodies and DELETE of a set ----

describe('PUT /api/v1/devices: a v1 body after a set', () => {
  it('is answered as before, and replaces the set with its one place', async () => {
    const w = world({ geo: LEEDS_GEO });
    const t = token('a6', 1);
    const id = idOf(t);
    await put2(w, body2({ token: t, saved: [HELSINKI, TOKYO] }));
    w.at(SNOWY + 2 * MINUTE);
    const r = await put(w, body({ token: t, place: DURHAM }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      id,
      place: { name: 'Durham', timezone: 'Europe/London', query: 'place=durham-gb' },
      alerts: { snow: EVENING },
      seenAt: iso(SNOWY + 2 * MINUTE),
    });
    expect(keysFor(w, t)).toEqual([idsKey('snow', id), regKey('Europe/London', 'snow', id)]);
    expect(await w.store.get(idsKey('snow', id))).toEqual({ tz: 'Europe/London' });
    const stored = await record(w, 'Europe/London', t);
    expect(Object.keys(stored!)).toEqual(RECORD_KEYS);
    expect(stored).toMatchObject({ query: 'place=durham-gb', createdAt: iso(SNOWY) });
  });
});

describe('DELETE /api/v1/devices: a set', () => {
  it('removes every place and the salt, so nothing left can be matched to a place', async () => {
    const w = world({ geo: LEEDS_GEO });
    const t = token('a6', 2);
    const id = idOf(t);
    const reply = await reply2(await put2(w, body2({ token: t, saved: [DURHAM, HELSINKI] })));
    const salt = (await idsOf(w, t))!.salt;
    const durham = reply.saved[0]!.pid;
    expect(durham).toBe(placeId(salt, 'place=durham-gb'));
    // The note the run keeps of a notification names the pid.
    const note = `sent/v1/2026-11-12/snow.evening/snow.${id}.${durham}`;
    await w.store.set(note, { at: iso(SNOWY) });
    expect((await del(w, { app: 'snow', token: t })).status).toBe(204);
    expect(w.store.keys()).toEqual([note]);
    expect(w.lines.at(-1)).toBe(`devices: deleted snow.${id.slice(0, 8)}…`);
    // Without the salt, no candidate place gives the pid: hashed alone, or keyed by the id.
    for (const { slug } of CITIES) {
      const query = `place=${slug}`;
      expect(createHash('sha256').update(query).digest('hex').slice(0, 12)).not.toBe(durham);
      expect(placeId(id, query)).not.toBe(durham);
      expect(placeId('', query)).not.toBe(durham);
    }
  });
});

// ---- The client's bodies ----

describe("the contract with packages/client's registrationBody", () => {
  const hexham = searchTarget({
    name: 'Hexham',
    region: 'England',
    country: 'GB',
    countryName: 'United Kingdom',
    lat: 54.97,
    lon: -2.1,
    geonameId: 2647007,
    elevation: 50,
  });
  const targets: Array<[string, PlaceTarget]> = [
    ['a city', { kind: 'city', slug: 'leeds-gb', name: 'Leeds' }],
    [
      'a searched city, which the search gives as its page',
      searchTarget({
        name: 'Durham',
        region: 'England',
        country: 'GB',
        countryName: 'United Kingdom',
        lat: 54.7768,
        lon: -1.5757,
        slug: 'durham-gb',
        geonameId: 2650628,
      }),
    ],
    ['a searched place with everything the search knew', hexham],
    [
      'a searched place without a height',
      { kind: 'coords', source: 'search', lat: 54.95, lon: -2.1, name: 'Hexham', country: 'GB' },
    ],
    [
      'an unnamed searched place',
      { kind: 'coords', source: 'search', lat: 54.95, lon: -2.1, region: null },
    ],
    [
      'an unnamed searched place with no town near',
      { kind: 'coords', source: 'search', lat: 1, lon: 2 },
    ],
    ['a device location', deviceTarget(53.81, -1.56)],
    ['a named device location', { ...deviceTarget(54.81, -1.59), name: 'Durham' }],
    ['a device location in another zone', deviceTarget(40.71, -74.01)],
  ];
  const switches: AlertPrefs[] = [
    { evening: true, morning: false, possible: false },
    { evening: false, morning: true, possible: false },
    { evening: true, morning: true, possible: false },
    { evening: true, morning: false, possible: true },
    { evening: false, morning: true, possible: true },
    { evening: true, morning: true, possible: true },
  ];

  it.each(targets)('takes every body the app makes for %s', async (_name, target) => {
    const w = world();
    let n = 0;
    for (const prefs of switches) {
      for (const units of ['c', 'f'] as const) {
        const env = n % 2 ? 'production' : 'sandbox';
        const t = token('ee', n++);
        const sent: RegistrationBody = registrationBody({
          token: t,
          env,
          place: target,
          units,
          prefs,
          appVersion: '1.0 (112)',
        });
        expect(Buffer.byteLength(JSON.stringify(sent))).toBeLessThan(DEVICE_LIMITS.bodyBytes / 2);
        const r = await put(w, sent);
        expect(r.status).toBe(200);
        const reply = (await r.json()) as {
          place: { query: string; timezone: string; name: string };
        };
        const stored = await record(w, reply.place.timezone, t);
        expect(stored).toMatchObject({ env, units, alerts: { snow: prefs }, token: t });
        // A tap on its notification opens the app's own place.
        const route = notificationRoute(
          {
            topic: 'snow',
            kind: 'evening',
            date: '2026-11-12',
            view: 'today',
            place: stored!.query,
            name: stored!.name,
          },
          () => null,
        );
        expect(route).toMatchObject({ kind: 'place', view: 'today' });
        expect(targetKey((route as { target: PlaceTarget }).target)).toBe(targetKey(target));
      }
    }
  });
});

// ---- POST /api/v1/devices/test ----

describe('POST /api/v1/devices/test', () => {
  it('is 404 not_registered for a device with no registration', async () => {
    const { w, fake } = await withApple();
    const t = token('aa', 200);
    const r = await sendTest(w, { app: 'snow', token: t });
    expect(r.status).toBe(404);
    expect(await errorOf(r)).toEqual({
      code: 'not_registered',
      message: "This device isn't registered for notifications.",
    });
    await put(w, body({ token: t }));
    await del(w, { app: 'snow', token: t });
    expect((await sendTest(w, { app: 'snow', token: t })).status).toBe(404);
    expect(fake.seen).toEqual([]);
  });

  it('checks the body as DELETE does', async () => {
    const { w } = await withApple();
    expect((await errorOf(await sendTest(w, { app: 'snow', token: 'zz' }))).code).toBe(
      'bad_request',
    );
    expect((await errorOf(await sendTest(w, { app: 'all', token: token() }))).code).toBe(
      'app_not_live',
    );
    expect((await sendTest(w, 'x'.repeat(9000))).status).toBe(413);
  });

  it("sends tomorrow's real evening notification when the rule sends one", async () => {
    const { w, fake, envs, payloads } = await withApple();
    const t = token('aa', 210);
    // The evening switch off: the test sends the evening's words whatever it says.
    const prefs = { evening: false, morning: true, possible: false };
    await put(w, body({ token: t, place: DURHAM, alerts: { snow: prefs } }));
    w.at(SNOWY + 10 * MINUTE);
    const r = await sendTest(w, { app: 'snow', token: t });
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ sent: true });
    expect(envs).toEqual(['sandbox']);
    expect(fake.seen).toHaveLength(1);
    const { headers, body: sentBody } = fake.seen[0]!;
    expect(headers[':path']).toBe(`/3/device/${t}`);
    expect(headers['apns-topic']).toBe('today.willitsnow.app');
    expect(headers['apns-push-type']).toBe('alert');
    expect(headers['apns-priority']).toBe('10');
    expect(headers['apns-expiration']).toBe(String((SNOWY + 10 * MINUTE) / 1000 + 15 * 60));
    expect(headers['apns-collapse-id']).toBe('snow-evening-2026-11-12');
    expect(headers['apns-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(signed(String(headers.authorization).replace(/^bearer /, ''))).toBe(SANDBOX.keyId);
    expect(JSON.parse(sentBody)).toEqual({
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
    expect(payloads()).toHaveLength(1);
    expect(w.lines).toContain(
      `devices: test sent to snow.${idOf(t).slice(0, 8)}… (sandbox, the evening notification)`,
    );
  });

  it('sends the fixed words when the rule sends nothing, with the production key for production', async () => {
    const { w, fake, envs, payloads } = await withApple();
    const t = token('aa', 220);
    await put(w, body({ token: t, env: 'production' }));
    const r = await sendTest(w, { app: 'snow', token: t });
    expect(r.status).toBe(202);
    expect(envs).toEqual(['production']);
    const { headers } = fake.seen[0]!;
    expect(signed(String(headers.authorization).replace(/^bearer /, ''))).toBe(PRODUCTION.keyId);
    expect(headers['apns-collapse-id']).toBe('snow-test');
    expect(payloads()[0]).toEqual({
      aps: {
        alert: {
          title: 'Test notification',
          body: "Notifications are working. We'll tell you when snow is likely in Leeds.",
        },
        sound: 'default',
        'thread-id': 'snow',
        'interruption-level': 'active',
        'relevance-score': 0.3,
      },
      topic: 'snow',
      kind: 'evening',
      date: '2026-11-11',
      view: 'today',
      place: 'place=leeds-gb',
      name: 'Leeds',
    });
  });

  it('follows the record\'s "possible" choice', async () => {
    const { w, payloads } = await withApple({}, { now: POSSIBLE });
    const without = token('aa', 230);
    const withIt = token('aa', 231);
    await put(w, body({ token: without, place: DURHAM }));
    await put(
      w,
      body({ token: withIt, place: DURHAM, alerts: { snow: { ...EVENING, possible: true } } }),
    );
    expect((await sendTest(w, { app: 'snow', token: without })).status).toBe(202);
    expect((await sendTest(w, { app: 'snow', token: withIt })).status).toBe(202);
    const [fixed, possible] = payloads().map((p) => (p.aps as { alert: unknown }).alert);
    expect(fixed).toEqual({
      title: 'Test notification',
      body: "Notifications are working. We'll tell you when snow is likely in Durham.",
    });
    expect(possible).toEqual({
      title: 'Snow possible in Durham tomorrow',
      body: 'Some forecasts say up to 1cm. Mostly between 3am and 6am. 2 of 6 forecasts expect snow.',
    });
    expect((payloads()[1]!.aps as Record<string, unknown>)['relevance-score']).toBe(0.3);
  });

  it('says "near you" for a device location with no town', async () => {
    const { w, payloads } = await withApple();
    const t = token('aa', 240);
    await put(w, body({ token: t, place: { lat: 1, lon: 2, source: 'device' } }));
    expect((await sendTest(w, { app: 'snow', token: t })).status).toBe(202);
    expect(payloads()[0]).toMatchObject({
      aps: {
        alert: {
          title: 'Test notification',
          body: "Notifications are working. We'll tell you when snow is likely near you.",
        },
      },
      place: 'lat=1&lon=2&source=device',
      name: 'Your location',
    });
  });

  const placed: Array<[string, unknown, PlaceTarget, string, string]> = [
    ['a city', DURHAM, { kind: 'city', slug: 'durham-gb' }, 'place=durham-gb', 'Durham'],
    [
      'a searched place',
      HEXHAM,
      { kind: 'coords', source: 'search', lat: 54.95, lon: -2.1 },
      HEXHAM_QUERY,
      'Hexham',
    ],
    [
      'an unnamed searched place',
      { lat: 54.95, lon: -2.1, source: 'search' },
      { kind: 'coords', source: 'search', lat: 54.95, lon: -2.1 },
      'lat=54.95&lon=-2.1&name=Hexham&region=England&country=GB&geonameId=2647007&source=search',
      'Hexham',
    ],
    [
      'a device location',
      { lat: 54.8, lon: -1.6, source: 'device' },
      deviceTarget(54.8, -1.6),
      'lat=54.8&lon=-1.6&source=device',
      'Durham',
    ],
  ];

  it.each(placed)('carries the place for %s', async (_name, place, target, query, name) => {
    const { w, fake, payloads } = await withApple();
    const t = token('aa', 250);
    const reply = (await (await put(w, body({ token: t, place }))).json()) as {
      place: { query: string };
    };
    expect(reply.place.query).toBe(query);
    expect((await sendTest(w, { app: 'snow', token: t })).status).toBe(202);
    const payload = payloads()[0]!;
    expect(payload).toMatchObject({ place: query, name, date: '2026-11-12' });
    expect((payload.aps as { alert: { title: string } }).alert.title).toBe(
      `Snow likely in ${name} tomorrow`,
    );
    expect(Buffer.byteLength(fake.seen[0]!.body)).toBeLessThanOrEqual(1024);
    const route = notificationRoute(payload, () => '2026-11-11');
    expect(route).toMatchObject({ kind: 'place', view: 'today' });
    expect(targetKey((route as { target: PlaceTarget }).target)).toBe(targetKey(target));
  });

  it('allows 3 an hour per id (429 test_limited), and more the next hour', async () => {
    expect(ALERTS.testPerHour).toBe(3);
    const { w, fake } = await withApple();
    const t = token('aa', 260);
    await put(w, body({ token: t }));
    for (let i = 0; i < 3; i++) {
      w.at(SNOWY + i * MINUTE);
      expect((await sendTest(w, { app: 'snow', token: t })).status).toBe(202);
    }
    w.at(SNOWY + 20 * MINUTE);
    const limited = await sendTest(w, { app: 'snow', token: t });
    expect(limited.status).toBe(429);
    expect(await errorOf(limited)).toEqual({
      code: 'test_limited',
      message: "That's 3 test notifications this hour. Try again later.",
    });
    // 18:25 UTC: 35 minutes to the next hour.
    expect(limited.headers.get('retry-after')).toBe(String(35 * 60));
    // Another device has its own three.
    const other = token('aa', 261);
    await put(w, body({ token: other }));
    expect((await sendTest(w, { app: 'snow', token: other })).status).toBe(202);
    w.at(Date.UTC(2026, 10, 11, 19, 0));
    expect((await sendTest(w, { app: 'snow', token: t })).status).toBe(202);
    expect(fake.seen).toHaveLength(5);
  });

  it('sends nothing in the quiet hours at the place (409 quiet_hours), and costs no test', async () => {
    const { w, fake } = await withApple();
    const t = token('aa', 270);
    await put(w, body({ token: t }));
    const late = Date.UTC(2026, 10, 11, 23, 30);
    w.at(late);
    const r = await sendTest(w, { app: 'snow', token: t });
    expect(r.status).toBe(409);
    expect(await errorOf(r)).toEqual({
      code: 'quiet_hours',
      message: 'Nothing is sent from 9pm to 7am at the place. Try again after 7am there.',
    });
    // 23:30 GMT: seven and a half hours to 07:00.
    expect(r.headers.get('retry-after')).toBe(String(7.5 * 3600));
    expect(fake.seen).toEqual([]);
    expect(w.store.keys().filter((k) => k.startsWith('test/'))).toEqual([]);
    expect(w.lines).toContain(
      `devices: test not sent to snow.${idOf(t).slice(0, 8)}…: quiet hours in Europe/London`,
    );
    // The edges, by the place's clock (London is on GMT in November).
    const at = async (h: number, m: number) => {
      w.at(Date.UTC(2026, 10, 12, h, m));
      return (await sendTest(w, { app: 'snow', token: t })).status;
    };
    expect(await at(6, 59)).toBe(409);
    expect(await at(7, 0)).toBe(202);
    expect(await at(20, 59)).toBe(202);
    expect(await at(21, 0)).toBe(409);
    expect(fake.seen).toHaveLength(2);
    expect(fake.seen[0]!.headers['apns-expiration']).toBe(
      String(Date.UTC(2026, 10, 12, 7) / 1000 + 900),
    );
    // A place in another zone keeps its own hours: 21:00 in London is 16:00 in New York.
    const ny = token('aa', 271);
    await put(w, body({ token: ny, place: NEW_YORK }));
    expect((await sendTest(w, { app: 'snow', token: ny })).status).toBe(202);
    expect(fake.seen).toHaveLength(3);
  });

  it('a missing or unreadable key is a clear 503 that costs no test', async () => {
    const t = token('aa', 280);
    const missing = await withApple({}, { settings: { APNS_KEY_SANDBOX: undefined } });
    await put(missing.w, body({ token: t }));
    for (let i = 0; i < 4; i++) {
      const r = await sendTest(missing.w, { app: 'snow', token: t });
      expect(r.status).toBe(503);
      expect(await errorOf(r)).toEqual({
        code: 'push_unavailable',
        message: "Test notifications can't be sent just now. Try again later.",
      });
    }
    expect(missing.w.lines).toContain(
      'devices: error: no sandbox APNs key: missing APNS_KEY_SANDBOX',
    );
    expect(missing.fake.seen).toEqual([]);
    expect(missing.w.store.keys().filter((k) => k.startsWith('test/'))).toEqual([]);

    const unreadable = await withApple({}, { settings: { APNS_KEY_SANDBOX: 'not a key at all' } });
    await put(unreadable.w, body({ token: t }));
    expect((await sendTest(unreadable.w, { app: 'snow', token: t })).status).toBe(503);
    expect(unreadable.w.lines.join('\n')).toMatch(/the sandbox APNs key: not a \.p8 key/);
    expect(unreadable.w.lines.join('\n')).not.toContain('not a key at all');
  });

  it('is a dry run, logging the notification instead, until ALERTS_DRY_RUN is false', async () => {
    const noKeys = {
      ALERTS_DRY_RUN: undefined,
      APNS_KEY_SANDBOX: undefined,
      APNS_KEY_PRODUCTION: undefined,
    };
    for (const deployContext of ['production', 'deploy-preview', 'branch-deploy', 'dev']) {
      const { w, fake } = await withApple({}, { deployContext, settings: noKeys });
      const t = token('aa', 290);
      await put(w, body({ token: t, place: DURHAM }));
      const r = await sendTest(w, { app: 'snow', token: t });
      expect(r.status).toBe(202);
      expect(await r.json()).toEqual({ sent: false, dryRun: true });
      expect(fake.seen).toEqual([]);
      // The sender's dry-run line, as the run logs it, then the endpoint's own.
      expect(w.lines.slice(-2)).toEqual([
        `alerts: dry run: snow.${idOf(t).slice(0, 8)}… sandbox evening 2026-11-12: Snow likely in Durham tomorrow / 1 to 2cm of snow. Mostly between 2am and 7am. 5 of 6 forecasts expect snow.`,
        `devices: test not sent to snow.${idOf(t).slice(0, 8)}… (sandbox, the evening notification): a dry run`,
      ]);
      // It still counts towards the hour's three.
      expect(w.store.keys().filter((k) => k.startsWith('test/'))).toHaveLength(1);
    }
    const decide = async (deployContext: string, setting: string | undefined) => {
      const { w, fake } = await withApple(
        {},
        { deployContext, settings: { ALERTS_DRY_RUN: setting } },
      );
      const t = token('aa', 291);
      await put(w, body({ token: t }));
      const reply = (await (await sendTest(w, { app: 'snow', token: t })).json()) as object;
      return { reply, pushes: fake.seen.length };
    };
    // Unlike the run, a test follows the setting off production too, so a preview can reach Apple.
    for (const context of ['production', 'deploy-preview', 'branch-deploy', 'dev']) {
      expect(await decide(context, 'false')).toEqual({ reply: { sent: true }, pushes: 1 });
    }
    expect(await decide('deploy-preview', ' FALSE ')).toEqual({ reply: { sent: true }, pushes: 1 });
    expect(await decide('production', 'true')).toEqual({
      reply: { sent: false, dryRun: true },
      pushes: 0,
    });
    expect(await decide('production', undefined)).toEqual({
      reply: { sent: false, dryRun: true },
      pushes: 0,
    });
    expect(await decide('deploy-preview', 'yes')).toEqual({
      reply: { sent: false, dryRun: true },
      pushes: 0,
    });
  });

  const answers: Array<[string, FakeReply, number, string | null, boolean]> = [
    [
      '400 BadDeviceToken',
      { status: 400, body: { reason: 'BadDeviceToken' } },
      404,
      'not_registered',
      false,
    ],
    [
      '400 DeviceTokenNotForTopic',
      { status: 400, body: { reason: 'DeviceTokenNotForTopic' } },
      404,
      'not_registered',
      false,
    ],
    [
      '410 Unregistered',
      { status: 410, body: { reason: 'Unregistered', timestamp: SNOWY + HOUR } },
      404,
      'not_registered',
      false,
    ],
    [
      '410 Unregistered before it registered again',
      { status: 410, body: { reason: 'Unregistered', timestamp: SNOWY - HOUR } },
      502,
      'push_refused',
      true,
    ],
    [
      '403 ExpiredProviderToken',
      { status: 403, body: { reason: 'ExpiredProviderToken' } },
      503,
      'push_unavailable',
      true,
    ],
    [
      '429 TooManyRequests',
      { status: 429, body: { reason: 'TooManyRequests' } },
      503,
      'push_unavailable',
      true,
    ],
    [
      '503 ServiceUnavailable',
      { status: 503, body: { reason: 'ServiceUnavailable' } },
      503,
      'push_unavailable',
      true,
    ],
    [
      '400 BadExpirationDate',
      { status: 400, body: { reason: 'BadExpirationDate' } },
      502,
      'push_refused',
      true,
    ],
  ];

  it.each(answers)("acts on Apple's %s", async (_name, reply, status, code, kept) => {
    const { w, fake } = await withApple({ bb: reply });
    const t = token('bb', 300);
    await put(w, body({ token: t }));
    w.at(SNOWY + 2 * HOUR);
    const r = await sendTest(w, { app: 'snow', token: t });
    expect(r.status).toBe(status);
    expect((await errorOf(r)).code).toBe(code);
    expect(fake.seen).toHaveLength(1);
    const left = w.store.keys().filter((k) => k.startsWith('reg/') || k.startsWith('ids/'));
    expect(left).toHaveLength(kept ? 2 : 0);
    if (reply !== 'hang' && reply.status === 403) {
      // The refused provider token is dropped, so the next request makes a new one.
      expect(await w.store.get(jwtKey('sandbox'))).toBeNull();
    } else {
      expect(await w.store.get(jwtKey('sandbox'))).toMatchObject({
        iat: (SNOWY + 2 * HOUR) / 1000,
      });
    }
  });

  it('no answer from Apple is a 503', async () => {
    const hung = await fakeApns(apple({ dd: 'hang' }));
    const w = world({ connect: () => apnsSender(hung.origin, 100) });
    const t = token('dd', 310);
    await put(w, body({ token: t }));
    const r = await sendTest(w, { app: 'snow', token: t });
    expect(r.status).toBe(503);
    expect((await errorOf(r)).code).toBe('push_unavailable');
    expect(hung.seen).toHaveLength(1);
    expect(w.lines.join('\n')).toMatch(
      /^alerts: error: stopped sandbox for this run: no answer from APNs for snow\.[0-9a-f]{8}…: /m,
    );
    expect(w.lines.at(-1)).toBe(
      `devices: test not sent to snow.${idOf(t).slice(0, 8)}… (sandbox, the test words): released`,
    );

    // Nobody listening at all.
    const closed = await new Promise<number>((resolve) => {
      const s = createServer();
      s.listen(0, () => {
        const { port } = s.address() as AddressInfo;
        s.close(() => resolve(port));
      });
    });
    const nobody = world({ connect: () => apnsSender(`http://localhost:${closed}`, 500) });
    const n = token('aa', 311);
    await put(nobody, body({ token: n }));
    expect((await sendTest(nobody, { app: 'snow', token: n })).status).toBe(503);
  });

  it('shares the provider token with the run, through the store', async () => {
    const { w, fake } = await withApple();
    const a = token('aa', 320);
    const b = token('aa', 321);
    await put(w, body({ token: a }));
    await put(w, body({ token: b }));
    await sendTest(w, { app: 'snow', token: a });
    const stored = await w.store.get<{ jwt: string; iat: number }>(jwtKey('sandbox'));
    expect(stored).toMatchObject({ iat: SNOWY / 1000 });
    w.at(SNOWY + 10 * MINUTE);
    await sendTest(w, { app: 'snow', token: b });
    const [first, second] = fake.seen.map((s) => s.headers.authorization);
    expect(first).toBe(`bearer ${stored!.jwt}`);
    expect(second).toBe(first);
  });

  it('sends the fixed words when the forecast is slow or down', async () => {
    let hang = false;
    const slow = await withApple(
      {},
      {
        testForecastWaitMs: 50,
        // Answers, but long after the test has stopped waiting.
        fetch: (synthetic) => (url, init) =>
          hang && new URL(url).pathname.endsWith('/forecast')
            ? new Promise<Response>((resolve) =>
                setTimeout(() => resolve(synthetic(url, init)), 300),
              )
            : synthetic(url, init),
      },
    );
    const t = token('aa', 330);
    await put(slow.w, body({ token: t, place: { lat: 54.8, lon: -1.6, source: 'device' } }));
    // A new hour, so the cached forecast is too old to use.
    slow.w.at(SNOWY + HOUR);
    hang = true;
    expect((await sendTest(slow.w, { app: 'snow', token: t })).status).toBe(202);
    expect((slow.payloads()[0]!.aps as { alert: unknown }).alert).toEqual({
      title: 'Test notification',
      body: "Notifications are working. We'll tell you when snow is likely in Durham.",
    });

    let down = false;
    const failed = await withApple(
      {},
      {
        // Registered seven hours before the test, so no cached forecast is young enough to stand
        // in, and the test is at 18:05, outside the quiet hours.
        now: SNOWY - 7 * HOUR,
        fetch: (synthetic) => async (url, init) =>
          down && new URL(url).pathname.endsWith('/forecast')
            ? new Response('down', { status: 500 })
            : synthetic(url, init),
      },
    );
    await put(failed.w, body({ token: t, place: DURHAM }));
    failed.w.at(SNOWY);
    down = true;
    expect((await sendTest(failed.w, { app: 'snow', token: t })).status).toBe(202);
    expect((failed.payloads()[0]!.aps as { alert: { title: string } }).alert.title).toBe(
      'Test notification',
    );
  });

  it('a claim the store cannot confirm is a 503, and nothing is sent', async () => {
    const inner = new MemoryAlertStore();
    const { w, fake } = await withApple(
      {},
      { store: failing(inner, (op, key) => op === 'set' && key.startsWith('test/')) },
    );
    const t = token('aa', 340);
    await put(w, body({ token: t }));
    const r = await sendTest(w, { app: 'snow', token: t });
    expect(r.status).toBe(503);
    expect((await errorOf(r)).code).toBe('store_unavailable');
    expect(fake.seen).toEqual([]);
  });

  it("keeps a registration Apple refused if it changed meanwhile, or can't be deleted", async () => {
    // Apple refuses the device while the app registers again (a new updatedAt).
    const shared = new MemoryAlertStore();
    const t = token('b4', 350);
    const racing = await fakeApns(async () => {
      const key = regKey('Europe/London', 'snow', idOf(t));
      const current = await shared.get<DeviceRecord>(key);
      await shared.set(key, { ...current, updatedAt: iso(SNOWY + 3 * MINUTE) });
      return { status: 400, body: { reason: 'BadDeviceToken' } };
    });
    const w = world({ store: shared, connect: () => apnsSender(racing.origin, 1000) });
    await put(w, body({ token: t }));
    const changed = await sendTest(w, { app: 'snow', token: t });
    expect(changed.status).toBe(502);
    expect((await errorOf(changed)).code).toBe('push_refused');
    expect(await shared.get(regKey('Europe/London', 'snow', idOf(t)))).not.toBeNull();
    const who = `snow.${idOf(t).slice(0, 8)}…`;
    expect(w.lines.slice(-2)).toEqual([
      `alerts: kept ${who} (400 BadDeviceToken, sandbox, app 1.0 (112)): it registered again since`,
      `devices: test not sent to ${who} (sandbox, the test words): kept`,
    ]);

    const inner = new MemoryAlertStore();
    const refusing = await withApple(
      { b4: { status: 400, body: { reason: 'BadDeviceToken' } } },
      { store: failing(inner, (op, key) => op === 'delete' && key.startsWith('reg/')) },
    );
    await put(refusing.w, body({ token: t }));
    const failed = await sendTest(refusing.w, { app: 'snow', token: t });
    expect(failed.status).toBe(502);
    expect(inner.keys().filter((k) => /^(reg|ids)\//.test(k))).toHaveLength(2);
  });

  it('a key that cannot sign is a 503', async () => {
    const broken = `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(64)}\n-----END PRIVATE KEY-----`;
    const { w, fake } = await withApple({}, { settings: { APNS_KEY_SANDBOX: broken } });
    const t = token('aa', 360);
    await put(w, body({ token: t }));
    const r = await sendTest(w, { app: 'snow', token: t });
    expect(r.status).toBe(503);
    expect((await errorOf(r)).code).toBe('push_unavailable');
    expect(fake.seen).toEqual([]);
    expect(w.lines.at(-2)).toMatch(/^alerts: error: no sandbox provider token \(.*\): 1 deferred$/);
    expect(w.lines.at(-1)).toBe(
      `devices: test not sent to snow.${idOf(t).slice(0, 8)}… (sandbox, the test words): deferred`,
    );
  });
});

// ---- POST /api/v1/devices/test for a set ----

describe('POST /api/v1/devices/test for a set', () => {
  const collapse = (fake: { seen: Array<{ headers: IncomingHttpHeaders }> }) =>
    fake.seen.map((s) => s.headers['apns-collapse-id']).sort();

  it('tests where you are and the last saved place, never more, one after another, on one claim: count 2', async () => {
    const { w, fake } = await withApple({}, { geo: LEEDS_GEO });
    const t = token('b1', 1);
    const reply = await reply2(
      await put2(w, body2({ token: t, saved: [HELSINKI, REYKJAVIK, DURHAM] })),
    );
    const durham = reply.saved[2]!.pid;
    w.at(SNOWY + 10 * MINUTE);
    const r = await sendTest(w, { app: 'snow', token: t });
    expect(r.status).toBe(202);
    expect(await r.text()).toBe('{"sent":true,"count":2}');
    // Leeds has no snow tomorrow, so the test's words; Durham's real evening notification.
    expect(collapse(fake)).toEqual([`snow-evening-2026-11-12-${durham}`, 'snow-test']);
    expect(fake.seen.map((s) => s.inFlight)).toEqual([1, 1]);
    expect(fake.stats.sessions).toBe(1);
    expect(w.store.keys().filter((k) => k.startsWith('test/'))).toHaveLength(1);
    const who = `snow.${idOf(t).slice(0, 8)}…`;
    expect(w.lines.slice(-2).sort()).toEqual([
      `devices: test sent to ${who} (sandbox, the test words)`,
      `devices: test sent to ${who}.${durham} (sandbox, the evening notification)`,
    ]);
  });

  it("threads each place's test on its own, and the free place's under snow", async () => {
    const { w, payloads } = await withApple({}, { geo: LEEDS_GEO });
    const t = token('b1', 2);
    const reply = await reply2(await put2(w, body2({ token: t, saved: [DURHAM] })));
    expect((await sendTest(w, { app: 'snow', token: t })).status).toBe(202);
    const threads = payloads().map((p) => (p.aps as Record<string, unknown>)['thread-id']);
    expect(threads.sort()).toEqual(['snow', `snow-${reply.saved[0]!.pid}`]);
  });

  it("gives a saved place's fixed words a collapse id of its own", async () => {
    const { w, fake } = await withApple();
    const t = token('b1', 3);
    const durhamCell = { lat: 54.8, lon: -1.6, source: 'device' };
    const reply = await reply2(
      await put2(w, body2({ token: t, here: durhamCell, saved: [HELSINKI, LEEDS] })),
    );
    expect((await sendTest(w, { app: 'snow', token: t })).status).toBe(202);
    expect(collapse(fake)).toEqual(['snow-evening-2026-11-12', `snow-test-${reply.saved[1]!.pid}`]);
  });

  it('tests a shadowed free place only through its saved place', async () => {
    const { w, fake } = await withApple();
    const t = token('b1', 4);
    const durhamCell = { lat: 54.8, lon: -1.6, source: 'device' };
    const reply = await reply2(
      await put2(w, body2({ token: t, here: durhamCell, saved: [DURHAM] })),
    );
    const r = await sendTest(w, { app: 'snow', token: t });
    expect(r.status).toBe(202);
    expect(await r.text()).toBe('{"sent":true}');
    expect(collapse(fake)).toEqual([`snow-evening-2026-11-12-${reply.saved[0]!.pid}`]);
  });

  it('tests a saved place alone when nothing locates the phone', async () => {
    const { w, fake } = await withApple();
    const t = token('b1', 5);
    await put2(w, body2({ token: t, saved: [DURHAM] }));
    const r = await sendTest(w, { app: 'snow', token: t });
    expect(await r.text()).toBe('{"sent":true}');
    expect(fake.seen).toHaveLength(1);
  });

  it("judges the quiet hours by the phone's clock, with words to match", async () => {
    // 18:05 in London is 03:05 in Tokyo.
    const { w, fake } = await withApple({}, { geo: LEEDS_GEO });
    const t = token('b1', 6);
    await put2(w, body2({ token: t, deviceTz: 'Asia/Tokyo', saved: [DURHAM] }));
    const r = await sendTest(w, { app: 'snow', token: t });
    expect(r.status).toBe(409);
    expect(await errorOf(r)).toEqual({
      code: 'quiet_hours',
      message: 'Nothing is sent from 9pm to 7am on your iPhone. Try again after 7am.',
    });
    // 3 hours and 55 minutes to 07:00 in Tokyo.
    expect(r.headers.get('retry-after')).toBe(String(3 * 3600 + 55 * 60));
    expect(fake.seen).toEqual([]);
    expect(w.store.keys().filter((k) => k.startsWith('test/'))).toEqual([]);
    expect(w.lines.at(-1)).toBe(
      `devices: test not sent to snow.${idOf(t).slice(0, 8)}…: quiet hours on the phone`,
    );
    // Without the phone's zone, the free place's.
    const n = token('b1', 7);
    await put2(w, body2({ token: n, deviceTz: undefined, saved: [TOKYO] }));
    expect((await sendTest(w, { app: 'snow', token: n })).status).toBe(202);
  });

  it("sends a saved place's test in the place's night when it is day on the phone", async () => {
    // 18:05 in London, where the phone is; 03:05 in Tokyo.
    const { w, fake } = await withApple({}, { geo: LEEDS_GEO });
    const t = token('b1', 8);
    await put2(w, body2({ token: t, saved: [TOKYO] }));
    const r = await sendTest(w, { app: 'snow', token: t });
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ sent: true, count: 2 });
    expect(fake.seen).toHaveLength(2);
  });

  it('keeps the quiet words of 8.1 for a device with no saved place', async () => {
    const { w } = await withApple({}, { geo: LEEDS_GEO });
    const t = token('b1', 9);
    await put2(w, body2({ token: t, saved: [] }));
    w.at(Date.UTC(2026, 10, 11, 23, 30));
    const r = await sendTest(w, { app: 'snow', token: t });
    expect(r.status).toBe(409);
    expect(await errorOf(r)).toEqual({
      code: 'quiet_hours',
      message: 'Nothing is sent from 9pm to 7am at the place. Try again after 7am there.',
    });
    expect(r.headers.get('retry-after')).toBe(String(7.5 * 3600));
  });

  it('starts no push 8 s after the sends begin', async () => {
    expect(DEVICE_LIMITS.testDeadlineMs).toBe(8_000);
    const w = world({ geo: LEEDS_GEO, connect: () => apnsSender(fake.origin, 1000) });
    const fake = await fakeApns((headers) => {
      // Apple takes 9 s over the first.
      w.at(SNOWY + 9_000);
      return apple()(headers);
    });
    const t = token('b1', 10);
    await put2(w, body2({ token: t, saved: [DURHAM] }));
    const r = await sendTest(w, { app: 'snow', token: t });
    expect(r.status).toBe(202);
    expect(await r.text()).toBe('{"sent":true}');
    expect(fake.seen).toHaveLength(1);
    expect(w.lines.join('\n')).toMatch(/: deferred$/m);
  });

  it("stops at Apple's first refusal of the token: 404, and the second push never goes", async () => {
    const { w, fake } = await withApple(
      { bb: { status: 400, body: { reason: 'BadDeviceToken' } } },
      { geo: LEEDS_GEO },
    );
    const t = token('bb', 11);
    await put2(w, body2({ token: t, saved: [DURHAM] }));
    const r = await sendTest(w, { app: 'snow', token: t });
    expect(r.status).toBe(404);
    expect((await errorOf(r)).code).toBe('not_registered');
    expect(fake.seen).toHaveLength(1);
  });

  it('is a dry run for both places, still on one claim', async () => {
    const { w, fake } = await withApple(
      {},
      { geo: LEEDS_GEO, settings: { ALERTS_DRY_RUN: undefined } },
    );
    const t = token('b1', 12);
    await put2(w, body2({ token: t, saved: [DURHAM] }));
    const r = await sendTest(w, { app: 'snow', token: t });
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ sent: false, dryRun: true });
    expect(fake.seen).toEqual([]);
    expect(w.lines.filter((l) => l.startsWith('alerts: dry run:'))).toHaveLength(2);
    expect(w.store.keys().filter((k) => k.startsWith('test/'))).toHaveLength(1);
  });
});

describe('the devices endpoints with the unexpected', () => {
  it('reads a body only once: one already read is a 400', async () => {
    const w = world();
    const request = send('PUT', body());
    await request.text();
    const r = await handleDevicePut(request, w.platform);
    expect(r.status).toBe(400);
    expect(await errorOf(r)).toEqual({
      code: 'bad_request',
      message: 'The body could not be read.',
    });
  });

  it('a failure of its own is a 500 server_error with JSON, and a log line', async () => {
    const w = world();
    w.platform.deps!.cache = {
      get: () => Promise.reject(new Error('the cache broke')),
      set: () => Promise.resolve(),
    };
    const r = await put(w, body({ token: token('aa', 370) }));
    expect(r.status).toBe(500);
    expect(await errorOf(r)).toEqual({
      code: 'server_error',
      message: 'Something went wrong. Try again later.',
    });
    expect(w.lines).toEqual(['devices: error: the cache broke']);
    expect(w.store.keys()).toEqual([]);
  });

  it('treats a malformed stored value as nothing stored, and replaces it', async () => {
    const w = world();
    const t = token('aa', 380);
    const id = idOf(t);
    await w.store.set(idsKey('snow', id), { tz: 'Europe/London' });
    await w.store.set(regKey('Europe/London', 'snow', id), { v: 1, token: 7 });
    expect((await sendTest(w, { app: 'snow', token: t })).status).toBe(404);
    const r = await put(w, body({ token: t }));
    expect(r.status).toBe(200);
    expect(await record(w, 'Europe/London', t)).toMatchObject({ token: t, v: 1 });
    // An ids key with no zone is deleted all the same.
    await w.store.set(idsKey('snow', id), { zone: 'nowhere' });
    expect((await del(w, { app: 'snow', token: t })).status).toBe(204);
    expect(await w.store.get(idsKey('snow', id))).toBeNull();
  });
});

// ---- Which store ----

describe('the store each deploy context uses', () => {
  let server: BlobsServer;
  let origin: string;
  let directory: string;
  const requests: string[] = [];

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'devices-blobs-'));
    server = new BlobsServer({
      directory,
      token: 'local-test-token',
      onRequest: ({ url }) => requests.push(url),
    });
    origin = `http://localhost:${(await server.start()).port}`;
    setEnvironmentContext({
      siteID: 'site1',
      token: 'local-test-token',
      deployID: 'deploy1',
      primaryRegion: 'us-east-2',
      edgeURL: origin,
      uncachedEdgeURL: origin,
    });
  });

  afterAll(async () => {
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    await server.stop();
    await rm(directory, { recursive: true, force: true });
  });

  it('is the site-wide store in production, and the deploy store everywhere else', async () => {
    const t = token('aa', 400);
    const stores = async (deployContext: string | undefined) => {
      requests.length = 0;
      const w = world({ store: null });
      w.platform.deployContext = deployContext;
      const r = await put(w, body({ token: t }));
      expect(r.status).toBe(200);
      const seen = new Set(
        requests.map((u) => /^(?:\/region:[^/]+)?\/site1\/[^/]+/.exec(u)?.[0] ?? u),
      );
      requests.length = 0;
      expect((await del(w, { app: 'snow', token: t })).status).toBe(204);
      return [...seen];
    };
    expect(await stores('production')).toEqual(['/site1/site:isithot-alerts']);
    for (const context of ['deploy-preview', 'branch-deploy', 'dev', undefined]) {
      expect(await stores(context)).toEqual([
        '/region:us-east-2/site1/deploy:deploy1:isithot-alerts',
      ]);
    }
  });

  it('keeps a preview registration out of production', async () => {
    const t = token('aa', 401);
    const preview = world({ store: null, deployContext: 'deploy-preview' });
    expect((await put(preview, body({ token: t }))).status).toBe(200);
    const production = world({ store: null, deployContext: 'production' });
    // Production has no such registration to test.
    expect((await sendTest(production, { app: 'snow', token: t })).status).toBe(404);
    expect((await del(preview, { app: 'snow', token: t })).status).toBe(204);
  });
});

// ---- The functions ----

describe('the functions', () => {
  const source = (name: string) =>
    readFile(new URL(`../../../functions/api/${name}`, import.meta.url), 'utf8');

  it('devices.mts serves PUT and DELETE, 10 a minute by IP and domain', async () => {
    const text = await source('devices.mts');
    expect(text).toContain("path: '/api/v1/devices',");
    expect(text).toContain("method: ['PUT', 'DELETE'],");
    expect(text).toContain(`windowLimit: ${DEVICE_LIMITS.perMinute},`);
    expect(text).toContain('windowSize: 60,');
    expect(text).toContain("aggregateBy: ['ip', 'domain'],");
    expect(text).toContain("to: '/api/v1/rate-limited',");
    expect(text).toContain('handleDevices(request, {');
    expect(text).toContain('deployContext: context.deploy?.context,');
  });

  it('devices.mts passes the geo today.mts builds, so a registration can locate its connection', async () => {
    const geo = /^ {4}geo: \{\n[\s\S]*?^ {4}\},\n/m.exec(await source('today.mts'))?.[0];
    expect(geo).toContain('city: context.geo?.city,');
    expect(await source('devices.mts')).toContain(geo!);
  });

  it('devices-test.mts serves POST, with the same limit', async () => {
    const text = await source('devices-test.mts');
    expect(text).toContain("path: '/api/v1/devices/test',");
    expect(text).toContain("method: 'POST',");
    expect(text).toContain(`windowLimit: ${DEVICE_LIMITS.perMinute},`);
    expect(text).toContain('handleDeviceTest(request, {');
    expect(text).toContain('deployContext: context.deploy?.context,');
  });
});

// ---- The functions' own dependencies ----

describe('the handlers on their own dependencies', () => {
  /** A Blobs edge slower than the cache's 1.5 s, and an Open-Meteo and NASA POWER that are down. */
  let edge: ReturnType<typeof createHttpServer>;
  let upstream: ReturnType<typeof createHttpServer>;
  const SETTINGS_DOWN: Record<string, string> = {};
  const listen = async (server: ReturnType<typeof createHttpServer>) => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  /** The edge's requests not yet answered, so the test can wait for all of them. */
  let open = 0;
  const quiet: (() => void)[] = [];
  const answered = () =>
    open === 0 ? Promise.resolve() : new Promise<void>((resolve) => quiet.push(resolve));

  beforeAll(async () => {
    edge = createHttpServer((_request, response) => {
      open++;
      setTimeout(() => {
        response.writeHead(404).end();
        open--;
        if (open === 0) for (const resolve of quiet.splice(0)) resolve();
      }, 3000);
    });
    upstream = createHttpServer((_request, response) => {
      response.writeHead(503, { 'content-type': 'application/json' }).end('{"reason":"busy"}');
    });
    const slow = await listen(edge);
    const down = await listen(upstream);
    setEnvironmentContext({
      siteID: 'site1',
      token: 'local-test-token',
      deployID: 'deploy1',
      edgeURL: slow,
      uncachedEdgeURL: slow,
    });
    SETTINGS_DOWN.OPEN_METEO_FORECAST_URL = `${down}/v1/forecast`;
    SETTINGS_DOWN.NASA_POWER_URL = `${down}/power`;
  });

  afterAll(async () => {
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    for (const server of [edge, upstream]) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("scrub the coordinates from the forecast cache's own lines when it is slow", async () => {
    const lines: string[] = [];
    const later: Promise<unknown>[] = [];
    const store = new MemoryAlertStore();
    const platform: DevicesPlatform = {
      env: (name) => SETTINGS_DOWN[name],
      deployContext: 'production',
      waitUntil: (promise) => void later.push(promise.catch(() => {})),
      log: (line) => {
        lines.push(line);
        logged.push(line);
      },
      store,
      testForecastWaitMs: 5000,
    };
    const place = { lat: 54.7761, lon: -1.5733, source: 'device' };
    const registered = await handleDevicePut(
      send('PUT', body({ token: token('aa', 500), place })),
      platform,
    );
    // Open-Meteo is down and nothing is cached, so the place has no zone yet.
    expect(registered.status).toBe(503);

    // A registration there, in a zone where it is now midday, so the test is not in quiet hours.
    const t = token('aa', 501);
    const offset = new Date().getUTCHours() - 12;
    const tz = offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '+' : '-'}${Math.abs(offset)}`;
    const at = new Date().toISOString();
    const record: DeviceRecord = {
      v: 1,
      id: idOf(t),
      app: 'snow',
      platform: 'ios',
      env: 'sandbox',
      token: t,
      query: 'lat=54.8&lon=-1.55&source=device',
      name: 'Durham',
      tz,
      units: 'c',
      alerts: { snow: EVENING },
      createdAt: at,
      updatedAt: at,
      seenAt: at,
    };
    await store.set(regKey(tz, 'snow', record.id), record);
    await store.set(idsKey('snow', record.id), { tz });
    const tested = await handleDeviceTest(send('POST', { app: 'snow', token: t }), platform);
    expect(tested.status).toBe(202);
    // Every request to the edge answered, so none is left to retry once the test is over.
    await Promise.all(later);
    await answered();

    // The cache's own lines were logged, with the cell scrubbed.
    expect(
      lines.filter((l) => /^blobs: .*read of forecast\/v7\/<cell>\/dem timed out/.test(l)),
    ).toHaveLength(2);
    const text = lines.join('\n');
    expect(text).not.toMatch(/\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?/);
    for (const coordinate of ['54.8', '54.7', '1.55', '1.57', '55.0', '1.25']) {
      expect(text).not.toContain(coordinate);
    }
  }, 20_000);
});

// ---- The logs (last: it reads what every test above logged) ----

describe('the logs', () => {
  it('carry nothing secret: no device token, full id, key, provider token, query or coordinates', () => {
    expect(logged.length).toBeGreaterThan(50);
    const text = logged.join('\n');
    for (const t of TOKENS) {
      // Not even the 8 characters a redacted token would keep.
      expect(text).not.toContain(t.slice(0, 8));
      expect(text).not.toContain(idOf(t));
    }
    expect(text).not.toMatch(/[0-9a-f]{32}/i);
    expect(text).not.toMatch(/eyJ[\w-]+\./);
    for (const { pem } of [SANDBOX, PRODUCTION]) {
      const key = pem.replace(/-----[A-Z ]+-----|\s/g, '');
      for (let i = 0; i + 16 <= key.length; i += 16)
        expect(text).not.toContain(key.slice(i, i + 16));
    }
    expect(text).not.toMatch(/TEAM123456|SANDBOX001|PRODUCT001/);
    expect(text).not.toMatch(/place=|lat=|lon=|source=|query/);
    for (const coordinate of ['53.8', '1.55', '54.95', '2.1', '54.8', '1.6', '54.97', '40.7']) {
      expect(text).not.toContain(coordinate);
    }
    // Nor a saved place's zone: beside the ID people are asked to email, it would be a trip log.
    for (const zone of SAVED_ONLY_ZONES) {
      expect([...SAVED_ZONES]).toContain(zone);
      expect(text).not.toContain(zone);
    }
  });
});
