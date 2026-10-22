import { describe, expect, it } from 'vitest';
import { SNOW } from '../src/config';
import type { ModelDay } from '../src/blend';
import type { MonthlyNormals } from '../src/climate';
import { computeSnowDay, type SnowDayComputation } from '../src/snowDay';
import { computeSnowWeek, formatSnowWeek, snowNormal } from '../src/snowWeek';
import type { Units } from '../src/units';

// Thursday 14 January 2027 to Wednesday 20 January.
const DATES = ['14', '15', '16', '17', '18', '19', '20'].map((d) => `2027-01-${d}`);

/** Eight models' snow for a day of each band, cm. */
const NONE = [0, 0, 0, 0, 0, 0, 0, 0];
const FLAKES = [0.2, 0.2, 0, 0, 0, 0, 0, 0];
const MAYBE = [1, 1, 1, 0, 0, 0, 0, 0];
const SNOWY = [1, 1, 2, 2, 3, 3, 4, 4];
const HEAVY = [6, 6, 7, 7, 8, 8, 9, 9];
const DEEP = [20, 20, 20, 20, 20, 20, 20, 20];

/** A whole day known by each model's snow, cold and dry unless `extra` says otherwise. */
const wholeDay = (
  date: string,
  totals: (number | null)[],
  extra: Partial<ModelDay> = {},
  normals: MonthlyNormals | null = null,
): SnowDayComputation =>
  computeSnowDay(
    {
      date,
      models: totals.map((snowfall, i) => ({
        id: `m${i}`,
        name: `M${i}`,
        high: null,
        feelsLike: null,
        rain: snowfall === null ? null : snowfall / SNOW.cmPerMm,
        snowfall,
        low: -5,
        ...extra,
      })),
      hourly: [],
    },
    { normals },
  )!;

const days = (totals: (number | null)[][], extra: Partial<ModelDay> = {}, dates = DATES) =>
  totals.map((t, i) => wholeDay(dates[i]!, t, extra));

const week = (totals: (number | null)[][], extra: Partial<ModelDay> = {}) =>
  computeSnowWeek(days(totals, extra));

const said = (totals: (number | null)[][], extra: Partial<ModelDay> = {}) => {
  const w = formatSnowWeek(week(totals, extra)!, 'c');
  return [w.answer, w.band, w.verdict];
};

const detail = (all: SnowDayComputation[], units: Units = 'c') =>
  formatSnowWeek(computeSnowWeek(all)!, units).detail;

/** The same normal snow (mm/day of water) in every month. */
const flat = (mmPerDay: number): MonthlyNormals => Array.from({ length: 12 }, () => mmPerDay);

describe('computeSnowWeek', () => {
  it('needs five days with enough models', () => {
    expect(computeSnowWeek([])).toBeNull();
    expect(week([SNOWY, SNOWY, SNOWY, SNOWY])).toBeNull();
    expect(computeSnowWeek(days(DATES.map((_, i) => (i < 4 ? SNOWY : [1, 1]))))).toBeNull();
  });

  it("totals each model's own snow, and finds the snowiest day from the same models", () => {
    const w = week([SNOWY, NONE, HEAVY, NONE, NONE, NONE, NONE])!;
    expect(w).toMatchObject({
      today: DATES[0],
      total: 10,
      normal: null,
      span: 7,
      snowDays: 2,
      maybeDays: 0,
      snowiest: { date: DATES[2], amount: 7.5 },
    });
    // Too few models cover every day: no total, and the snowiest day by its own amount.
    const gaps = week([SNOWY, [null, null, null, null, null, null, 1, 1, 1], HEAVY, NONE, NONE])!;
    expect(gaps.total).toBeNull();
    expect(gaps.snowiest).toEqual({ date: DATES[2], amount: 7.5 });
  });

  it("adds up the days' normals, today by the hours left", () => {
    const normal = (d: number) => wholeDay(DATES[d]!, NONE, {}, flat(1));
    const today = { ...normal(0), partial: true, hours: 12 };
    const w = computeSnowWeek([today, ...[1, 2, 3, 4, 5, 6].map(normal)])!;
    expect(w.normal).toBeCloseTo(0.7 * 6.5, 10);
    expect(w.span).toBe(6.5);
    expect(computeSnowWeek([today, ...days([NONE, NONE, NONE, NONE])])!.normal).toBeNull();
  });
});

describe('snowWeekVerdict', () => {
  it('says Yes with a single day of snow', () => {
    expect(said([NONE, SNOWY, NONE, NONE, NONE, NONE, NONE])).toEqual([
      'Yes.',
      'snow',
      'Snow on Fri.',
    ]);
    expect(said([SNOWY, NONE, NONE, SNOWY, NONE, NONE, NONE])).toEqual([
      'Yes.',
      'snow',
      'Snow today and on Sun.',
    ]);
    expect(said([NONE, SNOWY, HEAVY, NONE, NONE, NONE, NONE])).toEqual([
      'Yes.',
      'heavysnow',
      'Snow on Fri and Sat, heavy on Sat.',
    ]);
    expect(said([NONE, HEAVY, NONE, NONE, NONE, NONE, NONE])).toEqual([
      'Yes.',
      'heavysnow',
      'Heavy snow on Fri.',
    ]);
    expect(said([DEEP, NONE, NONE, NONE, NONE, NONE, NONE])).toEqual([
      'Yes.',
      'deepsnow',
      'Heavy snow today.',
    ]);
  });

  it('calls four days of snow a snowy week, heaviest on its heaviest day', () => {
    expect(said([SNOWY, SNOWY, SNOWY, SNOWY, NONE, NONE, NONE])).toEqual([
      'Yes.',
      'snow',
      'A snowy week.',
    ]);
    expect(said([SNOWY, SNOWY, HEAVY, SNOWY, NONE, NONE, NONE])).toEqual([
      'Yes.',
      'heavysnow',
      'A snowy week, heaviest on Sat.',
    ]);
    // A tie goes to the earlier day.
    expect(said([HEAVY, HEAVY, SNOWY, SNOWY, NONE, NONE, NONE])[2]).toBe(
      'A snowy week, heaviest today.',
    );
  });

  it('says Maybe with a day where snow is possible', () => {
    expect(said([NONE, MAYBE, NONE, NONE, FLAKES, NONE, NONE])).toEqual([
      'Maybe.',
      'maybesnow',
      'Snow possible on Fri.',
    ]);
    expect(said([MAYBE, MAYBE, NONE, MAYBE, MAYBE, NONE, NONE])).toEqual([
      'Maybe.',
      'maybesnow',
      'Snow possible most days.',
    ]);
  });

  it('says No otherwise, with flakes, warmth or nothing', () => {
    expect(said([FLAKES, FLAKES, FLAKES, NONE, FLAKES, NONE, NONE])).toEqual([
      'No.',
      'flakes',
      'A few flakes today and on Fri and Sat, nothing more.',
    ]);
    expect(said([NONE, NONE, NONE, NONE, NONE, NONE, NONE], { low: 5 })).toEqual([
      'No.',
      'nosnow',
      'Too warm for snow all week.',
    ]);
    expect(said([NONE, NONE, NONE, NONE, NONE])).toEqual(['No.', 'nosnow', 'No snow this week.']);
  });
});

describe('snowNormal', () => {
  it('compares a week with normal, as rain does', () => {
    expect(snowNormal(0.3, 0.05, 7)).toBe('rare');
    expect(snowNormal(0.3, 0.5, 7)).toBeNull();
    expect(snowNormal(5, 2, 7)).toBe('more');
    expect(snowNormal(2.9, 2, 7)).toBe('usual');
    expect(snowNormal(0.5, 3, 7)).toBe('less');
    expect(snowNormal(1.4, 1, 7)).toBe('usual');
    // A snowy week in a month where snow is rare is more than usual.
    expect(snowNormal(5, 0, 7)).toBe('more');
  });
});

describe('formatSnowWeek', () => {
  it('gives each day with its amount and label, why for a day without snow', () => {
    const all = [
      wholeDay(DATES[0]!, SNOWY),
      wholeDay(DATES[1]!, NONE, { low: 5 }),
      wholeDay(DATES[2]!, NONE, { rain: 5 }),
      wholeDay(DATES[3]!, NONE),
      wholeDay(DATES[4]!, FLAKES),
      wholeDay(DATES[5]!, MAYBE),
      wholeDay(DATES[6]!, HEAVY),
    ];
    const w = formatSnowWeek(computeSnowWeek(all)!, 'c');
    expect(w.days.map((d) => [d.label, d.amount, d.band, d.bandLabel])).toEqual([
      ['Today', 3, 'snow', 'Snow'],
      ['Fri', 0, 'nosnow', 'Too warm'],
      ['Sat', 0, 'nosnow', 'Rain'],
      ['Sun', 0, 'nosnow', 'Dry'],
      ['Mon', 0, 'flakes', 'A few flakes'],
      ['Tue', 0, 'maybesnow', 'Snow possible'],
      ['Wed', 8, 'heavysnow', 'Heavy snow'],
    ]);
    // As each day's own answer: the models expecting snow, of those with data, and why none.
    expect(w.days.map((d) => [d.label, d.chance, d.snowy, d.total, d.reason])).toEqual([
      ['Today', 1, 8, 8, null],
      ['Fri', 0, 0, 8, 'warm'],
      ['Sat', 0, 0, 8, 'rain'],
      ['Sun', 0, 0, 8, 'dry'],
      ['Mon', 0, 0, 8, null],
      ['Tue', 0.38, 3, 8, null],
      ['Wed', 1, 8, 8, null],
    ]);
    expect(w).toMatchObject({
      from: DATES[0],
      to: DATES[6],
      total: 11,
      normal: null,
      snowDays: 2,
      maybeDays: 1,
      snowiest: { date: DATES[6], amount: 8 },
    });
    expect(formatSnowWeek(computeSnowWeek(all)!, 'f')).toMatchObject({
      total: 4,
      snowiest: { date: DATES[6], amount: 3 },
    });
  });

  it('says how much falls across the week, and when most does', () => {
    expect(detail(days([SNOWY, NONE, HEAVY, NONE, NONE, NONE, NONE]))).toBe(
      'About 10cm across the week, most on Saturday (8cm).',
    );
    expect(detail(days([HEAVY, NONE, NONE, NONE, NONE, NONE, NONE]))).toBe(
      'About 8cm across the week, most today (8cm).',
    );
    expect(detail(days([HEAVY, NONE, NONE, NONE, NONE, NONE, NONE]), 'f')).toBe(
      'About 3in across the week, most today (3in).',
    );
    // Each model snows on a different day: no day stands out.
    const scattered = DATES.map((_, d) => NONE.map((_, i) => (i === d ? 1 : 0)));
    expect(detail(days(scattered))).toBe('About 1cm across the week.');
    const some = [1, 1, 1, null, null, null, null, null];
    const others = [null, null, null, 1, 1, 1, null, null];
    expect(detail(days([SNOWY, some, others, SNOWY, SNOWY]))).toBe(
      'Not enough forecasts for a weekly total.',
    );
  });

  it('says how cold it gets in a week without snow', () => {
    expect(detail(days([NONE, NONE, NONE, NONE, NONE]))).toBe('Down to -5° at the coldest.');
    expect(detail(days([NONE, NONE, NONE, NONE, NONE], { low: 5 }))).toBe(
      'No lower than 5° all week.',
    );
    expect(detail(days([NONE, NONE, NONE, NONE, NONE], { low: 5 }), 'f')).toBe(
      'No lower than 41° all week.',
    );
    expect(detail(days([NONE, NONE, NONE, NONE, NONE], { low: null }))).toBe(
      'Barely any snow all week.',
    );
    expect(detail(days([FLAKES, NONE, NONE, NONE, NONE]))).toBe('Barely any snow all week.');
  });

  it('compares the week with normal snow', () => {
    const withNormals = (totals: number[][], normals: MonthlyNormals, dates = DATES) =>
      totals.map((t, i) => wholeDay(dates[i]!, t, {}, normals));
    expect(detail(withNormals([NONE, NONE, NONE, NONE, NONE], flat(0)))).toBe(
      'Down to -5° at the coldest. Snow is rare here in January.',
    );
    const spanning = ['29', '30', '31']
      .map((d) => `2027-01-${d}`)
      .concat(['2027-02-01', '2027-02-02']);
    expect(detail(withNormals([NONE, NONE, NONE, NONE, NONE], flat(0), spanning))).toBe(
      'Down to -5° at the coldest. Snow is rare here at this time of year.',
    );
    expect(detail(withNormals([SNOWY, NONE, HEAVY, NONE, NONE, NONE, NONE], flat(0.5)))).toBe(
      'About 10cm across the week, most on Saturday (8cm). More snow than usual for January.',
    );
    expect(
      formatSnowWeek(computeSnowWeek(withNormals([NONE, NONE, NONE, NONE, NONE], flat(1)))!, 'c'),
    ).toMatchObject({
      normal: 4,
      detail: 'Down to -5° at the coldest. Less snow than usual for January.',
    });
    // In between rare and comparable: nothing to say.
    expect(detail(withNormals([NONE, NONE, NONE, NONE, NONE], flat(0.1)))).toBe(
      'Down to -5° at the coldest.',
    );
  });
});
