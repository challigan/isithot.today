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
    expect(url.searchParams.get('forecast_days')).toBe('2');
    expect(url.searchParams.get('daily')).toBe('temperature_2m_max,apparent_temperature_max');
    expect(url.searchParams.get('hourly')).toBe('temperature_2m');
    expect(url.searchParams.get('models')!.split(',')).toEqual(MODELS.map((m) => m.id));
    expect(url.searchParams.has('apikey')).toBe(false);
  });

  it('adds the key for the paid customer host', () => {
    const url = new URL(
      buildForecastUrl({ ...OPEN_METEO_CUSTOMER, apiKey: 'k3y' }, { lat: 1, lon: 2 }, MODELS),
    );
    expect(url.host).toBe('customer-api.open-meteo.com');
    expect(url.searchParams.get('apikey')).toBe('k3y');
  });

  it.each(['open-meteo-forecast-newcastle.json', 'open-meteo-forecast-seville.json'])(
    'parses the recorded response %s',
    (name) => {
      const raw = fixture(name);
      const f = parseForecast(raw, MODELS);
      expect(f.timezone).toBe(raw.timezone);
      expect(f.days.map((d) => d.date)).toEqual(raw.daily.time);
      for (const [dayIndex, day] of f.days.entries()) {
        expect(day.models).toHaveLength(MODELS.length);
        for (const m of day.models) {
          const high = raw.daily[`temperature_2m_max_${m.id}`]?.[dayIndex] ?? null;
          expect(m.high).toBe(high);
        }
        expect(day.hourly).toHaveLength(24);
        expect(day.hourly[0]!.hour).toBe(0);
        expect(day.hourly[23]!.hour).toBe(23);
        expect(day.hourly[14]!.temps).toHaveLength(MODELS.length);
      }
    },
  );

  it('reads renamed models by alias and drops nulls to null', () => {
    const models: ModelConfig[] = [
      { id: 'ncep_gfs_seamless', name: 'GFS', aliases: ['gfs_seamless'] },
      { id: 'jma_seamless', name: 'JMA' },
    ];
    const f = parseForecast(
      {
        timezone: 'Europe/London',
        latitude: 54.95,
        longitude: -1.6,
        daily: {
          time: ['2026-10-06'],
          temperature_2m_max_gfs_seamless: [11.2],
          apparent_temperature_max_gfs_seamless: [8.1],
          temperature_2m_max_jma_seamless: [null],
        },
        hourly: {
          time: ['2026-10-06T13:00', '2026-10-06T14:00', '2026-10-07T00:00'],
          temperature_2m_gfs_seamless: [10, 11, 6],
        },
      },
      models,
    );
    expect(f.days[0]!.models).toEqual([
      { id: 'ncep_gfs_seamless', name: 'GFS', high: 11.2, feelsLike: 8.1 },
      { id: 'jma_seamless', name: 'JMA', high: null, feelsLike: null },
    ]);
    expect(f.days[0]!.hourly).toEqual([
      { hour: 13, temps: [10, null] },
      { hour: 14, temps: [11, null] },
    ]);
  });

  it('reads unsuffixed keys when a single model is requested', () => {
    const f = parseForecast(
      {
        timezone: 'UTC',
        latitude: 'x',
        daily: { time: ['2026-10-06'], temperature_2m_max: [20], apparent_temperature_max: [21] },
      },
      [{ id: 'ecmwf_ifs025', name: 'ECMWF' }],
    );
    expect(f.days[0]!.models[0]).toMatchObject({ high: 20, feelsLike: 21 });
    expect(f.days[0]!.hourly).toEqual([]);
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
