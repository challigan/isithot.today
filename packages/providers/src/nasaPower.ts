import { isValidNormals, type LatLon, type MonthlyNormals } from '@isithot/core';
import { ProviderError, fetchJson, type FetchLike } from './errors';

export const NASA_POWER_URL = 'https://power.larc.nasa.gov/api/temporal/climatology/point';

/**
 * The average of daily maximum temperatures at 2 m, per month. Not `T2M_MAX`: in the
 * climatology endpoint that is the average monthly *maximum* (the hottest day of each month),
 * which runs 3–5°C above the normal daily high.
 */
export const NASA_POWER_PARAMETER = 'T2M_MAX_AVG';

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

export function buildClimatologyUrl(url: string, point: LatLon): string {
  const params = new URLSearchParams({
    parameters: NASA_POWER_PARAMETER,
    community: 'AG',
    longitude: String(point.lon),
    latitude: String(point.lat),
    format: 'JSON',
  });
  return `${url}?${params.toString()}`;
}

/** Twelve monthly normal daily highs (mean of daily maxima), January first, °C. */
export function parseClimatology(json: unknown): MonthlyNormals {
  const values = (json as { properties?: { parameter?: Record<string, Record<string, unknown>> } })
    ?.properties?.parameter?.[NASA_POWER_PARAMETER];
  if (!values) throw new ProviderError('nasa-power', 'unexpected climatology response shape');
  const monthly: unknown[] = MONTH_KEYS.map((key) => values[key]);
  // NASA POWER uses -999 as its fill value.
  if (!isValidNormals(monthly) || monthly.some((v: number) => v <= -999)) {
    throw new ProviderError('nasa-power', 'missing monthly values');
  }
  return monthly;
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
