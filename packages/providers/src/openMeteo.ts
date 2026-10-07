import {
  FORECAST,
  isFiniteNumber,
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
}

/**
 * Hourly variables requested for every model. The free API charges by variables × models, so
 * daily highs are worked out here from the hourly values (Open-Meteo's own daily maximum is
 * the same 24-hour aggregation) rather than requested separately.
 */
export const FORECAST_VARIABLES = {
  hourly: ['temperature_2m', 'apparent_temperature'],
};

/**
 * Bump when the request or the parsed Forecast shape changes: cached forecasts are keyed by it,
 * and recorded test fixtures are re-recorded when the signature below changes.
 */
export const FORECAST_CACHE_VERSION = 2;

/** One line describing the forecast request, written next to recorded fixtures. */
export function forecastSignature(): string {
  return `v${FORECAST_CACHE_VERSION} forecast_days=${FORECAST.days} hourly=${FORECAST_VARIABLES.hourly.join(',')}`;
}

export function buildForecastUrl(
  config: Pick<OpenMeteoConfig, 'forecastUrl' | 'apiKey'>,
  point: LatLon,
  models: readonly ModelConfig[],
): string {
  const params = new URLSearchParams({
    latitude: String(point.lat),
    longitude: String(point.lon),
    timezone: 'auto',
    forecast_days: String(FORECAST.days),
    hourly: FORECAST_VARIABLES.hourly.join(','),
    models: models.map((m) => m.id).join(','),
  });
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

/** Parses a multi-model hourly Open-Meteo forecast into per-day model values. */
export function parseForecast(json: unknown, models: readonly ModelConfig[]): Forecast {
  const body = json as {
    timezone?: unknown;
    utc_offset_seconds?: unknown;
    latitude?: unknown;
    longitude?: unknown;
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

  // Local timestamps ("2026-10-07T14:00") grouped by date, in order.
  const byDate = new Map<string, HourTemps[]>();
  times.forEach((time, t) => {
    const stamp = String(time);
    const date = stamp.slice(0, 10);
    const hours = byDate.get(date) ?? [];
    hours.push({
      hour: Number(stamp.slice(11, 13)),
      time: Date.parse(`${stamp}Z`) - offset * 1000,
      temps: temps.map((series) => numberOrNull(series?.[t])),
      feels: feels.map((series) => numberOrNull(series?.[t])),
    });
    byDate.set(date, hours);
  });

  const days: DayData[] = [...byDate].map(([date, hours]) => ({
    date,
    models: models.map((m, i) => ({
      id: m.id,
      name: m.name,
      high: dailyMax(hours, (h) => h.temps[i] ?? null),
      feelsLike: dailyMax(hours, (h) => h.feels?.[i] ?? null),
    })),
    hourly: hours,
  }));

  return {
    timezone: body.timezone,
    utcOffsetSeconds: offset,
    lat: isFiniteNumber(body.latitude) ? body.latitude : NaN,
    lon: isFiniteNumber(body.longitude) ? body.longitude : NaN,
    days,
  };
}

export async function fetchForecast(
  config: OpenMeteoConfig,
  point: LatLon,
  models: readonly ModelConfig[],
): Promise<Forecast> {
  const json = await fetchJson(
    'open-meteo',
    config.fetch,
    buildForecastUrl(config, point, models),
    config.timeoutMs ?? 6000,
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
