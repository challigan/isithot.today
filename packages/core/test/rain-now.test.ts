import { describe, expect, it } from 'vitest';
import type { RainBand } from '../src/config';
import type { DayData } from '../src/compute';
import {
  computeRainNow,
  formatRainNow,
  judgeRainSeries,
  rainSeries,
  type RainSeriesPoint,
} from '../src/rainNow';
import type { ApiRainPoint, RainUnit } from '../src/types';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-10-15T00:00:00Z');
const at = (hours: number) => T0 + hours * HOUR;

/** A judged series from midnight UTC, one point per hour, with the given bands. */
function points(bands: readonly RainBand[], each: Partial<ApiRainPoint> = {}): ApiRainPoint[] {
  return bands.map((band, h) => ({
    time: at(h),
    date: h < 24 ? '2026-10-15' : '2026-10-16',
    hour: h % 24,
    amount: band === 'dry' ? 0 : 1,
    chance: band === 'dry' ? 0 : 1,
    chance2h: 0,
    band,
    snow: false,
    light: band === 'dry',
    ...each,
  }));
}

const repeat = (band: RainBand, n: number): RainBand[] => Array.from({ length: n }, () => band);

/**
 * The rain Now view at 10:30, with `current` for 10am (light below 0.5mm unless it says) and
 * `later` from 11am.
 */
function nowWith(current: Partial<ApiRainPoint>, later: RainBand[] = [], unit: RainUnit = 'mm') {
  const series = points([...repeat('dry', 10), current.band ?? 'dry', ...later]);
  const amount = current.amount ?? series[10]!.amount;
  series[10] = { ...series[10]!, light: amount < 0.5, ...current };
  return formatRainNow(computeRainNow(series, at(10.5))!, unit);
}

describe('rainSeries', () => {
  it('blends each hour across the models', () => {
    const days: DayData[] = [
      {
        date: '2026-10-15',
        models: [],
        hourly: [
          { hour: 0, time: at(0), temps: [0, 1, 2, null], rain: [0.1, 0.3, null, 0.5] },
          { hour: 1, time: at(1), temps: [], rain: [0.2, null, 0, 0] },
          { hour: 2, time: at(2), temps: [5] },
          { hour: 3, time: at(3), temps: [-5, -5, -5, -5, 20], rain: [0, 0, 0, 0.1, 0.1] },
          { hour: 5, time: at(5), temps: [3], rain: [null, null] },
          { hour: 6, time: at(6), temps: [3], rain: [4, 4, 0] },
        ],
      },
    ];
    const series = rainSeries(days);
    expect(series).toEqual<RainSeriesPoint[]>([
      // The next hour adds to each model's two-hour block (none for the third model).
      { time: at(0), amount: 0.3, chance: 2 / 3, chance2h: 1, band: 'rain', snow: true },
      // The next hour has no rain data: the block is this hour alone.
      { time: at(1), amount: 0, chance: 1 / 3, chance2h: 1 / 3, band: 'showers', snow: false },
      // Five temperatures: the highest and lowest are dropped. The next hour is missing.
      { time: at(3), amount: 0, chance: 0, chance2h: 0, band: 'spots', snow: true },
      // Hour 5 has no rain at all and is left out; 6 is the last hour.
      { time: at(6), amount: 4, chance: 2 / 3, chance2h: 2 / 3, band: 'heavy', snow: false },
    ]);
  });
});

describe('judgeRainSeries', () => {
  const raw: RainSeriesPoint[] = [
    { time: at(0), amount: 0.3, chance: 2 / 3, chance2h: 0.125, band: 'rain', snow: false },
  ];

  it('rounds to display units and labels local hours', () => {
    expect(judgeRainSeries(raw, 'c', 'UTC')).toEqual([
      {
        time: at(0),
        date: '2026-10-15',
        hour: 0,
        amount: 0.3,
        chance: 0.67,
        chance2h: 0.13,
        band: 'rain',
        snow: false,
        light: true,
      },
    ]);
    expect(judgeRainSeries(raw, 'f', 'America/New_York')[0]).toMatchObject({
      date: '2026-10-14',
      hour: 20,
      amount: 0.01,
    });
  });

  it('decides light rain in millimetres, before rounding to either unit', () => {
    const light = (mm: number) =>
      (['c', 'f'] as const).map(
        (units) => judgeRainSeries([{ ...raw[0]!, amount: mm }], units, 'UTC')[0]!.light,
      );
    // 0.49mm is 0.02in, which once read as "Rain now" in inches.
    expect(light(0.49)).toEqual([true, true]);
    expect(light(0.499)).toEqual([true, true]);
    expect(light(0.5)).toEqual([false, false]);
  });
});

describe('computeRainNow', () => {
  const day2 = points(repeat('dry', 48));

  it('picks the hour containing the moment and keeps a day ahead', () => {
    const now = computeRainNow(day2, at(10.5))!;
    expect(now.time).toBe(at(10.5));
    expect(now.current.time).toBe(at(10));
    // From the hour before to 24 hours ahead.
    expect(now.series[0]!.time).toBe(at(9));
    expect(now.series.at(-1)!.time).toBe(at(34));
    expect(now.series).toHaveLength(26);
    expect(computeRainNow(day2, at(0.5))!.series[0]!.time).toBe(at(0));
  });

  it('uses the first hour for a clock a little behind', () => {
    const now = computeRainNow(day2, at(-0.25))!;
    expect(now.current.time).toBe(at(0));
    expect(now.series[0]!.time).toBe(at(0));
    expect(computeRainNow(day2, at(-0.99))!.current.time).toBe(at(0));
    expect(computeRainNow(day2, at(-1))).toBeNull();
  });

  it('is null when the series does not cover the moment', () => {
    expect(computeRainNow([], at(0))).toBeNull();
    expect(computeRainNow(day2, at(48))).toBeNull();
    const gap = day2.filter((p) => p.time !== at(12));
    expect(computeRainNow(gap, at(12.5))).toBeNull();
  });
});

describe('formatRainNow', () => {
  it('formats the hour and the next twelve', () => {
    const series = points(['dry', 'dry', 'rain', 'rain', 'dry', 'dry', 'showers', 'dry'], {
      chance2h: 0.63,
    });
    series[2] = { ...series[2]!, amount: 0.3, chance: 0.75, light: true };
    const now = formatRainNow(computeRainNow(series, at(2.25))!, 'mm');
    expect(now).toEqual({
      time: '2026-10-15T02:15:00.000Z',
      band: 'rain',
      answer: 'Yes.',
      verdict: "It's raining.",
      detail: 'Light rain now. Easing off by about 4am.',
      amount: 0.3,
      chance: 0.75,
      snow: false,
      hours: [
        { time: '2026-10-15T03:00:00.000Z', label: '3am', chance: 60 },
        { time: '2026-10-15T05:00:00.000Z', label: '5am', chance: 60 },
        { time: '2026-10-15T07:00:00.000Z', label: '7am', chance: 60 },
      ],
      series: series.slice(1),
    });
    expect(now.series[0]).not.toBe(series[1]);
  });

  it('answers for every band', () => {
    const say = (current: Partial<ApiRainPoint>, unit?: RainUnit) => {
      const n = nowWith(current, ['dry'], unit);
      return [n.answer, n.verdict, n.detail.split('. ')[0]];
    };
    expect(say({ band: 'dry' })).toEqual(['No.', "It's dry.", 'Dry now']);
    expect(say({ band: 'spots' })).toEqual([
      'No.',
      'Just a few spots.',
      'A few spots possible now',
    ]);
    expect(say({ band: 'showers' })).toEqual(['Maybe.', 'Showers around.', 'Showers possible now']);
    expect(say({ band: 'rain', amount: 0.49 })).toEqual([
      'Yes.',
      "It's raining.",
      'Light rain now',
    ]);
    expect(say({ band: 'rain', amount: 0.5 })).toEqual(['Yes.', "It's raining.", 'Rain now']);
    expect(say({ band: 'heavy', amount: 4 })).toEqual(['Yes.', "It's pouring.", 'Heavy rain now']);
    expect(say({ band: 'drenched', amount: 9 })).toEqual([
      'Yes.',
      "It's torrential.",
      'Torrential rain now',
    ]);
    // Inches: the point says whether it is light, so the words never depend on the units.
    expect(say({ band: 'rain', amount: 0.02, light: true }, 'in')[2]).toBe('Light rain now');
    expect(say({ band: 'rain', amount: 0.02, light: false }, 'in')[2]).toBe('Rain now');
  });

  it('says snow when the hour is at or below the snow line', () => {
    const say = (current: Partial<ApiRainPoint>) => {
      const n = nowWith({ ...current, snow: true }, ['dry']);
      return [n.verdict, n.detail.split('. ')[0], n.snow];
    };
    expect(say({ band: 'rain', amount: 0.3 })).toEqual(["It's snowing.", 'Light snow now', true]);
    expect(say({ band: 'rain', amount: 1 })).toEqual(["It's snowing.", 'Snow now', true]);
    expect(say({ band: 'heavy', amount: 4 })).toEqual(['Heavy snow.', 'Heavy snow now', true]);
    expect(say({ band: 'drenched', amount: 9 })).toEqual(['Heavy snow.', 'Heavy snow now', true]);
    expect(say({ band: 'showers' })).toEqual(['Showers around.', 'Showers possible now', true]);
  });

  describe('trend', () => {
    const trend = (current: RainBand, later: RainBand[]) =>
      nowWith({ band: current }, later).detail.split('. ').slice(1).join('. ');

    it('says when rain falling now eases off', () => {
      expect(trend('rain', ['rain', 'heavy', 'rain', 'showers', 'spots'])).toBe(
        'Easing off by about 3pm.',
      );
      expect(trend('rain', [...repeat('rain', 11), 'dry'])).toBe('Easing off by about 10pm.');
      expect(trend('heavy', [...repeat('rain', 12), 'dry'])).toBe('Set to last the next 12 hours.');
      expect(trend('rain', [])).toBe('Set to last the next 12 hours.');
    });

    it('reads midnight as an end time', () => {
      const series = points([...repeat('dry', 22), 'rain', 'rain', 'dry']);
      expect(formatRainNow(computeRainNow(series, at(22.5))!, 'mm').detail).toBe(
        'Rain now. Easing off by about midnight.',
      );
    });

    it('says when rain is likely to start', () => {
      expect(trend('dry', ['dry', 'dry', 'dry', 'showers', 'spots', 'rain'])).toBe(
        'Rain likely from about 4pm.',
      );
      expect(trend('dry', ['dry', 'dry', 'dry', 'showers'])).toBe(
        'Showers possible from about 2pm.',
      );
      expect(trend('spots', ['spots', 'dry'])).toBe('Dry for the next 12 hours.');
      expect(trend('dry', [...repeat('dry', 12), 'drenched'])).toBe('Dry for the next 12 hours.');
    });

    it('says when showers under way now clear, never that they are possible from later', () => {
      expect(trend('showers', ['showers', 'dry', 'dry', 'showers'])).toBe('Dry from about 12pm.');
      expect(trend('showers', ['spots', 'showers'])).toBe('Dry from about 11am.');
      expect(trend('showers', ['showers', 'dry', 'rain'])).toBe('Rain likely from about 1pm.');
      expect(trend('showers', repeat('showers', 12))).toBe('On and off for the next 12 hours.');
      expect(trend('showers', [])).toBe('On and off for the next 12 hours.');
    });

    it('is dry for the next 12 hours only when no row below shows a fair chance', () => {
      // Two-hour rows from 11am; the 5pm row has a quarter of the models wet (30%).
      const rows = (chance2h: (hour: number) => number, later = repeat('dry', 14)) => {
        const series = points([...repeat('dry', 11), ...later]).map((p) => ({
          ...p,
          chance2h: chance2h(p.hour),
        }));
        return formatRainNow(computeRainNow(series, at(10.5))!, 'mm').detail;
      };
      expect(rows((h) => (h === 17 ? 0.25 : 0.13))).toBe(
        'Dry now. Showers possible from about 5pm.',
      );
      expect(rows((h) => (h === 17 ? 0.24 : 0.13))).toBe('Dry now. Dry for the next 12 hours.');
      // Only the rows count: 4pm is not one.
      expect(rows((h) => (h === 16 ? 1 : 0))).toBe('Dry now. Dry for the next 12 hours.');
      // A showery hour before the first such row is named instead.
      const showersFirst = [...repeat('dry', 2), 'showers', ...repeat('dry', 11)] as RainBand[];
      expect(rows((h) => (h === 17 ? 0.5 : 0), showersFirst)).toBe(
        'Dry now. Showers possible from about 1pm.',
      );
      expect(rows((h) => (h === 13 ? 0.5 : 0), showersFirst)).toBe(
        'Dry now. Showers possible from about 1pm.',
      );
    });
  });

  describe('rows', () => {
    const chances = [0.13, 0.25, 0.38, 0.5, 0.63, 1, 0.88];
    const series = points(repeat('dry', 30)).map((p) => ({
      ...p,
      chance2h: chances[(p.hour - 11) / 2] ?? 0,
    }));
    const rows = (time: number, s = series) =>
      formatRainNow(computeRainNow(s, time)!, 'mm').hours.map((h) => `${h.label} ${h.chance}`);

    it('gives six two-hour blocks from the next full hour, to the nearest 10%', () => {
      expect(rows(at(10.5))).toEqual([
        '11am 10',
        '1pm 30',
        '3pm 40',
        '5pm 50',
        '7pm 60',
        '9pm 100',
      ]);
      expect(rows(at(10))).toEqual(rows(at(10.5)));
      expect(rows(at(-0.5))[0]).toBe('12am 0');
    });

    it('skips missing hours', () => {
      const gap = series.filter((p) => p.time !== at(13));
      expect(rows(at(10.5), gap)).toEqual(['11am 10', '3pm 40', '5pm 50', '7pm 60', '9pm 100']);
      expect(rows(at(29.5))).toEqual([]);
    });
  });
});

describe('rain Now on the server and in the browser', () => {
  /** Two days of showery forecasts that differ by model. */
  const days: DayData[] = ['2026-10-15', '2026-10-16'].map((date, d) => ({
    date,
    models: [],
    hourly: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      time: at(d * 24 + hour),
      temps: [4, 2, 0, 1, -1, 3, 2, 1].map((t) => t + (hour > 12 ? 2 : -1)),
      rain: Array.from({ length: 8 }, (_, i) => {
        const v = ((hour * 7 + i * 3 + d * 5) % 13) - 6;
        return v > 0 ? v / 4 : 0;
      }),
    })),
  }));

  it('gives the same answer from the series the server sent', () => {
    for (const units of ['c', 'f'] as const) {
      const unit = units === 'f' ? 'in' : 'mm';
      const series = judgeRainSeries(rainSeries(days), units, 'Europe/London');
      for (const time of [at(0.2), at(10.5), at(23.9), at(30.75)]) {
        const server = formatRainNow(computeRainNow(series, time)!, unit);
        const browser = formatRainNow(computeRainNow(server.series, time)!, unit);
        expect(browser).toEqual(server);
        expect(server.hours).toHaveLength(6);
      }
    }
  });

  it('keeps working in the browser as time passes, and behind the first point', () => {
    const series = judgeRainSeries(rainSeries(days), 'c', 'UTC');
    const server = formatRainNow(computeRainNow(series, at(10.5))!, 'mm');
    expect(server.series[0]!.time).toBe(at(9));
    const later = formatRainNow(computeRainNow(server.series, at(13) + 12 * 60_000)!, 'mm');
    expect(later.time).toBe('2026-10-15T13:12:00.000Z');
    expect(later.hours[0]!.label).toBe('2pm');
    const behind = formatRainNow(computeRainNow(server.series, at(8.8))!, 'mm');
    expect(behind.band).toBe(server.series[0]!.band);
    expect(behind.hours[0]!.label).toBe('9am');
  });
});
