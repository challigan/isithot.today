import { describe, expect, it } from 'vitest';
import { SNOW } from '../src/config';
import type { HourTemps, ModelDay } from '../src/blend';
import type { DayData } from '../src/compute';
import {
  isSnow,
  roundSnow,
  snowRank,
  snowText,
  snowUnit,
  snowWater,
  toSnowUnits,
} from '../src/snow';
import {
  computeSnowDay,
  formatSnowDay,
  judgeSnowSeries,
  lowLine,
  snowBand,
  snowClimate,
  snowSeries,
  snowThresholds,
  textDepth,
  type SnowDayComputation,
} from '../src/snowDay';
import type { Units } from '../src/units';

const HOUR = 3_600_000;
const DATE = '2027-01-15';
const T0 = Date.parse(`${DATE}T00:00:00Z`);
const at = (hours: number) => T0 + hours * HOUR;
/** The water (mm) that falls as `depth` cm of snow. */
const cm = (depth: number) => depth / SNOW.cmPerMm;

type PerModel = (hour: number, model: number) => number | null;

/**
 * A day in UTC with hourly precipitation per model (mm), at -3° unless `temp` says otherwise, and
 * each model's daily totals worked out as the providers do (null unless every hour has a value).
 */
function day(rain: PerModel, models = 8, temp: PerModel = () => -3): DayData {
  const hourly: HourTemps[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    time: at(hour),
    temps: Array.from({ length: models }, (_, i) => temp(hour, i)),
    rain: Array.from({ length: models }, (_, i) => rain(hour, i)),
  }));
  const water = hourly.map(snowWater);
  return {
    date: DATE,
    models: Array.from({ length: models }, (_, i) => {
      const complete = hourly.every((h) => h.rain![i] !== null);
      const snow = water.reduce((a, w) => a + (w[i] ?? 0), 0);
      const temps = hourly.map((h) => h.temps[i]!);
      return {
        id: `m${i}`,
        name: `M${i}`,
        high: null,
        feelsLike: null,
        rain: complete ? hourly.reduce((a, h) => a + h.rain![i]!, 0) : null,
        snow: complete ? snow : null,
        snowfall: complete ? snow * SNOW.cmPerMm : null,
        low: temps.every((t) => t !== null) ? Math.min(...temps) : null,
      };
    }),
    hourly,
  };
}

/** A whole day known only by each model's snow (cm) and the rest of `extra`. */
function totals(snowfall: (number | null | undefined)[], extra: Partial<ModelDay> = {}): DayData {
  return {
    date: DATE,
    models: snowfall.map((v, i) => ({
      id: `m${i}`,
      name: `M${i}`,
      high: null,
      feelsLike: null,
      rain: typeof v === 'number' ? cm(v) : v,
      snowfall: v,
      ...extra,
    })),
    hourly: [],
  };
}

/** Snow in the given hours (all models unless `who` says otherwise), `mm` an hour. */
const during =
  (hours: number[], mm: number, who: (model: number) => boolean = () => true): PerModel =>
  (h, i) =>
    hours.includes(h) && who(i) ? mm : 0;

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

/** "Answer verdict detail" for a day, from a moment for the rest of today. */
function say(d: DayData, from?: number, units: Units = 'c', normals?: number[]): string {
  const c = computeSnowDay(d, { ...(from === undefined ? {} : { from }), normals })!;
  const f = formatSnowDay(c, units);
  return `${f.answer} ${f.verdict} ${f.detail}`;
}

describe('snow units', () => {
  it('follows the temperature units', () => {
    expect(snowUnit('c')).toBe('cm');
    expect(snowUnit('f')).toBe('in');
    expect(toSnowUnits(2.54, 'in')).toBe(1);
    expect(toSnowUnits(4, 'cm')).toBe(4);
  });

  it('rounds for lists, never to -0', () => {
    expect(roundSnow(0.34, 'cm')).toBe(0.3);
    expect(roundSnow(0.96, 'cm')).toBe(1);
    expect(roundSnow(4.4, 'cm')).toBe(4);
    expect(Object.is(roundSnow(-0.01, 'cm'), 0)).toBe(true);
    expect(roundSnow(1.47, 'in')).toBe(1.5);
    expect(roundSnow(3.4, 'in')).toBe(3);
    expect(snowText(0.34, 'cm')).toBe('0.3cm');
    expect(snowText(4, 'in')).toBe('4in');
  });

  it('words depths for sentences, with a dusting below half a centimetre', () => {
    expect(textDepth(0.49, 'cm')).toBeNull();
    expect(textDepth(0.49, 'in')).toBeNull();
    expect(textDepth(0.5, 'cm')).toBe(1);
    expect(textDepth(3.4, 'cm')).toBe(3);
    expect(textDepth(9.6, 'cm')).toBe(10);
    expect(textDepth(12.4, 'cm')).toBe(10);
    expect(textDepth(13, 'cm')).toBe(15);
    expect(textDepth(0.5, 'in')).toBe(0.5);
    expect(textDepth(2.54, 'in')).toBe(1);
    expect(textDepth(3.81, 'in')).toBe(1.5);
    expect(textDepth(7.62, 'in')).toBe(3);
    expect(textDepth(12.7, 'in')).toBe(5);
  });

  it('ranks the bands', () => {
    expect(snowRank('nosnow')).toBe(0);
    expect(snowRank('deepsnow')).toBe(5);
    expect(isSnow('snow')).toBe(true);
    expect(isSnow('maybesnow')).toBe(false);
  });
});

describe('snowWater: the one rule for rain and snow', () => {
  it("takes each model's snowfall as water, never more than its precipitation", () => {
    const h: HourTemps = {
      hour: 0,
      time: T0,
      temps: [-3, -3, 0.5, 2, null],
      rain: [2, null, 1, 1, 1],
      snow: [0.7, 0.7, null, 1.4],
    };
    // Snowfall where there is some; by each model's own temperature where there is none.
    expect(snowWater(h)).toEqual([1, null, 1, 1, 0]);
  });

  it('falls back to all or nothing at the snow line without snowfall', () => {
    expect(snowWater({ hour: 0, time: T0, temps: [1, 1.1], rain: [0.4, 0.4] })).toEqual([0.4, 0]);
    // The blend drops the highest and lowest of five or more; each model's own temperature counts.
    expect(
      snowWater({ hour: 0, time: T0, temps: [-5, -5, -5, -5, 20], rain: [1, 1, 1, 1, 1] }),
    ).toEqual([1, 1, 1, 1, 0]);
    expect(snowWater({ hour: 0, time: T0, temps: [], rain: [0.5] })).toEqual([0]);
    expect(snowWater({ hour: 0, time: T0, temps: [-3] })).toEqual([]);
  });

  it('has no snow when the blended temperature is above the warm guard', () => {
    expect(
      snowWater({ hour: 0, time: T0, temps: [3, 3, 2], rain: [1, 1, null], snow: [0.7, 0.7, 0.7] }),
    ).toEqual([0, 0, null]);
    expect(
      snowWater({ hour: 0, time: T0, temps: [2.5, 2.5], rain: [1, 1], snow: [0.7, 0.7] }),
    ).toEqual([1, 1]);
  });
});

describe('snowThresholds and snowBand', () => {
  it('scales the hourly values by the hours, capped at the day values', () => {
    expect(snowThresholds(1)).toEqual(SNOW.hour);
    expect(snowThresholds(24)).toEqual(SNOW.day);
    const three = snowThresholds(3);
    expect(three.snow).toBeCloseTo(0.3, 10);
    expect(three.flakes).toBe(0.1);
    expect(three.heavy).toBeCloseTo(2.4, 10);
    expect(three.deep).toBe(6);
  });

  it('needs 60% of models for snow, banded by the median', () => {
    const d = SNOW.day;
    expect(snowBand([0, 0, 0, 15, 15, 15, 15, 15], d)).toBe('deepsnow');
    expect(snowBand([0, 0, 0, 5, 5, 5, 5, 5], d)).toBe('heavysnow');
    expect(snowBand([0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5], d)).toBe('snow');
    expect(snowBand([0, 0, 0, 0, 0, 0, 0.5, 0.5], d)).toBe('maybesnow');
    expect(snowBand([0, 0, 0, 0, 0, 0, 0.1, 0.1], d)).toBe('flakes');
    expect(snowBand([0, 0, 0, 0, 0, 0, 0, 0.4], d)).toBe('nosnow');
  });
});

describe('computeSnowDay: whole days', () => {
  it('judges each model’s snow', () => {
    const c = computeSnowDay(totals([0, 0, 0.3, 0.5, 1, 2, 3, 6]))!;
    expect(c).toMatchObject({
      date: DATE,
      from: T0,
      partial: false,
      hours: 24,
      thresholds: SNOW.day,
      snowy: 5,
      chance: 0.625,
      amount: 0.75,
      band: 'snow',
      reason: null,
      low: null,
      normal: null,
      hourly: [],
      likely: null,
      snowing: false,
    });
    expect(c.models[3]).toEqual({ id: 'm3', name: 'M3', total: 0.5, rain: cm(0.5), low: null });
  });

  it('leaves out models without snow, and needs one', () => {
    expect(computeSnowDay(totals([1, null, undefined, 2]))!.models.map((m) => m.id)).toEqual([
      'm0',
      'm3',
    ]);
    expect(computeSnowDay(totals([null, undefined]))).toBeNull();
  });

  it('starts at local midnight', () => {
    const d = day(() => 0);
    d.hourly = d.hourly.map((h) => ({ ...h, time: h.time - HOUR }));
    expect(computeSnowDay(d)!.from).toBe(T0 - HOUR);
  });

  it('says why a day has no snow', () => {
    const why = (extra: Partial<ModelDay>) => computeSnowDay(totals([0, 0, 0], extra))!.reason;
    // Every model above the warm guard all day.
    expect(why({ low: 3 })).toBe('warm');
    expect(why({ low: 2.5 })).toBe('dry');
    expect(why({ low: null })).toBe('dry');
    // Rain the wet topic would call showers or more.
    expect(why({ low: 3, rain: 5 })).toBe('rain');
    expect(why({ low: -5, rain: 0.5 })).toBe('dry');
    // A day recorded without rain counts as dry.
    expect(why({ low: 3, rain: undefined })).toBe('warm');
    expect(computeSnowDay(totals([0, 0.5, 0.5]))!.reason).toBeNull();
  });

  it('blends the lows and takes the normal for the date', () => {
    const c = computeSnowDay(totals([0, 0, 0], { low: 4 }), { normals: Array(12).fill(1) })!;
    expect(c.low).toBe(4);
    expect(c.normal).toBeCloseTo(0.7, 10);
    expect(computeSnowDay(totals([0]), { normals: null })!.normal).toBeNull();
  });

  it('finds the likely hours from the hourly data', () => {
    const c = computeSnowDay(day(during([14, 15, 16, 17], cm(0.3), (i) => i < 5)))!;
    expect(c.hourly).toHaveLength(24);
    expect(c.hourly[14]).toEqual({ hour: 14, chance: 0.625, band: 'snow' });
    expect(c.hourly[13]).toEqual({ hour: 13, chance: 0, band: 'nosnow' });
    expect(c.likely).toEqual({ from: 14, to: 18 });
    expect(c.low).toBe(-3);
  });

  it('skips hours without precipitation data', () => {
    const d = day(during([14], cm(0.3)));
    d.hourly[3] = { ...d.hourly[3]!, rain: Array.from({ length: 8 }, () => null) };
    delete (d.hourly[4] as { rain?: unknown }).rain;
    const c = computeSnowDay(d)!;
    expect(c.hourly).toHaveLength(22);
    expect(c.hourly.map((h) => h.hour)).not.toContain(3);
  });
});

describe('computeSnowDay: the rest of today', () => {
  it('weights the current hour by the minutes left', () => {
    // Under an hour's flakes: not snowing now.
    const light = day(() => cm(0.05));
    const c = computeSnowDay(light, { from: at(14.5) })!;
    expect(c).toMatchObject({ partial: true, from: at(14.5), hours: 9.5, band: 'flakes' });
    expect(c.thresholds).toEqual(snowThresholds(9.5));
    expect(c.models[0]!.total).toBeCloseTo(0.05 * 9.5, 10);
    expect(c.hourly.map((h) => h.hour)).toEqual(range(14, 24));
    expect(c.snowing).toBe(false);
  });

  it('counts the current hour in full while snow is possible now, as Now judges it', () => {
    const c = computeSnowDay(day(during([14, 15], cm(0.3))), { from: at(14.5) })!;
    expect(c.hours).toBe(10);
    expect(c.thresholds.snow).toBe(SNOW.hour.snow);
    expect(c.models[0]!.total).toBeCloseTo(0.6, 10);
    expect(c).toMatchObject({ band: 'snow', snowing: true });
    // Only possible now: in full, but not snowing.
    const maybe = computeSnowDay(day(during([14], cm(0.3), (i) => i < 3)), { from: at(14.5) })!;
    expect(maybe).toMatchObject({ hours: 10, band: 'maybesnow', snowing: false });
  });

  it('counts a model only with every hour of the window', () => {
    const gapLater = day((h, i) => (i === 0 && h === 20 ? null : 0.3));
    expect(computeSnowDay(gapLater, { from: at(14.5) })!.models).toHaveLength(7);
    const gapEarlier = day((h, i) => (i === 0 && h === 10 ? null : 0.3));
    expect(computeSnowDay(gapEarlier, { from: at(14.5) })!.models).toHaveLength(8);
  });

  it('needs hours with precipitation', () => {
    expect(
      computeSnowDay(
        day(() => 0.3),
        { from: at(24) },
      ),
    ).toBeNull();
    const old = day(() => 0);
    old.hourly = old.hourly.map(({ hour, time, temps }) => ({ hour, time, temps }));
    expect(computeSnowDay(old, { from: at(14.5) })).toBeNull();
  });

  it('takes the lowest temperature in the window, without models that have none', () => {
    const c = computeSnowDay(
      day(
        () => 0,
        4,
        (h, i) => (i === 3 ? null : h < 15 ? -10 : -2),
      ),
      { from: at(14.5) },
    )!;
    expect(c.models.map((m) => m.low)).toEqual([-10, -10, -10, null]);
    expect(c.low).toBe(-10);
    const none = computeSnowDay(
      day(
        () => 0,
        2,
        () => null,
      ),
      { from: at(14.5) },
    )!;
    expect(none.low).toBeNull();
  });

  it('says why the rest of the day has no snow', () => {
    const why = (rain: number, temp: number) =>
      computeSnowDay(
        day(
          () => rain,
          8,
          () => temp,
        ),
        { from: at(14.5) },
      )!.reason;
    expect(why(1, 5)).toBe('rain');
    expect(why(0, 5)).toBe('warm');
    expect(why(0, -3)).toBe('dry');
  });
});

describe('snow day words', () => {
  const freezing = () => -3;

  it('says how much, and when', () => {
    expect(say(day(during(range(0, 24), cm(0.3)), 8, freezing))).toBe(
      'Yes. Heavy snow. About 7cm of snow. All day.',
    );
    expect(say(day(during([...range(0, 12), ...range(13, 24)], cm(0.3))))).toBe(
      'Yes. Heavy snow. About 7cm of snow. On and off all day.',
    );
    expect(say(day(during([15], cm(0.5), (i) => i < 5)))).toBe(
      "Yes. It'll snow. About 1cm of snow. Most likely around 3pm.",
    );
    expect(say(day(during([14, 15, 16, 17], cm(0.3), (i) => i < 5)))).toBe(
      "Yes. It'll snow. About 1cm of snow. Mostly between 2pm and 6pm.",
    );
  });

  it('says when snow under way now eases off, and when it comes back', () => {
    expect(say(day(during(range(0, 24), cm(0.3))), at(10.5))).toBe(
      "Yes. It'll snow. About 4cm still to come. For the rest of the day.",
    );
    expect(say(day(during([10, 11, 12, 13], cm(0.3))), at(10.5))).toBe(
      "Yes. It'll snow. About 1cm still to come. Easing off by about 2pm.",
    );
    expect(say(day(during([10, 11, 12, 13, 17, 18, 19], cm(0.3))), at(10.5))).toBe(
      "Yes. It'll snow. About 2cm still to come. Easing off by about 2pm. Snow likely from about 5pm.",
    );
    // Snow possible in every later hour, but in under half the models in some.
    const patchy = day((h, i) => (h >= 10 && (h === 10 || h % 2 === 0 || i < 3) ? cm(0.3) : 0));
    expect(say(patchy, at(10.5))).toBe(
      "Yes. It'll snow. 2 to 4cm still to come. On and off for the rest of the day.",
    );
  });

  it('words snow that is only possible', () => {
    // Half the models every hour: possible now, likely all afternoon.
    const half = (gap: number | null) =>
      day((h, i) => (h >= 14 && i < (h === gap ? 3 : 4) ? cm(0.3) : 0));
    expect(say(half(null), at(14.5))).toBe(
      'Maybe. It might snow. Some forecasts say up to 3cm. For the rest of the day.',
    );
    expect(say(half(18), at(14.5))).toBe(
      'Maybe. It might snow. Some forecasts say up to 3cm. On and off for the rest of the day.',
    );
    // Two models, at different times.
    const scattered = day((h, i) => ((i === 0 && h === 3) || (i === 1 && h === 9) ? cm(0.6) : 0));
    expect(say(scattered)).toBe('Maybe. It might snow. Some forecasts say up to 1cm. On and off.');
    // Three of eight in one hour, or two of six (a third: SNOW.hourPossible); not two of eight.
    expect(say(day(during([15], cm(0.6), (i) => i < 3)))).toBe(
      'Maybe. It might snow. Some forecasts say up to 1cm. Most likely around 3pm.',
    );
    expect(
      say(
        day(
          during([15], cm(0.6), (i) => i < 2),
          6,
        ),
      ),
    ).toBe('Maybe. It might snow. Some forecasts say up to 1cm. Most likely around 3pm.');
    expect(say(day(during([15], cm(0.6), (i) => i < 2)))).toBe(
      'Maybe. It might snow. Some forecasts say up to 1cm. On and off.',
    );
    // One of four, with no hours to time it.
    expect(say(totals([0.6, 0, 0, 0]))).toBe(
      'Maybe. It might snow. One forecast says up to 1cm. On and off.',
    );
    // Late in the day, a little snow in two models is a dusting.
    expect(say(day(during([23], cm(0.2), (i) => i < 2)), at(22.5))).toBe(
      'Maybe. It might snow. Some forecasts say a dusting. On and off.',
    );
  });

  it('gives a range from the middle forecasts, or an amount', () => {
    expect(say(totals([0.5, 1, 2, 3, 4, 5, 6, 7]))).toBe(
      "Yes. It'll snow. 2 to 5cm of snow. On and off.",
    );
    expect(say(totals([3, 3, 3, 3]))).toBe("Yes. It'll snow. About 3cm of snow. On and off.");
    expect(say(totals([2, 3, 4]))).toBe("Yes. It'll snow. About 3cm of snow. On and off.");
    // The low end is a dusting: just the amount.
    expect(say(totals([0, 0, 0.4, 2, 2, 3, 3, 3]))).toBe(
      "Yes. It'll snow. About 2cm of snow. On and off.",
    );
    expect(say(totals([0.5, 1, 2, 3, 4, 5, 6, 7]), undefined, 'f')).toBe(
      "Yes. It'll snow. 1 to 2in of snow. On and off.",
    );
    // A dusting still to come in the last hour.
    expect(say(day(during([23], cm(0.2))), at(23.5))).toBe(
      "Yes. It'll snow. A dusting still to come. For the rest of the day.",
    );
    expect(say(totals([20, 20, 20]))).toBe('Yes. Deep snow. About 20cm of snow. On and off.');
  });

  it('says why there is no snow, how low it goes and how usual snow is', () => {
    const none = (extra: Partial<ModelDay>, normals?: number[], units: Units = 'c') =>
      say(totals([0, 0, 0], extra), undefined, units, normals);
    expect(none({ low: 9 }, Array(12).fill(0))).toBe(
      'No. Too warm for snow. No lower than 9° all day. Snow is rare here in January.',
    );
    expect(none({ low: 9 }, Array(12).fill(0), 'f')).toBe(
      'No. Too warm for snow. No lower than 48° all day. Snow is rare here in January.',
    );
    expect(none({ low: -4 }, Array(12).fill(0.5))).toBe(
      "No. It won't snow. Down to -4° at the coldest. Snow is common here in January.",
    );
    expect(none({ low: 1.6, rain: 5 }, Array(12).fill(0.1))).toBe(
      'No. Rain, not snow. Down to 2° at the coldest.',
    );
    expect(none({})).toBe("No. It won't snow. ");
    expect(
      say(
        day(
          () => 0,
          8,
          () => 9,
        ),
        at(14.5),
      ),
    ).toBe('No. Too warm for snow. No lower than 9° for the rest of the day.');
    expect(say(totals([0.1, 0.1, 0, 0]))).toBe(
      'No. A few flakes at most. Little or no snow in most forecasts.',
    );
  });

  it('words the lowest temperature by the snow line, and the month by its normal', () => {
    expect(lowLine(2.6, 'c', 'week')).toBe('No lower than 3° all week.');
    expect(lowLine(2.5, 'c', 'day')).toBe('Down to 3° at the coldest.');
    expect(snowClimate(0)).toBe('rare');
    expect(snowClimate(SNOW.normals.rareBelow)).toBeNull();
    expect(snowClimate(SNOW.normals.commonFrom)).toBe('common');
  });
});

describe('formatSnowDay', () => {
  it('gives the strip in display units', () => {
    const f = formatSnowDay(computeSnowDay(totals([0, 0, 0.3, 0.5, 1, 2, 3, 6]))!, 'c');
    expect(f).toMatchObject({
      date: DATE,
      from: new Date(T0).toISOString(),
      partial: false,
      band: 'snow',
      answer: 'Yes.',
      reason: null,
      bandLabel: 'Snow',
      amount: 0.8,
      chance: 0.63,
      snowy: 5,
      total: 8,
      confidence: 'good',
      threshold: 0.5,
      likely: null,
      scale: { min: 0, max: 10 },
      month: 'January',
      agreementText: '5 of 8 forecasts expect snow',
      limitedText: null,
      stripSummary: 'Forecasts range from 0cm to 6cm; 5 of 8 expect snow.',
    });
    expect(f.models.slice(2, 4)).toEqual([
      { id: 'm2', name: 'M2', amount: 0.3, value: 0.3, expectsSnow: false, agrees: false },
      { id: 'm3', name: 'M3', amount: 0.5, value: 0.5, expectsSnow: true, agrees: true },
    ]);
  });

  it('agrees by the answer, and follows the units', () => {
    const maybe = formatSnowDay(computeSnowDay(totals([0, 0, 0, 0.6]))!, 'c');
    expect(maybe.models.every((m) => m.agrees)).toBe(true);
    const no = formatSnowDay(computeSnowDay(totals([0, 0, 0, 0.2]))!, 'c');
    expect(no.models.map((m) => m.agrees)).toEqual([true, true, true, true]);
    const limited = formatSnowDay(computeSnowDay(totals([1, 1]))!, 'f');
    expect(limited).toMatchObject({
      confidence: 'limited',
      limitedText: 'Limited forecast data',
      amount: 0.4,
      threshold: 0.2,
      scale: { min: 0, max: 2 },
      stripSummary: 'All forecasts say 0.4in; 2 of 2 expect snow.',
    });
  });

  it('copies the likely hours', () => {
    const c: SnowDayComputation = computeSnowDay(day(during([14], cm(0.3))))!;
    expect(formatSnowDay(c, 'c').likely).toEqual({ from: 14, to: 15 });
  });

  it("labels the day as the week's rows do: its band, or why there is no snow", () => {
    const label = (d: DayData) => {
      const f = formatSnowDay(computeSnowDay(d)!, 'c');
      return [f.band, f.reason, f.bandLabel];
    };
    expect(label(totals([20, 20, 20, 20, 20, 20]))).toEqual(['deepsnow', null, 'Deep snow']);
    expect(label(totals([6, 6, 7, 7, 8, 8]))).toEqual(['heavysnow', null, 'Heavy snow']);
    expect(label(totals([1, 1, 1, 0, 0, 0]))).toEqual(['maybesnow', null, 'Snow possible']);
    expect(label(totals([0.2, 0.2, 0, 0, 0, 0]))).toEqual(['flakes', null, 'A few flakes']);
    expect(label(totals([0, 0, 0, 0], { low: 5 }))).toEqual(['nosnow', 'warm', 'Too warm']);
    expect(label(totals([0, 0, 0, 0], { rain: 5, low: -1 }))).toEqual(['nosnow', 'rain', 'Rain']);
    expect(label(totals([0, 0, 0, 0], { low: -5 }))).toEqual(['nosnow', 'dry', 'Dry']);
  });
});

describe('snowSeries', () => {
  it('judges each hour across the models', () => {
    const days: DayData[] = [
      {
        date: DATE,
        models: [],
        hourly: [
          { hour: 0, time: at(0), temps: [-3, -3, -3, -3], rain: [0.5, 0.5, null, 0] },
          // Models without a temperature have no snow.
          { hour: 1, time: at(1), temps: [-3], rain: [0.25, null, 0, 0] },
          { hour: 2, time: at(2), temps: [5] },
          { hour: 3, time: at(3), temps: [5, 5, 5, 5], rain: [1, 1, 1, 1] },
          { hour: 5, time: at(5), temps: [5, 5], rain: [0, 0] },
          { hour: 6, time: at(6), temps: [-3, -3], rain: [0, 0] },
        ],
      },
    ];
    const series = snowSeries(days);
    expect(series).toEqual([
      // The next hour adds to each model's two-hour block.
      { time: at(0), amount: 0.35, chance: 2 / 3, chance2h: 2 / 3, band: 'snow', reason: null },
      { time: at(1), amount: 0, chance: 1 / 3, chance2h: 1 / 3, band: 'maybesnow', reason: null },
      // Hour 2 has no precipitation; 3 is too warm and wet; 5 too warm; 6 cold and dry.
      { time: at(3), amount: 0, chance: 0, chance2h: 0, band: 'nosnow', reason: 'rain' },
      { time: at(5), amount: 0, chance: 0, chance2h: 0, band: 'nosnow', reason: 'warm' },
      { time: at(6), amount: 0, chance: 0, chance2h: 0, band: 'nosnow', reason: 'dry' },
    ]);
    expect(judgeSnowSeries(series, 'c', 'UTC').slice(0, 2)).toEqual([
      {
        time: at(0),
        date: DATE,
        hour: 0,
        amount: 0.35,
        chance: 0.67,
        chance2h: 0.67,
        band: 'snow',
        reason: null,
        light: false,
      },
      {
        time: at(1),
        date: DATE,
        hour: 1,
        amount: 0,
        chance: 0.33,
        chance2h: 0.33,
        band: 'maybesnow',
        reason: null,
        light: true,
      },
    ]);
    expect(judgeSnowSeries(series, 'f', 'America/New_York')[0]).toMatchObject({
      date: '2027-01-14',
      hour: 19,
      amount: 0.14,
    });
  });
});
