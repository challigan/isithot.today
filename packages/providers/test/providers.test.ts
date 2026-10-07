import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MODELS, RAIN, type ModelConfig } from '@isithot/core';
import {
  NASA_POWER_URL,
  OPEN_METEO_CUSTOMER,
  OPEN_METEO_FREE,
  ProviderError,
  buildClimatologyUrl,
  buildForecastUrl,
  buildRainClimatologyUrl,
  buildSearchUrl,
  forecastSignature,
  fetchClimateNormals,
  fetchForecast,
  fetchRainNormals,
  parseClimatology,
  parseForecast,
  parseRainClimatology,
  parseSearch,
  searchPlaces,
  syntheticForecast,
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
    expect(url.searchParams.get('hourly')).toBe(
      'temperature_2m,apparent_temperature,precipitation',
    );
    expect(url.searchParams.get('models')!.split(',')).toEqual(MODELS.map((m) => m.id));
    expect(url.searchParams.has('apikey')).toBe(false);
  });

  it('pins the request so a change has to bump the cache version', () => {
    expect(forecastSignature()).toBe(
      'v3 forecast_days=7 hourly=temperature_2m,apparent_temperature,precipitation',
    );
  });

  it('adds the key for the paid customer host', () => {
    const url = new URL(
      buildForecastUrl({ ...OPEN_METEO_CUSTOMER, apiKey: 'k3y' }, { lat: 1, lon: 2 }, MODELS),
    );
    expect(url.host).toBe('customer-api.open-meteo.com');
    expect(url.searchParams.get('apikey')).toBe('k3y');
  });

  /** A recording with hourly precipitation, as the live ones will be once CI re-records them. */
  const synthetic = (lat: number, lon: number) => () =>
    JSON.parse(
      JSON.stringify(
        syntheticForecast(
          lat,
          lon,
          MODELS.map((m) => m.id),
          new Date('2026-10-06T08:00:00Z'),
        ),
      ),
    );

  it.each([
    ...[
      'open-meteo-forecast-newcastle.json',
      'open-meteo-forecast-seville.json',
      'open-meteo-forecast-newcastle-legacy.json',
      'open-meteo-forecast-seville-legacy.json',
    ].map((name) => [name, () => fixture(name)] as const),
    ['synthetic Newcastle', synthetic(54.95, -1.6)] as const,
    ['synthetic Seville', synthetic(37.4, -6)] as const,
  ])('parses the recorded response %s', (_name, load) => {
    const raw = load();
    const f = parseForecast(raw, MODELS);
    expect(f.timezone).toBe(raw.timezone);
    expect(f.utcOffsetSeconds).toBe(raw.utc_offset_seconds);
    const dates = [...new Set(raw.hourly.time.map((t: string) => t.slice(0, 10)))];
    expect(f.days.map((d) => d.date)).toEqual(dates);
    const hasFeels = Object.keys(raw.hourly).some((k) => k.startsWith('apparent_temperature_'));
    const hasRain = Object.keys(raw.hourly).some((k) => k.startsWith('precipitation_'));
    const lastStamp = raw.hourly.time.length - 1;
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
      // A model-day counts only with every hour from 10am to 6pm: models that stop part-way
      // through a day (Météo-France after about four days) must not report a morning "high".
      for (const [i, m] of MODELS.entries()) {
        const temps = raw.hourly[`temperature_2m_${m.id}`] as Array<number | null> | undefined;
        const hours = raw.hourly.time
          .map((t: string, k: number) => [t, temps?.[k] ?? null] as const)
          .filter(([t]: readonly [string]) => t.startsWith(day.date));
        const values = hours.map(([, v]: readonly [string, number | null]) => v);
        const covered = hours
          .filter(
            ([t]: readonly [string]) =>
              Number(t.slice(11, 13)) >= 10 && Number(t.slice(11, 13)) <= 18,
          )
          .every(([, v]: readonly [string, number | null]) => v !== null);
        const finite = values.filter((v: number | null): v is number => v !== null);
        expect(day.models[i]!.high).toBe(covered && finite.length ? Math.max(...finite) : null);

        // Rain in the hour from each stamp is the next stamp's precipitation. A day needs every
        // hour, except that the forecast's very last hour never has a value.
        const precipitation = raw.hourly[`precipitation_${m.id}`] as
          Array<number | null> | undefined;
        const rain: Array<readonly [number, number | null]> = raw.hourly.time.flatMap(
          (t: string, k: number) =>
            t.startsWith(day.date) ? [[k, precipitation?.[k + 1] ?? null]] : [],
        );
        const full = rain.every(([k, v]) => v !== null || k === lastStamp);
        const total = (keep: (k: number) => boolean) =>
          rain.reduce((a, [k, v]) => (keep(k) ? a + (v ?? 0) : a), 0);
        const model = day.models[i]!;
        if (hasRain && full) {
          expect(model.rain).toBeCloseTo(
            total(() => true),
            6,
          );
          const cold = (k: number) => (temps?.[k] ?? Infinity) <= RAIN.snowAtOrBelowC;
          expect(model.snow).toBeCloseTo(total(cold), 6);
        } else {
          expect(model.rain ?? null).toBeNull();
          expect(model.snow ?? null).toBeNull();
        }
      }
      for (const h of day.hourly) {
        if (hasRain) expect(h.rain).toHaveLength(MODELS.length);
        else expect((h.rain ?? []).every((v) => v === null)).toBe(true);
      }
      const withHigh = day.models.filter((m) => m.high !== null).length;
      const withFeels = day.models.filter((m) => m.feelsLike !== null).length;
      const withRain = day.models.filter((m) => typeof m.rain === 'number').length;
      if (dayIndex < 2) expect(withHigh).toBeGreaterThanOrEqual(5);
      // The week needs enough models on every day, even as short-range ones drop away.
      expect(withHigh).toBeGreaterThanOrEqual(3);
      if (hasFeels && dayIndex < 2) expect(withFeels).toBeGreaterThanOrEqual(5);
      if (!hasFeels) expect(withFeels).toBe(0);
      // Likewise for rain, including the last day (which sums 23 hours).
      if (hasRain && dayIndex < 2) expect(withRain).toBeGreaterThanOrEqual(5);
      if (hasRain) expect(withRain).toBeGreaterThanOrEqual(3);
      if (!hasRain) expect(withRain).toBe(0);
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

  const twoDays = [...day('2026-10-06'), ...day('2026-10-07')];
  const ecmwf: ModelConfig[] = [{ id: 'ecmwf_ifs025', name: 'ECMWF' }];
  const tenths = twoDays.map(() => 0.1);

  it('moves precipitation to the start of the hour it fell in', () => {
    // Each stamp's precipitation (k / 10 mm at stamp k) fell in the hour before it.
    const f = parseForecast(
      {
        timezone: 'UTC',
        hourly: {
          time: twoDays,
          temperature_2m: twoDays.map(() => 10),
          precipitation: twoDays.map((_, k) => k / 10),
        },
      },
      ecmwf,
    );
    const [first, last] = f.days;
    // The first stamp's own value fell before the forecast starts, so it is dropped.
    expect(first!.hourly[0]!.rain).toEqual([0.1]);
    // 23:00 takes the next day's 00:00 value.
    expect(first!.hourly[23]!.rain).toEqual([2.4]);
    // Nothing is labelled with the end of the forecast's last hour.
    expect(last!.hourly[23]!.rain).toEqual([null]);
    // Stamps 1 to 24, then 25 to 47.
    expect(first!.models[0]).toMatchObject({ rain: 30, snow: 0 });
    expect(last!.models[0]).toMatchObject({ rain: 82.8, snow: 0 });
  });

  it("only totals rain for a day with every hour, except the forecast's very last", () => {
    const at = (k: number) => tenths.map((v, i) => (i === k ? null : v));
    const f = parseForecast(
      {
        timezone: 'UTC',
        hourly: {
          time: twoDays,
          precipitation_a: tenths,
          // The first stamp is never used.
          precipitation_b: at(0),
          // Rain from 11:00 on the first day is missing.
          precipitation_c: at(12),
          // The last stamp is the rain in the second-to-last hour, which has to be there.
          precipitation_d: at(47),
        },
      },
      ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id.toUpperCase() })),
    );
    // 24 and 23 tenths without float noise; no precipitation at all for E.
    expect(f.days.map((d) => d.models.map((m) => m.rain))).toEqual([
      [2.4, 2.4, null, 2.4, null],
      [2.3, 2.3, 2.3, null, null],
    ]);
    expect(f.days[0]!.models[2]!.snow).toBeNull();
    // One hour of the next day is not a day's rain.
    const short = parseForecast(
      {
        timezone: 'UTC',
        hourly: { time: twoDays.slice(0, 25), precipitation: tenths.slice(0, 25) },
      },
      ecmwf,
    );
    expect(short.days.map((d) => d.models[0]!.rain)).toEqual([2.4, null]);
  });

  it('counts rain in hours at or below the snow line as snow', () => {
    const cold = RAIN.snowAtOrBelowC;
    const temps = twoDays.map((_, k) =>
      k < 6 ? -2 : k === 6 ? cold : k === 7 ? cold + 0.1 : k === 8 ? null : 5,
    );
    const f = parseForecast(
      {
        timezone: 'UTC',
        hourly: { time: twoDays, temperature_2m: temps, precipitation: twoDays.map(() => 1) },
      },
      ecmwf,
    );
    // 00:00 to 06:00 are at or below the line; 07:00 is just above; 08:00 has no temperature.
    expect(f.days[0]!.models[0]).toMatchObject({ rain: 24, snow: 7 });
    expect(f.days[1]!.models[0]).toMatchObject({ rain: 23, snow: 0 });
  });

  it('reads rain by alias, and unsuffixed only for a single model', () => {
    const models: ModelConfig[] = [
      { id: 'ncep_gfs_seamless', name: 'GFS', aliases: ['gfs_seamless'] },
      { id: 'jma_seamless', name: 'JMA' },
    ];
    const f = parseForecast(
      {
        timezone: 'UTC',
        hourly: { time: twoDays, precipitation_gfs_seamless: tenths, precipitation: tenths },
      },
      models,
    );
    expect(f.days[0]!.models.map((m) => m.rain)).toEqual([2.4, null]);
    expect(f.days[0]!.hourly[3]!.rain).toEqual([0.1, null]);
    const single = parseForecast(
      { timezone: 'UTC', hourly: { time: twoDays, precipitation: tenths } },
      ecmwf,
    );
    expect(single.days[0]!.models[0]!.rain).toBe(2.4);
  });

  it('leaves rain out of forecasts recorded without precipitation', () => {
    const f = parseForecast(
      { timezone: 'UTC', hourly: { time: twoDays, temperature_2m: [...curve(20), ...curve(18)] } },
      ecmwf,
    );
    expect(f.days[0]!.models[0]).toEqual({
      id: 'ecmwf_ifs025',
      name: 'ECMWF',
      high: 20,
      feelsLike: null,
    });
    expect(f.days[0]!.models[0]).not.toHaveProperty('rain');
    expect(f.days[0]!.models[0]).not.toHaveProperty('snow');
    expect(f.days.flatMap((d) => d.hourly).some((h) => 'rain' in h)).toBe(false);
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
    const dates = new Set(raw.hourly.time.map((t: string) => t.slice(0, 10)));
    expect(f.days).toHaveLength(dates.size);
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

  it('asks for normal rainfall in a separate request', () => {
    const url = new URL(buildRainClimatologyUrl(NASA_POWER_URL, { lat: 51.5, lon: 0 }));
    expect(url.origin + url.pathname).toBe(NASA_POWER_URL);
    expect(url.searchParams.get('parameters')).toBe('PRECTOTCORR');
    expect(url.searchParams.get('community')).toBe('AG');
    expect(url.searchParams.get('latitude')).toBe('51.5');
    expect(url.searchParams.get('longitude')).toBe('0');
    expect(url.searchParams.get('format')).toBe('JSON');
    // The temperature request, and every normal cached from it, stays exactly as it was.
    expect(buildClimatologyUrl(NASA_POWER_URL, { lat: 51.5, lon: 0 })).toBe(
      `${NASA_POWER_URL}?parameters=T2M%2CT2M_RANGE&community=AG&longitude=0&latitude=51.5&format=JSON`,
    );
  });

  const MONTHS = [
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

  it('parses the recorded rain climatology into 12 monthly rates', () => {
    const raw = fixture('nasa-power-rain-london.json');
    const rates = raw.properties.parameter.PRECTOTCORR;
    expect(parseRainClimatology(raw)).toEqual(MONTHS.map((k) => rates[k]));
    // A month with no rain at all is a real value.
    rates.JUL = 0;
    expect(parseRainClimatology(raw)[6]).toBe(0);
  });

  it('rejects rain fill values and a missing parameter', () => {
    const raw = fixture('nasa-power-rain-london.json');
    const rates = raw.properties.parameter.PRECTOTCORR;
    rates.MAR = -999;
    expect(() => parseRainClimatology(raw)).toThrow('missing monthly values');
    rates.MAR = 'x';
    expect(() => parseRainClimatology(raw)).toThrow('missing monthly values');
    rates.MAR = 1.2;
    delete rates.DEC;
    expect(() => parseRainClimatology(raw)).toThrow('missing monthly values');
    // The temperature response has no rain in it.
    expect(() => parseRainClimatology(fixture('nasa-power-london.json'))).toThrow(
      'unexpected climatology response shape',
    );
    expect(() => parseRainClimatology(null)).toThrow(ProviderError);
  });

  it('fetches rain normals', async () => {
    const raw = fixture('nasa-power-rain-newcastle.json');
    const urls: string[] = [];
    const normals = await fetchRainNormals(
      {
        url: NASA_POWER_URL,
        fetch: async (url) => {
          urls.push(url);
          return jsonFetch(raw)();
        },
      },
      { lat: 55, lon: -1.875 },
    );
    expect(normals).toHaveLength(12);
    expect(new URL(urls[0]!).searchParams.get('parameters')).toBe('PRECTOTCORR');
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
