import { describe, expect, it } from 'vitest';
import type { SnowBand } from '../src/config';
import type { DayData } from '../src/compute';
import { judgeSnowSeries, snowSeries } from '../src/snowDay';
import { computeSnowNow, formatSnowNow } from '../src/snowNow';
import type { ApiSnowPoint, SnowUnit } from '../src/types';

const HOUR = 3_600_000;
const T0 = Date.parse('2027-01-15T00:00:00Z');
const at = (hours: number) => T0 + hours * HOUR;

/** A judged series from midnight UTC, one point per hour, with the given bands. */
function points(bands: readonly SnowBand[], each: Partial<ApiSnowPoint> = {}): ApiSnowPoint[] {
  return bands.map((band, h) => ({
    time: at(h),
    date: h < 24 ? '2027-01-15' : '2027-01-16',
    hour: h % 24,
    amount: band === 'nosnow' ? 0 : 1,
    chance: band === 'nosnow' ? 0 : 1,
    chance2h: 0,
    band,
    reason: band === 'nosnow' ? 'dry' : null,
    light: band === 'nosnow',
    ...each,
  }));
}

const repeat = (band: SnowBand, n: number): SnowBand[] => Array.from({ length: n }, () => band);

/** The snow Now view at 10:30, with `current` for 10am and `later` from 11am. */
function nowWith(current: Partial<ApiSnowPoint>, later: SnowBand[] = [], unit: SnowUnit = 'cm') {
  const series = points([...repeat('nosnow', 10), current.band ?? 'nosnow', ...later]);
  series[10] = { ...series[10]!, ...current };
  return formatSnowNow(computeSnowNow(series, at(10.5))!, unit);
}

describe('computeSnowNow', () => {
  it('picks the hour containing the moment, as for rain', () => {
    const series = points(repeat('nosnow', 48));
    const now = computeSnowNow(series, at(10.5))!;
    expect(now.current.time).toBe(at(10));
    expect(now.series[0]!.time).toBe(at(9));
    expect(now.series).toHaveLength(26);
    expect(computeSnowNow([], at(0))).toBeNull();
    expect(computeSnowNow(series, at(48))).toBeNull();
  });
});

describe('formatSnowNow', () => {
  it('formats the hour and the next twelve', () => {
    const series = points(['nosnow', 'nosnow', 'snow', 'snow', 'nosnow', 'nosnow', 'flakes'], {
      chance2h: 0.63,
    });
    series[2] = { ...series[2]!, amount: 0.34, chance: 0.75 };
    const now = formatSnowNow(computeSnowNow(series, at(2.25))!, 'cm');
    expect(now).toEqual({
      time: '2027-01-15T02:15:00.000Z',
      band: 'snow',
      answer: 'Yes.',
      verdict: "It's snowing.",
      detail: 'Snow now, about 0.3cm an hour. Easing off by about 4am.',
      amount: 0.3,
      chance: 0.75,
      hours: [
        { time: '2027-01-15T03:00:00.000Z', label: '3am', chance: 60 },
        { time: '2027-01-15T05:00:00.000Z', label: '5am', chance: 60 },
      ],
      series: series.slice(1),
    });
    expect(now.series[0]).not.toBe(series[1]);
  });

  it('answers for every band, and says why there is no snow', () => {
    const say = (current: Partial<ApiSnowPoint>, unit?: SnowUnit) => {
      const n = nowWith(current, ['nosnow'], unit);
      return [n.answer, n.verdict, n.detail.split('. ')[0]];
    };
    expect(say({ band: 'nosnow', reason: 'dry' })).toEqual(['No.', "It's not snowing.", 'Dry now']);
    expect(say({ band: 'nosnow', reason: 'warm' })).toEqual([
      'No.',
      'Too warm for snow.',
      'Dry now',
    ]);
    expect(say({ band: 'nosnow', reason: 'rain' })).toEqual([
      'No.',
      'Raining, not snowing.',
      'Rain now',
    ]);
    expect(say({ band: 'flakes' })).toEqual([
      'No.',
      'Just a few flakes.',
      'A few flakes possible now',
    ]);
    expect(say({ band: 'maybesnow' })).toEqual([
      'Maybe.',
      'Snow showers around.',
      'Snow possible now',
    ]);
    expect(say({ band: 'snow', amount: 0.1, light: true })).toEqual([
      'Yes.',
      "It's snowing.",
      'Light snow now',
    ]);
    expect(say({ band: 'snow', amount: 0.5, light: false })).toEqual([
      'Yes.',
      "It's snowing.",
      'Snow now, about 0.5cm an hour',
    ]);
    // Heavier snow is never light, and always gives the rate.
    expect(say({ band: 'heavysnow', amount: 1.2, light: true })).toEqual([
      'Yes.',
      'Heavy snow.',
      'Heavy snow now, about 1cm an hour',
    ]);
    expect(say({ band: 'deepsnow', amount: 3 })).toEqual([
      'Yes.',
      'Very heavy snow.',
      'Very heavy snow now, about 3cm an hour',
    ]);
    expect(say({ band: 'heavysnow', amount: 0.47 }, 'in')[2]).toBe(
      'Heavy snow now, about 0.5in an hour',
    );
  });

  describe('trend', () => {
    const trend = (current: SnowBand, later: SnowBand[]) =>
      nowWith({ band: current }, later).detail.split('. ').slice(1).join('. ');

    it('says when snow falling now eases off', () => {
      expect(trend('snow', ['snow', 'heavysnow', 'snow', 'maybesnow', 'flakes'])).toBe(
        'Easing off by about 3pm.',
      );
      expect(trend('heavysnow', [...repeat('snow', 12), 'nosnow'])).toBe(
        'Set to last the next 12 hours.',
      );
      expect(trend('snow', [])).toBe('Set to last the next 12 hours.');
    });

    it('does not say snow twice while it is only possible now', () => {
      expect(trend('maybesnow', ['maybesnow', 'snow'])).toBe('Likely from about 12pm.');
      expect(trend('maybesnow', ['maybesnow', 'nosnow', 'maybesnow'])).toBe(
        'Clearing by about 12pm.',
      );
      expect(trend('maybesnow', repeat('maybesnow', 12))).toBe('On and off for the next 12 hours.');
    });

    it('says when snow is likely or possible later', () => {
      expect(trend('nosnow', ['nosnow', 'nosnow', 'maybesnow', 'snow'])).toBe(
        'Snow likely from about 2pm.',
      );
      expect(trend('nosnow', ['nosnow', 'maybesnow'])).toBe('Snow possible from about 12pm.');
      expect(trend('flakes', ['flakes', 'nosnow'])).toBe('No snow for the next 12 hours.');
      expect(trend('nosnow', [...repeat('nosnow', 12), 'deepsnow'])).toBe(
        'No snow for the next 12 hours.',
      );
    });

    it('names the first row with a fair chance, or an earlier hour where snow is possible', () => {
      const rows = (chance2h: (hour: number) => number, later = repeat('nosnow', 14)) => {
        const series = points([...repeat('nosnow', 11), ...later]).map((p) => ({
          ...p,
          chance2h: chance2h(p.hour),
        }));
        return formatSnowNow(computeSnowNow(series, at(10.5))!, 'cm').detail;
      };
      expect(rows((h) => (h === 17 ? 0.25 : 0.13))).toBe('Dry now. Snow possible from about 5pm.');
      expect(rows((h) => (h === 17 ? 0.24 : 0.13))).toBe('Dry now. No snow for the next 12 hours.');
      const possibleFirst = [...repeat('nosnow', 2), 'maybesnow', ...repeat('nosnow', 11)];
      expect(rows((h) => (h === 17 ? 0.5 : 0), possibleFirst as SnowBand[])).toBe(
        'Dry now. Snow possible from about 1pm.',
      );
      expect(rows((h) => (h === 11 ? 0.5 : 0), possibleFirst as SnowBand[])).toBe(
        'Dry now. Snow possible from about 11am.',
      );
    });
  });
});

describe('snow Now on the server and in the browser', () => {
  /** Two days of snow showers that differ by model. */
  const days: DayData[] = ['2027-01-15', '2027-01-16'].map((date, d) => ({
    date,
    models: [],
    hourly: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      time: at(d * 24 + hour),
      temps: [-4, -2, 0, 1, -1, 3, -2, 1].map((t) => t + (hour > 12 ? 2 : -1)),
      rain: Array.from({ length: 8 }, (_, i) => {
        const v = ((hour * 7 + i * 3 + d * 5) % 13) - 6;
        return v > 0 ? v / 4 : 0;
      }),
    })),
  }));

  it('gives the same answer from the series the server sent', () => {
    for (const units of ['c', 'f'] as const) {
      const unit = units === 'f' ? 'in' : 'cm';
      const series = judgeSnowSeries(snowSeries(days), units, 'Europe/London');
      for (const time of [at(0.2), at(10.5), at(23.9), at(30.75)]) {
        const server = formatSnowNow(computeSnowNow(series, time)!, unit);
        const browser = formatSnowNow(computeSnowNow(server.series, time)!, unit);
        expect(browser).toEqual(server);
        expect(server.hours).toHaveLength(6);
      }
    }
  });
});
