import { describe, expect, it } from 'vitest';
import type { Band } from '../src/config';
import type { DayData } from '../src/compute';
import { computeNow, formatNow, hourlySeries, judgeSeries, nextRows, trendLine } from '../src/now';
import type { ApiNowPoint } from '../src/types';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-10-15T00:00:00Z');
const RANGE = { coldest: 7, warmest: 19 };
const at = (hours: number) => T0 + hours * HOUR;

/** A judged series from midnight UTC, one point per hour, labelled in `timezone`. */
const series = (
  temps: number[],
  start = T0,
  band: Band = 'mild',
  timezone = 'UTC',
): ApiNowPoint[] =>
  judgeSeries(
    temps.map((t, i) => ({ time: start + i * HOUR, temperature: t, feelsLike: t - 1 })),
    null,
    'c',
    timezone,
  ).map((p) => ({ ...p, band }));

/** A day that peaks at 3pm UTC: 10° at night up to 18°. */
const DAY = Array.from({ length: 24 }, (_, h) => 18 - Math.min(8, Math.abs(h - 15)));

describe('hourlySeries', () => {
  it('blends each hour across models', () => {
    const days: DayData[] = [
      {
        date: '2026-10-15',
        models: [],
        hourly: [
          { hour: 0, time: T0, temps: [10, 11, 12, null], feels: [9, null, 8] },
          { hour: 1, time: T0 + HOUR, temps: [10, 12, 14, 30, -5], feels: [] },
          { hour: 3, time: T0 + 3 * HOUR, temps: [null, null] },
          { hour: 4, time: T0 + 4 * HOUR, temps: [7] },
        ],
      },
    ];
    expect(hourlySeries(days)).toEqual([
      { time: T0, temperature: 11, feelsLike: 8.5 },
      // Five values: the highest and lowest are dropped. No feels-like: use the temperature.
      { time: T0 + HOUR, temperature: 12, feelsLike: 12 },
      { time: T0 + 4 * HOUR, temperature: 7, feelsLike: 7 },
    ]);
  });
});

describe('judgeSeries', () => {
  const raw = [
    { time: T0, temperature: 12.04, feelsLike: 30 },
    { time: T0 + HOUR, temperature: 0, feelsLike: -2 },
  ];

  it('judges each hour like a day and rounds to display units', () => {
    expect(judgeSeries(raw, RANGE, 'c', 'UTC')).toEqual([
      { time: T0, date: '2026-10-15', hour: 0, temperature: 12, feelsLike: 30, band: 'scorching' },
      {
        time: T0 + HOUR,
        date: '2026-10-15',
        hour: 1,
        temperature: 0,
        feelsLike: -2,
        band: 'freezing',
      },
    ]);
    expect(judgeSeries(raw, null, 'f', 'America/New_York')[0]).toEqual({
      time: T0,
      date: '2026-10-14',
      hour: 20,
      temperature: 53.7,
      feelsLike: 86,
      band: 'hot',
    });
  });
});

describe('computeNow', () => {
  it('interpolates between the hours either side', () => {
    const now = computeNow(series(DAY), at(9.5))!;
    expect(now.date).toBe('2026-10-15');
    // The hour before is kept for clients whose clocks run behind.
    expect(now.series[0]!.time).toBe(at(8));
    expect(now.temperature).toBeCloseTo(12.5, 10);
    expect(now.feelsLike).toBeCloseTo(11.5, 10);
  });

  it('takes the band of the nearest hour', () => {
    const mixed = [...series([20], T0, 'warm'), ...series([24], at(1), 'hot')];
    expect(computeNow(mixed, at(0.4))!.band).toBe('warm');
    expect(computeNow(mixed, at(0.6))!.band).toBe('hot');
  });

  it('keeps a day of series ahead', () => {
    const now = computeNow(series([...DAY, ...DAY]), at(2))!;
    expect(now.series.at(-1)!.time).toBe(at(26));
  });

  it('is null outside the series', () => {
    expect(computeNow([], at(1))).toBeNull();
    expect(computeNow(series(DAY), at(-1.5))).toBeNull();
    expect(computeNow(series(DAY), at(24.5))).toBeNull();
  });

  it('accepts a clock up to an hour behind the first point', () => {
    const now = computeNow(series(DAY, at(9)), at(8.75))!;
    expect(now.temperature).toBe(DAY[0]);
    expect(now.series[0]!.time).toBe(at(9));
  });

  it('uses the last hour for up to an hour past the end, or across a gap', () => {
    expect(computeNow(series(DAY), at(23.5))).toMatchObject({ temperature: 10, band: 'mild' });
    const gappy = [...series([10]), ...series([20], at(6))];
    expect(computeNow(gappy, at(0.5))!.temperature).toBe(10);
    expect(computeNow(gappy, at(2))).toBeNull();
  });
});

describe('trendLine', () => {
  const trend = (temps: number[], hours: number, tz = 'UTC') =>
    trendLine(computeNow(series(temps, T0, 'mild', tz), at(hours))!);

  it('rises to the rest of the day’s peak', () => {
    expect(trend(DAY, 9)).toBe('Rising to 18° around 3pm.');
  });

  it('cools after the peak', () => {
    expect(trend([...DAY, ...DAY], 17)).toBe('Cooling to 10° by 11pm.');
  });

  it('rises overnight when tomorrow is warmer', () => {
    const warming = [...Array(22).fill(10), 10, 10, 11, 12, 13];
    expect(trend(warming, 22)).toBe('Rising to 13° by 2am.');
  });

  it('says when little changes', () => {
    expect(trend(Array(30).fill(15), 10)).toBe('Little change for the next few hours.');
    expect(trend([15, 15], 0.5)).toBe('Little change for the next few hours.');
  });

  it('reads times in the place’s own time zone', () => {
    // 3pm UTC is 4pm in London in October.
    expect(trend(DAY, 9, 'Europe/London')).toBe('Rising to 18° around 4pm.');
  });
});

describe('nextRows', () => {
  it('lists the next full hour and every two hours after it', () => {
    const now = computeNow(series([...DAY, ...DAY]), at(9.25))!;
    expect(nextRows(now).map((p) => (p.time - T0) / HOUR)).toEqual([10, 12, 14, 16, 18, 20]);
  });

  it('skips hours the series does not have', () => {
    const now = computeNow(series([10, 11, 12, 13]), at(0.5))!;
    expect(nextRows(now).map((p) => (p.time - T0) / HOUR)).toEqual([1, 3]);
    expect(nextRows(computeNow(series([10, 11]), at(1.5))!)).toEqual([]);
  });
});

describe('formatNow', () => {
  const now = computeNow(series([...DAY, ...DAY]), at(9.5))!;

  it('formats the contract', () => {
    const n = formatNow(now);
    expect(n).toMatchObject({
      time: '2026-10-15T09:30:00.000Z',
      band: 'mild',
      answer: 'No.',
      verdict: "It's mild.",
      temperature: 13,
      feelsLike: 12,
      detail: '13° now, feels like 12°. Rising to 18° around 3pm.',
    });
    expect(n.hours.map((h) => h.label)).toEqual(['10am', '12pm', '2pm', '4pm', '6pm', '8pm']);
    expect(n.hours[0]).toEqual({
      time: '2026-10-15T10:00:00.000Z',
      label: '10am',
      temperature: 13,
    });
    expect(n.series[0]).toEqual({
      time: at(8),
      date: '2026-10-15',
      hour: 8,
      temperature: 11,
      feelsLike: 10,
      band: 'mild',
    });
    expect(n.series).toHaveLength(26);
  });

  it('labels hours across the end of British Summer Time', () => {
    // Clocks go back at 01:00 UTC on 25 October 2026: 00:30 UTC is 1:30am BST.
    const start = Date.parse('2026-10-25T00:00:00Z');
    const n = formatNow(
      computeNow(series([8, 8, 8, 8, 8], start, 'mild', 'Europe/London'), start + HOUR / 2)!,
    );
    expect(n.hours.map((h) => h.label)).toEqual(['1am', '3am']);
  });
});
