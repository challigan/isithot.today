/**
 * The native apps' fixtures (iOS build spec, section 7.3): real answers from the real
 * `handleToday`, as the apps ask for them (`todayQuery` with `ahead=snow`), on synthetic data at a
 * fixed moment. The Swift tests decode them, and the golden vectors are worked out from them, so
 * an API change that breaks the app's decoder or its rules fails there. Nothing here touches the
 * disk: `scripts/mobile-generate.ts` writes the files.
 *
 * Where the synthetic data can't say what a fixture needs, the upstream is changed and the server
 * still does the rest: a place's own time zone (`relabelZone`), fewer models, a forecast that
 * stops, or an upstream that is down. Only `no-week` and `no-now` change the server's answer
 * itself, to an edge state it never sends for a snow day; each note says how a fixture was made.
 */
import { MODELS, type SearchResponse, type TodayResponse, type Units } from '@isithot/core';
import { searchQuery, todayQuery, type Target } from '@isithot/client';
import {
  createSyntheticFetch,
  zoneOffsetSeconds,
  type FetchLike,
  type SyntheticPlace,
} from '@isithot/providers';
import {
  CITIES,
  MemoryKV,
  createDeps,
  getSearch,
  handleToday,
  type Platform,
  type VisitorGeo,
} from '@isithot/server';

export interface FixtureSpec {
  /** The file's name, without `.json`. */
  name: string;
  target: Target;
  /** As the app sends them: null for a first launch, which takes the server's. */
  units: Units | null;
  /**
   * The moment the fixture is for, ISO 8601 UTC: when the server answers, or for an answer the
   * app saved earlier (`answeredAt`), when the app looks at it.
   */
  now: string;
  /** What the answer shows, why this moment, and how the fixture was made if not as asked. */
  note: string;
  /** The place's own time zone, where the synthetic source would give a whole-hour one. */
  zone?: string;
  /** The visitor's approximate location, as the platform gives it, for an answer without a place. */
  geo?: VisitorGeo;
  /** The only models the upstream answers for; the others' hours are all null. */
  models?: readonly string[];
  /** The forecast's last local hour ("2026-12-02T00:00"), as the upstream sends it. */
  lastHour?: string;
  /** The forecast was fetched at this moment, and at `now` the upstream is down. */
  cachedAt?: string;
  /** The server answered at this moment, and the app looks at the answer later, at `now`. */
  answeredAt?: string;
  /** Changes the server's answer, for an edge state it never sends itself; `note` says what. */
  derive?: (res: TodayResponse) => void;
}

/** What each file says about itself: the query asked, the moment and the note. */
export interface FixtureInfo {
  query: string;
  now: string;
  note: string;
}

export type Fixture = { _fixture: FixtureInfo } & TodayResponse;

/** The synthetic source's forecast JSON, as far as the upstream changes below read it. */
interface ForecastJson {
  timezone: string;
  timezone_abbreviation: string;
  utc_offset_seconds: number;
  hourly: Record<string, unknown[]> & { time: string[] };
}

const DAY_SECONDS = 24 * 60 * 60;

/** `fetch` with each forecast it returns changed by `change`; other requests pass through. */
function withForecast(fetch: FetchLike, change: (body: ForecastJson) => void): FetchLike {
  return async (input, init) => {
    const res = await fetch(input, init);
    if (!new URL(input).pathname.endsWith('/forecast') || !res.ok) return res;
    const body = (await res.json()) as ForecastJson;
    change(body);
    return new Response(JSON.stringify(body), { headers: res.headers });
  };
}

/** "GMT+5:45", "GMT-7", "GMT": an offset as a zone without a name is abbreviated. */
export function offsetName(seconds: number): string {
  if (seconds === 0) return 'GMT';
  const minutes = Math.abs(seconds) / 60;
  const mm = minutes % 60;
  const hh = (minutes - mm) / 60;
  return `GMT${seconds < 0 ? '-' : '+'}${hh}${mm ? `:${String(mm).padStart(2, '0')}` : ''}`;
}

/**
 * The synthetic source only makes whole-hour `Etc/GMT` zones, so this says its forecasts are in
 * `zone`, with that zone's offset at `at`: the local hours stay as they are, and the server, which
 * reads times from `utc_offset_seconds`, then answers with hours that start at :30 or :15 past
 * the UTC hour. Where the two zones are a whole day apart (Kiritimati is UTC+14, and the synthetic
 * zone for its longitude UTC-10), the dates move by that day too, so the forecast still starts at
 * the place's midnight, as Open-Meteo's does.
 */
export function relabelZone(fetch: FetchLike, zone: string, at: Date): FetchLike {
  return withForecast(fetch, (body) => {
    const offset = zoneOffsetSeconds(zone, at);
    const days = Math.round((offset - body.utc_offset_seconds) / DAY_SECONDS);
    if (days !== 0) {
      body.hourly.time = body.hourly.time.map((stamp) => {
        const date = new Date(Date.parse(`${stamp.slice(0, 10)}T00:00:00Z`) + days * 86_400_000);
        return `${date.toISOString().slice(0, 10)}${stamp.slice(10)}`;
      });
    }
    body.timezone = zone;
    body.timezone_abbreviation = offsetName(offset);
    body.utc_offset_seconds = offset;
  });
}

/** An upstream that answers for the `kept` models only: every hour of the others is null. */
export function onlyModels(fetch: FetchLike, kept: readonly string[]): FetchLike {
  const dropped = MODELS.filter((m) => !kept.includes(m.id));
  return withForecast(fetch, (body) => {
    for (const key of Object.keys(body.hourly)) {
      if (dropped.some((m) => key.endsWith(`_${m.id}`))) {
        body.hourly[key] = body.hourly[key]!.map(() => null);
      }
    }
  });
}

/** An upstream whose forecast stops after `last`, a local hour ("2026-12-02T00:00"). */
export function endsAfter(fetch: FetchLike, last: string): FetchLike {
  return withForecast(fetch, (body) => {
    const count = body.hourly.time.filter((stamp) => stamp <= last).length;
    for (const key of Object.keys(body.hourly)) {
      body.hourly[key] = body.hourly[key]!.slice(0, count);
    }
  });
}

/** An upstream that is down. */
export const upstreamDown: FetchLike = async () =>
  new Response('Service unavailable', { status: 503 });

/** A place asked for as searched coordinates: it isn't in the city list. */
const searched = (lat: number, lon: number, name: string, country: string): Target => ({
  kind: 'coords',
  source: 'search',
  lat,
  lon,
  name,
  country,
});

export const FIXTURES: readonly FixtureSpec[] = [
  {
    name: 'aberdeen-snow',
    target: { kind: 'city', slug: 'aberdeen-gb' },
    units: 'c',
    now: '2026-12-02T09:05:00.000Z',
    note:
      'Snow today, and snow for the rest of the day in every hour ahead. It is raining at 9am, ' +
      'so Now says No until the snow comes.',
  },
  {
    name: 'durham-tomorrow',
    target: { kind: 'city', slug: 'durham-gb' },
    units: 'c',
    now: '2026-12-16T18:05:00.000Z',
    note:
      'Snow likely tomorrow, the evening notification’s example: at 6:05pm on 16 December, No ' +
      'today (too warm), and Yes for the 17th, all 6 forecasts expecting snow, mostly between ' +
      '2am and 8am. The last hour ahead is midnight, so it answers for the 17th. The synthetic ' +
      'data says No tomorrow on 1 December, the spec’s date, so it is the 16th.',
  },
  {
    name: 'shrewsbury-maybe',
    target: { kind: 'city', slug: 'shrewsbury-gb' },
    units: 'c',
    now: '2026-12-12T09:05:00.000Z',
    note:
      'Maybe today: 3 of 6 forecasts expect snow, mostly between 5pm and 8pm, and Maybe for the ' +
      'rest of the day in every hour ahead. No snow now.',
  },
  {
    name: 'reykjavik-mixed',
    target: { kind: 'city', slug: 'reykjavik-is' },
    units: 'c',
    now: '2026-12-02T15:05:00.000Z',
    note:
      'A few flakes today and Maybe tomorrow. Hour by hour, Now goes from no snow to a few ' +
      'flakes, then possible snow, then none. The synthetic source puts Reykjavík in Etc/GMT+1 ' +
      '(UTC-1), so it is 2:05pm there.',
  },
  {
    name: 'leeds-dry',
    target: { kind: 'city', slug: 'leeds-gb' },
    units: 'c',
    now: '2026-12-01T09:05:00.000Z',
    note:
      'No snow today (rain, not snow) or tomorrow (dry), and a week of No with only a few flakes ' +
      'on Saturday, so every reason appears: rain, dry and too warm. The rest of the day is rain ' +
      'until 2pm, then dry. Chosen because the synthetic forecast for Leeds gives all of that at ' +
      '9:05am on 1 December.',
  },
  {
    name: 'denver-f',
    target: searched(39.75, -105, 'Denver', 'US'),
    units: 'f',
    now: '2027-01-28T16:05:00.000Z',
    note:
      'A searched place in °F, so snow is in inches: No today (rain), and Maybe tomorrow, about ' +
      '0.2in between 1am and 4am. The synthetic source puts Denver in Etc/GMT+7 (UTC-7, as MST ' +
      'is), so it is 9:05am there. Denver seldom snows on the synthetic data; 28 January is a ' +
      'day before it does.',
  },
  {
    name: 'kolkata-0530',
    target: { kind: 'city', slug: 'kolkata-in' },
    units: 'c',
    now: '2026-12-02T15:40:00.000Z',
    zone: 'Asia/Kolkata',
    note:
      'Hours off the UTC hour: 9:10pm in Kolkata (UTC+5:30), relabelled from the synthetic ' +
      'source’s Etc/GMT-6, so each hour ahead starts at :30 past the UTC hour. They run past ' +
      'midnight into 3 December.',
  },
  {
    name: 'kathmandu-0545',
    target: searched(27.7, 85.3, 'Kathmandu', 'NP'),
    units: 'c',
    now: '2026-12-02T11:45:00.000Z',
    zone: 'Asia/Kathmandu',
    note:
      'A searched place at 5:30pm in Kathmandu (UTC+5:45), relabelled from Etc/GMT-6, so each ' +
      'hour ahead starts at :15 past the UTC hour, and 6pm is one of them.',
  },
  {
    name: 'adelaide-1030',
    target: searched(-34.95, 138.6, 'Adelaide', 'AU'),
    units: 'c',
    now: '2026-12-02T07:00:00.000Z',
    zone: 'Australia/Adelaide',
    note:
      'A searched place at 5:30pm in Adelaide (UTC+10:30, summer time), relabelled from ' +
      'Etc/GMT-9, so each hour ahead starts at :30 past the UTC hour, and 6pm is one of them.',
  },
  {
    name: 'kiritimati-14',
    target: searched(1.85, -157.4, 'Kiritimati', 'KI'),
    units: 'c',
    now: '2026-12-02T03:30:00.000Z',
    zone: 'Pacific/Kiritimati',
    note:
      'A searched place at 5:30pm on 2 December in Kiritimati (UTC+14), when it is 5:30pm on 1 ' +
      'December at UTC-10, the synthetic source’s zone for that longitude: relabelled from ' +
      'Etc/GMT+10, a whole day behind, so the dates move a day too.',
  },
  {
    name: 'london-dst-autumn-night',
    target: { kind: 'city', slug: 'london-gb' },
    units: 'c',
    now: '2026-10-24T23:30:00.000Z',
    note:
      '12:30am BST on Sunday 25 October 2026, the night the clocks go back at 2am BST: the hours ' +
      'ahead cross the change, so 1am comes twice.',
  },
  {
    name: 'london-dst-autumn-evening',
    target: { kind: 'city', slug: 'london-gb' },
    units: 'c',
    now: '2026-10-25T17:30:00.000Z',
    note: '5:30pm GMT on Sunday 25 October 2026, the day the clocks went back: 6pm is ahead.',
  },
  {
    name: 'london-dst-spring-night',
    target: { kind: 'city', slug: 'london-gb' },
    units: 'c',
    now: '2027-03-28T00:30:00.000Z',
    note:
      '12:30am GMT on Sunday 28 March 2027, the night the clocks go forward at 1am GMT: the hours ' +
      'ahead cross the change, so there is no 1am.',
  },
  {
    name: 'london-dst-spring-evening',
    target: { kind: 'city', slug: 'london-gb' },
    units: 'c',
    now: '2027-03-28T16:30:00.000Z',
    note: '5:30pm BST on Sunday 28 March 2027, the day the clocks went forward: 6pm is ahead.',
  },
  {
    name: 'ip-first-launch',
    target: { kind: 'ip' },
    units: null,
    now: '2026-12-01T12:05:00.000Z',
    geo: { city: 'Leeds', country: 'GB', region: 'England', lat: 53.7965, lon: -1.5478 },
    note:
      'The first launch: no place and no units, so the server places the visitor by IP ' +
      '(the platform says Leeds) and chooses °C, which the app then keeps as its units.',
  },
  {
    name: 'stale',
    target: { kind: 'city', slug: 'aberdeen-gb' },
    units: 'c',
    now: '2026-12-02T09:05:00.000Z',
    cachedAt: '2026-12-02T07:05:00.000Z',
    note:
      'Aberdeen at 9:05am on 2 December with the upstream down: the server answers from the ' +
      'forecast it fetched at 7:05am, so `stale` is true and `updatedAt` is 7:05am, while today ' +
      'and the hours ahead are from 9:05am. Shown until 1:05pm, the stale cut-off.',
  },
  {
    name: 'no-week',
    target: { kind: 'city', slug: 'aberdeen-gb' },
    units: 'c',
    now: '2026-12-02T09:05:00.000Z',
    derive: (res) => {
      delete res.snow!.week;
    },
    note:
      'aberdeen-snow with `snow.week` deleted, as the server leaves it out when too few days ' +
      'have forecasts. The hours ahead keep their weeks.',
  },
  {
    name: 'no-now',
    target: { kind: 'city', slug: 'aberdeen-gb' },
    units: 'c',
    now: '2026-12-02T09:05:00.000Z',
    derive: (res) => {
      delete res.snow!.now;
    },
    note:
      'aberdeen-snow with `snow.now` deleted, as the server leaves it out when no forecast ' +
      'covers the hour. The hours ahead keep theirs.',
  },
  {
    name: 'limited',
    target: { kind: 'city', slug: 'aberdeen-gb' },
    units: 'c',
    now: '2026-12-02T09:05:00.000Z',
    models: ['ecmwf_ifs025', 'ncep_gfs_seamless'],
    note:
      'Aberdeen at 9:05am on 2 December with only ECMWF and GFS answering (the upstream sends ' +
      'null for the other four), so each day says "Limited forecast data", and there is no ' +
      'week, which needs 3 models a day.',
  },
  {
    name: 'old-forecast',
    target: { kind: 'city', slug: 'durham-gb' },
    units: 'c',
    now: '2026-12-16T18:05:00.000Z',
    answeredAt: '2026-12-16T11:05:00.000Z',
    note:
      'Durham’s answer at 11:05am on 16 December, as the app finds it saved at 6:05pm (`now`), ' +
      '7 hours later: past the stale cut-off at 5:05pm, 6 hours after `updatedAt`, so none of ' +
      'it may be shown.',
  },
  {
    name: 'forecast-ends',
    target: { kind: 'city', slug: 'leeds-gb' },
    units: 'c',
    now: '2026-12-01T20:05:00.000Z',
    lastHour: '2026-12-02T00:00',
    note:
      'Leeds at 8:05pm on 1 December with a forecast that stops at midnight (the upstream sends ' +
      'no later hours): no tomorrow, no week, and only the hours ahead the forecast has, so the ' +
      'last of them ends before the stale cut-off.',
  },
];

const ENV: Record<string, string> = { DATA_SOURCE: 'synthetic' };

/**
 * The server's dependencies for `DATA_SOURCE=synthetic`, with the clock fixed at `now`, and the
 * upstream and the cache given.
 */
function fixedAt(now: Date, fetch: FetchLike, cache: MemoryKV) {
  return (platform: Platform) => ({
    ...createDeps(platform),
    cache,
    fetch,
    now: () => now,
    log: () => {},
  });
}

/** The upstream as `spec` has it at `at`: synthetic, on the same clock, then changed. */
function upstream(spec: FixtureSpec, at: Date): FetchLike {
  let fetch: FetchLike = createSyntheticFetch(CITIES, () => at);
  if (spec.zone) fetch = relabelZone(fetch, spec.zone, at);
  if (spec.models) fetch = onlyModels(fetch, spec.models);
  if (spec.lastHour) fetch = endsAfter(fetch, spec.lastHour);
  return fetch;
}

async function ask(
  spec: FixtureSpec,
  query: string,
  at: Date,
  fetch: FetchLike,
  cache: MemoryKV,
): Promise<TodayResponse> {
  const res = await handleToday(
    new Request(`https://willitsnow.today/api/v1/today?${query}`),
    { env: (name) => ENV[name], geo: spec.geo ?? null },
    fixedAt(at, fetch, cache),
  );
  const text = await res.text();
  if (res.status !== 200) {
    throw new Error(`${spec.name}: the server answered ${res.status}: ${text}`);
  }
  return JSON.parse(text) as TodayResponse;
}

/**
 * The server's answer to `spec`'s request, as it sends it, with `_fixture` first. Each fixture
 * has a memory cache of its own, so none depends on one made before it. Run one at a time: the
 * server shares a forecast request in flight for the same place.
 */
export async function makeFixture(spec: FixtureSpec): Promise<Fixture> {
  const now = new Date(spec.now);
  const at = spec.answeredAt ? new Date(spec.answeredAt) : now;
  const query = todayQuery(spec.target, spec.units, { ahead: ['snow'] });
  const cache = new MemoryKV();
  if (spec.cachedAt) {
    const cachedAt = new Date(spec.cachedAt);
    await ask(spec, query, cachedAt, upstream(spec, cachedAt), cache);
  }
  const body = await ask(spec, query, at, spec.cachedAt ? upstreamDown : upstream(spec, at), cache);
  spec.derive?.(body);
  return { _fixture: { query, now: now.toISOString(), note: spec.note }, ...body };
}

/** A fixture as its file has it: two-space JSON in the server's key order, then a newline. */
export function fixtureJson(fixture: Fixture | SearchFixture): string {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

// ---- Search answers --------------------------------------------------------------------------

/**
 * A search fixture: the server's answer to `GET /api/v1/search?q=…`, as the picker asks it
 * (client `searchQuery`), on the synthetic geocoder at a fixed moment. The app's Debug builds
 * answer the picker's searches with them (`-network`), and IsItCore's tests decode them.
 */
export interface SearchFixtureSpec {
  /** The file's name, without `.json`, in the fixtures' `Search` folder. */
  name: string;
  /** What the picker searches for: the search box's text, trimmed (client `searchInput`). */
  q: string;
  /** The moment the server answers, ISO 8601 UTC. */
  now: string;
  /** What the answer shows. */
  note: string;
}

/** A search fixture as its file has it. */
export type SearchFixture = { _fixture: FixtureInfo } & SearchResponse;

/**
 * Kathmandu, which the synthetic geocoder knows besides the city list (GeoNames' place, as
 * `data/places.json` has it): a place with no city page, so its result is a searched point.
 */
const KATHMANDU: SyntheticPlace = {
  geonameId: 1283240,
  name: 'Kathmandu',
  country: 'NP',
  countryName: 'Nepal',
  region: 'Bagmati Province',
  lat: 27.702,
  lon: 85.321,
  population: 1442271,
};

/** The places the synthetic geocoder finds for the search fixtures: the city list's, and Kathmandu. */
const SEARCH_PLACES: readonly SyntheticPlace[] = [...CITIES, KATHMANDU];

export const SEARCH_FIXTURES: readonly SearchFixtureSpec[] = [
  {
    name: 'search-leeds',
    q: 'Leeds',
    now: '2026-12-01T12:05:00.000Z',
    note:
      'The picker’s search for "Leeds": one result, Leeds in England, which has a city page ' +
      '(`slug`), so choosing it asks for `place=leeds-gb`, which leeds-dry answers.',
  },
  {
    name: 'search-kathmandu',
    q: 'Kathmandu',
    now: '2026-12-01T12:05:00.000Z',
    note:
      'The picker’s search for "Kathmandu": one result with no city page, so choosing it asks ' +
      'for its point on the 0.05° grid (27.7, 85.3) as a searched place, which kathmandu-0545 ' +
      'answers.',
  },
  {
    name: 'search-none',
    q: 'Xyzzy',
    now: '2026-12-01T12:05:00.000Z',
    note: 'The picker’s search for "Xyzzy", a place nowhere: no results.',
  },
];

/**
 * The server's answer to `spec`'s search, as it sends it, with `_fixture` first: from the
 * synthetic geocoder, or from `fetch` when given (an upstream that is down, in a test).
 */
export async function makeSearchFixture(
  spec: SearchFixtureSpec,
  fetch?: FetchLike,
): Promise<SearchFixture> {
  const now = new Date(spec.now);
  const query = searchQuery(spec.q);
  const upstream = fetch ?? createSyntheticFetch(SEARCH_PLACES, () => now);
  const platform: Platform = { env: (name) => ENV[name] };
  const deps = fixedAt(now, upstream, new MemoryKV())(platform);
  const res = await getSearch(new URLSearchParams(query), deps);
  if (res.status !== 200 || !('results' in res.body)) {
    throw new Error(`${spec.name}: the server answered ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return {
    _fixture: { query, now: now.toISOString(), note: spec.note },
    results: res.body.results,
  };
}
