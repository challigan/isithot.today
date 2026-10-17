import { isFiniteNumber, isValidNormals, type LatLon, type MonthlyNormals } from '@isithot/core';
import { ProviderError, fetchJson, type FetchLike } from './errors';

export const NASA_POWER_URL = 'https://power.larc.nasa.gov/api/temporal/climatology/point';

/**
 * The normal daily high is estimated as the monthly mean temperature plus half the average
 * daily temperature range: T2M + T2M_RANGE / 2.
 *
 * Neither max-temperature parameter works here. Checked against live responses: in the
 * climatology endpoint `T2M_MAX` is the highest temperature of the period and `T2M_MAX_AVG`
 * the average hottest day of each month. Both put London's January normal at 11–12°C (the
 * real normal daily high is about 8°C).
 */
export const NASA_POWER_PARAMETERS = ['T2M', 'T2M_RANGE'] as const;

/**
 * Normal rainfall: monthly mean precipitation, bias-corrected, mm/day. A separate request, so the
 * temperature request above (and every normal already cached from it) stays exactly as it was.
 */
export const NASA_POWER_RAIN_PARAMETERS = ['PRECTOTCORR'] as const;

/**
 * Normal snowfall over land: monthly mean snow water, mm/day. Its own request too, so the
 * temperature and rain normals (and their cache entries) stay exactly as they were.
 */
export const NASA_POWER_SNOW_PARAMETERS = ['PRECSNOLAND'] as const;

/**
 * Normal wind: the monthly mean wind speed at 10m, m/s (MERRA-2, the mean flow over the climate
 * cell). Its own request too, as the others.
 */
export const NASA_POWER_WIND_PARAMETERS = ['WS10M'] as const;

/**
 * Twelve monthly normals and the climate cell's mean height: snow and wind depend so much on
 * height and exposure that the server uses them only where the cell is near the place's height.
 */
export interface CellNormals {
  /** Twelve monthly values, January first: mm/day of water for snow, m/s for wind. */
  normals: MonthlyNormals;
  /** The cell's mean height, m, or null when the response does not give it. */
  height: number | null;
}

/** Normal snowfall (mm/day of water) and the cell's height. */
export type SnowNormals = CellNormals;
/** Normal wind at 10m (m/s) and the cell's height. */
export type WindNormals = CellNormals;

export interface NasaPowerConfig {
  url: string;
  fetch: FetchLike;
  timeoutMs?: number;
}

const MONTH_KEYS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

function climatologyUrl(url: string, point: LatLon, parameters: readonly string[]): string {
  const params = new URLSearchParams({
    parameters: parameters.join(','),
    community: 'AG',
    longitude: String(point.lon),
    latitude: String(point.lat),
    format: 'JSON',
  });
  return `${url}?${params.toString()}`;
}

export function buildClimatologyUrl(url: string, point: LatLon): string {
  return climatologyUrl(url, point, NASA_POWER_PARAMETERS);
}

export function buildRainClimatologyUrl(url: string, point: LatLon): string {
  return climatologyUrl(url, point, NASA_POWER_RAIN_PARAMETERS);
}

export function buildSnowClimatologyUrl(url: string, point: LatLon): string {
  return climatologyUrl(url, point, NASA_POWER_SNOW_PARAMETERS);
}

export function buildWindClimatologyUrl(url: string, point: LatLon): string {
  return climatologyUrl(url, point, NASA_POWER_WIND_PARAMETERS);
}

type Monthly = Record<string, unknown>;

const parametersOf = (json: unknown): Record<string, Monthly> | undefined =>
  (json as { properties?: { parameter?: Record<string, Monthly> } })?.properties?.parameter;

/** Twelve monthly normal daily highs, January first, °C. */
export function parseClimatology(json: unknown): MonthlyNormals {
  const parameter = parametersOf(json);
  const mean = parameter?.T2M;
  const range = parameter?.T2M_RANGE;
  if (!mean || !range)
    throw new ProviderError('nasa-power', 'unexpected climatology response shape');
  const monthly: unknown[] = MONTH_KEYS.map((key) => {
    const m = mean[key];
    const r = range[key];
    // NASA POWER uses -999 as its fill value.
    if (!isFiniteNumber(m) || !isFiniteNumber(r) || m <= -999 || r <= -999) return null;
    return m + r / 2;
  });
  if (!isValidNormals(monthly)) throw new ProviderError('nasa-power', 'missing monthly values');
  return monthly;
}

/** Twelve monthly rates of an amount that is never negative, January first. */
function parseRates(json: unknown, parameter: string): MonthlyNormals {
  const rate = parametersOf(json)?.[parameter];
  if (!rate) throw new ProviderError('nasa-power', 'unexpected climatology response shape');
  // -999 is the fill value; rain, snow and wind speed are never negative, so anything below zero
  // is missing.
  const monthly: unknown[] = MONTH_KEYS.map((key) => {
    const r = rate[key];
    return isFiniteNumber(r) && r >= 0 ? r : null;
  });
  if (!isValidNormals(monthly)) throw new ProviderError('nasa-power', 'missing monthly values');
  return monthly;
}

/** Twelve monthly normal rainfall rates, January first, mm/day. */
export function parseRainClimatology(json: unknown): MonthlyNormals {
  return parseRates(json, 'PRECTOTCORR');
}

/**
 * Twelve monthly normal snowfall rates (water), January first, mm/day, and the cell's mean
 * height (the point's third coordinate). Cells of sea or glacier may have no land values: they
 * are missing, as for rain, and the site then says nothing about normal snow.
 */
export function parseSnowClimatology(json: unknown): SnowNormals {
  return { normals: parseRates(json, 'PRECSNOLAND'), height: cellHeight(json) };
}

/**
 * Twelve monthly normal wind speeds at 10m, January first, m/s, and the cell's mean height. The
 * mean flow over a 50km cell, so coastal cells include the sea's stronger winds.
 */
export function parseWindClimatology(json: unknown): WindNormals {
  return { normals: parseRates(json, 'WS10M'), height: cellHeight(json) };
}

/** The climate cell's mean height (the point's third coordinate), or null. */
function cellHeight(json: unknown): number | null {
  const height = (json as { geometry?: { coordinates?: unknown[] } }).geometry?.coordinates?.[2];
  return isFiniteNumber(height) ? height : null;
}

export async function fetchClimateNormals(
  config: NasaPowerConfig,
  point: LatLon,
): Promise<MonthlyNormals> {
  const json = await fetchJson(
    'nasa-power',
    config.fetch,
    buildClimatologyUrl(config.url, point),
    config.timeoutMs ?? 8000,
  );
  return parseClimatology(json);
}

export async function fetchRainNormals(
  config: NasaPowerConfig,
  point: LatLon,
): Promise<MonthlyNormals> {
  const json = await fetchJson(
    'nasa-power',
    config.fetch,
    buildRainClimatologyUrl(config.url, point),
    config.timeoutMs ?? 8000,
  );
  return parseRainClimatology(json);
}

export async function fetchSnowNormals(
  config: NasaPowerConfig,
  point: LatLon,
): Promise<SnowNormals> {
  const json = await fetchJson(
    'nasa-power',
    config.fetch,
    buildSnowClimatologyUrl(config.url, point),
    config.timeoutMs ?? 8000,
  );
  return parseSnowClimatology(json);
}

export async function fetchWindNormals(
  config: NasaPowerConfig,
  point: LatLon,
): Promise<WindNormals> {
  const json = await fetchJson(
    'nasa-power',
    config.fetch,
    buildWindClimatologyUrl(config.url, point),
    config.timeoutMs ?? 8000,
  );
  return parseWindClimatology(json);
}
