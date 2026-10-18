/**
 * "Is it windy today?": the rest of today, or a whole day's waking hours (tomorrow, the days of
 * the week), and the judged hourly series the Now view picks from. Server and preview only: the
 * browser runs windNow.ts on the series. Every model gives its strongest mean wind and gust over
 * the window; the window's are the medians of those, in whole km/h. Where the wind blows from is
 * judged at the window's windiest hour (windDirection.ts).
 */
import { BLEND, WIND, type WindBand } from './config';
import { normalForDate, parseDate, type MonthlyNormals } from './climate';
import type { HourTemps, ModelDay } from './blend';
import type { DayData } from './compute';
import {
  COPY,
  STILL_VERDICTS,
  WIND_ANSWERS,
  WIND_DAY_VERDICTS,
  formatHour,
  lightWindsLine,
  monthName,
  windAgreementLine,
  windDayLine,
  windNormalLine,
  windStripSummary,
  windiestAroundLine,
  type WindNormal,
} from './copy';
import { localDateTime } from './dates';
import { HOUR, median, niceCeil } from './rain';
import { isFiniteNumber, mean } from './stats';
import {
  directionField,
  directionWords,
  gustRange,
  isStill,
  toWindUnits,
  windBand,
  windText,
  windValue,
} from './wind';
import { directionOver } from './windDirection';
import type { ApiWindDay, ApiWindPoint, WindUnit } from './types';

/** Normal wind (NASA POWER WS10M) is in m/s; everything here is km/h. */
const KMH_PER_MS = 3.6;

/** A model's wind and gust in one hour, or null unless it has both. */
function both(h: HourTemps, i: number): { mean: number; gust: number } | null {
  const mean = h.wind?.[i];
  const gust = h.gust?.[i];
  return isFiniteNumber(mean) && isFiniteNumber(gust) ? { mean, gust } : null;
}

/** Whether a local hour is in a whole day's waking hours (WIND.day). */
const waking = (hour: number): boolean => hour >= WIND.day.fromHour && hour < WIND.day.toHour;

/**
 * A model's wind for one local day, km/h at full precision, as the providers keep it: its
 * strongest mean wind and gust over the waking hours, both null unless it has both for every one
 * of those hours (a model that ends mid-morning drops out of the day, as for highs); and the mean
 * of its 24 hourly wind speeds, null unless it has them all.
 */
export function dailyWind(
  hours: readonly HourTemps[],
  index: number,
): { wind: number | null; gust: number | null; windMean: number | null } {
  const day = hours.filter((h) => waking(h.hour));
  const values = day.map((h) => both(h, index));
  const covered =
    day.length === WIND.day.toHour - WIND.day.fromHour && values.every((v) => v !== null);
  const speeds = hours.map((h) => h.wind?.[index]);
  return {
    wind: covered ? Math.max(...values.map((v) => v!.mean)) : null,
    gust: covered ? Math.max(...values.map((v) => v!.gust)) : null,
    windMean: hours.length >= 24 && speeds.every(isFiniteNumber) ? mean(speeds) : null,
  };
}

// ---- Today and tomorrow ----------------------------------------------------------

/** One model's strongest mean wind and gust over a window, whole km/h. */
export interface WindModelPeak {
  id: string;
  name: string;
  mean: number;
  gust: number;
  /** The model's own band, from its two peaks. */
  band: WindBand;
  /** Its 24-hour mean wind for the calendar day, km/h, or null (ModelDay `windMean`). */
  dayMean: number | null;
  /**
   * Where its wind blows from, judged as the window's `direction` is but from this model alone:
   * whole degrees, null when variable, absent without directions.
   */
  direction?: number | null;
}

/** One window's result in whole km/h, before formatting. */
export interface WindDayComputation {
  date: string;
  /** Today: the moment judged from; a whole day: the start of its waking hours. Epoch ms. */
  from: number;
  /** True for the rest of today, false for a whole day's waking hours. */
  partial: boolean;
  /** The local hours judged, start inclusive and end exclusive (24 is midnight). */
  window: { from: number; to: number };
  /** Models with both values for every hour of the window. */
  models: WindModelPeak[];
  /** The medians of the models' strongest mean wind and gust. */
  mean: number;
  gust: number;
  band: WindBand;
  /** Calm and still air (WIND.still). */
  still: boolean;
  /** Models whose own band is the window's. */
  agree: number;
  /**
   * The local hour whose median gust is strongest (the earlier on a tie), or null for a calm
   * window, a one-hour window, or a day without hours.
   */
  peakHour: number | null;
  /**
   * Where the wind blows from at the peak hour, or without one across the window's hours, all
   * models together (directionOver): whole degrees, or null when variable. Absent without
   * directions for those hours (forecasts recorded without them, and days without hours).
   */
  direction?: number | null;
  /** The calendar day's 24-hour mean wind (median of the models'), km/h, or null. */
  dayMean: number | null;
  /** Normal mean wind for the date, km/h, or null without normals. */
  normal: number | null;
}

export interface WindDayOptions {
  /** Judge the rest of the day from this moment (epoch ms) rather than the whole day. */
  from?: number;
  /** Monthly normal wind at 10m, m/s, January first (NASA POWER WS10M). */
  normals?: MonthlyNormals | null;
}

/**
 * One hour judged across the models with both values, as a window is: each model's values in
 * whole km/h, then the medians of those, rounded; null without any model.
 */
function judgeHour(h: HourTemps): { mean: number; gust: number } | null {
  const values = (h.wind ?? []).map((_, i) => both(h, i)).filter((v) => v !== null);
  if (values.length === 0) return null;
  return {
    mean: Math.round(median(values.map((v) => Math.round(v.mean)))),
    gust: Math.round(median(values.map((v) => Math.round(v.gust)))),
  };
}

/** A model's peaks over a window, rounded to whole km/h (as shown), and its own band. */
function peak(m: ModelDay, mean: number, gust: number): WindModelPeak {
  const wind = Math.round(mean);
  const strongest = Math.round(gust);
  return {
    id: m.id,
    name: m.name,
    mean: wind,
    gust: strongest,
    band: windBand(wind, strongest),
    dayMean: m.windMean ?? null,
  };
}

/**
 * The rest of today (with `opts.from`, from the hourly values) or a whole day's waking hours
 * (from each model's daily values, which outlast the hours the server keeps). Each model's peaks
 * are rounded to whole km/h, as they are shown, and the window's are the medians of those,
 * rounded. Null when no model has both values for the whole window.
 *
 * The rest of today runs from the start of the current hour to 9pm, or to midnight from 9pm on,
 * so a windy night still to come counts. The current hour counts in full (peaks are not sums), so
 * every model's peak is at least its value now and Today is never calmer than Now.
 */
export function computeWindDay(day: DayData, opts: WindDayOptions = {}): WindDayComputation | null {
  const partial = opts.from !== undefined;
  const fromTime = opts.from ?? Number.NEGATIVE_INFINITY;
  let hours: HourTemps[];
  let window: { from: number; to: number };
  // Each model with both values for the whole window, with its place in the hourly values.
  let peaks: Array<{ index: number; model: WindModelPeak }>;
  if (partial) {
    const ahead = day.hourly.filter((h) => h.time + HOUR > fromTime);
    const first = ahead[0];
    if (!first) return null;
    const to = first.hour >= WIND.day.toHour ? 24 : WIND.day.toHour;
    hours = ahead.filter((h) => h.hour < to);
    window = { from: first.hour, to };
    peaks = day.models.flatMap((m, index) => {
      const values = hours.map((h) => both(h, index));
      if (!values.every((v) => v !== null)) return [];
      const model = peak(
        m,
        Math.max(...values.map((v) => v.mean)),
        Math.max(...values.map((v) => v.gust)),
      );
      return [{ index, model }];
    });
  } else {
    hours = day.hourly.filter((h) => waking(h.hour));
    window = { from: WIND.day.fromHour, to: WIND.day.toHour };
    peaks = day.models.flatMap((m, index) =>
      isFiniteNumber(m.wind) && isFiniteNumber(m.gust)
        ? [{ index, model: peak(m, m.wind, m.gust) }]
        : [],
    );
  }
  const models = peaks.map((p) => p.model);
  if (models.length === 0) return null;

  const mean = Math.round(median(models.map((m) => m.mean)));
  const gust = Math.round(median(models.map((m) => m.gust)));
  const band = windBand(mean, gust);
  let peakAt: HourTemps | null = null;
  if (band !== 'calm' && hours.length > 1) {
    let best = Number.NEGATIVE_INFINITY;
    for (const h of hours) {
      const g = judgeHour(h)?.gust;
      if (g !== undefined && g > best) {
        best = g;
        peakAt = h;
      }
    }
  }
  // Where the wind blows from when it is strongest, or across the window when there is no peak
  // (a calm window, or a single hour).
  const directionHours = peakAt ? [peakAt] : hours;
  const direction = directionOver(directionHours);
  for (const { index, model } of peaks) {
    const own = directionOver(directionHours, index);
    if (own !== undefined) model.direction = own;
  }
  const means = day.models.map((m) => m.windMean).filter(isFiniteNumber);
  const start = day.hourly.find((h) => h.hour === WIND.day.fromHour)?.time;
  return {
    date: day.date,
    from: partial ? fromTime : (start ?? parseDate(day.date) + WIND.day.fromHour * HOUR),
    partial,
    window,
    models,
    mean,
    gust,
    band,
    still: band === 'calm' && isStill(mean, gust),
    agree: models.filter((m) => m.band === band).length,
    peakHour: peakAt?.hour ?? null,
    ...(direction === undefined ? {} : { direction }),
    dayMean: means.length >= BLEND.minModels ? median(means) : null,
    normal: opts.normals
      ? normalForDate(opts.normals, day.date) * KMH_PER_MS * WIND.normals.scale
      : null,
  };
}

/**
 * A day's or week's 24-hour mean wind against normal (km/h), by the day's or the week's ratios
 * (WIND.normals): windier, calmer, or usual in between.
 */
export function windNormal(
  value: number,
  normal: number,
  ratios: { windierRatio: number; calmerRatio: number; minDifference: number },
): WindNormal {
  if (value >= ratios.windierRatio * normal && value - normal >= ratios.minDifference) {
    return 'windier';
  }
  if (value <= ratios.calmerRatio * normal && normal - value >= ratios.minDifference) {
    return 'calmer';
  }
  return 'usual';
}

export function windDayVerdict(c: WindDayComputation): string {
  return c.still ? STILL_VERDICTS.day : WIND_DAY_VERDICTS[c.band];
}

/**
 * The detail line: the gusts with where they come from, and the wind ("Light winds from the
 * west, gusts up to 15mph." when calm; no direction when it is variable), when it is windiest,
 * and a day that is windier or calmer than usual says so (a usual one says nothing).
 */
export function windDayDetail(c: WindDayComputation, unit: WindUnit): string {
  const text = (kmh: number) => windText(toWindUnits(kmh, unit), unit);
  const from = directionWords(c.direction);
  const parts = [
    c.band === 'calm'
      ? lightWindsLine(text(c.gust), from)
      : windDayLine(text(c.gust), text(c.mean), from),
  ];
  if (c.peakHour !== null) parts.push(windiestAroundLine(c.peakHour));
  if (c.dayMean !== null && c.normal !== null) {
    const kind = windNormal(c.dayMean, c.normal, WIND.normals.day);
    if (kind !== 'usual') parts.push(windNormalLine(kind, monthName(c.date)));
  }
  return parts.join(' ');
}

/** The API's wind day: display units and every copy string. */
export function formatWindDay(c: WindDayComputation, unit: WindUnit): ApiWindDay {
  const shown = (kmh: number) => toWindUnits(kmh, unit);
  const models = c.models.map((m) => ({
    id: m.id,
    name: m.name,
    gust: shown(m.gust),
    mean: shown(m.mean),
    value: windValue(m.gust, unit),
    band: m.band,
    agrees: m.band === c.band,
    ...directionField(m.direction),
  }));
  const range = gustRange(c.band);
  const zone = { from: shown(range.from), to: range.to === null ? null : shown(range.to) };
  const top = Math.max(...models.map((m) => m.value));
  const gusts = models.map((m) => m.gust);
  const confidence = c.models.length >= BLEND.minModels ? 'good' : 'limited';
  return {
    date: c.date,
    from: new Date(c.from).toISOString(),
    partial: c.partial,
    window: { ...c.window },
    band: c.band,
    answer: WIND_ANSWERS[c.band],
    verdict: windDayVerdict(c),
    detail: windDayDetail(c, unit),
    still: c.still,
    gust: shown(c.gust),
    mean: shown(c.mean),
    peak: c.peakHour === null ? null : formatHour(c.peakHour),
    ...directionField(c.direction),
    agree: c.agree,
    total: c.models.length,
    confidence,
    zone,
    scale: {
      min: 0,
      max: niceCeil(Math.max(top * 1.15, WIND.scaleFloor[unit], zone.to ?? 0)),
    },
    models,
    month: monthName(c.date),
    agreementText: windAgreementLine(c.agree, c.models.length, c.band),
    limitedText: confidence === 'limited' ? COPY.limited : null,
    stripSummary: windStripSummary({
      min: windText(Math.min(...gusts), unit),
      max: windText(Math.max(...gusts), unit),
      agree: c.agree,
      total: c.models.length,
      band: c.band,
    }),
    dayMean: c.dayMean === null ? null : shown(c.dayMean),
    normal: c.normal === null ? null : shown(c.normal),
  };
}

// ---- The hourly series (for Now) --------------------------------------------------

/** One forecast hour of wind across the models, whole km/h. */
export interface WindSeriesPoint {
  /** Start of the hour, epoch milliseconds (UTC). */
  time: number;
  /** The median mean wind at the hour's start, and the median strongest gust during it. */
  mean: number;
  gust: number;
  /** The stronger of this hour's gust and the next hour's (when it follows directly). */
  gust2h: number;
  band: WindBand;
  still: boolean;
  /**
   * Where the wind blows from at the hour's start, every model with a direction together:
   * whole degrees, or null when variable. Absent without directions.
   */
  dir?: number | null;
}

/**
 * Every forecast hour with at least one model with both values, in order, each judged on its
 * medians in whole km/h, as rainSeries does for rain, and on where its wind blows from.
 */
export function windSeries(days: readonly DayData[]): WindSeriesPoint[] {
  const points: WindSeriesPoint[] = [];
  for (const h of days.flatMap((d) => d.hourly)) {
    const v = judgeHour(h);
    if (!v) continue;
    const band = windBand(v.mean, v.gust);
    const dir = directionOver([h]);
    points.push({
      time: h.time,
      mean: v.mean,
      gust: v.gust,
      gust2h: v.gust,
      band,
      still: band === 'calm' && isStill(v.mean, v.gust),
      ...(dir === undefined ? {} : { dir }),
    });
  }
  points.forEach((p, j) => {
    const next = points[j + 1];
    if (next?.time === p.time + HOUR) p.gust2h = Math.max(p.gust, next.gust);
  });
  return points;
}

/** The series as the API sends it: display units, local date and hour. */
export function judgeWindSeries(
  points: readonly WindSeriesPoint[],
  unit: WindUnit,
  timezone: string,
): ApiWindPoint[] {
  return points.map((p) => {
    const local = localDateTime(timezone, new Date(p.time));
    return {
      time: p.time,
      date: local.date,
      hour: Math.floor(local.hours),
      mean: toWindUnits(p.mean, unit),
      gust: toWindUnits(p.gust, unit),
      gust2h: toWindUnits(p.gust2h, unit),
      band: p.band,
      still: p.still,
      // Degrees, the same in either unit.
      ...(p.dir === undefined ? {} : { dir: p.dir }),
    };
  });
}
