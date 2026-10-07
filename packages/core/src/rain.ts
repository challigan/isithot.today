/**
 * "Is it wet?": judging rain for the rest of today, a whole day, the hour and the week. Every
 * model gives its own total for a window; the share of models with at least the window's wet
 * amount is the chance of rain and the median total is the amount (RAIN in config.ts).
 */
import { BLEND, NOW, RAIN, RAIN_BANDS, WEEK, type RainBand } from './config';
import { normalForDate, parseDate, type MonthlyNormals } from './climate';
import type { HourTemps } from './blend';
import type { DayData } from './compute';
import {
  COPY,
  RAIN_ANSWERS,
  RAIN_BAND_LABELS,
  RAIN_COPY,
  RAIN_NOW_PHRASES,
  RAIN_NOW_VERDICTS,
  RAIN_VERDICTS,
  RAIN_WEEK_ANSWERS,
  RAIN_WEEK_VERDICTS,
  SNOW_LABEL,
  SNOW_VERDICTS,
  WEEKDAYS,
  aroundLine,
  betweenLine,
  easingLine,
  formatHour,
  monthName,
  mostlyDryLine,
  rainAgreementLine,
  rainAmountLine,
  rainDaysLine,
  rainFromLine,
  rainNormalLine,
  rainStripSummary,
  rainWeekLine,
  showersFromLine,
  upToLine,
  wetWeekLine,
  whenDays,
  type RainNormal,
} from './copy';
import { localDateTime } from './dates';
import { isFiniteNumber, trimmedMean } from './stats';
import { round1, roundTemp, type Units } from './units';
import { dayLabel, listDays } from './week';
import type { ApiRainDay, ApiRainNow, ApiRainPoint, ApiRainWeek, RainUnit } from './types';

const HOUR = 3_600_000;
const MM_PER_INCH = 25.4;
/** Sums of hourly amounts are compared with a little slack, so 0.1 + 0.2 still reaches 0.3. */
const EPSILON = 1e-9;

// ---- Units --------------------------------------------------------------------

/** Millimetres with °C, inches with °F. */
export function rainUnit(units: Units): RainUnit {
  return units === 'f' ? 'in' : 'mm';
}

/** Converts millimetres into the rain unit, at full precision. */
export function toRainUnits(mm: number, unit: RainUnit): number {
  return unit === 'in' ? mm / MM_PER_INCH : mm;
}

/** Two decimals, never -0. */
export function round2(value: number): number {
  const r = Math.round(value * 100) / 100;
  return r === 0 ? 0 : r;
}

/**
 * Rounds an amount in `unit` for display, never returning -0: millimetres to one decimal under
 * 1 and whole from 1; inches to two decimals under 1 and one decimal from 1.
 */
export function roundRain(value: number, unit: RainUnit): number {
  if (unit === 'in') return value < 1 ? round2(value) : round1(value);
  return value < 1 ? round1(value) : roundTemp(value);
}

/** "6mm", "0.4mm", "0.12in", "1.2in". Rounds first, so already rounded amounts are unchanged. */
export function rainText(amount: number, unit: RainUnit): string {
  return `${roundRain(amount, unit)}${unit}`;
}

/** The smallest 1, 2, 2.5 or 5 × 10^k at or above a positive value (the strip's scale). */
export function niceCeil(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= value * (1 - EPSILON))!;
  return Number((step * power).toPrecision(12));
}

// ---- Judging a window -----------------------------------------------------------

/** Rain amounts for one window, mm. */
export interface RainThresholds {
  wet: number;
  spots: number;
  heavy: number;
  drenched: number;
}

/**
 * Thresholds for a window of `hours` hours: the hourly values times the length, capped at the
 * day values, so one hour uses the hourly values and long windows the day values.
 */
export function windowThresholds(hours: number): RainThresholds {
  return {
    wet: Math.min(RAIN.day.wet, RAIN.hour.wet * hours),
    spots: Math.min(RAIN.day.spots, RAIN.hour.spots * hours),
    heavy: Math.min(RAIN.day.heavy, RAIN.hour.heavy * hours),
    drenched: Math.min(RAIN.day.drenched, RAIN.hour.drenched * hours),
  };
}

const atLeast = (value: number, min: number): boolean => value >= min - EPSILON;
const rank = (band: RainBand): number => RAIN_BANDS.indexOf(band);
const isRain = (band: RainBand): boolean => rank(band) >= rank('rain');

/** The middle value, or the mean of the middle two. Callers guarantee at least one value. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Share of the values at or above `min`. */
function shareAtLeast(values: readonly number[], min: number): number {
  return values.filter((v) => atLeast(v, min)).length / values.length;
}

/**
 * The band for the models' totals over one window: likely rain is banded by the median amount,
 * a fair chance is showers, and otherwise a quarter of the models with spots is "spots".
 */
export function rainBand(totals: readonly number[], t: RainThresholds): RainBand {
  const p = shareAtLeast(totals, t.wet);
  if (p >= RAIN.likelyFrom) {
    const m = median(totals);
    if (atLeast(m, t.drenched)) return 'drenched';
    return atLeast(m, t.heavy) ? 'heavy' : 'rain';
  }
  if (p >= RAIN.maybeFrom) return 'showers';
  return shareAtLeast(totals, t.spots) >= RAIN.maybeFrom ? 'spots' : 'dry';
}

export type SnowAmount = 'none' | 'some' | 'most';

function snowAmount(share: number): SnowAmount {
  if (share >= RAIN.snowFrom) return 'most';
  return share >= RAIN.snowSomeFrom ? 'some' : 'none';
}

// ---- Today and tomorrow ----------------------------------------------------------

/** One model's rain over a window, mm. */
export interface RainModelTotal {
  id: string;
  name: string;
  total: number;
  /** The part of `total` that falls at or below the snow line. */
  snow: number;
}

/** The share of models with rain in one local hour of the window. */
export interface RainHourChance {
  /** Local hour of day, 0–23. */
  hour: number;
  chance: number;
}

/** One window's result in mm at full precision, before formatting. */
export interface RainDayComputation {
  date: string;
  /**
   * Start of the window, epoch milliseconds: the request time, or local midnight (UTC midnight
   * of the date for a day without hours, as the server keeps hours for the first days only).
   */
  from: number;
  /** True for the rest of the day from `from`, false for the whole day. */
  partial: boolean;
  /** The window's length in hours, the current hour counting what is left of it (24 for a day). */
  hours: number;
  thresholds: RainThresholds;
  /** Models with a value for every hour of the window. */
  models: RainModelTotal[];
  /** Models expecting rain: a total of at least `thresholds.wet`. */
  wet: number;
  /** wet / models, 0–1. */
  chance: number;
  /** The consensus amount: the median of the totals. */
  amount: number;
  band: RainBand;
  /** The share of all the models' rain that falls as snow, 0 without rain. */
  snowShare: number;
  snow: SnowAmount;
  /** Each hour of the window with data, in order (empty without hourly data). */
  hourly: RainHourChance[];
  /** The likely hours, end exclusive (24 is midnight), or null. */
  likely: { from: number; to: number } | null;
}

export interface RainDayOptions {
  /** Judge the rest of the day from this moment (epoch ms) rather than the whole day. */
  from?: number;
}

const isSnow = (temp: number | null | undefined): boolean =>
  isFiniteNumber(temp) && temp <= RAIN.snowAtOrBelowC;

/**
 * The rest of today (with `opts.from`, from the hourly values; the current hour weighted by
 * the minutes left) or a whole day (from each model's daily total). Null when no model has
 * rain for the whole window.
 */
export function computeRainDay(day: DayData, opts: RainDayOptions = {}): RainDayComputation | null {
  const partial = opts.from !== undefined;
  const fromTime = opts.from ?? Number.NEGATIVE_INFINITY;
  const window: { h: HourTemps; weight: number }[] = [];
  for (const h of day.hourly) {
    if (h.time >= fromTime) {
      window.push({ h, weight: 1 });
    } else if (h.time + HOUR > fromTime) {
      // The current hour counts the minutes left in it.
      window.push({ h, weight: (60 - Math.floor((fromTime - h.time) / 60_000)) / 60 });
    }
  }

  let models: RainModelTotal[];
  let hours = 24;
  let thresholds: RainThresholds = RAIN.day;
  if (partial) {
    if (window.length === 0) return null;
    hours = window.reduce((sum, w) => sum + w.weight, 0);
    thresholds = windowThresholds(hours);
    models = day.models.flatMap((m, i) => {
      let total = 0;
      let snow = 0;
      for (const { h, weight } of window) {
        const rain = h.rain?.[i];
        if (!isFiniteNumber(rain)) return [];
        total += rain * weight;
        if (isSnow(h.temps[i])) snow += rain * weight;
      }
      return [{ id: m.id, name: m.name, total, snow }];
    });
  } else {
    models = day.models.flatMap((m) =>
      isFiniteNumber(m.rain)
        ? [{ id: m.id, name: m.name, total: m.rain, snow: isFiniteNumber(m.snow) ? m.snow : 0 }]
        : [],
    );
  }
  if (models.length === 0) return null;

  const totals = models.map((m) => m.total);
  const wet = totals.filter((v) => atLeast(v, thresholds.wet)).length;
  const rainSum = totals.reduce((a, b) => a + b, 0);
  const snowShare = rainSum > 0 ? models.reduce((a, m) => a + m.snow, 0) / rainSum : 0;

  const hourly: RainHourChance[] = [];
  for (const { h } of window) {
    const values = (h.rain ?? []).filter(isFiniteNumber);
    if (values.length > 0) {
      hourly.push({ hour: h.hour, chance: shareAtLeast(values, RAIN.hour.wet) });
    }
  }
  const likelyHours = hourly.filter((c) => c.chance >= RAIN.hourLikely);

  return {
    date: day.date,
    from: partial ? fromTime : (day.hourly[0]?.time ?? parseDate(day.date)),
    partial,
    hours,
    thresholds,
    models,
    wet,
    chance: wet / models.length,
    amount: median(totals),
    band: rainBand(totals, thresholds),
    snowShare,
    snow: snowAmount(snowShare),
    hourly,
    likely:
      likelyHours.length > 0
        ? { from: likelyHours[0]!.hour, to: likelyHours.at(-1)!.hour + 1 }
        : null,
  };
}

/** When the rain is most likely, for showers and wetter. */
export function timingLine(c: RainDayComputation): string {
  const likely = c.likely;
  if (!likely) {
    let best: RainHourChance | undefined;
    for (const h of c.hourly) if (!best || h.chance > best.chance) best = h;
    return best && best.chance >= RAIN.hourPossible ? aroundLine(best.hour) : RAIN_COPY.onAndOff;
  }
  const firstHour = c.hourly[0]!.hour;
  if (likely.from === firstHour && likely.to === 24) {
    const every = c.hourly.every((h) => h.chance >= RAIN.hourLikely);
    if (c.partial) return every ? RAIN_COPY.restOfDay : RAIN_COPY.onAndOffRestOfDay;
    return every ? RAIN_COPY.allDay : RAIN_COPY.onAndOffAllDay;
  }
  // Raining at the start of the rest of today.
  if (c.partial && likely.from === firstHour) return easingLine(likely.to);
  if (likely.to - likely.from === 1) return aroundLine(likely.from);
  return betweenLine(likely.from, likely.to);
}

/** The detail line: how much (or how dry), when, and whether it may be snow. */
export function rainDayDetail(c: RainDayComputation, unit: RainUnit): string {
  const text = (mm: number) => rainText(toRainUnits(mm, unit), unit);
  if (c.band === 'dry') {
    if (c.partial) return RAIN_COPY.dryRestOfDay;
    return c.models.every((m) => m.total < c.thresholds.spots - EPSILON)
      ? RAIN_COPY.dryEveryForecast
      : RAIN_COPY.dryMostForecasts;
  }
  if (c.band === 'spots') return RAIN_COPY.spots;
  const parts: string[] = [];
  if (c.band === 'showers') {
    const totals = c.models.map((m) => m.total).sort((a, b) => b - a);
    const one = c.wet === 1;
    parts.push(upToLine(text(one ? totals[0]! : totals[1]!), one));
  } else {
    parts.push(c.snow === 'most' ? RAIN_COPY.asSnow : rainAmountLine(text(c.amount), c.partial));
  }
  parts.push(timingLine(c));
  if (isRain(c.band) && c.snow === 'some') parts.push(RAIN_COPY.someSnow);
  return parts.join(' ');
}

const snowy = (band: RainBand, snow: boolean): boolean => snow && isRain(band);

export function rainDayVerdict(c: RainDayComputation): string {
  if (!snowy(c.band, c.snow === 'most')) return RAIN_VERDICTS[c.band];
  return c.band === 'rain' ? SNOW_VERDICTS.day : SNOW_VERDICTS.heavy;
}

/** The API's rain day: display units and every copy string. */
export function formatRainDay(c: RainDayComputation, units: Units): ApiRainDay {
  const unit = rainUnit(units);
  const answer = isRain(c.band) ? 'yes' : c.band === 'showers' ? 'maybe' : 'no';
  const models = c.models.map((m) => {
    const shown = toRainUnits(m.total, unit);
    const expectsRain = atLeast(m.total, c.thresholds.wet);
    return {
      id: m.id,
      name: m.name,
      amount: roundRain(shown, unit),
      value: round2(shown),
      expectsRain,
      agrees: answer === 'yes' ? expectsRain : answer === 'no' ? !expectsRain : true,
    };
  });
  const amounts = models.map((m) => m.amount);
  const top = Math.max(...models.map((m) => m.value));
  const confidence = c.models.length >= BLEND.minModels ? 'good' : 'limited';
  return {
    date: c.date,
    from: new Date(c.from).toISOString(),
    partial: c.partial,
    band: c.band,
    answer: RAIN_ANSWERS[c.band],
    verdict: rainDayVerdict(c),
    detail: rainDayDetail(c, unit),
    amount: roundRain(toRainUnits(c.amount, unit), unit),
    chance: round2(c.chance),
    wet: c.wet,
    total: c.models.length,
    confidence,
    threshold: round2(toRainUnits(c.thresholds.wet, unit)),
    snow: c.snow,
    likely: c.likely ? { ...c.likely } : null,
    scale: { min: 0, max: niceCeil(Math.max(top * 1.15, RAIN.scaleFloor[unit])) },
    models,
    month: monthName(c.date),
    agreementText: rainAgreementLine(c.wet, c.models.length),
    limitedText: confidence === 'limited' ? COPY.limited : null,
    stripSummary: rainStripSummary({
      min: rainText(Math.min(...amounts), unit),
      max: rainText(Math.max(...amounts), unit),
      wet: c.wet,
      total: c.models.length,
    }),
  };
}

// ---- Now ------------------------------------------------------------------------

/** One forecast hour of rain across the models, mm. */
export interface RainSeriesPoint {
  /** Start of the hour, epoch milliseconds (UTC). */
  time: number;
  /** The median of the models' rain in the hour. */
  amount: number;
  /** Share of models with at least the hourly wet amount. */
  chance: number;
  /** Share of models with at least RAIN.blockWet over this hour and the next. */
  chance2h: number;
  band: RainBand;
  /** The blended temperature is at or below the snow line. */
  snow: boolean;
}

/**
 * Every forecast hour with rain data, in order, each judged with the hourly thresholds. A
 * model's two-hour block adds the next hour when the model has it.
 */
export function rainSeries(days: readonly DayData[]): RainSeriesPoint[] {
  const thresholds = windowThresholds(1);
  const hours = days.flatMap((d) => d.hourly);
  const points: RainSeriesPoint[] = [];
  hours.forEach((h, j) => {
    const next = hours[j + 1]?.time === h.time + HOUR ? hours[j + 1] : undefined;
    const values: number[] = [];
    const blocks: number[] = [];
    (h.rain ?? []).forEach((rain, i) => {
      if (!isFiniteNumber(rain)) return;
      const after = next?.rain?.[i];
      values.push(rain);
      blocks.push(rain + (isFiniteNumber(after) ? after : 0));
    });
    if (values.length === 0) return;
    const temps = h.temps.filter(isFiniteNumber);
    points.push({
      time: h.time,
      amount: median(values),
      chance: shareAtLeast(values, RAIN.hour.wet),
      chance2h: shareAtLeast(blocks, RAIN.blockWet),
      band: rainBand(values, thresholds),
      snow: temps.length > 0 && trimmedMean(temps, BLEND.trimFrom) <= RAIN.snowAtOrBelowC,
    });
  });
  return points;
}

/** The series as the API sends it: display units, two decimals, local date and hour. */
export function judgeRainSeries(
  points: readonly RainSeriesPoint[],
  units: Units,
  timezone: string,
): ApiRainPoint[] {
  const unit = rainUnit(units);
  return points.map((p) => {
    const local = localDateTime(timezone, new Date(p.time));
    return {
      time: p.time,
      date: local.date,
      hour: Math.floor(local.hours),
      amount: round2(toRainUnits(p.amount, unit)),
      chance: round2(p.chance),
      chance2h: round2(p.chance2h),
      band: p.band,
      snow: p.snow,
    };
  });
}

/** The rain "now" view, before formatting. */
export interface RainNowComputation {
  /** The moment the values are for, epoch milliseconds. */
  time: number;
  /** The hour containing the moment. */
  current: ApiRainPoint;
  /** Judged hours from the one before the current hour to a day after the moment. */
  series: ApiRainPoint[];
}

/**
 * The hour containing a moment, from the judged series (rain is per hour, so nothing is
 * interpolated). Null when the series does not cover the moment. The server and the browser
 * run this on the same numbers.
 */
export function computeRainNow(
  series: readonly ApiRainPoint[],
  time: number,
): RainNowComputation | null {
  const first = series[0];
  if (!first) return null;
  let i = -1;
  while (i + 1 < series.length && series[i + 1]!.time <= time) i++;
  // A clock a little behind the server's lands before the first hour: use that hour.
  const current = i >= 0 ? series[i]! : first;
  if (Math.abs(time - current.time) >= HOUR) return null;
  return {
    time,
    current,
    series: series.slice(Math.max(0, i - 1)).filter((p) => p.time <= time + NOW.seriesHours * HOUR),
  };
}

/** "Light rain now.", "Snow now."… */
function nowPhrase(p: ApiRainPoint, unit: RainUnit): string {
  const light = p.amount < toRainUnits(RAIN.lightBelow, unit);
  if (snowy(p.band, p.snow)) {
    if (p.band !== 'rain') return RAIN_COPY.heavySnowNow;
    return light ? RAIN_COPY.lightSnowNow : RAIN_COPY.snowNow;
  }
  if (p.band === 'rain' && light) return RAIN_COPY.lightRainNow;
  return RAIN_NOW_PHRASES[p.band];
}

/** What the next 12 hours bring: when rain eases off, or when it is likely to start. */
export function rainTrendLine(now: RainNowComputation): string {
  const start = now.current.time;
  const ahead = now.series.filter((p) => p.time > start && p.time <= start + 12 * HOUR);
  if (isRain(now.current.band)) {
    const easing = ahead.find((p) => rank(p.band) <= rank('spots'));
    return easing ? easingLine(easing.hour) : RAIN_COPY.setToLast;
  }
  const rain = ahead.find((p) => isRain(p.band));
  if (rain) return rainFromLine(rain.hour);
  const showers = ahead.find((p) => p.band === 'showers');
  return showers ? showersFromLine(showers.hour) : RAIN_COPY.dryNext12;
}

export function formatRainNow(now: RainNowComputation, unit: RainUnit): ApiRainNow {
  const p = now.current;
  let verdict = RAIN_NOW_VERDICTS[p.band];
  if (snowy(p.band, p.snow)) verdict = p.band === 'rain' ? SNOW_VERDICTS.now : SNOW_VERDICTS.heavy;
  // Two-hour blocks from the next full hour.
  const next = now.series.find((q) => q.time > now.time);
  const hours: ApiRainNow['hours'] = [];
  for (let k = 0; next && k < NOW.rows; k++) {
    const q = now.series.find((s) => s.time === next.time + k * NOW.stepHours * HOUR);
    if (q) {
      hours.push({
        time: new Date(q.time).toISOString(),
        label: formatHour(q.hour),
        chance: Math.round(q.chance2h * 10) * 10,
      });
    }
  }
  return {
    time: new Date(now.time).toISOString(),
    band: p.band,
    answer: RAIN_ANSWERS[p.band],
    verdict,
    detail: `${nowPhrase(p, unit)} ${rainTrendLine(now)}`,
    amount: roundRain(p.amount, unit),
    chance: p.chance,
    snow: p.snow,
    hours,
    series: now.series.map((q) => ({ ...q })),
  };
}

// ---- This week --------------------------------------------------------------------

/** The rain "this week" view in mm, before formatting. */
export interface RainWeekComputation {
  /** Today's date: the first day given, used for "today" in labels and verdicts. */
  today: string;
  /** The usable days, in order. */
  days: RainDayComputation[];
  /**
   * The median of each model's own total across the days (models covering every day), mm, or
   * null with fewer than 3 such models.
   */
  total: number | null;
  /** Normal rain over the same days (today scaled by the hours left), mm, or null. */
  normal: number | null;
  /** Days judged rain or wetter, and days judged showers. */
  rainDays: number;
  showerDays: number;
  /** The day with the largest consensus amount (the earlier one on a tie). */
  wettest: RainDayComputation;
}

/**
 * Today (the rest of it) and the days after it. Days with too few models are left out, and
 * without enough days there is no answer. `rainNormals` are monthly mean mm/day, January first.
 */
export function computeRainWeek(
  all: readonly RainDayComputation[],
  rainNormals: MonthlyNormals | null,
): RainWeekComputation | null {
  const days = all.filter((d) => d.models.length >= WEEK.minModels);
  const first = days[0];
  if (!first || days.length < WEEK.minDays) return null;

  const sums = first.models.flatMap((m) => {
    let sum = 0;
    for (const d of days) {
      const own = d.models.find((o) => o.id === m.id);
      if (!own) return [];
      sum += own.total;
    }
    return [sum];
  });

  let normal: number | null = null;
  if (rainNormals) {
    normal = 0;
    for (const d of days) {
      normal += normalForDate(rainNormals, d.date) * (d.partial ? d.hours / 24 : 1);
    }
  }

  let wettest = first;
  for (const d of days) if (d.amount > wettest.amount) wettest = d;
  return {
    today: all[0]!.date,
    days,
    total: sums.length >= BLEND.minModels ? median(sums) : null,
    normal,
    rainDays: days.filter((d) => isRain(d.band)).length,
    showerDays: days.filter((d) => d.band === 'showers').length,
    wettest,
  };
}

/** "today", "on Thu and Fri", "today and on Sat" (at most RAIN.week.nameDays days). */
function when(dates: readonly string[], today: string): string {
  const named = dates.slice(0, RAIN.week.nameDays);
  const others = named.filter((d) => d !== today);
  return whenDays(named[0] === today, others.length > 0 ? listDays(others, today) : null);
}

/** The week's band, answer and verdict line. */
export function rainWeekVerdict(week: RainWeekComputation): {
  band: RainBand;
  answer: string;
  verdict: string;
} {
  const { days, today } = week;
  const rainy = days.filter((d) => isRain(d.band));
  const heavy = rainy.filter((d) => rank(d.band) >= rank('heavy'));
  if (week.rainDays >= RAIN.week.wetFrom) {
    const band = RAIN_BANDS[Math.max(...rainy.map((d) => rank(d.band)))]!;
    const heaviest = heavy.length > 0 ? when([week.wettest.date], today) : null;
    return { band, answer: RAIN_WEEK_ANSWERS.yes, verdict: wetWeekLine(heaviest) };
  }
  if (week.rainDays > 0) {
    const dates = rainy.map((d) => d.date);
    const heavyWhen =
      heavy.length > 0
        ? when(
            heavy.map((d) => d.date),
            today,
          )
        : null;
    return {
      band: 'showers',
      answer: RAIN_WEEK_ANSWERS.partly,
      verdict: rainDaysLine(when(dates, today), heavyWhen, heavy.length === rainy.length),
    };
  }
  if (week.showerDays >= RAIN.week.unsettledFrom) {
    return {
      band: 'showers',
      answer: RAIN_WEEK_ANSWERS.maybe,
      verdict: RAIN_WEEK_VERDICTS.unsettled,
    };
  }
  if (week.showerDays > 0) {
    const dates = days.filter((d) => d.band === 'showers').map((d) => d.date);
    return {
      band: 'showers',
      answer: RAIN_WEEK_ANSWERS.maybe,
      verdict: mostlyDryLine(when(dates, today)),
    };
  }
  return days.some((d) => d.band === 'spots')
    ? { band: 'spots', answer: RAIN_WEEK_ANSWERS.no, verdict: RAIN_WEEK_VERDICTS.mostlyDry }
    : { band: 'dry', answer: RAIN_WEEK_ANSWERS.no, verdict: RAIN_WEEK_VERDICTS.dry };
}

/**
 * The week's rain against normal, in mm. Tiny amounts are never compared (a dry climate's
 * 0.3 mm is not "wetter than usual"); a week that is dry in a dry place says so.
 */
export function rainNormal(total: number, normal: number): RainNormal | null {
  const n = RAIN.normals;
  if (Math.max(total, normal) < n.compareFrom) {
    return total < n.usualDryBelow && normal < n.usualDryBelow ? 'dry' : null;
  }
  if (total >= n.wetterRatio * normal && total - normal >= n.minDifference) return 'wetter';
  if (total <= n.drierRatio * normal && normal - total >= n.minDifference) return 'drier';
  return 'normal';
}

const weekdayName = (date: string): string => WEEKDAYS[new Date(parseDate(date)).getUTCDay()]!;

export function formatRainWeek(week: RainWeekComputation, units: Units): ApiRainWeek {
  const unit = rainUnit(units);
  const shown = (mm: number) => roundRain(toRainUnits(mm, unit), unit);
  const text = (mm: number) => rainText(toRainUnits(mm, unit), unit);
  const { today, days } = week;
  const from = days[0]!.date;
  const to = days[days.length - 1]!.date;

  const parts: string[] = [];
  if (week.total === null) {
    parts.push(RAIN_COPY.noWeekTotal);
  } else {
    if (week.total < RAIN.day.wet) {
      parts.push(RAIN_COPY.barelyAnyRain);
    } else {
      const w = week.wettest;
      // A week whose rain falls on different days in different models has no day to single out.
      const most = atLeast(w.amount, RAIN.day.wet)
        ? {
            when: whenDays(w.date === today, w.date === today ? null : weekdayName(w.date)),
            amount: text(w.amount),
          }
        : null;
      parts.push(rainWeekLine(text(week.total), most));
    }
    const kind = week.normal === null ? null : rainNormal(week.total, week.normal);
    // A week across two months is compared with normals from both.
    const month = monthName(from) === monthName(to) ? monthName(from) : 'the time of year';
    if (kind) parts.push(rainNormalLine(kind, month));
  }

  const { band, answer, verdict } = rainWeekVerdict(week);
  return {
    from,
    to,
    band,
    answer,
    verdict,
    detail: parts.join(' '),
    total: week.total === null ? null : shown(week.total),
    normal: week.normal === null ? null : shown(week.normal),
    rainDays: week.rainDays,
    showerDays: week.showerDays,
    wettest: { date: week.wettest.date, amount: shown(week.wettest.amount) },
    days: days.map((d) => {
      const snow = snowy(d.band, d.snow === 'most');
      return {
        date: d.date,
        label: dayLabel(d.date, today),
        amount: shown(d.amount),
        band: d.band,
        bandLabel: snow ? SNOW_LABEL : RAIN_BAND_LABELS[d.band],
        snow,
      };
    }),
  };
}
