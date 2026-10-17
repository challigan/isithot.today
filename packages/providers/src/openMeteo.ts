import {
  FORECAST,
  SNOW,
  dailyWind,
  isFiniteNumber,
  parseElevation,
  snowWater,
  type DayData,
  type HourTemps,
  type ModelConfig,
  type LatLon,
} from '@isithot/core';
import { ProviderError, fetchJson, type FetchLike } from './errors';

export const OPEN_METEO_FREE = {
  forecastUrl: 'https://api.open-meteo.com/v1/forecast',
  geocodingUrl: 'https://geocoding-api.open-meteo.com/v1/search',
};

/** Hosts for the paid Standard plan; the API key is passed as `apikey`. */
export const OPEN_METEO_CUSTOMER = {
  forecastUrl: 'https://customer-api.open-meteo.com/v1/forecast',
  geocodingUrl: 'https://customer-geocoding-api.open-meteo.com/v1/search',
};

export interface OpenMeteoConfig {
  forecastUrl: string;
  geocodingUrl: string;
  apiKey?: string | undefined;
  fetch: FetchLike;
  timeoutMs?: number;
  /** Forecasts only: when to send a second, identical request, ms (see FORECAST_TIMING). */
  hedgeAfterMs?: number;
}

/**
 * How long a forecast request may take, ms. A normal answer takes well under 2 seconds. If the
 * first request has not answered (or has failed) after `hedgeAfterMs`, an identical second one
 * starts and the first to succeed wins; both stop at `timeoutMs`, which covers reading the body
 * too. The total stays what one request had before, so a response falls back to a stale
 * forecast (or a 503) no later than it used to. Reasons in docs/DECISIONS.md.
 */
export const FORECAST_TIMING = { timeoutMs: 6000, hedgeAfterMs: 2000 };

/**
 * Hourly variables requested for every model. The free API charges by variables × models (seven
 * variables and six models: 4.2 calls a fetch), so daily highs, rain and snow totals and the
 * day's strongest wind are worked out here from the hourly values (Open-Meteo's own daily
 * maximum and sum are the same 24-hour aggregations) rather than requested separately.
 * `snowfall` is each model's own split of its precipitation into snow, as depth (cm, at 7cm for
 * every 10mm of water). Only two of the models give their own `uv_index` (GFS, and UKMO in its
 * UK domain); the others answer nulls (and a model that answers another's copy is dropped, see
 * withoutCopies). A request of its own would still cost a whole call (Open-Meteo charges at least
 * one per request) against 0.6 here. Wind speed and gusts at 10m come in km/h, Open-Meteo's
 * default; every one of the six models has its own of both.
 */
export const FORECAST_VARIABLES = {
  hourly: [
    'temperature_2m',
    'apparent_temperature',
    'precipitation',
    'snowfall',
    'uv_index',
    'wind_speed_10m',
    'wind_gusts_10m',
  ],
};

/**
 * Bump when the request or the parsed Forecast shape changes: cached forecasts are keyed by it,
 * and recorded test fixtures are re-recorded when the signature below changes. 6: six models,
 * and wind.
 */
export const FORECAST_CACHE_VERSION = 6;

/** One line describing the forecast request, written next to recorded fixtures. */
export function forecastSignature(): string {
  return `v${FORECAST_CACHE_VERSION} forecast_days=${FORECAST.days} hourly=${FORECAST_VARIABLES.hourly.join(',')}`;
}

/**
 * The forecast request. With `elevation` (m) the forecast is for that height; without it
 * Open-Meteo uses the terrain height at the point.
 */
export function buildForecastUrl(
  config: Pick<OpenMeteoConfig, 'forecastUrl' | 'apiKey'>,
  point: LatLon,
  models: readonly ModelConfig[],
  elevation: number | null = null,
): string {
  const params = new URLSearchParams({
    latitude: String(point.lat),
    longitude: String(point.lon),
    timezone: 'auto',
    forecast_days: String(FORECAST.days),
    hourly: FORECAST_VARIABLES.hourly.join(','),
    models: models.map((m) => m.id).join(','),
  });
  if (elevation !== null) params.set('elevation', String(elevation));
  if (config.apiKey) params.set('apikey', config.apiKey);
  return `${config.forecastUrl}?${params.toString()}`;
}

export interface Forecast {
  /** IANA time zone of the location, from `timezone=auto`. */
  timezone: string;
  /** Offset of the response's local timestamps from UTC (one value for the whole response). */
  utcOffsetSeconds: number;
  /** Grid point Open-Meteo actually used. */
  lat: number;
  lon: number;
  /**
   * Height the forecast is for, m: the one requested, else the terrain at the point; null when
   * not given.
   */
  elevation: number | null;
  days: DayData[];
}

type Series = Record<string, unknown>;

function seriesFor(
  block: Series,
  variable: string,
  model: ModelConfig,
  modelCount: number,
): readonly unknown[] | null {
  const keys = [model.id, ...(model.aliases ?? [])].map((id) => `${variable}_${id}`);
  // With a single model Open-Meteo returns unsuffixed keys.
  if (modelCount === 1) keys.push(variable);
  for (const key of keys) {
    const value = block[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}

const numberOrNull = (value: unknown): number | null => (isFiniteNumber(value) ? value : null);

/**
 * A model's daily maximum, or null unless it has a value for every hour of the covered
 * afternoon window (models end mid-day at the edge of their range).
 */
export function dailyMax(hours: readonly HourTemps[], values: (h: HourTemps) => number | null) {
  let max: number | null = null;
  let covered = 0;
  for (const h of hours) {
    const v = values(h);
    if (v === null) continue;
    if (h.hour >= FORECAST.coverFromHour && h.hour <= FORECAST.coverToHour) covered++;
    if (max === null || v > max) max = v;
  }
  return covered === FORECAST.coverToHour - FORECAST.coverFromHour + 1 ? max : null;
}

/** Rounds away float noise, so ten hours of 0.1 mm make 1, not 0.9999…. */
const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;
const total = (values: readonly number[]): number => round6(values.reduce((a, b) => a + b, 0));

/**
 * A model's rain over a local day, the part of it that falls as snow (by the rule both topics
 * share, snowWater in core) and that snow as depth, or nulls unless the model has a value for
 * all 24 hours. The forecast's very last hour never has one (its rain is labelled with a stamp
 * past the end), so it is let off.
 */
export function dailyRain(
  hours: readonly HourTemps[],
  index: number,
  last: HourTemps | undefined,
): { rain: number | null; snow: number | null; snowfall: number | null } {
  const none = { rain: null, snow: null, snowfall: null };
  if (hours.length < 24) return none;
  const rain: number[] = [];
  const snow: number[] = [];
  for (const h of hours) {
    const v = h.rain?.[index] ?? null;
    if (v === null) {
      if (h === last) continue;
      return none;
    }
    rain.push(v);
    snow.push(snowWater(h)[index]!);
  }
  const water = total(snow);
  return { rain: total(rain), snow: water, snowfall: round6(water * SNOW.cmPerMm) };
}

/** A model's lowest temperature over a local day, or null unless it has all 24 hours. */
export function dailyMin(hours: readonly HourTemps[], index: number): number | null {
  const temps = hours.map((h) => h.temps[index] ?? null);
  return hours.length >= 24 && temps.every(isFiniteNumber) ? Math.min(...temps) : null;
}

/**
 * The series with any exact copy of an earlier one replaced by null. Open-Meteo fills a variable
 * a model lacks from another model (MET Norway's UV index was GFS's, hour for hour, when it was
 * one of the models), and a copy counted as a second model would outvote the others in the
 * median.
 */
export function withoutCopies(
  series: readonly (readonly unknown[] | null)[],
): (readonly unknown[] | null)[] {
  return series.map((s, i) =>
    s !== null &&
    series
      .slice(0, i)
      .some((o) => o !== null && o.length === s.length && o.every((v, k) => v === s[k]))
      ? null
      : s,
  );
}

/** Parses a multi-model hourly Open-Meteo forecast into per-day model values. */
export function parseForecast(json: unknown, models: readonly ModelConfig[]): Forecast {
  const body = json as {
    timezone?: unknown;
    utc_offset_seconds?: unknown;
    latitude?: unknown;
    longitude?: unknown;
    elevation?: unknown;
    hourly?: Series;
  };
  const hourly = body?.hourly;
  const times = hourly?.time;
  if (!hourly || !Array.isArray(times) || typeof body.timezone !== 'string') {
    throw new ProviderError('open-meteo', 'unexpected forecast response shape');
  }
  const offset = isFiniteNumber(body.utc_offset_seconds) ? body.utc_offset_seconds : 0;
  const temps = models.map((m) => seriesFor(hourly, 'temperature_2m', m, models.length));
  const feels = models.map((m) => seriesFor(hourly, 'apparent_temperature', m, models.length));
  const precipitation = models.map((m) => seriesFor(hourly, 'precipitation', m, models.length));
  const snowfall = models.map((m) => seriesFor(hourly, 'snowfall', m, models.length));
  const uv = withoutCopies(models.map((m) => seriesFor(hourly, 'uv_index', m, models.length)));
  const wind = withoutCopies(
    models.map((m) => seriesFor(hourly, 'wind_speed_10m', m, models.length)),
  );
  const gusts = withoutCopies(
    models.map((m) => seriesFor(hourly, 'wind_gusts_10m', m, models.length)),
  );
  // Older recordings have no precipitation at all: leave rain out rather than call them dry.
  const hasRain = precipitation.some((series) => series !== null);
  // Nor snowfall: snow is then judged by each model's temperature (snowWater in core).
  const hasSnow = snowfall.some((series) => series !== null);
  // Nor the UV index: the hot views then show none.
  const hasUv = uv.some((series) => series !== null);
  // Nor wind: leave it out rather than call the day calm.
  const hasWind = wind.some((series) => series !== null) && gusts.some((s) => s !== null);

  // Local timestamps ("2026-10-07T14:00") grouped by date, in order.
  const byDate = new Map<string, HourTemps[]>();
  let last: HourTemps | undefined;
  times.forEach((time, t) => {
    const stamp = String(time);
    const date = stamp.slice(0, 10);
    const hours = byDate.get(date) ?? [];
    last = {
      hour: Number(stamp.slice(11, 13)),
      time: Date.parse(`${stamp}Z`) - offset * 1000,
      temps: temps.map((series) => numberOrNull(series?.[t])),
      feels: feels.map((series) => numberOrNull(series?.[t])),
    };
    // Precipitation at a stamp fell during the hour before it, so the rain during the hour that
    // starts at stamp t is the next stamp's value (23:00 takes the next day's 00:00).
    if (hasRain) last.rain = precipitation.map((series) => numberOrNull(series?.[t + 1]));
    // Snowfall is labelled the same way, and so is the UV index (the hour's average).
    if (hasSnow) last.snow = snowfall.map((series) => numberOrNull(series?.[t + 1]));
    if (hasUv) last.uv = uv.map((series) => numberOrNull(series?.[t + 1]));
    if (hasWind) {
      // Wind speed is instant, at its stamp (the hour's start, as temperature is); a gust is the
      // strongest of the hour before its stamp, so the hour from stamp t takes the next stamp's,
      // as rain does.
      last.wind = wind.map((series) => numberOrNull(series?.[t]));
      last.gust = gusts.map((series) => numberOrNull(series?.[t + 1]));
    }
    hours.push(last);
    byDate.set(date, hours);
  });

  const days: DayData[] = [...byDate].map(([date, hours]) => ({
    date,
    models: models.map((m, i) => ({
      id: m.id,
      name: m.name,
      high: dailyMax(hours, (h) => h.temps[i] ?? null),
      feelsLike: dailyMax(hours, (h) => h.feels?.[i] ?? null),
      ...(hasRain ? { ...dailyRain(hours, i, last), low: dailyMin(hours, i) } : {}),
      // Each day's strongest wind, kept with the model as the server drops later days' hours.
      ...(hasWind ? dailyWind(hours, i) : {}),
    })),
    hourly: hours,
  }));

  return {
    timezone: body.timezone,
    utcOffsetSeconds: offset,
    lat: isFiniteNumber(body.latitude) ? body.latitude : NaN,
    lon: isFiniteNumber(body.longitude) ? body.longitude : NaN,
    elevation: isFiniteNumber(body.elevation) ? body.elevation : null,
    days,
  };
}

export async function fetchForecast(
  config: OpenMeteoConfig,
  point: LatLon,
  models: readonly ModelConfig[],
  elevation: number | null = null,
): Promise<Forecast> {
  const json = await fetchJson(
    'open-meteo',
    config.fetch,
    buildForecastUrl(config, point, models, elevation),
    config.timeoutMs ?? FORECAST_TIMING.timeoutMs,
    config.hedgeAfterMs ?? FORECAST_TIMING.hedgeAfterMs,
  );
  return parseForecast(json, models);
}

/** A place from Open-Meteo Geocoding (GeoNames based). */
export interface GeoPlace {
  geonameId: number | null;
  name: string;
  lat: number;
  lon: number;
  countryCode: string | null;
  country: string | null;
  admin1: string | null;
  timezone: string | null;
  population: number | null;
  /** Height, whole metres, or null when missing or implausible. */
  elevation: number | null;
}

export function buildSearchUrl(
  config: Pick<OpenMeteoConfig, 'geocodingUrl' | 'apiKey'>,
  query: string,
  count: number,
): string {
  const params = new URLSearchParams({
    name: query,
    count: String(count),
    language: 'en',
    format: 'json',
  });
  if (config.apiKey) params.set('apikey', config.apiKey);
  return `${config.geocodingUrl}?${params.toString()}`;
}

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

export function parseSearch(json: unknown): GeoPlace[] {
  const results = (json as { results?: unknown })?.results;
  if (results === undefined) return [];
  if (!Array.isArray(results)) {
    throw new ProviderError('open-meteo-geocoding', 'unexpected search response shape');
  }
  const places: GeoPlace[] = [];
  for (const r of results as Record<string, unknown>[]) {
    if (!isFiniteNumber(r.latitude) || !isFiniteNumber(r.longitude)) continue;
    const name = stringOrNull(r.name);
    if (!name) continue;
    places.push({
      geonameId: isFiniteNumber(r.id) ? r.id : null,
      name,
      lat: r.latitude,
      lon: r.longitude,
      countryCode: stringOrNull(r.country_code)?.toUpperCase() ?? null,
      country: stringOrNull(r.country),
      admin1: stringOrNull(r.admin1),
      timezone: stringOrNull(r.timezone),
      population: isFiniteNumber(r.population) ? r.population : null,
      elevation: parseElevation(r.elevation),
    });
  }
  return places;
}

export async function searchPlaces(
  config: OpenMeteoConfig,
  query: string,
  count: number,
): Promise<GeoPlace[]> {
  const json = await fetchJson(
    'open-meteo-geocoding',
    config.fetch,
    buildSearchUrl(config, query, count),
    config.timeoutMs ?? 5000,
  );
  return parseSearch(json);
}
