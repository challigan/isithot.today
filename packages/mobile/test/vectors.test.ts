import { beforeAll, describe, expect, it } from 'vitest';
import {
  ATTRIBUTION,
  COPY,
  ERROR_MESSAGES,
  GRID,
  SITES,
  WIDGET,
  creditParts,
  defaultView,
  localDateTime,
  question,
  roundToGrid,
  showsTomorrow,
  snowAgreementLine,
  viewDisplay,
  viewLabel,
  type TodayResponse,
} from '@isithot/core';
import {
  PLACES,
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
} from '@isithot/client';
import { APP_COPY } from '../src/appCopy';
import { FIXTURES, fixtureJson, makeFixture, type Fixture } from '../src/fixtures';
import { fill, homePage, homeTopBar } from '../src/page';
import {
  addDays,
  assertSpecParse,
  atPath,
  localMoments,
  pathIn,
  specFormPairs,
  vectorFiles,
  vectorJson,
  withoutBlocks,
  type NamedVectors,
  type VectorCase,
} from '../src/vectors';
import { widgetFace } from '../src/widgetFace';

const fixtures = new Map<string, Fixture>();
let files: NamedVectors[];
beforeAll(async () => {
  for (const s of FIXTURES) fixtures.set(s.name, JSON.parse(fixtureJson(await makeFixture(s))));
  files = vectorFiles(fixtures);
});

// Inputs are as the files have them: JSON, read loosely here, as the Swift tests will.
/* eslint-disable @typescript-eslint/no-explicit-any */
type In = any;
const fx = (name: string | null): Fixture | null => (name === null ? null : fixtures.get(name)!);
/** The case's answer: its fixture, without the blocks `in.without` lists. */
const res = (i: In): Fixture =>
  i.without ? withoutBlocks(fx(i.fixture)!, i.without) : fx(i.fixture)!;
/** The saved answer a case names: its fixture's answer under its key and time, or nothing. */
const savedOf = (i: In) =>
  i.fixture === null ? null : { key: i.savedKey, savedAt: i.savedAt, response: res(i) };
/** The unit a case's face is in: its answer's, or cm without one. */
const unitOf = (i: In) => (i.fixture === null ? 'cm' : res(i).snow!.unit);

/**
 * Each function called afresh from a case's input alone, with the paths in its output read back
 * from the fixture: written apart from the generator, so a case whose input doesn't say what its
 * output was worked out from fails.
 */
const replay: Record<string, (i: In) => unknown> = {
  roundToGrid: (i) => roundToGrid(i.value, i.step),
  targetKey: (i) => targetKey(i.target),
  deviceTarget: (i) => deviceTarget(i.lat, i.lon),
  searchTarget: (i) => searchTarget(i.result),
  targetFromQuery: (i) => targetFromQuery(i.query),
  todayQuery: (i) => todayQuery(i.target, i.units, { ahead: i.ahead }),
  freshQuery: (i) => freshQuery(i.query, i.now),
  searchQuery: (i) => searchQuery(i.q),
  localDateTime: (i) => localDateTime(i.timezone, new Date(i.now)),
  showsTomorrow: (i) => showsTomorrow(res(i), i.now),
  defaultView: (i) => defaultView(res(i), i.now),
  viewLabel: (i) => viewLabel(i.view, i.tomorrow),
  hourUntil: (i) => hourUntil(res(i)),
  dayUntil: (i) => dayUntil(res(i)),
  usableUntil: (i) => usableUntil(res(i)),
  hold: (i) => hold(i.holds, res(i), i.now),
  outOfDate: (i) => outOfDate(res(i), i.now, i.holds),
  nextRefreshAt: (i) => nextRefreshAt(res(i), i.now, i.jitterMs),
  pickHour: (i) => pickHour(res(i), i.now),
  middleDay: (i) => middleDay(res(i), pickHour(res(i), i.now)!, i.now),
  updatedLine: (i) => updatedLine(i.updated, i.today),
  question: (i) => question(i.city, i.view, 'snow', i.tomorrow),
  viewDisplay: (i) =>
    viewDisplay(res(i), 'snow', 'today', 'ready', { tomorrow: i.tomorrow }).models,
  widgetEntries: (i) => widgetEntries(i.fixture === null ? null : res(i), i),
  widgetReuses: (i) => widgetReuses(savedOf(i), i),
  widgetFallsBack: (i) => widgetFallsBack(savedOf(i), i),
  herePlace: (i) => herePlace({ access: i.access, fix: i.fix, kept: i.kept }),
  registrationBody: (i) => registrationBody(i),
  fingerprint: (i) => fingerprint(i.body),
  alertAction: (i) => alertAction(i),
  setAlert: (i) => setAlert(i.prefs, i.which, i.on),
  syncReply: (i) => syncReply(i.status, i.text, i.retryAfter),
  hereKind: (i) => hereKind({ here: i.here, reply: i.reply, refused: i.refused }),
  hereName: (i) => hereName({ here: i.here, reply: i.reply }),
  replyZones: (i) => replyZones(i.reply),
  testOutcome: (i) => testOutcome(i.status, i.text),
  alertsActive: (i) => alertsActive(i.prefs, i.permission),
  bellState: (i) => bellState({ on: i.on, unlocked: i.unlocked, active: i.active }),
  setBell: (i) => setBell(i.bells, i.key, i.on, i.savedKeys),
  keptBells: (i) => keptBells(i.bells, i.savedKeys),
  ownsSaved: (i) => ownsSaved(i.unlocked, i.last),
  savedForBody: (i) => savedForBody(i.saved, i.bells, i.owns),
  tapBell: (i) =>
    tapBell({
      key: i.key,
      bells: i.bells,
      savedKeys: i.savedKeys,
      prefs: i.prefs,
      unlocked: i.unlocked,
      permission: i.permission,
    }),
  savedLines: (i) =>
    savedLines({ savedCount: i.savedCount, unlocked: i.unlocked, anyBellOn: i.anyBellOn }),
  parseDeepLink: (i) => parseDeepLink(i.url),
  notificationRoute: (i) => notificationRoute(i.payload, () => i.placeToday),
  routeLink: (i) => routeLink(i.route),
  addRecent: (i) => addRecent(i.list, i.target, i.name, i.max, i.detail),
  isSaved: (i) => isSaved(i.saved, i.target),
  canSave: (i) => canSave(i.saved, i.target),
  savePlace: (i) => savePlace(i.lists, i.place),
  unsavePlace: (i) => unsavePlace(i.lists, i.target),
  choosePlace: (i) => choosePlace(i.lists, i.target, i.name, i.detail),
  shownRecent: (i) => shownRecent(i.lists),
  removeRecent: (i) => removeRecent(i.list, i.target),
  searchInput: (i) => searchInput(i.text),
  resultDetail: (i) => resultDetail(i.result),
  homePage: (i) => homePage(i.fixture === null ? null : res(i), i),
  homeTopBar: (i) => homeTopBar(i.placeName, i.approximate, i.notice),
  widgetFace: (i) =>
    widgetFace(widgetEntries(i.fixture === null ? null : res(i), i).entries[i.index]!, unitOf(i)),
  creditParts: (i) => creditParts(i.text),
};

/** A path in a case's output, read back from its fixture. */
const read = (f: TodayResponse | null, path: string | null): unknown => {
  if (path === null) return null;
  return path.split('.').reduce<any>((v, key) => v[key], f);
};

/** A case's output with each fixture path replaced by what it names. */
function expected(c: VectorCase): unknown {
  const f = fx((c.in as In).fixture ?? null);
  const out = c.out as any;
  if (c.fn === 'pickHour' && out) {
    return { ...out, now: read(f, out.now), today: read(f, out.today), week: read(f, out.week) };
  }
  if (c.fn === 'middleDay') return { ...out, day: read(f, out.day) };
  if (c.fn === 'homePage') return { ...out, shown: read(f, out.shown) };
  if (c.fn === 'widgetEntries') {
    return { ...out, entries: out.entries.map((e: any) => ({ ...e, day: read(f, e.day) })) };
  }
  return out;
}

/** What JSON keeps of a value: no `undefined` fields. */
const asJson = (v: unknown): unknown =>
  v === undefined ? undefined : JSON.parse(JSON.stringify(v));

const SPEC_FILES = [
  'grid',
  'target',
  'query',
  'placeTime',
  'tomorrow',
  'freshness',
  'hours',
  'questions',
  'strip',
  'widget',
  'alerts',
  'links',
  'recent',
];

/** Phase 5's, after section 7.4's: the app's page. */
const PAGE_FILES = ['page'];

/** Phase 6's: the picker's search box; then its saved places (the website's look, step 4). */
const PICKER_FILES = ['search', 'saved'];

/** Phase 7.2's: the widget's choice of answer, then its face. */
const WIDGET_FILES = ['widgetSource', 'widgetFace'];

/** The functions whose reference is core's; the rest are the client's. */
const CORE = [
  'roundToGrid',
  'localDateTime',
  'showsTomorrow',
  'defaultView',
  'viewLabel',
  'question',
  'viewDisplay',
  'creditParts',
];

/** The functions whose reference is packages/mobile's own, built on core's and the client's. */
const MOBILE = ['homePage', 'homeTopBar', 'widgetFace'];

const MINUTE = 60 * 1000;
const file = (name: string) => files.find((f) => f.name === name)!.vectors;
const casesFor = (name: string, fn: string) => file(name).cases.filter((c) => c.fn === fn);
const local = (zone: string, now: number) => {
  const l = localDateTime(zone, new Date(now));
  return `${l.date} ${Math.round(l.hours * 60)}`;
};

describe('vectorFiles', () => {
  it('writes every file section 7.4 names, in its order, then the page, the picker’s and the widget’s', () => {
    expect(files.map((f) => f.name)).toEqual([
      ...SPEC_FILES,
      ...PAGE_FILES,
      ...PICKER_FILES,
      ...WIDGET_FILES,
    ]);
  });

  it('gives every output the reference gives for its input', () => {
    let count = 0;
    for (const { name, vectors } of files) {
      vectors.cases.forEach((c, i) => {
        const run = replay[c.fn];
        expect(run, `${name} #${i}: ${c.fn}`).toBeDefined();
        expect(asJson(run!(c.in)), `${name} #${i}: ${JSON.stringify(c.in)}`).toEqual(expected(c));
        count++;
      });
    }
    expect(count).toBeGreaterThan(3000);
  });

  it('says which functions each file covers, and has cases for each, once each', () => {
    for (const { name, vectors } of files) {
      const fns = vectors.fn.split(', ');
      expect(vectors.source, name).toBe(
        fns
          .map((fn) => {
            const pkg = CORE.includes(fn) ? 'core' : MOBILE.includes(fn) ? 'mobile' : 'client';
            return `${pkg}@${fn}`;
          })
          .join(', '),
      );
      expect(new Set(vectors.cases.map((c) => c.fn)), name).toEqual(new Set(fns));
      const keys = vectors.cases.map((c) => JSON.stringify([c.fn, c.in]));
      expect(new Set(keys).size, name).toBe(keys.length);
    }
  });

  it('names only fixtures there are', () => {
    for (const { vectors } of files) {
      for (const c of vectors.cases) {
        const name = (c.in as In).fixture;
        if (name !== undefined && name !== null) expect(fixtures.has(name), name).toBe(true);
      }
    }
  });

  it('is the same every time', () => {
    const again = vectorFiles(fixtures);
    expect(again.map((f) => vectorJson(f.vectors))).toEqual(
      files.map((f) => vectorJson(f.vectors)),
    );
  });

  it('throws for a fixture it needs that is missing', () => {
    expect(() => vectorFiles(new Map())).toThrow();
  });
});

describe('vectorJson', () => {
  it('writes one case to a line, and reads back as the same', () => {
    for (const { vectors } of files) {
      const text = vectorJson(vectors);
      expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(vectors)));
      const lines = text.split('\n');
      expect(lines.slice(0, 4)).toEqual([
        '{',
        `  "fn": ${JSON.stringify(vectors.fn)},`,
        `  "source": ${JSON.stringify(vectors.source)},`,
        '  "cases": [',
      ]);
      expect(text.endsWith('\n  ]\n}\n')).toBe(true);
      expect(lines.length).toBe(vectors.cases.length + 7);
    }
  });

  it('refuses what JSON would write as null', () => {
    const one = (out: unknown) => ({
      fn: 'f',
      source: 'core@f',
      cases: [{ fn: 'f', in: {}, out }],
    });
    expect(() => vectorJson(one(Infinity))).toThrow(/JSON can't hold/);
    expect(() => vectorJson(one({ end: NaN }))).toThrow(/end is NaN/);
    expect(() => vectorJson(one([1, undefined]))).toThrow(/A list holds undefined/);
    expect(vectorJson(one({ a: undefined, b: null }))).toContain('"out":{"b":null}');
  });
});

describe('pathIn and atPath', () => {
  it('names the answer’s own snow objects, and nothing else', () => {
    const f = fixtures.get('aberdeen-snow')!;
    expect(pathIn(f, f.snow!.now!)).toBe('snow.now');
    expect(pathIn(f, f.snow!.week!)).toBe('snow.week');
    expect(pathIn(f, f.snow!.days[1]!)).toBe('snow.days.1');
    expect(pathIn(f, f.snow!.ahead![2]!.today)).toBe('snow.ahead.2.today');
    expect(pathIn(f, null)).toBeNull();
    expect(atPath(f, 'snow.ahead.2.today')).toBe(f.snow!.ahead![2]!.today);
    expect(() => pathIn(f, { ...f.snow!.days[0]! })).toThrow(/Not one of the answer’s own/);
    expect(() => pathIn(null, f.snow!.days[0]!)).toThrow();
  });
});

describe('withoutBlocks', () => {
  it('takes the blocks out of a copy, and refuses a path with nothing at it', () => {
    const f = fixtures.get('aberdeen-snow')!;
    const g = withoutBlocks(f, ['rain', 'snow.now']);
    expect(g.rain).toBeUndefined();
    expect(g.snow!.now).toBeUndefined();
    expect(g.snow!.days).toEqual(f.snow!.days);
    expect(g.now).toEqual(f.now);
    expect(f.rain).toBeDefined();
    expect(f.snow!.now).toBeDefined();
    expect(() => withoutBlocks(f, ['snow.nothing'])).toThrow(/Nothing at snow.nothing/);
    expect(() => withoutBlocks(f, ['nothing.now'])).toThrow(/Nothing at nothing.now/);
  });

  it('takes an item out of a list, or empties it, and refuses an item that isn’t there', () => {
    const f = fixtures.get('aberdeen-snow')!;
    const g = withoutBlocks(f, ['snow.days.0', 'now.series.*']);
    expect(g.snow!.days).toEqual([f.snow!.days[1]]);
    expect(g.now!.series).toEqual([]);
    expect(f.snow!.days).toHaveLength(2);
    expect(f.now!.series.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(g))).toEqual(g);
    for (const path of ['snow.days.2', 'snow.days.-1', 'snow.days.01', 'snow.days.x']) {
      expect(() => withoutBlocks(f, [path]), path).toThrow(/Nothing at/);
    }
    expect(() => withoutBlocks(f, ['now.series.*', 'now.series.*'])).toThrow(/Nothing at/);
  });
});

describe('specFormPairs and assertSpecParse', () => {
  const codes = (pairs: [string, string][]) =>
    pairs.map((pair) => pair.map((text) => [...text].map((c) => c.codePointAt(0))));

  it('read a query as the URL standard does', () => {
    expect(specFormPairs('?a=1&&b=x+y%2Bz&c&=d&e=f=g')).toEqual([
      ['a', '1'],
      ['b', 'x y+z'],
      ['c', ''],
      ['', 'd'],
      ['e', 'f=g'],
    ]);
    expect(specFormPairs('??a')).toEqual([['?a', '']]);
    // A broken escape is kept, broken UTF-8 is U+FFFD, and a raw character beside it is itself.
    expect(codes(specFormPairs('a=%zz%4%C3%28'))).toEqual([
      [[0x61], [0x25, 0x7a, 0x7a, 0x25, 0x34, 0xfffd, 0x28]],
    ]);
    expect(codes(specFormPairs('a=%FF€'))).toEqual([[[0x61], [0xfffd, 0x20ac]]]);
    expect(codes(specFormPairs('a=%EF%BB%BFb'))).toEqual([[[0x61], [0xfeff, 0x62]]]);
  });

  it('stop the generator where a parser reads a query otherwise', () => {
    expect(() => assertSpecParse('place=leeds-gb&units=c')).not.toThrow();
    expect(() => assertSpecParse('a=%FF€', () => [['a', '\ufffd\ufffd']])).toThrow(
      /otherwise than the URL standard/,
    );
  });
});

describe('localMoments', () => {
  it('finds a time twice when the clocks go back, never when they skip it', () => {
    expect(localMoments('Europe/London', '2026-10-25', 1, 30)).toEqual([
      Date.parse('2026-10-25T00:30:00Z'),
      Date.parse('2026-10-25T01:30:00Z'),
    ]);
    expect(localMoments('Europe/London', '2027-03-28', 1, 30)).toEqual([]);
    expect(localMoments('Asia/Kathmandu', '2026-12-02', 18, 0)).toEqual([
      Date.parse('2026-12-02T12:15:00Z'),
    ]);
    expect(localMoments('Pacific/Kiritimati', '2026-12-03', 0, 30)).toEqual([
      Date.parse('2026-12-02T10:30:00Z'),
    ]);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('the cases cover what section 7.4 asks for', () => {
  it('grid: halves, negatives, the antimeridian and the poles', () => {
    const values = casesFor('grid', 'roundToGrid')
      .filter((c) => (c.in as In).step === GRID.forecast)
      .map((c) => (c.in as In).value);
    for (const v of [-1.575, -1.525, -0.025, 0.025, 53.825, 179.975, -180, 180, 90, -90]) {
      expect(values).toContain(v);
    }
  });

  it('target: every form, and names with &, +, accents and $', () => {
    const targets = casesFor('target', 'targetKey').map((c) => (c.in as In).target);
    expect(new Set(targets.map((t) => (t.kind === 'coords' ? t.source : t.kind)))).toEqual(
      new Set(['ip', 'city', 'device', 'search']),
    );
    const names = targets.map((t) => t.name ?? '').join(' ');
    for (const ch of ['&', '+', '$', 'í', 'â', 'Œ', '’', '/']) expect(names).toContain(ch);
    // A notification's place, read back, is the target it was written from.
    const read = new Map(
      casesFor('target', 'targetFromQuery').map((c) => [(c.in as In).query, c.out]),
    );
    for (const t of targets.filter((t) => t.kind !== 'ip')) {
      expect(read.get(todayQuery(t, 'c', { ahead: ['snow'] }))).toMatchObject({ kind: t.kind });
    }
  });

  it('query: the website’s own strings, and the apps’ with ahead', () => {
    const out = casesFor('query', 'todayQuery').map((c) => c.out);
    expect(out).toContain('place=leeds-gb&units=c');
    expect(out).toContain('place=leeds-gb&units=c&ahead=snow');
    expect(out).toContain('lat=39.75&lon=-105&name=Denver&country=US&source=search&units=f');
    expect(out).toContain('ahead=snow');
  });

  it('placeTime: at least 40 instants, both clock changes, and an unknown zone', () => {
    const cases = casesFor('placeTime', 'localDateTime');
    expect(cases.length).toBeGreaterThanOrEqual(40);
    const at = (iso: string) => cases.some((c) => (c.in as In).now === Date.parse(iso));
    expect(at('2026-10-25T01:00:00Z') && at('2027-03-28T01:00:00Z')).toBe(true);
    expect(cases.some((c) => (c.in as In).timezone === 'Mars/Olympus_Mons')).toBe(true);
  });

  it('tomorrow: 17:59, 18:00, 23:59 and midnight at every fixture, and no days[1]', () => {
    for (const [name, f] of fixtures) {
      const zone = f.location.timezone;
      const date = f.snow!.days[0]!.date;
      const times = casesFor('tomorrow', 'showsTomorrow')
        .filter((c) => (c.in as In).fixture === name)
        .map((c) => local(zone, (c.in as In).now));
      for (const want of [
        `${date} ${17 * 60 + 59}`,
        `${date} ${18 * 60}`,
        `${date} ${23 * 60 + 59}`,
      ]) {
        expect(times, name).toContain(want);
      }
      expect(times, name).toContain(`${addDays(date, 1)} 0`);
    }
    const ends = casesFor('tomorrow', 'showsTomorrow').filter(
      (c) => (c.in as In).fixture === 'forecast-ends',
    );
    expect(ends.every((c) => c.out === false)).toBe(true);
  });

  it('freshness: clocks 5 minutes and 2 hours either way, midnight and the stale cut-off', () => {
    for (const [name, f] of fixtures) {
      const made = Date.parse(f.snow!.days[0]!.from);
      const nows = casesFor('freshness', 'outOfDate')
        .filter((c) => (c.in as In).fixture === name)
        .map((c) => (c.in as In).now);
      for (const d of [-2 * 3600_000, -300_000, 300_000, 2 * 3600_000])
        expect(nows).toContain(made + d);
      const midnight = dayUntil(f);
      if (midnight !== null) expect(nows, name).toContain(midnight);
      expect(nows, name).toContain(usableUntil(f));
    }
    // The fallbacks: snow's series without rain, then the next UTC hour, which off the UTC hour
    // (Kolkata) is another moment; no hour at all without snow or rain.
    const kolkata = fixtures.get('kolkata-0530')!;
    const without = (blocks: string[]) =>
      casesFor('freshness', 'hourUntil').find(
        (c) =>
          (c.in as In).fixture === 'kolkata-0530' &&
          JSON.stringify((c.in as In).without) === JSON.stringify(blocks),
      )!.out;
    expect(without(['rain'])).toBe(hourUntil(kolkata));
    expect(without(['rain', 'snow.now'])).not.toBe(hourUntil(kolkata));
    expect(without(['rain.now'])).toBe(without(['rain', 'snow.now']));
    expect(without(['rain', 'snow'])).toBeNull();
    const outs = new Set(casesFor('freshness', 'outOfDate').map((c) => c.out));
    expect(outs).toEqual(new Set(['day', 'hour', null]));
    expect(
      casesFor('freshness', 'hold').some((c) => Object.keys(c.out as object).length === 2),
    ).toBe(true);
  });

  it('hours: each boundary, a clock behind, past the last hour, and 22:00 to 23:59', () => {
    for (const [name, f] of fixtures) {
      const nows = casesFor('hours', 'pickHour')
        .filter((c) => (c.in as In).fixture === name)
        .map((c) => (c.in as In).now);
      const times = f.snow!.ahead!.map((a) => Date.parse(a.time));
      for (const t of times)
        expect(nows, name).toEqual(expect.arrayContaining([t - 60_000, t - 1, t]));
      expect(nows, name).toContain(times.at(-1)! + 3600_000);
      expect(
        nows.some((n) => n < times[0]! - 3600_000),
        name,
      ).toBe(true);
      const late = nows.map((n) => local(f.location.timezone, n));
      expect(late, name).toContain(`${f.snow!.days[0]!.date} ${23 * 60 + 59}`);
    }
    const picked = casesFor('hours', 'pickHour').map((c) => c.out as any);
    expect(new Set(picked.map((p) => p?.source ?? null))).toEqual(
      new Set(['response', 'ahead', null]),
    );
    const slots = new Set(casesFor('hours', 'middleDay').map((c) => (c.out as any).slot));
    expect(slots).toEqual(new Set(['today', 'tomorrow']));
    const lines = casesFor('hours', 'updatedLine').map((c) => c.out as string);
    expect(lines.some((l) => l.startsWith('yesterday, '))).toBe(true);
  });

  it('questions: every view, with a place and without, for today and tomorrow', () => {
    const cases = casesFor('questions', 'question');
    expect(cases.map((c) => c.out)).toEqual(
      expect.arrayContaining([
        'Will it snow today?',
        'Will it snow tomorrow?',
        'Is it snowing in Leeds right now?',
        'Will it snow in Dollar$ this week?',
        'Will it snow in $& $1 $$ $` tomorrow?',
      ]),
    );
  });

  it('strip: every fixture, today and tomorrow', () => {
    const cases = casesFor('strip', 'viewDisplay').filter((c) => !(c.in as In).without);
    expect(cases).toHaveLength(fixtures.size * 2);
    // forecast-ends has no tomorrow, so no strip for it.
    const ends = cases.find(
      (c) => (c.in as In).fixture === 'forecast-ends' && (c.in as In).tomorrow,
    );
    expect((ends!.out as any).zone).toBeNull();
    // Nor has an answer without snow, today or tomorrow.
    const noSnow = casesFor('strip', 'viewDisplay').filter((c) => (c.in as In).without);
    expect(noSnow.map((c) => [(c.in as In).without, (c.out as any).zone])).toEqual([
      [['snow'], null],
      [['snow'], null],
    ]);
  });

  it('widget: section 6.5’s clocks, locked, stale and no answer', () => {
    const cases = casesFor('widget', 'widgetEntries');
    const at = (name: string, date: string, minutes: number) =>
      cases.some((c) => {
        const i = c.in as In;
        return (
          i.fixture === name &&
          local(fixtures.get(name)!.location.timezone, i.now) === `${date} ${minutes}`
        );
      });
    for (const m of [17 * 60 + 59, 18 * 60, 23 * 60 + 30])
      expect(at('durham-tomorrow', '2026-12-16', m)).toBe(true);
    expect(at('durham-tomorrow', '2026-12-17', 30)).toBe(true);
    for (const [name, date] of [
      ['london-dst-autumn-night', '2026-10-25'],
      ['london-dst-spring-evening', '2027-03-28'],
    ] as const) {
      for (const m of [30, 17 * 60 + 59, 18 * 60])
        expect(at(name, date, m), `${name} ${m}`).toBe(true);
    }
    expect(at('london-dst-autumn-night', '2026-10-25', 90)).toBe(true);
    for (const name of ['kathmandu-0545', 'adelaide-1030', 'kiritimati-14']) {
      expect(at(name, '2026-12-02', 18 * 60), name).toBe(true);
    }
    expect(at('kiritimati-14', '2026-12-03', 30)).toBe(true);
    const states = new Set(cases.flatMap((c) => (c.out as any).entries.map((e: any) => e.state)));
    expect(states).toEqual(new Set(['ok', 'locked', 'stale']));
    expect(cases.some((c) => (c.in as In).fixture === null)).toBe(true);
    expect(cases.some((c) => (c.out as any).reloadAt === 'never')).toBe(true);
    // The fallbacks: without hours ahead, and an evening with no tomorrow for snow.
    const without = (blocks: string) =>
      cases.filter((c) => JSON.stringify((c.in as In).without) === blocks);
    expect(without('["snow.ahead"]').length).toBeGreaterThan(0);
    const noTomorrow = without('["snow.days.1"]').flatMap((c) => (c.out as any).entries);
    expect(
      noTomorrow.some(
        (e: any) =>
          e.state === 'ok' && e.slot === 'tomorrow' && e.day === null && e.palette === 'nosnow',
      ),
    ).toBe(true);
    // The week's rows are every day after the middle day: six from a morning, and the whole
    // week's seven with no middle day, never cut to four.
    const ok = cases.flatMap((c) => (c.out as any).entries).filter((e: any) => e.state === 'ok');
    expect(ok.some((e: any) => e.week.length === 6)).toBe(true);
    expect(noTomorrow.some((e: any) => e.state === 'ok' && e.week.length === 7)).toBe(true);
    // Older than the stale limit: a stale entry at the cut-off.
    const old = fixtures.get('old-forecast')!;
    expect(
      cases.some(
        (c) =>
          (c.in as In).fixture === 'old-forecast' &&
          (c.out as any).entries.at(-1).date === usableUntil(old) &&
          (c.out as any).entries.length > 1,
      ),
    ).toBe(true);
  });

  it('widgetSource: both answers of each, the boundary at reuseMinutes, a future save, every units case', () => {
    const reuses = casesFor('widgetSource', 'widgetReuses');
    const fallsBack = casesFor('widgetSource', 'widgetFallsBack');
    expect(new Set(reuses.map((c) => c.out))).toEqual(new Set([true, false]));
    expect(new Set(fallsBack.map((c) => c.out))).toEqual(new Set([true, false]));
    const age = (c: VectorCase) => (c.in as In).now - (c.in as In).savedAt;
    const limit = WIDGET.reuseMinutes * MINUTE;
    const own = reuses.filter(
      (c) =>
        (c.in as In).fixture !== null &&
        (c.in as In).key === (c.in as In).savedKey &&
        (c.in as In).units === res(c.in as In).units,
    );
    // Its own key and units: an hour less a millisecond is reused, an hour isn't, nor a future
    // save.
    expect(own.some((c) => age(c) === limit - 1 && c.out === true)).toBe(true);
    expect(own.some((c) => age(c) === limit && c.out === false)).toBe(true);
    expect(own.some((c) => age(c) === -1 && c.out === false)).toBe(true);
    // Its own units, the other and none, for both functions.
    for (const cases of [reuses, fallsBack]) {
      const units = cases
        .filter((c) => (c.in as In).fixture !== null)
        .map((c) => (c.in as In).units);
      expect(new Set(units)).toEqual(new Set(['c', 'f', null]));
      expect(cases.some((c) => (c.in as In).fixture === null && c.out === false)).toBe(true);
      // A key with a space more is another place.
      expect(
        cases.some((c) => (c.in as In).key === `${(c.in as In).savedKey} ` && c.out === false),
      ).toBe(true);
    }
    // Saved shortly before it has nothing to show: reused a millisecond before, not at it.
    const ending = reuses.filter((c) => (c.in as In).fixture !== null && c.out === true);
    expect(ending.some((c) => (c.in as In).now === usableUntil(res(c.in as In)) - 1)).toBe(true);
    expect(
      reuses.some(
        (c) =>
          (c.in as In).fixture !== null &&
          (c.in as In).now === usableUntil(res(c.in as In)) &&
          age(c) < limit &&
          c.out === false,
      ),
    ).toBe(true);
    // Each saved under its own key, as the app keys it.
    for (const c of [...reuses, ...fallsBack].filter((c) => (c.in as In).fixture !== null)) {
      const f = fx((c.in as In).fixture)!;
      expect((c.in as In).savedKey).toBe(targetKey(targetFromQuery(f._fixture.query)!));
    }
  });

  it('widgetFace: all three states, a heading with and without a place, a row without counts, no middle day, inches and aberdeen’s whole timeline', () => {
    const cases = casesFor('widgetFace', 'widgetFace');
    const outs = cases.map((c) => c.out as any);
    expect(new Set(outs.map((o) => o.state))).toEqual(new Set(['ok', 'locked', 'stale']));
    expect(outs.some((o) => o.state === 'ok' && o.spoken.startsWith(`${o.place}. `))).toBe(true);
    const placeless = cases.find((c) => (c.in as In).placeName === '')!.out as any;
    expect(placeless.spoken.startsWith(`${placeless.slot}: `)).toBe(true);
    expect(cases.some((c) => (c.in as In).placeName === 'Home')).toBe(true);
    expect(
      outs.some((o) =>
        o.week.some((r: any) => r.agreement === null && !r.spoken.includes('forecast')),
      ),
    ).toBe(true);
    expect(
      outs.some(
        (o) =>
          o.state === 'ok' &&
          o.answer === '' &&
          o.detail === COPY.notAvailable &&
          o.band === 'nosnow',
      ),
    ).toBe(true);
    // Inches: denver-f's rows ("Friday, 0.2in, snow possible, …"), its Today being rain.
    const inches = (text: string) => /\d(\.\d+)?in\b/.test(text);
    expect(outs.some((o) => o.week.some((r: any) => inches(r.spoken)))).toBe(true);
    // Every entry of aberdeen-snow's plan from its fetch, the last of them stale.
    const aberdeen = fixtures.get('aberdeen-snow')!;
    const made = Date.parse(aberdeen.snow!.days[0]!.from);
    const plan = widgetEntries(aberdeen, { fetchedAt: made, now: made, unlocked: true }).entries;
    const indexes = cases
      .filter(
        (c) =>
          (c.in as In).fixture === 'aberdeen-snow' &&
          (c.in as In).now === made &&
          (c.in as In).unlocked &&
          (c.in as In).placeName === undefined,
      )
      .map((c) => (c.in as In).index);
    expect(plan).toHaveLength(8);
    expect(indexes).toEqual(plan.map((_, i) => i));
    // Durham at 5:59pm reads Today, and at 6:05pm Tomorrow.
    const durham = (hh: number, mm: number) =>
      cases.find(
        (c) =>
          (c.in as In).fixture === 'durham-tomorrow' &&
          !(c.in as In).without &&
          (c.in as In).placeName === undefined &&
          local('Europe/London', (c.in as In).now) === `2026-12-16 ${hh * 60 + mm}`,
      )!.out as any;
    expect(durham(17, 59).slot).toBe('Today');
    expect(durham(18, 5).slot).toBe('Tomorrow');
  });

  it('alerts: every outcome of the notifications’ rules', () => {
    const hour = 60 * MINUTE;
    // Where you are: every location access, with each kind of fix and each kept cell.
    const here = casesFor('alerts', 'herePlace');
    const accesses = ['granted', 'denied', 'notDetermined'];
    expect(new Set(here.map((c) => (c.in as In).access))).toEqual(new Set(accesses));
    const fixes = new Set(here.map((c) => JSON.stringify((c.in as In).fix)));
    const kept = new Set(here.map((c) => JSON.stringify((c.in as In).kept)));
    expect(here).toHaveLength(accesses.length * fixes.size * kept.size);
    expect(new Set(here.map((c) => (c.in as In).fix?.kind ?? null))).toEqual(
      new Set([null, 'coords', 'city', 'ip']),
    );
    expect(new Set(here.map((c) => (c.out as any).kind))).toEqual(new Set(['device', 'ip']));
    for (const c of here.filter((c) => (c.in as In).access !== 'granted')) {
      expect(c.out, JSON.stringify(c.in)).toEqual({ kind: 'ip' });
    }
    // A fix wins over the kept cell, which stands in without one; neither without access.
    const granted = here.filter((c) => (c.in as In).access === 'granted');
    expect(new Set(granted.map((c) => JSON.stringify((c.out as any).target ?? null))).size).toBe(4);
    // The body: approximate and the phone's cell, with no saved place, one and ten (design 4.1),
    // a city page by its slug and a searched place by its point, and the phone's zone only with
    // a saved place: given with none, it is dropped; with some, sent when given.
    const bodyCases = casesFor('alerts', 'registrationBody');
    const bodies = bodyCases.map((c) => c.out as any);
    expect(new Set(bodies.map((b) => b.here.source))).toEqual(new Set(['ip', 'device']));
    expect(bodies.every((b) => b.v === 2 && Array.isArray(b.saved))).toBe(true);
    expect(bodies.some((b) => b.here.source === 'device' && 'name' in b.here)).toBe(false);
    for (const count of [0, 1, 10]) {
      for (const zone of [true, false]) {
        expect(
          bodies.some(
            (b) => b.here.source === 'ip' && b.saved.length === count && 'deviceTz' in b === zone,
          ),
          `${count} saved, ${zone ? 'with' : 'without'} the zone`,
        ).toBe(count > 0 || !zone);
      }
    }
    for (const c of bodyCases) {
      const i = c.in as In;
      const zone = Boolean(i.saved?.length) && Boolean(i.deviceTz);
      expect('deviceTz' in (c.out as any), JSON.stringify(i)).toBe(zone);
    }
    expect(bodyCases.some((c) => !(c.in as In).saved?.length && (c.in as In).deviceTz)).toBe(true);
    const sentPlaces = bodies.flatMap((b) => b.saved);
    expect(new Set(sentPlaces.map((p) => ('place' in p ? 'city' : p.source)))).toEqual(
      new Set(['city', 'search']),
    );
    expect(sentPlaces.some((p) => p.source === 'search' && Object.keys(p).length === 3)).toBe(true);
    // What to do: every action; the hourly refresh while approximate, and the refused set.
    const actions = casesFor('alerts', 'alertAction');
    expect(new Set(actions.map((c) => c.out))).toEqual(
      new Set(['put', 'delete', 'none', 'needsToken']),
    );
    // A set the server may hold though no reply to it was kept: deleted whenever nothing can be
    // sent, with nothing kept too, saved places and all; otherwise as when nothing was kept.
    const unconfirmed = actions.filter((c) => (c.in as In).unconfirmed);
    const idle = (c: VectorCase) => !alertsActive((c.in as In).prefs, (c.in as In).permission);
    expect(unconfirmed.filter(idle).length).toBeGreaterThan(4);
    for (const c of unconfirmed.filter(idle)) expect(c.out, JSON.stringify(c.in)).toBe('delete');
    expect(unconfirmed.some((c) => idle(c) && !(c.in as In).last && (c.in as In).saved)).toBe(true);
    expect(new Set(unconfirmed.filter((c) => !idle(c)).map((c) => c.out))).toEqual(
      new Set(['put', 'needsToken', 'none']),
    );
    expect(actions.some((c) => (c.in as In).unconfirmed === false && idle(c))).toBe(true);
    // Registered and nothing changed: approximate again on becoming active an hour or more
    // after it was sent; either kind again once a week; otherwise nothing.
    const week = 7 * 24 * 60 * MINUTE;
    const live = actions.filter((c) => {
      const i = c.in as In;
      return (
        (i.prefs.evening || i.prefs.morning) &&
        i.permission !== 'denied' &&
        i.token &&
        i.last &&
        !i.refused &&
        fingerprint(registrationBody(i)) === i.last.fingerprint
      );
    });
    const gap = (c: VectorCase) => (c.in as In).activeAt - (c.in as In).last.at;
    const age = (c: VectorCase) => (c.in as In).now - (c.in as In).last.at;
    const ipAt = (c: VectorCase) => (c.in as In).here.kind === 'ip';
    for (const c of live) {
      const due = age(c) >= week || (ipAt(c) && gap(c) >= hour);
      expect(c.out, JSON.stringify(c.in)).toBe(due ? 'put' : 'none');
    }
    expect(live.filter((c) => ipAt(c) && gap(c) >= hour && age(c) < week).length).toBeGreaterThan(
      2,
    );
    expect(live.some((c) => ipAt(c) && gap(c) < hour && age(c) >= hour)).toBe(true);
    expect(live.some((c) => !ipAt(c) && gap(c) >= hour && age(c) < week)).toBe(true);
    const refused = actions.filter((c) => (c.in as In).refused);
    expect(new Set(refused.map((c) => c.out))).toEqual(
      new Set(['none', 'put', 'delete', 'needsToken']),
    );
    // Refused, with the last registration that very set and due again (the hourly refresh, the
    // heartbeat): nothing while the refusal is since the app became active, then it goes.
    const refusedDue = refused.filter((c) => {
      const i = c.in as In;
      return (
        (i.prefs.evening || i.prefs.morning) &&
        i.permission !== 'denied' &&
        i.token &&
        i.last &&
        fingerprint(registrationBody(i)) === i.last.fingerprint &&
        i.refused.fingerprint === i.last.fingerprint &&
        (age(c) >= week || (ipAt(c) && gap(c) >= hour))
      );
    });
    const since = (c: VectorCase) => (c.in as In).refused.at >= (c.in as In).activeAt;
    const waiting = refusedDue.filter(since);
    expect(new Set(waiting.map((c) => c.out))).toEqual(new Set(['none']));
    expect(waiting.some((c) => age(c) >= week)).toBe(true);
    expect(waiting.some((c) => age(c) < week)).toBe(true);
    const activeAgain = refusedDue.filter((c) => !since(c));
    expect(new Set(activeAgain.map((c) => c.out))).toEqual(new Set(['put']));
    // With saved places: each change to them, or to the phone's zone while one is sent, is a
    // put; the same set nothing; and every switch off or the permission denied deletes the set
    // (if one was sent, or one may be held) whatever is saved, as the switches are one set for
    // every place.
    const withSaved = actions.filter((c) => (c.in as In).saved?.length);
    expect(new Set(withSaved.map((c) => c.out))).toEqual(new Set(['put', 'delete', 'none']));
    for (const c of withSaved) {
      const i = c.in as In;
      if (!alertsActive(i.prefs, i.permission)) {
        expect(c.out, JSON.stringify(i)).toBe(i.last || i.unconfirmed ? 'delete' : 'none');
      }
    }
    /** How many saved places the last registration sent, by its fingerprint ('{}' for none). */
    const savedSent = (c: VectorCase): number => {
      try {
        return JSON.parse((c.in as In).last?.fingerprint ?? '{}').saved?.length ?? 0;
      } catch {
        return 0;
      }
    };
    expect(
      actions.some((c) => !(c.in as In).saved?.length && savedSent(c) && c.out === 'put'),
    ).toBe(true);
    expect(
      live.some((c) => (c.in as In).saved?.length && (c.in as In).deviceTz && c.out === 'none'),
    ).toBe(true);
    // Every switch, both ways, from every state; "possible" alone refused.
    const switches = casesFor('alerts', 'setAlert');
    expect(switches).toHaveLength(6 * 3 * 2);
    expect(
      switches.some(
        (c) =>
          (c.in as In).which === 'possible' &&
          (c.in as In).on &&
          !(c.out as any).possible &&
          !(c.out as any).evening,
      ),
    ).toBe(true);
    // What every reply to a sync means: the set as stored, approximate, the phone's, none, with
    // saved places and refused ones; 8.1's reply is a failure.
    const syncs = casesFor('alerts', 'syncReply');
    expect(new Set(syncs.map((c) => (c.out as any).kind))).toEqual(
      new Set(['stored', 'forgotten', 'retry', 'placeRefused', 'failed']),
    );
    const stored = syncs.filter((c) => (c.out as any).kind === 'stored').map((c) => c.out as any);
    expect(new Set(stored.map((o) => o.reply.here?.follows ?? null))).toEqual(
      new Set(['ip', 'device', null]),
    );
    expect(stored.some((o) => o.reply.saved.length && o.reply.refused.length)).toBe(true);
    expect(
      syncs.some((c) => {
        const body = JSON.parse((c.in as In).text || 'null');
        return body && 'place' in body && (c.out as any).kind === 'failed';
      }),
    ).toBe(true);
    // A place's country: null is read (the phone far from any town); left out, the reply fails,
    // where the same reply with `country: null` put back reads, for where you are and a saved place.
    expect(
      stored.some((o) => o.reply.here?.follows === 'device' && o.reply.here.country === null),
    ).toBe(true);
    const isRecord = (v: unknown): v is Record<string, unknown> =>
      typeof v === 'object' && v !== null && !Array.isArray(v);
    const withCountry = (place: unknown) =>
      isRecord(place) && !('country' in place) ? { ...place, country: null } : place;
    const countryLeftOut = syncs.flatMap((c) => {
      const i = c.in as In;
      if (i.status !== 200 || (c.out as any).kind !== 'failed') return [];
      let body: unknown;
      try {
        body = JSON.parse(i.text);
      } catch {
        return [];
      }
      if (!isRecord(body)) return [];
      const filled = {
        ...body,
        here: withCountry(body.here),
        saved: Array.isArray(body.saved) ? body.saved.map(withCountry) : body.saved,
      };
      if (syncReply(200, JSON.stringify(filled), null).kind !== 'stored') return [];
      return [withCountry(body.here) === body.here ? 'saved' : 'here'];
    });
    expect(new Set(countryLeftOut)).toEqual(new Set(['here', 'saved']));
    expect(
      new Set(
        syncs
          .filter((c) => (c.out as any).kind === 'retry')
          .map((c) => (c.out as any).afterSeconds),
      ),
    ).toEqual(new Set([42, 999999, 7, 50, 60]));
    // Settings' row: each kind, a town and none.
    expect(new Set(casesFor('alerts', 'hereKind').map((c) => c.out))).toEqual(
      new Set(['device', 'ip', 'unknown']),
    );
    expect(new Set(casesFor('alerts', 'hereName').map((c) => c.out))).toEqual(
      new Set(['Leeds', null]),
    );
    // The router's zones: every place's, and none.
    const zones = casesFor('alerts', 'replyZones').map((c) => Object.keys(c.out as object).length);
    expect(Math.min(...zones)).toBe(0);
    expect(Math.max(...zones)).toBeGreaterThanOrEqual(3);
    // What every reply to a test means, and how many were sent.
    const tests = casesFor('alerts', 'testOutcome').map((c) => c.out as any);
    expect(new Set(tests.map((o) => o.kind))).toEqual(
      new Set(['sent', 'dryRun', 'limited', 'quiet', 'notRegistered', 'failed']),
    );
    expect(new Set(tests.filter((o) => o.kind === 'sent').map((o) => o.count))).toEqual(
      new Set([1, 2]),
    );
  });

  it('alerts: every outcome of the saved places’ bells (8.4b)', () => {
    const bool = [true, false];
    // Whether anything can be sent: every set of switches with every permission.
    const actives = casesFor('alerts', 'alertsActive');
    expect(actives).toHaveLength(6 * 4);
    expect(new Set(actives.map((c) => c.out))).toEqual(new Set(bool));
    // A bell's state: every combination, `active` false included.
    const states = casesFor('alerts', 'bellState');
    expect(states).toHaveLength(8);
    expect(states.filter((c) => c.out === 'on')).toHaveLength(1);
    expect(new Set(states.map((c) => c.out))).toEqual(new Set(['locked', 'off', 'on']));
    // The bells, set and kept: only saved places, in saved order, at most ten; the tenth bell,
    // an eleventh refused, and a key that isn't saved.
    const inOrder = (out: string[], savedKeys: string[]) =>
      out.every(
        (k, n) =>
          savedKeys.includes(k) &&
          (n === 0 || savedKeys.indexOf(out[n - 1]!) < savedKeys.indexOf(k)),
      );
    const bells = [...casesFor('alerts', 'setBell'), ...casesFor('alerts', 'keptBells')];
    for (const c of bells) {
      const out = c.out as string[];
      expect(inOrder(out, (c.in as In).savedKeys), JSON.stringify(c.in)).toBe(true);
      expect(out.length).toBeLessThanOrEqual(10);
    }
    const set = casesFor('alerts', 'setBell');
    expect(set.some((c) => (c.out as string[]).length === 10 && (c.in as In).on)).toBe(true);
    expect(
      set.some((c) => (c.in as In).on && !(c.out as string[]).includes((c.in as In).key)),
    ).toBe(true);
    expect(set.some((c) => !(c.in as In).savedKeys.includes((c.in as In).key))).toBe(true);
    expect(
      casesFor('alerts', 'keptBells').some(
        (c) => (c.out as string[]).length < new Set((c.in as In).bells).size,
      ),
    ).toBe(true);
    // Who owns the bells: the purchase when known, else the last registration's saved places.
    const owns = casesFor('alerts', 'ownsSaved');
    expect(new Set(owns.map((c) => (c.in as In).unlocked))).toEqual(new Set([true, false, null]));
    const unknown = owns.filter((c) => (c.in as In).unlocked === null);
    expect(new Set(unknown.map((c) => c.out))).toEqual(new Set(bool));
    // What is sent: none without the purchase; the belled places in saved order, ten at most,
    // leaving out what the server would refuse the whole set for.
    const sent = casesFor('alerts', 'savedForBody');
    for (const c of sent.filter((c) => !(c.in as In).owns)) expect(c.out).toEqual([]);
    expect(sent.some((c) => (c.in as In).owns && (c.out as any[]).length === 10)).toBe(true);
    expect(sent.some((c) => (c.in as In).saved.length > 10)).toBe(true);
    expect(
      sent.some((c) => (c.in as In).saved.some((s: any) => s.target.source === 'device')),
    ).toBe(true);
    const sendable = (t: any) =>
      t.kind === 'city' ? t.slug.trim() !== '' : t.source === 'search' && Math.abs(t.lat) <= 90;
    for (const c of sent) expect((c.out as any[]).every(sendable), JSON.stringify(c.in)).toBe(true);
    // A tap: every outcome.
    expect(new Set(casesFor('alerts', 'tapBell').map((c) => (c.out as any).kind))).toEqual(
      new Set(['needsPurchase', 'needsPermission', 'denied', 'on', 'onWithHere', 'off']),
    );
    // The search screen's lines: each row of design 2.3, free and paid.
    const lines = casesFor('alerts', 'savedLines');
    expect(new Set(lines.map((c) => JSON.stringify(c.out)))).toEqual(
      new Set(
        [
          ['savedLineNoneFree'],
          ['savedLineNonePaid'],
          ['bellHintLocked'],
          ['bellHint'],
          [],
          ['savedFull', 'bellHintLocked'],
          ['savedFull', 'bellHint'],
          ['savedFull'],
        ].map((l) => JSON.stringify(l)),
      ),
    );
    // Each is a line of the app's copy, which the presenter shows by that key.
    for (const key of new Set(lines.flatMap((c) => c.out as string[]))) {
      expect(APP_COPY, key).toHaveProperty(key);
    }
  });

  it('links: every route, malformed payloads and past dates', () => {
    const routes = [
      ...casesFor('links', 'parseDeepLink'),
      ...casesFor('links', 'notificationRoute'),
    ].map((c) => c.out as any);
    expect(new Set(routes.map((r) => r?.kind ?? null))).toEqual(
      new Set(['view', 'upgrade', 'settings', 'place', null]),
    );
    expect(routes.some((r) => r?.view === 'default')).toBe(true);
    // Every link a widget opens, which parses back to its route; none for a place.
    const links = casesFor('links', 'routeLink');
    expect(new Set(links.map((c) => (c.in as In).route.kind))).toEqual(
      new Set(['view', 'upgrade', 'settings', 'place']),
    );
    for (const c of links) {
      const route = (c.in as In).route;
      expect(c.out === null ? null : parseDeepLink(c.out as string), JSON.stringify(route)).toEqual(
        route.kind === 'place' ? null : route,
      );
    }
    expect(links.filter((c) => (c.in as In).route.kind === 'view')).toHaveLength(3);
  });

  it('page: every fixture and view, each state, and the footer’s lines', () => {
    const cases = casesFor('page', 'homePage');
    const outs = cases.map((c) => c.out as any);
    // Every fixture at its own moment, for each view.
    for (const name of fixtures.keys()) {
      const own = Date.parse(fixtures.get(name)!._fixture.now);
      const views = cases
        .filter((c) => (c.in as In).fixture === name && (c.in as In).now === own)
        .map((c) => (c.in as In).view);
      expect(new Set(views), name).toEqual(new Set(['now', 'today', 'week']));
    }
    expect(new Set(outs.map((o) => o.state))).toEqual(
      new Set(['ready', 'loading', 'error', 'notAvailable', 'noRecent']),
    );
    const find = (fixture: string | null, view: string, test: (o: any) => boolean) =>
      cases.some(
        (c) => (c.in as In).fixture === fixture && (c.in as In).view === view && test(c.out),
      );
    // The spec's examples, from the answers themselves.
    expect(
      find('durham-tomorrow', 'today', (o) => o.heading === 'Durham. Will it snow tomorrow? Yes.'),
    ).toBe(true);
    expect(find('leeds-dry', 'today', (o) => o.heading === 'Leeds. Will it snow today? No.')).toBe(
      true,
    );
    expect(find('no-now', 'now', (o) => o.state === 'notAvailable')).toBe(true);
    expect(find('no-week', 'week', (o) => o.state === 'notAvailable')).toBe(true);
    expect(find('limited', 'today', (o) => o.day?.limited === COPY.limited)).toBe(true);
    expect(find('denver-f', 'today', (o) => o.day?.lines[0].text.endsWith('in'))).toBe(true);
    expect(find('old-forecast', 'today', (o) => o.answer === APP_COPY.staleApp)).toBe(true);
    expect(find(null, 'today', (o) => o.answer === COPY.checking && o.footer === null)).toBe(true);
    expect(find(null, 'today', (o) => o.retry === COPY.retry)).toBe(true);
    // With no answer, a failed request is the error, in the server's words when it sent some
    // (section 4); one that couldn't connect says so, and one rate limited says that; all with
    // Retry.
    const failed = (phase: string) =>
      cases.filter((c) => (c.in as In).fixture === null && (c.in as In).phase === phase);
    expect(failed('error').length).toBeGreaterThan(0);
    for (const c of failed('error')) {
      expect((c.out as any).state).toBe('error');
      expect((c.out as any).answer).toBe((c.in as In).message || COPY.unavailable);
      expect((c.out as any).retry).toBe(COPY.retry);
    }
    // A message that isn't COPY.unavailable, so a port that drops it fails.
    expect(failed('error').some((c) => (c.out as any).answer === ERROR_MESSAGES.bad_location)).toBe(
      true,
    );
    expect(ERROR_MESSAGES.bad_location).not.toBe(COPY.unavailable);
    expect(failed('offline').length).toBeGreaterThan(0);
    for (const c of failed('offline')) {
      expect((c.out as any).state).toBe('error');
      expect((c.out as any).answer).toBe(APP_COPY.staleApp);
      expect((c.out as any).retry).toBe(COPY.retry);
    }
    expect(failed('limited').length).toBeGreaterThan(0);
    for (const c of failed('limited')) {
      expect((c.out as any).state).toBe('error');
      expect((c.out as any).answer).toBe(ERROR_MESSAGES.rate_limited);
      expect((c.out as any).retry).toBe(COPY.retry);
    }
    // Over an answer that shows: after a failure, forecasts are unavailable, with Retry; offline,
    // the offline line, and rate limited, nothing new: neither has Retry. Past usableUntil,
    // neither line nor Retry.
    const over = (phase: string) =>
      cases.filter((c) => (c.in as In).fixture !== null && (c.in as In).phase === phase);
    for (const phase of ['error', 'offline', 'limited']) {
      expect(over(phase).length, phase).toBeGreaterThan(0);
      for (const c of over(phase)) {
        const o = c.out as any;
        const shows = o.state !== 'noRecent';
        expect(o.retry, `${phase} ${o.state}`).toBe(phase === 'error' && shows ? COPY.retry : null);
        if (phase === 'error') expect(o.footer.notice).toBe(shows ? COPY.unavailable : null);
        if (phase === 'limited' && shows) {
          const ready = homePage(res(c.in as In), { ...(c.in as In), phase: 'ready' });
          expect(o.footer.notice).toBe(ready.footer?.notice);
        }
      }
    }
    expect(over('limited').some((c) => (c.out as any).footer.notice === COPY.stale)).toBe(true);
    expect(over('error').some((c) => (c.out as any).state === 'notAvailable')).toBe(true);
    // The footer: the stale line, and offline, its own line, which beats it.
    expect(find('stale', 'today', (o) => o.footer.notice === COPY.stale)).toBe(true);
    expect(
      find('stale', 'today', (o) => o.footer.notice?.startsWith("You're offline. Showing")),
    ).toBe(true);
    // "Updated 9:05am GMT" with an answer, but for one without `updated`, which has none.
    for (const c of cases.filter((c) => (c.in as In).fixture !== null)) {
      const noUpdated = JSON.stringify((c.in as In).without) === '["updated"]';
      expect((c.out as any).footer.updated?.startsWith(`${COPY.updated} `) ?? null).toBe(
        noUpdated ? null : true,
      );
    }
    // Now's rows and the week's, only on their own pages with an answer to show.
    for (const c of cases) {
      const o = c.out as any;
      const view = (c.in as In).view;
      expect(o.hours === null, `hours on ${view}, ${o.state}`).toBe(
        !(view === 'now' && o.state === 'ready'),
      );
      expect(o.week === null, `week on ${view}, ${o.state}`).toBe(
        !(view === 'week' && o.state === 'ready'),
      );
      // Up to six 2-hour rows (fewer where the forecast ends), "6pm · 60%", read as "60% chance
      // at 6pm": core's words, which the app's templates (the Swift's) reproduce.
      if (o.hours) {
        expect(o.hours.heading).toBe(COPY.nextHoursSnow);
        expect(o.hours.rows.length).toBeLessThanOrEqual(6);
        for (const row of o.hours.rows) {
          expect(row.value).toBe(fill(APP_COPY.percent, { value: String(row.chance) }));
          expect(row.spoken).toBe(
            fill(APP_COPY.hourRowLabel, { chance: row.value, time: row.label }),
          );
        }
      }
      // "The week ahead", then up to seven days (fewer where the forecast ends), each with its
      // dot on the week's track and its agreement, never a percentage.
      if (o.week) {
        expect(o.week.heading).toBe(COPY.nextDays);
        expect(o.week.rows.length).toBeLessThanOrEqual(7);
        for (const row of o.week.rows) {
          expect(row.left).toBeGreaterThanOrEqual(0);
          expect(row.left).toBeLessThanOrEqual(100);
          expect(row.snowy).toBeLessThanOrEqual(row.total);
          expect(row.spoken).toMatch(/^[A-Z][a-z]+day, /);
          expect(row.spoken).not.toContain('%');
          expect(row.spoken.endsWith(snowAgreementLine(row.snowy, row.total))).toBe(true);
        }
      }
    }
    // The spec's examples, from the answers themselves: Durham's week, read in full.
    const durhamWeek = cases.find(
      (c) =>
        (c.in as In).fixture === 'durham-tomorrow' &&
        (c.in as In).view === 'week' &&
        (c.out as any).state === 'ready',
    )!.out as any;
    expect(durhamWeek.week.rows.slice(0, 3).map((r: any) => r.spoken)).toEqual([
      'Today, 0cm, too warm, 0 of 6 forecasts expect snow',
      'Thursday, 4cm, snow, 6 of 6 forecasts expect snow',
      'Friday, 8cm, heavy snow, 6 of 6 forecasts expect snow',
    ]);
    expect(durhamWeek.week.rows[1]).toMatchObject({
      label: 'Thu',
      amount: '4cm',
      bandLabel: 'Snow',
      snowy: 6,
      total: 6,
    });
    // Each dot from none to the snowiest day: the snowiest at the track's end, a day without
    // snow at its start, the rest in proportion, as the website draws them (core `track`).
    const amounts = durhamWeek.week.rows.map((r: any) => Number.parseFloat(r.amount));
    const most = Math.max(...amounts);
    expect(durhamWeek.week.rows.map((r: any) => r.left)).toEqual(
      amounts.map((a: number) => (a / most) * 100),
    );
    expect(durhamWeek.week.rows[0].left).toBe(0);
    expect(Math.max(...durhamWeek.week.rows.map((r: any) => r.left))).toBe(100);
    // A week without snow keeps every dot at the start (core's track divides by 1).
    const dry = cases.filter((c) =>
      (c.out as any).week?.rows.every((r: any) => r.amount === '0cm'),
    );
    expect(dry.length).toBeGreaterThan(0);
    for (const c of dry) {
      expect((c.out as any).week.rows.every((r: any) => r.left === 0)).toBe(true);
    }
    expect(
      cases.some((c) =>
        (c.out as any).hours?.rows.some(
          (r: any) => r.spoken === `${r.chance}% chance at ${r.label}`,
        ),
      ),
    ).toBe(true);
    expect(cases.some((c) => (c.out as any).hours?.rows.length === 6)).toBe(true);
    expect(cases.some((c) => (c.out as any).week?.rows.length === 7)).toBe(true);
    // The app's agreement templates say what core's line says, one forecast or more.
    for (let total = 0; total <= 6; total++) {
      for (let snowy = 0; snowy <= total; snowy++) {
        const values = { snowy: String(snowy), total: String(total) };
        const template = snowy === 1 ? APP_COPY.dayAgreementOne : APP_COPY.dayAgreement;
        expect(fill(template, values)).toBe(snowAgreementLine(snowy, total));
      }
    }
    // Each credit the API gives, with something to link.
    const credits = casesFor('page', 'creditParts').map((c) => (c.in as In).text);
    for (const credit of ATTRIBUTION) expect(credits).toContain(credit);
    // A model's row is its name and amount, apart as VoiceOver reads them and together on screen.
    const lines = outs.flatMap((o) => o.day?.lines ?? []);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.text).toBe(fill(APP_COPY.modelLine, { name: line.name, value: line.value }));
      expect(line.name.length && line.value.length).toBeTruthy();
    }
  });

  it('homeTopBar: the name, the place or "Finding you…", the exact-location chip and the notice', () => {
    const cases = casesFor('page', 'homeTopBar');
    const bar = (placeName: string | null, approximate: boolean, notice: string | null) =>
      cases.find(
        (c) =>
          (c.in as In).placeName === placeName &&
          (c.in as In).approximate === approximate &&
          (c.in as In).notice === notice,
      )?.out as any;
    // On approximate location, the website's chip and no line: VoiceOver hears "Using
    // approximate location." as the chip's hint.
    expect(bar('Leeds', true, null)).toEqual({
      name: 'willitsnow',
      nameEnd: '.today',
      nameLabel: APP_COPY.appNameLabel,
      place: 'Leeds',
      placeLabel: 'Place: Leeds. Change place.',
      approximate: null,
      useMyLocation: COPY.useExactLocation,
      settings: APP_COPY.settings,
    });
    expect(COPY.useExactLocation).toBe('Use my exact location');
    expect(APP_COPY.appNameLabel).toBe('Will it snow today');
    // The name as the website's header shows it (Header.astro), the same on every bar.
    for (const c of cases) {
      expect(`${(c.out as any).name}${(c.out as any).nameEnd}`).toBe(SITES.snow.name);
    }
    expect(bar('Leeds', false, null)).toMatchObject({ approximate: null, useMyLocation: null });
    for (const unknown of [null, '']) {
      expect(bar(unknown, true, null)).toMatchObject({
        place: COPY.locating,
        placeLabel: fill(APP_COPY.placeButtonUnknown, { status: COPY.locating }),
      });
    }
    // The notice shows above the chip on approximate location, and on a chosen place alone.
    expect(bar(null, true, APP_COPY.slugGone)).toMatchObject({
      approximate: APP_COPY.slugGone,
      useMyLocation: COPY.useExactLocation,
    });
    expect(bar('Leeds', false, APP_COPY.slugGone)).toMatchObject({
      approximate: APP_COPY.slugGone,
      useMyLocation: null,
    });
  });

  it("search: JavaScript's trim and length, and each part of a result's line left out", () => {
    const inputs = casesFor('search', 'searchInput');
    const kinds = (kind: string) => inputs.filter((c) => (c.out as In).kind === kind);
    expect(kinds('empty').length).toBeGreaterThan(2);
    expect(kinds('tooShort').length).toBeGreaterThan(2);
    // A search for text with JavaScript's spaces round it is for the text alone; U+0085 stays.
    expect(inputs.some((c) => (c.in as In).text.startsWith('\ufeff'))).toBe(true);
    expect(inputs.find((c) => (c.in as In).text === 'L\u0085')!.out).toEqual({
      kind: 'search',
      q: 'L\u0085',
    });
    // Two UTF-16 code units are enough, though one letter.
    expect(inputs.find((c) => (c.in as In).text === '\u{1D538}')!.out).toEqual({
      kind: 'search',
      q: '\u{1D538}',
    });
    const details = casesFor('search', 'resultDetail').map((c) => c.out);
    expect(details).toContain('England, United Kingdom');
    expect(details).toContain('England, GB');
    expect(details).toContain('');
  });

  it('recent: de-duplication, the cap and IP refused', () => {
    const added = casesFor('recent', 'addRecent');
    expect(added.some((c) => (c.in as In).target.kind === 'ip')).toBe(true);
    expect(
      added.some((c) => (c.out as unknown[]).length === 5 && (c.in as In).list.length === 5),
    ).toBe(true);
    expect(added.some((c) => (c.in as In).max === 0)).toBe(true);
  });

  it('recent: a line kept, replaced by the newer entry’s, and absent when not given', () => {
    const added = casesFor('recent', 'addRecent');
    const withLine = added.filter((c) => (c.in as In).detail !== undefined);
    expect(withLine.length).toBeGreaterThanOrEqual(5);
    expect(withLine.some((c) => (c.in as In).max === undefined)).toBe(true);
    for (const c of withLine) {
      const first = (c.out as In[])[0];
      if ((c.in as In).target.kind !== 'ip') expect(first.detail).toBe((c.in as In).detail);
    }
    // Chosen again without a line, a place that had one loses it: the newer entry wins.
    const again = added.find(
      (c) => (c.in as In).detail === undefined && (c.in as In).list[0]?.detail !== undefined,
    )!;
    expect(Object.keys((again.out as In[])[0])).toEqual(['target', 'name']);
  });

  it('saved: the limit, no IP or phone point, back on top of Recent, and choosing', () => {
    const saves = casesFor('saved', 'savePlace');
    // The tenth saved, the eleventh refused.
    expect(
      saves.some(
        (c) =>
          (c.in as In).lists.saved.length === PLACES.savedMax - 1 &&
          (c.out as In).saved.length === PLACES.savedMax,
      ),
    ).toBe(true);
    const full = saves.find((c) => (c.in as In).lists.saved.length === PLACES.savedMax)!;
    expect(full.out).toEqual(full.in.lists);
    // The phone's point is never saved, named or not; nor is approximate IP location.
    const phone = casesFor('saved', 'canSave').filter(
      (c) => (c.in as In).target.source === 'device' || (c.in as In).target.kind === 'ip',
    );
    expect(phone.length).toBeGreaterThan(0);
    expect(phone.every((c) => c.out === false)).toBe(true);
    // Removing puts the place back on top of Recent, with its line; the sixth is cut.
    const unsaved = casesFor('saved', 'unsavePlace').filter(
      (c) => (c.out as In).saved.length < (c.in as In).lists.saved.length,
    );
    expect(unsaved.length).toBeGreaterThanOrEqual(3);
    expect(unsaved.some((c) => (c.out as In).recent.length === PLACES.recentMax)).toBe(true);
    expect(unsaved.some((c) => (c.out as In).recent[0].detail !== undefined)).toBe(true);
    // Choosing a saved place changes nothing.
    expect(
      casesFor('saved', 'choosePlace').some(
        (c) => JSON.stringify(c.out) === JSON.stringify(c.in.lists),
      ),
    ).toBe(true);
    expect(casesFor('saved', 'shownRecent').length).toBeGreaterThanOrEqual(4);
  });
});
