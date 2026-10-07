import { describe, expect, it } from 'vitest';
import { computeDay, type DayComputation } from '../src/compute';
import {
  computeWeek,
  dayLabel,
  formatWeek,
  hottestLine,
  listDays,
  weekVerdict,
  type WeekComputation,
} from '../src/week';

const NORMALS = [7, 7.5, 9.5, 12, 15, 18, 19, 19, 17, 13.5, 10, 7.5];

/** One day where `models` models agree on `high`, with feels-like `feels`. */
const dayAt = (date: string, high: number, feels = high, models = 3): DayComputation =>
  computeDay(
    {
      date,
      models: Array.from({ length: models }, (_, i) => ({
        id: `m${i}`,
        name: `M${i}`,
        high,
        feelsLike: feels,
      })),
      hourly: [],
    },
    NORMALS,
  )!;

// Thursday 15 October 2026 to Wednesday 21 October.
const DATES = ['15', '16', '17', '18', '19', '20', '21'].map((d) => `2026-10-${d}`);
const weekOf = (highs: number[], normals: typeof NORMALS | null = NORMALS) =>
  computeWeek(
    DATES.slice(0, highs.length).map((d, i) => dayAt(d, highs[i]!, highs[i]! + 1)),
    normals,
  );

describe('computeWeek', () => {
  it('needs five days with enough models', () => {
    expect(computeWeek([], NORMALS)).toBeNull();
    expect(weekOf([20, 20, 20, 20])).toBeNull();
    const thin = DATES.map((d, i) => dayAt(d, 20, 20, i < 4 ? 3 : 2));
    expect(computeWeek(thin, NORMALS)).toBeNull();
  });

  it('leaves out days with too few models', () => {
    const days = DATES.map((d, i) => dayAt(d, 20, 20, i === 6 ? 2 : 3));
    expect(computeWeek(days, NORMALS)!.days).toHaveLength(6);
  });

  it('averages highs, feels-like highs and normals across the days', () => {
    const week = weekOf([14, 16, 18, 20, 18, 16, 10])!;
    expect(week.days).toHaveLength(7);
    expect(week.high).toBeCloseTo(16, 10);
    expect(week.feelsLike).toBeCloseTo(17, 10);
    // Normals for 15–21 October interpolate from 13.5 towards 10.
    expect(week.normalHigh).toBeGreaterThan(12.5);
    expect(week.normalHigh).toBeLessThan(13.5);
    expect(week.hottest.date).toBe('2026-10-18');
    expect(week.verdict.climateAdjusted).toBe(true);
    // Feels-like 17° against a 7–19° local range: E ≈ 17.8, just into warm.
    expect(week.verdict.band).toBe('warm');
  });

  it('keeps the earlier day on a tie for hottest', () => {
    expect(weekOf([20, 22, 22, 18, 18])!.hottest.date).toBe(DATES[1]);
  });

  it('works without normals', () => {
    const week = weekOf([30, 30, 30, 30, 30], null)!;
    expect(week.normalHigh).toBeNull();
    expect(week.verdict.climateAdjusted).toBe(false);
    expect(week.verdict.band).toBe('hot');
  });

  it('drops the normal when any day lacks one', () => {
    const days = DATES.slice(0, 5).map((d) => dayAt(d, 20));
    days[1] = { ...days[1]!, normalHigh: null };
    expect(computeWeek(days, NORMALS)!.normalHigh).toBeNull();
  });
});

describe('week labels', () => {
  it('names days', () => {
    expect(dayLabel('2026-10-15', '2026-10-15')).toBe('Today');
    expect(dayLabel('2026-10-16', '2026-10-15')).toBe('Fri');
    expect(dayLabel('2026-10-18', '2026-10-15')).toBe('Sun');
  });

  it('lists days', () => {
    expect(listDays(['2026-10-16'], '2026-10-15')).toBe('Fri');
    expect(listDays(['2026-10-16', '2026-10-17'], '2026-10-15')).toBe('Fri and Sat');
    expect(listDays(['2026-10-16', '2026-10-17', '2026-10-19'], '2026-10-15')).toBe(
      'Fri, Sat and Mon',
    );
  });

  it('describes the hottest day', () => {
    expect(hottestLine('2026-10-15', '2026-10-15', 28)).toBe('Hottest today, 28°.');
    expect(hottestLine('2026-10-17', '2026-10-15', 28)).toBe('Hottest on Saturday, 28°.');
  });
});

describe('weekVerdict', () => {
  /** A week of mild days (10°) with hot ones (feels-like 28°) on the given indexes. */
  const spell = (hotDays: number[]): WeekComputation =>
    computeWeek(
      DATES.map((d, i) => (hotDays.includes(i) ? dayAt(d, 27, 28) : dayAt(d, 10, 10))),
      NORMALS,
    )!;

  it('says the band when no day is hot', () => {
    expect(weekVerdict(spell([]))).toBe('A mild week.');
  });

  it('names the hot days a cooler average hides', () => {
    expect(weekVerdict(spell([2, 3]))).toBe('A mild week, but hot on Sat and Sun.');
    expect(weekVerdict(spell([0]))).toBe('A mild week, but hot today.');
    expect(weekVerdict(spell([0, 5]))).toBe('A mild week, but hot today and on Tue.');
  });

  it('needs no exception when the week itself is hot', () => {
    expect(weekVerdict(spell([0, 1, 2, 3, 4, 5, 6]))).toBe('A hot week.');
  });
});

describe('formatWeek', () => {
  const week = weekOf([14, 16, 18, 20, 18, 16, 10])!;

  it('formats the contract in °C', () => {
    const w = formatWeek(week, 'c');
    expect(w).toMatchObject({
      from: '2026-10-15',
      to: '2026-10-21',
      band: 'warm',
      answer: 'Almost.',
      verdict: 'A warm week, not hot.',
      high: 16,
      highs: { min: 10, max: 20 },
      feelsLike: 17,
      normalHigh: 13,
      anomaly: 3,
      hottest: { date: '2026-10-18', high: 20 },
      detail:
        'Highs of 10–20°, averaging 16°. Hottest on Sunday, 20°. 3° warmer than usual for October.',
    });
    expect(w.days.map((d) => d.label)).toEqual(['Today', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']);
    expect(w.days[3]).toEqual({
      date: '2026-10-18',
      label: 'Sun',
      high: 20,
      band: week.days[3]!.verdict.band,
      bandLabel: 'Warm',
    });
  });

  it('formats in °F', () => {
    const w = formatWeek(week, 'f');
    expect(w.high).toBe(61);
    expect(w.highs).toEqual({ min: 50, max: 68 });
    expect(w.hottest.high).toBe(68);
    expect(w.days[0]!.high).toBe(57);
    expect(w.anomaly).toBe(5);
  });

  it('says about normal, and the time of year for a week across two months', () => {
    const late = ['27', '28', '29', '30', '31'].map((d) => `2026-10-${d}`);
    const near = computeWeek(
      [...late.map((d) => dayAt(d, 11.8)), dayAt('2026-11-01', 11.8)],
      NORMALS,
    )!;
    expect(formatWeek(near, 'c').detail).toBe(
      'Highs around 12°. Hottest today, 12°. About normal for the time of year.',
    );
  });

  it('leaves out the comparison without normals', () => {
    const w = formatWeek(weekOf([25, 25, 25, 25, 25], null)!, 'c');
    expect(w.normalHigh).toBeNull();
    expect(w.anomaly).toBeNull();
    expect(w.detail).toBe('Highs around 25°. Hottest today, 25°.');
  });
});
