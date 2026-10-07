import {
  CACHE,
  COPY,
  ERROR_MESSAGES,
  GRID,
  MODELS,
  computeDay,
  defaultUnitsForCountry,
  formatDay,
  cellKey,
  gridKey,
  isValidLatLon,
  localDate,
  parseUnits,
  roundPoint,
  snapToCell,
  type ApiLocation,
  type DayComputation,
  type LatLon,
  type MonthlyNormals,
  type TodayResponse,
} from '@isithot/core';
import { fetchClimateNormals, fetchForecast, type Forecast } from '@isithot/providers';
import { cityBySlug, cityForPlace, nearbyCities } from './cities';
import type { ServerDeps } from './deps';
import { errorResult, privateCache, publicCache, type HandlerResult } from './http';
import { reverseGeocode } from './reverse';

/** The visitor's approximate location from the platform (Netlify `context.geo`). */
export interface VisitorGeo {
  city?: string | undefined;
  /** ISO 3166-1 alpha-2. */
  country?: string | undefined;
  region?: string | undefined;
  lat?: number | undefined;
  lon?: number | undefined;
}

interface ForecastEntry {
  fetchedAt: number;
  forecast: Forecast;
}

interface ClimateEntry {
  fetchedAt: number;
  normals: number[] | null;
}

/** How long a response waits for NASA POWER before answering without normals, ms. */
export const CLIMATE_WAIT_MS = 3500;

type Located = Omit<ApiLocation, 'timezone'>;

const COORD = /^-?\d{1,3}(\.\d+)?$/;
const COUNTRY = /^[A-Za-z]{2}$/;

function clean(value: string | null, max = 80): string | null {
  if (!value) return null;
  const text = value
    // Strip control characters and angle brackets from user-supplied names.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, max);
  return text.length > 0 ? text : null;
}

function parseCoord(value: string | null): number | null {
  if (value === null || !COORD.test(value.trim())) return null;
  return Number(value);
}

function parseGeonameId(value: string | null): number | undefined {
  return value && /^\d{1,10}$/.test(value) ? Number(value) : undefined;
}

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function withOptional(loc: Located, slug?: string, geonameId?: number): Located {
  const out: Located = { ...loc };
  if (slug) out.slug = slug;
  if (geonameId) out.geonameId = geonameId;
  return out;
}

async function locateFromCoords(params: URLSearchParams): Promise<Located | null> {
  const lat = parseCoord(params.get('lat'));
  const lon = parseCoord(params.get('lon'));
  if (lat === null || lon === null || !isValidLatLon(lat, lon)) return null;
  // Coordinates should already be rounded by the browser; round again so the server never
  // works with anything more precise than the 0.05° grid.
  const point = roundPoint({ lat, lon }, GRID.forecast);

  let name = clean(params.get('name'));
  let region = clean(params.get('region'));
  const countryParam = params.get('country');
  let country = countryParam && COUNTRY.test(countryParam) ? countryParam.toUpperCase() : null;
  let geonameId = parseGeonameId(params.get('geonameId'));
  if (!name) {
    const place = await reverseGeocode(point.lat, point.lon);
    if (place) {
      name = place.name;
      region = region ?? place.region;
      country = country ?? place.country;
      geonameId = geonameId ?? place.geonameId;
    }
  }
  const source = params.get('source') === 'search' ? 'search' : 'device';
  const city = name
    ? cityForPlace({ name, country, ...point, geonameId: geonameId ?? null })
    : undefined;
  return withOptional(
    { name: name ?? COPY.yourLocation, region, country, ...point, source },
    city?.slug,
    geonameId,
  );
}

function locateCity(slug: string): Located | null {
  const city = cityBySlug(slug);
  if (!city) return null;
  return withOptional(
    {
      name: city.name,
      region: city.region,
      country: city.country,
      ...roundPoint(city, GRID.forecast),
      source: 'city',
    },
    city.slug,
    city.geonameId,
  );
}

async function locateFromIp(geo: VisitorGeo | null, fallback: string): Promise<Located | null> {
  if (geo && isValidLatLon(geo.lat, geo.lon)) {
    const point = roundPoint({ lat: geo.lat as number, lon: geo.lon as number }, GRID.forecast);
    const place = await reverseGeocode(point.lat, point.lon);
    const name = geo.city ?? place?.name ?? COPY.yourLocation;
    const sameTown = place && fold(place.name) === fold(name);
    const country = geo.country?.toUpperCase() ?? place?.country ?? null;
    const city = sameTown
      ? cityForPlace({ name, country, ...point, geonameId: place.geonameId })
      : undefined;
    return withOptional(
      { name, region: geo.region ?? place?.region ?? null, country, ...point, source: 'ip' },
      city?.slug,
      sameTown ? place.geonameId : undefined,
    );
  }
  const city = locateCity(fallback);
  return city ? { ...city, source: 'ip' } : null;
}

const inflight = new Map<string, Promise<Forecast>>();

function coversToday(forecast: Forecast, now: Date): boolean {
  const today = localDate(forecast.timezone, now);
  return forecast.days.some((d) => d.date === today);
}

async function loadForecast(
  point: LatLon,
  deps: ServerDeps,
): Promise<(ForecastEntry & { stale: boolean }) | null> {
  const key = `forecast/v1/${gridKey(point, GRID.forecast)}`;
  const nowDate = deps.now();
  const now = nowDate.getTime();
  const entry = await deps.cache.get<ForecastEntry>(key);
  if (
    entry &&
    now - entry.fetchedAt < CACHE.forecastFresh * 1000 &&
    coversToday(entry.forecast, nowDate)
  ) {
    return { ...entry, stale: false };
  }
  try {
    let pending = inflight.get(key);
    if (!pending) {
      pending = fetchForecast({ ...deps.config.openMeteo, fetch: deps.fetch }, point, MODELS);
      inflight.set(key, pending);
      pending.then(
        () => inflight.delete(key),
        () => inflight.delete(key),
      );
    }
    const fresh: ForecastEntry = { fetchedAt: now, forecast: await pending };
    deps.waitUntil(deps.cache.set(key, fresh));
    return { ...fresh, stale: false };
  } catch (err) {
    deps.log(`forecast unavailable for ${key}: ${String(err)}`);
    if (
      entry &&
      now - entry.fetchedAt < CACHE.forecastStale * 1000 &&
      coversToday(entry.forecast, nowDate)
    ) {
      return { ...entry, stale: true };
    }
    return null;
  }
}

async function loadNormals(point: LatLon, deps: ServerDeps): Promise<MonthlyNormals | null> {
  const cell = snapToCell(point, GRID.climate);
  const key = `climate/v3/${cellKey(point, GRID.climate)}`;
  const now = deps.now().getTime();
  const entry = await deps.cache.get<ClimateEntry>(key);
  if (entry?.normals) return entry.normals;
  if (entry && now - entry.fetchedAt < CACHE.climateFailure * 1000) return null;

  const pending = fetchClimateNormals(
    { url: deps.config.nasaPowerUrl, fetch: deps.fetch, timeoutMs: 9000 },
    cell,
  )
    .then(async (normals) => {
      await deps.cache.set<ClimateEntry>(key, { fetchedAt: now, normals: [...normals] });
      return normals;
    })
    .catch(async (err: unknown) => {
      deps.log(`climate normals unavailable for ${key}: ${String(err)}`);
      await deps.cache.set<ClimateEntry>(key, { fetchedAt: now, normals: null });
      return null;
    });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), deps.climateWaitMs ?? CLIMATE_WAIT_MS);
  });
  const result = await Promise.race([pending, timeout]);
  clearTimeout(timer);
  if (result === 'timeout') {
    // Answer now without normals; finish filling the cache in the background.
    deps.waitUntil(pending);
    return null;
  }
  return result;
}

export async function getToday(
  params: URLSearchParams,
  geo: VisitorGeo | null,
  deps: ServerDeps,
): Promise<HandlerResult<TodayResponse>> {
  let located: Located | null;
  if (params.has('lat') || params.has('lon')) {
    located = await locateFromCoords(params);
    if (!located) return errorResult('bad_location', ERROR_MESSAGES.bad_location);
  } else if (params.has('place')) {
    located = locateCity(params.get('place') ?? '');
    if (!located) return errorResult('not_found', ERROR_MESSAGES.not_found);
  } else {
    located = await locateFromIp(geo, deps.config.fallbackPlace);
    if (!located) return errorResult('bad_location', ERROR_MESSAGES.bad_location);
  }

  const explicitUnits = parseUnits(params.get('units'));
  const units = explicitUnits ?? defaultUnitsForCountry(geo?.country ?? located.country);

  const point = { lat: located.lat, lon: located.lon };
  const [loaded, normals] = await Promise.all([
    loadForecast(point, deps),
    loadNormals(point, deps),
  ]);
  if (!loaded) return errorResult('upstream_unavailable', ERROR_MESSAGES.upstream_unavailable);

  const today = localDate(loaded.forecast.timezone, deps.now());
  const days = loaded.forecast.days
    .filter((d) => d.date >= today)
    .map((d) => computeDay(d, normals))
    .filter((d): d is DayComputation => d !== null);
  if (days[0]?.date !== today) {
    return errorResult('upstream_unavailable', ERROR_MESSAGES.upstream_unavailable);
  }

  const body: TodayResponse = {
    location: { ...located, timezone: loaded.forecast.timezone },
    units,
    days: days.map((d) => formatDay(d, units)),
    updatedAt: new Date(loaded.fetchedAt).toISOString(),
    attribution: [COPY.forecastCredit, COPY.climateCredit],
    nearby: nearbyCities(point, 4, located.slug).map((c) => ({ slug: c.slug, name: c.name })),
  };
  if (loaded.stale) body.stale = true;

  // Responses that depend on the visitor (IP location or country-default units) must not be
  // shared by the CDN.
  const shared = located.source !== 'ip' && explicitUnits !== null;
  const maxAge = loaded.stale ? 60 : CACHE.edgeMaxAge;
  const headers = shared ? publicCache(maxAge) : privateCache(Math.min(maxAge, 300));
  return { status: 200, body, headers };
}
