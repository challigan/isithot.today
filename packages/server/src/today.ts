import {
  AHEAD,
  ATTRIBUTION,
  CACHE,
  COPY,
  ERROR_MESSAGES,
  GRID,
  LINKS,
  MODELS,
  SNOW,
  WIND,
  computeDay,
  computeNow,
  computeRainDay,
  computeRainNow,
  computeRainWeek,
  computeSnowDay,
  computeSnowNow,
  computeSnowWeek,
  computeWeek,
  computeWindDay,
  computeWindNow,
  computeWindWeek,
  defaultUnitsForCountry,
  defaultWindUnitForCountry,
  formatDay,
  formatNow,
  formatRainDay,
  formatRainNow,
  formatRainWeek,
  formatSnowDay,
  formatSnowNow,
  formatSnowWeek,
  formatWeek,
  formatWindDay,
  formatWindNow,
  formatWindWeek,
  cellKey,
  forecastHeight,
  gridKey,
  isValidLatLon,
  climateRange,
  hourlySeries,
  isFiniteNumber,
  judgeRainSeries,
  judgeSeries,
  judgeSnowSeries,
  judgeWindSeries,
  localDate,
  outboundLinks,
  parseElevation,
  parseUnits,
  parseWindUnit,
  rainSeries,
  rainUnit,
  roundPoint,
  snapToCell,
  snowAhead,
  snowSeries,
  snowUnit,
  updatedParts,
  windSeries,
  type ApiLocation,
  type DayComputation,
  type LatLon,
  type MonthlyNormals,
  type RainDayComputation,
  type SnowDayComputation,
  type TodayResponse,
  type Topic,
  type WindDayComputation,
} from '@isithot/core';
import {
  FORECAST_CACHE_VERSION,
  FORECAST_TIMING,
  errorMessage,
  fetchClimateNormals,
  fetchForecast,
  fetchRainNormals,
  fetchSnowNormals,
  fetchWindNormals,
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
  /** The climate cell's mean height, m (snow and wind normals only). */
  height?: number | null;
}

/** How long a response waits for NASA POWER before answering without normals, ms. */
export const CLIMATE_WAIT_MS = 2000;

/** A place as the today query names it, without its time zone (which comes from the forecast). */
export type Located = Omit<ApiLocation, 'timezone'>;

const COORD = /^-?\d{1,3}(\.\d+)?$/;
const HEIGHT = /^-?\d{1,4}(\.\d+)?$/;
const COUNTRY = /^[A-Za-z]{2}$/;

/**
 * What a user-supplied name never needs: angle brackets, controls (C0 and C1), line and paragraph
 * separators, and the invisible format characters (direction overrides, zero-width spaces), all
 * but the zero-width non-joiner and joiner that some scripts spell with. A name reaches pages,
 * notifications and logs, where any of these could break a line or reverse how it reads.
 */
const UNWANTED = /[<>\p{Cc}\p{Zl}\p{Zp}]|(?![\u200c\u200d])\p{Cf}/gu;

function clean(value: string | null, max = 80): string | null {
  if (!value) return null;
  const text = value.replace(UNWANTED, '').trim().slice(0, max);
  return text.length > 0 ? text : null;
}

function parseCoord(value: string | null): number | null {
  if (value === null || !COORD.test(value.trim())) return null;
  return Number(value);
}

function parseGeonameId(value: string | null): number | undefined {
  return value && /^\d{1,10}$/.test(value) ? Number(value) : undefined;
}

/** A searched place's height from the query, whole metres, or null when absent or implausible. */
function parseHeight(value: string | null): number | null {
  return value !== null && HEIGHT.test(value.trim()) ? parseElevation(Number(value)) : null;
}

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function withOptional(
  loc: Located,
  slug?: string,
  geonameId?: number,
  elevation: number | null = null,
): Located {
  const out: Located = { ...loc };
  if (slug) out.slug = slug;
  if (geonameId) out.geonameId = geonameId;
  if (elevation !== null) out.elevation = elevation;
  return out;
}

/**
 * The place a query's `lat` and `lon` name (with `name`, `region`, `country`, `geonameId`,
 * `elevation` and `source`), rounded again to the forecast grid; null when the coordinates are
 * malformed or out of range. The notification registrations canonicalise their places with it.
 */
export async function locateFromCoords(params: URLSearchParams): Promise<Located | null> {
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
  // Without a name, the nearest town names the point. A named place without a country (an older
  // address, or an API client's) takes the nearest town's, which picks its wind unit and
  // warnings link.
  if (!name || !country) {
    const place = await reverseGeocode(point.lat, point.lon);
    if (place && !name) {
      name = place.name;
      region = region ?? place.region;
      geonameId = geonameId ?? place.geonameId;
    }
    country = country ?? place?.country ?? null;
  }
  const source = params.get('source') === 'search' ? 'search' : 'device';
  const city = name
    ? cityForPlace({ name, country, ...point, geonameId: geonameId ?? null })
    : undefined;
  // Only a searched place has a known height (the geocoder's, else its city page's): a device
  // location keeps the terrain height at the rounded point.
  const elevation =
    source === 'search'
      ? (parseHeight(params.get('elevation')) ?? parseElevation(city?.elevation))
      : null;
  return withOptional(
    { name: name ?? COPY.yourLocation, region, country, ...point, source },
    city?.slug,
    geonameId,
    elevation,
  );
}

/** A city page's place, or null for a slug with no page. */
export function locateCity(slug: string): Located | null {
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
    parseElevation(city.elevation),
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
  // The answer is for the fallback city, so its height (when known) goes with it.
  const city = locateCity(fallback);
  return city ? { ...city, source: 'ip' } : null;
}

const inflight = new Map<string, Promise<Forecast>>();

/** Days whose hours are kept: "now" looks a day ahead and may run past midnight. */
const HOURLY_DAYS = 3;

/**
 * Later days only need each model's daily high, so their hours are dropped before caching
 * (a seven-day, six-model hourly forecast is otherwise about 7,000 numbers per entry). Each
 * model's day keeps its strongest wind, so the week's later days are still judged for wind.
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

/** A forecast to answer with, or why there is none. */
type LoadedForecast = (ForecastEntry & { stale: boolean }) | { failure: string };

/**
 * The cached forecast for a grid cell and height (ELEVATION.step bands, or "dem" for Open-Meteo's
 * terrain height), fetched when missing or old.
 */
async function loadForecast(
  point: LatLon,
  height: number | null,
  deps: ServerDeps,
  nowDate: Date,
): Promise<LoadedForecast> {
  const key = `forecast/v${FORECAST_CACHE_VERSION}/${gridKey(point, GRID.forecast)}/${height ?? 'dem'}`;
  const now = nowDate.getTime();
  const entry = await deps.cache.get<ForecastEntry>(key);
  if (
    entry &&
    now - entry.fetchedAt < CACHE.forecastFresh * 1000 &&
    startsToday(entry.forecast, nowDate)
  ) {
    return { ...entry, stale: false };
  }
  const timing = deps.forecastTiming ?? FORECAST_TIMING;
  // Wall-clock time taken, for the logs (deps.now is the answer's clock and may be fixed).
  const started = Date.now();
  try {
    let pending = inflight.get(key);
    if (!pending) {
      pending = fetchForecast(
        { ...deps.config.openMeteo, fetch: deps.fetch, ...timing },
        point,
        MODELS,
        height,
      );
      inflight.set(key, pending);
      pending.then(
        () => inflight.delete(key),
        () => inflight.delete(key),
      );
    }
    const fresh: ForecastEntry = { fetchedAt: now, forecast: slim(await pending) };
    const took = Date.now() - started;
    // Slow enough for the second request to have started: worth seeing when tuning the timing.
    if (took >= timing.hedgeAfterMs) deps.log(`forecast for ${key} took ${took}ms`);
    deps.waitUntil(deps.cache.set(key, fresh));
    return { ...fresh, stale: false };
  } catch (err) {
    const failure = errorMessage(err);
    const usable =
      entry &&
      now - entry.fetchedAt < CACHE.forecastStale * 1000 &&
      coversToday(entry.forecast, nowDate);
    deps.log(
      `forecast unavailable for ${key} after ${Date.now() - started}ms: ${failure}; ` +
        (usable
          ? `answering with the copy from ${new Date(entry.fetchedAt).toISOString()}`
          : 'no usable cached copy, answering 503'),
    );
    return usable ? { ...entry, stale: true } : { failure };
  }
}

type NormalsResult = {
  normals: MonthlyNormals | null;
  pending: boolean;
  /** The climate cell's mean height, m, when the source gives it (snow and wind normals). */
  height?: number | null;
};

/**
 * What a NASA POWER request gives: twelve monthly values, and for snow and wind the cell's
 * height.
 */
type Monthly = { normals: MonthlyNormals; height?: number | null };

/**
 * Twelve monthly values from NASA POWER, cached per climate cell for good (a failure for an
 * hour). A response waits at most CLIMATE_WAIT_MS for a cell it has not seen, then answers
 * without them and finishes filling the cache in the background.
 */
async function loadMonthly(
  key: string,
  label: string,
  fetchMonthly: () => Promise<Monthly>,
  deps: ServerDeps,
): Promise<NormalsResult> {
  const now = deps.now().getTime();
  const entry = await deps.cache.get<ClimateEntry>(key);
  if (entry?.normals) return { normals: entry.normals, pending: false, height: entry.height };
  if (entry && now - entry.fetchedAt < CACHE.climateFailure * 1000) {
    return { normals: null, pending: false };
  }

  const pending = fetchMonthly()
    .then(async (got) => {
      const fresh: ClimateEntry = { fetchedAt: now, normals: [...got.normals] };
      if (got.height !== undefined) fresh.height = got.height;
      await deps.cache.set<ClimateEntry>(key, fresh);
      return got;
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
  return { normals: result?.normals ?? null, pending: false, height: result?.height };
}

/** Normal daily highs, for judging hot. */
function loadNormals(point: LatLon, deps: ServerDeps): Promise<NormalsResult> {
  const config = { url: deps.config.nasaPowerUrl, fetch: deps.fetch, timeoutMs: 9000 };
  return loadMonthly(
    `climate/v4/${cellKey(point, GRID.climate)}`,
    'climate normals',
    () =>
      fetchClimateNormals(config, snapToCell(point, GRID.climate)).then((normals) => ({ normals })),
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
    () =>
      fetchRainNormals(config, snapToCell(point, GRID.climate)).then((normals) => ({ normals })),
    deps,
  );
}

/**
 * Normal snowfall, for "Snow is rare here in October." and the week's "more snow than usual".
 * Its own request and cache entry, as rain's, with the climate cell's height.
 */
function loadSnowNormals(point: LatLon, deps: ServerDeps): Promise<NormalsResult> {
  const config = { url: deps.config.nasaPowerUrl, fetch: deps.fetch, timeoutMs: 9000 };
  return loadMonthly(
    `climate-snow/v1/${cellKey(point, GRID.climate)}`,
    'snow normals',
    () => fetchSnowNormals(config, snapToCell(point, GRID.climate)),
    deps,
  );
}

/**
 * Normal wind at 10m, for "Windier than usual" lines. Its own request and cache entry, as rain's
 * and snow's, with the climate cell's height; a failure only removes those lines.
 */
function loadWindNormals(point: LatLon, deps: ServerDeps): Promise<NormalsResult> {
  const config = { url: deps.config.nasaPowerUrl, fetch: deps.fetch, timeoutMs: 9000 };
  return loadMonthly(
    `climate-wind/v1/${cellKey(point, GRID.climate)}`,
    'wind normals',
    () => fetchWindNormals(config, snapToCell(point, GRID.climate)),
    deps,
  );
}

/**
 * Normals only where the climate cell's mean height is within `limit` metres of the place's: a
 * 50km cell's normal snow says little about a valley town below its mountains, or a ski resort
 * above them, and its normal wind little about a sheltered valley or an exposed top. Without
 * either height they are used as they are.
 */
function nearbyHeight(
  normals: NormalsResult,
  elevation: number | null,
  limit: number,
): MonthlyNormals | null {
  const { height } = normals;
  if (!isFiniteNumber(height) || elevation === null) return normals.normals;
  return Math.abs(height - elevation) <= limit ? normals.normals : null;
}

/** The topics whose next hours `ahead` may ask for (the apps' opt-in): snow so far. */
const AHEAD_TOPICS: readonly Topic[] = ['snow'];

/**
 * The topics an app asks for with `ahead=snow` (comma-separated); unknown topics and repeats are
 * ignored. The website never sends it.
 */
function aheadTopics(params: URLSearchParams): Set<Topic> {
  const asked = (params.get('ahead') ?? '').split(',');
  return new Set(AHEAD_TOPICS.filter((t) => asked.includes(t)));
}

/**
 * Seconds until the next forecast hour starts. Today's rain, snow and wind answers cover the rest
 * of the day from the moment of the request, so no cache may keep them past the hour.
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
  // Wind has its own setting. With `units` given the answer must not depend on the visitor (the
  // CDN shares it), so wind then defaults from the place; with neither given it follows the
  // visitor, as temperature does.
  const windUnit =
    parseWindUnit(params.get('windUnits')) ??
    defaultWindUnitForCountry(
      explicitUnits === null ? (geo?.country ?? located.country) : located.country,
    );

  const point = { lat: located.lat, lon: located.lon };
  const [loaded, climate, rainClimate, snowClimate, windClimate] = await Promise.all([
    loadForecast(point, forecastHeight(located.elevation), deps, nowDate),
    loadNormals(point, deps),
    loadRainNormals(point, deps),
    loadSnowNormals(point, deps),
    deps.config.compareWind ? loadWindNormals(point, deps) : { normals: null, pending: false },
  ]);
  const normals = climate.normals;
  if ('failure' in loaded) {
    return errorResult('upstream_unavailable', ERROR_MESSAGES.upstream_unavailable, loaded.failure);
  }

  const today = localDate(loaded.forecast.timezone, nowDate);
  const days = loaded.forecast.days
    .filter((d) => d.date >= today)
    .map((d) => computeDay(d, normals))
    .filter((d): d is DayComputation => d !== null);
  if (days[0]?.date !== today) {
    return errorResult(
      'upstream_unavailable',
      ERROR_MESSAGES.upstream_unavailable,
      `open-meteo: the forecast has no data for ${today} (${loaded.forecast.timezone})`,
    );
  }

  const range = normals ? climateRange(normals) : null;
  const now = computeNow(
    judgeSeries(hourlySeries(loaded.forecast.days), range, units, loaded.forecast.timezone),
    nowTime,
  );
  const week = computeWeek(days, normals);
  const location = { ...located, timezone: loaded.forecast.timezone };
  const updatedAt = new Date(loaded.fetchedAt).toISOString();
  const body: TodayResponse = {
    location,
    units,
    // Today and tomorrow in full (tomorrow's verdict in the future tense); the rest of the week
    // is summarised in `week`.
    days: days.slice(0, 2).map((d, i) => formatDay(d, units, i === 1)),
    updatedAt,
    // The apps word the "Updated" line and draw the footer's links from these; the website works
    // both out from `updatedAt` and `location` (the same core functions).
    updated: updatedParts(updatedAt, location.timezone),
    attribution: [...ATTRIBUTION],
    links: outboundLinks(location),
    nearby: nearbyCities(point, LINKS.nearby, located.slug).map((c) => ({
      slug: c.slug,
      name: c.name,
    })),
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

  // Will it snow? The same windows as rain, from the same forecast.
  // The place's own height where known, else the one the forecast is for.
  const height = located.elevation ?? loaded.forecast.elevation;
  const snowNormals = nearbyHeight(snowClimate, height, SNOW.normals.maxHeightDifference);
  const snowToday =
    forecastDays[0]?.date === today
      ? computeSnowDay(forecastDays[0], { from: nowTime, normals: snowNormals })
      : null;
  if (snowToday) {
    const later = forecastDays
      .slice(1)
      .map((d) => computeSnowDay(d, { normals: snowNormals }))
      .filter((d): d is SnowDayComputation => d !== null);
    const judged = judgeSnowSeries(
      snowSeries(loaded.forecast.days),
      units,
      loaded.forecast.timezone,
    );
    const snowNow = computeSnowNow(judged, nowTime);
    const snowWeek = computeSnowWeek([snowToday, ...later]);
    const unit = snowUnit(units);
    body.snow = {
      unit,
      days: [snowToday, ...later.slice(0, 1)].map((d) => formatSnowDay(d, units)),
    };
    if (snowNow) body.snow.now = formatSnowNow(snowNow, unit);
    if (snowWeek) body.snow.week = formatSnowWeek(snowWeek, units);
    // The apps' next hours, each answered as at its start from this forecast.
    if (aheadTopics(params).has('snow')) {
      body.snow.ahead = snowAhead(judged, forecastDays, nowTime, AHEAD.hours, units, snowNormals);
    }
  }

  // Is it windy? Today from the current hour, later days over their waking hours, from the same
  // forecast; nothing for a forecast recorded without wind.
  const windNormals = nearbyHeight(windClimate, height, WIND.normals.maxHeightDifference);
  const windToday =
    forecastDays[0]?.date === today
      ? computeWindDay(forecastDays[0], { from: nowTime, normals: windNormals })
      : null;
  if (windToday) {
    const later = forecastDays
      .slice(1)
      .map((d) => computeWindDay(d, { normals: windNormals }))
      .filter((d): d is WindDayComputation => d !== null);
    const windNow = computeWindNow(
      judgeWindSeries(windSeries(loaded.forecast.days), windUnit, loaded.forecast.timezone),
      nowTime,
    );
    const windWeek = computeWindWeek([windToday, ...later]);
    body.wind = {
      unit: windUnit,
      days: [windToday, ...later.slice(0, 1)].map((d) => formatWindDay(d, windUnit)),
    };
    if (windNow) body.wind.now = formatWindNow(windNow, windUnit);
    if (windWeek) body.wind.week = formatWindWeek(windWeek, windUnit);
  }

  // Responses that depend on the visitor (IP location or country-default units) must not be
  // shared by the CDN. Wind units follow the place whenever `units` is given, so they never do.
  const shared = located.source !== 'ip' && explicitUnits !== null;
  // Short cache while stale, or while climate normals are still loading in the background, and
  // never past the next hour (today's rain, snow and wind answers are for the rest of the day
  // from now), stale or not.
  const loading =
    climate.pending || rainClimate.pending || snowClimate.pending || windClimate.pending;
  let maxAge = loaded.stale || loading ? 60 : CACHE.edgeMaxAge;
  const toNextHour = secondsToNextHour(loaded.forecast, nowTime);
  if (toNextHour !== null) maxAge = Math.min(maxAge, Math.max(60, toNextHour));
  const headers = shared
    ? publicCache(maxAge, maxAge, toNextHour)
    : privateCache(Math.min(maxAge, 300));
  const result: HandlerResult<TodayResponse> = { status: 200, body, headers, maxAge };
  if (toNextHour !== null) result.expiresIn = toNextHour;
  return result;
}
