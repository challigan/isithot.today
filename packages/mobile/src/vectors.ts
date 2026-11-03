/**
 * The golden vectors (iOS build spec, section 7.4): inputs, and what the TypeScript reference in
 * packages/core and packages/client gives for them, which the Swift ports in IsItCore must give
 * too, and for the app's page (`page.json`), what `page.ts` here makes of core's and the client's.
 * Every output here comes from calling the reference; none is written by hand. Pure: the
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
  ALERTS,
  ATTRIBUTION,
  COPY,
  ELEVATION,
  ERROR_MESSAGES,
  GRID,
  HOUR,
  VIEWS,
  WIDGET,
  creditParts,
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
  PLACES as PLACE_LISTS,
  addRecent,
  alertAction,
  alertsActive,
  bellState,
  canSave,
  choosePlace,
  dayUntil,
  deviceTarget,
  fingerprint,
  freshQuery,
  hereKind,
  hereName,
  herePlace,
  hold,
  hourUntil,
  isSaved,
  keptBells,
  middleDay,
  nextRefreshAt,
  notificationRoute,
  outOfDate,
  ownsSaved,
  parseDeepLink,
  pickHour,
  registrationBody,
  removeRecent,
  replyZones,
  resultDetail,
  routeLink,
  savePlace,
  savedForBody,
  savedLines,
  searchInput,
  searchQuery,
  searchTarget,
  setAlert,
  setBell,
  shownRecent,
  syncReply,
  tapBell,
  targetFromQuery,
  targetKey,
  testOutcome,
  todayQuery,
  unsavePlace,
  updatedLine,
  usableUntil,
  widgetEntries,
  widgetFallsBack,
  widgetReuses,
  type AlertPrefs,
  type AlertSwitch,
  type DeviceReply,
  type HerePlace,
  type Holds,
  type KeptCell,
  type LocationAccess,
  type Permission,
  type PlaceLists,
  type PlaceTarget,
  type PushEnv,
  type RecentPlace,
  type Route,
  type SavedAnswer,
  type SavedPlace,
  type SavedTarget,
  type Target,
  type WidgetEntry,
} from '@isithot/client';
import { APP_COPY } from './appCopy';
import type { Fixture } from './fixtures';
import { homePage, homeTopBar, type PageInput, type PagePhase } from './page';
import { widgetFace } from './widgetFace';

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
  fns: readonly (readonly ['core' | 'client' | 'mobile', string])[],
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

// ---- page.json ---------------------------------------------------------------------------------

/** Credits with something to split, or nothing: the API's own come first. */
const CREDITS = [
  ...ATTRIBUTION,
  '',
  'No links here',
  'NASA POWERNASA POWER',
  'CC BY-SA 4.0 and CC BY 4.0, then Weather data by Open-Meteo.com.',
  'Météo-France · NASA POWER ©',
];

/** The fixtures the page is checked at more moments than their own, for each state they show. */
const PAGE_FIXTURES = [
  'aberdeen-snow',
  'durham-tomorrow',
  'leeds-dry',
  'stale',
  'no-now',
  'no-week',
  'limited',
  'denver-f',
  'kathmandu-0545',
  'old-forecast',
  'forecast-ends',
] as const;

const PHASES: readonly PagePhase[] = ['loading', 'ready', 'error', 'offline', 'limited'];

/**
 * A screen the app's UI tests open (WillItSnowUITests, phase 5.4): the fixture the app is
 * launched on, or null for nothing saved; the moment its clock reads (`-now`, epoch ms); how its
 * request went; the place's name when the top bar names another than the answer's (a place under
 * "Nearby:"); and whether that place is approximate IP location, as every UI test's first launch
 * is (`-resetStore`). page.json has each screen's three pages and its top bar, and
 * `HomeScreens.json` hands them to the tests (exportHomeScreens.ts), so no test types what a
 * page says.
 */
export interface HomeScreenSpec {
  name: string;
  fixture: string | null;
  now: number;
  phase: PagePhase;
  placeName?: string;
  approximate: boolean;
}

/**
 * How long before 6pm, or before the saved answer's hours end, a UI test's running clock starts.
 */
export const RUNNING_LEAD_MS = 2 * MINUTE;

/**
 * Every screen the UI tests open: HomeTests' three fixtures at their own moments, Durham either
 * side of 6pm and from two minutes before it as the clock runs, and the first place under
 * "Nearby:"; OfflineTests' saved answer an hour on with no connection, its last two minutes and
 * its end (`usableUntil`) offline, a failed request over it, and nothing saved with no
 * connection; and the two pages PickerTests open the picker over. The two clocks that run start `RUNNING_LEAD_MS` before their moment, so that a
 * slow launch on the CI's simulator can't pass it before the test has read the screen before it.
 */
export function homeScreens(fixtures: FixtureSet): HomeScreenSpec[] {
  const get = (name: string): Fixture => {
    const f = fixtures.get(name);
    if (!f) throw new Error(`No fixture ${name}`);
    return f;
  };
  const own = (name: string): number => Date.parse(get(name)._fixture.now);
  const screens: HomeScreenSpec[] = ['aberdeen-snow', 'durham-tomorrow', 'leeds-dry'].map(
    (name) => ({ name, fixture: name, now: own(name), phase: 'ready', approximate: true }),
  );
  const durham = get('durham-tomorrow');
  const evening = (hh: number, mm: number) => localMoment(zoneOf(durham), dateOf(durham), hh, mm);
  const durhamAt = (name: string, now: number): HomeScreenSpec => ({
    name,
    fixture: 'durham-tomorrow',
    now,
    phase: 'ready',
    approximate: true,
  });
  screens.push(
    durhamAt('durham-before-6pm', evening(17, 59)),
    durhamAt('durham-at-6pm', evening(18, 0)),
    durhamAt('durham-flip-start', evening(18, 0) - RUNNING_LEAD_MS),
  );
  const aberdeen = get('aberdeen-snow');
  const nearby = aberdeen.nearby?.[0]?.name;
  if (!nearby) throw new Error('aberdeen-snow has no place nearby');
  const first = aberdeen.snow?.ahead?.[0];
  if (!first) throw new Error('aberdeen-snow has no hours ahead');
  const until = usableUntil(aberdeen);
  const at = (name: string, now: number, phase: PagePhase): HomeScreenSpec => ({
    name,
    fixture: 'aberdeen-snow',
    now,
    phase,
    approximate: true,
  });
  screens.push(
    // A place under "Nearby:" is a city page's, so no longer approximate.
    {
      ...at('aberdeen-snow-nearby', own('aberdeen-snow'), 'ready'),
      placeName: nearby,
      approximate: false,
    },
    at('aberdeen-snow-hour-ahead-offline', Date.parse(first.time) + 30 * MINUTE, 'offline'),
    at('aberdeen-snow-last-minutes-offline', until - RUNNING_LEAD_MS, 'offline'),
    at('aberdeen-snow-past-offline', until, 'offline'),
    at('aberdeen-snow-unavailable', own('aberdeen-snow') + 15 * MINUTE, 'error'),
    {
      name: 'nothing-offline',
      fixture: null,
      now: own('aberdeen-snow'),
      phase: 'offline',
      approximate: true,
    },
    // The pages PickerTests open the picker over, whose band it wears and whose palette its
    // audit's contrast proof reads: Leeds by IP on the first launch, and Leeds chosen from a
    // search, a city page, both at the first launch's moment, where those tests' clock starts.
    {
      name: 'picker-first-launch',
      fixture: 'ip-first-launch',
      now: own('ip-first-launch'),
      phase: 'ready',
      approximate: true,
    },
    {
      name: 'picker-leeds',
      fixture: 'leeds-dry',
      now: own('ip-first-launch'),
      phase: 'ready',
      approximate: false,
    },
  );
  return screens;
}

/** The top bar a screen shows: its place's name, or the answer's, on its kind of place. */
export function screenTopBar(
  fixtures: FixtureSet,
  screen: HomeScreenSpec,
): { placeName: string | null; approximate: boolean; notice: null } {
  const res = screen.fixture === null ? null : fixtures.get(screen.fixture);
  return {
    placeName: screen.placeName ?? res?.location.name ?? null,
    approximate: screen.approximate,
    notice: null,
  };
}

function pageVectors(fixtures: FixtureSet): VectorFile {
  const { cases, add } = collector();
  for (const text of CREDITS) add('creditParts', { text }, creditParts(text));

  /** The page for every view, for the fixture `name` (or no answer) without `without`. */
  const page = (
    name: string | null,
    o: Omit<PageInput, 'view'>,
    without?: readonly string[],
  ): void => {
    const whole = name === null ? null : fixtures.get(name);
    if (whole === undefined) throw new Error(`No fixture ${name}`);
    const f = whole && without ? withoutBlocks(whole, without) : whole;
    for (const view of VIEWS) {
      const input: PageInput = { ...o, view };
      const content = homePage(f, input);
      add(
        'homePage',
        { fixture: name, ...(without ? { without } : {}), ...input },
        { ...content, shown: whole && f ? pathInWhole(whole, f, content.shown) : null },
      );
    }
  };
  // Every answer at its own moment.
  for (const [name, f] of fixtures) page(name, { now: Date.parse(f._fixture.now), phase: 'ready' });
  // An hour ahead, the last minute it can be shown, and past it.
  for (const name of PAGE_FIXTURES) {
    const f = fixtures.get(name);
    if (!f) throw new Error(`No fixture ${name}`);
    const until = usableUntil(f);
    const first = f.snow?.ahead?.[0];
    const moments = [until - MINUTE, until];
    if (first) moments.unshift(Date.parse(first.time) + 30 * MINUTE);
    for (const now of moments) page(name, { now, phase: 'ready' });
  }
  // Durham across 6pm, when the middle view turns to tomorrow, and without a tomorrow then.
  const durham = fixtures.get('durham-tomorrow');
  if (!durham) throw new Error('No fixture durham-tomorrow');
  const evening = [17 * 60 + 59, 18 * 60].map((m) =>
    localMoment(zoneOf(durham), dateOf(durham), Math.floor(m / 60), m % 60),
  );
  for (const now of evening) page('durham-tomorrow', { now, phase: 'ready' });
  page('durham-tomorrow', { now: Date.parse(durham._fixture.now), phase: 'ready' }, [
    'snow.days.1',
  ]);
  // How the last request went, the place's name given or empty, and blocks taken out.
  const aberdeen = fixtures.get('aberdeen-snow');
  if (!aberdeen) throw new Error('No fixture aberdeen-snow');
  const at = Date.parse(aberdeen._fixture.now);
  for (const phase of PHASES) page('aberdeen-snow', { now: at, phase });
  // The server's own message, which differs from COPY.unavailable: over an answer the page still
  // says forecasts are unavailable; with none it says the message.
  const message = ERROR_MESSAGES.bad_location;
  page('aberdeen-snow', { now: at, phase: 'error', message });
  page('aberdeen-snow', { now: at, phase: 'ready', placeName: 'Old Aberdeen' });
  page('aberdeen-snow', { now: at, phase: 'ready', placeName: '' });
  page('aberdeen-snow', { now: at, phase: 'offline' }, ['updated']);
  page('aberdeen-snow', { now: at, phase: 'ready' }, ['snow']);
  const stale = fixtures.get('stale');
  if (!stale) throw new Error('No fixture stale');
  // A stale answer after each kind of failure: the offline and unavailable lines beat the stale
  // line; rate limited keeps it.
  for (const phase of ['offline', 'error', 'limited'] as const) {
    page('stale', { now: Date.parse(stale._fixture.now), phase });
  }
  // A view with nothing to show after a failure keeps the footer's line and Retry.
  const noNow = fixtures.get('no-now');
  if (!noNow) throw new Error('No fixture no-now');
  page('no-now', { now: Date.parse(noNow._fixture.now), phase: 'error' });
  // Past usableUntil, no line and no Retry, whatever the failure.
  const old = fixtures.get('old-forecast');
  if (!old) throw new Error('No fixture old-forecast');
  for (const phase of ['offline', 'error', 'limited'] as const) {
    page('old-forecast', { now: Date.parse(old._fixture.now), phase });
  }
  // No answer yet: asking, or failed; with the server's message, or an empty one.
  for (const phase of PHASES) {
    page(null, { now: at, phase });
    page(null, { now: at, phase, placeName: 'Leeds' });
  }
  page(null, { now: at, phase: 'error', message, placeName: 'Leeds' });
  page(null, { now: at, phase: 'error', message: '' });
  // Every screen the UI tests open (HomeScreens.json), each page and its top bar.
  const topBar = (placeName: string | null, approximate: boolean, notice: string | null) =>
    add(
      'homeTopBar',
      { placeName, approximate, notice },
      homeTopBar(placeName, approximate, notice),
    );
  for (const screen of homeScreens(fixtures)) {
    const { fixture, now, phase, placeName } = screen;
    page(fixture, placeName === undefined ? { now, phase } : { now, phase, placeName });
    const bar = screenTopBar(fixtures, screen);
    topBar(bar.placeName, bar.approximate, bar.notice);
  }
  // The top bar before the place is known, on a chosen place, and with the notice that the
  // city page's place has gone.
  for (const placeName of [null, '', 'Leeds']) {
    for (const approximate of [true, false]) topBar(placeName, approximate, null);
  }
  topBar(null, true, APP_COPY.slugGone);
  topBar('Leeds', false, APP_COPY.slugGone);
  return vectorFile(
    [
      ['mobile', 'homePage'],
      ['mobile', 'homeTopBar'],
      ['core', 'creditParts'],
    ],
    cases,
  );
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

const ACCESSES: readonly LocationAccess[] = ['granted', 'denied', 'notDetermined'];

/**
 * What the app may have as this launch's fix: none; the phone's own, as `deviceTarget` makes it;
 * the phone's, finer and named, which only its cell leaves; one not on Earth; and places that
 * aren't the phone's, which are never a fix.
 */
const FIXES: readonly (Target | null)[] = [
  null,
  deviceTarget(53.8, -1.55),
  { kind: 'coords', source: 'device', lat: 53.8123, lon: -1.5561, name: 'Leeds', country: 'GB' },
  { kind: 'coords', source: 'device', lat: 95, lon: 0 },
  { kind: 'coords', source: 'search', lat: 39.75, lon: -105, name: 'Denver', country: 'US' },
  { kind: 'city', slug: 'durham-gb', name: 'Durham' },
  { kind: 'ip' },
];

/** What `alerts.v2` may keep as the phone's last cell: none, a cell, a finer point, a bad one. */
const KEPT: readonly (KeptCell | null)[] = [
  null,
  { lat: 54.75, lon: -1.6 },
  { lat: 54.7712, lon: -1.5713 },
  { lat: 91, lon: 0 },
];

/**
 * Where you are, as registrations send it: approximate; the phone's cell; and a cell given more
 * than its point (and south and east of zero), of which only the point is sent.
 */
const HERES: readonly HerePlace[] = [
  { kind: 'ip' },
  { kind: 'device', target: deviceTarget(53.8, -1.55) },
  {
    kind: 'device',
    target: {
      kind: 'coords',
      source: 'device',
      lat: -33.85,
      lon: 151.2,
      name: 'Sydney',
      region: 'New South Wales',
      country: 'AU',
    },
  },
];

/** The server's 200 to a version 2 PUT whose connection it located in Leeds. */
const REPLY: DeviceReply = {
  id: '3f9c1a2b4d5e6f708192a3b4c5d6e7f8',
  deviceTz: null,
  here: {
    name: 'Leeds',
    timezone: 'Europe/London',
    query: 'lat=53.8&lon=-1.55&source=device',
    country: 'GB',
    follows: 'ip',
  },
  saved: [],
  refused: [],
  alerts: { snow: PREFS.evening },
  seenAt: '2026-12-01T09:05:00.000Z',
};
const DURHAM = {
  pid: '1a2b3c4d5e6f',
  name: 'Durham',
  timezone: 'Europe/London',
  query: 'place=durham-gb',
  country: 'GB',
};
const KATHMANDU = {
  pid: '0f1e2d3c4b5a',
  name: 'Kathmandu',
  timezone: 'Asia/Kathmandu',
  query: 'lat=27.7&lon=85.3&name=Kathmandu&country=NP&source=search',
  country: 'NP',
};

/**
 * Saved places as the picker keeps them, for the bells (8.4b): a city page; a searched place
 * with every word; one with none it can send (an empty name, no region or country, GeoNames id
 * 0) but a height of 0; one with its point alone; one whose words JSON escapes, or writes as
 * they are; and eleven towns, one more than a device may have.
 */
const SAVED_DURHAM: SavedPlace = {
  target: { kind: 'city', slug: 'durham-gb', name: 'Durham' },
  name: 'Durham',
  detail: 'England, United Kingdom',
};
const SAVED_KATHMANDU: SavedPlace = {
  target: {
    kind: 'coords',
    source: 'search',
    lat: 27.7,
    lon: 85.3,
    name: 'Kathmandu',
    region: 'Bagmati Province',
    country: 'NP',
    geonameId: 1283240,
    elevation: 1337,
  },
  name: 'Kathmandu',
  detail: 'Bagmati Province, Nepal',
};
const SAVED_SPARSE: SavedPlace = {
  target: {
    kind: 'coords',
    source: 'search',
    lat: 66.5,
    lon: 25.7,
    name: '',
    region: null,
    country: null,
    geonameId: 0,
    elevation: 0,
  },
  name: 'Rovaniemi',
};
const SAVED_BARE: SavedPlace = {
  target: { kind: 'coords', source: 'search', lat: -33.85, lon: 151.2 },
  name: 'Sydney',
};
const SAVED_AWKWARD: SavedPlace = {
  target: {
    kind: 'coords',
    source: 'search',
    lat: -45.05,
    lon: 168.65,
    name: 'Lac "Bleu" / \\ Ü 😀\u0001',
    region: 'Otago & Southland',
    country: 'NZ',
  },
  name: 'Lac Bleu',
};
const SAVED_TOWNS: readonly SavedPlace[] = Array.from({ length: 11 }, (_, i) => ({
  target: { kind: 'city', slug: `town-${i}-gb` },
  name: `Town ${i}`,
}));
/** What can't be saved, or sent: the phone's point, a point not on Earth, cities with no slug. */
const SAVED_ODD: readonly SavedPlace[] = [
  { target: deviceTarget(53.8, -1.55), name: 'Leeds' },
  { target: { kind: 'coords', source: 'search', lat: 95, lon: 0, name: 'Nowhere' }, name: 'X' },
  { target: { kind: 'city', slug: '' }, name: 'Empty' },
  { target: { kind: 'city', slug: '  ' }, name: 'Blank' },
];
const keysOf = (saved: readonly SavedPlace[]): string[] => saved.map((s) => targetKey(s.target));

function alertVectors(): VectorFile {
  const { cases, add } = collector();
  // Where you are: every location access, with every kind of fix and every kept cell.
  for (const access of ACCESSES) {
    for (const fix of FIXES) {
      for (const kept of KEPT) {
        add('herePlace', { access, fix, kept }, herePlace({ access, fix, kept }));
      }
    }
  }

  const bodies = [];
  for (const here of HERES) {
    for (const [prefs, env, units] of [
      [PREFS.both, 'production', 'c'],
      [PREFS.morning, 'sandbox', 'f'],
    ] as const) {
      const input = { token: 'a1b2c3d4e5f6', env, here, units, prefs, appVersion: '1.0 (42)' };
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
    here: HERES[1]!,
    units: 'c',
    prefs: PREFS.all,
    appVersion: '1.0 (42)',
  } as const;
  const awkwardBody = registrationBody(awkward);
  add('registrationBody', awkward, awkwardBody);
  bodies.push(awkwardBody);
  // With saved places (8.4b): none, one (a city page, a searched place), one of every kind and
  // ten, with the phone's zone and without; a zone given with none, or empty, is never sent.
  const sendAll = (saved: readonly SavedPlace[]) => savedForBody(saved, keysOf(saved), true);
  const every = sendAll([SAVED_DURHAM, SAVED_KATHMANDU, SAVED_SPARSE, SAVED_BARE, SAVED_AWKWARD]);
  const ten = sendAll(SAVED_TOWNS.slice(0, 10));
  const sets: Array<[readonly SavedTarget[], string | null]> = [
    [[], 'Europe/London'],
    [sendAll([SAVED_DURHAM]), 'Europe/London'],
    [sendAll([SAVED_DURHAM]), null],
    [sendAll([SAVED_DURHAM]), ''],
    [sendAll([SAVED_KATHMANDU]), 'Asia/Kathmandu'],
    [every, 'Europe/London'],
    [every, null],
    [ten, 'Europe/London'],
    [ten, null],
  ];
  for (const here of HERES.slice(0, 2)) {
    for (const [saved, deviceTz] of sets) {
      const input = {
        token: 'a1b2c3d4e5f6',
        env: 'production',
        here,
        units: 'c',
        prefs: PREFS.both,
        appVersion: '1.0 (42)',
        saved,
        deviceTz,
      } as const;
      const body = registrationBody(input);
      add('registrationBody', input, body);
      bodies.push(body);
    }
  }
  for (const body of bodies) add('fingerprint', { body }, fingerprint(body));

  const now = Date.parse('2026-12-16T18:05:00Z');
  const refresh = ALERTS.hereRefreshMinutes * MINUTE;
  const heartbeat = 7 * DAY;
  const ip = HERES[0]!;
  const cell = HERES[1]!;
  const base = {
    prefs: PREFS.both as AlertPrefs,
    permission: 'authorized' as Permission,
    token: 'a1b2c3d4e5f6' as string | null,
    here: ip,
    units: 'c' as Units,
    refused: null as { fingerprint: string; at: number } | null,
    activeAt: now,
    env: 'production' as PushEnv,
    appVersion: '1.0 (42)',
  };
  /** What was last sent for `here`, by an earlier version of the app. */
  const sentFor = (here: HerePlace) =>
    fingerprint(registrationBody({ ...base, token: base.token!, here, appVersion: '1.0 (41)' }));
  const sentIp = (at: number) => ({ fingerprint: sentFor(ip), at });
  const sentCell = (at: number) => ({ fingerprint: sentFor(cell), at });
  // Sent earlier in this visit, and the phone's cell yesterday: nothing due.
  const recent = sentIp(now - 30 * MINUTE);
  const action = (
    change: Partial<typeof base> & {
      last: { fingerprint: string; at: number } | null;
      saved?: readonly SavedTarget[];
      deviceTz?: string | null;
    },
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
    action({ permission: 'denied', token: null, last });
  }
  // 3. No push token yet; never a place to ask for, as where you are is always one.
  for (const token of [null, '']) action({ token, last: null });
  action({ token: null, here: cell, last: recent });
  // 4. Nothing sent, or something changed: send it.
  action({ last: null });
  action({ here: cell, last: null });
  action({ last: { fingerprint: 'something else', at: now - MINUTE } });
  action({ units: 'f', last: recent });
  action({ env: 'sandbox', last: recent });
  action({ token: 'f6e5d4c3b2a1', last: recent });
  action({ prefs: PREFS.evening, last: recent });
  action({ prefs: PREFS.all, last: recent });
  action({ here: cell, last: recent });
  action({ here: HERES[2]!, last: sentCell(now - DAY) });
  action({ last: sentCell(now - DAY) });
  // 5. The phone's cell: again once a week, whenever the app became active.
  for (const ago of [DAY, heartbeat - 1, heartbeat, heartbeat + 1, -HOUR]) {
    action({ here: cell, last: sentCell(now - ago) });
  }
  // 6. Approximate: again on becoming active an hour or more after it was sent, so the server
  // locates the connection afresh; later in the visit too, until it has been sent; once sent in
  // this visit, not until the next, however long the visit, but weekly.
  for (const activeAt of [now, now - 20 * MINUTE]) {
    for (const gap of [refresh - 1, refresh, refresh + 1, 6 * DAY]) {
      action({ activeAt, last: sentIp(activeAt - gap) });
    }
  }
  action({ activeAt: now - 3 * HOUR, last: sentIp(now - 2 * HOUR) });
  action({ activeAt: now - heartbeat - HOUR, last: sentIp(now - heartbeat + 1) });
  action({ activeAt: now - heartbeat - HOUR, last: sentIp(now - heartbeat) });
  action({ last: sentIp(now + HOUR) });
  // 7. Refused (the server couldn't tell where you are, and forgot the set): not the same set
  // again until the app becomes active again or the set changes; a delete or a token wait as ever.
  const refusal = { fingerprint: sentFor(ip), at: now - MINUTE };
  for (const activeAt of [now - 2 * MINUTE, now - MINUTE, now]) {
    action({ refused: refusal, activeAt, last: null });
  }
  action({ refused: refusal, activeAt: now - 2 * MINUTE, here: cell, last: null });
  action({ refused: refusal, activeAt: now - 2 * MINUTE, prefs: PREFS.evening, last: null });
  action({ refused: refusal, activeAt: now - 2 * MINUTE, units: 'f', last: null });
  action({ refused: refusal, activeAt: now - 2 * MINUTE, prefs: PREFS.off, last: recent });
  action({ refused: refusal, activeAt: now - 2 * MINUTE, token: null, last: null });
  // The set last sent, refused since: neither the hourly refresh nor the heartbeat sends it
  // again in this visit, whether or not the app kept what it last sent; the next visit does.
  for (const last of [sentIp(now - 2 * HOUR), sentIp(now - heartbeat)]) {
    for (const activeAt of [now - 2 * MINUTE, now]) action({ refused: refusal, activeAt, last });
  }
  // 8. Otherwise nothing: an app update alone is no reason to send it again.
  action({ last: recent });
  action({ appVersion: '1.1 (50)', last: recent });
  for (const permission of ['provisional', 'notDetermined'] as const) {
    action({ permission, last: recent });
    action({ permission, last: null });
  }
  // 9. Saved places with a bell on (8.4b), as savedForBody gives them, with the phone's zone.
  const both = savedForBody(
    [SAVED_DURHAM, SAVED_KATHMANDU],
    keysOf([SAVED_DURHAM, SAVED_KATHMANDU]),
    true,
  );
  const zone = 'Europe/London';
  const sentSet = (here: HerePlace, saved: readonly SavedTarget[], deviceTz: string | null) =>
    fingerprint(
      registrationBody({
        ...base,
        token: base.token!,
        here,
        saved,
        deviceTz,
        appVersion: '1.0 (41)',
      }),
    );
  const sentBoth = (at: number, here: HerePlace = ip) => ({
    fingerprint: sentSet(here, both, zone),
    at,
  });
  // The same set: nothing. The first bells, or a restore: send. A bell off, an unsave, a refund
  // (none sent, whatever bells are kept), a zone gone: send.
  action({ saved: both, deviceTz: zone, last: sentBoth(now - 30 * MINUTE) });
  action({ saved: both, deviceTz: zone, last: recent });
  action({ saved: both.slice(1), deviceTz: zone, last: sentBoth(now - 30 * MINUTE) });
  action({ saved: [], deviceTz: zone, last: sentBoth(now - 30 * MINUTE) });
  action({ last: sentBoth(now - 30 * MINUTE) });
  action({ saved: both, deviceTz: null, last: sentBoth(now - 30 * MINUTE) });
  // The phone's zone: sent again with a saved place, and never for itself alone.
  action({ saved: both, deviceTz: 'America/Vancouver', last: sentBoth(now - 30 * MINUTE) });
  action({ saved: [], deviceTz: 'America/Vancouver', last: recent });
  // One set of switches for every place: every switch off or the permission denied deletes the
  // whole set, whatever bells are on.
  for (const prefs of [PREFS.off, PREFS.possibleOnly]) {
    action({ prefs, saved: both, deviceTz: zone, last: sentBoth(now - 30 * MINUTE) });
    action({ prefs, saved: both, deviceTz: zone, last: null });
  }
  action({ permission: 'denied', saved: both, deviceTz: zone, last: sentBoth(now - MINUTE) });
  // Where you are, refreshed as ever: hourly while approximate, else weekly.
  for (const gap of [refresh - 1, refresh, heartbeat]) {
    action({ saved: both, deviceTz: zone, last: sentBoth(now - gap) });
    action({ here: cell, saved: both, deviceTz: zone, last: sentBoth(now - gap, cell) });
  }

  for (const prefs of Object.values(PREFS)) {
    for (const which of ['evening', 'morning', 'possible'] satisfies AlertSwitch[]) {
      for (const on of [true, false]) {
        add('setAlert', { prefs, which, on }, setAlert(prefs, which, on));
      }
    }
  }

  // What the devices replies mean: every case of the client's tests. The fixtures the real
  // handlers made (Fixtures/Devices) are checked against the same functions on their own.
  const json = (o: unknown) => JSON.stringify(o);
  const error = (code: unknown, message?: unknown) => json({ error: { code, message } });
  const sync = (status: number, text: string, retryAfter: string | null = null) =>
    add('syncReply', { status, text, retryAfter }, syncReply(status, text, retryAfter));
  const here = REPLY.here!;
  const fromPhone = { ...REPLY, here: { ...here, follows: 'device' as const } };
  const withSaved = { ...REPLY, deviceTz: 'Europe/London', saved: [DURHAM, KATHMANDU] };
  const away = { ...REPLY, here: null, saved: [{ ...KATHMANDU, country: null }] };
  const refused = { ...REPLY, saved: [DURHAM], refused: [{ index: 1, code: 'not_found' }] };
  // The phone far from any town, mid-Atlantic, as the server answers it: core's "Your
  // location", and no country.
  const atSea = {
    ...REPLY,
    here: {
      name: COPY.yourLocation,
      timezone: 'Etc/GMT+2',
      query: 'lat=0&lon=-30&source=device',
      country: null,
      follows: 'device' as const,
    },
  };
  for (const reply of [REPLY, fromPhone, withSaved, away, refused, atSea]) sync(200, json(reply));
  // `refused` left out; fields it doesn't know, at every level.
  const { refused: _, ...unlisted } = REPLY;
  sync(200, json(unlisted));
  sync(
    200,
    json({
      ...REPLY,
      tz: 'Europe/London',
      here: { ...here, locatedAt: '2026-12-01T09:05:00.000Z' },
      saved: [{ ...DURHAM, slot: 'x' }],
      refused: [{ index: 3, code: 'not_found', why: 'gone' }],
      alerts: { snow: { ...REPLY.alerts.snow, loud: true }, wind: {} },
    }),
  );
  // 8.1's answer, which names one place.
  sync(
    200,
    json({
      id: REPLY.id,
      place: { name: 'Leeds', timezone: 'Europe/London', query: 'place=leeds-gb' },
      alerts: REPLY.alerts,
      seenAt: REPLY.seenAt,
    }),
  );
  const without = (key: keyof DeviceReply) => {
    const copy: Record<string, unknown> = { ...REPLY };
    delete copy[key];
    return copy;
  };
  // A place's country may be null, but never left out.
  const { country: _hereCountry, ...hereNoCountry } = here;
  const { country: _durhamCountry, ...durhamNoCountry } = DURHAM;
  for (const wrong of [
    { ...REPLY, id: REPLY.id.slice(1) },
    { ...REPLY, id: REPLY.id.toUpperCase() },
    { ...REPLY, id: 42 },
    without('deviceTz'),
    { ...REPLY, deviceTz: 0 },
    without('here'),
    { ...REPLY, here: [] },
    { ...REPLY, here: 'Leeds' },
    { ...REPLY, here: { ...here, name: 1 } },
    { ...REPLY, here: { ...here, timezone: null } },
    { ...REPLY, here: { ...here, query: 7 } },
    { ...REPLY, here: { ...here, country: 44 } },
    { ...REPLY, here: { name: 'Leeds', timezone: 'Europe/London', query: here.query } },
    { ...REPLY, here: { ...here, follows: 'search' } },
    { ...REPLY, here: hereNoCountry },
    without('saved'),
    { ...REPLY, saved: null },
    { ...REPLY, saved: { 0: DURHAM } },
    { ...REPLY, saved: [null] },
    { ...REPLY, saved: [{ ...DURHAM, pid: '1a2b3c4d5e6' }] },
    { ...REPLY, saved: [{ ...DURHAM, pid: '1A2B3C4D5E6F' }] },
    { ...REPLY, saved: [{ ...DURHAM, pid: 12 }] },
    { ...REPLY, saved: [DURHAM, { ...KATHMANDU, name: null }] },
    { ...REPLY, saved: [{ ...DURHAM, timezone: 1 }] },
    { ...REPLY, saved: [{ ...DURHAM, query: null }] },
    { ...REPLY, saved: [{ ...DURHAM, country: false }] },
    { ...REPLY, saved: [durhamNoCountry] },
    { ...REPLY, saved: [{ pid: DURHAM.pid, name: 'Durham', timezone: 'Europe/London' }] },
    { ...REPLY, refused: null },
    { ...REPLY, refused: {} },
    { ...REPLY, refused: [null] },
    { ...REPLY, refused: [{ index: -1, code: 'not_found' }] },
    { ...REPLY, refused: [{ index: 1.5, code: 'not_found' }] },
    { ...REPLY, refused: [{ index: '0', code: 'not_found' }] },
    { ...REPLY, refused: [{ index: 0, code: 1 }] },
    { ...REPLY, refused: [{ index: 0 }] },
    { ...REPLY, alerts: { snow: { ...REPLY.alerts.snow, evening: 'true' } } },
    { ...REPLY, alerts: { snow: { ...REPLY.alerts.snow, morning: 0 } } },
    { ...REPLY, alerts: { snow: { ...REPLY.alerts.snow, possible: null } } },
    { ...REPLY, alerts: { snow: null } },
    { ...REPLY, alerts: null },
    { ...REPLY, seenAt: 0 },
  ]) {
    sync(200, json(wrong));
  }
  for (const text of ['[]', 'null', '', '<html>', '"x"', '{"id":']) sync(200, text);
  sync(204, '');
  for (const after of ['42', '999999', '007', '0', '-3', '4.5', '1000000', ' 7', '']) {
    sync(429, '', after);
  }
  sync(429, '', 'Wed, 21 Oct 2026 07:28:00 GMT');
  sync(429, '', null);
  sync(429, error('rate_limited', 'One change a minute for each device. Try again shortly.'), '50');
  sync(
    429,
    error('rate_limited', 'Up to 3 new places are added at a time. Try again in a minute.'),
    '60',
  );
  sync(
    400,
    error(
      'bad_location',
      "We couldn't tell where you are from your internet connection. Try again later, or use " +
        'your location.',
    ),
  );
  sync(400, json({ error: { code: 'bad_location' } }));
  sync(400, error('bad_location', ''));
  sync(400, error('bad_location', 42));
  sync(400, error('bad_request', 'here from the connection has no place: the server locates it.'));
  sync(400, error(1, 'There is no page for that place.'));
  sync(400, json({ error: null }));
  sync(400, '<html>');
  sync(404, error('bad_location', 'There is no page for that place.'));
  for (const status of [413, 404, 405, 500, 502, 503, 0]) sync(status, '');
  sync(201, json(REPLY));

  // Settings' row: how where you are was found, and the town the server named it, from what is
  // sent now, the last answer (approximate, the phone's, none, unnamed) and the 400.
  const unnamed = [atSea, { ...REPLY, here: { ...here, name: '' } }];
  const located = [REPLY, fromPhone, away];
  for (const sent of [ip, cell]) {
    for (const reply of [null, ...located]) {
      for (const refused of [false, true]) {
        add('hereKind', { here: sent, reply, refused }, hereKind({ here: sent, reply, refused }));
      }
    }
    for (const reply of [null, ...located, ...unnamed]) {
      add('hereName', { here: sent, reply }, hereName({ here: sent, reply }));
    }
  }

  // The router's zones: each place's by its key, where you are first; none for no place, for a
  // query that names none, and the first for one key.
  for (const reply of [
    REPLY,
    withSaved,
    away,
    { ...REPLY, here: null },
    {
      ...REPLY,
      here: null,
      saved: [
        { ...DURHAM, query: '' },
        { ...DURHAM, query: 'lat=95&lon=0&source=search' },
        { ...DURHAM, query: 'units=c' },
      ],
    },
    { ...REPLY, here: null, saved: [DURHAM, { ...DURHAM, timezone: 'Etc/UTC' }] },
  ]) {
    add('replyZones', { reply }, replyZones(reply));
  }

  const test = (status: number, text: string) =>
    add('testOutcome', { status, text }, testOutcome(status, text));
  for (const text of [
    '{"sent":true}',
    '{"sent":true,"count":2}',
    '{"sent":true,"dryRun":"x"}',
    '{"sent":false,"dryRun":true}',
  ]) {
    test(202, text);
  }
  for (const count of ['"2"', '0', '-2', '1.5', 'null', 'true']) {
    test(202, `{"sent":true,"count":${count}}`);
  }
  for (const text of ['{"sent":false}', '{"sent":false,"dryRun":1}', '{"dryRun":true}']) {
    test(202, text);
  }
  for (const text of ['{"sent":"true"}', '{"count":2}', '{}', '[]', '', 'null', '<html>']) {
    test(202, text);
  }
  test(429, error('test_limited', "That's 3 test notifications this hour. Try again later."));
  test(409, error('quiet_hours', 'Nothing is sent from 9pm to 7am at the place.'));
  test(404, error('not_registered', "This device isn't registered for notifications."));
  test(429, error('rate_limited', 'Too many requests. Try again in a minute.'));
  test(429, '');
  test(409, error('bad_request', 'Words.'));
  test(404, error('bad_request', 'Words.'));
  test(404, error(404, 'Words.'));
  test(400, error('not_registered', 'Words.'));
  test(404, json({ error: 'not_registered' }));
  for (const status of [200, 400, 413, 500, 502, 503, 0]) test(status, '{"sent":true}');
  test(503, error('push_unavailable', "Test notifications can't be sent just now."));
  test(502, error('push_refused', 'Apple refused the test notification.'));

  // ---- The saved places' bells (8.4b) ----

  // Whether anything can be sent: every set of switches, with every permission.
  const permissions: readonly Permission[] = [
    'authorized',
    'provisional',
    'denied',
    'notDetermined',
  ];
  for (const prefs of Object.values(PREFS)) {
    for (const permission of permissions) {
      add('alertsActive', { prefs, permission }, alertsActive(prefs, permission));
    }
  }

  // A bell's state: every combination.
  for (const on of [true, false]) {
    for (const unlocked of [true, false]) {
      for (const active of [true, false]) {
        add('bellState', { on, unlocked, active }, bellState({ on, unlocked, active }));
      }
    }
  }

  // The bells: on and off in saved order, already so, twice over, a key that isn't saved, bells
  // of places no longer saved, the tenth, and an eleventh saved (a lenient read) refused.
  const durham = targetKey(SAVED_DURHAM.target);
  const kathmandu = targetKey(SAVED_KATHMANDU.target);
  const sparse = targetKey(SAVED_SPARSE.target);
  const york = 'city:york-gb';
  const three = [durham, kathmandu, sparse];
  const towns = keysOf(SAVED_TOWNS);
  const bell = (bells: string[], key: string, on: boolean, savedKeys: string[]) =>
    add('setBell', { bells, key, on, savedKeys }, setBell(bells, key, on, savedKeys));
  bell([], kathmandu, true, three);
  bell([sparse], durham, true, three);
  bell([sparse, durham], kathmandu, true, three);
  bell([durham, sparse], durham, false, three);
  bell([kathmandu], kathmandu, false, three);
  bell([kathmandu], kathmandu, true, three);
  bell([], kathmandu, false, three);
  bell([durham, durham], kathmandu, true, [...three, durham]);
  bell([], york, true, three);
  bell([york, durham], kathmandu, true, three);
  bell([durham], durham, true, []);
  bell(towns.slice(0, 9), towns[9]!, true, towns.slice(0, 10));
  bell(towns.slice(0, 10), towns[10]!, true, towns);
  bell(towns, towns[0]!, false, towns);
  const kept = (bells: string[], savedKeys: string[]) =>
    add('keptBells', { bells, savedKeys }, keptBells(bells, savedKeys));
  kept([sparse, durham], three);
  kept([sparse, durham, kathmandu], [durham, sparse]);
  kept([durham], [kathmandu]);
  kept([], three);
  kept(three, []);
  kept([durham, durham, york], three);
  kept(towns, towns);

  // Who owns the bells: the purchase once StoreKit has said, else the last registration's
  // saved places (with where you are, without, none at all).
  const lastSaved = { ...REPLY, deviceTz: 'Europe/London', saved: [DURHAM] };
  for (const unlocked of [true, false, null]) {
    for (const last of [null, REPLY, lastSaved, { ...lastSaved, here: null }]) {
      add('ownsSaved', { unlocked, last }, ownsSaved(unlocked, last));
    }
  }

  // What is sent: the belled places in saved order, none without the purchase, each once, ten at
  // most, and nothing the server would refuse the whole set for.
  const forBody = (saved: readonly SavedPlace[], bells: string[], owns: boolean) =>
    add('savedForBody', { saved, bells, owns }, savedForBody(saved, bells, owns));
  const kinds = [SAVED_DURHAM, SAVED_KATHMANDU, SAVED_SPARSE, SAVED_BARE, SAVED_AWKWARD];
  for (const owns of [true, false]) {
    forBody(kinds, [sparse, durham], owns);
    forBody(kinds, keysOf(kinds), owns);
  }
  forBody(kinds, [], true);
  forBody([], [durham], true);
  forBody([SAVED_DURHAM], [kathmandu], true);
  forBody([...SAVED_ODD, SAVED_DURHAM], keysOf([...SAVED_ODD, SAVED_DURHAM]), true);
  forBody([SAVED_DURHAM, SAVED_DURHAM], [durham], true);
  forBody(SAVED_TOWNS, towns, true);
  forBody([SAVED_ODD[0]!, ...SAVED_TOWNS.slice(0, 10)], [...towns, keysOf(SAVED_ODD)[0]!], true);

  // A tap on a bell: without the purchase; each permission, with bells off, on, others' on and
  // one of a place no longer saved, and each set of switches; and a place that isn't saved.
  const savedKeys = [durham, kathmandu];
  const tap = (o: {
    key: string;
    bells: string[];
    prefs: AlertPrefs;
    unlocked: boolean;
    permission: Permission;
  }) => {
    const input = { ...o, savedKeys };
    add('tapBell', input, tapBell(input));
  };
  for (const permission of permissions) {
    for (const bells of [[], [kathmandu], [durham, kathmandu], [york, durham]]) {
      for (const prefs of [PREFS.both, PREFS.morning, PREFS.off, PREFS.possibleOnly]) {
        tap({ key: kathmandu, bells, prefs, unlocked: true, permission });
      }
      tap({ key: kathmandu, bells, prefs: PREFS.evening, unlocked: false, permission });
    }
    tap({ key: york, bells: [york, durham], prefs: PREFS.both, unlocked: true, permission });
  }

  // The search screen's lines: nothing saved, some, one short of full, full, and more than full
  // (a lenient read), free and paid, with a bell on and without.
  for (const savedCount of [0, 1, PLACE_LISTS.savedMax - 1, PLACE_LISTS.savedMax, 11]) {
    for (const unlocked of [false, true]) {
      for (const anyBellOn of [false, true]) {
        const input = { savedCount, unlocked, anyBellOn };
        add('savedLines', input, savedLines(input));
      }
    }
  }
  return vectorFile(
    [
      ['client', 'herePlace'],
      ['client', 'registrationBody'],
      ['client', 'fingerprint'],
      ['client', 'alertAction'],
      ['client', 'setAlert'],
      ['client', 'syncReply'],
      ['client', 'hereKind'],
      ['client', 'hereName'],
      ['client', 'replyZones'],
      ['client', 'testOutcome'],
      ['client', 'alertsActive'],
      ['client', 'bellState'],
      ['client', 'setBell'],
      ['client', 'keptBells'],
      ['client', 'ownsSaved'],
      ['client', 'savedForBody'],
      ['client', 'tapBell'],
      ['client', 'savedLines'],
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

  // The links a widget opens (and Settings' notifications), each parseDeepLink's inverse; none
  // for a place, which only a notification carries.
  const routes: Route[] = [
    ...VIEWS.map((view): Route => ({ kind: 'view', view })),
    { kind: 'upgrade' },
    { kind: 'settings', section: 'notifications' },
    { kind: 'place', target: { kind: 'city', slug: 'durham-gb', name: 'Durham' }, view: 'today' },
  ];
  for (const r of routes) add('routeLink', { route: r }, routeLink(r));
  return vectorFile(
    [
      ['client', 'parseDeepLink'],
      ['client', 'notificationRoute'],
      ['client', 'routeLink'],
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
  const addTo = (
    list: RecentPlace[],
    target: Target,
    name: string,
    max?: number,
    detail?: string,
  ) =>
    add(
      'addRecent',
      {
        list,
        target,
        name,
        ...(max === undefined ? {} : { max }),
        ...(detail === undefined ? {} : { detail }),
      },
      addRecent(list, target, name, max, detail),
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
  // A place's line (saved places' detail): kept when given, the newer entry's when chosen again,
  // and absent otherwise, as older stored entries are.
  const line = 'England, United Kingdom';
  const leedsLine = { ...leeds, detail: line };
  addTo([], leeds.target, 'Leeds', undefined, line);
  addTo([durham], leeds.target, 'Leeds', 3, line);
  addTo([leedsLine, durham], leeds.target, 'Leeds');
  addTo([leedsLine, durham], durham.target, 'Durham', undefined, line);
  addTo([durham, leedsLine], leeds.target, 'Leeds', undefined, 'West Yorkshire, England');
  addTo([leedsLine], { kind: 'ip' }, 'Leeds', undefined, line);
  addTo([], denver.target, 'Denver', undefined, '');
  const removeFrom = (list: RecentPlace[], target: Target) =>
    add('removeRecent', { list, target }, removeRecent(list, target));
  removeFrom([leeds, durham, phone], durham.target);
  removeFrom([leeds, durham, phone], { kind: 'city', slug: 'durham-gb' });
  removeFrom([leeds, durham, phone], searched.target);
  removeFrom([leeds, durham, phone, searched], { ...searched.target, name: 'Elsewhere' });
  removeFrom([leeds, durham], { kind: 'ip' });
  removeFrom([], leeds.target);
  removeFrom([leedsLine, durham], leeds.target);
  return vectorFile(
    [
      ['client', 'addRecent'],
      ['client', 'removeRecent'],
    ],
    cases,
  );
}

// ---- search.json -------------------------------------------------------------------------------

/**
 * The picker's search box (phase 6): what a search asks for (client `searchInput`, JavaScript's
 * `trim` and string length), and the line under a result (client `resultDetail`).
 */
function searchVectors(): VectorFile {
  const { cases, add } = collector();
  for (const text of [
    '',
    ' ',
    '   ',
    'L',
    ' L ',
    'Le',
    'Leeds',
    '  Leeds ',
    ' Newcastle  upon Tyne ',
    'Bath & Wells',
    'Zürich',
    'Zu\u0308rich',
    // One letter in two UTF-16 code units, which JavaScript counts as two; one with a
    // combining mark, which is two too.
    '\u{1D538}',
    'e\u0301',
    'é',
    // JavaScript's white space and line terminators, trimmed: tab, line feed, vertical tab, form
    // feed, carriage return, no-break space, the byte order mark, the line and paragraph
    // separators, and the space separators (U+1680, U+2000 to U+200A, U+202F, U+205F, U+3000).
    '\t\n\u000b\f\r',
    '\u00a0Le\u00a0',
    '\ufeffLe\ufeff',
    '\u2028L\u2029',
    '\u1680\u2000\u200a\u202f\u205f\u3000Le\u3000',
    // Not white space to JavaScript: U+0085 (next line), U+200B (zero width space) and U+180E.
    'L\u0085',
    '\u0085',
    '\u200bL',
    '\u180e',
  ]) {
    add('searchInput', { text }, searchInput(text));
  }
  const leeds: SearchResult = {
    name: 'Leeds',
    region: 'England',
    country: 'GB',
    countryName: 'United Kingdom',
    lat: 53.79648,
    lon: -1.54785,
    slug: 'leeds-gb',
    geonameId: 2644688,
    elevation: 63,
  };
  const results: SearchResult[] = [
    leeds,
    { ...leeds, countryName: null },
    { ...leeds, region: null },
    { ...leeds, region: '' },
    { ...leeds, countryName: '' },
    { ...leeds, region: null, countryName: null },
    { ...leeds, region: null, countryName: null, country: null },
    { ...leeds, region: '', countryName: '', country: '' },
    {
      name: 'Kathmandu',
      region: 'Bagmati Province',
      country: 'NP',
      countryName: 'Nepal',
      lat: 27.70169,
      lon: 85.3206,
    },
  ];
  for (const result of results) add('resultDetail', { result }, resultDetail(result));
  return vectorFile(
    [
      ['client', 'searchInput'],
      ['client', 'resultDetail'],
    ],
    cases,
  );
}

// ---- saved.json --------------------------------------------------------------------------------

/**
 * The picker's saved places (the iPhone app in the website's look, step 4): client `isSaved`,
 * `canSave`, `savePlace`, `unsavePlace`, `choosePlace` and `shownRecent`, on an empty and a full
 * list, the tenth and eleventh save, a place saved twice, approximate IP location, the phone's
 * point beside a searched one at the same coordinates, saving from the recent places and from a
 * search, removing (back on top, the sixth recent place cut), and choosing.
 */
function savedVectors(): VectorFile {
  const { cases, add } = collector();
  const line = 'England, United Kingdom';
  const leeds: SavedPlace = {
    target: { kind: 'city', slug: 'leeds-gb', name: 'Leeds' },
    name: 'Leeds',
    detail: line,
  };
  const york: SavedPlace = { target: { kind: 'city', slug: 'york-gb' }, name: 'York' };
  const kathmandu: SavedPlace = {
    target: {
      kind: 'coords',
      source: 'search',
      lat: 27.7,
      lon: 85.3,
      name: 'Kathmandu',
      region: 'Bagmati Province',
      country: 'NP',
      geonameId: 1283240,
      elevation: 1337,
    },
    name: 'Kathmandu',
    detail: 'Bagmati Province, Nepal',
  };
  const searchedLeeds: SavedPlace = {
    target: { kind: 'coords', source: 'search', lat: 53.8, lon: -1.55, name: 'Leeds' },
    name: 'Leeds',
  };
  const phone: PlaceTarget = { kind: 'coords', source: 'device', lat: 53.8, lon: -1.55 };
  const recent = (p: SavedPlace): RecentPlace =>
    p.detail === undefined
      ? { target: p.target, name: p.name }
      : { target: p.target, name: p.name, detail: p.detail };
  const durham: RecentPlace = { target: { kind: 'city', slug: 'durham-gb' }, name: 'Durham' };
  const five = ['aberdeen-gb', 'shrewsbury-gb', 'reykjavik-is', 'kolkata-in', 'london-gb'].map(
    (slug): RecentPlace => ({ target: { kind: 'city', slug }, name: slug }),
  );
  const ten = Array.from({ length: PLACE_LISTS.savedMax }, (_, i): SavedPlace => ({
    target: { kind: 'city', slug: `place-${i}-gb` },
    name: `Place ${i}`,
  }));
  const lists = (saved: SavedPlace[], recentPlaces: RecentPlace[] = []): PlaceLists => ({
    saved,
    recent: recentPlaces,
  });

  const targets: Target[] = [
    leeds.target,
    { kind: 'city', slug: 'leeds-gb', name: 'Leeds, West Yorkshire' },
    york.target,
    kathmandu.target,
    searchedLeeds.target,
    phone,
    { ...phone, name: 'Leeds' },
    { kind: 'ip' },
  ];
  for (const saved of [[], [leeds], [leeds, kathmandu], [searchedLeeds], ten.slice(1), ten]) {
    for (const target of targets) {
      add('isSaved', { saved, target }, isSaved(saved, target));
      add('canSave', { saved, target }, canSave(saved, target));
    }
  }

  const save = (l: PlaceLists, place: SavedPlace) =>
    add('savePlace', { lists: l, place }, savePlace(l, place));
  save(lists([]), leeds);
  save(lists([york], [durham, recent(leeds)]), leeds);
  save(lists([york], [durham]), kathmandu);
  save(lists(ten.slice(1), [recent(leeds)]), leeds);
  save(lists(ten, [recent(leeds)]), leeds);
  save(lists([leeds]), { target: { kind: 'city', slug: 'leeds-gb' }, name: 'Leeds again' });
  save(lists([], [durham]), { target: durham.target, name: '' });
  save(lists([]), { target: phone, name: 'Leeds' });
  save(lists([]), { target: { ...phone, name: 'Leeds' }, name: 'Leeds' });
  // The same point found by a search is a place of its own, and the phone's stays recent.
  save(lists([], [{ target: phone, name: 'Leeds' }]), searchedLeeds);
  save(lists([kathmandu], [recent(searchedLeeds)]), searchedLeeds);

  const unsave = (l: PlaceLists, target: Target) =>
    add('unsavePlace', { lists: l, target }, unsavePlace(l, target));
  unsave(lists([york, leeds], [durham]), { kind: 'city', slug: 'leeds-gb' });
  unsave(lists([leeds], five), leeds.target);
  unsave(lists([york, kathmandu]), york.target);
  unsave(lists([york, kathmandu], [durham]), kathmandu.target);
  unsave(lists([leeds], [durham]), york.target);
  unsave(lists([leeds], [durham]), { kind: 'ip' });
  unsave(lists([searchedLeeds]), phone);
  unsave(lists([]), leeds.target);

  const choose = (l: PlaceLists, target: Target, name: string, detail?: string) =>
    add(
      'choosePlace',
      { lists: l, target, name, ...(detail === undefined ? {} : { detail }) },
      choosePlace(l, target, name, detail),
    );
  choose(lists([leeds], [durham]), { kind: 'city', slug: 'leeds-gb' }, 'Leeds', line);
  choose(lists([leeds], [durham]), york.target, 'York');
  choose(lists([leeds], [durham]), kathmandu.target, 'Kathmandu', 'Bagmati Province, Nepal');
  choose(lists([leeds], five), durham.target, 'Durham', line);
  choose(lists([searchedLeeds], [durham]), phone, 'Leeds');
  choose(lists([leeds], [durham]), { kind: 'ip' }, 'Leeds');
  choose(lists([]), york.target, 'York', '');

  const shown = (l: PlaceLists) => add('shownRecent', { lists: l }, shownRecent(l));
  shown(lists([leeds], [durham, recent(leeds), { target: phone, name: 'Leeds' }]));
  shown(lists([searchedLeeds, kathmandu], [{ target: phone, name: 'Leeds' }, durham]));
  shown(lists([], five));
  shown(lists([leeds]));
  shown(lists(ten, five));
  return vectorFile(
    [
      ['client', 'isSaved'],
      ['client', 'canSave'],
      ['client', 'savePlace'],
      ['client', 'unsavePlace'],
      ['client', 'choosePlace'],
      ['client', 'shownRecent'],
    ],
    cases,
  );
}

// ---- widgetSource.json and widgetFace.json ----------------------------------------------------

/**
 * The answers the widget's choice is checked on: a city in °C with snow, one without, the evening
 * before snow, a searched place in °F, and a forecast that ends before its stale cut-off.
 */
const SOURCE_FIXTURES = [
  'aberdeen-snow',
  'leeds-dry',
  'durham-tomorrow',
  'denver-f',
  'forecast-ends',
] as const;

function widgetSourceVectors(fixtures: FixtureSet): VectorFile {
  const { cases, add } = collector();
  const fx = (name: string): Fixture => {
    const f = fixtures.get(name);
    if (!f) throw new Error(`No fixture ${name}`);
    return f;
  };
  // The saved answer is a fixture's whole response under `savedKey` at `savedAt`, or nothing.
  const ask = (
    name: string | null,
    savedKey: string | null,
    savedAt: number | null,
    asked: { key: string; units: Units | null; now: number },
  ): void => {
    const saved: SavedAnswer | null =
      name === null ? null : { key: savedKey!, savedAt: savedAt!, response: fx(name) };
    const { key, units, now } = asked;
    const input = { fixture: name, savedKey, savedAt, key, units };
    add('widgetReuses', { ...input, now }, widgetReuses(saved, asked));
    add('widgetFallsBack', input, widgetFallsBack(saved, { key, units }));
  };
  const reuse = WIDGET.reuseMinutes * MINUTE;
  for (const name of SOURCE_FIXTURES) {
    const f = fx(name);
    // Each saved under its own key, as the app keys it, when it was fetched.
    const target = targetFromQuery(f._fixture.query);
    if (!target) throw new Error(`No place in ${name}'s query`);
    const own = targetKey(target);
    const savedAt = madeAt(f);
    // Its own key, another place's, and its own with a space more (compared exactly).
    const keys = [own, own === 'city:leeds-gb' ? 'city:aberdeen-gb' : 'city:leeds-gb', `${own} `];
    const units: (Units | null)[] = [f.units, f.units === 'c' ? 'f' : 'c', null];
    // Saved a moment after now (a clock moved back), then up to the reuse limit and past it.
    const nows = [
      savedAt - 1,
      savedAt,
      savedAt + 10 * MINUTE,
      savedAt + reuse - 1,
      savedAt + reuse,
      savedAt + 3 * HOUR,
    ];
    for (const key of keys) {
      for (const u of units)
        for (const now of nows) ask(name, own, savedAt, { key, units: u, now });
    }
    // Saved ten minutes before it has nothing to show: a millisecond before then, and then.
    const until = usableUntil(f);
    for (const now of [until - 1, until]) {
      ask(name, own, until - 10 * MINUTE, { key: own, units: f.units, now });
    }
  }
  // Nothing saved.
  const aberdeen = madeAt(fx('aberdeen-snow'));
  for (const units of ['c', 'f', null] as const) {
    ask(null, null, null, { key: 'city:aberdeen-gb', units, now: aberdeen });
  }
  return vectorFile(
    [
      ['client', 'widgetReuses'],
      ['client', 'widgetFallsBack'],
    ],
    cases,
  );
}

function widgetFaceVectors(fixtures: FixtureSet): VectorFile {
  const { cases, add } = collector();
  const fx = (name: string): Fixture => {
    const f = fixtures.get(name);
    if (!f) throw new Error(`No fixture ${name}`);
    return f;
  };
  // A face of the plan widget.json's `widgetEntries` makes from the same input, at `index` (the
  // first entry), or at every index; in the answer's unit, or cm without one.
  const face = (
    name: string | null,
    now: number,
    o: {
      unlocked?: boolean;
      placeName?: string;
      without?: readonly string[];
      every?: boolean;
    } = {},
  ): void => {
    const whole = name === null ? null : fx(name);
    const f = whole && o.without ? withoutBlocks(whole, o.without) : whole;
    const options = {
      fetchedAt: whole ? madeAt(whole) : now - HOUR,
      now,
      unlocked: o.unlocked ?? true,
      ...(o.placeName === undefined ? {} : { placeName: o.placeName }),
    };
    const { entries } = widgetEntries(f, options);
    const unit = f?.snow?.unit ?? 'cm';
    for (const [index, entry] of entries.entries()) {
      if (index > 0 && !o.every) break;
      add(
        'widgetFace',
        { fixture: name, ...(o.without ? { without: o.without } : {}), ...options, index },
        widgetFace(entry, unit),
      );
    }
  };
  const local = (name: string, days: number, hh: number, mm: number): number[] => {
    const f = fx(name);
    return localMoments(zoneOf(f), addDays(dateOf(f), days), hh, mm);
  };

  // Every answer's first entry when it was fetched: A few flakes (reykjavik-mixed), inches
  // (denver-f), two forecasts (limited), and the right half without Now or rows (no-now,
  // no-week); then the old one at its cut-off, stale.
  for (const [name, f] of fixtures) face(name, madeAt(f));
  face('old-forecast', usableUntil(fx('old-forecast')));
  // Every entry of aberdeen-snow's plan from its fetch, the last of them stale.
  const aberdeen = madeAt(fx('aberdeen-snow'));
  face('aberdeen-snow', aberdeen, { every: true });
  // Durham before 6pm and after: Today, then Tomorrow, the gallery's sample.
  for (const now of [
    ...local('durham-tomorrow', 0, 17, 59),
    ...local('durham-tomorrow', 0, 18, 5),
  ]) {
    face('durham-tomorrow', now);
  }
  // Locked; no answer at all; and the heading without a place, and with the app's name for it.
  const durham = madeAt(fx('durham-tomorrow'));
  face('aberdeen-snow', aberdeen, { unlocked: false });
  face(null, aberdeen);
  face('aberdeen-snow', aberdeen, { placeName: '' });
  face('durham-tomorrow', durham, { placeName: 'Home' });
  // A row without counts, as an answer saved before the week's days had them.
  face('durham-tomorrow', durham, {
    without: ['snow.week.days.2.snowy', 'snow.week.days.2.total'],
  });
  // From 11:30pm, an answer whose snow has no tomorrow: no middle day, and the rows from Today.
  for (const now of local('durham-tomorrow', 0, 23, 30)) {
    face('durham-tomorrow', now, { without: ['snow.days.1'] });
  }
  return vectorFile([['mobile', 'widgetFace']], cases);
}

/**
 * Every vector file, in the spec's order (section 7.4's, then phase 5's `page.json`, phase 6's
 * `search.json` and the saved places' `saved.json`), from `fixtures` (each as its file has it).
 * Then phase 7.2's widget files: the widget's choice of answer and its face.
 * Throws when a fixture a vector needs is missing.
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
    { name: 'page', vectors: pageVectors(fixtures) },
    { name: 'search', vectors: searchVectors() },
    { name: 'saved', vectors: savedVectors() },
    { name: 'widgetSource', vectors: widgetSourceVectors(fixtures) },
    { name: 'widgetFace', vectors: widgetFaceVectors(fixtures) },
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
