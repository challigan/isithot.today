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
    parameters: NASA_POWER_PARAMETERS.join(','),
    community: 'AG',
    longitude: String(point.lon),
    latitude: String(point.lat),
    format: 'JSON',
  });
  return `${url}?${params.toString()}`;
}

type Monthly = Record<string, unknown>;

/** Twelve monthly normal daily highs, January first, °C. */
export function parseClimatology(json: unknown): MonthlyNormals {
  const parameter = (json as { properties?: { parameter?: Record<string, Monthly> } })?.properties
    ?.parameter;
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
