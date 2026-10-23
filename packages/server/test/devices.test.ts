import { createPublicKey, generateKeyPairSync, verify, type KeyObject } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { IncomingHttpHeaders } from 'node:http2';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setEnvironmentContext } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { ALERTS } from '@isithot/core';
import { createSyntheticFetch, type FetchLike } from '@isithot/providers';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
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
  handleDeviceDelete,
  handleDevicePut,
  handleDeviceTest,
  handleDevices,
  idsKey,
  jwtKey,
  regKey,
  registrationId,
  resolveServerConfig,
  type AlertListing,
  type AlertStore,
  type ApnsEnv,
  type ApnsSender,
  type DeviceRecord,
  type DevicesPlatform,
  type ServerDeps,
} from '../src';
import { closeFakes, fakeApns, type FakeReply } from './fakeApns';

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

  it('refuses a body over 2 KB (413), by its length or by its header', async () => {
    const w = world();
    const sized = (bytes: number) => {
      const b = body({ token: token('aa', 1), padding: '' });
      const extra = bytes - JSON.stringify(b).length;
      return JSON.stringify({ ...b, padding: 'x'.repeat(extra) });
    };
    expect(sized(2049)).toHaveLength(2049);
    const over = await put(w, sized(2049));
    expect(over.status).toBe(413);
    expect((await errorOf(over)).code).toBe('too_large');
    expect(w.store.keys()).toEqual([]);
    const declared = new Request(DEVICES, {
      method: 'PUT',
      headers: { 'content-length': '4096' },
      body: JSON.stringify(body()),
    });
    expect((await handleDevicePut(declared, w.platform)).status).toBe(413);
    // Exactly 2,048 bytes is allowed; unknown fields are ignored.
    const exact = await put(w, sized(2048));
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
      [{ app: 'snow', token: token(), padding: 'x'.repeat(2048) }, 413, 'too_large'],
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
    expect((await sendTest(w, 'x'.repeat(3000))).status).toBe(413);
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

  it('sends in the quiet hours too: someone asked for it', async () => {
    const { w, fake } = await withApple();
    const t = token('aa', 270);
    await put(w, body({ token: t }));
    const late = Date.UTC(2026, 10, 11, 23, 30);
    w.at(late);
    expect((await sendTest(w, { app: 'snow', token: t })).status).toBe(202);
    expect(fake.seen[0]!.headers['apns-expiration']).toBe(String(late / 1000 + 900));
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

  it('off production, a dry run logs the notification instead (ALERTS_DRY_RUN)', async () => {
    const noKeys = {
      ALERTS_DRY_RUN: undefined,
      APNS_KEY_SANDBOX: undefined,
      APNS_KEY_PRODUCTION: undefined,
    };
    for (const deployContext of ['deploy-preview', 'branch-deploy', 'dev']) {
      const { w, fake } = await withApple({}, { deployContext, settings: noKeys });
      const t = token('aa', 290);
      await put(w, body({ token: t, place: DURHAM }));
      const r = await sendTest(w, { app: 'snow', token: t });
      expect(r.status).toBe(202);
      expect(await r.json()).toEqual({ sent: false, dryRun: true });
      expect(fake.seen).toEqual([]);
      expect(w.lines).toContain(
        `devices: test dry run: snow.${idOf(t).slice(0, 8)}… sandbox: Snow likely in Durham tomorrow / 1 to 2cm of snow. Mostly between 2am and 7am. 5 of 6 forecasts expect snow.`,
      );
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
    expect(await decide('deploy-preview', 'false')).toEqual({ reply: { sent: true }, pushes: 1 });
    expect(await decide('deploy-preview', ' FALSE ')).toEqual({ reply: { sent: true }, pushes: 1 });
    expect(await decide('production', 'true')).toEqual({
      reply: { sent: false, dryRun: true },
      pushes: 0,
    });
    expect(await decide('production', undefined)).toEqual({ reply: { sent: true }, pushes: 1 });
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
    expect(w.lines.join('\n')).toMatch(/no answer from APNs for snow\.[0-9a-f]{8}…'s test/);

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
        fetch: (synthetic) => async (url, init) =>
          down && new URL(url).pathname.endsWith('/forecast')
            ? new Response('down', { status: 500 })
            : synthetic(url, init),
      },
    );
    await put(failed.w, body({ token: t, place: DURHAM }));
    failed.w.at(SNOWY + 7 * HOUR);
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
    expect(w.lines.at(-1)).toMatch(
      /refused snow\.[0-9a-f]{8}…'s test \(400 BadDeviceToken, .*\); kept it \(changed\)$/,
    );

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
    expect(w.lines.at(-1)).toMatch(/^devices: error: no sandbox provider token \(/);
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

  it('devices-test.mts serves POST, with the same limit', async () => {
    const text = await source('devices-test.mts');
    expect(text).toContain("path: '/api/v1/devices/test',");
    expect(text).toContain("method: 'POST',");
    expect(text).toContain(`windowLimit: ${DEVICE_LIMITS.perMinute},`);
    expect(text).toContain('handleDeviceTest(request, {');
    expect(text).toContain('deployContext: context.deploy?.context,');
  });
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
  });
});
