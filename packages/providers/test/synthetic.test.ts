import { describe, expect, it } from 'vitest';
import {
  MODELS,
  RAIN,
  SNOW,
  computeWindDay,
  windSeries,
  type ModelDay,
  type WindBand,
} from '@isithot/core';
import {
  OPEN_METEO_FREE,
  NASA_POWER_URL,
  createSyntheticFetch,
  fetchClimateNormals,
  fetchForecast,
  fetchRainNormals,
  fetchSnowNormals,
  fetchWindNormals,
  searchPlaces,
  syntheticForecast,
  syntheticSnowNormals,
  syntheticWindNormals,
  syntheticTimezone,
  zoneOffsetSeconds,
} from '../src';
import cities from '../../../data/cities.json';

const fetcher = createSyntheticFetch(cities, () => new Date('2026-10-06T08:00:00Z'));

describe('synthetic data source', () => {
  it('produces a parseable forecast in the Open-Meteo format', async () => {
    const f = await fetchForecast(
      { ...OPEN_METEO_FREE, fetch: fetcher },
      { lat: 54.95, lon: -1.6 },
      MODELS,
    );
    expect(f.timezone).toBe('Europe/London');
    expect(f.days.map((d) => d.date)).toEqual([
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
    ]);
    expect(f.days[0]!.models.every((m) => typeof m.high === 'number')).toBe(true);
    const hour = f.days[0]!.hourly[14]!;
    expect(hour.feels).toHaveLength(MODELS.length);
    expect(hour.feels!.every((v) => typeof v === 'number')).toBe(true);
  });

  it('keeps the temperatures the end-to-end tests were drawn with', async () => {
    const f = await fetchForecast(
      { ...OPEN_METEO_FREE, fetch: fetcher },
      { lat: 54.95, lon: -1.6 },
      MODELS,
    );
    // Each model's own, as with eight models (MET Norway's and JMA's left out).
    expect(f.days[0]!.models.map((m) => m.high)).toEqual([12, 16.5, 14.3, 12.6, 13.9, 13.5]);
    expect(f.days[0]!.hourly[14]).toMatchObject({
      temps: [11.9, 16.4, 14.2, 12.5, 13.8, 13.4],
      feels: [9.9, 14.4, 12.2, 10.5, 11.8, 11.4],
    });
  });

  /** The synthetic forecast for a place as the server would see it on a date. */
  const week = (lat: number, lon: number, iso: string) =>
    fetchForecast(
      { ...OPEN_METEO_FREE, fetch: createSyntheticFetch(cities, () => new Date(iso)) },
      { lat, lon },
      MODELS,
    );
  const totals = (models: readonly ModelDay[]) =>
    models.flatMap((m) => (typeof m.rain === 'number' ? [m.rain] : []));
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length / 2;
    return sorted.length % 2 ? sorted[Math.floor(mid)]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };

  it('has a dry day and a rainy one in every week', async () => {
    for (const [lat, lon] of [
      [51.5, -0.15],
      [54.95, -1.6],
      [52.5, -1.9],
    ] as const) {
      for (let d = 0; d < 21; d++) {
        const f = await week(lat, lon, new Date(Date.UTC(2026, 9, 1 + d, 8)).toISOString());
        // Whole days only: today's rain may already have fallen.
        const days = f.days.slice(1).map((day) => totals(day.models));
        expect(days.some((t) => t.every((v) => v < RAIN.day.spots))).toBe(true);
        expect(
          days.some((t) => t.filter((v) => v >= RAIN.day.wet).length >= RAIN.likelyFrom * t.length),
        ).toBe(true);
      }
    }
  });

  it('varies the rain from day to day and between models', async () => {
    const days = [];
    for (let d = 0; d < 35; d += 7) {
      const f = await week(51.5, -0.15, new Date(Date.UTC(2026, 9, 6 + d, 8)).toISOString());
      days.push(...f.days);
    }
    const share = (t: number[]) => t.filter((v) => v >= RAIN.day.wet).length / t.length;
    const kinds = days.map((day) => {
      const t = totals(day.models);
      if (share(t) >= RAIN.likelyFrom) return median(t) >= RAIN.day.heavy ? 'heavy' : 'rain';
      return share(t) >= RAIN.maybeFrom ? 'showers' : 'dry';
    });
    expect(new Set(kinds)).toEqual(new Set(['dry', 'showers', 'rain', 'heavy']));
    // Models disagree on how much falls, and when it starts.
    const wet = days.filter((day) => share(totals(day.models)) >= RAIN.likelyFrom);
    for (const day of wet) {
      const t = totals(day.models);
      expect(Math.max(...t) - Math.min(...t)).toBeGreaterThan(0.5);
    }
    const starts = wet.map(
      (day) => new Set(MODELS.map((_, i) => day.hourly.findIndex((h) => (h.rain?.[i] ?? 0) > 0))),
    );
    expect(starts.some((s) => s.size > 1)).toBe(true);
  });

  it("stops Météo-France's rain and wind at its horizon, as its temperatures do", async () => {
    const f = await week(54.95, -1.6, '2026-10-06T08:00:00Z');
    const i = MODELS.findIndex((m) => m.id === 'meteofrance_seamless');
    const stops = [false, false, false, false, true, true, true];
    expect(f.days.map((d) => d.models[i]!.rain === null)).toEqual(stops);
    expect(f.days.map((d) => d.models[i]!.gust === null)).toEqual(stops);
    // Every other model covers the whole week, the last day with its 23 hours.
    expect(f.days.map((d) => totals(d.models).length)).toEqual([6, 6, 6, 6, 5, 5, 5]);
    expect(f.days.map((d) => d.models.filter((m) => m.gust !== null).length)).toEqual([
      6, 6, 6, 6, 5, 5, 5,
    ]);
  });

  /** The wind band of each whole day of the week from a date, as the server judges it. */
  const windWeek = async (lat: number, lon: number, iso: string): Promise<WindBand[]> =>
    (await week(lat, lon, iso)).days.slice(1).map((d) => computeWindDay(d)!.band);

  it('blows from calm to gales over the weeks, for every model a little differently', async () => {
    const bands = new Set<WindBand>();
    for (let d = 0; d < 35; d += 7) {
      const iso = new Date(Date.UTC(2026, 9, 6 + d, 8)).toISOString();
      for (const band of await windWeek(51.5, -0.15, iso)) bands.add(band);
    }
    expect(bands).toEqual(new Set(['calm', 'breezy', 'windy', 'verywindy', 'gale']));
    // Gusts are stronger than the mean wind, and strongest in the afternoon.
    const f = await week(51.5, -0.15, '2026-10-06T08:00:00Z');
    for (const h of f.days.flatMap((d) => d.hourly)) {
      h.wind!.forEach((w, i) => {
        if (w !== null && h.gust![i] !== null) expect(h.gust![i]!).toBeGreaterThan(w);
      });
    }
    const day = f.days[1]!;
    expect(day.hourly[3]!.gust![0]!).toBeLessThan(day.hourly[14]!.gust![0]!);
    expect(new Set(day.models.map((m) => m.gust)).size).toBeGreaterThan(1);
    // The Now view has every hour of the first three days.
    expect(windSeries(f.days.slice(0, 3)).length).toBe(72);
  });

  it('has a storm in Reykjavik every hour of the year, for the end-to-end tests', async () => {
    for (const iso of ['2026-07-10T08:00:00Z', '2026-10-10T08:00:00Z', '2027-01-10T08:00:00Z']) {
      expect(new Set(await windWeek(64.15, -21.95, iso))).toEqual(new Set(['storm']));
      const f = await week(64.15, -21.95, iso);
      expect(new Set(windSeries(f.days).map((p) => p.band))).toEqual(new Set(['storm']));
    }
  });

  it('labels each gust with the end of its hour, as Open-Meteo does', () => {
    const raw = syntheticForecast(51.5, -0.15, ['ecmwf_ifs025'], new Date('2026-10-06T08:00Z'));
    const wind = raw.hourly.wind_speed_10m_ecmwf_ifs025 as number[];
    const gust = raw.hourly.wind_gusts_10m_ecmwf_ifs025 as number[];
    expect([wind.length, gust.length]).toEqual([168, 168]);
    // The gust for the hour from stamp t is at stamp t + 1, so it keeps its own day's ratio to
    // the wind at stamp t, the first hour after midnight too (the two days differ here).
    const ratio = (t: number) => gust[t + 1]! / wind[t]!;
    const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.1);
    for (const t of [0, 12, 23]) near(ratio(t), ratio(1));
    for (const t of [24, 30, 40]) near(ratio(t), ratio(25));
    expect(Math.abs(ratio(1) - ratio(25))).toBeGreaterThan(0.2);
  });

  it('snows only where it is cold', async () => {
    const north = await week(69.65, 18.95, '2026-01-20T08:00:00Z');
    const snow = north.days.flatMap((d) => d.models.map((m) => m.snow ?? 0));
    expect(snow.some((v) => v > 1)).toBe(true);
    for (const day of north.days) {
      for (const m of day.models) expect(m.snow ?? 0).toBeLessThanOrEqual(m.rain ?? 0);
    }
    const tropics = await week(1.3, 103.85, '2026-01-20T08:00:00Z');
    expect(tropics.days.flatMap((d) => totals(d.models)).some((v) => v > 0)).toBe(true);
    expect(tropics.days.every((d) => d.models.every((m) => (m.snow ?? 0) === 0))).toBe(true);
  });

  it('gives snowfall as depth, never more than the precipitation as water', () => {
    const raw = syntheticForecast(64.15, -21.95, ['ecmwf_ifs025'], new Date('2026-07-10T08:00Z'));
    const precipitation = raw.hourly.precipitation_ecmwf_ifs025 as (number | null)[];
    const snowfall = raw.hourly.snowfall_ecmwf_ifs025 as (number | null)[];
    expect(snowfall).toHaveLength(precipitation.length);
    snowfall.forEach((cm, i) => {
      expect(cm).toBeCloseTo(precipitation[i]! * SNOW.cmPerMm, 2);
    });
  });

  it('snows in Reykjavik in any month, for the end-to-end tests', async () => {
    for (const iso of ['2026-07-10T08:00:00Z', '2026-10-10T08:00:00Z', '2027-01-10T08:00:00Z']) {
      const f = await week(64.15, -21.95, iso);
      expect(f.days.every((d) => d.models.every((m) => m.high === null || m.high <= -2))).toBe(
        true,
      );
      const snowy = f.days.filter(
        (d) =>
          d.models.filter((m) => (m.snowfall ?? 0) >= SNOW.day.snow).length >=
          SNOW.likelyFrom * MODELS.length,
      );
      expect(snowy.length).toBeGreaterThan(0);
    }
  });

  it('brings cold spells, and snow, to winters beyond 45°', async () => {
    const snowIn = async (iso: string) => {
      let total = 0;
      for (let d = 0; d < 28; d += 7) {
        const date = new Date(Date.parse(iso) + d * 86_400_000).toISOString();
        const f = await week(55.75, 37.6, date);
        for (const day of f.days) for (const m of day.models) total += m.snowfall ?? 0;
      }
      return total;
    };
    expect(await snowIn('2027-01-04T08:00:00Z')).toBeGreaterThan(10);
    expect(await snowIn('2026-07-06T08:00:00Z')).toBe(0);
  });

  it('gives a UV index from the two models that have one, highest around midday', async () => {
    const f = await week(37.4, -6, '2027-06-20T08:00:00Z');
    const gfs = MODELS.findIndex((m) => m.id === 'ncep_gfs_seamless');
    const ukmo = MODELS.findIndex((m) => m.id === 'ukmo_seamless');
    const hours = f.days.flatMap((d) => d.hourly);
    for (const [k, h] of hours.entries()) {
      for (const [i, v] of h.uv!.entries()) {
        // The regional model's 54 hours, less the first stamp's (the hour before the forecast).
        if (i === gfs && k < hours.length - 1) expect(v).toBeTypeOf('number');
        else if (i === ukmo && k < 53) expect(v).toBeTypeOf('number');
        else expect(v).toBeNull();
      }
    }
    const day = f.days[0]!.hourly;
    // Nothing at night; a Seville summer midday is high or more.
    expect(day[2]!.uv![gfs]).toBe(0);
    expect(day[22]!.uv![gfs]).toBe(0);
    const peak = Math.max(...day.map((h) => h.uv![gfs]!));
    expect(peak).toBeGreaterThanOrEqual(6);
    expect(day.findIndex((h) => h.uv![gfs] === peak)).toBeGreaterThanOrEqual(11);
    expect(day.findIndex((h) => h.uv![gfs] === peak)).toBeLessThanOrEqual(13);
    // A Newcastle winter's day barely gets going; Reykjavik's rounds to nothing.
    const winter = await week(54.95, -1.6, '2026-12-21T08:00:00Z');
    expect(Math.max(...winter.days[0]!.hourly.map((h) => h.uv![gfs]!))).toBeLessThan(1);
    const arctic = await week(64.15, -21.95, '2026-12-21T08:00:00Z');
    expect(Math.max(...arctic.days[0]!.hourly.map((h) => h.uv![gfs]!))).toBeLessThan(0.5);
  });

  it('says the forecast is for the height asked for, with the same temperatures', async () => {
    const at = (elevation: number | null) =>
      fetchForecast(
        { ...OPEN_METEO_FREE, fetch: fetcher },
        { lat: 46.6, lon: 8.05 },
        MODELS,
        elevation,
      );
    const [terrain, high] = await Promise.all([at(null), at(1050)]);
    expect(terrain.elevation).toBe(50);
    expect(high.elevation).toBe(1050);
    expect(high.days[0]!.models).toEqual(terrain.days[0]!.models);
    expect(syntheticForecast(46.6, 8.05, ['a'], new Date(), -400).elevation).toBe(-400);
  });

  it('produces normals and search results', async () => {
    const normals = await fetchClimateNormals(
      { url: NASA_POWER_URL, fetch: fetcher },
      { lat: -33.9, lon: 151.2 },
    );
    expect(normals[0]!).toBeGreaterThan(normals[6]!);
    // Normal rainfall comes from its own request: mm/day, wettest in each hemisphere's autumn.
    const london = await fetchRainNormals(
      { url: NASA_POWER_URL, fetch: fetcher },
      { lat: 51.5, lon: 0 },
    );
    expect(london.every((v) => v >= 1 && v <= 5)).toBe(true);
    expect(london[10]!).toBeGreaterThan(london[5]!);
    const sydney = await fetchRainNormals(
      { url: NASA_POWER_URL, fetch: fetcher },
      { lat: -33.9, lon: 151.2 },
    );
    expect(sydney[4]!).toBeGreaterThan(sydney[10]!);
    // Normal snowfall: all of it where it is always freezing, none in the tropics.
    const snow = await fetchSnowNormals(
      { url: NASA_POWER_URL, fetch: fetcher },
      { lat: 64, lon: -21.875 },
    );
    expect(snow.height).toBe(50);
    expect(snow.normals.every((v) => v > 0)).toBe(true);
    expect(syntheticSnowNormals(1.3).every((v) => v === 0)).toBe(true);
    const moscow = syntheticSnowNormals(55.75);
    expect(moscow[0]!).toBeGreaterThan(0);
    expect(moscow[6]!).toBe(0);
    expect(syntheticSnowNormals(-55)[6]!).toBeGreaterThan(0);
    // Normal wind, m/s: strongest in the storm tracks, in each hemisphere's winter.
    const wind = await fetchWindNormals(
      { url: NASA_POWER_URL, fetch: fetcher },
      { lat: 55, lon: -1.875 },
    );
    expect(wind.height).toBe(50);
    expect(wind.normals.every((v) => v > 3 && v < 8)).toBe(true);
    expect(wind.normals[0]!).toBeGreaterThan(wind.normals[6]!);
    expect(syntheticWindNormals(-45)[6]!).toBeGreaterThan(syntheticWindNormals(-45)[0]!);
    expect(syntheticWindNormals(1.5)[0]!).toBeLessThan(wind.normals[0]!);
    expect(syntheticWindNormals(64)[0]!).toBeGreaterThan(wind.normals[0]!);
    const places = await searchPlaces({ ...OPEN_METEO_FREE, fetch: fetcher }, 'newc', 8);
    expect(places[0]!.name).toBe('Newcastle');
    expect(await searchPlaces({ ...OPEN_METEO_FREE, fetch: fetcher }, 'zzzz', 8)).toEqual([]);
  });

  it('gives whole-minute zone offsets whatever the seconds', () => {
    expect(zoneOffsetSeconds('Europe/London', new Date('2026-10-06T08:00:45.500Z'))).toBe(3600);
    expect(zoneOffsetSeconds('Asia/Kolkata', new Date('2026-10-06T08:00:59Z'))).toBe(19800);
    expect(zoneOffsetSeconds('UTC', new Date('2026-10-06T08:00:31Z'))).toBe(0);
  });

  it('guesses a time zone from longitude', () => {
    expect(syntheticTimezone(40.7, -74)).toBe('Etc/GMT+5');
    expect(syntheticTimezone(35.7, 139.7)).toBe('Etc/GMT-9');
    expect(syntheticTimezone(5, 2)).toBe('UTC');
  });

  it('404s anything else', async () => {
    expect((await fetcher('https://example.com/other')).status).toBe(404);
  });
});
