import { describe, expect, it } from 'vitest';
import { RAIN } from '../src/config';
import type { DayData } from '../src/compute';
import {
  computeRainDay,
  formatRainDay,
  median,
  niceCeil,
  rainBand,
  rainText,
  rainUnit,
  roundRain,
  toRainUnits,
  windowThresholds,
} from '../src/rain';

const HOUR = 3_600_000;
const DATE = '2026-10-15';
const T0 = Date.parse(`${DATE}T00:00:00Z`);
const at = (hours: number) => T0 + hours * HOUR;

type PerModel = (hour: number, model: number) => number | null;

/**
 * A day in UTC with hourly rain per model from `rain`, and each model's daily total and snow
 * worked out as the providers do (null unless every hour has a value).
 */
function day(rain: PerModel, models = 8, temp: PerModel = () => 10): DayData {
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    time: at(hour),
    temps: Array.from({ length: models }, (_, i) => temp(hour, i)),
    rain: Array.from({ length: models }, (_, i) => rain(hour, i)),
  }));
  return {
    date: DATE,
    models: Array.from({ length: models }, (_, i) => {
      const values = hourly.map((h) => h.rain[i]!);
      const complete = values.every((v) => v !== null);
      const sum = (snowOnly: boolean) =>
        hourly.reduce((a, h) => {
          const t = h.temps[i];
          return a + (!snowOnly || (t !== null && t! <= 1) ? h.rain[i]! : 0);
        }, 0);
      return {
        id: `m${i}`,
        name: `M${i}`,
        high: 12,
        feelsLike: 12,
        rain: complete ? sum(false) : null,
        snow: complete ? sum(true) : null,
      };
    }),
    hourly,
  };
}

/** A whole day known only by each model's total (later days have no hours). */
function totals(values: (number | null | undefined)[], snow?: (number | null)[]): DayData {
  return {
    date: DATE,
    models: values.map((rain, i) => ({
      id: `m${i}`,
      name: `M${i}`,
      high: 12,
      feelsLike: 12,
      rain,
      ...(snow ? { snow: snow[i] } : {}),
    })),
    hourly: [],
  };
}

/** Rain in the given hours (all models unless `who` says otherwise), `mm` an hour. */
const during =
  (hours: number[], mm: number, who: (model: number) => boolean = () => true): PerModel =>
  (h, i) =>
    hours.includes(h) && who(i) ? mm : 0;

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

describe('rain units', () => {
  it('follows the temperature units', () => {
    expect(rainUnit('c')).toBe('mm');
    expect(rainUnit('f')).toBe('in');
    expect(toRainUnits(25.4, 'in')).toBe(1);
    expect(toRainUnits(5, 'mm')).toBe(5);
  });

  it('rounds for display, never to -0', () => {
    expect(roundRain(0.44, 'mm')).toBe(0.4);
    expect(roundRain(0.96, 'mm')).toBe(1);
    expect(roundRain(6.4, 'mm')).toBe(6);
    expect(roundRain(12.5, 'mm')).toBe(13);
    expect(Object.is(roundRain(-0.01, 'mm'), 0)).toBe(true);
    expect(roundRain(0.123, 'in')).toBe(0.12);
    expect(roundRain(1.26, 'in')).toBe(1.3);
    expect(Object.is(roundRain(-0.001, 'in'), 0)).toBe(true);
  });

  it('writes amounts', () => {
    expect(rainText(6, 'mm')).toBe('6mm');
    expect(rainText(0.4, 'mm')).toBe('0.4mm');
    expect(rainText(0.444, 'mm')).toBe('0.4mm');
    expect(rainText(0.12, 'in')).toBe('0.12in');
    expect(rainText(1.2, 'in')).toBe('1.2in');
    expect(rainText(0, 'mm')).toBe('0mm');
  });

  it('rounds scales up to 1, 2, 2.5 or 5 × 10^k', () => {
    expect(niceCeil(5)).toBe(5);
    expect(niceCeil(5.75)).toBe(10);
    expect(niceCeil(13.8)).toBe(20);
    expect(niceCeil(2.2)).toBe(2.5);
    expect(niceCeil(0.2)).toBe(0.2);
    expect(niceCeil(0.23)).toBe(0.25);
    expect(niceCeil(0.3)).toBe(0.5);
    expect(niceCeil(0.06)).toBe(0.1);
    expect(niceCeil(1000)).toBe(1000);
    expect(niceCeil(41.4)).toBe(50);
  });
});

describe('windowThresholds', () => {
  it('scales the hourly values by the hours, capped at the day values', () => {
    expect(windowThresholds(1)).toEqual(RAIN.hour);
    expect(windowThresholds(24)).toEqual(RAIN.day);
    const four = windowThresholds(4);
    expect(four.wet).toBeCloseTo(0.8, 10);
    expect(four.spots).toBe(0.2);
    expect(four.heavy).toBe(10);
    expect(four.drenched).toBe(25);
    // 22:10 to midnight: 50 minutes and an hour.
    const evening = windowThresholds(50 / 60 + 1);
    expect(evening.wet).toBeCloseTo(0.3667, 4);
    expect(evening.spots).toBeCloseTo(0.1833, 4);
    expect(evening.heavy).toBeCloseTo(5.5, 10);
    expect(evening.drenched).toBeCloseTo(14.6667, 4);
  });
});

describe('median', () => {
  it('takes the middle value, or the mean of the middle two', () => {
    expect(median([5])).toBe(5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([0, 0, 0, 1, 2, 2, 2, 2])).toBe(1.5);
  });
});

describe('rainBand', () => {
  const day = RAIN.day;
  it('needs 60% of models for rain, banded by the median', () => {
    expect(rainBand([0, 0, 0, 2, 2, 2, 2, 2], day)).toBe('rain');
    expect(rainBand([0, 0, 0, 0, 2, 2, 2, 2], day)).toBe('showers');
    expect(rainBand([0, 0, 3, 3, 3], day)).toBe('rain');
    expect(rainBand([10, 10, 10, 10], day)).toBe('heavy');
    expect(rainBand([9.9, 9.9, 9.9, 10, 30], day)).toBe('rain');
    expect(rainBand([25, 25, 25], day)).toBe('drenched');
    expect(rainBand([0, 0, 0, 30, 30, 30, 30, 30], day)).toBe('drenched');
  });

  it('calls a quarter of the models showers', () => {
    expect(rainBand([0, 0, 0, 0, 0, 0, 1, 1], day)).toBe('showers');
    expect(rainBand([0, 0, 0, 0, 0, 0, 0, 1], day)).toBe('dry');
  });

  it('tells spots from dry', () => {
    expect(rainBand([0, 0, 0, 0, 0, 0, 0.2, 0.2], day)).toBe('spots');
    expect(rainBand([0, 0, 0, 0, 0, 0, 0.5, 0.19], day)).toBe('dry');
    expect(rainBand([0, 0, 0, 0, 0, 0, 0.19, 0.19], day)).toBe('dry');
    // Sums of hourly amounts reach a threshold despite floating point.
    expect(rainBand([0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1], day)).toBe('rain');
  });
});

describe('computeRainDay: whole days', () => {
  it('judges each model’s total', () => {
    const c = computeRainDay(totals([0, 0, 0.5, 1, 2, 3, 4, 6]))!;
    expect(c).toMatchObject({
      date: DATE,
      from: T0,
      partial: false,
      hours: 24,
      thresholds: RAIN.day,
      wet: 5,
      chance: 0.625,
      amount: 1.5,
      band: 'rain',
      snowShare: 0,
      snow: 'none',
      hourly: [],
      likely: null,
    });
    expect(c.models[3]).toEqual({ id: 'm3', name: 'M3', total: 1, snow: 0 });
  });

  it('leaves out models without a total, and needs one', () => {
    expect(computeRainDay(totals([1, null, undefined, 2]))!.models.map((m) => m.id)).toEqual([
      'm0',
      'm3',
    ]);
    expect(computeRainDay(totals([null, undefined]))).toBeNull();
    expect(computeRainDay(totals([]))).toBeNull();
  });

  it('starts at local midnight', () => {
    const d = day(() => 0);
    d.hourly = d.hourly.map((h) => ({ ...h, time: h.time - HOUR }));
    expect(computeRainDay(d)!.from).toBe(T0 - HOUR);
  });

  it('works out how much falls as snow', () => {
    const share = (snow: number[]) => computeRainDay(totals([4, 4, 4, 4], snow))!;
    expect(share([2, 2, 2, 2])).toMatchObject({ snowShare: 0.5, snow: 'most' });
    expect(share([1, 1, 0, 1.4])).toMatchObject({ snow: 'some' });
    expect(share([1, 1, 0, 1.1])).toMatchObject({ snow: 'none' });
    expect(computeRainDay(totals([0, 0], [0, 0]))).toMatchObject({ snowShare: 0, snow: 'none' });
    // Days recorded without a snow part.
    expect(computeRainDay(totals([3, 3]))!.snowShare).toBe(0);
  });

  it('finds the likely hours from the hourly data', () => {
    const c = computeRainDay(day(during([14, 15, 16, 17], 1, (i) => i < 5)))!;
    expect(c.hourly).toHaveLength(24);
    expect(c.hourly[14]).toEqual({ hour: 14, chance: 0.625 });
    expect(c.likely).toEqual({ from: 14, to: 18 });
    // Under half the models in every hour: no likely hours.
    expect(computeRainDay(day(during([14], 1, (i) => i < 3)))!.likely).toBeNull();
  });

  it('skips hours without rain data', () => {
    const d = day(during([14], 1));
    d.hourly[3] = { ...d.hourly[3]!, rain: [null, null, null, null, null, null, null, null] };
    delete (d.hourly[4] as { rain?: unknown }).rain;
    expect(computeRainDay(d)!.hourly.map((h) => h.hour)).not.toContain(3);
    expect(computeRainDay(d)!.hourly).toHaveLength(22);
  });
});

describe('computeRainDay: the rest of today', () => {
  it('weights the current hour by the minutes left', () => {
    const c = computeRainDay(
      day(() => 0.3),
      { from: at(14.5) },
    )!;
    expect(c.partial).toBe(true);
    expect(c.from).toBe(at(14.5));
    expect(c.hours).toBe(9.5);
    expect(c.thresholds).toEqual(windowThresholds(9.5));
    expect(c.models[0]!.total).toBeCloseTo(0.3 * 9.5, 10);
    expect(c.hourly.map((h) => h.hour)).toEqual(range(14, 24));
    // Seconds do not count: 14:30:30 is still 30 minutes left.
    expect(
      computeRainDay(
        day(() => 0.3),
        { from: at(14.5) + 30_000 },
      )!.hours,
    ).toBe(9.5);
    // On the hour, the hour is whole.
    expect(
      computeRainDay(
        day(() => 0.3),
        { from: at(14) },
      )!.hours,
    ).toBe(10);
  });

  it('counts a model only with every hour of the window', () => {
    const gapLater = day((h, i) => (i === 0 && h === 20 ? null : 0.3));
    expect(computeRainDay(gapLater, { from: at(14.5) })!.models).toHaveLength(7);
    const gapEarlier = day((h, i) => (i === 0 && h === 10 ? null : 0.3));
    expect(computeRainDay(gapEarlier, { from: at(14.5) })!.models).toHaveLength(8);
  });

  it('needs hours with rain data', () => {
    expect(
      computeRainDay(
        day(() => 0.3),
        { from: at(24) },
      ),
    ).toBeNull();
    const old = day(() => 0);
    old.hourly = old.hourly.map(({ hour, time, temps }) => ({ hour, time, temps }));
    expect(computeRainDay(old, { from: at(14.5) })).toBeNull();
    expect(
      computeRainDay(
        day(() => null),
        { from: at(14.5) },
      ),
    ).toBeNull();
  });

  it('uses each model’s own temperature for snow', () => {
    const cold = (_h: number, i: number) => (i < 4 ? -1 : null);
    expect(
      computeRainDay(
        day(() => 0.3, 8, cold),
        { from: at(14.5) },
      ),
    ).toMatchObject({
      snowShare: 0.5,
      snow: 'most',
    });
  });

  it('says Yes late in the evening while light rain is still falling', () => {
    // 22:10, every model with 0.4 mm an hour until midnight: Now says "It's raining".
    const c = computeRainDay(day(during([22, 23], 0.4)), { from: at(22 + 10 / 60) })!;
    expect(c.band).toBe('rain');
    const api = formatRainDay(c, 'c');
    expect([api.answer, api.verdict, api.detail]).toEqual([
      'Yes.',
      "It'll rain.",
      'About 0.7mm still to come. For the rest of the day.',
    ]);
  });
});

describe('formatRainDay', () => {
  const detail = (d: DayData, from?: number) => {
    const api = formatRainDay(computeRainDay(d, from === undefined ? {} : { from })!, 'c');
    return `${api.answer} ${api.verdict} ${api.detail}`;
  };

  it('formats a whole day', () => {
    expect(formatRainDay(computeRainDay(totals([0, 0, 0.5, 1, 2, 3, 4, 6]))!, 'c')).toEqual({
      date: DATE,
      from: '2026-10-15T00:00:00.000Z',
      partial: false,
      band: 'rain',
      answer: 'Yes.',
      verdict: "It'll rain.",
      detail: 'About 2mm of rain. On and off.',
      amount: 2,
      chance: 0.63,
      wet: 5,
      total: 8,
      confidence: 'good',
      threshold: 1,
      snow: 'none',
      likely: null,
      scale: { min: 0, max: 10 },
      models: [0, 0, 0.5, 1, 2, 3, 4, 6].map((v, i) => ({
        id: `m${i}`,
        name: `M${i}`,
        amount: v,
        value: v,
        expectsRain: v >= 1,
        agrees: v >= 1,
      })),
      month: 'October',
      agreementText: '5 of 8 forecasts expect rain',
      limitedText: null,
      stripSummary: 'Forecasts range from 0mm to 6mm; 5 of 8 expect rain.',
    });
  });

  it('converts to inches', () => {
    const api = formatRainDay(computeRainDay(totals([0, 0, 0.5, 1, 2, 3, 4, 30]))!, 'f');
    expect(api.models.map((m) => m.amount)).toEqual([0, 0, 0.02, 0.04, 0.08, 0.12, 0.16, 1.2]);
    expect(api.models[7]!.value).toBe(1.18);
    expect(api.amount).toBe(0.06);
    expect(api.threshold).toBe(0.04);
    expect(api.scale).toEqual({ min: 0, max: 2 });
    expect(api.detail).toBe('About 0.06in of rain. On and off.');
    expect(api.stripSummary).toBe('Forecasts range from 0in to 1.2in; 5 of 8 expect rain.');
  });

  it('keeps a floor under the scale and gives the window’s threshold', () => {
    const dry = formatRainDay(computeRainDay(totals([0, 0, 0]))!, 'c');
    expect(dry.scale).toEqual({ min: 0, max: 5 });
    expect(dry.stripSummary).toBe('All forecasts say 0mm; none expect rain.');
    expect(formatRainDay(computeRainDay(totals([0, 0, 0]))!, 'f').scale.max).toBe(0.2);
    const evening = formatRainDay(
      computeRainDay(
        day(() => 0),
        { from: at(22.5) },
      )!,
      'f',
    );
    expect(evening.threshold).toBe(0.01);
    expect(evening.from).toBe('2026-10-15T22:30:00.000Z');
  });

  it('marks the models that agree with the answer', () => {
    const agrees = (values: number[]) =>
      formatRainDay(computeRainDay(totals(values))!, 'c').models.map((m) => m.agrees);
    // No: dry models agree.
    expect(agrees([0, 0, 0, 0, 0, 0, 0, 2])).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    // Maybe: everyone does.
    expect(agrees([0, 0, 2, 2])).toEqual([true, true, true, true]);
  });

  it('flags limited data and counts one model singly', () => {
    const api = formatRainDay(computeRainDay(totals([0, 3]))!, 'c');
    expect(api.confidence).toBe('limited');
    expect(api.limitedText).toBe('Limited forecast data');
    expect(api.agreementText).toBe('1 of 2 forecasts expects rain');
    expect(api.stripSummary).toBe('Forecasts range from 0mm to 3mm; 1 of 2 expects rain.');
    expect(api.detail).toBe('One forecast says up to 3mm. On and off.');
  });

  it('describes dry days', () => {
    expect(
      detail(
        day(() => 0),
        at(14.5),
      ),
    ).toBe("No. It'll be dry. Dry for the rest of the day.");
    expect(detail(totals([0, 0, 0, 0.19]))).toBe("No. It'll be dry. Dry in every forecast.");
    expect(detail(totals([0, 0, 0, 0, 0, 0, 0, 0.5]))).toBe(
      "No. It'll be dry. Dry in most forecasts.",
    );
    expect(detail(totals([0, 0, 0, 0, 0, 0, 0.3, 0.5]))).toBe(
      'No. A few spots at most. Little or no rain in most forecasts.',
    );
  });

  it('describes showers with the second-highest forecast', () => {
    expect(detail(totals([0, 0, 0, 0, 0, 2, 3.4, 9]))).toBe(
      'Maybe. Showers possible. Some forecasts say up to 3mm. On and off.',
    );
    expect(detail(totals([0, 0, 0, 2.6]))).toBe(
      'Maybe. Showers possible. One forecast says up to 3mm. On and off.',
    );
    // A showery hour with 3 of 8 models is worth naming.
    expect(
      detail(day(during([15], 2, (i) => i < 3)))
        .split('. ')
        .at(-1),
    ).toBe('Most likely around 3pm.');
  });

  it('gives the amount still to come, or the day’s amount', () => {
    expect(detail(day(during(range(14, 18), 1)), at(10))).toBe(
      "Yes. It'll rain. About 4mm still to come. Mostly between 2pm and 6pm.",
    );
    expect(detail(day(during(range(14, 18), 1)))).toBe(
      "Yes. It'll rain. About 4mm of rain. Mostly between 2pm and 6pm.",
    );
    expect(detail(day(during(range(0, 24), 0.5)))).toBe(
      "Yes. It'll pour. About 12mm of rain. All day.",
    );
    expect(detail(day(during(range(0, 24), 1.25)))).toBe(
      "Yes. You'll get drenched. About 30mm of rain. All day.",
    );
  });

  describe('timing', () => {
    const timing = (d: DayData, from?: number) =>
      formatRainDay(computeRainDay(d, from === undefined ? {} : { from })!, 'c')
        .detail.split('. ')
        .slice(1)
        .join('. ');

    it('names one hour, or a span ending at midnight', () => {
      expect(timing(day(during([15], 2)))).toBe('Most likely around 3pm.');
      expect(timing(day(during(range(18, 24), 1)))).toBe('Mostly between 6pm and midnight.');
      expect(timing(day(during(range(0, 6), 1)))).toBe('Mostly between 12am and 6am.');
    });

    it('says on and off when models disagree on the hour', () => {
      expect(timing(day((h, i) => (h === 10 + i ? 2 : 0)))).toBe('On and off.');
    });

    it('covers the whole day', () => {
      expect(timing(day(during(range(0, 24), 0.5)))).toBe('All day.');
      expect(timing(day(during([...range(0, 12), ...range(13, 24)], 0.5)))).toBe(
        'On and off all day.',
      );
    });

    it('covers the rest of today', () => {
      expect(timing(day(during(range(14, 24), 0.5)), at(14.5))).toBe('For the rest of the day.');
      expect(timing(day(during([14, 15, 16, 18, 19, 20, 21, 22, 23], 0.5)), at(14.5))).toBe(
        'On and off for the rest of the day.',
      );
    });

    it('says when rain falling now eases off', () => {
      expect(timing(day(during([14, 15, 16], 1)), at(14.5))).toBe('Easing off by about 5pm.');
      expect(timing(day(during([14], 2)), at(14.5))).toBe('Easing off by about 3pm.');
      expect(timing(day(during(range(10, 18), 1)), at(14.5))).toBe('Easing off by about 6pm.');
    });
  });

  describe('snow', () => {
    const freezing = () => -2;
    it('says snow when most of the rain falls as snow', () => {
      expect(detail(day(during(range(0, 24), 0.2), 8, freezing))).toBe(
        "Yes. It'll snow. Likely to fall as snow. All day.",
      );
      expect(detail(day(during(range(0, 24), 0.5), 8, freezing))).toBe(
        'Yes. Heavy snow. Likely to fall as snow. All day.',
      );
      expect(detail(day(during(range(0, 24), 1.25), 8, freezing), at(0))).toBe(
        'Yes. Heavy snow. Likely to fall as snow. For the rest of the day.',
      );
    });

    it('notes some snow', () => {
      const early = (h: number) => (h < 6 ? 0 : 5);
      expect(detail(day(during(range(0, 24), 0.2), 8, early))).toBe(
        "Yes. It'll rain. About 5mm of rain. All day. Some may fall as snow.",
      );
    });

    it('keeps showers and dry days as they are', () => {
      expect(
        detail(
          day(
            during([15], 2, (i) => i < 3),
            8,
            freezing,
          ),
        ),
      ).toBe('Maybe. Showers possible. Some forecasts say up to 2mm. Most likely around 3pm.');
      expect(
        formatRainDay(
          computeRainDay(
            day(
              during([15], 2, (i) => i < 3),
              8,
              freezing,
            ),
          )!,
          'c',
        ).snow,
      ).toBe('most');
    });
  });
});
