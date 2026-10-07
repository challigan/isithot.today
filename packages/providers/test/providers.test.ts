import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MODELS, type ModelConfig } from '@isithot/core';
import {
  NASA_POWER_URL,
  OPEN_METEO_CUSTOMER,
  OPEN_METEO_FREE,
  ProviderError,
  buildClimatologyUrl,
  buildForecastUrl,
  buildSearchUrl,
  forecastSignature,
  fetchClimateNormals,
  fetchForecast,
  parseClimatology,
  parseForecast,
  parseSearch,
  searchPlaces,
} from '../src';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recorded JSON fixtures
const fixture = (name: string): Record<string, any> =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const jsonFetch =
  (body: unknown, status = 200) =>
  async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Open-Meteo forecast', () => {
  it('builds one request for all models', () => {
    const url = new URL(buildForecastUrl(OPEN_METEO_FREE, { lat: 54.95, lon: -1.6 }, MODELS));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('latitude')).toBe('54.95');
    expect(url.searchParams.get('longitude')).toBe('-1.6');
    expect(url.searchParams.get('timezone')).toBe('auto');
    expect(url.searchParams.get('forecast_days')).toBe('7');
    // Daily highs are worked out from the hourly values, which halves the quota used.
    expect(url.searchParams.has('daily')).toBe(false);
    expect(url.searchParams.get('hourly')).toBe('temperature_2m,apparent_temperature');
    expect(url.searchParams.get('models')!.split(',')).toEqual(MODELS.map((m) => m.id));
    expect(url.searchParams.has('apikey')).toBe(false);
  });

  it('pins the request so a change has to bump the cache version', () => {
    expect(forecastSignature()).toBe(
      'v2 forecast_days=7 hourly=temperature_2m,apparent_temperature',
    );
  });

  it('adds the key for the paid customer host', () => {
    const url = new URL(
      buildForecastUrl({ ...OPEN_METEO_CUSTOMER, apiKey: 'k3y' }, { lat: 1, lon: 2 }, MODELS),
    );
    expect(url.host).toBe('customer-api.open-meteo.com');
    expect(url.searchParams.get('apikey')).toBe('k3y');
  });

  it.each([
    'open-meteo-forecast-newcastle.json',
    'open-meteo-forecast-seville.json',
    'open-meteo-forecast-newcastle-legacy.json',
    'open-meteo-forecast-seville-legacy.json',
  ])('parses the recorded response %s', (name) => {
    const raw = fixture(name);
    const f = parseForecast(raw, MODELS);
    expect(f.timezone).toBe(raw.timezone);
    expect(f.utcOffsetSeconds).toBe(raw.utc_offset_seconds);
    const dates = [...new Set(raw.hourly.time.map((t: string) => t.slice(0, 10)))];
    expect(f.days.map((d) => d.date)).toEqual(dates);
    const hasFeels = Object.keys(raw.hourly).some((k) => k.startsWith('apparent_temperature_'));
    for (const [dayIndex, day] of f.days.entries()) {
      expect(day.models).toHaveLength(MODELS.length);
      expect(day.hourly).toHaveLength(24);
      expect(day.hourly[0]!.time).toBe(
        Date.parse(`${day.date}T00:00Z`) - raw.utc_offset_seconds * 1000,
      );
      expect(day.hourly[14]!.temps).toHaveLength(MODELS.length);
      // Older recordings also carry Open-Meteo's daily maximum: the highs worked out from
      // the hourly values must match it.
      if (raw.daily) {
        for (const m of day.models) {
          expect(m.high).toBe(raw.daily[`temperature_2m_max_${m.id}`]?.[dayIndex] ?? null);
        }
      }
      const withHigh = day.models.filter((m) => m.high !== null).length;
      const withFeels = day.models.filter((m) => m.feelsLike !== null).length;
      if (dayIndex < 2) expect(withHigh).toBeGreaterThanOrEqual(5);
      // The week needs enough models on every day, even as short-range ones drop away.
      expect(withHigh).toBeGreaterThanOrEqual(3);
      if (hasFeels && dayIndex < 2) expect(withFeels).toBeGreaterThanOrEqual(5);
      if (!hasFeels) expect(withFeels).toBe(0);
    }
  });

  /** 24 hourly stamps for a date with values from `value(hour)`. */
  const day = (date: string) =>
    Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, '0')}:00`);
  const curve = (peak: number) => Array.from({ length: 24 }, (_, h) => peak - Math.abs(h - 15));

  it('reads renamed models by alias and works out daily highs from hourly values', () => {
    const models: ModelConfig[] = [
      { id: 'ncep_gfs_seamless', name: 'GFS', aliases: ['gfs_seamless'] },
      { id: 'jma_seamless', name: 'JMA' },
    ];
    const f = parseForecast(
      {
        timezone: 'Europe/London',
        utc_offset_seconds: 3600,
        latitude: 54.95,
        longitude: -1.6,
        hourly: {
          time: [...day('2026-10-06'), '2026-10-07T00:00'],
          temperature_2m_gfs_seamless: [...curve(11.2), 6],
          apparent_temperature_gfs_seamless: [...curve(8.1), 3],
          temperature_2m_jma_seamless: Array.from({ length: 25 }, () => null),
        },
      },
      models,
    );
    expect(f.utcOffsetSeconds).toBe(3600);
    expect(f.days.map((d) => d.date)).toEqual(['2026-10-06', '2026-10-07']);
    expect(f.days[0]!.models).toEqual([
      { id: 'ncep_gfs_seamless', name: 'GFS', high: 11.2, feelsLike: 8.1 },
      { id: 'jma_seamless', name: 'JMA', high: null, feelsLike: null },
    ]);
    expect(f.days[0]!.hourly[15]).toEqual({
      hour: 15,
      time: Date.parse('2026-10-06T14:00:00Z'),
      temps: [11.2, null],
      feels: [8.1, null],
    });
    // One hour of the next day is not a day's high.
    expect(f.days[1]!.models[0]).toMatchObject({ high: null, feelsLike: null });
  });

  it('only counts a day with the whole afternoon covered', () => {
    const temps = curve(20).map((t, h) => (h <= 14 ? t : null));
    const f = parseForecast(
      {
        timezone: 'UTC',
        hourly: { time: day('2026-10-10'), temperature_2m: temps, apparent_temperature: temps },
      },
      [{ id: 'meteofrance_seamless', name: 'Météo-France' }],
    );
    expect(f.days[0]!.models[0]).toMatchObject({ high: null, feelsLike: null });
    expect(f.days[0]!.hourly[10]!.temps).toEqual([15]);
  });

  it('reads unsuffixed keys when a single model is requested', () => {
    const f = parseForecast(
      {
        timezone: 'UTC',
        latitude: 'x',
        hourly: {
          time: day('2026-10-06'),
          temperature_2m: curve(20),
          apparent_temperature: curve(21),
        },
      },
      [{ id: 'ecmwf_ifs025', name: 'ECMWF' }],
    );
    expect(f.days[0]!.models[0]).toMatchObject({ high: 20, feelsLike: 21 });
    expect(f.utcOffsetSeconds).toBe(0);
    expect(Number.isNaN(f.lat)).toBe(true);
  });

  it('rejects an unexpected shape', () => {
    expect(() => parseForecast({ error: true, reason: 'x' }, MODELS)).toThrow(ProviderError);
    expect(() => parseForecast(null, MODELS)).toThrow('unexpected forecast response shape');
  });

  it('fetches and parses', async () => {
    const raw = fixture('open-meteo-forecast-newcastle.json');
    const f = await fetchForecast(
      { ...OPEN_METEO_FREE, fetch: jsonFetch(raw) },
      { lat: 54.95, lon: -1.6 },
      MODELS,
    );
    expect(f.days).toHaveLength(2);
  });

  it('turns HTTP errors into ProviderError with the reason', async () => {
    const err = await fetchForecast(
      { ...OPEN_METEO_FREE, fetch: jsonFetch({ error: true, reason: 'Invalid model' }, 400) },
      { lat: 0, lon: 0 },
      MODELS,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('open-meteo: HTTP 400 Invalid model');
  });

  it('handles non-JSON error bodies, invalid JSON and network failures', async () => {
    const config = { ...OPEN_METEO_FREE };
    const html = async () => new Response('<html>', { status: 502 });
    await expect(
      fetchForecast({ ...config, fetch: html }, { lat: 0, lon: 0 }, MODELS),
    ).rejects.toThrow('open-meteo: HTTP 502');
    const garbage = async () => new Response('not json', { status: 200 });
    await expect(
      fetchForecast({ ...config, fetch: garbage }, { lat: 0, lon: 0 }, MODELS),
    ).rejects.toThrow('invalid JSON');
    const down = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(
      fetchForecast({ ...config, fetch: down }, { lat: 0, lon: 0 }, MODELS),
    ).rejects.toThrow('TypeError: fetch failed');
  });

  it('times out slow upstreams', async () => {
    const slow = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    await expect(
      fetchForecast({ ...OPEN_METEO_FREE, fetch: slow, timeoutMs: 20 }, { lat: 0, lon: 0 }, MODELS),
    ).rejects.toThrow('timed out after 20ms');
  });
});

describe('Open-Meteo geocoding', () => {
  it('builds the search URL', () => {
    const url = new URL(buildSearchUrl(OPEN_METEO_FREE, 'Newcastle', 8));
    expect(url.host).toBe('geocoding-api.open-meteo.com');
    expect(url.searchParams.get('name')).toBe('Newcastle');
    expect(url.searchParams.get('count')).toBe('8');
    expect(url.searchParams.get('language')).toBe('en');
    const paid = new URL(buildSearchUrl({ ...OPEN_METEO_CUSTOMER, apiKey: 'k' }, 'x', 3));
    expect(paid.searchParams.get('apikey')).toBe('k');
  });

  it('parses the recorded search response', () => {
    const raw = fixture('open-meteo-search-newcastle.json');
    const places = parseSearch(raw);
    expect(places.length).toBe(raw.results.length);
    expect(places[0]).toMatchObject({
      geonameId: raw.results[0].id,
      name: raw.results[0].name,
      lat: raw.results[0].latitude,
      lon: raw.results[0].longitude,
      countryCode: raw.results[0].country_code,
    });
  });

  it('returns nothing when there are no results', () => {
    expect(parseSearch(fixture('open-meteo-search-none.json'))).toEqual([]);
  });

  it('skips malformed results and rejects a bad shape', () => {
    expect(
      parseSearch({
        results: [
          { name: 'Nowhere' },
          { name: '', latitude: 1, longitude: 2 },
          {
            id: 'x',
            name: 'Somewhere',
            latitude: 1,
            longitude: 2,
            country_code: 'gb',
            population: 'n',
          },
        ],
      }),
    ).toEqual([
      {
        geonameId: null,
        name: 'Somewhere',
        lat: 1,
        lon: 2,
        countryCode: 'GB',
        country: null,
        admin1: null,
        timezone: null,
        population: null,
      },
    ]);
    expect(() => parseSearch({ results: 'nope' })).toThrow(ProviderError);
  });

  it('searches', async () => {
    const raw = fixture('open-meteo-search-newcastle.json');
    const places = await searchPlaces(
      { ...OPEN_METEO_FREE, fetch: jsonFetch(raw) },
      'Newcastle',
      8,
    );
    expect(places.length).toBeGreaterThan(0);
  });
});

describe('NASA POWER climatology', () => {
  it('builds the climatology URL', () => {
    const url = new URL(buildClimatologyUrl(NASA_POWER_URL, { lat: 55, lon: -1.5 }));
    expect(url.host).toBe('power.larc.nasa.gov');
    expect(url.searchParams.get('parameters')).toBe('T2M,T2M_RANGE');
    expect(url.searchParams.get('latitude')).toBe('55');
    expect(url.searchParams.get('longitude')).toBe('-1.5');
  });

  it('parses the recorded response into 12 monthly normals', () => {
    const raw = fixture('nasa-power-newcastle.json');
    const normals = parseClimatology(raw);
    expect(normals).toHaveLength(12);
    const p = raw.properties.parameter;
    expect(normals[0]).toBeCloseTo(p.T2M.JAN + p.T2M_RANGE.JAN / 2, 2);
    expect(normals[11]).toBeCloseTo(p.T2M.DEC + p.T2M_RANGE.DEC / 2, 2);
  });

  it('rejects fill values and bad shapes', () => {
    const raw = fixture('nasa-power-newcastle.json');
    raw.properties.parameter.T2M.MAR = -999;
    expect(() => parseClimatology(raw)).toThrow('missing monthly values');
    raw.properties.parameter.T2M.MAR = 10;
    raw.properties.parameter.T2M_RANGE.APR = 'x';
    expect(() => parseClimatology(raw)).toThrow('missing monthly values');
    raw.properties.parameter.T2M_RANGE.APR = -999;
    expect(() => parseClimatology(raw)).toThrow('missing monthly values');
    expect(() => parseClimatology({ properties: {} })).toThrow(
      'unexpected climatology response shape',
    );
  });

  it('fetches normals', async () => {
    const raw = fixture('nasa-power-newcastle.json');
    const normals = await fetchClimateNormals(
      { url: NASA_POWER_URL, fetch: jsonFetch(raw) },
      { lat: 55, lon: -1.5 },
    );
    expect(normals).toHaveLength(12);
  });
});
