import { describe, expect, it } from 'vitest';
import { BANDS, UV, UV_LEVELS } from '../src/config';
import { computeDay, formatDay, type DayData } from '../src/compute';
import { UV_LEVEL_LABELS, uvDayLine, uvNowLine, uvSpoken } from '../src/copy';
import type { HourTemps } from '../src/blend';
import { computeNow, formatNow, hourlySeries, judgeSeries } from '../src/now';
import { PREVIEW_BANDS, previewResponse } from '../src/preview';
import { dayUv, formatUvDay, hourUv, uvLevel } from '../src/uv';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-06-20T00:00:00Z');

/** A day's hours with the UV index from `uv(hour)` for each model (null: none for that hour). */
const hours = (uv: (hour: number) => Array<number | null> | undefined): HourTemps[] =>
  Array.from({ length: 24 }, (_, hour) => {
    const h: HourTemps = { hour, time: T0 + hour * HOUR, temps: [20, 21] };
    const values = uv(hour);
    if (values) h.uv = values;
    return h;
  });

/** UV rising to `max` at 1pm, nothing at night. */
const curve = (max: number) => (hour: number) => Math.max(0, max - Math.abs(hour - 13) * 1.5);

describe('UV levels', () => {
  it("follows WHO's steps on the index rounded to a whole number", () => {
    const cases: Array<[number, string]> = [
      [0, 'low'],
      [2.49, 'low'],
      [2.5, 'medium'],
      [5.49, 'medium'],
      [5.5, 'high'],
      [7.49, 'high'],
      [7.5, 'veryhigh'],
      [10.49, 'veryhigh'],
      [10.5, 'extreme'],
      [16, 'extreme'],
    ];
    for (const [value, level] of cases) expect([value, uvLevel(value)]).toEqual([value, level]);
    expect(UV_LEVELS).toEqual(['low', 'medium', 'high', 'veryhigh', 'extreme']);
    expect(UV.from).toEqual({ medium: 3, high: 6, veryhigh: 8, extreme: 11 });
  });

  it('labels them with "Medium" for WHO\'s "Moderate"', () => {
    expect(UV_LEVELS.map((l) => UV_LEVEL_LABELS[l])).toEqual([
      'Low',
      'Medium',
      'High',
      'Very high',
      'Extreme',
    ]);
  });
});

describe('hourUv', () => {
  it('takes the median of the models that give a UV index', () => {
    const at = (uv?: Array<number | null>): HourTemps => ({
      hour: 12,
      time: T0,
      temps: [20],
      ...(uv ? { uv } : {}),
    });
    expect(hourUv(at())).toBeNull();
    expect(hourUv(at([null, null]))).toBeNull();
    expect(hourUv(at([6.2, null, null]))).toBe(6.2);
    expect(hourUv(at([3, null, 5]))).toBe(4);
    expect(hourUv(at([1, 2, 9]))).toBe(2);
  });
});

describe('dayUv', () => {
  it("finds the day's highest hour and when it starts", () => {
    expect(dayUv(hours((h) => [curve(7.2)(h), null]))).toEqual({ max: 7.2, peakHour: 13 });
    // On a tie, the earlier hour.
    expect(dayUv(hours((h) => [h === 11 || h === 14 ? 5 : 1]))).toEqual({ max: 5, peakHour: 11 });
  });

  it('needs every hour from 10am to 6pm, as a high does', () => {
    expect(dayUv(hours((h) => (h === 15 ? [null] : [curve(6)(h)])))).toBeNull();
    expect(dayUv(hours((h) => (h < 10 ? undefined : [curve(6)(h)])))).toEqual({
      max: 6,
      peakHour: 13,
    });
    expect(dayUv(hours(() => undefined))).toBeNull();
    expect(dayUv([])).toBeNull();
  });

  it('rounds for the API, with no peak when there is no UV', () => {
    expect(formatUvDay({ max: 6.6, peakHour: 13 })).toEqual({
      max: 7,
      level: 'high',
      peak: '1pm',
    });
    expect(formatUvDay({ max: 10.5, peakHour: 12 })).toEqual({
      max: 11,
      level: 'extreme',
      peak: '12pm',
    });
    expect(formatUvDay({ max: 0.4, peakHour: 11 })).toEqual({ max: 0, level: 'low', peak: null });
  });
});

describe('UV copy', () => {
  it('words the day, now and screen reader lines', () => {
    expect(uvDayLine(7, 'high', '1pm')).toBe('UV 7 · High, highest around 1pm');
    expect(uvDayLine(1, 'low', null)).toBe('UV 1 · Low');
    expect(uvNowLine(5, 'medium')).toBe('UV 5 · Medium now');
    expect(uvNowLine(9, 'veryhigh')).toBe('UV 9 · Very high now');
    expect(uvSpoken(9, 'veryhigh', '1pm')).toBe('UV index 9, very high, highest around 1pm');
    expect(uvSpoken(5, 'medium')).toBe('UV index 5, medium');
  });
});

describe('UV in the answer', () => {
  const day = (uv?: (hour: number) => Array<number | null>): DayData => ({
    date: '2026-06-20',
    models: [
      { id: 'a', name: 'A', high: 21, feelsLike: 20 },
      { id: 'b', name: 'B', high: 22, feelsLike: 21 },
    ],
    hourly: hours((h) => uv?.(h)),
  });

  it('gives a hot day its UV index when the forecast has one, and leaves it out when not', () => {
    const sunny = computeDay(
      day((h) => [curve(8.4)(h), curve(7.6)(h)]),
      null,
    )!;
    expect(sunny.uv).toEqual({ max: 8, peakHour: 13 });
    expect(formatDay(sunny, 'c').uv).toEqual({ max: 8, level: 'veryhigh', peak: '1pm' });
    const none = computeDay(day(), null)!;
    expect(none).not.toHaveProperty('uv');
    expect(formatDay(none, 'f')).not.toHaveProperty('uv');
  });

  it('carries the UV index per hour, and gives now the hour containing the moment', () => {
    const series = hourlySeries([day((h) => [curve(6)(h), null])]);
    expect(series[13]).toMatchObject({ time: T0 + 13 * HOUR, uv: 6 });
    const judged = judgeSeries(series, null, 'c', 'UTC');
    // Rounded as WHO reports it.
    expect(judged[11]!.uv).toBe(3);
    expect(judged[2]!.uv).toBe(0);
    const now = computeNow(judged, T0 + 11.75 * HOUR)!;
    expect(now.uv).toBe(3);
    expect(formatNow(now).uv).toEqual({ value: 3, level: 'medium' });
    // Without UV data neither has one.
    const plain = computeNow(judgeSeries(hourlySeries([day()]), null, 'c', 'UTC'), T0 + HOUR)!;
    expect(plain.series[0]).not.toHaveProperty('uv');
    expect(plain).not.toHaveProperty('uv');
    expect(formatNow(plain)).not.toHaveProperty('uv');
  });
});

describe('UV in the previews', () => {
  it('gives every hot band a UV index, and shows every level across them', () => {
    const levels = new Set<string>();
    for (const band of BANDS) {
      const res = previewResponse(band);
      expect(res.days[0]!.uv!.max).toBeGreaterThan(0);
      expect(res.now!.uv!.value).toBeGreaterThan(0);
      levels.add(res.days[0]!.uv!.level);
    }
    expect([...levels].sort()).toEqual([...UV_LEVELS].sort());
    expect(PREVIEW_BANDS).toEqual(BANDS);
  });
});
