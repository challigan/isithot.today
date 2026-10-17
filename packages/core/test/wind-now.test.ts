import { describe, expect, it } from 'vitest';
import type { WindBand } from '../src/config';
import { computeWindNow, formatWindNow, windTrendLine } from '../src/windNow';
import type { ApiWindPoint } from '../src/types';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-10-15T00:00:00Z');
const at = (hours: number) => T0 + hours * HOUR;

/** A typical mean wind and gust for each band, in mph. */
const TYPICAL: Record<WindBand, { mean: number; gust: number }> = {
  calm: { mean: 6, gust: 14 },
  breezy: { mean: 10, gust: 25 },
  windy: { mean: 16, gust: 35 },
  verywindy: { mean: 22, gust: 45 },
  gale: { mean: 35, gust: 58 },
  storm: { mean: 50, gust: 80 },
};

/** A judged series from midnight UTC, one point per hour, with the given bands. */
function points(bands: readonly WindBand[]): ApiWindPoint[] {
  return bands.map((band, h) => ({
    time: at(h),
    date: h < 24 ? '2026-10-15' : '2026-10-16',
    hour: h % 24,
    ...TYPICAL[band],
    gust2h: TYPICAL[band].gust,
    band,
    still: false,
  }));
}

const repeat = (band: WindBand, n: number): WindBand[] => Array.from({ length: n }, () => band);

/** The wind Now view at 10:30, with `current` for 10am and `later` from 11am. */
function nowWith(current: WindBand, later: WindBand[] = [], each: Partial<ApiWindPoint> = {}) {
  const series = points([...repeat('calm', 10), current, ...later]);
  series[10] = { ...series[10]!, ...each };
  return computeWindNow(series, at(10.5))!;
}

const trend = (current: WindBand, later: WindBand[]) => windTrendLine(nowWith(current, later));

describe('computeWindNow', () => {
  it('picks the hour containing the moment, as for rain', () => {
    const series = points(repeat('calm', 48));
    const now = computeWindNow(series, at(10.5))!;
    expect(now.current.time).toBe(at(10));
    expect(now.series[0]!.time).toBe(at(9));
    expect(now.series).toHaveLength(26);
    expect(computeWindNow([], at(0))).toBeNull();
    expect(computeWindNow(series, at(48))).toBeNull();
  });
});

describe('formatWindNow', () => {
  it('formats the hour and the next twelve, with gusts in the rows', () => {
    const series = points(['calm', 'breezy', 'breezy', 'windy', ...repeat('windy', 12)]);
    series[3] = { ...series[3]!, gust2h: 38 };
    const now = formatWindNow(computeWindNow(series, at(1.25))!, 'mph');
    expect(now).toEqual({
      time: '2026-10-15T01:15:00.000Z',
      band: 'breezy',
      answer: 'A bit.',
      verdict: 'Breezy, not windy.',
      detail: 'Wind 10mph, gusts 25mph right now. Windy from about 3am.',
      mean: 10,
      gust: 25,
      still: false,
      hours: [
        { time: '2026-10-15T02:00:00.000Z', label: '2am', gust: 25 },
        { time: '2026-10-15T04:00:00.000Z', label: '4am', gust: 35 },
        { time: '2026-10-15T06:00:00.000Z', label: '6am', gust: 35 },
        { time: '2026-10-15T08:00:00.000Z', label: '8am', gust: 35 },
        { time: '2026-10-15T10:00:00.000Z', label: '10am', gust: 35 },
        { time: '2026-10-15T12:00:00.000Z', label: '12pm', gust: 35 },
      ],
      series: series.slice(0, 16),
    });
    // The rows show the stronger gust of the two hours.
    const at3 = formatWindNow(computeWindNow(series, at(2.5))!, 'mph');
    expect(at3.hours[0]).toMatchObject({ label: '3am', gust: 38 });
  });

  it('says still air is calm, and anything else in the calm band is not windy', () => {
    const still = formatWindNow(nowWith('calm', [], { mean: 3, gust: 9, still: true }), 'kmh');
    expect([still.answer, still.verdict, still.detail]).toEqual([
      'No.',
      "It's calm.",
      'Wind 3km/h, gusts 9km/h right now. Light winds for the next 12 hours.',
    ]);
    expect(still.still).toBe(true);
    const light = formatWindNow(nowWith('calm'), 'mph');
    expect([light.verdict, light.still]).toEqual(["It's not windy.", false]);
  });

  it('answers every band', () => {
    const say = (band: WindBand) => {
      const now = formatWindNow(nowWith(band, repeat(band, 14)), 'mph');
      return `${now.answer} ${now.verdict}`;
    };
    expect(say('windy')).toBe("Yes. It's windy.");
    expect(say('verywindy')).toBe("Yes. It's very windy.");
    expect(say('gale')).toBe('Yes. Gales.');
    expect(say('storm')).toBe('Yes. Storm-force winds.');
  });
});

describe('windTrendLine', () => {
  it('says when wind that is windy or more eases, or that it will last', () => {
    expect(trend('windy', ['windy', 'verywindy', 'gale', 'breezy'])).toBe(
      'Easing off by about 2pm.',
    );
    expect(trend('gale', ['verywindy', 'windy', 'calm'])).toBe('Easing off by about 1pm.');
    expect(trend('storm', repeat('gale', 14))).toBe('Set to last the next 12 hours.');
    // Twelve hours ahead is as far as it looks.
    expect(trend('windy', [...repeat('windy', 12), 'calm'])).toBe('Set to last the next 12 hours.');
    expect(trend('windy', [...repeat('windy', 11), 'calm'])).toBe('Easing off by about 10pm.');
  });

  it('says when it turns windy, by that hour’s band', () => {
    expect(trend('calm', ['calm', 'breezy', 'windy'])).toBe('Windy from about 1pm.');
    expect(trend('breezy', ['verywindy', 'gale'])).toBe('Very windy from about 11am.');
    expect(trend('calm', ['calm', 'gale'])).toBe('Gales from about 12pm.');
    expect(trend('breezy', ['breezy', 'calm', 'storm'])).toBe('Storm-force winds from about 1pm.');
  });

  it('otherwise says when the wind picks up or drops', () => {
    expect(trend('breezy', ['breezy', 'calm', 'breezy'])).toBe('Lighter from about 12pm.');
    expect(trend('breezy', repeat('breezy', 14))).toBe('Breezy for the next 12 hours.');
    expect(trend('calm', ['calm', 'calm', 'breezy'])).toBe('Breezier from about 1pm.');
    expect(trend('calm', repeat('calm', 14))).toBe('Light winds for the next 12 hours.');
    expect(trend('calm', [...repeat('calm', 12), 'gale'])).toBe(
      'Light winds for the next 12 hours.',
    );
  });
});
