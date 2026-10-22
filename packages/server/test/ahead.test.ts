/**
 * `ahead=snow`, the apps' opt-in: each entry is the answer the server itself gives at the start of
 * that hour, from the same forecast (README "API", DECISIONS "API contract").
 */
import { describe, expect, it } from 'vitest';
import { AHEAD, type ApiError, type TodayResponse } from '@isithot/core';
import { createSyntheticFetch, type FetchLike } from '@isithot/providers';
import {
  CITIES,
  MemoryKV,
  getToday,
  resolveServerConfig,
  type ServerDeps,
  type VisitorGeo,
} from '../src';

const HOUR = 3_600_000;
const ok = (r: { body: TodayResponse | ApiError }) => r.body as TodayResponse;

/** The server at `now`, on synthetic data made at that moment unless `fetch` says otherwise. */
const depsAt = (
  now: Date,
  fetch: FetchLike = createSyntheticFetch(CITIES, () => now),
  cache = new MemoryKV(),
): ServerDeps => ({
  config: resolveServerConfig(() => undefined),
  cache,
  fetch,
  now: () => now,
  waitUntil: () => {},
  log: () => {},
});

const ask = async (query: string, now: Date, geo: VisitorGeo | null = null) =>
  getToday(new URLSearchParams(query), geo, depsAt(now));

/**
 * Upstream as it first answered: a later request for the same address gets the same body, so
 * every answer below is worked out from one forecast, as an app's entries are.
 */
function answeringOnce(fetch: FetchLike): FetchLike {
  const bodies = new Map<string, Promise<string>>();
  return async (url, init) => {
    if (!bodies.has(url))
      bodies.set(
        url,
        fetch(url, init).then((r) => r.text()),
      );
    return new Response(await bodies.get(url)!, {
      headers: { 'content-type': 'application/json' },
    });
  };
}

/**
 * The synthetic forecast in a zone it cannot make (it makes whole-hour Etc/GMT zones): the local
 * hours stay, so their times move to :30 or :15 past the UTC hour.
 */
function relabelZone(fetch: FetchLike, timezone: string, offsetSeconds: number): FetchLike {
  return async (url, init) => {
    const res = await fetch(url, init);
    if (!new URL(url).pathname.endsWith('/forecast')) return res;
    const body = (await res.json()) as Record<string, unknown>;
    const hhmm = `${Math.floor(offsetSeconds / 3600)}:${String((offsetSeconds % 3600) / 60).padStart(2, '0')}`;
    const relabelled = {
      ...body,
      timezone,
      timezone_abbreviation: `GMT+${hhmm}`,
      utc_offset_seconds: offsetSeconds,
    };
    return new Response(JSON.stringify(relabelled), {
      headers: { 'content-type': 'application/json' },
    });
  };
}

/**
 * Asks for `query` with `ahead=snow` at `iso`, then for `query` alone at each entry's start on the
 * same cache and forecast: the entries, and the answer the server gave at each of their hours.
 */
async function aheadBeside(
  query: string,
  iso: string,
  wrap: (f: FetchLike) => FetchLike = (f) => f,
) {
  const first = new Date(iso);
  const fetch = answeringOnce(wrap(createSyntheticFetch(CITIES, () => first)));
  const cache = new MemoryKV();
  const at = (now: Date) => depsAt(now, fetch, cache);
  const asked = await getToday(new URLSearchParams(`${query}&ahead=snow`), null, at(first));
  const body = ok(asked);
  const entries = body.snow!.ahead!;
  const later = [];
  for (const e of entries) {
    later.push(ok(await getToday(new URLSearchParams(query), null, at(new Date(e.time)))));
  }
  return { asked, body, entries, later };
}

/** Each entry beside what the server answered at its start: Now (without series), Today, week. */
function expectSameAsServer({ entries, later }: Awaited<ReturnType<typeof aheadBeside>>) {
  expect(entries.length).toBeGreaterThan(0);
  entries.forEach((e, i) => {
    const { series: _series, ...now } = later[i]!.snow!.now!;
    expect(e.now).toEqual(now);
    expect(e.today).toEqual(later[i]!.snow!.days[0]);
    expect(e.week).toEqual(later[i]!.snow!.week ?? null);
  });
}

/** The entries' times, and the gaps between them in hours. */
const gaps = (entries: { time: string }[]) =>
  entries.slice(1).map((e, i) => (Date.parse(e.time) - Date.parse(entries[i]!.time)) / HOUR);

describe('ahead=snow', () => {
  it('answers each of the next hours as the server does at its start', async () => {
    const r = await aheadBeside('place=reykjavik-is&units=c', '2026-10-06T08:20:00Z');
    expect(r.entries.map((e) => e.time)).toEqual(
      [9, 10, 11, 12, 13, 14].map((h) => `2026-10-06T${String(h).padStart(2, '0')}:00:00.000Z`),
    );
    expect(r.entries).toHaveLength(AHEAD.hours);
    expectSameAsServer(r);
    // Reykjavík's synthetic snow: Today's answer and Now's change through the morning.
    expect(r.entries.map((e) => [e.now.band, e.today.band])).toEqual([
      ['maybesnow', 'snow'],
      ['nosnow', 'snow'],
      ['nosnow', 'snow'],
      ['maybesnow', 'snow'],
      ['maybesnow', 'snow'],
      ['snow', 'snow'],
    ]);
  });

  it('changes nothing else in the answer, nor its headers', async () => {
    const { asked } = await aheadBeside('place=reykjavik-is&units=c', '2026-10-06T08:20:00Z');
    const plain = await ask('place=reykjavik-is&units=c', new Date('2026-10-06T08:20:00Z'));
    const { ahead: _ahead, ...snow } = ok(asked).snow!;
    expect({ ...asked, body: { ...ok(asked), snow } }).toEqual(plain);
  });

  it("answers for the new date's day and week after the place's midnight", async () => {
    // Reykjavík's synthetic zone is UTC-1: 9:20pm there.
    const r = await aheadBeside('place=reykjavik-is&units=c', '2026-10-06T22:20:00Z');
    expectSameAsServer(r);
    expect(r.entries.map((e) => [e.time.slice(11, 16), e.today.date, e.week?.from])).toEqual([
      ['23:00', '2026-10-06', '2026-10-06'],
      ['00:00', '2026-10-06', '2026-10-06'],
      ['01:00', '2026-10-07', '2026-10-07'],
      ['02:00', '2026-10-07', '2026-10-07'],
      ['03:00', '2026-10-07', '2026-10-07'],
      ['04:00', '2026-10-07', '2026-10-07'],
    ]);
    const after = r.entries[2]!;
    expect(after.today).toMatchObject({ partial: true, from: after.time });
    expect(after.week!.days[0]).toMatchObject({ date: '2026-10-07', label: 'Today' });
  });

  it("has fewer entries near the end of the forecast's hours", async () => {
    // The server keeps three days of hours: from 9:30pm on the third, two are left.
    const fetched = new Date('2026-10-06T08:00:00Z');
    const deps = depsAt(
      new Date('2026-10-08T22:30:00Z'),
      createSyntheticFetch(CITIES, () => fetched),
    );
    const body = ok(
      await getToday(new URLSearchParams('place=reykjavik-is&units=c&ahead=snow'), null, deps),
    );
    expect(body.snow!.ahead!.map((e) => e.time)).toEqual([
      '2026-10-08T23:00:00.000Z',
      '2026-10-09T00:00:00.000Z',
    ]);
  });

  it('starts hours at :30 and :15 past the UTC hour in +5:30 and +5:45 zones', async () => {
    // 5:30pm in Kolkata and in Kathmandu.
    const kolkata = await aheadBeside('place=kolkata-in&units=c', '2026-10-06T12:00:00Z', (f) =>
      relabelZone(f, 'Asia/Kolkata', 19_800),
    );
    expect(kolkata.body.location.timezone).toBe('Asia/Kolkata');
    expect(kolkata.entries.map((e) => e.time.slice(11, 16))).toEqual([
      '12:30',
      '13:30',
      '14:30',
      '15:30',
      '16:30',
      '17:30',
    ]);
    expectSameAsServer(kolkata);
    const kathmandu = await aheadBeside(
      'lat=27.7&lon=85.3&name=Kathmandu&country=NP&source=search&units=c',
      '2026-10-06T11:45:00Z',
      (f) => relabelZone(f, 'Asia/Kathmandu', 20_700),
    );
    expect(kathmandu.body.location.timezone).toBe('Asia/Kathmandu');
    expect(kathmandu.entries.map((e) => e.time.slice(11, 16))).toEqual([
      '12:15',
      '13:15',
      '14:15',
      '15:15',
      '16:15',
      '17:15',
    ]);
    expectSameAsServer(kathmandu);
    // The Now rows start at the next local hour: 7pm in both.
    expect(kolkata.entries[0]!.now.hours[0]).toMatchObject({ label: '7pm' });
    expect(kathmandu.entries[0]!.now.hours[0]).toMatchObject({ label: '7pm' });
  });

  // At 12:30am and 5:30pm in London on the days the clocks change. Each entry's first Now row
  // is the next hour, in the place's time: 1am comes twice in autumn, and 1am never in spring.
  it.each([
    ['the autumn clock change', '2026-10-24T23:30:00Z', ['1am', '2am', '3am', '4am', '5am', '6am']],
    ['the autumn evening', '2026-10-25T17:30:00Z', ['7pm', '8pm', '9pm', '10pm', '11pm', '12am']],
    ['the spring clock change', '2027-03-28T00:30:00Z', ['3am', '4am', '5am', '6am', '7am', '8am']],
    ['the spring evening', '2027-03-28T16:30:00Z', ['7pm', '8pm', '9pm', '10pm', '11pm', '12am']],
  ])('keeps to the forecast hours across %s', async (_, iso, rows) => {
    const r = await aheadBeside('place=london-gb&units=c', iso);
    expect(gaps(r.entries)).toEqual([1, 1, 1, 1, 1]);
    expect(Date.parse(r.entries[0]!.time) - Date.parse(iso)).toBe(HOUR / 2);
    expect(r.entries.map((e) => e.now.hours[0]!.label)).toEqual(rows);
    expectSameAsServer(r);
  });

  it("is cached as the website's answers are: shared with a place and units, never past the hour", async () => {
    const now = new Date('2026-10-06T08:55:00Z');
    const headers = async (query: string, geo: VisitorGeo | null = null) =>
      (await ask(query, now, geo)).headers;
    const leeds: VisitorGeo = { city: 'Leeds', country: 'GB', lat: 53.8, lon: -1.55 };
    // An app always sends units with a city or rounded coordinates, so everyone in the cell
    // asking the same shares the CDN's copy, by its full address (`ahead` included).
    for (const query of ['place=durham-gb&units=c', 'lat=54.8&lon=-1.55&source=device&units=c']) {
      const shared = await headers(`${query}&ahead=snow`);
      expect(shared).toEqual(await headers(query));
      expect(shared).toEqual({
        'Cache-Control': 'public, max-age=300',
        'Netlify-CDN-Cache-Control': 'public, durable, max-age=300, stale-while-revalidate=0',
        'Netlify-Vary': 'query',
      });
    }
    // Its first launch, before any place is known, asks for the IP location: never shared.
    expect(await headers('ahead=snow', leeds)).toEqual({
      'Cache-Control': 'private, max-age=300',
      'Netlify-CDN-Cache-Control': 'no-store',
    });
  });

  it('ignores topics it does not answer, and repeats', async () => {
    const now = new Date('2026-10-06T08:20:00Z');
    const entries = async (ahead: string) =>
      ok(await ask(`place=reykjavik-is&units=c&ahead=${ahead}`, now)).snow!.ahead;
    for (const unknown of ['wet', 'hot,wind', 'Snow', 'snow ', '', 'snowy']) {
      expect(await entries(unknown)).toBeUndefined();
    }
    const once = await entries('snow');
    expect(once).toHaveLength(AHEAD.hours);
    expect(await entries('snow,snow')).toEqual(once);
    expect(await entries('wet,snow,later')).toEqual(once);
  });
});
