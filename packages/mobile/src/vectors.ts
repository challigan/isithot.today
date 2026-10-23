/**
 * The golden vectors (iOS build spec, section 7.4): inputs, and what the TypeScript reference in
 * packages/core and packages/client gives for them, which the Swift ports in IsItCore must give
 * too. Every output here comes from calling the reference; none is written by hand. Pure: the
 * fixtures are passed in, and `scripts/mobile-generate.ts` writes the files.
 *
 * A file is `{ fn, source, cases: [{ fn, in, out }] }`: `fn` lists the functions it covers,
 * `source` names each as `<package>@<function>`, and each case says which function it is for.
 * Conventions, so the Swift side can decode them:
 * - Moments (`now`, `fetchedAt`, and what the functions return as times) are epoch milliseconds,
 *   as the client's functions take them. Dates inside the API's own objects stay ISO 8601.
 * - An answer is named by its fixture: `in.fixture` is the file's name in the Fixtures folder.
 *   `in.without`, where there is one, lists blocks taken out of it first ("rain", "snow.now", a
 *   list's item "snow.days.1", or every item, "now.series.*"), for the rules' fallbacks: the
 *   answer as it would be without them (`withoutBlocks`).
 * - Where a function returns one of the answer's own snow objects (pickHour's `now`, `today` and
 *   `week`, middleDay's and a widget entry's `day`), the vector has its path in that fixture
 *   instead ("snow.days.1", "snow.ahead.2.today"), or null: the same object, compared whole.
 * - A field a function leaves out (`undefined`) is left out here too; `null` is kept.
 */
import {
  ELEVATION,
  GRID,
  HOUR,
  VIEWS,
  defaultView,
  localDateTime,
  question,
  roundToGrid,
  showsTomorrow,
  updatedParts,
  updatedTime,
  viewDisplay,
  viewLabel,
  type SearchResult,
  type TodayResponse,
  type Units,
} from '@isithot/core';
import {
  CLIENT,
  addRecent,
  alertAction,
  alertPlaceAllowed,
  dayUntil,
  deviceTarget,
  fingerprint,
  freshQuery,
  hold,
  hourUntil,
  middleDay,
  nextRefreshAt,
  notificationRoute,
  outOfDate,
  parseDeepLink,
  pickHour,
  registrationBody,
  removeRecent,
  searchQuery,
  searchTarget,
  targetFromQuery,
  targetKey,
  todayQuery,
  updatedLine,
  usableUntil,
  widgetEntries,
  type AlertPrefs,
  type Holds,
  type Permission,
  type PlaceTarget,
  type PushEnv,
  type RecentPlace,
  type Target,
  type WidgetEntry,
} from '@isithot/client';
import type { Fixture } from './fixtures';

export interface VectorCase {
  /** The function this case is for. */
  fn: string;
  in: Record<string, unknown>;
  out: unknown;
}

export interface VectorFile {
  /** The functions the file covers, in order, comma-separated. */
  fn: string;
  /** Each as `<package>@<function>`, in the same order. */
  source: string;
  cases: VectorCase[];
}

/** A vector file and its name, without `.json`. */
export interface NamedVectors {
  name: string;
  vectors: VectorFile;
}

/** The fixtures by name, as their files have them. */
export type FixtureSet = ReadonlyMap<string, Fixture>;

const MINUTE = 60 * 1000;
const DAY = 24 * HOUR;

/** Collects cases, each (function and input) once, in the order they are added. */
function collector() {
  const seen = new Set<string>();
  const cases: VectorCase[] = [];
  return {
    cases,
    add(fn: string, input: Record<string, unknown>, out: unknown): void {
      const key = JSON.stringify([fn, input]);
      if (seen.has(key)) return;
      seen.add(key);
      cases.push({ fn, in: input, out });
    },
  };
}

function vectorFile(
  fns: readonly (readonly ['core' | 'client', string])[],
  cases: VectorCase[],
): VectorFile {
  const names = fns.map(([, fn]) => fn);
  for (const c of cases) {
    if (!names.includes(c.fn)) throw new Error(`A case for ${c.fn}, which the file doesn't list`);
  }
  for (const fn of names) {
    if (!cases.some((c) => c.fn === fn)) throw new Error(`No case for ${fn}`);
  }
  return {
    fn: names.join(', '),
    source: fns.map(([pkg, fn]) => `${pkg}@${fn}`).join(', '),
    cases,
  };
}

/** The calendar date `days` after `date` (YYYY-MM-DD). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/**
 * Every moment, on the minute, when the clock in `zone` reads `hh:mm` on `date`, earliest first:
 * none in the hour the clocks skip, two in the hour they repeat.
 */
export function localMoments(zone: string, date: string, hh: number, mm: number): number[] {
  const minutes = hh * 60 + mm;
  const wall = Date.parse(`${date}T00:00:00Z`) + minutes * MINUTE;
  const found: number[] = [];
  // Every offset in use is a whole number of quarter hours, from UTC-12 to UTC+14.
  for (let offset = -15 * 60; offset <= 15 * 60; offset += 15) {
    const t = wall - offset * MINUTE;
    const local = localDateTime(zone, new Date(t));
    if (local.date === date && Math.round(local.hours * 60) === minutes && !found.includes(t)) {
      found.push(t);
    }
  }
  return found.sort((a, b) => a - b);
}

/** The first moment the clock in `zone` reads `hh:mm` on `date`. */
function localMoment(zone: string, date: string, hh: number, mm: number): number {
  const [first] = localMoments(zone, date, hh, mm);
  if (first === undefined) throw new Error(`${date} ${hh}:${mm} never happens in ${zone}`);
  return first;
}

/** The moment the server worked the answer out: today's snow is from then. */
const madeAt = (f: TodayResponse): number => Date.parse(f.snow!.days[0]!.from);
const dateOf = (f: TodayResponse): string => f.snow!.days[0]!.date;
const zoneOf = (f: TodayResponse): string => f.location.timezone;

/**
 * Where `value`, one of the answer's own snow objects, is in it: "snow.now", "snow.week",
 * "snow.days.1", "snow.ahead.2.today"; null for null. Throws for anything else, so a function
 * that returned a copy can't pass as one that returned the answer's.
 */
export function pathIn(res: TodayResponse | null, value: object | null): string | null {
  if (value === null) return null;
  const snow = res?.snow;
  const places: [string, unknown][] = snow
    ? [
        ['snow.now', snow.now],
        ['snow.week', snow.week],
        ...snow.days.map((d, i): [string, unknown] => [`snow.days.${i}`, d]),
        ...(snow.ahead ?? []).flatMap((a, i): [string, unknown][] => [
          [`snow.ahead.${i}.now`, a.now],
          [`snow.ahead.${i}.today`, a.today],
          [`snow.ahead.${i}.week`, a.week],
        ]),
      ]
    : [];
  const found = places.find(([, v]) => v === value);
  if (!found) throw new Error('Not one of the answer’s own snow objects');
  return found[0];
}

/**
 * `f` with the blocks at `paths` taken out, as an answer the server sent without them would be:
 * "rain" or "snow.now" leaves the field out, "snow.days.1" takes that item out of its list (any
 * after it move up), and "now.series.*" empties the list. A copy, so `f` itself is unchanged.
 */
export function withoutBlocks(f: Fixture, paths: readonly string[]): Fixture {
  const copy = JSON.parse(JSON.stringify(f)) as Fixture;
  for (const path of paths) {
    const keys = path.split('.');
    const last = keys.pop()!;
    const parent = keys.reduce<unknown>(
      (v, key) => (v as Record<string, unknown> | undefined)?.[key],
      copy,
    );
    if (Array.isArray(parent)) {
      const index = /^(0|[1-9]\d*)$/.test(last) ? Number(last) : -1;
      if (last === '*' && parent.length > 0) parent.length = 0;
      else if (index >= 0 && index < parent.length) parent.splice(index, 1);
      else throw new Error(`Nothing at ${path} to take out`);
    } else {
      const object = parent as Record<string, unknown> | undefined;
      if (!object || !(last in object)) throw new Error(`Nothing at ${path} to take out`);
      delete object[last];
    }
  }
  return copy;
}

/**
 * `pathIn` for an answer with blocks taken out (`withoutBlocks`), where the vectors name the
 * path in the whole fixture: throws unless the path names the same object there too, so taking
 * an item out of a list can't move the one a vector names.
 */
function pathInWhole(whole: Fixture, res: Fixture, value: object | null): string | null {
  const path = pathIn(res, value);
  if (path !== null && JSON.stringify(atPath(whole, path)) !== JSON.stringify(value)) {
    throw new Error(`${path} is another object in the whole fixture`);
  }
  return path;
}

/**
 * The blocks the clock rules fall back without, taken out of a fixture: rain (snow's today and
 * Now then say when the answer goes out of date), rain's Now or snow's too (the next UTC hour
 * then), the snow answer, the hours ahead (the hour the answer holds for then ends it), the
 * hot answer's Now (which says when the place's midnight is), and the hot answer's days or its
 * Now's hours, each list left empty (no date to be past, no last hour).
 */
const LEFT_OUT: readonly (readonly string[])[] = [
  ['rain'],
  ['rain.now'],
  ['rain', 'snow.now'],
  ['rain', 'snow'],
  ['snow'],
  ['snow.ahead'],
  ['now'],
  ['days.*'],
  ['now.series.*'],
];

/** Fixtures for the fallbacks: hours off the UTC hour, where they differ, and on it. */
const FALLBACK_FIXTURES = ['kolkata-0530', 'aberdeen-snow'] as const;

/** The object at `path` in `res` (`pathIn` read back). */
export function atPath(res: TodayResponse, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((v, key) => (v as Record<string, unknown> | undefined)?.[key], res);
}

// ---- grid.json ---------------------------------------------------------------------------------

function gridVectors(): VectorFile {
  const { cases, add } = collector();
  const round = (value: number, step: number) =>
    add('roundToGrid', { value, step }, roundToGrid(value, step));
  // Halves of the forecast grid either side of zero, then the spec's, then real places.
  for (let k = -8; k <= 8; k++) round(Number((k * 0.025).toFixed(3)), GRID.forecast);
  const forecast = [
    ...[-1.575, -1.525, -0.025, 0.025, 53.825, 179.975],
    ...[1.525, 1.575, 1.625, 2.675, -2.675, 0.075, -0.075, 53.775, 53.875, -53.825],
    // The antimeridian and the poles.
    ...[179.976, 179.99, 180, -179.975, -179.976, -179.99, -180],
    ...[89.975, 89.99, 90, -89.975, -89.99, -90],
    // Near a half, either side, and next to nothing.
    ...[0.0249999, 0.0250001, -0.0249999, -0.0250001, 1e-9, -1e-9, 0],
    // The fixtures' places, as the city list and a phone have them.
    ...[57.1437, -2.0981, 54.7768, -1.5757, 51.5085, -0.1257, 53.7965, -1.5478, 64.1355],
    ...[-21.8954, 22.5626, 88.363, 27.7172, 85.324, -34.9285, 138.6007, 1.8721, -157.4278],
    ...[39.7392, -104.9903],
  ];
  for (const value of forecast) round(value, GRID.forecast);
  // The climate cells (snapToCell) and the forecast's heights (forecastHeight).
  for (const value of [54.75, -54.75, 0.25, -0.25, 51.5085, 89.9, -89.9, 0.75]) {
    round(value, GRID.climate.lat);
  }
  for (const value of [0.3125, -0.3125, -1.5478, 179.6875, -179.6875, 0.9375, 2.8125]) {
    round(value, GRID.climate.lon);
  }
  for (const value of [0, 13, 24, 25, 26, -25, -26, 75, 125, -75, 958, 1337, -430, 8849]) {
    round(value, ELEVATION.step);
  }
  // Math.round's own edges (halves go up, and the largest double under a half is not one), and
  // toFixed's clean-up: steps JavaScript writes in other forms, and values too big for decimals.
  const edges: [number, number][] = [
    [0.49999999999999994, 1],
    [-0.49999999999999994, 1],
    [0.5, 1],
    [-0.5, 1],
    [2.5, 1],
    [-2.5, 1],
    [4503599627370497, 1],
    [-4503599627370497, 1],
    [0.25, 0.1],
    [0.15, 0.1],
    [-0.35, 0.1],
    [1.0005, 0.001],
    [2.675, 0.01],
    [1, 0.1 + 0.2],
    [0.00000012, 0.0000001],
    [0.00000037, 0.00000015],
    [0.0000051, 0.000001],
    [123456789.123456, 0.05],
    [4503599627370495.5, 0.05],
    [1e21, 0.05],
    [-1e21, 0.05],
    [1.5e300, 0.05],
    [5e-324, 0.05],
  ];
  for (const [value, step] of edges) round(value, step);
  return vectorFile([['core', 'roundToGrid']], cases);
}

// ---- target.json and query.json ----------------------------------------------------------------

/** Every form of target, with names that need escaping: &, +, $, /, accents and curly quotes. */
const TARGETS: readonly Target[] = [
  { kind: 'ip' },
  { kind: 'city', slug: 'leeds-gb' },
  { kind: 'city', slug: 'reykjavik-is', name: 'Reykjavík' },
  { kind: 'coords', source: 'device', lat: 53.8, lon: -1.55 },
  { kind: 'coords', source: 'device', lat: 0, lon: -105 },
  { kind: 'coords', source: 'device', lat: -90, lon: 180 },
  { kind: 'coords', source: 'search', lat: 39.75, lon: -105, name: 'Denver', country: 'US' },
  {
    kind: 'coords',
    source: 'search',
    lat: 46.45,
    lon: 7.15,
    name: 'Château-d’Œx',
    region: 'Vaud',
    country: 'CH',
    geonameId: 2661112,
    elevation: 958,
  },
  {
    kind: 'coords',
    source: 'search',
    lat: 51.2,
    lon: -2.65,
    name: 'Bath & Wells',
    region: 'Avon + Somerset',
    country: 'GB',
    elevation: 0,
  },
  {
    kind: 'coords',
    source: 'search',
    lat: 56.15,
    lon: -3.65,
    name: 'Dollar$ $& $1',
    region: null,
    country: null,
    geonameId: 0,
  },
  { kind: 'coords', source: 'search', lat: -31.95, lon: 115.85, name: 'C++ Town', elevation: -25 },
  {
    kind: 'coords',
    source: 'search',
    lat: 47.15,
    lon: 7.25,
    name: 'Biel/Bienne',
    region: 'Bern',
    country: 'CH',
  },
  { kind: 'coords', source: 'search', lat: 1.85, lon: -157.4, name: 'Kiritimati', country: 'KI' },
];

/** Search results as `/api/v1/search` gives them: with a city page, and without. */
const RESULTS: readonly SearchResult[] = [
  {
    name: 'Leeds',
    region: 'England',
    country: 'GB',
    countryName: 'United Kingdom',
    lat: 53.7965,
    lon: -1.5478,
    slug: 'leeds-gb',
    geonameId: 2644688,
    elevation: 50,
  },
  {
    name: 'Château-d’Œx',
    region: 'Vaud',
    country: 'CH',
    countryName: 'Switzerland',
    lat: 46.4747,
    lon: 7.1306,
    geonameId: 2661112,
    elevation: 958,
  },
  {
    name: 'Bath & Wells',
    region: null,
    country: null,
    countryName: null,
    lat: 51.2134,
    lon: -2.6474,
  },
  {
    name: 'Dollar$',
    region: 'Scotland',
    country: 'GB',
    countryName: 'United Kingdom',
    lat: 56.1625,
    lon: -3.6727,
    elevation: 0,
  },
  {
    name: 'Kiritimati',
    region: 'Line Islands',
    country: 'KI',
    countryName: 'Kiribati',
    lat: 1.8721,
    lon: -157.4278,
    geonameId: 4030939,
  },
  {
    name: 'C++ Town',
    region: null,
    country: 'AU',
    countryName: 'Australia',
    lat: -31.9505,
    lon: 115.8605,
    elevation: -25,
  },
  {
    name: 'Reykjavík',
    region: null,
    country: 'IS',
    countryName: 'Iceland',
    lat: 64.1355,
    lon: -21.8954,
    slug: 'reykjavik-is',
    geonameId: 3413829,
  },
];

/** `bytes` as the WHATWG urlencoded parser reads a name or value: "+" as a space, then %-escapes. */
function formDecode(bytes: Uint8Array): string {
  const hex = (b: number | undefined) =>
    b !== undefined &&
    ((b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66));
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x25 && hex(bytes[i + 1]) && hex(bytes[i + 2])) {
      out.push(parseInt(String.fromCharCode(bytes[i + 1]!, bytes[i + 2]!), 16));
      i += 2;
    } else {
      out.push(b === 0x2b ? 0x20 : b);
    }
  }
  // UTF-8 decode without BOM: a leading U+FEFF is kept, and broken UTF-8 replaced by U+FFFD.
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(Uint8Array.from(out));
}

/**
 * A query's pairs as the WHATWG URL standard's urlencoded parser reads them, as browsers and
 * IsItModel's `URLSearchParams` do: one leading "?" dropped, split on "&", empty pairs skipped,
 * the name before the first "=".
 */
export function specFormPairs(query: string): [string, string][] {
  const text = query.startsWith('?') ? query.slice(1) : query;
  const encoder = new TextEncoder();
  return text
    .split('&')
    .filter((pair) => pair !== '')
    .map((pair) => {
      const at = pair.indexOf('=');
      const [name, value] = at < 0 ? [pair, ''] : [pair.slice(0, at), pair.slice(at + 1)];
      return [formDecode(encoder.encode(name)), formDecode(encoder.encode(value))];
    });
}

/**
 * Throws unless `parse` (Node's `URLSearchParams`, which runs the reference here) reads `query`
 * as the standard does. Node 22's doesn't always: next to a %-escape that decodes to broken
 * UTF-8, it mangles raw non-ASCII characters in the same pair ("a=%FF€" gives two U+FFFD, where
 * the standard, browsers and the Swift give U+FFFD and €). A vector built on that would pin
 * Node's bug, so a query input must keep non-ASCII %-encoded wherever an escape in the same pair
 * is broken UTF-8, and this check stops the generator when one doesn't.
 */
export function assertSpecParse(
  query: string,
  parse: (q: string) => [string, string][] = (q) => [...new URLSearchParams(q)],
): void {
  if (JSON.stringify(parse(query)) !== JSON.stringify(specFormPairs(query))) {
    throw new Error(`Node reads ${JSON.stringify(query)} otherwise than the URL standard`);
  }
}

function targetVectors(): VectorFile {
  const { cases, add } = collector();
  for (const target of TARGETS) add('targetKey', { target }, targetKey(target));
  const phones: [number, number][] = [
    [53.7965, -1.5478],
    [51.5085, -0.1257],
    [0.0249, -0.0249],
    [0.025, -0.025],
    [-1.575, 179.975],
    [89.99, -179.99],
    [39.7392, -104.9903],
    [-34.9285, 138.6007],
  ];
  for (const [lat, lon] of phones) add('deviceTarget', { lat, lon }, deviceTarget(lat, lon));
  for (const result of RESULTS) add('searchTarget', { result }, searchTarget(result));
  // An empty slug is no city page; an empty name is kept, and the query leaves it out.
  const unnamed: SearchResult = {
    name: '',
    region: '',
    country: null,
    countryName: null,
    lat: 0.025,
    lon: -0.025,
    slug: '',
    geonameId: 0,
  };
  add('searchTarget', { result: unnamed }, searchTarget(unnamed));
  // What a notification carries is the today query's place: every target's, read back.
  const queries = [
    ...TARGETS.flatMap((t) => [todayQuery(t, 'c', { ahead: ['snow'] }), todayQuery(t, null)]),
    '',
    'units=c',
    'place=',
    'place=durham-gb&units=c&ahead=snow&t=495000',
    'lat=53.8',
    'lon=-1.55',
    'lat=53.8&lon=-1.55',
    'lat=53.8&lon=-1.55&source=web',
    'lat=53.80&lon=-1.550&source=device',
    'lat=91&lon=0',
    'lat=0&lon=181',
    'lat=1234&lon=0',
    'lat=1e1&lon=2',
    'lat=%2B53.8&lon=1',
    'lat=+53.8&lon=1',
    'lat=abc&lon=1',
    'lat=53.8&lon=-1.55&name=&region=&country=&source=search',
    'name=Bath+%26+Wells&source=search&lat=51.2&lon=-2.65',
    'lat=0&lon=0&geonameId=0&elevation=0&source=search',
    'lat=0&lon=0&geonameId=12345678901&source=search',
    'lat=0&lon=0&geonameId=12.5&source=search',
    'lat=0&lon=0&elevation=12345&source=search',
    'lat=0&lon=0&elevation=-25.5&source=search',
    'lat=53.8&lon=-1.55&name=Caf%C3%A9+%E2%80%9Cn%C2%BA1%E2%80%9D&source=search',
    'lat=53.8&lon=-1.55&name=a%2Bb+c&source=search',
    'place=leeds-gb&lat=53.8&lon=-1.55',
    // URLSearchParams' own reading: a leading "?", empty pairs, a pair without "=", the first of
    // a repeated name, "=" in a value, and broken escapes (kept) and UTF-8 (replaced).
    '?place=leeds-gb&units=c',
    '??place=leeds-gb',
    '&&lat=53.8&&lon=-1.55&',
    'place',
    'lat&lon=1',
    'lat=53.8&lat=10&lon=-1.55&lon=2',
    'lat=53.8&lon=-1.55&source=search&source=device',
    'lat=53.8&lon=-1.55&name=x&name=y&source=search',
    'lat=53.8&lon=-1.55&name=a=b&source=search',
    'lat=53.8&lon=-1.55&name=%zz%4%C3%28%E2%82&source=search',
    'lat=53.8&lon=-1.55&name=%EF%BB%BFBOM&source=search',
    'place=a+b%26c',
    'PLACE=leeds-gb',
    // The server's patterns: ASCII digits only, the whole value, and up to three before the point.
    'lat=53.8%0A&lon=1',
    'lat=%D9%A5%D9%A3&lon=1',
    'lat=53.&lon=1',
    'lat=.5&lon=1',
    'lat=-&lon=1',
    'lat=0.0000001&lon=-0.00005',
    'lat=90.0&lon=-180.000',
    'lat=-90.0001&lon=0',
    'lat=007&lon=0180',
    'lat=0&lon=0&geonameId=0000000042&source=search',
    'lat=0&lon=0&geonameId=9999999999&source=search',
    'lat=0&lon=0&geonameId=-1&source=search',
    'lat=0&lon=0&elevation=9999.99&source=search',
    'lat=0&lon=0&elevation=1e3&source=search',
  ];
  for (const query of queries) {
    assertSpecParse(query);
    add('targetFromQuery', { query }, targetFromQuery(query));
  }
  return vectorFile(
    [
      ['client', 'targetKey'],
      ['client', 'deviceTarget'],
      ['client', 'searchTarget'],
      ['client', 'targetFromQuery'],
    ],
    cases,
  );
}

function queryVectors(): VectorFile {
  const { cases, add } = collector();
  for (const target of TARGETS) {
    for (const units of ['c', 'f', null] as const) {
      for (const ahead of [[], ['snow']] as const) {
        add('todayQuery', { target, units, ahead }, todayQuery(target, units, { ahead }));
      }
    }
  }
  // The topics in core's order (TOPICS), once each, however they are asked for.
  for (const ahead of [
    ['wind', 'snow', 'hot', 'wet'],
    ['snow', 'snow'],
    ['wet', 'hot'],
  ] as const) {
    const target = TARGETS[1]!;
    add('todayQuery', { target, units: 'c', ahead }, todayQuery(target, 'c', { ahead }));
  }
  // What URLSearchParams escapes, and how JavaScript writes a number (String(n)): fixed or
  // exponential by size, with the shortest digits that read back.
  const awkward: Target[] = [
    { kind: 'city', slug: 'a b&c=d' },
    {
      kind: 'coords',
      source: 'search',
      lat: 0.0000001,
      lon: -0.00005,
      name: "a*b-c.d_e~f!g'h(i)j k",
      region: '',
      country: '',
      geonameId: 0,
      elevation: -25.5,
    },
    { kind: 'coords', source: 'device', lat: 53.8, lon: -1.55, name: '❄️ ⛄ 🏔', elevation: 0 },
    { kind: 'coords', source: 'search', lat: 0.000001, lon: -1.5e-7, name: 'Line\nbreak\ttab' },
    { kind: 'coords', source: 'search', lat: 0.1 + 0.2, lon: 5e-324, geonameId: 9999999999 },
    { kind: 'coords', source: 'search', lat: 123456789012345680000, lon: 1e21 },
    { kind: 'coords', source: 'device', lat: -1.5e21, lon: 1.7976931348623157e308 },
    { kind: 'coords', source: 'device', lat: 100, lon: -1e-6, elevation: 1234.5678 },
  ];
  for (const target of awkward) {
    add('todayQuery', { target, units: 'f', ahead: [] }, todayQuery(target, 'f'));
  }
  const moments = [
    0,
    Date.parse('2026-12-02T09:05:00Z'),
    Date.parse('2026-12-02T09:59:59.999Z'),
    Date.parse('2026-12-02T10:00:00Z'),
    Date.parse('2026-12-02T15:40:00.123Z'),
  ];
  for (const query of ['', 'place=leeds-gb&units=c', 'place=leeds-gb&units=c&ahead=snow']) {
    for (const now of moments) add('freshQuery', { query, now }, freshQuery(query, now));
  }
  const searches = [
    'Leeds',
    'São Paulo',
    'Bath & Wells',
    'C++',
    'St John’s',
    "St John's",
    'Dollar$',
    'Biel/Bienne',
    '50% off',
    '  Leeds  ',
    '',
    "!*'()~-_.",
    '❄ Snow',
    'a=b&c=d',
    '#1?',
    '🏔 Ben Nevis',
    'tab\tnew\nline',
  ];
  for (const q of searches) add('searchQuery', { q }, searchQuery(q));
  return vectorFile(
    [
      ['client', 'todayQuery'],
      ['client', 'freshQuery'],
      ['client', 'searchQuery'],
    ],
    cases,
  );
}

// ---- placeTime.json ----------------------------------------------------------------------------

/** The fixtures' zones, a named zone with the same offset as one, and two unknown ones. */
const ZONES = [
  'Europe/London',
  'Etc/GMT+1',
  'Etc/GMT+7',
  'America/Denver',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Australia/Adelaide',
  'Pacific/Kiritimati',
  'UTC',
];

function placeTimeVectors(): VectorFile {
  const { cases, add } = collector();
  const at = (timezone: string, now: number) =>
    add('localDateTime', { timezone, now }, localDateTime(timezone, new Date(now)));
  // Both clock changes in London, minute by minute where it matters, and to the second.
  const london = [
    '2026-10-24T22:59:59.999Z',
    '2026-10-24T23:00:00Z',
    '2026-10-24T23:30:00Z',
    '2026-10-25T00:00:00Z',
    '2026-10-25T00:30:00Z',
    '2026-10-25T00:59:59Z',
    '2026-10-25T01:00:00Z',
    '2026-10-25T01:30:00Z',
    '2026-10-25T02:00:00Z',
    '2026-10-25T17:59:00Z',
    '2026-10-25T18:00:00Z',
    '2027-03-28T00:00:00Z',
    '2027-03-28T00:30:00Z',
    '2027-03-28T00:59:59Z',
    '2027-03-28T01:00:00Z',
    '2027-03-28T01:30:00Z',
    '2027-03-28T16:59:00Z',
    '2027-03-28T17:00:00Z',
    '2027-03-28T22:59:59Z',
    '2027-03-28T23:00:00Z',
    '2026-12-16T23:59:59.999Z',
    '2026-12-17T00:00:00Z',
  ];
  for (const iso of london) at('Europe/London', Date.parse(iso));
  // 17:59, 18:00, 23:59 and midnight at each place on 2 December, and 17:59:59.
  for (const zone of ZONES) {
    for (const [hh, mm] of [
      [17, 59],
      [18, 0],
      [23, 59],
    ] as const) {
      at(zone, localMoment(zone, '2026-12-02', hh, mm));
    }
    at(zone, localMoment(zone, '2026-12-03', 0, 0));
    at(zone, localMoment(zone, '2026-12-02', 17, 59) + 59_999);
  }
  // A time zone the system doesn't know: UTC, as core falls back.
  for (const timezone of ['Mars/Olympus_Mons', 'Not a zone']) {
    for (const iso of ['2026-12-02T17:59:59Z', '2026-12-02T23:59:00Z', '2026-12-03T00:00:00Z']) {
      at(timezone, Date.parse(iso));
    }
  }
  at('UTC', 0);
  at('Europe/London', Date.parse('2028-02-29T12:34:56Z'));
  return vectorFile([['core', 'localDateTime']], cases);
}

// ---- tomorrow.json -----------------------------------------------------------------------------

function tomorrowVectors(fixtures: FixtureSet): VectorFile {
  const { cases, add } = collector();
  for (const [name, f] of fixtures) {
    const zone = zoneOf(f);
    const date = dateOf(f);
    const next = addDays(date, 1);
    const moments = [
      localMoment(zone, date, 17, 59),
      localMoment(zone, date, 18, 0),
      localMoment(zone, date, 23, 59),
      // The answer is for yesterday from midnight, at 6pm too.
      localMoment(zone, next, 0, 0),
      localMoment(zone, next, 18, 0),
      // And a clock a day behind.
      localMoment(zone, addDays(date, -1), 18, 0),
    ];
    for (const now of moments) {
      add('showsTomorrow', { fixture: name, now }, showsTomorrow(f, now));
      add('defaultView', { fixture: name, now }, defaultView(f, now));
    }
  }
  for (const view of VIEWS) {
    for (const tomorrow of [false, true]) {
      add('viewLabel', { view, tomorrow }, viewLabel(view, tomorrow));
    }
  }
  return vectorFile(
    [
      ['core', 'showsTomorrow'],
      ['core', 'defaultView'],
      ['core', 'viewLabel'],
    ],
    cases,
  );
}

// ---- freshness.json ----------------------------------------------------------------------------

function freshnessVectors(fixtures: FixtureSet): VectorFile {
  const { cases, add } = collector();
  for (const [name, f] of fixtures) {
    const fixture = { fixture: name };
    const hour = hourUntil(f);
    const day = dayUntil(f);
    const until = usableUntil(f);
    add('hourUntil', fixture, hour);
    add('dayUntil', fixture, day);
    add('usableUntil', fixture, until);
    const made = madeAt(f);
    // Clocks slow and fast by 5 minutes and 2 hours, and either side of each boundary.
    const moments = [made - 2 * HOUR, made - 5 * MINUTE, made, made + 5 * MINUTE, made + 2 * HOUR];
    for (const t of [hour, day, until]) {
      if (t !== null) moments.push(t - 1, t, t + 5 * MINUTE);
    }
    for (const now of moments) {
      add('nextRefreshAt', { ...fixture, now, jitterMs: 0 }, nextRefreshAt(f, now, 0));
      add('hold', { ...fixture, holds: {}, now }, hold({}, f, now));
      add('outOfDate', { ...fixture, now, holds: {} }, outOfDate(f, now, {}));
    }
    // A clock 5 minutes past the hour or midnight, or 2 hours fast, when the answer arrives:
    // the holds it gets, then out of date or not until each is reached.
    const fast = [made + 2 * HOUR];
    for (const t of [hour, day]) if (t !== null) fast.push(t + 5 * MINUTE);
    for (const now of fast) {
      const holds = hold({}, f, now);
      for (const held of Object.values(holds) as { until: number; at: number }[]) {
        for (const later of [now, now + MINUTE, held.at - 1, held.at]) {
          add('outOfDate', { ...fixture, now: later, holds }, outOfDate(f, later, holds));
        }
      }
    }
    const jitter = CLIENT.refreshJitterMs;
    add(
      'nextRefreshAt',
      { ...fixture, now: made, jitterMs: jitter },
      nextRefreshAt(f, made, jitter),
    );
    add(
      'nextRefreshAt',
      { ...fixture, now: made, jitterMs: 12_345 },
      nextRefreshAt(f, made, 12_345),
    );
    // A hold kept from before, for a moment that isn't this answer's: kept, and not used.
    const kept: Holds = { day: { until: made - DAY, at: made - DAY + 5 * MINUTE } };
    add('hold', { ...fixture, holds: kept, now: made }, hold(kept, f, made));
    add('outOfDate', { ...fixture, now: made, holds: kept }, outOfDate(f, made, kept));
  }
  // The fallbacks, at the moments the whole answer's rules turn on: when it was made, two hours
  // fast, and five minutes past its hour and its midnight, with the holds each gets.
  for (const name of FALLBACK_FIXTURES) {
    const full = fixtures.get(name);
    if (!full) throw new Error(`No fixture ${name}`);
    const made = madeAt(full);
    const moments = [made, made + 2 * HOUR];
    for (const t of [hourUntil(full), dayUntil(full)]) if (t !== null) moments.push(t + 5 * MINUTE);
    for (const without of LEFT_OUT) {
      const f = withoutBlocks(full, without);
      const fixture = { fixture: name, without };
      add('hourUntil', fixture, hourUntil(f));
      add('dayUntil', fixture, dayUntil(f));
      add('usableUntil', fixture, usableUntil(f));
      for (const now of moments) {
        add('nextRefreshAt', { ...fixture, now, jitterMs: 0 }, nextRefreshAt(f, now, 0));
        add('hold', { ...fixture, holds: {}, now }, hold({}, f, now));
        add('outOfDate', { ...fixture, now, holds: {} }, outOfDate(f, now, {}));
        const holds = hold({}, f, now);
        for (const held of Object.values(holds) as { until: number; at: number }[]) {
          for (const later of [held.at - 1, held.at]) {
            add('outOfDate', { ...fixture, now: later, holds }, outOfDate(f, later, holds));
          }
        }
      }
    }
  }
  return vectorFile(
    [
      ['client', 'hourUntil'],
      ['client', 'dayUntil'],
      ['client', 'usableUntil'],
      ['client', 'hold'],
      ['client', 'outOfDate'],
      ['client', 'nextRefreshAt'],
    ],
    cases,
  );
}

// ---- hours.json --------------------------------------------------------------------------------

/**
 * Moments to pick an hour at: clocks behind the answer and its first hour ahead, each minute
 * boundary of the hours ahead, past the last of them and the stale cut-off, and 22:00 to 23:59.
 */
function hourMoments(f: Fixture): number[] {
  const made = madeAt(f);
  const zone = zoneOf(f);
  const date = dateOf(f);
  const until = usableUntil(f);
  const ahead = (f.snow!.ahead ?? []).map((a) => Date.parse(a.time));
  const moments = new Set([
    made - 2 * HOUR,
    made - 5 * MINUTE,
    made,
    made + 5 * MINUTE,
    Date.parse(f._fixture.now),
    until - MINUTE,
    until,
    until + MINUTE,
  ]);
  for (const t of ahead) for (const d of [-MINUTE, -1, 0, 30 * MINUTE]) moments.add(t + d);
  const last = ahead.at(-1);
  if (last !== undefined) for (const d of [HOUR - MINUTE, HOUR]) moments.add(last + d);
  for (const [hh, mm] of [
    [22, 0],
    [22, 30],
    [23, 0],
    [23, 30],
    [23, 59],
  ] as const) {
    for (const t of localMoments(zone, date, hh, mm)) moments.add(t);
  }
  moments.add(localMoment(zone, addDays(date, 1), 0, 0));
  return [...moments].sort((a, b) => a - b);
}

function hoursVectors(fixtures: FixtureSet): VectorFile {
  const { cases, add } = collector();
  /**
   * pickHour at `now` for the fixture `name`, without the blocks `without` lists, and middleDay
   * for the hour it picks.
   */
  const pick = (name: string, now: number, without?: readonly string[]): void => {
    const whole = fixtures.get(name);
    if (!whole) throw new Error(`No fixture ${name}`);
    const f = without ? withoutBlocks(whole, without) : whole;
    const input = without ? { fixture: name, without, now } : { fixture: name, now };
    const path = (value: object | null) => pathInWhole(whole, f, value);
    const picked = pickHour(f, now);
    add(
      'pickHour',
      input,
      picked && {
        start: picked.start,
        end: picked.end,
        now: path(picked.now),
        today: path(picked.today),
        week: path(picked.week),
        source: picked.source,
      },
    );
    // `picked` is pickHour's for the same answer and moment.
    if (picked) {
      const { slot, day } = middleDay(f, picked, now);
      add('middleDay', input, { slot, day: path(day) });
    }
  };
  for (const [name, f] of fixtures) for (const now of hourMoments(f)) pick(name, now);
  // Without hours ahead the answer's own hold until its hour ends, and without snow none do.
  for (const name of FALLBACK_FIXTURES) {
    const full = fixtures.get(name);
    if (!full) throw new Error(`No fixture ${name}`);
    const noAhead = withoutBlocks(full, ['snow.ahead']);
    for (const now of hourMoments(noAhead)) pick(name, now, ['snow.ahead']);
    const made = madeAt(full);
    for (const now of [made, made + HOUR]) pick(name, now, ['snow']);
    // An answer whose snow has no days: its own today is none.
    for (const now of [made - 5 * MINUTE, made]) pick(name, now, ['snow.ahead', 'snow.days.*']);
  }
  // From 6pm, an answer whose snow has no tomorrow, where the hot answer has: no middle day.
  const durham = fixtures.get('durham-tomorrow');
  if (!durham) throw new Error('No fixture durham-tomorrow');
  for (const now of [madeAt(durham), localMoment(zoneOf(durham), dateOf(durham), 23, 30)]) {
    pick('durham-tomorrow', now, ['snow.days.1']);
  }
  // The Updated line, from each fixture's `updatedAt` and a few more, on the day and the next.
  const updates: [string, string][] = [...fixtures.values()].map((f) => [f.updatedAt, zoneOf(f)]);
  updates.push(
    ['2026-12-01T23:40:00.000Z', 'Europe/London'],
    ['2026-10-24T23:10:00.000Z', 'Europe/London'],
    ['2027-03-28T16:30:00.000Z', 'Europe/London'],
    ['2026-12-02T18:20:00.000Z', 'Asia/Kathmandu'],
    ['2026-12-02T10:00:00.000Z', 'Pacific/Kiritimati'],
    ['2026-12-02T23:59:00.000Z', 'Mars/Olympus_Mons'],
  );
  for (const [iso, zone] of updates) {
    const updated = updatedParts(iso, zone);
    for (const today of [addDays(updated.date, -1), updated.date, addDays(updated.date, 1)]) {
      const line = updatedLine(updated, today);
      // Core's own rule, from the moment itself: the two must agree.
      if (line !== updatedTime(iso, zone, today)) {
        throw new Error(`updatedLine and core updatedTime disagree for ${iso} in ${zone}`);
      }
      add('updatedLine', { updated, today }, line);
    }
  }
  return vectorFile(
    [
      ['client', 'pickHour'],
      ['client', 'middleDay'],
      ['client', 'updatedLine'],
    ],
    cases,
  );
}

// ---- questions.json and strip.json -------------------------------------------------------------

/** Place names, with the ones a replacement pattern or an interpolation would trip on. */
const CITIES = [
  null,
  '',
  'Leeds',
  'Reykjavík',
  "St John's",
  'St John’s',
  'Bath & Wells',
  'Dollar$',
  '$& $1 $$ $`',
  '{place}',
  '\\(place)',
];

function questionVectors(): VectorFile {
  const { cases, add } = collector();
  for (const city of CITIES) {
    for (const view of VIEWS) {
      for (const tomorrow of [false, true]) {
        add('question', { city, view, tomorrow }, question(city, view, 'snow', tomorrow));
      }
    }
  }
  return vectorFile([['core', 'question']], cases);
}

function stripVectors(fixtures: FixtureSet): VectorFile {
  const { cases, add } = collector();
  for (const [name, f] of fixtures) {
    for (const tomorrow of [false, true]) {
      const display = viewDisplay(f, 'snow', 'today', 'ready', { tomorrow });
      add('viewDisplay', { fixture: name, tomorrow }, display.models);
    }
  }
  // An answer without snow: a strip with nothing on it.
  const aberdeen = fixtures.get('aberdeen-snow');
  if (!aberdeen) throw new Error('No fixture aberdeen-snow');
  const noSnow = withoutBlocks(aberdeen, ['snow']);
  for (const tomorrow of [false, true]) {
    const display = viewDisplay(noSnow, 'snow', 'today', 'ready', { tomorrow });
    add('viewDisplay', { fixture: 'aberdeen-snow', without: ['snow'], tomorrow }, display.models);
  }
  return vectorFile([['core', 'viewDisplay']], cases);
}

// ---- widget.json -------------------------------------------------------------------------------

function widgetVectors(fixtures: FixtureSet): VectorFile {
  const { cases, add } = collector();
  const fx = (name: string): Fixture => {
    const f = fixtures.get(name);
    if (!f) throw new Error(`No fixture ${name}`);
    return f;
  };
  const plan = (
    name: string | null,
    now: number,
    o: {
      fetchedAt?: number;
      unlocked?: boolean;
      placeName?: string;
      without?: readonly string[];
    } = {},
  ): void => {
    const whole = name === null ? null : fx(name);
    const f = whole && o.without ? withoutBlocks(whole, o.without) : whole;
    const options = {
      fetchedAt: o.fetchedAt ?? (whole ? madeAt(whole) : now - HOUR),
      now,
      unlocked: o.unlocked ?? true,
      ...(o.placeName === undefined ? {} : { placeName: o.placeName }),
    };
    const { entries, reloadAt } = widgetEntries(f, options);
    const day = (e: WidgetEntry) => (whole && f ? pathInWhole(whole, f, e.day) : pathIn(f, e.day));
    add(
      'widgetEntries',
      { fixture: name, ...(o.without ? { without: o.without } : {}), ...options },
      { entries: entries.map((e) => ({ ...e, day: day(e) })), reloadAt },
    );
  };
  const local = (name: string, days: number, hh: number, mm: number): number[] => {
    const f = fx(name);
    return localMoments(zoneOf(f), addDays(dateOf(f), days), hh, mm);
  };

  // Every answer, planned when it was fetched (the old one when the app finds it).
  for (const [name, f] of fixtures) plan(name, madeAt(f));
  plan('old-forecast', Date.parse(fx('old-forecast')._fixture.now));

  // London on an ordinary day at 17:59, 18:00, 23:30 and 00:30, from answers fetched that
  // morning, at midday, in the evening and at night.
  for (const name of ['leeds-dry', 'ip-first-launch', 'durham-tomorrow', 'forecast-ends']) {
    for (const now of [
      ...local(name, 0, 17, 59),
      ...local(name, 0, 18, 0),
      ...local(name, 0, 23, 30),
      ...local(name, 1, 0, 30),
    ]) {
      plan(name, now);
    }
  }
  // Both clock-change days at 00:30, 01:30 (twice in October; on 28 March there is no 1:30am,
  // so 01:30 UTC, 2:30am BST), 17:59 and 18:00.
  for (const name of [
    'london-dst-autumn-night',
    'london-dst-autumn-evening',
    'london-dst-spring-night',
    'london-dst-spring-evening',
  ]) {
    const date = dateOf(fx(name));
    const moments = [
      ...local(name, 0, 0, 30),
      ...local(name, 0, 1, 30),
      ...local(name, 0, 17, 59),
      ...local(name, 0, 18, 0),
    ];
    if (date === '2027-03-28') moments.push(Date.parse('2027-03-28T01:30:00Z'));
    for (const now of moments) plan(name, now);
  }
  // 6pm where the hours start off the UTC hour, and past midnight.
  for (const name of ['kolkata-0530', 'kathmandu-0545', 'adelaide-1030', 'kiritimati-14']) {
    for (const now of [...local(name, 0, 17, 59), ...local(name, 0, 18, 0)]) plan(name, now);
    for (const now of [...local(name, 1, 0, 0), ...local(name, 1, 0, 30)]) plan(name, now);
  }
  plan('kolkata-0530', local('kolkata-0530', 0, 23, 59)[0]!);
  // Older than the stale limit: planned up to the cut-off, then from it.
  const old = fx('old-forecast');
  const cutoff = usableUntil(old);
  for (const now of [madeAt(old) + 5 * HOUR, cutoff - MINUTE, cutoff]) plan('old-forecast', now);
  plan('stale', usableUntil(fx('stale')) - 30 * MINUTE);
  // The last hour ahead ends first.
  const ends = fx('forecast-ends');
  for (const now of [usableUntil(ends) - MINUTE, usableUntil(ends)]) plan('forecast-ends', now);
  // Reloads: past the planned one (a retry in an hour), and from an answer fetched later.
  const aberdeen = madeAt(fx('aberdeen-snow'));
  plan('aberdeen-snow', aberdeen + 4 * HOUR + MINUTE);
  plan('aberdeen-snow', aberdeen + 3 * HOUR, { fetchedAt: aberdeen + 3 * HOUR });
  // Locked, with no answer, and with the place's name the app keeps.
  plan('aberdeen-snow', aberdeen, { unlocked: false });
  plan('durham-tomorrow', madeAt(fx('durham-tomorrow')), { unlocked: false, placeName: 'Home' });
  plan(null, aberdeen, { unlocked: false });
  plan(null, aberdeen);
  plan(null, aberdeen, { placeName: 'Aberdeen' });
  plan('aberdeen-snow', aberdeen, { placeName: 'Home' });
  // Without hours ahead: entries from the answer's own Now, today and week, when it was fetched
  // and at 6pm (a clock behind in Kolkata, past the hour it holds for in Aberdeen).
  for (const name of FALLBACK_FIXTURES) {
    for (const now of [madeAt(fx(name)), ...local(name, 0, 18, 0)]) {
      plan(name, now, { without: ['snow.ahead'] });
    }
  }
  // From 6pm, an answer whose snow has no tomorrow, where the hot answer has: no middle day, so
  // the week from its first day and the nosnow palette.
  for (const now of [madeAt(fx('durham-tomorrow')), ...local('durham-tomorrow', 0, 23, 30)]) {
    plan('durham-tomorrow', now, { without: ['snow.days.1'] });
  }
  return vectorFile([['client', 'widgetEntries']], cases);
}

// ---- alerts.json -------------------------------------------------------------------------------

const PREFS = {
  both: { evening: true, morning: true, possible: false },
  evening: { evening: true, morning: false, possible: false },
  morning: { evening: false, morning: true, possible: true },
  all: { evening: true, morning: true, possible: true },
  possibleOnly: { evening: false, morning: false, possible: true },
  off: { evening: false, morning: false, possible: false },
} satisfies Record<string, AlertPrefs>;

/** Places someone chose, in every form a registration names. */
const PLACES: readonly PlaceTarget[] = [
  { kind: 'city', slug: 'durham-gb' },
  { kind: 'city', slug: 'reykjavik-is', name: 'Reykjavík' },
  { kind: 'coords', source: 'device', lat: 53.8, lon: -1.55 },
  { kind: 'coords', source: 'search', lat: 39.75, lon: -105, name: 'Denver', country: 'US' },
  {
    kind: 'coords',
    source: 'search',
    lat: 47.15,
    lon: 7.25,
    name: 'Biel/Bienne',
    region: 'Bern',
    country: 'CH',
    geonameId: 2661513,
    elevation: 437,
  },
  {
    kind: 'coords',
    source: 'search',
    lat: 51.2,
    lon: -2.65,
    name: 'Bath & Wells “Ünïcode”',
    region: null,
    country: null,
    geonameId: 0,
    elevation: 0,
  },
  // A searched place the search couldn't name, as searchTarget keeps it (an empty name, region
  // and geonameId), and one with no name at all: the registration leaves each out.
  {
    kind: 'coords',
    source: 'search',
    lat: 0.05,
    lon: -0.05,
    name: '',
    region: '',
    country: null,
    geonameId: 0,
  },
  { kind: 'coords', source: 'search', lat: -33.85, lon: 151.2, region: '', country: '' },
];

function alertVectors(): VectorFile {
  const { cases, add } = collector();
  for (const target of [null, { kind: 'ip' } as const, ...PLACES]) {
    add('alertPlaceAllowed', { target }, alertPlaceAllowed(target));
  }
  const bodies = [];
  for (const place of PLACES) {
    for (const [prefs, env, units] of [
      [PREFS.both, 'production', 'c'],
      [PREFS.morning, 'sandbox', 'f'],
    ] as const) {
      const input = { token: 'a1b2c3d4e5f6', env, place, units, prefs, appVersion: '1.0 (42)' };
      const body = registrationBody(input);
      add('registrationBody', input, body);
      bodies.push(body);
    }
  }
  // A token with what JSON.stringify escapes (the quote, the backslash and the control
  // characters) and what it writes as it is (the slash, DEL, U+2028, accents and emoji).
  const awkward = {
    token: 'q"b\\s/\b\t\n\f\r\u0001\u001f\u007f\u2028é😀',
    env: 'sandbox',
    place: PLACES[4]!,
    units: 'c',
    prefs: PREFS.all,
    appVersion: '1.0 (42)',
  } as const;
  const awkwardBody = registrationBody(awkward);
  add('registrationBody', awkward, awkwardBody);
  bodies.push(awkwardBody);
  for (const body of bodies) add('fingerprint', { body }, fingerprint(body));

  const now = Date.parse('2026-12-16T18:05:00Z');
  const base = {
    prefs: PREFS.both as AlertPrefs,
    permission: 'authorized' as Permission,
    token: 'a1b2c3d4e5f6' as string | null,
    place: PLACES[0]! as Target | null,
    units: 'c' as Units,
    env: 'production' as PushEnv,
    appVersion: '1.0 (42)',
  };
  const sent = fingerprint(
    registrationBody({
      token: 'a1b2c3d4e5f6',
      env: 'production',
      place: PLACES[0]!,
      units: 'c',
      prefs: PREFS.both,
      appVersion: '1.0 (41)',
    }),
  );
  const heartbeat = 7 * DAY;
  const lastAt = (at: number) => ({ fingerprint: sent, at });
  const recent = lastAt(now - DAY);
  const action = (
    change: Partial<typeof base> & { last: { fingerprint: string; at: number } | null },
  ) => {
    const o = { ...base, now, ...change };
    add('alertAction', o, alertAction(o));
  };
  // 1. Every switch off ("possible" alone switches nothing on): delete what was sent, if anything.
  for (const prefs of [PREFS.off, PREFS.possibleOnly]) {
    for (const last of [null, recent]) action({ prefs, last });
  }
  // 2. Permission denied: the same, before anything else is asked for.
  for (const last of [null, recent]) {
    action({ permission: 'denied', last });
    action({ permission: 'denied', place: null, token: null, last });
  }
  // 3. No place chosen: ask for one, before the token.
  for (const place of [null, { kind: 'ip' } as const]) {
    action({ place, last: null });
    action({ place, token: null, last: recent });
  }
  // 4. No push token yet.
  for (const token of [null, '']) action({ token, last: null });
  // 5. Nothing sent, something changed, or the heartbeat is due: send it.
  action({ last: null });
  action({ last: { fingerprint: 'something else', at: now - DAY } });
  action({ last: lastAt(now - heartbeat) });
  action({ last: lastAt(now - heartbeat + 1) });
  action({ last: lastAt(now - heartbeat - 1) });
  action({ last: lastAt(now + HOUR) });
  action({ units: 'f', last: recent });
  action({ env: 'sandbox', last: recent });
  action({ token: 'f6e5d4c3b2a1', last: recent });
  action({ prefs: PREFS.evening, last: recent });
  action({ prefs: PREFS.all, last: recent });
  action({ place: PLACES[1]!, last: recent });
  action({ place: PLACES[2]!, last: recent });
  // 6. Otherwise nothing: an app update alone is no reason to send it again.
  action({ last: recent });
  action({ appVersion: '1.1 (50)', last: recent });
  for (const permission of ['provisional', 'notDetermined'] as const) {
    action({ permission, last: recent });
    action({ permission, last: null });
  }
  return vectorFile(
    [
      ['client', 'alertPlaceAllowed'],
      ['client', 'registrationBody'],
      ['client', 'fingerprint'],
      ['client', 'alertAction'],
    ],
    cases,
  );
}

// ---- links.json --------------------------------------------------------------------------------

/** `o` without `key`, as a payload that never had it. */
function without<T extends object>(o: T, key: keyof T): Partial<T> {
  const copy: Partial<T> = { ...o };
  delete copy[key];
  return copy;
}

function linkVectors(): VectorFile {
  const { cases, add } = collector();
  const urls = [
    'willitsnow://view/now',
    'willitsnow://view/today',
    'willitsnow://view/week',
    'willitsnow://view/now/',
    'WILLITSNOW://VIEW/WEEK',
    '  willitsnow://view/today\n',
    'willitsnow://view/today?from=widget',
    'willitsnow://view/week#top',
    'willitsnow://view/now?',
    'willitsnow://upgrade',
    'willitsnow://upgrade/',
    'willitsnow://upgrade?from=widget',
    'willitsnow://settings/notifications',
    'willitsnow://Settings/Notifications/',
    'willitsnow://view',
    'willitsnow://view/',
    'willitsnow://view/tomorrow',
    'willitsnow://view/now/extra',
    'willitsnow://view//now',
    'willitsnow://view/n0w',
    'willitsnow://upgrade/now',
    'willitsnow://settings',
    'willitsnow://settings/privacy',
    'willitsnow://',
    'willitsnow:/view/now',
    'willitsnow:view/now',
    'willitsnow//view/now',
    'isithot://view/now',
    'https://willitsnow.today/view/now',
    'willitsnow://view/now willitsnow://upgrade',
    '',
    // What JavaScript's trim takes off (no-break spaces, U+FEFF, U+2028) and doesn't (U+0085),
    // and a Kelvin sign, which lowercases to k.
    '\u00a0\ufeffwillitsnow://view/now\u2028',
    '\u0085willitsnow://view/now',
    'willitsnow://view/wee\u212a',
  ];
  for (const url of urls) add('parseDeepLink', { url }, parseDeepLink(url));

  const durham = {
    topic: 'snow',
    kind: 'evening',
    date: '2026-12-17',
    view: 'today',
    place: 'place=durham-gb',
    name: 'Durham',
  };
  const route = (payload: unknown, placeToday: string | null) => {
    // The payload's place is a query the reference reads with URLSearchParams.
    const place = (payload as { place?: unknown } | null)?.place;
    if (typeof place === 'string') assertSpecParse(place);
    add(
      'notificationRoute',
      { payload, placeToday },
      notificationRoute(payload, () => placeToday),
    );
  };
  // The day the notification is about, from two days before it to two after; or not known.
  for (const today of [
    '2026-12-15',
    '2026-12-16',
    '2026-12-17',
    '2026-12-18',
    '2026-12-19',
    null,
  ]) {
    route(durham, today);
  }
  route({ ...durham, view: 'now' }, '2026-12-16');
  route({ ...durham, view: 'week' }, '2026-12-18');
  route({ ...durham, kind: 'morning', date: '2026-12-16' }, '2026-12-16');
  route(without(durham, 'name'), '2026-12-16');
  route({ ...durham, name: '' }, '2026-12-16');
  route({ ...durham, name: 42 }, '2026-12-16');
  const device = 'lat=53.8&lon=-1.55&source=device';
  const denver = 'lat=39.75&lon=-105&name=Denver&country=US&source=search';
  route({ ...durham, place: device, name: 'Leeds' }, '2026-12-17');
  route({ ...durham, place: denver, name: 'Somewhere else', date: '2027-01-29' }, '2027-01-28');
  route({ ...durham, place: 'place=leeds-gb&units=c&ahead=snow' }, '2026-12-17');
  // A leap day; and the place's date as Date.parse reads it: not a date at all, and a day past
  // the month's end, which rolls over ("2026-11-31" is 1 December).
  route({ ...durham, date: '2028-02-29' }, '2028-02-28');
  route(durham, 'not a date');
  route({ ...durham, date: '2026-12-01' }, '2026-11-30');
  route({ ...durham, date: '2026-12-01' }, '2026-11-31');
  // Malformed, for another topic, or for no place someone chose: the app opens as usual.
  for (const payload of [
    null,
    'snow',
    42,
    true,
    [],
    {},
    { ...durham, topic: 'wet' },
    without(durham, 'topic'),
    { ...durham, date: '2026-02-30' },
    { ...durham, date: '2027-02-29' },
    { ...durham, date: '2026-12-17T00:00:00Z' },
    { ...durham, date: '17/12/2026' },
    { ...durham, date: 20261217 },
    { ...durham, view: 'tomorrow' },
    without(durham, 'view'),
    { ...durham, place: 42 },
    { ...durham, place: '' },
    { ...durham, place: 'units=c' },
    { ...durham, place: 'place=' },
    { ...durham, place: 'lat=91&lon=0' },
  ]) {
    route(payload, '2026-12-16');
  }
  return vectorFile(
    [
      ['client', 'parseDeepLink'],
      ['client', 'notificationRoute'],
    ],
    cases,
  );
}

// ---- recent.json -------------------------------------------------------------------------------

function recentVectors(): VectorFile {
  const { cases, add } = collector();
  const place = (target: PlaceTarget, name: string): RecentPlace => ({ target, name });
  const leeds = place({ kind: 'city', slug: 'leeds-gb' }, 'Leeds');
  const durham = place({ kind: 'city', slug: 'durham-gb', name: 'Durham' }, 'Durham');
  const phone = place({ kind: 'coords', source: 'device', lat: 53.8, lon: -1.55 }, 'Leeds');
  const searched = place(
    { kind: 'coords', source: 'search', lat: 53.8, lon: -1.55, name: 'Leeds' },
    'Leeds',
  );
  const denver = place(
    { kind: 'coords', source: 'search', lat: 39.75, lon: -105, name: 'Denver', country: 'US' },
    'Denver',
  );
  const more = ['aberdeen-gb', 'shrewsbury-gb', 'reykjavik-is', 'kolkata-in', 'london-gb'].map(
    (slug) => place({ kind: 'city', slug }, slug),
  );
  const addTo = (list: RecentPlace[], target: Target, name: string, max?: number) =>
    add(
      'addRecent',
      { list, target, name, ...(max === undefined ? {} : { max }) },
      addRecent(list, target, name, max),
    );
  addTo([], leeds.target, 'Leeds');
  addTo([leeds, durham], leeds.target, 'Leeds');
  addTo([leeds, durham], durham.target, 'Durham');
  addTo([leeds, durham], { kind: 'city', slug: 'durham-gb' }, 'Durham, again');
  // The same place found again keeps one entry; the same point by another route is another.
  addTo([phone, leeds], searched.target, 'Leeds');
  addTo([searched, leeds], phone.target, 'Your location');
  addTo([searched], { ...denver.target }, 'Denver');
  addTo([denver, searched], { ...denver.target, name: 'Denver, Colorado' }, 'Denver, Colorado');
  // The cap: 5, or another.
  addTo(more, denver.target, 'Denver');
  addTo(more, more[4]!.target, 'London');
  addTo(more, denver.target, 'Denver', 3);
  addTo(more, denver.target, 'Denver', 1);
  addTo(more, denver.target, 'Denver', 0);
  addTo(more, denver.target, 'Denver', -1);
  // Approximate IP location is never one, and a list longer than the cap is cut to it.
  addTo([leeds], { kind: 'ip' }, 'Your location');
  addTo([...more, leeds, durham], { kind: 'ip' }, 'Leeds');
  addTo([], { kind: 'ip' }, 'Leeds');
  const removeFrom = (list: RecentPlace[], target: Target) =>
    add('removeRecent', { list, target }, removeRecent(list, target));
  removeFrom([leeds, durham, phone], durham.target);
  removeFrom([leeds, durham, phone], { kind: 'city', slug: 'durham-gb' });
  removeFrom([leeds, durham, phone], searched.target);
  removeFrom([leeds, durham, phone, searched], { ...searched.target, name: 'Elsewhere' });
  removeFrom([leeds, durham], { kind: 'ip' });
  removeFrom([], leeds.target);
  return vectorFile(
    [
      ['client', 'addRecent'],
      ['client', 'removeRecent'],
    ],
    cases,
  );
}

/**
 * Every vector file, in the spec's order, from `fixtures` (each as its file has it). Throws
 * when a fixture a vector needs is missing.
 */
export function vectorFiles(fixtures: FixtureSet): NamedVectors[] {
  return [
    { name: 'grid', vectors: gridVectors() },
    { name: 'target', vectors: targetVectors() },
    { name: 'query', vectors: queryVectors() },
    { name: 'placeTime', vectors: placeTimeVectors() },
    { name: 'tomorrow', vectors: tomorrowVectors(fixtures) },
    { name: 'freshness', vectors: freshnessVectors(fixtures) },
    { name: 'hours', vectors: hoursVectors(fixtures) },
    { name: 'questions', vectors: questionVectors() },
    { name: 'strip', vectors: stripVectors(fixtures) },
    { name: 'widget', vectors: widgetVectors(fixtures) },
    { name: 'alerts', vectors: alertVectors() },
    { name: 'links', vectors: linkVectors() },
    { name: 'recent', vectors: recentVectors() },
  ];
}

/** Throws on a number JSON can't hold (it would be written as null) and on a hole in a list. */
function strict(this: unknown, key: string, value: unknown): unknown {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`${key} is ${value}, which JSON can't hold`);
  }
  if (value === undefined && Array.isArray(this)) {
    throw new Error(`A list holds undefined at ${key}`);
  }
  return value;
}

/**
 * A vector file as it is written: JSON with one case to a line, so a changed case is a changed
 * line, then a newline.
 */
export function vectorJson(vectors: VectorFile): string {
  const lines = vectors.cases.map((c) => `    ${JSON.stringify(c, strict)}`);
  return [
    '{',
    `  "fn": ${JSON.stringify(vectors.fn)},`,
    `  "source": ${JSON.stringify(vectors.source)},`,
    '  "cases": [',
    lines.join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
}
