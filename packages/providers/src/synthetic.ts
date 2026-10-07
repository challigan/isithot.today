/**
 * A stand-in for the upstream APIs that returns deterministic, plausible data in the exact
 * Open-Meteo and NASA POWER response formats. Used for local development without network
 * access (`DATA_SOURCE=synthetic`) and for end-to-end tests. Never used in production.
 */
import { MODELS, localDate, normalForDate, roundToGrid } from '@isithot/core';
import type { FetchLike } from './errors';

export interface SyntheticPlace {
  geonameId: number;
  name: string;
  country: string;
  countryName: string;
  region: string | null;
  lat: number;
  lon: number;
  population: number;
}

/** FNV-1a hash → [0, 1). */
function unit(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

const between = (seed: string, min: number, max: number): number => min + unit(seed) * (max - min);
const r1 = (v: number): number => Math.round(v * 10) / 10;

export function syntheticNormals(lat: number): number[] {
  const a = Math.abs(lat);
  const mean = 31 - 0.33 * a;
  const range = Math.max(2, 0.22 * a);
  const warmest = lat >= 0 ? 6 : 0;
  return Array.from({ length: 12 }, (_, m) =>
    r1(mean + (range / 2) * Math.cos((2 * Math.PI * (m - warmest)) / 12)),
  );
}

export function syntheticTimezone(lat: number, lon: number): string {
  if (lat > 49.8 && lat < 61 && lon > -8.7 && lon < 1.9) return 'Europe/London';
  const offset = Math.round(lon / 15);
  if (offset === 0) return 'UTC';
  // Etc/GMT zones have inverted signs: Etc/GMT-1 is UTC+1.
  return `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
}

function addDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function syntheticForecast(lat: number, lon: number, modelIds: string[], now: Date) {
  const cell = `${roundToGrid(lat, 0.05)},${roundToGrid(lon, 0.05)}`;
  const timezone = syntheticTimezone(lat, lon);
  const today = localDate(timezone, now);
  const dates = [today, addDay(today)];
  const normals = syntheticNormals(lat);

  const daily: Record<string, unknown[]> = { time: dates };
  const hourly: Record<string, unknown[]> = {
    time: dates.flatMap((d) =>
      Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`),
    ),
  };

  for (const id of modelIds) {
    const highs: number[] = [];
    const feels: number[] = [];
    const temps: number[] = [];
    for (const date of dates) {
      const base = normalForDate(normals, date) + between(`${cell}|${date}`, -4, 5);
      const outlier =
        unit(`${cell}|${date}|${id}|outlier`) < 0.12 ? between(`${id}${date}`, 3, 4.5) : 0;
      const high = r1(base + between(`${cell}|${date}|${id}`, -1.5, 1.5) + outlier);
      const humid =
        high > 24
          ? between(`${cell}|${date}|hum`, 1, 4)
          : between(`${cell}|${date}|hum`, -3.5, 0.5);
      highs.push(high);
      feels.push(r1(high + humid));
      const peak = 13 + Math.floor(unit(`${cell}|${date}|peak`) * 3);
      for (let h = 0; h < 24; h++) {
        const shape = (Math.cos(((h - peak) / 24) * 2 * Math.PI) + 1) / 2;
        temps.push(r1(high - 8 * (1 - shape)));
      }
    }
    daily[`temperature_2m_max_${id}`] = highs;
    daily[`apparent_temperature_max_${id}`] = feels;
    hourly[`temperature_2m_${id}`] = temps;
  }

  return {
    latitude: lat,
    longitude: lon,
    generationtime_ms: 0.5,
    utc_offset_seconds: 0,
    timezone,
    timezone_abbreviation: 'GMT',
    elevation: 50,
    daily_units: { time: 'iso8601' },
    daily,
    hourly_units: { time: 'iso8601' },
    hourly,
  };
}

export function syntheticClimatology(lat: number, lon: number) {
  const keys = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const normals = syntheticNormals(lat);
  // Mean temperature and daily range chosen so that T2M + T2M_RANGE / 2 is the normal high.
  const T2M: Record<string, number> = {};
  const T2M_RANGE: Record<string, number> = {};
  keys.forEach((k, i) => {
    T2M[k] = r1((normals[i] as number) - 4);
    T2M_RANGE[k] = 8;
  });
  T2M.ANN = r1(normals.reduce((a, b) => a + b, 0) / 12 - 4);
  T2M_RANGE.ANN = 8;
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat, 50] },
    properties: { parameter: { T2M, T2M_RANGE } },
    header: { title: 'NASA/POWER synthetic climatology', fill_value: -999 },
    messages: [],
    parameters: {
      T2M: { units: 'C', longname: 'Temperature at 2 Meters' },
      T2M_RANGE: { units: 'C', longname: 'Temperature at 2 Meters Range' },
    },
    times: { data: 0, process: 0 },
  };
}

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function syntheticSearch(query: string, count: number, places: readonly SyntheticPlace[]) {
  const q = fold(query.trim());
  const results = places
    .filter((p) => fold(p.name).startsWith(q))
    .sort((a, b) => b.population - a.population)
    .slice(0, count)
    .map((p) => ({
      id: p.geonameId,
      name: p.name,
      latitude: p.lat,
      longitude: p.lon,
      elevation: 50,
      feature_code: 'PPL',
      country_code: p.country,
      country: p.countryName,
      admin1: p.region ?? undefined,
      timezone: syntheticTimezone(p.lat, p.lon),
      population: p.population,
    }));
  return results.length ? { results, generationtime_ms: 0.4 } : { generationtime_ms: 0.4 };
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

export function createSyntheticFetch(
  places: readonly SyntheticPlace[],
  now: () => Date = () => new Date(),
): FetchLike {
  return async (input) => {
    const url = new URL(input);
    const p = url.searchParams;
    if (url.pathname.endsWith('/forecast')) {
      const ids = (p.get('models') ?? MODELS.map((m) => m.id).join(',')).split(',');
      return json(
        syntheticForecast(Number(p.get('latitude')), Number(p.get('longitude')), ids, now()),
      );
    }
    if (url.pathname.endsWith('/search')) {
      return json(syntheticSearch(p.get('name') ?? '', Number(p.get('count') ?? 8), places));
    }
    if (url.pathname.includes('/climatology/')) {
      return json(syntheticClimatology(Number(p.get('latitude')), Number(p.get('longitude'))));
    }
    return new Response('Not found', { status: 404 });
  };
}
