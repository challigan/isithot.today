import { beforeAll, describe, expect, it } from 'vitest';
import {
  ATTRIBUTION,
  COPY,
  ERROR_MESSAGES,
  GRID,
  creditParts,
  defaultView,
  localDateTime,
  question,
  roundToGrid,
  showsTomorrow,
  viewDisplay,
  viewLabel,
  type TodayResponse,
} from '@isithot/core';
import {
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
} from '@isithot/client';
import { APP_COPY } from '../src/appCopy';
import { FIXTURES, fixtureJson, makeFixture, type Fixture } from '../src/fixtures';
import { homePage } from '../src/page';
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
  alertPlaceAllowed: (i) => alertPlaceAllowed(i.target),
  registrationBody: (i) => registrationBody(i),
  fingerprint: (i) => fingerprint(i.body),
  alertAction: (i) => alertAction(i),
  parseDeepLink: (i) => parseDeepLink(i.url),
  notificationRoute: (i) => notificationRoute(i.payload, () => i.placeToday),
  addRecent: (i) => addRecent(i.list, i.target, i.name, i.max),
  removeRecent: (i) => removeRecent(i.list, i.target),
  homePage: (i) => homePage(i.fixture === null ? null : res(i), i),
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
const MOBILE = ['homePage'];

const file = (name: string) => files.find((f) => f.name === name)!.vectors;
const casesFor = (name: string, fn: string) => file(name).cases.filter((c) => c.fn === fn);
const local = (zone: string, now: number) => {
  const l = localDateTime(zone, new Date(now));
  return `${l.date} ${Math.round(l.hours * 60)}`;
};

describe('vectorFiles', () => {
  it('writes every file section 7.4 names, in its order, then the page', () => {
    expect(files.map((f) => f.name)).toEqual([...SPEC_FILES, ...PAGE_FILES]);
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

  it('alerts: every outcome of section 6.6’s rules', () => {
    const outs = new Set(casesFor('alerts', 'alertAction').map((c) => c.out));
    expect(outs).toEqual(new Set(['put', 'delete', 'none', 'needsPlace', 'needsToken']));
    expect(new Set(casesFor('alerts', 'alertPlaceAllowed').map((c) => c.out))).toEqual(
      new Set([true, false]),
    );
    // A searched place with an empty name, and one with none: the registration names neither.
    const unnamed = casesFor('alerts', 'registrationBody').filter(
      (c) => (c.in as In).place.source === 'search' && !(c.in as In).place.name,
    );
    expect(new Set(unnamed.map((c) => (c.in as In).place.name))).toEqual(new Set(['', undefined]));
    expect(unnamed.every((c) => !('name' in (c.out as any).place))).toBe(true);
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
    // Each credit the API gives, with something to link.
    const credits = casesFor('page', 'creditParts').map((c) => (c.in as In).text);
    for (const credit of ATTRIBUTION) expect(credits).toContain(credit);
  });

  it('recent: de-duplication, the cap and IP refused', () => {
    const added = casesFor('recent', 'addRecent');
    expect(added.some((c) => (c.in as In).target.kind === 'ip')).toBe(true);
    expect(
      added.some((c) => (c.out as unknown[]).length === 5 && (c.in as In).list.length === 5),
    ).toBe(true);
    expect(added.some((c) => (c.in as In).max === 0)).toBe(true);
  });
});
