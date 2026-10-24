import { beforeAll, describe, expect, it } from 'vitest';
import {
  AHEAD,
  CACHE,
  HOUR,
  localDateTime,
  updatedParts,
  type SnowReason,
  type TodayResponse,
} from '@isithot/core';
import {
  pickHour,
  resultDetail,
  searchInput,
  searchQuery,
  searchTarget,
  targetFromQuery,
  targetKey,
  todayQuery,
  usableUntil,
} from '@isithot/client';
import { createSyntheticFetch, zoneOffsetSeconds } from '@isithot/providers';
import { CITIES } from '@isithot/server';
import {
  FIXTURES,
  SEARCH_FIXTURES,
  endsAfter,
  fixtureJson,
  makeFixture,
  makeSearchFixture,
  offsetName,
  onlyModels,
  relabelZone,
  upstreamDown,
  type Fixture,
} from '../src/fixtures';

const spec = (name: string) => FIXTURES.find((f) => f.name === name)!;

/** Every fixture, made once, as its file has it. */
const made = new Map<string, Fixture>();
beforeAll(async () => {
  for (const s of FIXTURES) made.set(s.name, JSON.parse(fixtureJson(await makeFixture(s))));
});
const fixture = (name: string): Fixture => made.get(name)!;

/** "HH:MM" at the answer's place. */
const clock = (res: TodayResponse, iso: string): string => {
  const { hours } = localDateTime(res.location.timezone, new Date(iso));
  const minutes = Math.round(hours * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};
const aheadTimes = (res: TodayResponse) => res.snow!.ahead!.map((a) => a.time);

describe('fixtures', () => {
  it('names each file once', () => {
    const names = FIXTURES.map((f) => f.name);
    expect(names).toEqual([
      'aberdeen-snow',
      'durham-tomorrow',
      'shrewsbury-maybe',
      'reykjavik-mixed',
      'leeds-dry',
      'denver-f',
      'kolkata-0530',
      'kathmandu-0545',
      'adelaide-1030',
      'kiritimati-14',
      'london-dst-autumn-night',
      'london-dst-autumn-evening',
      'london-dst-spring-night',
      'london-dst-spring-evening',
      'ip-first-launch',
      'stale',
      'no-week',
      'no-now',
      'limited',
      'old-forecast',
      'forecast-ends',
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('each asks as the app does, says so in the file, and has a note', () => {
    for (const s of FIXTURES) {
      const f = fixture(s.name);
      expect(f._fixture, s.name).toEqual({
        query: todayQuery(s.target, s.units, { ahead: ['snow'] }),
        now: new Date(s.now).toISOString(),
        note: s.note,
      });
      expect(s.note.length, s.name).toBeGreaterThan(40);
    }
  });

  it('each has a snow answer whose days are the same dates as the hot ones', () => {
    // So a port that reads `snow.days` agrees with core's `showsTomorrow`, which reads `days`.
    for (const s of FIXTURES) {
      const f = fixture(s.name);
      expect(f.snow, s.name).toBeDefined();
      expect(
        f.snow!.days.map((d) => d.date),
        s.name,
      ).toEqual(f.days.map((d) => d.date));
    }
  });

  it('each says when its forecast was fetched, at the place, as core words it', () => {
    for (const s of FIXTURES) {
      const f = fixture(s.name);
      expect(f.updated, s.name).toEqual(updatedParts(f.updatedAt, f.location.timezone));
    }
  });

  it('has its hours ahead an hour apart, each after the hour the answer was made in', () => {
    for (const s of FIXTURES) {
      const f = fixture(s.name);
      const made = Date.parse(f.snow!.days[0]!.from);
      const times = aheadTimes(f).map((t) => Date.parse(t));
      expect(times.length, s.name).toBeGreaterThan(0);
      expect(times[0]! - made, s.name).toBeGreaterThan(0);
      expect(times[0]! - made, s.name).toBeLessThanOrEqual(HOUR);
      for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!, s.name).toBe(HOUR);
    }
  });

  it('asks as the app does, and says so in the file', async () => {
    const f = await makeFixture(spec('aberdeen-snow'));
    expect(f._fixture).toEqual({
      query: 'place=aberdeen-gb&units=c&ahead=snow',
      now: '2026-12-02T09:05:00.000Z',
      note: spec('aberdeen-snow').note,
    });
    // The server's own answer at the fixed moment: the forecast was fetched then.
    expect(f.updatedAt).toBe('2026-12-02T09:05:00.000Z');
    expect(f.updated).toEqual({ date: '2026-12-02', clock: '9:05am GMT' });
    expect(f.location).toMatchObject({ name: 'Aberdeen', slug: 'aberdeen-gb', source: 'city' });
    expect(f.units).toBe('c');
    expect(f.snow!.unit).toBe('cm');
  });

  it('aberdeen-snow: snow today, and for the rest of the day in every hour ahead', async () => {
    const { snow } = await makeFixture(spec('aberdeen-snow'));
    const today = snow!.days[0]!;
    expect([today.band, today.answer, today.reason, today.bandLabel]).toEqual([
      'snow',
      'Yes.',
      null,
      'Snow',
    ]);
    expect(today.snowy).toBeGreaterThan(today.total / 2);
    // Raining for now.
    expect([snow!.now!.band, snow!.now!.answer]).toEqual(['nosnow', 'No.']);
    expect(snow!.week!.answer).toBe('Yes.');

    const ahead = snow!.ahead!;
    expect(ahead).toHaveLength(AHEAD.hours);
    expect(ahead.map((e) => e.time)).toEqual(
      [10, 11, 12, 13, 14, 15].map((h) => `2026-12-02T${h}:00:00.000Z`),
    );
    for (const e of ahead) {
      expect([e.today.date, e.today.band, e.today.answer]).toEqual(['2026-12-02', 'snow', 'Yes.']);
      expect(e.week!.answer).toBe('Yes.');
    }
  });

  it('leeds-dry: no snow today, tomorrow or this week, each with why', async () => {
    const { location, snow } = await makeFixture(spec('leeds-dry'));
    expect(location.name).toBe('Leeds');
    const [today, tomorrow] = snow!.days;
    expect([today!.band, today!.answer, today!.reason, today!.bandLabel]).toEqual([
      'nosnow',
      'No.',
      'rain',
      'Rain',
    ]);
    expect([tomorrow!.band, tomorrow!.answer, tomorrow!.reason, tomorrow!.bandLabel]).toEqual([
      'nosnow',
      'No.',
      'dry',
      'Dry',
    ]);
    expect(today!.snowy).toBe(0);
    expect(snow!.now!.answer).toBe('No.');

    const week = snow!.week!;
    expect([week.answer, week.snowDays, week.maybeDays]).toEqual(['No.', 0, 0]);
    // A few flakes on Saturday at most; every other day without snow says why.
    expect(week.days.map((d) => d.band)).toEqual([
      'nosnow',
      'nosnow',
      'nosnow',
      'nosnow',
      'flakes',
      'nosnow',
      'nosnow',
    ]);
    const reasons = new Set<SnowReason | null>(week.days.map((d) => d.reason));
    expect(reasons).toEqual(new Set(['rain', 'dry', 'warm', null]));
    for (const d of week.days) expect(d.reason === null).toBe(d.band !== 'nosnow');

    // Rain for the rest of the day until 2pm, then dry.
    const ahead = snow!.ahead!;
    expect(ahead).toHaveLength(AHEAD.hours);
    expect(ahead.map((e) => [e.time.slice(11, 16), e.today.band, e.today.reason])).toEqual([
      ['10:00', 'nosnow', 'rain'],
      ['11:00', 'nosnow', 'rain'],
      ['12:00', 'nosnow', 'rain'],
      ['13:00', 'nosnow', 'rain'],
      ['14:00', 'nosnow', 'dry'],
      ['15:00', 'nosnow', 'dry'],
    ]);
  });

  it('durham-tomorrow: no snow today, and snow likely tomorrow from every forecast', () => {
    const f = fixture('durham-tomorrow');
    expect(f.updated).toEqual({ date: '2026-12-16', clock: '6:05pm GMT' });
    const [today, tomorrow] = f.snow!.days;
    expect([today!.band, today!.answer, today!.reason]).toEqual(['nosnow', 'No.', 'warm']);
    expect([tomorrow!.date, tomorrow!.band, tomorrow!.answer, tomorrow!.reason]).toEqual([
      '2026-12-17',
      'snow',
      'Yes.',
      null,
    ]);
    expect([tomorrow!.snowy, tomorrow!.total]).toEqual([6, 6]);
    expect(tomorrow!.likely).toEqual({ from: 2, to: 8 });
    expect(tomorrow!.from).toBe('2026-12-17T00:00:00.000Z');
    // The hours ahead run to midnight, which answers for the 17th.
    expect(aheadTimes(f).map((t) => clock(f, t))).toEqual([
      '19:00',
      '20:00',
      '21:00',
      '22:00',
      '23:00',
      '00:00',
    ]);
    const ahead = f.snow!.ahead!;
    expect(ahead.map((a) => [a.today.date, a.today.band])).toEqual([
      ...Array(5).fill(['2026-12-16', 'nosnow']),
      ['2026-12-17', 'snow'],
    ]);
    expect(ahead[5]!.week!.from).toBe('2026-12-17');
  });

  it('shrewsbury-maybe: Maybe today, from 3 of 6 forecasts, in every hour ahead', () => {
    const f = fixture('shrewsbury-maybe');
    const today = f.snow!.days[0]!;
    expect([today.band, today.answer, today.snowy, today.total]).toEqual([
      'maybesnow',
      'Maybe.',
      3,
      6,
    ]);
    expect(today.likely).toEqual({ from: 17, to: 20 });
    expect(f.snow!.now!.band).toBe('nosnow');
    for (const a of f.snow!.ahead!)
      expect([a.today.band, a.today.answer]).toEqual(['maybesnow', 'Maybe.']);
  });

  it('reykjavik-mixed: flakes today, Maybe tomorrow, and Now from none to flakes to possible', () => {
    const f = fixture('reykjavik-mixed');
    expect(f.location.timezone).toBe('Etc/GMT+1');
    expect(f.updated?.clock).toBe('2:05pm');
    expect(f.snow!.days.map((d) => [d.band, d.answer])).toEqual([
      ['flakes', 'No.'],
      ['maybesnow', 'Maybe.'],
    ]);
    expect(f.snow!.now!.band).toBe('nosnow');
    expect(f.snow!.ahead!.map((a) => a.now.band)).toEqual([
      'nosnow',
      'flakes',
      'maybesnow',
      'nosnow',
      'nosnow',
      'nosnow',
    ]);
  });

  it('denver-f: a searched place in °F, with snow in inches', () => {
    const f = fixture('denver-f');
    expect(f._fixture.query).toBe(
      'lat=39.75&lon=-105&name=Denver&country=US&source=search&units=f&ahead=snow',
    );
    expect(f.location).toMatchObject({ name: 'Denver', country: 'US', source: 'search' });
    expect(f.location.slug).toBeUndefined();
    expect(f.location.timezone).toBe('Etc/GMT+7');
    expect([f.units, f.snow!.unit]).toEqual(['f', 'in']);
    expect(f.updated?.clock).toBe('9:05am');
    const [today, tomorrow] = f.snow!.days;
    expect([today!.band, today!.reason]).toEqual(['nosnow', 'rain']);
    expect([tomorrow!.band, tomorrow!.answer, tomorrow!.amount]).toEqual([
      'maybesnow',
      'Maybe.',
      0.2,
    ]);
    expect(tomorrow!.likely).toEqual({ from: 1, to: 4 });
    expect(tomorrow!.detail).toContain('in');
    expect(tomorrow!.from).toBe('2027-01-29T07:00:00.000Z');
  });

  it('the offset zones: each hour ahead starts off the UTC hour, at the place’s own hours', () => {
    const zones = [
      ['kolkata-0530', 'Asia/Kolkata', 30, ['22:00', '23:00', '00:00', '01:00', '02:00', '03:00']],
      [
        'kathmandu-0545',
        'Asia/Kathmandu',
        15,
        ['18:00', '19:00', '20:00', '21:00', '22:00', '23:00'],
      ],
      [
        'adelaide-1030',
        'Australia/Adelaide',
        30,
        ['18:00', '19:00', '20:00', '21:00', '22:00', '23:00'],
      ],
      [
        'kiritimati-14',
        'Pacific/Kiritimati',
        0,
        ['18:00', '19:00', '20:00', '21:00', '22:00', '23:00'],
      ],
    ] as const;
    for (const [name, zone, minutes, hours] of zones) {
      const f = fixture(name);
      expect(f.location.timezone, name).toBe(zone);
      expect(
        aheadTimes(f).map((t) => new Date(t).getUTCMinutes()),
        name,
      ).toEqual(Array(6).fill(minutes));
      expect(
        aheadTimes(f).map((t) => clock(f, t)),
        name,
      ).toEqual(hours);
      // Tomorrow starts at the place's midnight.
      expect(clock(f, f.snow!.days[1]!.from), name).toBe('00:00');
      expect(f.snow!.week!.days, name).toHaveLength(7);
    }
  });

  it('kolkata-0530: the hours ahead past midnight answer for the new date', () => {
    const f = fixture('kolkata-0530');
    expect(f.updated).toEqual({ date: '2026-12-02', clock: '9:10pm' });
    expect(f.snow!.ahead!.map((a) => a.today.date)).toEqual([
      '2026-12-02',
      '2026-12-02',
      '2026-12-03',
      '2026-12-03',
      '2026-12-03',
      '2026-12-03',
    ]);
    expect(f.snow!.ahead![2]!.week!.from).toBe('2026-12-03');
  });

  it('the searched places off the UTC hour are asked for by their coordinates', () => {
    for (const name of ['kathmandu-0545', 'adelaide-1030', 'kiritimati-14']) {
      const f = fixture(name);
      expect(f.location.source, name).toBe('search');
      expect(f._fixture.query, name).toMatch(/^lat=.*&source=search&units=c&ahead=snow$/);
      expect(f.updated?.clock, name).toBe('5:30pm');
    }
  });

  it('kiritimati-14: a day ahead of UTC-10, and the forecast starts at its own midnight', () => {
    const f = fixture('kiritimati-14');
    expect(f.updated?.date).toBe('2026-12-02');
    expect(localDateTime('Etc/GMT+10', new Date(f.updatedAt)).date).toBe('2026-12-01');
    expect(f.days[0]!.date).toBe('2026-12-02');
    expect([f.snow!.week!.from, f.snow!.week!.to]).toEqual(['2026-12-02', '2026-12-08']);
  });

  it('the clock changes: the hours ahead cross them as London’s clocks do', () => {
    const autumn = fixture('london-dst-autumn-night');
    expect(autumn.updated).toEqual({ date: '2026-10-25', clock: '12:30am BST' });
    // 1am comes twice: BST, then GMT.
    expect(aheadTimes(autumn)).toEqual(
      ['00', '01', '02', '03', '04', '05'].map((h) => `2026-10-25T${h}:00:00.000Z`),
    );
    expect(aheadTimes(autumn).map((t) => clock(autumn, t))).toEqual([
      '01:00',
      '01:00',
      '02:00',
      '03:00',
      '04:00',
      '05:00',
    ]);
    const spring = fixture('london-dst-spring-night');
    expect(spring.updated).toEqual({ date: '2027-03-28', clock: '12:30am GMT' });
    // There is no 1am.
    expect(aheadTimes(spring).map((t) => clock(spring, t))).toEqual([
      '02:00',
      '03:00',
      '04:00',
      '05:00',
      '06:00',
      '07:00',
    ]);
    const evenings = [
      ['london-dst-autumn-evening', '5:30pm GMT', '2026-10-25T18:00:00.000Z'],
      ['london-dst-spring-evening', '5:30pm BST', '2027-03-28T17:00:00.000Z'],
    ] as const;
    for (const [name, at, six] of evenings) {
      const f = fixture(name);
      expect(f.updated?.clock, name).toBe(at);
      expect(aheadTimes(f)[0], name).toBe(six);
      expect(clock(f, six), name).toBe('18:00');
    }
  });

  it('ip-first-launch: no place and no units, so the server chooses both', () => {
    const f = fixture('ip-first-launch');
    expect(f._fixture.query).toBe('ahead=snow');
    expect(f.location).toMatchObject({ name: 'Leeds', source: 'ip', country: 'GB' });
    expect([f.units, f.snow!.unit]).toEqual(['c', 'cm']);
  });

  it('stale: answered from the cache with the upstream down', () => {
    const f = fixture('stale');
    const fresh = fixture('aberdeen-snow');
    expect(f.stale).toBe(true);
    expect(f.updatedAt).toBe('2026-12-02T07:05:00.000Z');
    expect(f.updated?.clock).toBe('7:05am GMT');
    expect(f.snow!.days[0]!.from).toBe('2026-12-02T09:05:00.000Z');
    // The same forecast, worked out at the same moment, as aberdeen-snow.
    expect(f.snow).toEqual(fresh.snow);
    // Shown until the stale cut-off, 6 hours after the forecast was fetched.
    expect(usableUntil(f)).toBe(Date.parse(f.updatedAt) + CACHE.forecastStale * 1000);
    expect(new Date(usableUntil(f)).toISOString()).toBe('2026-12-02T13:05:00.000Z');
  });

  it('no-week and no-now: aberdeen-snow without its own week, or its own Now', () => {
    const fresh = fixture('aberdeen-snow');
    const noWeek = fixture('no-week');
    const noNow = fixture('no-now');
    expect(noWeek.snow!.week).toBeUndefined();
    expect(noNow.snow!.now).toBeUndefined();
    const { week: _week, ...withoutWeek } = fresh.snow!;
    const { now: _now, ...withoutNow } = fresh.snow!;
    expect(noWeek.snow).toEqual(withoutWeek);
    expect(noNow.snow).toEqual(withoutNow);
    expect(noWeek.snow!.ahead!.every((a) => a.week !== null)).toBe(true);
    const { snow: _a, _fixture: _b, ...rest } = fresh;
    expect(noWeek).toMatchObject(rest);
    expect(noNow).toMatchObject(rest);
  });

  it('limited: two models, so every day says so, and there is no week', () => {
    const f = fixture('limited');
    for (const d of f.snow!.days) {
      expect([d.total, d.models.length, d.confidence, d.limitedText]).toEqual([
        2,
        2,
        'limited',
        'Limited forecast data',
      ]);
      expect(d.models.map((m) => m.id)).toEqual(['ecmwf_ifs025', 'ncep_gfs_seamless']);
    }
    expect(f.snow!.week).toBeUndefined();
    expect(f.snow!.ahead!.map((a) => a.week)).toEqual(Array(AHEAD.hours).fill(null));
    expect(f.snow!.ahead!.every((a) => a.today.limitedText === 'Limited forecast data')).toBe(true);
  });

  it('old-forecast: fetched 7 hours before now, so past the stale cut-off', () => {
    const f = fixture('old-forecast');
    const now = Date.parse(f._fixture.now);
    expect(f.updatedAt).toBe('2026-12-16T11:05:00.000Z');
    expect(now - Date.parse(f.updatedAt)).toBe(7 * HOUR);
    expect(f.stale).toBeUndefined();
    expect(usableUntil(f)).toBe(Date.parse(f.updatedAt) + CACHE.forecastStale * 1000);
    expect(usableUntil(f)).toBeLessThan(now);
    expect(pickHour(f, now)).toBeNull();
  });

  it('forecast-ends: no tomorrow, no week, and the last hour ahead ends first', () => {
    const f = fixture('forecast-ends');
    expect(f.days).toHaveLength(1);
    expect(f.snow!.days).toHaveLength(1);
    expect(f.snow!.week).toBeUndefined();
    expect(aheadTimes(f).map((t) => clock(f, t))).toEqual(['21:00', '22:00', '23:00']);
    expect(f.snow!.ahead!.map((a) => a.week)).toEqual([null, null, null]);
    const lastEnds = Date.parse(aheadTimes(f).at(-1)!) + HOUR;
    expect(usableUntil(f)).toBe(lastEnds);
    expect(lastEnds).toBeLessThan(Date.parse(f.updatedAt) + CACHE.forecastStale * 1000);
  });

  it('is the same answer every time it is made', async () => {
    for (const s of FIXTURES) {
      const [a, b] = [await makeFixture(s), await makeFixture(s)];
      expect(fixtureJson(b)).toBe(fixtureJson(a));
    }
  });

  it('fails loudly when the server does not answer', async () => {
    await expect(
      makeFixture({ ...spec('leeds-dry'), target: { kind: 'city', slug: 'nowhere-gb' } }),
    ).rejects.toThrow(/^leeds-dry: the server answered 404: .*not_found/);
  });
});

describe('search fixtures', () => {
  const made = new Map<string, Awaited<ReturnType<typeof makeSearchFixture>>>();
  beforeAll(async () => {
    for (const s of SEARCH_FIXTURES) {
      made.set(s.name, JSON.parse(fixtureJson(await makeSearchFixture(s))));
    }
  });
  const search = (name: string) => made.get(name)!;
  /** The key of the place a today fixture asks about, as its query names it. */
  const fixtureKey = (name: string) => {
    const s = spec(name);
    return targetKey(targetFromQuery(todayQuery(s.target, s.units, { ahead: ['snow'] }))!);
  };

  it('names each file once, and each asks as the picker does', () => {
    expect(SEARCH_FIXTURES.map((s) => s.name)).toEqual([
      'search-leeds',
      'search-kathmandu',
      'search-none',
    ]);
    for (const s of SEARCH_FIXTURES) {
      // What the picker sends for what was typed: the trimmed text, as searchQuery writes it.
      expect(searchInput(s.q)).toEqual({ kind: 'search', q: s.q });
      expect(search(s.name)._fixture).toEqual({
        query: searchQuery(s.q),
        now: s.now,
        note: s.note,
      });
      expect(s.note.length).toBeGreaterThan(0);
    }
  });

  it('search-leeds: Leeds, with its city page, which leeds-dry answers', () => {
    const [leeds, ...others] = search('search-leeds').results;
    expect(others).toEqual([]);
    expect(leeds).toMatchObject({ name: 'Leeds', slug: 'leeds-gb' });
    expect(resultDetail(leeds!)).toBe('England, United Kingdom');
    expect(targetKey(searchTarget(leeds!))).toBe(fixtureKey('leeds-dry'));
  });

  it('search-kathmandu: a place with no city page, on the grid point kathmandu-0545 answers', () => {
    const [kathmandu, ...others] = search('search-kathmandu').results;
    expect(others).toEqual([]);
    expect(kathmandu!.slug).toBeUndefined();
    expect(resultDetail(kathmandu!)).toBe('Bagmati Province, Nepal');
    expect(searchTarget(kathmandu!)).toMatchObject({ kind: 'coords', source: 'search' });
    expect(targetKey(searchTarget(kathmandu!))).toBe(fixtureKey('kathmandu-0545'));
  });

  it('search-none: no results', () => {
    expect(search('search-none').results).toEqual([]);
  });

  it('is the same answer every time it is made', async () => {
    for (const s of SEARCH_FIXTURES) {
      expect(fixtureJson(await makeSearchFixture(s))).toBe(fixtureJson(search(s.name)));
    }
  });

  it('fails loudly when the server does not answer', async () => {
    await expect(makeSearchFixture(SEARCH_FIXTURES[0]!, upstreamDown)).rejects.toThrow(
      /^search-leeds: the server answered 503: .*upstream_unavailable/,
    );
  });
});

describe('fixtureJson', () => {
  it('writes two-space JSON with _fixture first and a final newline', () => {
    const f = { _fixture: { query: 'q', now: 'n', note: 'x' }, units: 'c' } as unknown as Fixture;
    expect(fixtureJson(f)).toBe(
      '{\n  "_fixture": {\n    "query": "q",\n    "now": "n",\n    "note": "x"\n  },\n  "units": "c"\n}\n',
    );
  });
});

describe('the upstream changes', () => {
  const at = new Date('2026-12-02T11:45:00Z');
  const synthetic = createSyntheticFetch(CITIES, () => at);
  const forecastUrl = (lat: number, lon: number) =>
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&models=ecmwf_ifs025,ncep_gfs_seamless`;
  interface Body {
    timezone: string;
    timezone_abbreviation: string;
    utc_offset_seconds: number;
    hourly: Record<string, unknown[]> & { time: string[] };
  }
  const body = async (res: Response) => (await res.json()) as Body;

  it('relabelZone: the place’s zone and offset, the local hours as they were', async () => {
    const before = await body(await synthetic(forecastUrl(27.7, 85.3)));
    const after = await body(
      await relabelZone(synthetic, 'Asia/Kathmandu', at)(forecastUrl(27.7, 85.3)),
    );
    expect([before.timezone, before.utc_offset_seconds]).toEqual(['Etc/GMT-6', 6 * 3600]);
    expect(after.timezone).toBe('Asia/Kathmandu');
    expect(after.utc_offset_seconds).toBe(zoneOffsetSeconds('Asia/Kathmandu', at));
    expect(after.utc_offset_seconds).toBe(5 * 3600 + 45 * 60);
    expect(after.timezone_abbreviation).toBe('GMT+5:45');
    expect(after.hourly).toEqual(before.hourly);
  });

  it('relabelZone: a whole day apart, the dates move by the day', async () => {
    const before = await body(await synthetic(forecastUrl(1.85, -157.4)));
    const after = await body(
      await relabelZone(synthetic, 'Pacific/Kiritimati', at)(forecastUrl(1.85, -157.4)),
    );
    expect(before.timezone).toBe('Etc/GMT+10');
    expect([after.utc_offset_seconds, after.timezone_abbreviation]).toEqual([14 * 3600, 'GMT+14']);
    expect(before.hourly.time[0]).toBe('2026-12-02T00:00');
    expect(after.hourly.time[0]).toBe('2026-12-03T00:00');
    expect(after.hourly.time.map((t) => t.slice(10))).toEqual(
      before.hourly.time.map((t) => t.slice(10)),
    );
    const { time: _a, ...values } = after.hourly;
    const { time: _b, ...was } = before.hourly;
    expect(values).toEqual(was);
  });

  it('relabelZone leaves other requests, and failures, alone', async () => {
    const search = 'https://geocoding-api.open-meteo.com/v1/search?name=Leeds&count=1';
    const relabelled = relabelZone(synthetic, 'Asia/Kolkata', at);
    expect(await (await relabelled(search)).json()).toEqual(await (await synthetic(search)).json());
    const down = relabelZone(upstreamDown, 'Asia/Kolkata', at);
    expect((await down(forecastUrl(22.55, 88.35))).status).toBe(503);
  });

  it('onlyModels: every hour of the others is null', async () => {
    const all = await body(
      await synthetic('https://api.open-meteo.com/v1/forecast?latitude=57.15&longitude=-2.1'),
    );
    const two = await body(
      await onlyModels(synthetic, ['ecmwf_ifs025'])(
        'https://api.open-meteo.com/v1/forecast?latitude=57.15&longitude=-2.1',
      ),
    );
    expect(two.hourly.time).toEqual(all.hourly.time);
    for (const [key, values] of Object.entries(two.hourly)) {
      if (key === 'time') continue;
      if (key.endsWith('_ecmwf_ifs025')) expect(values, key).toEqual(all.hourly[key]);
      else
        expect(
          values.every((v) => v === null),
          key,
        ).toBe(true);
    }
  });

  it('endsAfter: no hour after the last', async () => {
    const all = await body(await synthetic(forecastUrl(53.8, -1.55)));
    const short = await body(
      await endsAfter(synthetic, '2026-12-02T23:00')(forecastUrl(53.8, -1.55)),
    );
    expect(short.hourly.time).toHaveLength(24);
    expect(short.hourly.time.at(-1)).toBe('2026-12-02T23:00');
    for (const values of Object.values(short.hourly)) expect(values).toHaveLength(24);
    expect(short.hourly.temperature_2m_ecmwf_ifs025).toEqual(
      all.hourly.temperature_2m_ecmwf_ifs025!.slice(0, 24),
    );
  });

  it('offsetName: how a zone with only an offset is abbreviated', () => {
    expect(offsetName(0)).toBe('GMT');
    expect(offsetName(19800)).toBe('GMT+5:30');
    expect(offsetName(-25200)).toBe('GMT-7');
    expect(offsetName(-9 * 3600 - 30 * 60)).toBe('GMT-9:30');
  });

  it('stale is the cache’s answer: with the copy past the stale limit, the server has none', async () => {
    // Fetched 6 hours and 5 minutes before, and the upstream down: nothing it may answer with.
    const tooOld = { ...spec('stale'), name: 'too-old', cachedAt: '2026-12-02T03:00:00.000Z' };
    await expect(makeFixture(tooOld)).rejects.toThrow(/^too-old: the server answered 503: /);
  });

  it('with no model answering, the server has nothing to answer with', async () => {
    const none = { ...spec('limited'), name: 'none', models: [] };
    await expect(makeFixture(none)).rejects.toThrow(/^none: the server answered 503: /);
  });
});
