/**
 * A stand-in for the upstream APIs that returns deterministic, plausible data in the exact
 * Open-Meteo and NASA POWER response formats. Used for local development without network
 * access (`DATA_SOURCE=synthetic`) and for end-to-end tests. Never used in production.
 */
import {
  FORECAST,
  MODELS,
  SNOW,
  localDate,
  normalForDate,
  parseDate,
  roundToGrid,
} from '@isithot/core';
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

/**
 * Snow. The normals above are too mild for real snow climates, so places from SNOWY_FROM_LAT
 * (Reykjavik is the one city page there) stay below freezing all year, which lets end-to-end tests
 * show snow in any month, and beyond COLD_SPELL.fromLat about half the winter days are a cold
 * spell, so Moscow, Oslo or Edinburgh see snow from December to February.
 */
const SNOWY_FROM_LAT = 64;
const COLD_SPELL = { fromLat: 45, chance: 0.5, degrees: 7 };

/** December to February in the north, June to August in the south (month 0 is January). */
const isWinter = (lat: number, month: number): boolean =>
  (lat >= 0 ? [11, 0, 1] : [5, 6, 7]).includes(month);

/** The share of precipitation falling as snow: all of it at -1°C or below, none from 3°C. */
const snowShare = (temp: number): number => Math.min(1, Math.max(0, (3 - temp) / 4));

/** Degrees taken off a day's temperatures by a cold spell. */
function chill(cell: string, lat: number, date: string): number {
  const winter = Math.abs(lat) > COLD_SPELL.fromLat && isWinter(lat, Number(date.slice(5, 7)) - 1);
  return winter && unit(`${cell}|${date}|cold spell`) < COLD_SPELL.chance ? COLD_SPELL.degrees : 0;
}

/**
 * Normal snowfall, mm/day of water by month: the normal rain in the share that falls as snow at
 * the month's mean temperature (a day's is 4° below its high), on cold-spell days and others,
 * and all of it where it is always freezing.
 */
export function syntheticSnowNormals(lat: number): number[] {
  const highs = syntheticNormals(lat);
  return syntheticRainNormals(lat).map((rain, m) => {
    const mean = highs[m]! - 4;
    const cold = Math.abs(lat) > COLD_SPELL.fromLat && isWinter(lat, m) ? COLD_SPELL.chance : 0;
    const share =
      Math.abs(lat) >= SNOWY_FROM_LAT
        ? 1
        : cold * snowShare(mean - COLD_SPELL.degrees) + (1 - cold) * snowShare(mean);
    return r2(rain * share);
  });
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

/**
 * Only two models give their own UV index; the second stops after its 54-hour regional domain.
 * The other models' are all nulls.
 */
const UV_HORIZON_HOURS: Record<string, number> = { ncep_gfs_seamless: Infinity, ukmo_seamless: 54 };

/** How much of the clear-sky UV gets through each day's sky. */
const UV_THROUGH: Record<Sky, number> = {
  dry: 1,
  spots: 0.9,
  showers: 0.75,
  rain: 0.5,
  wet: 0.35,
  heavy: 0.3,
};

/**
 * The UV index averaged over the hour before a moment (as Open-Meteo labels it): clear-sky UV
 * from the sun's height (about 12.5 overhead, falling off steeply as it drops), taken off by
 * cloud. Worked out at the middle of the hour.
 */
function syntheticUv(cell: string, lat: number, lon: number, end: number, id: string): number {
  const mid = new Date(end - 1_800_000);
  const start = Date.UTC(mid.getUTCFullYear(), 0, 1);
  const dayOfYear = (mid.getTime() - start) / 86_400_000;
  const rad = Math.PI / 180;
  const declination = 23.44 * Math.sin((2 * Math.PI * (dayOfYear - 80)) / 365) * rad;
  const solarHour = mid.getUTCHours() + mid.getUTCMinutes() / 60 + lon / 15;
  const hourAngle = (solarHour - 12) * 15 * rad;
  const sunHeight =
    Math.sin(lat * rad) * Math.sin(declination) +
    Math.cos(lat * rad) * Math.cos(declination) * Math.cos(hourAngle);
  if (sunHeight <= 0) return 0;
  const date = mid.toISOString().slice(0, 10);
  const through = UV_THROUGH[syntheticSky(cell, date)];
  return r2(12.5 * sunHeight ** 2.4 * through * between(`${cell}|${date}|${id}|uv`, 0.9, 1.1));
}

type Wind = 'calm' | 'breezy' | 'windy' | 'verywindy' | 'gale' | 'storm';

/**
 * Each place's wind runs through this ten-day cycle (from a point of its own, apart from its
 * skies), each day with a chance of turning into its alternative, so a week holds light and
 * windy days and now and then a gale. Places from SNOWY_FROM_LAT (Reykjavik is the one city page
 * there) have a storm every day of the year, so end-to-end tests can show one in any month.
 */
const WINDS: ReadonlyArray<readonly [Wind, Wind, number]> = [
  ['calm', 'calm', 0],
  ['breezy', 'calm', 0.3],
  ['windy', 'breezy', 0.3],
  ['verywindy', 'windy', 0.3],
  ['gale', 'verywindy', 0.35],
  ['windy', 'breezy', 0.3],
  ['breezy', 'breezy', 0],
  ['calm', 'breezy', 0.3],
  ['breezy', 'windy', 0.3],
  ['windy', 'windy', 0],
];

/** A typical model's strongest mean wind and gust of each kind of day, km/h (mid-band). */
const WIND_PEAKS: Record<Wind, readonly [number, number]> = {
  calm: [8, 18],
  breezy: [15, 40],
  windy: [24, 56],
  verywindy: [30, 72],
  gale: [45, 95],
  storm: [70, 130],
};

function syntheticWind(cell: string, lat: number, date: string): Wind {
  if (Math.abs(lat) >= SNOWY_FROM_LAT) return 'storm';
  const day = Math.round(parseDate(date) / 86_400_000) + Math.floor(unit(`${cell}|wind`) * 10);
  const [wind, alternative, chance] = WINDS[day % WINDS.length]!;
  return unit(`${cell}|${day}|wind turn`) < chance ? alternative : wind;
}

/**
 * One model's mean wind and gust in each hour of a local day, km/h: strongest in the afternoon
 * and about 60% of that at night (a storm blows as hard all day and night), each model a little
 * stronger or lighter than the others.
 */
function syntheticWindHours(
  cell: string,
  lat: number,
  date: string,
  id: string,
): { wind: number[]; gust: number[] } {
  const kind = syntheticWind(cell, lat, date);
  const [mean, gust] = WIND_PEAKS[kind];
  const jitter = between(`${cell}|${date}|${id}|wind`, 0.85, 1.15);
  const peak = 13 + Math.floor(unit(`${cell}|${date}|wind peak`) * 3);
  const swing = kind === 'storm' ? 0 : 0.4;
  const shape = (h: number) =>
    1 - swing + swing * ((Math.cos(((h - peak) / 24) * 2 * Math.PI) + 1) / 2);
  return {
    wind: Array.from({ length: 24 }, (_, h) => r1(mean * jitter * shape(h))),
    gust: Array.from({ length: 24 }, (_, h) => r1(gust * jitter * shape(h))),
  };
}

/**
 * Normal wind at 10m, m/s by month: strongest in the mid-latitude storm tracks and over the
 * Arctic, lightest in the tropics, and windiest in each hemisphere's winter.
 */
export function syntheticWindNormals(lat: number): number[] {
  const a = Math.abs(lat);
  const base = a >= SNOWY_FROM_LAT ? 8 : 3 + 2.5 * Math.exp(-(((a - 55) / 15) ** 2));
  const windiest = lat >= 0 ? 0 : 6;
  return Array.from({ length: 12 }, (_, m) =>
    r2(base * (1 + 0.15 * Math.cos((2 * Math.PI * (m - windiest)) / 12))),
  );
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

/**
 * A forecast in Open-Meteo's format. With `elevation` it is said to be for that height (the
 * temperatures are the same either way); without, for a terrain height of 50 m.
 */
export function syntheticForecast(
  lat: number,
  lon: number,
  modelIds: string[],
  now: Date,
  elevation: number | null = null,
) {
  const cell = `${roundToGrid(lat, 0.05)},${roundToGrid(lon, 0.05)}`;
  const timezone = syntheticTimezone(lat, lon);
  const today = localDate(timezone, now);
  const dates = Array.from({ length: FORECAST.days }, (_, i) => addDays(today, i));
  const normals = syntheticNormals(lat);
  const offset = zoneOffsetSeconds(timezone, now);

  const hourly: Record<string, unknown[]> = {
    time: dates.flatMap((d) =>
      Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`),
    ),
  };

  for (const id of modelIds) {
    const temps: Array<number | null> = [];
    const apparent: Array<number | null> = [];
    for (const date of dates) {
      const base =
        normalForDate(normals, date) + between(`${cell}|${date}`, -4, 5) - chill(cell, lat, date);
      const outlier =
        unit(`${cell}|${date}|${id}|outlier`) < 0.12 ? between(`${id}${date}`, 3, 4.5) : 0;
      let high = r1(base + between(`${cell}|${date}|${id}`, -1.5, 1.5) + outlier);
      if (Math.abs(lat) >= SNOWY_FROM_LAT) {
        high = Math.min(high, r1(between(`${cell}|${date}|${id}|freezing`, -6, -2)));
      }
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
    // Wind speed is instant, at its stamp; a gust is labelled with the end of the hour it is the
    // strongest of, so the first stamp carries the last hour of the day before, as precipitation.
    const winds = dates.map((date) => syntheticWindHours(cell, lat, date, id));
    const wind: Array<number | null> = winds.flatMap((w) => w.wind);
    const gust: Array<number | null> = [
      syntheticWindHours(cell, lat, addDays(today, -1), id).gust[23]!,
      ...winds.flatMap((w) => w.gust),
    ].slice(0, temps.length);
    const horizon = HORIZON_HOURS[id] ?? Infinity;
    temps.forEach((_, i) => {
      if (i >= horizon) temps[i] = apparent[i] = precipitation[i] = wind[i] = gust[i] = null;
    });
    // Snowfall as depth, with the temperature at the end of the hour, as Open-Meteo labels both.
    const snowfall = precipitation.map((mm, i) =>
      mm === null ? null : r2(mm * snowShare(temps[i]!) * SNOW.cmPerMm),
    );
    hourly[`temperature_2m_${id}`] = temps;
    hourly[`apparent_temperature_${id}`] = apparent;
    hourly[`precipitation_${id}`] = precipitation;
    hourly[`snowfall_${id}`] = snowfall;
    const uvHorizon = UV_HORIZON_HOURS[id] ?? -1;
    hourly[`uv_index_${id}`] = (hourly.time as string[]).map((stamp, i) =>
      i < uvHorizon
        ? syntheticUv(cell, lat, lon, Date.parse(`${stamp}Z`) - offset * 1000, id)
        : null,
    );
    hourly[`wind_speed_10m_${id}`] = wind;
    hourly[`wind_gusts_10m_${id}`] = gust;
  }

  return {
    latitude: lat,
    longitude: lon,
    generationtime_ms: 0.5,
    utc_offset_seconds: offset,
    timezone,
    timezone_abbreviation: 'GMT',
    elevation: elevation ?? 50,
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

/** Normal snowfall in NASA POWER's format: PRECSNOLAND, mm/day, with the cell's height. */
export function syntheticSnowClimatology(lat: number, lon: number) {
  const normals = syntheticSnowNormals(lat);
  const PRECSNOLAND: Record<string, number> = {};
  MONTHS.forEach((k, i) => {
    PRECSNOLAND[k] = normals[i] as number;
  });
  PRECSNOLAND.ANN = r2(normals.reduce((a, b) => a + b, 0) / 12);
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat, 50] },
    properties: { parameter: { PRECSNOLAND } },
    header: { title: 'NASA/POWER synthetic climatology', fill_value: -999 },
    messages: [],
    parameters: { PRECSNOLAND: { units: 'mm/day', longname: 'Snow Precipitation Land' } },
    times: { data: 0, process: 0 },
  };
}

/** Normal wind in NASA POWER's format: WS10M, m/s, with the cell's height. */
export function syntheticWindClimatology(lat: number, lon: number) {
  const normals = syntheticWindNormals(lat);
  const WS10M: Record<string, number> = {};
  MONTHS.forEach((k, i) => {
    WS10M[k] = normals[i] as number;
  });
  WS10M.ANN = r2(normals.reduce((a, b) => a + b, 0) / 12);
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat, 50] },
    properties: { parameter: { WS10M } },
    header: { title: 'NASA/POWER synthetic climatology', fill_value: -999 },
    messages: [],
    parameters: { WS10M: { units: 'm/s', longname: 'Wind Speed at 10 Meters' } },
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
      const elevation = p.get('elevation');
      return json(
        syntheticForecast(
          Number(p.get('latitude')),
          Number(p.get('longitude')),
          ids,
          now(),
          elevation === null ? null : Number(elevation),
        ),
      );
    }
    if (url.pathname.endsWith('/search')) {
      return json(syntheticSearch(p.get('name') ?? '', Number(p.get('count') ?? 8), places));
    }
    if (url.pathname.includes('/climatology/')) {
      const parameters = p.get('parameters')?.split(',') ?? [];
      const climatology = parameters.includes('PRECTOTCORR')
        ? syntheticRainClimatology
        : parameters.includes('PRECSNOLAND')
          ? syntheticSnowClimatology
          : parameters.includes('WS10M')
            ? syntheticWindClimatology
            : syntheticClimatology;
      return json(climatology(Number(p.get('latitude')), Number(p.get('longitude'))));
    }
    return new Response('Not found', { status: 404 });
  };
}
