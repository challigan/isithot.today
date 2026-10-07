import { describe, expect, it } from 'vitest';
import { MODELS } from '@isithot/core';
import {
  OPEN_METEO_FREE,
  NASA_POWER_URL,
  createSyntheticFetch,
  fetchClimateNormals,
  fetchForecast,
  searchPlaces,
  syntheticTimezone,
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

  it('produces normals and search results', async () => {
    const normals = await fetchClimateNormals(
      { url: NASA_POWER_URL, fetch: fetcher },
      { lat: -33.9, lon: 151.2 },
    );
    expect(normals[0]!).toBeGreaterThan(normals[6]!);
    const places = await searchPlaces({ ...OPEN_METEO_FREE, fetch: fetcher }, 'newc', 8);
    expect(places[0]!.name).toBe('Newcastle');
    expect(await searchPlaces({ ...OPEN_METEO_FREE, fetch: fetcher }, 'zzzz', 8)).toEqual([]);
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
