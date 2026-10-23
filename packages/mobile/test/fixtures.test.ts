import { describe, expect, it } from 'vitest';
import { AHEAD, type SnowReason } from '@isithot/core';
import { FIXTURES, fixtureJson, makeFixture, type Fixture } from '../src/fixtures';

const spec = (name: string) => FIXTURES.find((f) => f.name === name)!;

describe('fixtures', () => {
  it('names each file once', () => {
    const names = FIXTURES.map((f) => f.name);
    expect(names).toEqual(['aberdeen-snow', 'leeds-dry']);
    expect(new Set(names).size).toBe(names.length);
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

describe('fixtureJson', () => {
  it('writes two-space JSON with _fixture first and a final newline', () => {
    const f = { _fixture: { query: 'q', now: 'n', note: 'x' }, units: 'c' } as unknown as Fixture;
    expect(fixtureJson(f)).toBe(
      '{\n  "_fixture": {\n    "query": "q",\n    "now": "n",\n    "note": "x"\n  },\n  "units": "c"\n}\n',
    );
  });
});
