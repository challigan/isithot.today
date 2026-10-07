import {
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

/** Daily and hourly variables requested for every model. */
export const FORECAST_VARIABLES = {
  daily: ['temperature_2m_max', 'apparent_temperature_max'],
  // Only hourly temperature is used (for the peak time). Each extra variable counts
  // against the Open-Meteo call quota for every model, so keep this list short.
  hourly: ['temperature_2m'],
};

export function buildForecastUrl(
  config: Pick<OpenMeteoConfig, 'forecastUrl' | 'apiKey'>,
  point: LatLon,
  models: readonly ModelConfig[],
): string {
  const params = new URLSearchParams({
    latitude: String(point.lat),
    longitude: String(point.lon),
    timezone: 'auto',
    forecast_days: '2',
    daily: FORECAST_VARIABLES.daily.join(','),
    hourly: FORECAST_VARIABLES.hourly.join(','),
    models: models.map((m) => m.id).join(','),
  });
  if (config.apiKey) params.set('apikey', config.apiKey);
  return `${config.forecastUrl}?${params.toString()}`;
}

export interface Forecast {
  /** IANA time zone of the location, from `timezone=auto`. */
  timezone: string;
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

/** Parses a multi-model Open-Meteo forecast response into per-day model values. */
export function parseForecast(json: unknown, models: readonly ModelConfig[]): Forecast {
  const body = json as {
    timezone?: unknown;
    latitude?: unknown;
    longitude?: unknown;
    daily?: Series;
    hourly?: Series;
  };
  const daily = body?.daily;
  const dates = daily?.time;
  if (!daily || !Array.isArray(dates) || typeof body.timezone !== 'string') {
    throw new ProviderError('open-meteo', 'unexpected forecast response shape');
  }

  const highs = models.map((m) => seriesFor(daily, 'temperature_2m_max', m, models.length));
  const feels = models.map((m) => seriesFor(daily, 'apparent_temperature_max', m, models.length));

  const hourly = body.hourly;
  const times = Array.isArray(hourly?.time) ? (hourly.time as unknown[]) : [];
  const hourlyTemps = models.map((m) =>
    hourly ? seriesFor(hourly, 'temperature_2m', m, models.length) : null,
  );

  const days: DayData[] = dates.map((date, dayIndex) => {
    const day = String(date);
    const hours: HourTemps[] = [];
    times.forEach((time, t) => {
      const stamp = String(time);
      if (!stamp.startsWith(day)) return;
      hours.push({
        hour: Number(stamp.slice(11, 13)),
        temps: hourlyTemps.map((series) => numberOrNull(series?.[t])),
      });
    });
    return {
      date: day,
      models: models.map((m, i) => ({
        id: m.id,
        name: m.name,
        high: numberOrNull(highs[i]?.[dayIndex]),
        feelsLike: numberOrNull(feels[i]?.[dayIndex]),
      })),
      hourly: hours,
    };
  });

  return {
    timezone: body.timezone,
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
