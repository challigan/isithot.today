import { describe, expect, it } from 'vitest';
import { WIND, WIND_BANDS, type WindBand } from '../src/config';
import type { HourTemps } from '../src/blend';
import type { DayData } from '../src/compute';
import {
  KMH_PER_MPH,
  gustRange,
  isStill,
  isWindy,
  toWindUnits,
  windBand,
  windRank,
  windText,
  windValue,
} from '../src/wind';
import {
  computeWindDay,
  dailyWind,
  formatWindDay,
  judgeWindSeries,
  windDayDetail,
  windDayVerdict,
  windNormal,
  windSeries,
} from '../src/windDay';

const HOUR = 3_600_000;
const DATE = '2026-10-15';
const T0 = Date.parse(`${DATE}T00:00:00Z`);
const at = (hours: number) => T0 + hours * HOUR;

type PerModel = (hour: number, model: number) => number | null;

/**
 * A day in UTC with each model's hourly mean wind and gusts (km/h), and each model's daily wind
 * worked out as the providers keep it.
 */
function day(wind: PerModel, gust: PerModel, models = 6, start = T0, date = DATE): DayData {
  const hourly: HourTemps[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    time: start + hour * HOUR,
    temps: Array.from({ length: models }, () => 10),
    wind: Array.from({ length: models }, (_, i) => wind(hour, i)),
    gust: Array.from({ length: models }, (_, i) => gust(hour, i)),
  }));
  return {
    date,
    models: Array.from({ length: models }, (_, i) => ({
      id: `m${i}`,
      name: `M${i}`,
      high: null,
      feelsLike: null,
      ...dailyWind(hourly, i),
    })),
    hourly,
  };
}

/** The day with each model's wind direction in each hour, degrees (meteorological). */
function withDir(d: DayData, dir: PerModel): DayData {
  return {
    ...d,
    hourly: d.hourly.map((h) => ({ ...h, dir: h.temps.map((_, i) => dir(h.hour, i)) })),
  };
}

/** Each model's own value, all day. */
const each =
  (values: readonly (number | null)[]): PerModel =>
  (_h, i) =>
    values[i]!;
const flat =
  (value: number): PerModel =>
  () =>
    value;

/** Each model's gust from `base`, strongest at 3pm and a km/h less for every hour either side. */
const peaked =
  (base: readonly number[]): PerModel =>
  (h, i) =>
    base[i]! - Math.abs(h - 15);

/** Every band edge in km/h, with the same edge in mph: [mean, gust, mean mph, gust mph]. */
const EDGES: Record<Exclude<WindBand, 'calm'>, readonly [number, number, number, number]> = {
  breezy: [21, 32, 13, 20],
  windy: [30, 48, 19, 30],
  verywindy: [40, 64, 25, 40],
  gale: [62, 80, 39, 50],
  storm: [88, 112, 55, 70],
};

describe('wind units', () => {
  it('rounds to whole km/h first, then to whole mph', () => {
    expect(KMH_PER_MPH).toBe(1.609344);
    expect(toWindUnits(48, 'mph')).toBe(30);
    expect(toWindUnits(47.6, 'mph')).toBe(30);
    expect(toWindUnits(47.4, 'mph')).toBe(29);
    expect(toWindUnits(47.4, 'kmh')).toBe(47);
    expect(windValue(48, 'mph')).toBe(29.8);
    expect(windValue(47.6, 'kmh')).toBe(48);
    expect(windText(45, 'mph')).toBe('45mph');
    expect(windText(72, 'kmh')).toBe('72km/h');
  });
});

describe('wind bands', () => {
  it('starts each band at its mean wind or its gust, on the Beaufort scale and the Met Office gusts', () => {
    for (const [band, [mean, gust]] of Object.entries(EDGES)) {
      const b = band as WindBand;
      expect(WIND.from[b as keyof typeof EDGES]).toEqual({ mean, gust });
      expect(windBand(mean, 0)).toBe(b);
      expect(windBand(0, gust)).toBe(b);
      expect(windRank(windBand(mean - 1, 0))).toBe(windRank(b) - 1);
      expect(windRank(windBand(0, gust - 1))).toBe(windRank(b) - 1);
    }
    // Whichever gets there first: a strong mean wind with lower gusts, or the other way round.
    expect(windBand(45, 30)).toBe('verywindy');
    expect(windBand(10, 70)).toBe('verywindy');
    expect(windBand(65, 20)).toBe('gale');
    expect(windBand(0, 0)).toBe('calm');
  });

  it('puts every edge on the right side in mph too', () => {
    for (const [mean, gust, meanMph, gustMph] of Object.values(EDGES)) {
      expect([toWindUnits(mean - 1, 'mph'), toWindUnits(mean, 'mph')]).toEqual([
        meanMph - 1,
        meanMph,
      ]);
      expect([toWindUnits(gust - 1, 'mph'), toWindUnits(gust, 'mph')]).toEqual([
        gustMph - 1,
        gustMph,
      ]);
    }
    expect([toWindUnits(5, 'mph'), toWindUnits(6, 'mph')]).toEqual([3, 4]);
    expect([toWindUnits(15, 'mph'), toWindUnits(16, 'mph')]).toEqual([9, 10]);
  });

  it('never shows an mph number that contradicts the band', () => {
    // The band the mph number would get by the mph edges.
    const byMph = (mean: number, gust: number): WindBand => {
      let band: WindBand = 'calm';
      for (const [b, [, , m, g]] of Object.entries(EDGES)) {
        if (mean >= m || gust >= g) band = b as WindBand;
      }
      return band;
    };
    for (let v = 0; v <= 200; v++) {
      expect(windBand(v, 0)).toBe(byMph(toWindUnits(v, 'mph'), 0));
      expect(windBand(0, v)).toBe(byMph(0, toWindUnits(v, 'mph')));
      // Still air is under 4mph with gusts under 10mph.
      expect(isStill(v, 0)).toBe(toWindUnits(v, 'mph') < 4);
      expect(isStill(0, v)).toBe(toWindUnits(v, 'mph') < 10);
    }
  });

  it('knows still air, windy bands and each band’s gusts', () => {
    expect(isStill(5, 15)).toBe(true);
    expect(isStill(6, 15)).toBe(false);
    expect(isStill(5, 16)).toBe(false);
    expect(WIND_BANDS.filter(isWindy)).toEqual(['windy', 'verywindy', 'gale', 'storm']);
    expect(gustRange('calm')).toEqual({ from: 0, to: 32 });
    expect(gustRange('breezy')).toEqual({ from: 32, to: 48 });
    expect(gustRange('gale')).toEqual({ from: 80, to: 112 });
    expect(gustRange('storm')).toEqual({ from: 112, to: null });
  });
});

describe('dailyWind', () => {
  const hours = (wind: PerModel, gust: PerModel, count = 24): HourTemps[] =>
    day(wind, gust, 2).hourly.slice(0, count);

  it('takes the strongest of the waking hours, and the mean of all 24', () => {
    // A night gale is not the day's: only 7am to 9pm counts.
    const wind: PerModel = (h) => (h === 3 ? 99 : h);
    const gust: PerModel = (h) => (h === 22 ? 150 : 2 * h);
    const all = hours(wind, gust);
    expect(dailyWind(all, 0)).toEqual({ wind: 20, gust: 40, windMean: (276 - 3 + 99) / 24 });
  });

  it('drops a model without both values for every waking hour', () => {
    const gappy = hours(flat(10), (h, i) => (i === 1 && h === 12 ? null : 20));
    expect(dailyWind(gappy, 0)).toEqual({ wind: 10, gust: 20, windMean: 10 });
    // The 24-hour mean needs only the wind speeds.
    expect(dailyWind(gappy, 1)).toEqual({ wind: null, gust: null, windMean: 10 });
    const night = hours((h, i) => (i === 1 && h === 2 ? null : 10), flat(20));
    expect(dailyWind(night, 1)).toEqual({ wind: 10, gust: 20, windMean: null });
    // A forecast that ends part-way through the day.
    expect(dailyWind(hours(flat(10), flat(20), 12), 0)).toEqual({
      wind: null,
      gust: null,
      windMean: null,
    });
    expect(dailyWind(hours(flat(10), flat(20), 22), 0)).toEqual({
      wind: 10,
      gust: 20,
      windMean: null,
    });
    // Without any wind at all.
    const none = day(flat(10), flat(20), 1).hourly.map(({ hour, time, temps }) => ({
      hour,
      time,
      temps,
    }));
    expect(dailyWind(none, 0)).toEqual({ wind: null, gust: null, windMean: null });
  });
});

describe('computeWindDay: a whole day', () => {
  // Means from 10 to 20 km/h; gusts strongest at 3pm, from calm to very windy.
  const d = day(each([10, 12, 14, 16, 18, 20]), peaked([30, 34, 40, 50, 52, 66]));

  it('takes the medians of the models’ peaks over the waking hours', () => {
    const c = computeWindDay(d)!;
    expect(c).toMatchObject({
      date: DATE,
      from: at(7),
      partial: false,
      window: { from: 7, to: 21 },
      mean: 15,
      gust: 45,
      band: 'breezy',
      still: false,
      agree: 2,
      peakHour: 15,
      dayMean: 15,
      normal: null,
    });
    expect(c.models.map((m) => [m.mean, m.gust, m.band])).toEqual([
      [10, 30, 'calm'],
      [12, 34, 'breezy'],
      [14, 40, 'breezy'],
      [16, 50, 'windy'],
      [18, 52, 'windy'],
      [20, 66, 'verywindy'],
    ]);
    expect(c.models[0]).toMatchObject({ id: 'm0', name: 'M0', dayMean: 10 });
  });

  it('formats the day in mph', () => {
    expect(formatWindDay(computeWindDay(d)!, 'mph')).toEqual({
      date: DATE,
      from: '2026-10-15T07:00:00.000Z',
      partial: false,
      window: { from: 7, to: 21 },
      band: 'breezy',
      answer: 'A bit.',
      verdict: 'Breezy, not windy.',
      detail: 'Gusts up to 28mph, wind up to 9mph. Windiest around 3pm.',
      still: false,
      gust: 28,
      mean: 9,
      peak: '3pm',
      agree: 2,
      total: 6,
      confidence: 'good',
      zone: { from: 20, to: 30 },
      scale: { min: 0, max: 50 },
      models: [
        { id: 'm0', name: 'M0', gust: 19, mean: 6, value: 18.6, band: 'calm', agrees: false },
        { id: 'm1', name: 'M1', gust: 21, mean: 7, value: 21.1, band: 'breezy', agrees: true },
        { id: 'm2', name: 'M2', gust: 25, mean: 9, value: 24.9, band: 'breezy', agrees: true },
        { id: 'm3', name: 'M3', gust: 31, mean: 10, value: 31.1, band: 'windy', agrees: false },
        { id: 'm4', name: 'M4', gust: 32, mean: 11, value: 32.3, band: 'windy', agrees: false },
        { id: 'm5', name: 'M5', gust: 41, mean: 12, value: 41, band: 'verywindy', agrees: false },
      ],
      month: 'October',
      agreementText: '2 of 6 forecasts say breezy',
      limitedText: null,
      stripSummary: 'Forecast gusts range from 19mph to 41mph; 2 of 6 say breezy.',
      dayMean: 9,
      normal: null,
    });
  });

  it('formats the day in km/h, with the scale past the strongest model', () => {
    const f = formatWindDay(computeWindDay(d)!, 'kmh');
    expect(f).toMatchObject({
      detail: 'Gusts up to 45km/h, wind up to 15km/h. Windiest around 3pm.',
      gust: 45,
      mean: 15,
      zone: { from: 32, to: 48 },
      // The 80km/h floor, rounded up to a round number as every strip's scale is.
      scale: { min: 0, max: 100 },
      stripSummary: 'Forecast gusts range from 30km/h to 66km/h; 2 of 6 say breezy.',
      dayMean: 15,
    });
    expect(f.models.map((m) => m.value)).toEqual([30, 34, 40, 50, 52, 66]);
    const stormy = formatWindDay(computeWindDay(day(flat(60), flat(130)))!, 'kmh');
    expect(stormy).toMatchObject({
      band: 'storm',
      answer: 'Yes.',
      verdict: 'Storm-force winds.',
      zone: { from: 112, to: null },
      scale: { min: 0, max: 200 },
      agreementText: '6 of 6 forecasts say storm force',
      stripSummary: 'All forecasts give gusts of 130km/h; 6 of 6 say storm force.',
    });
    // A day whose gusts are the same all day peaks at the first waking hour.
    expect(stormy.peak).toBe('7am');
  });

  it('says still air is calm, and light winds otherwise, without a peak', () => {
    const still = computeWindDay(day(flat(3), flat(10)))!;
    expect([still.band, still.still, still.peakHour]).toEqual(['calm', true, null]);
    expect(windDayVerdict(still)).toBe("It'll be calm.");
    expect(windDayDetail(still, 'mph')).toBe('Light winds, gusts up to 6mph.');
    const light = computeWindDay(day(flat(12), flat(24)))!;
    expect([light.band, light.still]).toEqual(['calm', false]);
    expect(windDayVerdict(light)).toBe("It won't be windy.");
    expect(windDayDetail(light, 'kmh')).toBe('Light winds, gusts up to 24km/h.');
    const f = formatWindDay(light, 'mph');
    expect(f).toMatchObject({
      answer: 'No.',
      peak: null,
      zone: { from: 0, to: 20 },
      agreementText: '6 of 6 forecasts say light winds',
    });
  });

  it('works from the models’ daily values without hours, and with too few models', () => {
    const totals: DayData = {
      date: DATE,
      models: [
        { id: 'a', name: 'A', high: null, feelsLike: null, wind: 40.4, gust: 70.6, windMean: 20 },
        // Without a 24-hour mean (a recording without every hour's wind).
        { id: 'b', name: 'B', high: null, feelsLike: null, wind: 30, gust: 60.2 },
        { id: 'c', name: 'C', high: null, feelsLike: null, wind: null, gust: null },
        { id: 'd', name: 'D', high: null, feelsLike: null },
      ],
      hourly: [],
    };
    const c = computeWindDay(totals)!;
    expect(c).toMatchObject({
      from: at(7),
      mean: 35,
      gust: 66,
      band: 'verywindy',
      peakHour: null,
      // Fewer than three models with a day's mean.
      dayMean: null,
    });
    expect(c.models.map((m) => [m.id, m.mean, m.gust, m.band, m.dayMean])).toEqual([
      ['a', 40, 71, 'verywindy', 20],
      ['b', 30, 60, 'windy', null],
    ]);
    const f = formatWindDay(c, 'mph');
    expect(f).toMatchObject({ confidence: 'limited', limitedText: 'Limited forecast data' });
    expect(f.agreementText).toBe('1 of 2 forecasts says very windy');
    expect(computeWindDay({ ...totals, models: totals.models.slice(2) })).toBeNull();
  });

  it('compares the day’s mean wind with normal, only when it has something to say', () => {
    const normals = (ms: number) => Array.from({ length: 12 }, () => ms);
    // A day mean of 15km/h against 9km/h (2.5m/s): windier.
    const windier = computeWindDay(d, { normals: normals(2.5) })!;
    expect(windier.normal).toBeCloseTo(9, 10);
    expect(windDayDetail(windier, 'mph')).toBe(
      'Gusts up to 28mph, wind up to 9mph. Windiest around 3pm. Windier than usual for October.',
    );
    expect(formatWindDay(windier, 'kmh')).toMatchObject({ dayMean: 15, normal: 9 });
    // Against 10.8km/h, 15 is not 1.4 times as much: nothing is said.
    expect(windDayDetail(computeWindDay(d, { normals: normals(3) })!, 'mph')).toBe(
      'Gusts up to 28mph, wind up to 9mph. Windiest around 3pm.',
    );
    // A light day against 25.2km/h: calmer.
    const calmer = computeWindDay(day(flat(10), flat(20)), { normals: normals(7) })!;
    expect(windDayDetail(calmer, 'kmh')).toBe(
      'Light winds, gusts up to 20km/h. Calmer than usual for October.',
    );
  });
});

describe('windNormal', () => {
  it('needs the ratio and the difference both', () => {
    const { day: d, week } = WIND.normals;
    expect(windNormal(15, 10, d)).toBe('windier');
    expect(windNormal(14, 10, d)).toBe('usual');
    expect(windNormal(30, 26, d)).toBe('usual');
    expect(windNormal(6, 12, d)).toBe('calmer');
    expect(windNormal(6, 10.9, d)).toBe('usual');
    expect(windNormal(13, 10, week)).toBe('windier');
    expect(windNormal(12, 10, week)).toBe('usual');
    expect(windNormal(12.5, 9.5, week)).toBe('windier');
    expect(windNormal(12.5, 10.1, week)).toBe('usual');
    expect(windNormal(7, 10, week)).toBe('calmer');
    expect(windNormal(7.6, 10, week)).toBe('usual');
  });
});

describe('computeWindDay: the rest of today', () => {
  const steady = day(flat(20), flat(40));

  it('runs from the start of the current hour to 9pm', () => {
    const c = computeWindDay(steady, { from: at(10.5) })!;
    expect(c).toMatchObject({
      from: at(10.5),
      partial: true,
      window: { from: 10, to: 21 },
      band: 'breezy',
      peakHour: 10,
    });
    expect(formatWindDay(c, 'mph').from).toBe('2026-10-15T10:30:00.000Z');
  });

  it('runs to midnight from 9pm, and starts at the current hour before 7am', () => {
    // A night gale still to come counts for today.
    const night = day(flat(20), (h) => (h === 23 || h === 4 ? 90 : 40));
    const late = computeWindDay(night, { from: at(21.5) })!;
    expect(late).toMatchObject({ window: { from: 21, to: 24 }, band: 'gale', peakHour: 23 });
    const early = computeWindDay(night, { from: at(3.5) })!;
    expect(early).toMatchObject({ window: { from: 3, to: 21 }, band: 'gale', peakHour: 4 });
    // After the night gale has gone, and before the next: the evening alone.
    expect(computeWindDay(night, { from: at(18) })!.band).toBe('breezy');
    // The last hour of the day is a window of one hour: no peak to name.
    const last = computeWindDay(night, { from: at(23.5) })!;
    expect(last).toMatchObject({ window: { from: 23, to: 24 }, band: 'gale', peakHour: null });
  });

  it('counts a model only with both values for every hour of the window', () => {
    const gappy = day(flat(20), (h, i) => (i === 0 && h === 12 ? null : 40));
    expect(computeWindDay(gappy, { from: at(10.5) })!.models).toHaveLength(5);
    expect(computeWindDay(gappy, { from: at(13.5) })!.models).toHaveLength(6);
    // A whole day drops it too.
    expect(computeWindDay(gappy)!.models).toHaveLength(5);
  });

  it('has no answer past the end of the day, or without wind', () => {
    expect(computeWindDay(steady, { from: at(24.5) })).toBeNull();
    expect(
      computeWindDay(
        day(flat(20), () => null),
        { from: at(10) },
      ),
    ).toBeNull();
  });

  it('is never calmer than Now', () => {
    // A fixed pseudo-random sequence, so the test is the same every run.
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let trial = 0; trial < 300; trial++) {
      const winds = Array.from({ length: 24 * 6 }, () => random() * 70);
      const gusts = winds.map((w) => w + random() * 60);
      const d = day(
        (h, i) => winds[h * 6 + i]!,
        (h, i) => gusts[h * 6 + i]!,
      );
      const from = at(random() * 24);
      const today = computeWindDay(d, { from })!;
      const now = windSeries([d]).find((p) => p.time <= from && from < p.time + HOUR)!;
      expect(windRank(today.band)).toBeGreaterThanOrEqual(windRank(now.band));
      expect(today.gust).toBeGreaterThanOrEqual(now.gust);
      expect(today.mean).toBeGreaterThanOrEqual(now.mean);
    }
  });
});

describe('windSeries', () => {
  it('judges every hour on its medians, with the stronger gust of it and the next', () => {
    const first = day(
      each([10, 20, 30]),
      (h, i) => (h === 5 && i < 2 ? null : [30 + h, 40 + h, 50][i]!),
      3,
    );
    const second = day(flat(2), flat(10), 3, at(24), '2026-10-16');
    const points = windSeries([first, second]);
    // 5am has only one model with both values; the hour is judged on it.
    expect(points[5]).toMatchObject({ mean: 30, gust: 50 });
    expect(points[0]).toEqual({
      time: at(0),
      mean: 20,
      gust: 40,
      gust2h: 41,
      band: 'breezy',
      still: false,
    });
    // The next day is calm and still; its first hour does not lift 11pm's.
    expect(points[23]).toMatchObject({ gust: 53, gust2h: 53, band: 'windy' });
    expect(points[24]).toMatchObject({ mean: 2, gust: 10, band: 'calm', still: true });
    expect(points.at(-1)!.gust2h).toBe(10);
    // An hour without any model is left out, and the hour before it keeps its own gust.
    const gap = day(flat(10), (h) => (h === 3 ? null : 20 + h), 2);
    // An hour recorded without wind at all.
    gap.hourly[3] = { hour: 3, time: at(3), temps: [10, 10] };
    const series = windSeries([gap]);
    expect(series).toHaveLength(23);
    expect(series[2]).toMatchObject({ time: at(2), gust: 22, gust2h: 22 });
  });

  it('sends the series in the wind unit, with the local date and hour', () => {
    const points = windSeries([day(flat(30), flat(64), 2)]).slice(23);
    expect(judgeWindSeries(points, 'mph', 'Europe/London')).toEqual([
      {
        time: at(23),
        date: '2026-10-16',
        hour: 0,
        mean: 19,
        gust: 40,
        gust2h: 40,
        band: 'verywindy',
        still: false,
      },
    ]);
    expect(judgeWindSeries(points, 'kmh', 'UTC')[0]).toMatchObject({
      date: DATE,
      hour: 23,
      mean: 30,
      gust: 64,
    });
  });
});

/** Still air at four models of six, the other two at a fresh breeze. */
const OUTLIERS = day(each([3, 3, 3, 3, 25, 25]), each([8, 8, 8, 8, 35, 35]));

describe('computeWindDay: where the wind blows from', () => {
  // Every model at 20km/h, gusts strongest at 3pm; the wind veers 5° an hour from the south, the
  // models either side of each other.
  const SPREAD = [0, 5, -5, 10, -10, 0];
  const veering = withDir(day(flat(20), peaked([40, 44, 48, 50, 52, 56])), (h, i) => {
    return 180 + 5 * h + SPREAD[i]!;
  });

  it('names it at the windiest hour, for all the models and for each', () => {
    const c = computeWindDay(veering)!;
    expect([c.band, c.peakHour, c.direction]).toEqual(['windy', 15, 255]);
    expect(c.models.map((m) => m.direction)).toEqual([255, 260, 250, 265, 245, 255]);
    // The rest of today has the same peak.
    expect(computeWindDay(veering, { from: at(10.5) })!.direction).toBe(255);
    const f = formatWindDay(c, 'mph');
    expect(f.direction).toEqual({ degrees: 255, compass: 'W', words: 'from the west' });
    expect(f.models[3]!.direction).toEqual({
      degrees: 265,
      compass: 'W',
      words: 'from the west',
    });
    expect(f.detail).toBe(
      'Gusts up to 30mph from the west, wind up to 12mph. Windiest around 3pm.',
    );
  });

  it('takes the window’s hours without a peak: a calm day, or a single hour', () => {
    // Light winds veering 2° an hour: 274° at 7am to 300° at 8pm, 287° on the whole.
    const light = computeWindDay(withDir(day(flat(12), flat(24)), (h) => 260 + 2 * h))!;
    expect([light.band, light.peakHour, light.direction]).toEqual(['calm', null, 287]);
    expect(windDayDetail(light, 'mph')).toBe('Light winds from the west, gusts up to 15mph.');
    // From 8pm the window is one hour, with no peak to name.
    const last = computeWindDay(veering, { from: at(20.5) })!;
    expect([last.window, last.peakHour, last.direction]).toEqual([{ from: 20, to: 21 }, null, 280]);
  });

  it('leaves it out when it is variable', () => {
    // Half the models from the east and half from the west at the peak.
    const split = computeWindDay(
      withDir(day(flat(20), peaked([40, 44, 48, 50, 52, 56])), (h, i) => (i % 2 ? 90 : 270)),
    )!;
    expect(split.direction).toBeNull();
    // Each model on its own still has one.
    expect(split.models.map((m) => m.direction)).toEqual([270, 90, 270, 90, 270, 90]);
    expect(windDayDetail(split, 'mph')).toBe(
      'Gusts up to 30mph, wind up to 12mph. Windiest around 3pm.',
    );
    const f = formatWindDay(split, 'kmh');
    expect(f.direction).toBeNull();
    expect(f.models[0]!.direction).toMatchObject({ compass: 'W' });
    // Still air has no direction either.
    const still = computeWindDay(withDir(day(flat(3), flat(10)), () => 200))!;
    expect([still.still, still.direction]).toEqual([true, null]);
    expect(windDayDetail(still, 'mph')).toBe('Light winds, gusts up to 6mph.');
    // Nor when only two strong models of six blow: the day is judged on the median wind.
    const outliers = computeWindDay(withDir(OUTLIERS, () => 270))!;
    expect([outliers.still, outliers.direction]).toEqual([true, null]);
    expect(outliers.models.map((m) => m.direction)).toEqual([null, null, null, null, 270, 270]);
    expect(windDayDetail(outliers, 'mph')).toBe('Light winds, gusts up to 5mph.');
  });

  it('has none without directions in the forecast, or without hours', () => {
    const c = computeWindDay(day(flat(20), peaked([40, 44, 48, 50, 52, 56])))!;
    expect(c).not.toHaveProperty('direction');
    expect(c.models[0]).not.toHaveProperty('direction');
    const f = formatWindDay(c, 'mph');
    expect(f).not.toHaveProperty('direction');
    expect(f.models[0]).not.toHaveProperty('direction');
    // A later day the server keeps only each model's daily values for.
    const slim = computeWindDay({ ...veering, hourly: [] })!;
    expect(slim.band).toBe('windy');
    expect(slim).not.toHaveProperty('direction');
    // A model whose direction is missing for the hour has none of its own.
    const gappy = computeWindDay(
      withDir(day(flat(20), peaked([40, 44, 48, 50, 52, 56])), (h, i) => (i === 0 ? null : 200)),
    )!;
    expect(gappy.direction).toBe(200);
    expect(gappy.models[0]).not.toHaveProperty('direction');
    expect(gappy.models[1]!.direction).toBe(200);
  });
});

describe('windSeries: where the wind blows from', () => {
  it('judges each hour across the models, and sends it in either unit', () => {
    const d = withDir(day(flat(20), flat(40), 3), (h, i) => {
      if (h === 1) return [90, 270, 180][i]!;
      if (h === 2) return i === 0 ? 300 : null;
      if (h === 3) return null;
      return 350 + 10 * i;
    });
    const points = windSeries([d]);
    expect(points.slice(0, 5).map((p) => p.dir)).toEqual([0, null, 300, undefined, 0]);
    expect(points[3]).not.toHaveProperty('dir');
    // Light air has none.
    const light = windSeries([withDir(day(flat(5), flat(12), 2), () => 90)]);
    expect(light[0]!.dir).toBeNull();
    const outliers = windSeries([withDir(OUTLIERS, () => 90)]);
    expect([outliers[0]!.mean, outliers[0]!.still, outliers[0]!.dir]).toEqual([3, true, null]);
    // Degrees are the same whatever the speed unit.
    expect(judgeWindSeries(points.slice(0, 2), 'mph', 'UTC').map((p) => p.dir)).toEqual([0, null]);
    expect(judgeWindSeries(points.slice(0, 1), 'kmh', 'UTC')[0]!.dir).toBe(0);
    expect(judgeWindSeries(points.slice(3, 4), 'kmh', 'UTC')[0]).not.toHaveProperty('dir');
  });
});
