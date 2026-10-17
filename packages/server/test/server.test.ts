import { createServer, type AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import {
  LINKS,
  MODELS,
  listed,
  type ApiError,
  type SearchResponse,
  type TodayResponse,
} from '@isithot/core';
import { createSyntheticFetch, type FetchLike } from '@isithot/providers';
import {
  CACHE_READ_TIMEOUT_MS,
  CITIES,
  MemoryKV,
  SafeKV,
  cdnCacheControl,
  publicCache,
  staleWhileRevalidate,
  TieredKV,
  cityBySlug,
  cityForPlace,
  errorResult,
  getSearch,
  getToday,
  handleRateLimited,
  handleSearch,
  handleToday,
  nearbyCities,
  resolveServerConfig,
  reverseGeocode,
  todayForCity,
  type ServerDeps,
} from '../src';

const NOW = new Date('2026-10-06T08:00:00Z');

function makeDeps(overrides: Partial<ServerDeps> = {}) {
  const calls: string[] = [];
  const synthetic = createSyntheticFetch(CITIES, overrides.now ?? (() => NOW));
  const fetcher: FetchLike = async (url, init) => {
    calls.push(new URL(url).pathname);
    return synthetic(url, init);
  };
  const background: Promise<unknown>[] = [];
  const deps: ServerDeps = {
    config: resolveServerConfig(() => undefined),
    cache: new MemoryKV(),
    fetch: fetcher,
    now: () => NOW,
    waitUntil: (p) => void background.push(p),
    log: () => {},
    ...overrides,
  };
  return { deps, calls, background };
}

const q = (params: Record<string, string>) => new URLSearchParams(params);
const ok = (r: { body: TodayResponse | ApiError }) => r.body as TodayResponse;

/** Gives a city page a height for the length of a test (cities.json may not have one). */
/** Runs `run` with the city's height set to `metres`, or without one (undefined). */
async function withCityHeight<T>(slug: string, metres: number | undefined, run: () => Promise<T>) {
  const city = cityBySlug(slug)!;
  const before = city.elevation;
  if (metres === undefined) delete city.elevation;
  else city.elevation = metres;
  try {
    return await run();
  } finally {
    if (before === undefined) delete city.elevation;
    else city.elevation = before;
  }
}

describe('config', () => {
  it('uses the free hosts without a key and the customer hosts with one', () => {
    const free = resolveServerConfig(() => undefined);
    expect(free.openMeteo.forecastUrl).toBe('https://api.open-meteo.com/v1/forecast');
    expect(free.dataSource).toBe('live');
    expect(free.fallbackPlace).toBe('london-gb');
    const env: Record<string, string> = { OPEN_METEO_API_KEY: ' k ', DATA_SOURCE: 'synthetic' };
    const paid = resolveServerConfig((k) => env[k]);
    expect(paid.openMeteo.forecastUrl).toBe('https://customer-api.open-meteo.com/v1/forecast');
    expect(paid.openMeteo.geocodingUrl).toBe(
      'https://customer-geocoding-api.open-meteo.com/v1/search',
    );
    expect(paid.openMeteo.apiKey).toBe('k');
    expect(paid.dataSource).toBe('synthetic');
  });
});

describe('GET /api/v1/today', () => {
  it('answers for rounded device coordinates with the contract shape', async () => {
    const { deps } = makeDeps();
    const r = await getToday(q({ lat: '54.97', lon: '-1.61', units: 'c' }), null, deps);
    expect(r.status).toBe(200);
    const body = ok(r);
    expect(body.location).toMatchObject({
      name: 'Newcastle',
      country: 'GB',
      region: 'England',
      lat: 54.95,
      lon: -1.6,
      timezone: 'Europe/London',
      source: 'device',
      slug: 'newcastle-upon-tyne-gb',
      geonameId: 2641673,
    });
    expect(body.units).toBe('c');
    expect(body.days).toHaveLength(2);
    expect(body.days[0]!.date).toBe('2026-10-06');
    const day = body.days[0]!;
    expect(day).toHaveProperty('band');
    expect(day).toHaveProperty('answer');
    expect(day).toHaveProperty('verdict');
    expect(day.normalHigh).not.toBeNull();
    expect(day.consensus.total).toBe(MODELS.length);
    expect(day.models).toHaveLength(MODELS.length);
    expect(body.attribution).toEqual([
      'Weather data by Open-Meteo.com (CC BY 4.0), modified',
      'Contains Met Office data © Crown copyright, the Met Office, licensed under CC BY-SA 4.0',
      'Climate data: NASA POWER',
    ]);
    expect(body.updatedAt).toBe(NOW.toISOString());
    // Nearest first, for the "Nearby" links: 8 of them (LINKS.nearby).
    expect(body.nearby).toHaveLength(8);
    expect(body.nearby!.map((c) => c.slug)).not.toContain('newcastle-upon-tyne-gb');
    expect(body.stale).toBeUndefined();
    expect(r.headers['Cache-Control']).toBe('public, max-age=600');
  });

  it('serves the second call from cache', async () => {
    const { deps, calls } = makeDeps();
    await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, deps);
    // The forecast, then normal highs, rainfall, snowfall and wind (four climatology requests).
    expect(calls).toEqual([
      '/v1/forecast',
      '/api/temporal/climatology/point',
      '/api/temporal/climatology/point',
      '/api/temporal/climatology/point',
      '/api/temporal/climatology/point',
    ]);
    await getToday(q({ lat: '54.95', lon: '-1.6', units: 'f' }), null, deps);
    await getToday(q({ lat: '54.97', lon: '-1.62', units: 'c', windUnits: 'kmh' }), null, deps);
    expect(calls).toHaveLength(5);
  });

  it('uses the name passed by search and marks the source', async () => {
    const { deps } = makeDeps();
    const body = ok(
      await getToday(
        q({
          lat: '40.7',
          lon: '-74',
          name: 'New York',
          country: 'us',
          source: 'search',
          geonameId: '5128581',
          units: 'f',
        }),
        null,
        deps,
      ),
    );
    expect(body.location).toMatchObject({
      name: 'New York',
      country: 'US',
      source: 'search',
      slug: 'new-york-city-us',
    });
    expect(body.units).toBe('f');
  });

  it('names places with no nearby town "Your location"', async () => {
    const { deps } = makeDeps();
    const body = ok(await getToday(q({ lat: '0', lon: '-30', units: 'c' }), null, deps));
    expect(body.location.name).toBe('Your location');
    expect(body.location.slug).toBeUndefined();
  });

  it('serves city pages by slug', async () => {
    const { deps } = makeDeps();
    const body = ok(await getToday(q({ place: 'seville-es', units: 'c' }), null, deps));
    expect(body.location).toMatchObject({
      name: 'Seville',
      source: 'city',
      slug: 'seville-es',
      country: 'ES',
    });
  });

  it('rejects bad coordinates and unknown places', async () => {
    const { deps } = makeDeps();
    const cases: Record<string, string>[] = [
      { lat: '95', lon: '0' },
      { lat: '', lon: '1' },
      { lat: '1' },
      { lat: 'abc', lon: '1' },
    ];
    for (const params of cases) {
      const r = await getToday(q(params), null, deps);
      expect(r.status).toBe(400);
      expect((r.body as ApiError).error.code).toBe('bad_location');
    }
    const r = await getToday(q({ place: 'atlantis-xx' }), null, deps);
    expect(r.status).toBe(404);
    expect((r.body as ApiError).error).toEqual({
      code: 'not_found',
      message: 'There is no page for that place.',
    });
    expect(r.headers['Cache-Control']).toBe('no-store');
  });

  it('uses the approximate IP location and never shares it at the CDN', async () => {
    const { deps } = makeDeps();
    const r = await getToday(
      q({}),
      { city: 'Newcastle upon Tyne', country: 'GB', region: 'England', lat: 54.9881, lon: -1.6194 },
      deps,
    );
    const body = ok(r);
    expect(body.location).toMatchObject({
      name: 'Newcastle upon Tyne',
      source: 'ip',
      lat: 55,
      lon: -1.6,
    });
    expect(r.headers['Cache-Control']).toBe('private, max-age=300');
    expect(r.headers['Netlify-CDN-Cache-Control']).toBe('no-store');
  });

  it('links the IP town to its city page when the names agree', async () => {
    const { deps } = makeDeps();
    const body = ok(
      await getToday(q({}), { city: 'Newcastle', country: 'GB', lat: 54.97, lon: -1.61 }, deps),
    );
    expect(body.location).toMatchObject({ slug: 'newcastle-upon-tyne-gb', geonameId: 2641673 });
  });

  it('defaults to °F for US visitors and °C elsewhere', async () => {
    const { deps } = makeDeps();
    const us = ok(
      await getToday(q({}), { city: 'Austin', country: 'US', lat: 30.27, lon: -97.74 }, deps),
    );
    expect(us.units).toBe('f');
    const gb = ok(await getToday(q({ place: 'london-gb' }), { country: 'GB' }, deps));
    expect(gb.units).toBe('c');
    const fromPlace = ok(await getToday(q({ place: 'miami-us' }), null, deps));
    expect(fromPlace.units).toBe('f');
  });

  it('falls back to the configured place when IP location is unknown', async () => {
    const { deps } = makeDeps();
    const body = ok(await getToday(q({}), null, deps));
    expect(body.location).toMatchObject({ name: 'London', source: 'ip' });
    const broken = makeDeps({
      config: { ...resolveServerConfig(() => undefined), fallbackPlace: 'nowhere' },
    });
    expect((await getToday(q({}), {}, broken.deps)).status).toBe(400);
  });

  it('serves a stale result under 6 hours old when upstream fails', async () => {
    const cache = new MemoryKV();
    let now = NOW;
    const first = makeDeps({ cache, now: () => now });
    await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, first.deps);

    const failing: FetchLike = async () => new Response('down', { status: 503 });
    now = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    const logs: string[] = [];
    const later = makeDeps({ cache, now: () => now, fetch: failing, log: (m) => logs.push(m) });
    const r = await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, later.deps);
    expect(r.status).toBe(200);
    expect(ok(r).stale).toBe(true);
    expect(r.headers['Cache-Control']).toBe('public, max-age=60');
    // The log says why, and what was served instead (a 503 is retried at once).
    expect(logs.find((l) => l.startsWith('forecast unavailable'))).toMatch(
      /^forecast unavailable for forecast\/v6\/54\.95,-1\.60\/dem after \d+ms: open-meteo: HTTP 503 \(2 attempts\); answering with the copy from 2026-10-06T08:00:00.000Z$/,
    );

    now = new Date(NOW.getTime() + 7 * 60 * 60 * 1000);
    const tooOld = await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, later.deps);
    expect(tooOld.status).toBe(503);
    expect((tooOld.body as ApiError).error.code).toBe('upstream_unavailable');
  });

  it('refetches when the cached forecast no longer covers today', async () => {
    const cache = new MemoryKV();
    const first = makeDeps({ cache });
    await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, first.deps);
    // Ten minutes later but two days on (cache still "fresh" by age only if the date matched).
    const twoDaysLater = new Date(NOW.getTime() + 48 * 60 * 60 * 1000);
    const later = makeDeps({ cache, now: () => twoDaysLater });
    const r = await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, later.deps);
    expect(later.calls).toContain('/v1/forecast');
    expect(ok(r).days[0]!.date).toBe('2026-10-08');
  });

  it('refetches after midnight so the week keeps seven days', async () => {
    const cache = new MemoryKV();
    const evening = new Date('2026-10-06T22:50:00Z'); // 23:50 in London
    const first = makeDeps({ cache, now: () => evening });
    await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, first.deps);
    const afterMidnight = new Date('2026-10-06T23:10:00Z'); // 00:10 on the 7th in London
    const later = makeDeps({ cache, now: () => afterMidnight });
    const body = ok(await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, later.deps));
    expect(later.calls).toContain('/v1/forecast');
    expect(body.days.map((d) => d.date)).toEqual(['2026-10-07', '2026-10-08']);
    expect(body.week!.from).toBe('2026-10-07');
    expect(body.week!.days).toHaveLength(7);
  });

  it("falls back to yesterday's forecast after midnight when upstream fails", async () => {
    const cache = new MemoryKV();
    const evening = new Date('2026-10-06T22:50:00Z'); // 23:50 in London
    const first = makeDeps({ cache, now: () => evening });
    await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, first.deps);
    const failing: FetchLike = async () => new Response('down', { status: 503 });
    const afterMidnight = new Date('2026-10-06T23:10:00Z');
    const later = makeDeps({ cache, now: () => afterMidnight, fetch: failing });
    const body = ok(await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, later.deps));
    expect(body.stale).toBe(true);
    expect(body.days.map((d) => d.date)).toEqual(['2026-10-07', '2026-10-08']);
    // Six days from today remain in yesterday's seven.
    expect(body.week!.days).toHaveLength(6);
  });

  it('answers now and this week alongside today', async () => {
    const { deps } = makeDeps();
    const body = ok(await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, deps));
    const now = body.now!;
    expect(now.time).toBe(NOW.toISOString());
    expect(now.answer).toMatch(/^(Yes|No|Almost)\.$/);
    expect(now.detail).toMatch(/^-?\d+° now, feels like -?\d+°\. /);
    expect(now.hours).toHaveLength(6);
    expect(now.series.length).toBeGreaterThan(20);
    expect(now.series[0]!.band).toMatch(/^(freezing|cold|mild|warm|hot|scorching)$/);
    const week = body.week!;
    expect(week.from).toBe('2026-10-06');
    expect(week.to).toBe('2026-10-12');
    expect(week.days).toHaveLength(7);
    expect(week.days[0]!.label).toBe('Today');
    // Today's row in the week is Today's own answer.
    expect(week.days[0]!.band).toBe(body.days[0]!.band);
    expect(week.days[0]!.high).toBe(body.days[0]!.high);
    // Météo-France stops after about four days, so later days have five models.
    expect(body.days[0]!.consensus.total).toBe(MODELS.length);
  });

  it('answers "Is it wet?" alongside "Is it hot?"', async () => {
    const { deps } = makeDeps();
    const body = ok(await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, deps));
    const rain = body.rain!;
    expect(rain.unit).toBe('mm');
    // Today is the rest of the day from the request; tomorrow is the whole day.
    expect(rain.days.map((d) => [d.date, d.partial, d.from])).toEqual([
      ['2026-10-06', true, NOW.toISOString()],
      ['2026-10-07', false, '2026-10-06T23:00:00.000Z'],
    ]);
    for (const d of rain.days) {
      expect(d.answer).toMatch(/^(Yes|No|Maybe)\.$/);
      expect(d.total).toBe(MODELS.length);
      expect(d.models).toHaveLength(MODELS.length);
    }
    expect(rain.now!.time).toBe(NOW.toISOString());
    expect(rain.now!.hours).toHaveLength(6);
    expect(rain.now!.series.length).toBeGreaterThan(20);
    const week = rain.week!;
    expect(week.from).toBe('2026-10-06');
    expect(week.days).toHaveLength(7);
    expect(week.answer).toMatch(/^(Yes|No|Maybe|Partly)\.$/);
    // Today's row in the week is Today's own answer.
    expect(week.days[0]!.band).toBe(rain.days[0]!.band);
    expect(week.days[0]!.amount).toBe(rain.days[0]!.amount);
    expect(week.normal).not.toBeNull();

    const f = ok(await getToday(q({ lat: '54.95', lon: '-1.6', units: 'f' }), null, deps));
    expect(f.rain!.unit).toBe('in');
  });

  it('answers "Will it snow?" from the same forecast', async () => {
    const { deps } = makeDeps();
    const body = ok(await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, deps));
    const snow = body.snow!;
    expect(snow.unit).toBe('cm');
    // The same windows as rain: the rest of today from the request, then tomorrow.
    expect(snow.days.map((d) => [d.date, d.partial, d.from])).toEqual(
      body.rain!.days.map((d) => [d.date, d.partial, d.from]),
    );
    for (const d of snow.days) {
      expect(d.answer).toMatch(/^(Yes|No|Maybe)\.$/);
      expect(d.total).toBe(MODELS.length);
    }
    // Newcastle in October is too mild for snow, and says why.
    expect(snow.days[0]!.band).toBe('nosnow');
    expect(snow.days[0]!.reason).not.toBeNull();
    expect(snow.now!.time).toBe(NOW.toISOString());
    expect(snow.now!.hours).toHaveLength(6);
    expect(snow.now!.series.length).toBeGreaterThan(20);
    const week = snow.week!;
    expect(week.days).toHaveLength(7);
    expect(week.days[0]!.band).toBe(snow.days[0]!.band);
    expect(week.normal).not.toBeNull();
    const f = ok(await getToday(q({ lat: '54.95', lon: '-1.6', units: 'f' }), null, deps));
    expect(f.snow!.unit).toBe('in');
  });

  it('answers "Is it windy?" from the same forecast, in mph in the UK', async () => {
    const { deps } = makeDeps();
    const body = ok(await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, deps));
    const wind = body.wind!;
    // °C with mph: wind has its own units, from the place when `units` is given.
    expect([body.units, wind.unit]).toEqual(['c', 'mph']);
    // Today from the current hour (9am in London) to 9pm; tomorrow over its waking hours.
    expect(wind.days.map((d) => [d.date, d.partial, d.from, d.window])).toEqual([
      ['2026-10-06', true, NOW.toISOString(), { from: 9, to: 21 }],
      ['2026-10-07', false, '2026-10-07T06:00:00.000Z', { from: 7, to: 21 }],
    ]);
    for (const d of wind.days) {
      expect(d.answer).toMatch(/^(Yes|No|A bit)\.$/);
      expect(d.total).toBe(MODELS.length);
      expect(d.models).toHaveLength(MODELS.length);
      expect(d.models.some((m) => m.gust > m.mean)).toBe(true);
      expect(Number.isInteger(d.gust) && Number.isInteger(d.mean)).toBe(true);
      expect(d.agreementText).toMatch(/^\d of 6 forecasts says? /);
      expect(d.normal).not.toBeNull();
    }
    const now = wind.now!;
    expect(now.time).toBe(NOW.toISOString());
    expect(now.detail).toMatch(/^Wind \d+mph, gusts \d+mph right now\. /);
    expect(now.hours).toHaveLength(6);
    expect(now.series.length).toBeGreaterThan(20);
    // Today is never calmer than Now.
    const rank = ['calm', 'breezy', 'windy', 'verywindy', 'gale', 'storm'];
    expect(rank.indexOf(wind.days[0]!.band)).toBeGreaterThanOrEqual(rank.indexOf(now.band));
    const week = wind.week!;
    expect(week.from).toBe('2026-10-06');
    expect(week.days).toHaveLength(7);
    expect(week.answer).toMatch(/^(Yes|No|A bit|Partly)\.$/);
    expect(week.days[0]!.band).toBe(wind.days[0]!.band);
    expect(week.days[0]!.gust).toBe(wind.days[0]!.gust);
    // Later days are judged from each model's day, kept when their hours are dropped.
    expect(week.mean).not.toBeNull();
    expect(week.normal).not.toBeNull();
    expect(week.detail).toMatch(/(Windier than|Calmer than|About) usual for October\.$/);
    // The temperature units leave the wind's alone.
    const f = ok(await getToday(q({ lat: '54.95', lon: '-1.6', units: 'f' }), null, deps));
    expect([f.units, f.wind!.unit]).toEqual(['f', 'mph']);
    const seville = ok(await getToday(q({ place: 'seville-es', units: 'c' }), null, deps));
    expect(seville.wind!.unit).toBe('kmh');
    expect(seville.wind!.days[0]!.detail).toMatch(/km\/h/);
  });

  it('takes the wind units asked for, else the place’s with units given, else the visitor’s', async () => {
    const { deps } = makeDeps();
    const unit = async (params: Record<string, string>, country?: string) => {
      const r = await getToday(q(params), country ? { country } : null, deps);
      return [ok(r).wind!.unit, r.headers['Cache-Control']];
    };
    const london = { place: 'london-gb' };
    expect(await unit({ ...london, units: 'c', windUnits: 'kmh' })).toEqual([
      'kmh',
      'public, max-age=600',
    ]);
    // A visitor from France gets London's mph when the units are named, so the CDN can share it.
    expect(await unit({ ...london, units: 'c' }, 'FR')).toEqual(['mph', 'public, max-age=600']);
    // With nothing named, the visitor's own (and the answer is theirs alone).
    expect(await unit(london, 'FR')).toEqual(['kmh', 'private, max-age=300']);
    expect(await unit(london, 'US')).toEqual(['mph', 'private, max-age=300']);
    expect(await unit({ ...london, windUnits: 'kmh' }, 'US')).toEqual([
      'kmh',
      'private, max-age=300',
    ]);
    // Anything else is ignored.
    expect(await unit({ place: 'paris-fr', units: 'c', windUnits: 'knots' })).toEqual([
      'kmh',
      'public, max-age=600',
    ]);
    // The IP fallback's own country, without a visitor's.
    const ip = ok(await getToday(q({}), null, deps));
    expect(ip.wind!.unit).toBe('mph');
  });

  it('keeps the other answers when the wind normals fail, and caches briefly while they load', async () => {
    const synthetic = createSyntheticFetch(CITIES, () => NOW);
    const noWindNormals: FetchLike = async (url, init) =>
      url.includes('WS10M') ? new Response('{}', { status: 500 }) : synthetic(url, init);
    const failed = makeDeps({ fetch: noWindNormals });
    const body = ok(
      await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, failed.deps),
    );
    expect(body.days[0]!.normalHigh).not.toBeNull();
    expect(body.snow!.week!.normal).not.toBeNull();
    expect(body.wind!.days[0]!.normal).toBeNull();
    expect(body.wind!.week!.normal).toBeNull();
    expect(body.wind!.week!.detail).not.toMatch(/usual/);

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slowWind: FetchLike = async (url, init) => {
      if (url.includes('WS10M')) await gate;
      return synthetic(url, init);
    };
    const { deps, background } = makeDeps({ fetch: slowWind, climateWaitMs: 10 });
    const first = await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, deps);
    expect(first.headers['Cache-Control']).toBe('public, max-age=60');
    release();
    await Promise.all(background);
    const again = await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, deps);
    expect(again.headers['Cache-Control']).toBe('public, max-age=600');
    expect(ok(again).wind!.week!.normal).not.toBeNull();
  });

  it('uses wind normals only where the climate cell is near the place in height', async () => {
    const synthetic = createSyntheticFetch(CITIES, () => NOW);
    const answer = async (elevation: number, cellHeight = true) => {
      const changed: FetchLike = async (url, init) => {
        const json = (await (await synthetic(url, init)).json()) as Record<string, unknown>;
        if (url.includes('forecast')) json.elevation = elevation;
        if (!cellHeight && url.includes('WS10M')) {
          json.geometry = { type: 'Point', coordinates: [0, 55] };
        }
        return new Response(JSON.stringify(json));
      };
      const { deps } = makeDeps({ fetch: changed });
      return ok(await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, deps)).wind!;
    };
    expect((await answer(1050)).week!.normal).toBeNull();
    expect((await answer(340)).week!.normal).not.toBeNull();
    expect((await answer(1050, false)).week!.normal).not.toBeNull();
  });

  it('has a storm in Reykjavik, and no wind for a forecast recorded without it', async () => {
    const { deps } = makeDeps();
    const storm = ok(await getToday(q({ place: 'reykjavik-is', units: 'c' }), null, deps)).wind!;
    expect([storm.unit, storm.days[0]!.band, storm.now!.band, storm.week!.band]).toEqual([
      'kmh',
      'storm',
      'storm',
      'storm',
    ]);
    expect(storm.days[0]!.zone).toEqual({ from: 112, to: null });
    const synthetic = createSyntheticFetch(CITIES, () => NOW);
    const noWind: FetchLike = async (url, init) => {
      const json = (await (await synthetic(url, init)).json()) as {
        hourly?: Record<string, unknown>;
      };
      for (const key of Object.keys(json.hourly ?? {})) {
        if (key.startsWith('wind_')) delete json.hourly![key];
      }
      return new Response(JSON.stringify(json));
    };
    const old = makeDeps({ fetch: noWind });
    const body = ok(await getToday(q({ place: 'leeds-gb', units: 'c' }), null, old.deps));
    expect(body).not.toHaveProperty('wind');
    expect(body.rain).toBeDefined();
  });

  it('serves city pages in the wind unit of the city, or the one asked for', async () => {
    const platform = { env: (k: string) => ({ DATA_SOURCE: 'synthetic' })[k] };
    const london = await todayForCity('london-gb', platform);
    expect((london.body as TodayResponse).wind!.unit).toBe('mph');
    const paris = await todayForCity('paris-fr', platform, 'c');
    expect((paris.body as TodayResponse).wind!.unit).toBe('kmh');
    const kmh = await todayForCity('london-gb', platform, 'f', 'kmh');
    expect((kmh.body as TodayResponse).wind!.unit).toBe('kmh');
    expect((kmh.body as TodayResponse).units).toBe('f');
  });

  it('says snow where it is always freezing, and Wet agrees', async () => {
    const { deps } = makeDeps();
    const body = ok(await getToday(q({ place: 'reykjavik-is', units: 'c' }), null, deps));
    const snow = body.snow!.week!;
    expect(snow.answer).toBe('Yes.');
    const rain = body.rain!.week!;
    expect(rain.days.map((d) => d.date)).toEqual(snow.days.map((d) => d.date));
    // A day Wet calls snow is a Yes for snow.
    const wetSnow = rain.days.filter((d) => d.snow);
    expect(wetSnow.length).toBeGreaterThan(0);
    for (const d of wetSnow) {
      const day = snow.days.find((s) => s.date === d.date)!;
      expect(['snow', 'heavysnow', 'deepsnow']).toContain(day.band);
    }
  });

  it('keeps the other normals when the snow normals fail', async () => {
    const synthetic = createSyntheticFetch(CITIES, () => NOW);
    const noSnowNormals: FetchLike = async (url, init) =>
      url.includes('PRECSNOLAND') ? new Response('{}', { status: 500 }) : synthetic(url, init);
    const { deps } = makeDeps({ fetch: noSnowNormals });
    const body = ok(await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, deps));
    expect(body.days[0]!.normalHigh).not.toBeNull();
    expect(body.rain!.week!.normal).not.toBeNull();
    expect(body.snow!.week!.normal).toBeNull();
    expect(body.snow!.week!.detail).not.toMatch(/usual|rare|common/);
  });

  it('uses snow normals only where the climate cell is near the place in height', async () => {
    const synthetic = createSyntheticFetch(CITIES, () => NOW);
    const answer = async (change: (url: string, json: Record<string, unknown>) => void) => {
      const changed: FetchLike = async (url, init) => {
        const json = (await (await synthetic(url, init)).json()) as Record<string, unknown>;
        change(url, json);
        return new Response(JSON.stringify(json));
      };
      const { deps } = makeDeps({ fetch: changed });
      return ok(await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, deps));
    };
    // A town 1km above its climate cell: the cell's normal snow says little about it.
    const high = await answer((url, json) => {
      if (url.includes('forecast')) json.elevation = 1050;
    });
    expect(high.snow!.week!.normal).toBeNull();
    expect(high.rain!.week!.normal).not.toBeNull();
    const near = await answer((url, json) => {
      if (url.includes('forecast')) json.elevation = 340;
    });
    expect(near.snow!.week!.normal).not.toBeNull();
    // Without the cell's height there is nothing to compare: the normals are used.
    const unknown = await answer((url, json) => {
      if (url.includes('forecast')) json.elevation = 1050;
      if (url.includes('PRECSNOLAND')) json.geometry = { type: 'Point', coordinates: [0, 55] };
    });
    expect(unknown.snow!.week!.normal).not.toBeNull();
  });

  /** Deps whose forecast requests are recorded: the height each asked for, or null. */
  function recordingHeights(overrides: Partial<ServerDeps> = {}) {
    const synthetic = createSyntheticFetch(CITIES, () => NOW);
    const heights: Array<string | null> = [];
    const made = makeDeps({
      fetch: async (url, init) => {
        const u = new URL(url);
        if (u.pathname.endsWith('/forecast')) heights.push(u.searchParams.get('elevation'));
        return synthetic(url, init);
      },
      ...overrides,
    });
    return { ...made, heights };
  }

  const searched = (extra: Record<string, string>) =>
    q({ lat: '46.62', lon: '8.04', name: 'Grindelwald', country: 'CH', units: 'c', ...extra });

  it('forecasts a searched place for its height, cached in 50 m bands per grid cell', async () => {
    const { deps, heights, background } = recordingHeights();
    const at = async (params: Record<string, string>) => {
      const body = ok(await getToday(searched(params), null, deps));
      await Promise.all(background);
      return body;
    };
    const first = await at({ source: 'search', elevation: '1034' });
    expect(first.location).toMatchObject({ source: 'search', elevation: 1034 });
    expect(heights).toEqual(['1050']);
    expect(await deps.cache.get('forecast/v6/46.60,8.05/1050')).not.toBeNull();
    // Another place in the band shares the forecast; one 300 m lower in the same cell does not.
    await at({ source: 'search', elevation: '1060.4' });
    expect(heights).toEqual(['1050']);
    const lower = await at({ source: 'search', elevation: '740' });
    expect(lower.location.elevation).toBe(740);
    expect(heights).toEqual(['1050', '750']);
    // A device location's height is unknown, whatever the query says: the terrain's is used.
    const device = await at({ elevation: '1034' });
    expect(device.location.source).toBe('device');
    expect(device.location).not.toHaveProperty('elevation');
    expect(heights).toEqual(['1050', '750', null]);
    expect(await deps.cache.get('forecast/v6/46.60,8.05/dem')).not.toBeNull();
  });

  it('ignores a height that is not a plausible number of metres', async () => {
    const { deps, heights } = recordingHeights();
    for (const elevation of ['9001', '-501', '12000', 'abc', '1e3', '', ' ', '0x10']) {
      const body = ok(await getToday(searched({ source: 'search', elevation }), null, deps));
      expect(body.location).not.toHaveProperty('elevation');
    }
    expect(heights).toEqual([null]);
    // The Dead Sea shore and the top of the range are fine.
    const low = ok(await getToday(searched({ source: 'search', elevation: '-430' }), null, deps));
    expect(low.location.elevation).toBe(-430);
    const high = ok(
      await getToday(searched({ source: 'search', elevation: ' 9000 ' }), null, deps),
    );
    expect(high.location.elevation).toBe(9000);
    expect(heights).toEqual([null, '-450', '9000']);
  });

  it("forecasts city pages for the city's height when it is known", async () => {
    const { deps, heights } = recordingHeights();
    // Every city in data/cities.json has a height: take one away for a city without.
    const plain = await withCityHeight('leeds-gb', undefined, async () =>
      ok(await getToday(q({ place: 'leeds-gb', units: 'c' }), null, deps)),
    );
    expect(plain.location).not.toHaveProperty('elevation');
    expect(heights).toEqual([null]);
    await withCityHeight('zurich-ch', 408, async () => {
      const page = ok(await getToday(q({ place: 'zurich-ch', units: 'c' }), null, deps));
      expect(page.location).toMatchObject({ slug: 'zurich-ch', source: 'city', elevation: 408 });
      // A searched place that is the city, without a height of its own, takes the city's.
      const found = ok(
        await getToday(
          q({ lat: '47.37', lon: '8.55', name: 'Zürich', country: 'CH', source: 'search' }),
          null,
          deps,
        ),
      );
      expect(found.location).toMatchObject({ slug: 'zurich-ch', elevation: 408 });
    });
    // Same cell, same band: the searched place shares the city page's forecast.
    expect(heights).toEqual([null, '400']);
    // The IP fallback answers for its city, so takes its height too.
    await withCityHeight('london-gb', 11, async () => {
      const ip = ok(await getToday(q({}), null, deps));
      expect(ip.location).toMatchObject({ slug: 'london-gb', source: 'ip', elevation: 11 });
    });
    expect(heights).toEqual([null, '400', '0']);
  });

  it("judges the snow normals' height against the place's own height", async () => {
    const synthetic = createSyntheticFetch(CITIES, () => NOW);
    // The forecast claims the terrain's 50 m: the place's 1,050 m is what counts.
    const lowGrid: FetchLike = async (url, init) => {
      const json = (await (await synthetic(url, init)).json()) as Record<string, unknown>;
      if (url.includes('forecast')) json.elevation = 50;
      return new Response(JSON.stringify(json));
    };
    const { deps } = makeDeps({ fetch: lowGrid });
    const params = { lat: '54.95', lon: '-1.6', name: 'Tow Law', country: 'GB', units: 'c' };
    const high = ok(
      await getToday(q({ ...params, source: 'search', elevation: '1050' }), null, deps),
    );
    expect(high.snow!.week!.normal).toBeNull();
    const device = ok(await getToday(q(params), null, deps));
    expect(device.snow!.week!.normal).not.toBeNull();
  });

  it('gives the UV index for today, tomorrow and now', async () => {
    const { deps } = makeDeps({ now: () => new Date('2026-10-06T12:00:00Z') });
    const body = ok(await getToday(q({ place: 'seville-es', units: 'c' }), null, deps));
    for (const day of body.days) {
      expect(day.uv!.max).toBeGreaterThan(0);
      expect(Number.isInteger(day.uv!.max)).toBe(true);
      expect(day.uv!.level).toMatch(/^(low|medium|high|veryhigh|extreme)$/);
      expect(day.uv!.peak).toMatch(/^\d{1,2}(am|pm)$/);
    }
    const now = body.now!;
    // Now is the hour containing the moment, from the series the browser recomputes it with.
    const hour = now.series.find(
      (p) => p.time <= Date.parse(now.time) && Date.parse(now.time) < p.time + 3_600_000,
    )!;
    expect(now.uv).toEqual({ value: hour.uv, level: expect.any(String) });
    expect(now.uv!.value).toBeGreaterThan(0);
    expect(now.series.every((p) => Number.isInteger(p.uv))).toBe(true);
    // Wet and snow answers have none.
    expect(body.rain!.days[0]).not.toHaveProperty('uv');
    expect(body.snow!.days[0]).not.toHaveProperty('uv');
  });

  it('caches briefly while only the snow normals are loading', async () => {
    const synthetic = createSyntheticFetch(CITIES, () => NOW);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slowSnow: FetchLike = async (url, init) => {
      if (url.includes('PRECSNOLAND')) await gate;
      return synthetic(url, init);
    };
    const { deps, background } = makeDeps({ fetch: slowSnow, climateWaitMs: 10 });
    const first = await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, deps);
    expect(first.headers['Cache-Control']).toBe('public, max-age=60');
    expect(ok(first).snow!.week!.normal).toBeNull();
    release();
    await Promise.all(background);
    const again = await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, deps);
    expect(again.headers['Cache-Control']).toBe('public, max-age=600');
    expect(ok(again).snow!.week!.normal).not.toBeNull();
  });

  it("judges today's rain from the moment of the request", async () => {
    const evening = new Date('2026-10-06T20:30:00Z');
    const { deps } = makeDeps({ now: () => evening });
    const body = ok(await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, deps));
    expect(body.rain!.days[0]!.from).toBe(evening.toISOString());
    expect(body.rain!.now!.time).toBe(evening.toISOString());
    // The week's first row is still today, judged over what is left of it.
    expect(body.rain!.week!.days[0]!.label).toBe('Today');
  });

  it('never lets a cache keep the answer past the hour', async () => {
    const at = (iso: string) => {
      const now = new Date(iso);
      return makeDeps({ now: () => now }).deps;
    };
    const late = await getToday(
      q({ place: 'london-gb', units: 'c' }),
      null,
      at('2026-10-06T08:55:00Z'),
    );
    expect(late.headers['Cache-Control']).toBe('public, max-age=300');
    expect(late.maxAge).toBe(300);
    // Nor may the CDN serve it stale past the hour.
    expect(late.expiresIn).toBe(300);
    expect(late.headers['Netlify-CDN-Cache-Control']).toBe(
      'public, durable, max-age=300, stale-while-revalidate=0',
    );
    // Never under a minute, even in the last seconds of the hour.
    const last = await getToday(
      q({ place: 'london-gb', units: 'c' }),
      null,
      at('2026-10-06T08:59:30Z'),
    );
    expect(last.maxAge).toBe(60);
    expect(last.expiresIn).toBe(30);
    expect(last.headers['Netlify-CDN-Cache-Control']).toMatch(/stale-while-revalidate=0$/);
    // Fifteen minutes to go: ten fresh, five stale.
    const mid = await getToday(
      q({ place: 'london-gb', units: 'c' }),
      null,
      at('2026-10-06T08:45:00Z'),
    );
    expect(mid.maxAge).toBe(600);
    expect(mid.headers['Netlify-CDN-Cache-Control']).toBe(
      'public, durable, max-age=600, stale-while-revalidate=300',
    );
    const early = await getToday(
      q({ place: 'london-gb', units: 'c' }),
      null,
      at('2026-10-06T08:05:00Z'),
    );
    expect(early.maxAge).toBe(600);
    expect(early.expiresIn).toBe(55 * 60);
    expect(early.headers['Netlify-CDN-Cache-Control']).toBe(
      'public, durable, max-age=600, stale-while-revalidate=600',
    );
  });

  it('keeps max-age plus stale-while-revalidate within the time to expiry', () => {
    expect(staleWhileRevalidate(600)).toBe(600);
    expect(staleWhileRevalidate(600, null)).toBe(600);
    expect(staleWhileRevalidate(600, 3600)).toBe(600);
    expect(staleWhileRevalidate(600, 900)).toBe(300);
    expect(staleWhileRevalidate(300, 300)).toBe(0);
    expect(staleWhileRevalidate(60, 30)).toBe(0);
    expect(cdnCacheControl(120, 200)).toBe(
      'public, durable, max-age=120, stale-while-revalidate=80',
    );
    expect(publicCache(600, 86400)['Netlify-CDN-Cache-Control']).toBe(
      'public, durable, max-age=86400, stale-while-revalidate=86400',
    );
  });

  it("words tomorrow's verdict in the future tense", async () => {
    const { deps } = makeDeps();
    const body = ok(await getToday(q({ place: 'london-gb', units: 'c' }), null, deps));
    expect(body.days[0]!.verdict).toMatch(/^It's /);
    expect(body.days[1]!.verdict).toMatch(/^It'll be /);
    // Tomorrow's rain is a whole day, never "still to come".
    expect(body.rain!.days[1]!.partial).toBe(false);
    expect(body.rain!.days[1]!.detail).not.toMatch(/still to come|rest of the day|Easing off/);
  });

  it('keeps the hot normals when the rain normals fail', async () => {
    const synthetic = createSyntheticFetch(CITIES, () => NOW);
    const noRainNormals: FetchLike = async (url, init) =>
      url.includes('PRECTOTCORR') ? new Response('{}', { status: 500 }) : synthetic(url, init);
    const { deps } = makeDeps({ fetch: noRainNormals });
    const body = ok(await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, deps));
    expect(body.days[0]!.normalHigh).not.toBeNull();
    expect(body.rain!.week!.normal).toBeNull();
    expect(body.rain!.week!.detail).not.toMatch(/usual/);
  });

  it('answers without normals when NASA POWER is slow, and fills the cache later', async () => {
    const synthetic = createSyntheticFetch(CITIES, () => NOW);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slowNasa: FetchLike = async (url, init) => {
      if (url.includes('climatology')) await gate;
      return synthetic(url, init);
    };
    const { deps, background } = makeDeps({ fetch: slowNasa, climateWaitMs: 10 });
    const first = await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, deps);
    const body = ok(first);
    expect(body.days[0]!.normalHigh).toBeNull();
    expect(body.days[0]!.detail).not.toContain('usual');
    expect(first.headers['Cache-Control']).toBe('public, max-age=60');
    release();
    await Promise.all(background);
    const again = ok(await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, deps));
    expect(again.days[0]!.normalHigh).not.toBeNull();
  });

  it('remembers a NASA POWER failure for an hour', async () => {
    const synthetic = createSyntheticFetch(CITIES, () => NOW);
    let nasaCalls = 0;
    const noNasa: FetchLike = async (url, init) => {
      if (url.includes('climatology')) {
        nasaCalls++;
        return new Response('{}', { status: 500 });
      }
      return synthetic(url, init);
    };
    const { deps } = makeDeps({ fetch: noNasa });
    const body = ok(await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, deps));
    expect(body.days[0]!.anomaly).toBeNull();
    expect(body.rain!.week!.normal).toBeNull();
    // One request each for normal highs, rainfall, snowfall and wind, then none again for an hour.
    expect(nasaCalls).toBe(4);
    await getToday(q({ lat: '54.95', lon: '-1.6', units: 'c' }), null, deps);
    expect(nasaCalls).toBe(4);
  });

  it('reports upstream_unavailable when the forecast has no data for today', async () => {
    const empty: FetchLike = async (url) =>
      url.includes('forecast')
        ? new Response(JSON.stringify({ timezone: 'UTC', daily: { time: ['2026-10-06'] } }))
        : new Response('{}', { status: 500 });
    const { deps } = makeDeps({ fetch: empty });
    const r = await getToday(q({ lat: '10', lon: '10', units: 'c' }), null, deps);
    expect(r.status).toBe(503);
    expect((r.body as ApiError).error).toEqual({
      code: 'upstream_unavailable',
      message: 'Forecasts are unavailable right now. Try again in a few minutes.',
      detail: 'open-meteo: unexpected forecast response shape',
    });

    const pastOnly: FetchLike = async (url) =>
      url.includes('forecast')
        ? new Response(JSON.stringify({ timezone: 'UTC', hourly: { time: ['2026-10-01T00:00'] } }))
        : new Response('{}', { status: 500 });
    const past = makeDeps({ fetch: pastOnly });
    const old = await getToday(q({ lat: '10.5', lon: '10', units: 'c' }), null, past.deps);
    expect(old.status).toBe(503);
    expect((old.body as ApiError).error).toMatchObject({
      detail: 'open-meteo: the forecast has no data for 2026-10-06 (UTC)',
    });
  });

  it('says why the forecast failed, in the 503 body and the log', async () => {
    const synthetic = createSyntheticFetch(CITIES, () => NOW);
    const stalled: FetchLike = (url, init) =>
      url.includes('/v1/forecast') ? new Promise(() => {}) : synthetic(url, init);
    const logs: string[] = [];
    const { deps } = makeDeps({
      fetch: stalled,
      log: (m) => logs.push(m),
      forecastTiming: { timeoutMs: 60, hedgeAfterMs: 20 },
    });
    const r = await getToday(q({ lat: '11', lon: '11', units: 'c' }), null, deps);
    expect(r.status).toBe(503);
    expect(r.headers['Cache-Control']).toBe('no-store');
    expect((r.body as ApiError).error).toMatchObject({
      code: 'upstream_unavailable',
      detail: 'open-meteo: timed out after 60ms (2 attempts)',
    });
    expect(logs).toContainEqual(
      expect.stringMatching(
        /^forecast unavailable for forecast\/v6\/11\.00,11\.00\/dem after \d+ms: open-meteo: timed out after 60ms \(2 attempts\); no usable cached copy, answering 503$/,
      ),
    );
  });

  it('answers from a second forecast request when the first is slow, and logs the time', async () => {
    const synthetic = createSyntheticFetch(CITIES, () => NOW);
    let forecasts = 0;
    const firstStalls: FetchLike = (url, init) =>
      url.includes('/v1/forecast') && ++forecasts === 1
        ? new Promise(() => {})
        : synthetic(url, init);
    const logs: string[] = [];
    const { deps } = makeDeps({
      fetch: firstStalls,
      log: (m) => logs.push(m),
      forecastTiming: { timeoutMs: 1000, hedgeAfterMs: 20 },
    });
    const r = await getToday(q({ lat: '12', lon: '12', units: 'c' }), null, deps);
    expect(r.status).toBe(200);
    expect(forecasts).toBe(2);
    expect(logs).toContainEqual(
      expect.stringMatching(/^forecast for forecast\/v6\/12\.00,12\.00\/dem took \d+ms$/),
    );
  });

  it('gives error bodies a detail only when there is one', () => {
    expect(errorResult('not_found', 'No such place.').body).toEqual({
      error: { code: 'not_found', message: 'No such place.' },
    });
    expect(errorResult('upstream_unavailable', 'Down.', 'open-meteo: HTTP 502').body).toEqual({
      error: { code: 'upstream_unavailable', message: 'Down.', detail: 'open-meteo: HTTP 502' },
    });
  });

  it('serves the reason from the function without the API key', async () => {
    // A port that was free a moment ago: the connection is refused at once.
    const port = await new Promise<number>((resolve) => {
      const server = createServer().listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        server.close(() => resolve(port));
      });
    });
    const env: Record<string, string> = {
      OPEN_METEO_API_KEY: 's3cret',
      OPEN_METEO_FORECAST_URL: `http://127.0.0.1:${port}/v1/forecast`,
      NASA_POWER_URL: `http://127.0.0.1:${port}/climatology`,
    };
    const console_ = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const res = await handleToday(
        new Request('https://x.test/api/v1/today?lat=13&lon=13&units=c'),
        { env: (k) => env[k] },
      );
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).not.toContain('s3cret');
      expect((JSON.parse(text) as ApiError).error).toMatchObject({
        code: 'upstream_unavailable',
        detail: expect.stringMatching(
          /^open-meteo: network error: TypeError: fetch failed \(ECONNREFUSED\) \(2 attempts\)$/,
        ),
      });
      const logged = console_.mock.calls.map((c) => String(c[0]));
      expect(logged).toContainEqual(
        expect.stringMatching(
          /^\[isithot\] forecast unavailable for .*ECONNREFUSED.*answering 503$/,
        ),
      );
      expect(logged.join('\n')).not.toContain('s3cret');
    } finally {
      console_.mockRestore();
    }
  });

  it('wraps everything in a Response', async () => {
    const env: Record<string, string> = { DATA_SOURCE: 'synthetic' };
    const res = await handleToday(
      new Request('https://x.test/api/v1/today?place=london-gb&units=c'),
      {
        env: (k) => env[k],
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const body = (await res.json()) as TodayResponse;
    expect(body.location.name).toBe('London');
    const city = await todayForCity('london-gb', { env: (k) => env[k] });
    expect(city.status).toBe(200);
    const missing = await todayForCity('nope', { env: (k) => env[k] });
    expect(missing.status).toBe(404);
  });

  it('turns unexpected errors into a 503 envelope', async () => {
    const platform = Object.defineProperty({ env: () => undefined }, 'geo', {
      get() {
        throw new Error('boom');
      },
    });
    const res = await handleToday(new Request('https://x.test/api/v1/today'), platform);
    expect(res.status).toBe(503);
    expect(((await res.json()) as ApiError).error.code).toBe('upstream_unavailable');
  });
});

describe('GET /api/v1/search', () => {
  it('returns up to 8 results with city slugs', async () => {
    const { deps } = makeDeps();
    const r = await getSearch(q({ q: 'Newc' }), deps);
    expect(r.status).toBe(200);
    const body = r.body as SearchResponse;
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.length).toBeLessThanOrEqual(8);
    expect(body.results[0]).toMatchObject({
      name: 'Newcastle',
      country: 'GB',
      countryName: 'United Kingdom',
      region: 'England',
      slug: 'newcastle-upon-tyne-gb',
      geonameId: 2641673,
    });
  });

  it("gives each result its height, the geocoder's or the city page's", async () => {
    const synthetic = createSyntheticFetch(CITIES, () => NOW);
    const geocoder: FetchLike = async (url, init) => {
      if (!url.includes('/search')) return synthetic(url, init);
      return new Response(
        JSON.stringify({
          results: [
            { id: 1, name: 'Grindelwald', latitude: 46.62, longitude: 8.04, elevation: 1034 },
            { id: 2, name: 'Grindelwald Grund', latitude: 46.62, longitude: 8.03, elevation: 'x' },
          ],
        }),
      );
    };
    const { deps } = makeDeps({ fetch: geocoder });
    const remote = (await getSearch(q({ q: 'Grindelwald' }), deps)).body as SearchResponse;
    expect(remote.results.map((r) => r.elevation)).toEqual([1034, undefined]);
    await withCityHeight('leeds-gb', 63, async () => {
      const local = (await getSearch(q({ q: 'Leeds' }), deps)).body as SearchResponse;
      expect(local.results[0]).toMatchObject({ slug: 'leeds-gb', elevation: 63 });
    });
  });

  it('needs at least 2 characters', async () => {
    const { deps, calls } = makeDeps();
    expect((await getSearch(q({ q: ' n ' }), deps)).body).toEqual({ results: [] });
    expect((await getSearch(q({}), deps)).body).toEqual({ results: [] });
    expect(calls).toEqual([]);
  });

  it('caches by lower-cased query and falls back to the cache on failure', async () => {
    const cache = new MemoryKV();
    const first = makeDeps({ cache });
    await getSearch(q({ q: 'Leeds' }), first.deps);
    await Promise.all(first.background);
    await getSearch(q({ q: 'leeds' }), first.deps);
    expect(first.calls).toHaveLength(1);

    const failing: FetchLike = async () => new Response('', { status: 500 });
    const later = makeDeps({
      cache,
      fetch: failing,
      now: () => new Date(NOW.getTime() + 8 * 86400000),
    });
    const r = await getSearch(q({ q: 'LEEDS' }), later.deps);
    expect(r.status).toBe(200);
    expect((r.body as SearchResponse).results[0]!.name).toBe('Leeds');

    const none = await getSearch(q({ q: 'Paris' }), later.deps);
    expect(none.status).toBe(503);
  });

  it('wraps search and rate limiting in Responses', async () => {
    const env: Record<string, string> = { DATA_SOURCE: 'synthetic' };
    const res = await handleSearch(new Request('https://x.test/api/v1/search?q=bris'), {
      env: (k) => env[k],
    });
    expect(((await res.json()) as SearchResponse).results.map((r) => r.name)).toEqual([
      'Brisbane',
      'Bristol',
    ]);
    const throwing = Object.defineProperty({}, 'env', {
      get() {
        return () => {
          throw new Error('boom');
        };
      },
    });
    const bad = await handleSearch(
      new Request('https://x.test/api/v1/search?q=ab'),
      throwing as never,
    );
    expect(bad.status).toBe(503);
    expect((await todayForCity('london-gb', throwing as never)).status).toBe(503);
    const limited = handleRateLimited();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    expect(((await limited.json()) as ApiError).error.code).toBe('rate_limited');
  });
});

describe('cities and reverse geocoding', () => {
  it('has 300 unique city pages', () => {
    expect(CITIES).toHaveLength(300);
    expect(new Set(CITIES.map((c) => c.slug)).size).toBe(300);
    expect(CITIES.filter((c) => c.country === 'GB')).toHaveLength(150);
    expect(cityBySlug('NEWCASTLE-UPON-TYNE-GB')?.name).toBe('Newcastle');
  });

  it('finds nearby city pages', () => {
    const newcastle = cityBySlug('newcastle-upon-tyne-gb')!;
    const near = nearbyCities(newcastle, 4, newcastle.slug).map((c) => c.name);
    expect(near).toHaveLength(4);
    expect(near).toContain('South Shields');
    expect(near).not.toContain('Newcastle');
    // Eight by default (LINKS.nearby), nearest first.
    const eight = nearbyCities(newcastle, undefined, newcastle.slug);
    expect(eight).toHaveLength(8);
    expect(eight.slice(0, 4).map((c) => c.name)).toEqual(near);
  });

  it('has a city page for every popular place, all in the UK', () => {
    expect(LINKS.popular).toHaveLength(20);
    expect(new Set(LINKS.popular).size).toBe(20);
    for (const slug of LINKS.popular) expect(cityBySlug(slug)?.country, slug).toBe('GB');
  });

  it('keeps snow pages where it never snows out of the snow site, and no others', () => {
    const out = CITIES.filter((c) => !listed(c, 'snow'));
    // Within 30° of the equator, below 3,000 m (DECISIONS.md lists them).
    expect(out).toHaveLength(63);
    expect(out.every((c) => Math.abs(c.lat) < 30)).toBe(true);
    expect(out.map((c) => c.slug)).toEqual(expect.arrayContaining(['singapore-sg', 'dubai-ae']));
    expect(CITIES.filter((c) => c.country === 'GB').every((c) => listed(c, 'snow'))).toBe(true);
    expect(CITIES.every((c) => listed(c, 'hot') && listed(c, 'wet'))).toBe(true);
  });

  it('matches searched places to city pages', () => {
    expect(cityForPlace({ name: 'Leeds', country: 'GB', lat: 53.8, lon: -1.55 })?.slug).toBe(
      'leeds-gb',
    );
    expect(cityForPlace({ name: 'Leeds', country: 'US', lat: 33.5, lon: -86.5 })).toBeUndefined();
    expect(
      cityForPlace({ name: 'x', country: null, lat: 0, lon: 0, geonameId: 2643743 })?.slug,
    ).toBe('london-gb');
  });

  it('names a point after the nearest town', async () => {
    expect((await reverseGeocode(54.95, -1.6))?.name).toBe('Newcastle');
    expect((await reverseGeocode(54.9, -1.4))?.name).toBe('Sunderland');
    expect((await reverseGeocode(54.97, -2.1))?.name).toBe('Hexham');
    expect((await reverseGeocode(51.5, -0.15))?.country).toBe('GB');
    expect(await reverseGeocode(0, -30)).toBeNull();
  });
});

describe('cache layers', () => {
  it('evicts the oldest memory entries', async () => {
    const kv = new MemoryKV(2);
    await kv.set('a', 1);
    await kv.set('b', 2);
    await kv.get('a');
    await kv.set('c', 3);
    expect(await kv.get('b')).toBeNull();
    expect(await kv.get('a')).toBe(1);
    expect(kv.size).toBe(2);
  });

  it('reads through to the shared cache and back-fills', async () => {
    const near = new MemoryKV();
    const far = new MemoryKV();
    await far.set('k', 'v');
    const kv = new TieredKV(near, far);
    expect(await kv.get('k')).toBe('v');
    expect(await near.get('k')).toBe('v');
    expect(await kv.get('missing')).toBeNull();
    await kv.set('x', 1);
    expect(await far.get('x')).toBe(1);
  });

  it('treats cache errors as misses', async () => {
    const onError = vi.fn();
    const broken = new SafeKV(
      {
        get: async () => {
          throw new Error('boom');
        },
        set: async () => {
          throw new Error('boom');
        },
      },
      onError,
    );
    expect(await broken.get('k')).toBeNull();
    await broken.set('k', 1);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('treats a slow read as a miss', async () => {
    const onError = vi.fn();
    const stuck = new SafeKV(
      { get: () => new Promise(() => {}), set: async () => {} },
      onError,
      20,
    );
    expect(await stuck.get('forecast/x')).toBeNull();
    expect(String(onError.mock.calls[0]![0])).toBe(
      'Error: read of forecast/x timed out after 20ms',
    );
    expect(CACHE_READ_TIMEOUT_MS).toBe(1500);
  });
});
