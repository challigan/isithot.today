import { describe, expect, it } from 'vitest';
import { MODELS, RAIN, SNOW, type ModelDay } from '@isithot/core';
import {
  OPEN_METEO_FREE,
  NASA_POWER_URL,
  createSyntheticFetch,
  fetchClimateNormals,
  fetchForecast,
  fetchRainNormals,
  fetchSnowNormals,
  searchPlaces,
  syntheticForecast,
  syntheticSnowNormals,
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
    expect(f.days[0]!.models.map((m) => m.high)).toEqual([
      12, 16.5, 14.3, 12.6, 13.9, 13.2, 13.5, 14,
    ]);
    expect(f.days[0]!.hourly[14]).toMatchObject({
      temps: [11.9, 16.4, 14.2, 12.5, 13.8, 13.1, 13.4, 13.9],
      feels: [9.9, 14.4, 12.2, 10.5, 11.8, 11.1, 11.4, 11.9],
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

  it("stops Météo-France's rain at its horizon, as its temperatures do", async () => {
    const f = await week(54.95, -1.6, '2026-10-06T08:00:00Z');
    const i = MODELS.findIndex((m) => m.id === 'meteofrance_seamless');
    expect(f.days.map((d) => d.models[i]!.rain === null)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
    // Every other model covers the whole week, the last day with its 23 hours.
    expect(f.days.map((d) => totals(d.models).length)).toEqual([8, 8, 8, 8, 7, 7, 7]);
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
