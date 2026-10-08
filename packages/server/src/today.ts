import {
  CACHE,
  COPY,
  ERROR_MESSAGES,
  GRID,
  MODELS,
  computeDay,
  computeNow,
  computeRainDay,
  computeRainNow,
  computeRainWeek,
  computeWeek,
  defaultUnitsForCountry,
  formatDay,
  formatNow,
  formatRainDay,
  formatRainNow,
  formatRainWeek,
  formatWeek,
  cellKey,
  gridKey,
  isValidLatLon,
  climateRange,
  hourlySeries,
  judgeRainSeries,
  judgeSeries,
  localDate,
  parseUnits,
  rainSeries,
  rainUnit,
  roundPoint,
  snapToCell,
  type ApiLocation,
  type DayComputation,
  type LatLon,
  type MonthlyNormals,
  type RainDayComputation,
  type TodayResponse,
} from '@isithot/core';
import {
  FORECAST_CACHE_VERSION,
  fetchClimateNormals,
  fetchForecast,
  fetchRainNormals,
  type Forecast,
} from '@isithot/providers';
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
export const CLIMATE_WAIT_MS = 2000;

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

/** Days whose hours are kept: "now" looks a day ahead and may run past midnight. */
const HOURLY_DAYS = 3;

/**
 * Later days only need each model's daily high, so their hours are dropped before caching
 * (a seven-day, eight-model hourly forecast is otherwise about 2,700 numbers per entry).
 */
function slim(forecast: Forecast): Forecast {
  return {
    ...forecast,
    days: forecast.days.map((d, i) => (i < HOURLY_DAYS ? d : { ...d, hourly: [] })),
  };
}

function coversToday(forecast: Forecast, now: Date): boolean {
  const today = localDate(forecast.timezone, now);
  return forecast.days.some((d) => d.date === today);
}

/** A forecast fetched on an earlier local day is a day short for the week view. */
function startsToday(forecast: Forecast, now: Date): boolean {
  return forecast.days[0]?.date === localDate(forecast.timezone, now);
}

async function loadForecast(
  point: LatLon,
  deps: ServerDeps,
  nowDate: Date,
): Promise<(ForecastEntry & { stale: boolean }) | null> {
  const key = `forecast/v${FORECAST_CACHE_VERSION}/${gridKey(point, GRID.forecast)}`;
  const now = nowDate.getTime();
  const entry = await deps.cache.get<ForecastEntry>(key);
  if (
    entry &&
    now - entry.fetchedAt < CACHE.forecastFresh * 1000 &&
    startsToday(entry.forecast, nowDate)
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
    const fresh: ForecastEntry = { fetchedAt: now, forecast: slim(await pending) };
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

type NormalsResult = { normals: MonthlyNormals | null; pending: boolean };

/**
 * Twelve monthly values from NASA POWER, cached per climate cell for good (a failure for an
 * hour). A response waits at most CLIMATE_WAIT_MS for a cell it has not seen, then answers
 * without them and finishes filling the cache in the background.
 */
async function loadMonthly(
  key: string,
  label: string,
  fetchMonthly: () => Promise<MonthlyNormals>,
  deps: ServerDeps,
): Promise<NormalsResult> {
  const now = deps.now().getTime();
  const entry = await deps.cache.get<ClimateEntry>(key);
  if (entry?.normals) return { normals: entry.normals, pending: false };
  if (entry && now - entry.fetchedAt < CACHE.climateFailure * 1000) {
    return { normals: null, pending: false };
  }

  const pending = fetchMonthly()
    .then(async (normals) => {
      await deps.cache.set<ClimateEntry>(key, { fetchedAt: now, normals: [...normals] });
      return normals;
    })
    .catch(async (err: unknown) => {
      deps.log(`${label} unavailable for ${key}: ${String(err)}`);
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
    deps.waitUntil(pending);
    return { normals: null, pending: true };
  }
  return { normals: result, pending: false };
}

/** Normal daily highs, for judging hot. */
function loadNormals(point: LatLon, deps: ServerDeps): Promise<NormalsResult> {
  const config = { url: deps.config.nasaPowerUrl, fetch: deps.fetch, timeoutMs: 9000 };
  return loadMonthly(
    `climate/v4/${cellKey(point, GRID.climate)}`,
    'climate normals',
    () => fetchClimateNormals(config, snapToCell(point, GRID.climate)),
    deps,
  );
}

/**
 * Normal rainfall, for the week's "wetter than usual" line. Its own request and cache entry,
 * so a problem with it can never hold up or break the hot normals.
 */
function loadRainNormals(point: LatLon, deps: ServerDeps): Promise<NormalsResult> {
  const config = { url: deps.config.nasaPowerUrl, fetch: deps.fetch, timeoutMs: 9000 };
  return loadMonthly(
    `climate-rain/v1/${cellKey(point, GRID.climate)}`,
    'rain normals',
    () => fetchRainNormals(config, snapToCell(point, GRID.climate)),
    deps,
  );
}

/**
 * Seconds until the next forecast hour starts. Today's rain answer covers the rest of the day
 * from the moment of the request, so no cache may keep it past the hour.
 */
function secondsToNextHour(forecast: Forecast, now: number): number | null {
  for (const day of forecast.days) {
    for (const h of day.hourly) if (h.time > now) return Math.ceil((h.time - now) / 1000);
  }
  return null;
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

  // One clock reading for the whole answer, so no part of it can fall either side of an hour.
  const nowDate = deps.now();
  const nowTime = nowDate.getTime();
  const explicitUnits = parseUnits(params.get('units'));
  const units = explicitUnits ?? defaultUnitsForCountry(geo?.country ?? located.country);

  const point = { lat: located.lat, lon: located.lon };
  const [loaded, climate, rainClimate] = await Promise.all([
    loadForecast(point, deps, nowDate),
    loadNormals(point, deps),
    loadRainNormals(point, deps),
  ]);
  const normals = climate.normals;
  if (!loaded) return errorResult('upstream_unavailable', ERROR_MESSAGES.upstream_unavailable);

  const today = localDate(loaded.forecast.timezone, nowDate);
  const days = loaded.forecast.days
    .filter((d) => d.date >= today)
    .map((d) => computeDay(d, normals))
    .filter((d): d is DayComputation => d !== null);
  if (days[0]?.date !== today) {
    return errorResult('upstream_unavailable', ERROR_MESSAGES.upstream_unavailable);
  }

  const range = normals ? climateRange(normals) : null;
  const now = computeNow(
    judgeSeries(hourlySeries(loaded.forecast.days), range, units, loaded.forecast.timezone),
    nowTime,
  );
  const week = computeWeek(days, normals);
  const body: TodayResponse = {
    location: { ...located, timezone: loaded.forecast.timezone },
    units,
    // Today and tomorrow in full (tomorrow's verdict in the future tense); the rest of the week
    // is summarised in `week`.
    days: days.slice(0, 2).map((d, i) => formatDay(d, units, i === 1)),
    updatedAt: new Date(loaded.fetchedAt).toISOString(),
    attribution: [COPY.forecastCredit, COPY.climateCredit],
    nearby: nearbyCities(point, 4, located.slug).map((c) => ({ slug: c.slug, name: c.name })),
  };
  if (now) body.now = formatNow(now);
  if (week) body.week = formatWeek(week, units);
  if (loaded.stale) body.stale = true;

  // Is it wet? Today is the rest of the day from now; later days are whole days.
  const forecastDays = loaded.forecast.days.filter((d) => d.date >= today);
  const rainToday =
    forecastDays[0]?.date === today ? computeRainDay(forecastDays[0], { from: nowTime }) : null;
  if (rainToday) {
    const later = forecastDays
      .slice(1)
      .map((d) => computeRainDay(d))
      .filter((d): d is RainDayComputation => d !== null);
    const rainNow = computeRainNow(
      judgeRainSeries(rainSeries(loaded.forecast.days), units, loaded.forecast.timezone),
      nowTime,
    );
    const rainWeek = computeRainWeek([rainToday, ...later], rainClimate.normals);
    const unit = rainUnit(units);
    body.rain = {
      unit,
      days: [rainToday, ...later.slice(0, 1)].map((d) => formatRainDay(d, units)),
    };
    if (rainNow) body.rain.now = formatRainNow(rainNow, unit);
    if (rainWeek) body.rain.week = formatRainWeek(rainWeek, units);
  }

  // Responses that depend on the visitor (IP location or country-default units) must not be
  // shared by the CDN.
  const shared = located.source !== 'ip' && explicitUnits !== null;
  // Short cache while stale, or while climate normals are still loading in the background, and
  // never past the next hour (today's rain answer is for the rest of the day from now), stale
  // or not.
  let maxAge = loaded.stale || climate.pending || rainClimate.pending ? 60 : CACHE.edgeMaxAge;
  const toNextHour = secondsToNextHour(loaded.forecast, nowTime);
  if (toNextHour !== null) maxAge = Math.min(maxAge, Math.max(60, toNextHour));
  const headers = shared
    ? publicCache(maxAge, maxAge, toNextHour)
    : privateCache(Math.min(maxAge, 300));
  const result: HandlerResult<TodayResponse> = { status: 200, body, headers, maxAge };
  if (toNextHour !== null) result.expiresIn = toNextHour;
  return result;
}
