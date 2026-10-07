import { describe, expect, it } from 'vitest';
import type { MonthlyNormals } from '../src/climate';
import {
  computeRainDay,
  computeRainWeek,
  formatRainWeek,
  rainNormal,
  type RainDayComputation,
} from '../src/rain';

const HOUR = 3_600_000;

// Thursday 15 October 2026 to Wednesday 21 October.
const DATES = ['15', '16', '17', '18', '19', '20', '21'].map((d) => `2026-10-${d}`);

/** Eight models' totals for a day of each band, mm. */
const DRY = [0, 0, 0, 0, 0, 0, 0, 0];
const SPOTS = [0.3, 0.3, 0, 0, 0, 0, 0, 0];
const SHOWERS = [3, 3, 3, 0, 0, 0, 0, 0];
const RAINY = [4, 4, 5, 5, 6, 6, 7, 7];
const HEAVY = [12, 12, 14, 14, 16, 16, 18, 18];
const DRENCHED = [30, 30, 30, 30, 30, 30, 30, 30];

/** A whole day known by each model's total; `snowy` puts all of it at or below the snow line. */
const wholeDay = (date: string, totals: (number | null)[], snowy = false): RainDayComputation =>
  computeRainDay({
    date,
    models: totals.map((rain, i) => ({
      id: `m${i}`,
      name: `M${i}`,
      high: 10,
      feelsLike: 10,
      rain,
      snow: snowy ? rain : 0,
    })),
    hourly: [],
  })!;

const days = (totals: (number | null)[][], dates = DATES) =>
  totals.map((t, i) => wholeDay(dates[i]!, t));

const week = (totals: (number | null)[][], normals: MonthlyNormals | null = null, dates = DATES) =>
  computeRainWeek(days(totals, dates), normals);

const api = (totals: (number | null)[][], normals: MonthlyNormals | null = null, dates = DATES) =>
  formatRainWeek(week(totals, normals, dates)!, 'c');

const said = (totals: (number | null)[][]) => {
  const w = api(totals);
  return [w.answer, w.band, w.verdict];
};

/** The same normal rain in every month, mm/day. */
const flat = (mmPerDay: number): MonthlyNormals => Array.from({ length: 12 }, () => mmPerDay);

/** Each model rains 3mm on a different day: no day is wet, but the week has rain. */
const SCATTERED = DATES.map((_, d) => DRY.map((_, i) => (i === d ? 3 : 0)));

describe('computeRainWeek', () => {
  it('needs five days with enough models', () => {
    expect(computeRainWeek([], null)).toBeNull();
    expect(week([RAINY, RAINY, RAINY, RAINY])).toBeNull();
    const thin = days(DATES.map((_, i) => (i < 4 ? RAINY : [1, 1])));
    expect(computeRainWeek(thin, null)).toBeNull();
  });

  it('keeps today for labels when today has too few models', () => {
    const w = computeRainWeek(days([[1, 1], RAINY, RAINY, RAINY, RAINY, RAINY, DRY]), null)!;
    expect(w.today).toBe('2026-10-15');
    expect(w.days).toHaveLength(6);
    const out = formatRainWeek(w, 'c');
    expect(out.from).toBe('2026-10-16');
    expect(out.days[0]!.label).toBe('Fri');
  });

  it('adds up each model’s own week', () => {
    const w = week([RAINY, DRY, DRY, HEAVY, DRY, DRY, DRY])!;
    // Per model: 16, 16, 19, 19, 22, 22, 25, 25.
    expect(w.total).toBe(20.5);
    expect(w.wettest.date).toBe('2026-10-18');
    expect([w.rainDays, w.showerDays]).toEqual([2, 0]);
    // Only models with every day count; under three gives no total.
    const missing = (d: number) => DRY.map((v, i) => ((i + d) % 2 === 0 && i < 6 ? v : null));
    const patchy = week(DATES.map((_, d) => missing(d)))!;
    expect(patchy.days).toHaveLength(7);
    expect(patchy.total).toBeNull();
  });

  it('adds up normals, scaling today by the hours left', () => {
    const today = computeRainDay(
      {
        date: DATES[0]!,
        models: DRY.map((_, i) => ({ id: `m${i}`, name: `M${i}`, high: 10, feelsLike: 10 })),
        hourly: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          time: Date.parse(`${DATES[0]}T00:00:00Z`) + hour * HOUR,
          temps: DRY.map(() => 10),
          rain: DRY,
        })),
      },
      { from: Date.parse(`${DATES[0]}T12:00:00Z`) },
    )!;
    const w = computeRainWeek(
      [
        today,
        ...days(
          DATES.slice(1).map(() => DRY),
          DATES.slice(1),
        ),
      ],
      flat(2),
    )!;
    expect(w.normal).toBe(13);
    expect(week([DRY, DRY, DRY, DRY, DRY], null)!.normal).toBeNull();
  });
});

describe('rain week verdicts', () => {
  it('calls four or more rain days a wet week', () => {
    expect(said([RAINY, RAINY, RAINY, RAINY, DRY, DRY, DRY])).toEqual([
      'Yes.',
      'rain',
      'A wet week.',
    ]);
    expect(said([RAINY, RAINY, HEAVY, RAINY, DRY, DRY, RAINY])).toEqual([
      'Yes.',
      'heavy',
      'A wet week, heaviest on Sat.',
    ]);
    expect(said([HEAVY, RAINY, RAINY, RAINY, DRY, DRY, DRY])).toEqual([
      'Yes.',
      'heavy',
      'A wet week, heaviest today.',
    ]);
    expect(said([RAINY, DRENCHED, RAINY, HEAVY, SHOWERS, DRY, DRY])).toEqual([
      'Yes.',
      'drenched',
      'A wet week, heaviest on Fri.',
    ]);
  });

  it('names up to three rain days', () => {
    expect(said([RAINY, DRY, RAINY, DRY, DRY, DRY, DRY])).toEqual([
      'Partly.',
      'showers',
      'Rain today and on Sat.',
    ]);
    expect(said([DRY, RAINY, RAINY, RAINY, SHOWERS, SHOWERS, SHOWERS])).toEqual([
      'Partly.',
      'showers',
      'Rain on Fri, Sat and Sun.',
    ]);
    expect(said([DRY, RAINY, HEAVY, DRY, DRY, DRY, DRY])[2]).toBe(
      'Rain on Fri and Sat, heavy on Sat.',
    );
    expect(said([RAINY, DRY, DRY, DRY, HEAVY, DRY, DRY])[2]).toBe(
      'Rain today and on Mon, heavy on Mon.',
    );
    expect(said([HEAVY, HEAVY, RAINY, DRY, DRY, DRY, DRY])[2]).toBe(
      'Rain today and on Fri and Sat, heavy today and on Fri.',
    );
    expect(said([DRY, DRY, HEAVY, DRY, DRY, DRY, DRY])[2]).toBe('Heavy rain on Sat.');
    expect(said([DRENCHED, DRY, DRY, DRY, DRY, DRY, DRY])[2]).toBe('Heavy rain today.');
    expect(said([DRY, HEAVY, DRENCHED, DRY, DRY, DRY, DRY])[2]).toBe('Heavy rain on Fri and Sat.');
  });

  it('calls showery weeks unsettled or mostly dry', () => {
    expect(said([SHOWERS, SHOWERS, DRY, SHOWERS, SHOWERS, DRY, DRY])).toEqual([
      'Maybe.',
      'showers',
      'An unsettled week.',
    ]);
    expect(said([DRY, SHOWERS, DRY, DRY, DRY, DRY, DRY])).toEqual([
      'Maybe.',
      'showers',
      'Mostly dry, but rain possible on Fri.',
    ]);
    expect(said([SHOWERS, DRY, DRY, SHOWERS, SPOTS, DRY, SHOWERS])[2]).toBe(
      'Mostly dry, but rain possible today and on Sun and Wed.',
    );
  });

  it('calls the rest mostly dry or dry', () => {
    expect(said([DRY, SPOTS, DRY, DRY, DRY, DRY, DRY])).toEqual([
      'No.',
      'spots',
      'A mostly dry week.',
    ]);
    expect(said([DRY, DRY, DRY, DRY, DRY, DRY, DRY])).toEqual(['No.', 'dry', 'A dry week.']);
  });

  it('labels snowy wet days', () => {
    const w = formatRainWeek(
      computeRainWeek(
        [
          wholeDay(DATES[0]!, RAINY, true),
          wholeDay(DATES[1]!, SHOWERS, true),
          ...days([DRY, DRY, DRY, DRY, DRY], DATES.slice(2)),
        ],
        null,
      )!,
      'c',
    );
    expect(w.days[0]).toMatchObject({ band: 'rain', bandLabel: 'Snow', snow: true });
    expect(w.days[1]).toMatchObject({ band: 'showers', bandLabel: 'Showers', snow: false });
    expect(w.verdict).toBe('Rain today.');
  });
});

describe('rain week detail', () => {
  it('formats the week', () => {
    expect(api([RAINY, DRY, SHOWERS, HEAVY, SPOTS, DRY, RAINY], flat(2))).toEqual({
      from: '2026-10-15',
      to: '2026-10-21',
      band: 'showers',
      answer: 'Partly.',
      verdict: 'Rain today and on Sun and Wed, heavy on Sun.',
      detail: 'About 28mm across the week, most on Sunday (15mm). Wetter than usual for October.',
      total: 28,
      normal: 14,
      rainDays: 3,
      showerDays: 1,
      wettest: { date: '2026-10-18', amount: 15 },
      days: [
        {
          date: '2026-10-15',
          label: 'Today',
          amount: 6,
          band: 'rain',
          bandLabel: 'Rain',
          snow: false,
        },
        { date: '2026-10-16', label: 'Fri', amount: 0, band: 'dry', bandLabel: 'Dry', snow: false },
        {
          date: '2026-10-17',
          label: 'Sat',
          amount: 0,
          band: 'showers',
          bandLabel: 'Showers',
          snow: false,
        },
        {
          date: '2026-10-18',
          label: 'Sun',
          amount: 15,
          band: 'heavy',
          bandLabel: 'Heavy rain',
          snow: false,
        },
        {
          date: '2026-10-19',
          label: 'Mon',
          amount: 0,
          band: 'spots',
          bandLabel: 'Mostly dry',
          snow: false,
        },
        { date: '2026-10-20', label: 'Tue', amount: 0, band: 'dry', bandLabel: 'Dry', snow: false },
        {
          date: '2026-10-21',
          label: 'Wed',
          amount: 6,
          band: 'rain',
          bandLabel: 'Rain',
          snow: false,
        },
      ],
    });
  });

  it('converts to inches', () => {
    const w = formatRainWeek(week([RAINY, DRY, SHOWERS, HEAVY, SPOTS, DRY, RAINY], flat(2))!, 'f');
    expect(w.total).toBe(1.1);
    expect(w.normal).toBe(0.55);
    expect(w.wettest.amount).toBe(0.59);
    expect(w.detail).toBe(
      'About 1.1in across the week, most on Sunday (0.59in). Wetter than usual for October.',
    );
  });

  it('names the wettest day, or today', () => {
    expect(api([RAINY, DRY, DRY, HEAVY, DRY, DRY, DRY]).detail).toBe(
      'About 21mm across the week, most on Sunday (15mm).',
    );
    expect(api([HEAVY, RAINY, DRY, DRY, DRY, DRY, DRY]).detail).toBe(
      'About 21mm across the week, most today (15mm).',
    );
    // A tie goes to the earlier day.
    expect(api([DRY, RAINY, RAINY, DRY, DRY, DRY, DRY]).wettest.date).toBe('2026-10-16');
    // Rain on different days in different models: no day stands out.
    expect(api(SCATTERED).detail).toBe('About 3mm across the week.');
  });

  it('says when there is barely any rain, or no total', () => {
    expect(api([DRY, SPOTS, DRY, DRY, DRY, DRY, DRY]).detail).toBe('Barely any rain all week.');
    const missing = (d: number) => RAINY.map((v, i) => ((i + d) % 2 === 0 && i < 6 ? v : null));
    const patchy = api(
      DATES.map((_, d) => missing(d)),
      flat(2),
    );
    expect(patchy.detail).toBe('Not enough forecasts for a weekly total.');
    expect(patchy.total).toBeNull();
    expect(patchy.normal).toBe(14);
  });

  it('compares with normal rain, never over tiny amounts', () => {
    const detail = (totals: number[][], normals: number, dates = DATES) =>
      api(totals, flat(normals), dates).detail;
    // A dry week in a dry climate.
    expect(detail([DRY, DRY, DRY, DRY, DRY, DRY, DRY], 0.1)).toBe(
      'Barely any rain all week. Dry, as usual for October.',
    );
    // 3mm against 3.5mm: too little to compare, too much for "dry, as usual".
    expect(detail(SCATTERED, 0.5)).toBe('About 3mm across the week.');
    expect(detail(SCATTERED, 4)).toBe('About 3mm across the week. Drier than usual for October.');
    expect(
      detail(
        DATES.map(() => RAINY),
        2,
      ),
    ).toBe('About 39mm across the week, most today (6mm). Wetter than usual for October.');
    expect(
      detail(
        DATES.map(() => RAINY),
        5,
      ),
    ).toBe('About 39mm across the week, most today (6mm). About normal for October.');
    const across = ['10-28', '10-29', '10-30', '10-31', '11-01', '11-02', '11-03'];
    expect(
      detail(
        DATES.map(() => RAINY),
        5,
        across.map((d) => `2026-${d}`),
      ),
    ).toBe('About 39mm across the week, most today (6mm). About normal for the time of year.');
  });

  it('needs both a ratio and a difference to call a week wetter or drier', () => {
    expect(rainNormal(1.9, 1.9)).toBe('dry');
    expect(rainNormal(1, 3)).toBeNull();
    expect(rainNormal(4.9, 4.9)).toBeNull();
    expect(rainNormal(20, 10)).toBe('wetter');
    expect(rainNormal(9, 5.5)).toBe('normal');
    expect(rainNormal(4, 10)).toBe('drier');
    expect(rainNormal(3, 7)).toBe('normal');
    expect(rainNormal(5, 0)).toBe('wetter');
  });
});
