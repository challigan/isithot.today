/**
 * A stand-in for the upstream APIs that returns deterministic, plausible data in the exact
 * Open-Meteo and NASA POWER response formats. Used for local development without network
 * access (`DATA_SOURCE=synthetic`) and for end-to-end tests. Never used in production.
 */
import { FORECAST, MODELS, localDate, normalForDate, parseDate, roundToGrid } from '@isithot/core';
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
const r2 = (v: number): number => Math.round(v * 100) / 100;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function syntheticNormals(lat: number): number[] {
  const a = Math.abs(lat);
  const mean = 31 - 0.33 * a;
  const range = Math.max(2, 0.22 * a);
  const warmest = lat >= 0 ? 6 : 0;
  return Array.from({ length: 12 }, (_, m) =>
    r1(mean + (range / 2) * Math.cos((2 * Math.PI * (m - warmest)) / 12)),
  );
}

/**
 * Normal rainfall, mm/day by month: wettest in the tropics and the mid-latitude storm tracks,
 * driest in the subtropics, and wettest in each hemisphere's late autumn.
 */
export function syntheticRainNormals(lat: number): number[] {
  const a = Math.abs(lat);
  const base = 1.5 + 2 * Math.exp(-((a / 12) ** 2)) + 0.9 * Math.exp(-(((a - 52) / 12) ** 2));
  const wettest = lat >= 0 ? 10 : 4;
  return Array.from({ length: 12 }, (_, m) =>
    r2(base * (1 + 0.3 * Math.cos((2 * Math.PI * (m - wettest)) / 12))),
  );
}

export function syntheticTimezone(lat: number, lon: number): string {
  if (lat > 49.8 && lat < 61 && lon > -8.7 && lon < 1.9) return 'Europe/London';
  const offset = Math.round(lon / 15);
  if (offset === 0) return 'UTC';
  // Etc/GMT zones have inverted signs: Etc/GMT-1 is UTC+1.
  return `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Hours of forecast each synthetic model provides (Météo-France's ARPEGE stops at about 102). */
const HORIZON_HOURS: Record<string, number> = { meteofrance_seamless: 102 };

type Sky = 'dry' | 'spots' | 'showers' | 'rain' | 'wet' | 'heavy';

/**
 * Each place's weather runs through this ten-day cycle (from a point of its own), each day with
 * a chance of turning into its alternative. Any seven days in a row, and any six, hold a dry day
 * and a rainy one, so every week shows both; the wet day is sometimes a heavy one.
 */
const SKIES: ReadonlyArray<readonly [Sky, Sky, number]> = [
  ['dry', 'dry', 0],
  ['spots', 'showers', 0.3],
  ['showers', 'rain', 0.3],
  ['rain', 'rain', 0],
  ['wet', 'heavy', 0.35],
  ['showers', 'spots', 0.3],
  ['dry', 'dry', 0],
  ['dry', 'dry', 0],
  ['rain', 'wet', 0.25],
  ['showers', 'rain', 0.3],
];

function syntheticSky(cell: string, date: string): Sky {
  const day = Math.round(parseDate(date) / 86_400_000) + Math.floor(unit(`${cell}|sky`) * 10);
  const [sky, alternative, chance] = SKIES[day % SKIES.length]!;
  return unit(`${cell}|${day}|sky turn`) < chance ? alternative : sky;
}

/** A spell of rain shared by the models: start hour, length and amount (mm, before jitter). */
interface Spell {
  start: number;
  hours: number;
  mm: number;
  /** Share of models that have it at all: a shower is easily missed, a front is not. */
  reach: number;
  /** A trace: just `mm` in one hour, never enough to make a dry day spotty. */
  trace?: boolean;
}

function spells(cell: string, date: string): Spell[] {
  const at = (name: string, min: number, max: number): number =>
    between(`${cell}|${date}|${name}|spell`, min, max);
  const hour = (name: string, min: number, max: number): number => Math.round(at(name, min, max));
  switch (syntheticSky(cell, date)) {
    case 'dry':
      // Now and then a model or two shows a trace.
      return [{ start: hour('trace', 6, 18), hours: 1, mm: 0.1, reach: 0.15, trace: true }];
    case 'spots':
      return [{ start: hour('spots', 8, 18), hours: 2, mm: at('spots mm', 0.2, 0.5), reach: 0.5 }];
    case 'showers':
      return [
        { start: hour('first', 10, 15), hours: 2, mm: at('first mm', 1, 3), reach: 0.45 },
        { start: hour('second', 14, 19), hours: 1, mm: at('second mm', 0.8, 2), reach: 0.35 },
      ];
    case 'rain':
      return [
        { start: hour('front', 2, 15), hours: 6, mm: at('front mm', 3.5, 7), reach: 1 },
        { start: hour('after', 16, 21), hours: 1, mm: at('after mm', 0.5, 1.5), reach: 0.3 },
      ];
    case 'wet':
      return [
        { start: hour('first', 0, 8), hours: 6, mm: at('first mm', 4, 8), reach: 1 },
        { start: hour('second', 12, 17), hours: 6, mm: at('second mm', 3, 6), reach: 1 },
      ];
    case 'heavy':
      return [{ start: hour('storm', 4, 12), hours: 9, mm: at('storm mm', 15, 30), reach: 1 }];
  }
}

/**
 * One model's rain during each hour of a local day, mm. Models move each spell by up to two
 * hours, stretch or shorten it by an hour and scale its amount, and wetter climates get more.
 */
function syntheticRain(cell: string, lat: number, date: string, id: string): number[] {
  const scale = Math.min(1.5, Math.max(0.75, normalForDate(syntheticRainNormals(lat), date) / 3));
  const hours = Array.from({ length: 24 }, () => 0);
  spells(cell, date).forEach((spell, n) => {
    const seed = `${cell}|${date}|${id}|${n}`;
    if (unit(`${seed}|reach`) >= spell.reach) return;
    const stretch = spell.trace ? 0 : Math.round(between(`${seed}|length`, -1, 1));
    const length = Math.max(1, spell.hours + stretch);
    const shift = Math.round(between(`${seed}|shift`, -2, 2));
    const start = Math.min(24 - length, Math.max(0, spell.start + shift));
    const mm = spell.trace ? spell.mm : spell.mm * scale * between(`${seed}|amount`, 0.6, 1.5);
    // Heaviest in the middle of the spell.
    const weights = Array.from({ length }, (_, j) => Math.sin((Math.PI * (j + 0.5)) / length));
    const total = weights.reduce((a, b) => a + b, 0);
    weights.forEach((w, j) => {
      hours[start + j] = (hours[start + j] ?? 0) + (mm * w) / total;
    });
  });
  return hours.map(r1);
}

/** Offset of a time zone from UTC at a moment, seconds. */
export function zoneOffsetSeconds(timezone: string, now: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)]),
  );
  const local = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!);
  // The formatted parts stop at minutes, so compare with the moment truncated to the minute.
  const minute = Math.floor(now.getTime() / 60000) * 60000;
  return Math.round((local - minute) / 60000) * 60;
}

export function syntheticForecast(lat: number, lon: number, modelIds: string[], now: Date) {
  const cell = `${roundToGrid(lat, 0.05)},${roundToGrid(lon, 0.05)}`;
  const timezone = syntheticTimezone(lat, lon);
  const today = localDate(timezone, now);
  const dates = Array.from({ length: FORECAST.days }, (_, i) => addDays(today, i));
  const normals = syntheticNormals(lat);

  const hourly: Record<string, unknown[]> = {
    time: dates.flatMap((d) =>
      Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`),
    ),
  };

  for (const id of modelIds) {
    const temps: Array<number | null> = [];
    const apparent: Array<number | null> = [];
    for (const date of dates) {
      const base = normalForDate(normals, date) + between(`${cell}|${date}`, -4, 5);
      const outlier =
        unit(`${cell}|${date}|${id}|outlier`) < 0.12 ? between(`${id}${date}`, 3, 4.5) : 0;
      const high = r1(base + between(`${cell}|${date}|${id}`, -1.5, 1.5) + outlier);
      const humid =
        high > 24
          ? between(`${cell}|${date}|hum`, 1, 4)
          : between(`${cell}|${date}|hum`, -3.5, 0.5);
      const peak = 13 + Math.floor(unit(`${cell}|${date}|peak`) * 3);
      for (let h = 0; h < 24; h++) {
        const shape = (Math.cos(((h - peak) / 24) * 2 * Math.PI) + 1) / 2;
        const temp = r1(high - 8 * (1 - shape));
        temps.push(temp);
        // Humidity matters most in the warmth of the day; nights feel a little cooler.
        apparent.push(r1(temp + humid * shape - 1 * (1 - shape)));
      }
    }
    // Precipitation is labelled with the end of the hour it fell in, so the first stamp carries
    // the last hour of the day before.
    const precipitation: Array<number | null> = [addDays(today, -1), ...dates]
      .flatMap((date) => syntheticRain(cell, lat, date, id))
      .slice(23, 23 + temps.length);
    const horizon = HORIZON_HOURS[id] ?? Infinity;
    temps.forEach((_, i) => {
      if (i >= horizon) temps[i] = apparent[i] = precipitation[i] = null;
    });
    hourly[`temperature_2m_${id}`] = temps;
    hourly[`apparent_temperature_${id}`] = apparent;
    hourly[`precipitation_${id}`] = precipitation;
  }

  return {
    latitude: lat,
    longitude: lon,
    generationtime_ms: 0.5,
    utc_offset_seconds: zoneOffsetSeconds(timezone, now),
    timezone,
    timezone_abbreviation: 'GMT',
    elevation: 50,
    hourly_units: { time: 'iso8601' },
    hourly,
  };
}

export function syntheticClimatology(lat: number, lon: number) {
  const normals = syntheticNormals(lat);
  // Mean temperature and daily range chosen so that T2M + T2M_RANGE / 2 is the normal high.
  const T2M: Record<string, number> = {};
  const T2M_RANGE: Record<string, number> = {};
  MONTHS.forEach((k, i) => {
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

/** Normal rainfall in NASA POWER's format: PRECTOTCORR, mm/day. */
export function syntheticRainClimatology(lat: number, lon: number) {
  const normals = syntheticRainNormals(lat);
  const PRECTOTCORR: Record<string, number> = {};
  MONTHS.forEach((k, i) => {
    PRECTOTCORR[k] = normals[i] as number;
  });
  PRECTOTCORR.ANN = r2(normals.reduce((a, b) => a + b, 0) / 12);
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat, 50] },
    properties: { parameter: { PRECTOTCORR } },
    header: { title: 'NASA/POWER synthetic climatology', fill_value: -999 },
    messages: [],
    parameters: { PRECTOTCORR: { units: 'mm/day', longname: 'Precipitation Corrected' } },
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
      const climatology = p.get('parameters')?.split(',').includes('PRECTOTCORR')
        ? syntheticRainClimatology
        : syntheticClimatology;
      return json(climatology(Number(p.get('latitude')), Number(p.get('longitude'))));
    }
    return new Response('Not found', { status: 404 });
  };
}
