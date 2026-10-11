/**
 * "Will it snow today?": the rest of today, or a whole day (tomorrow, the days of the week), and
 * the judged hourly series the Now view picks from. Server and preview only: the browser runs
 * snowNow.ts on the series. Judged as rain is (rainDay.ts), in centimetres of snow.
 */
import { BLEND, RAIN, SNOW, type SnowBand, type SnowReason } from './config';
import { normalForDate, parseDate, type MonthlyNormals } from './climate';
import type { HourTemps } from './blend';
import type { DayData } from './compute';
import {
  COPY,
  RAIN_COPY,
  SNOW_ANSWERS,
  SNOW_COPY,
  SNOW_DAY_VERDICTS,
  SNOW_NONE_VERDICTS,
  aroundLine,
  betweenLine,
  coldestLine,
  easingLine,
  monthName,
  noLowerLine,
  snowAgreementLine,
  snowAmountLine,
  snowFromLine,
  snowNormalLine,
  snowStripSummary,
  snowUpToLine,
  type SnowNormal,
} from './copy';
import { localDateTime } from './dates';
import {
  EPSILON,
  HOUR,
  atLeast,
  median,
  niceCeil,
  rainBand,
  rank,
  round2,
  shareAtLeast,
  windowThresholds,
  type RainThresholds,
} from './rain';
import { isSnow, roundSnow, snowRank, snowText, snowUnit, snowWater, toSnowUnits } from './snow';
import { isFiniteNumber, trimmedMean } from './stats';
import { roundTemp, toUnits, type Units } from './units';
import type { ApiSnowDay, ApiSnowPoint, SnowUnit } from './types';

// ---- Judging snow ---------------------------------------------------------------

/** Snow amounts for one window, cm. */
export interface SnowThresholds {
  snow: number;
  flakes: number;
  heavy: number;
  deep: number;
}

/** Thresholds for a window of `hours` hours, scaled from the hourly values as rain's are. */
export function snowThresholds(hours: number): SnowThresholds {
  return {
    snow: Math.min(SNOW.day.snow, SNOW.hour.snow * hours),
    flakes: Math.min(SNOW.day.flakes, SNOW.hour.flakes * hours),
    heavy: Math.min(SNOW.day.heavy, SNOW.hour.heavy * hours),
    deep: Math.min(SNOW.day.deep, SNOW.hour.deep * hours),
  };
}

/**
 * The band for the models' snow over one window: likely snow is banded by the median amount, a
 * fair chance is "snow possible", and otherwise a quarter of the models with flakes is "flakes".
 */
export function snowBand(totals: readonly number[], t: SnowThresholds): SnowBand {
  const p = shareAtLeast(totals, t.snow);
  if (p >= SNOW.likelyFrom) {
    const m = median(totals);
    if (atLeast(m, t.deep)) return 'deepsnow';
    return atLeast(m, t.heavy) ? 'heavysnow' : 'snow';
  }
  if (p >= SNOW.maybeFrom) return 'maybesnow';
  return shareAtLeast(totals, t.flakes) >= SNOW.maybeFrom ? 'flakes' : 'nosnow';
}

/**
 * Why there is no snow: rain instead (the wet topic would say showers or wetter for the same
 * window), too warm (every model above SNOW.warmAboveC throughout, so not one shows snow), or
 * cold enough at times but dry.
 */
function noSnowReason(
  rain: readonly number[],
  rainThresholds: RainThresholds,
  lows: readonly (number | null)[],
): SnowReason {
  if (rank(rainBand(rain, rainThresholds)) >= rank('showers')) return 'rain';
  return lows.every((t) => t !== null && t > SNOW.warmAboveC) ? 'warm' : 'dry';
}

/** Each model's snow in one hour, cm, or null without precipitation. */
const depths = (h: HourTemps): (number | null)[] =>
  snowWater(h).map((w) => (w === null ? null : w * SNOW.cmPerMm));

/**
 * A depth for a sentence in `unit`, or null for "a dusting": whole centimetres (at least 1) up to
 * 10, then the nearest 5; inches to the nearest half (at least a half) up to 3, then whole.
 * Decided in centimetres, so a dusting is the same in either unit.
 */
export function textDepth(cm: number, unit: SnowUnit): number | null {
  if (cm < SNOW.dustingBelow - EPSILON) return null;
  const v = toSnowUnits(cm, unit);
  if (unit === 'in') return v < 3 ? Math.max(0.5, Math.round(v * 2) / 2) : Math.round(v);
  return v < 10 ? Math.max(1, Math.round(v)) : Math.round(v / 5) * 5;
}

// ---- Today and tomorrow ----------------------------------------------------------

/** One model's snow over a window. */
export interface SnowModelTotal {
  id: string;
  name: string;
  /** Snow, cm. */
  total: number;
  /** Precipitation, mm (for "Rain, not snow."). */
  rain: number;
  /** The lowest temperature over the window, °C, or null without one. */
  low: number | null;
}

/** One local hour of the window with snow data. */
export interface SnowHourChance {
  /** Local hour of day, 0–23. */
  hour: number;
  /** The share of models with snow in the hour. */
  chance: number;
  /** The hour judged with the hourly thresholds, as the Now view judges it. */
  band: SnowBand;
}

/** One window's result in cm and °C at full precision, before formatting. */
export interface SnowDayComputation {
  date: string;
  /** Start of the window, epoch milliseconds, as for rain. */
  from: number;
  /** True for the rest of the day from `from`, false for the whole day. */
  partial: boolean;
  /** The window's length in hours, as for rain (24 for a day). */
  hours: number;
  thresholds: SnowThresholds;
  /** Models with a value for every hour of the window. */
  models: SnowModelTotal[];
  /** Models expecting snow: a total of at least `thresholds.snow`. */
  snowy: number;
  /** snowy / models, 0–1. */
  chance: number;
  /** The consensus amount: the median of the totals, cm. */
  amount: number;
  band: SnowBand;
  /** Why a window without snow has none, or null. */
  reason: SnowReason | null;
  /** The models' lowest temperatures blended (as the highs are), °C, or null. */
  low: number | null;
  /** Normal snowfall for the date, cm a day, or null without normals. */
  normal: number | null;
  /** Each hour of the window with data, in order (empty without hourly data). */
  hourly: SnowHourChance[];
  /** The likely hours, end exclusive (24 is midnight), or null. */
  likely: { from: number; to: number } | null;
  /** The rest of today only: the current hour is judged snow or more, as Now judges it. */
  snowing: boolean;
}

export interface SnowDayOptions {
  /** Judge the rest of the day from this moment (epoch ms) rather than the whole day. */
  from?: number;
  /** Monthly normal snowfall, mm/day of water, January first (NASA POWER PRECSNOLAND). */
  normals?: MonthlyNormals | null;
}

/** One hour of snow across the models, judged as the Now view judges it; null without data. */
function judgeHour(h: HourTemps): SnowHourChance | null {
  const values = depths(h).filter(isFiniteNumber);
  if (values.length === 0) return null;
  return {
    hour: h.hour,
    chance: shareAtLeast(values, SNOW.hour.snow),
    band: snowBand(values, snowThresholds(1)),
  };
}

/**
 * The rest of today (with `opts.from`, from the hourly values; the current hour weighted by the
 * minutes left) or a whole day (from each model's daily total). Null when no model has
 * precipitation for the whole window, exactly as for rain.
 *
 * While snow is possible now (the current hour judged "snow possible" or more), the current hour
 * counts in full and a model expects snow from an hour's snow amount, so Today never answers
 * less snowy than Now, as for rain.
 */
export function computeSnowDay(day: DayData, opts: SnowDayOptions = {}): SnowDayComputation | null {
  const partial = opts.from !== undefined;
  const fromTime = opts.from ?? Number.NEGATIVE_INFINITY;
  const window: { h: HourTemps; weight: number }[] = [];
  let now: SnowBand = 'nosnow';
  let snowNow = false;
  for (const h of day.hourly) {
    if (h.time >= fromTime) {
      window.push({ h, weight: 1 });
    } else if (h.time + HOUR > fromTime) {
      now = judgeHour(h)?.band ?? 'nosnow';
      snowNow = snowRank(now) >= snowRank('maybesnow');
      window.push({
        h,
        weight: snowNow ? 1 : (60 - Math.floor((fromTime - h.time) / 60_000)) / 60,
      });
    }
  }

  let models: SnowModelTotal[];
  let hours = 24;
  let thresholds: SnowThresholds = SNOW.day;
  let rainThresholds: RainThresholds = RAIN.day;
  if (partial) {
    if (window.length === 0) return null;
    hours = window.reduce((sum, w) => sum + w.weight, 0);
    // Never less than an hour's thresholds, as for rain.
    thresholds = snowThresholds(Math.max(1, hours));
    rainThresholds = windowThresholds(Math.max(1, hours));
    if (snowNow) thresholds = { ...thresholds, snow: SNOW.hour.snow };
    const snow = window.map(({ h }) => depths(h));
    models = day.models.flatMap((m, i) => {
      let total = 0;
      let rain = 0;
      const temps: number[] = [];
      for (const [k, { h, weight }] of window.entries()) {
        const p = h.rain?.[i];
        if (!isFiniteNumber(p)) return [];
        total += snow[k]![i]! * weight;
        rain += p * weight;
        const t = h.temps[i];
        if (isFiniteNumber(t)) temps.push(t);
      }
      const low = temps.length > 0 ? Math.min(...temps) : null;
      return [{ id: m.id, name: m.name, total, rain, low }];
    });
  } else {
    models = day.models.flatMap((m) =>
      isFiniteNumber(m.snowfall)
        ? [{ id: m.id, name: m.name, total: m.snowfall, rain: m.rain ?? 0, low: m.low ?? null }]
        : [],
    );
  }
  if (models.length === 0) return null;

  const totals = models.map((m) => m.total);
  const snowy = totals.filter((v) => atLeast(v, thresholds.snow)).length;
  const band = snowBand(totals, thresholds);
  const lows = models.map((m) => m.low).filter(isFiniteNumber);
  const hourly = window.flatMap(({ h }) => judgeHour(h) ?? []);
  const likelyHours = hourly.filter((c) => c.chance >= SNOW.hourLikely);

  return {
    date: day.date,
    from: partial ? fromTime : (day.hourly[0]?.time ?? parseDate(day.date)),
    partial,
    hours,
    thresholds,
    models,
    snowy,
    chance: snowy / models.length,
    amount: median(totals),
    band,
    reason:
      band === 'nosnow'
        ? noSnowReason(
            models.map((m) => m.rain),
            rainThresholds,
            models.map((m) => m.low),
          )
        : null,
    low: lows.length > 0 ? trimmedMean(lows, BLEND.trimFrom) : null,
    normal: opts.normals ? normalForDate(opts.normals, day.date) * SNOW.cmPerMm : null,
    hourly,
    likely:
      likelyHours.length > 0
        ? { from: likelyHours[0]!.hour, to: likelyHours.at(-1)!.hour + 1 }
        : null,
    snowing: isSnow(now),
  };
}

/** When the snow is most likely, for "snow possible" and more (rain's timing, in snow). */
export function snowTimingLine(c: SnowDayComputation): string {
  const every = c.hourly.every((h) => h.chance >= SNOW.hourLikely);
  if (c.snowing) {
    // Snowing now: easing off at the first later hour judged flakes or less, as Now says, and
    // when the snow is back if it comes back later today.
    const later = c.hourly.slice(1);
    const easing = later.findIndex((h) => snowRank(h.band) <= snowRank('flakes'));
    if (easing < 0) return every ? RAIN_COPY.restOfDay : RAIN_COPY.onAndOffRestOfDay;
    const back = later.slice(easing).find((h) => isSnow(h.band));
    const eases = easingLine(later[easing]!.hour);
    return back ? `${eases} ${snowFromLine(back.hour)}` : eases;
  }
  const likely = c.likely;
  if (!likely) {
    let best: SnowHourChance | undefined;
    for (const h of c.hourly) if (!best || h.chance > best.chance) best = h;
    return best && best.chance >= SNOW.hourPossible ? aroundLine(best.hour) : RAIN_COPY.onAndOff;
  }
  if (likely.from === c.hourly[0]!.hour && likely.to === 24) {
    if (c.partial) return every ? RAIN_COPY.restOfDay : RAIN_COPY.onAndOffRestOfDay;
    return every ? RAIN_COPY.allDay : RAIN_COPY.onAndOffAllDay;
  }
  if (likely.to - likely.from === 1) return aroundLine(likely.from);
  return betweenLine(likely.from, likely.to);
}

/**
 * The lowest temperature, for a window without snow: "No lower than 9° all day." while it stays
 * above the snow line, else "Down to -4° at the coldest."
 */
export function lowLine(low: number, units: Units, when: 'rest' | 'day' | 'week'): string {
  const shown = roundTemp(toUnits(low, units));
  return low > SNOW.warmAboveC ? noLowerLine(shown, when) : coldestLine(shown);
}

/** A month where snow is rare or common, by its normal (cm a day), or null in between. */
export function snowClimate(normal: number): SnowNormal | null {
  if (normal < SNOW.normals.rareBelow) return 'rare';
  return normal >= SNOW.normals.commonFrom ? 'common' : null;
}

/**
 * The detail line. Without snow: the lowest temperature, and how usual snow is in the month.
 * With some: how much, and when. Amounts are words ("2 to 5cm", "a dusting").
 */
export function snowDayDetail(c: SnowDayComputation, units: Units): string {
  const unit = snowUnit(units);
  const parts: string[] = [];
  if (c.band === 'nosnow') {
    if (c.low !== null) parts.push(lowLine(c.low, units, c.partial ? 'rest' : 'day'));
    const kind = c.normal === null ? null : snowClimate(c.normal);
    if (kind) parts.push(snowNormalLine(kind, monthName(c.date)));
    return parts.join(' ');
  }
  if (c.band === 'flakes') return SNOW_COPY.littleOrNone;
  const text = (cm: number) => {
    const depth = textDepth(cm, unit);
    return depth === null ? null : `${depth}${unit}`;
  };
  if (c.band === 'maybesnow') {
    const totals = c.models.map((m) => m.total).sort((a, b) => b - a);
    const one = c.snowy === 1;
    parts.push(snowUpToLine(text(one ? totals[0]! : totals[1]!), one));
  } else {
    parts.push(snowAmountLine(snowRange(c, unit), unit, c.partial));
  }
  parts.push(snowTimingLine(c));
  return parts.join(' ');
}

/**
 * The amount in words: the spread of the middle forecasts when four or more have a total and
 * its ends round apart, else the median; null for a dusting.
 */
function snowRange(c: SnowDayComputation, unit: SnowUnit): { low: number; high: number } | null {
  const about = textDepth(c.amount, unit);
  if (about === null) return null;
  const totals = c.models.map((m) => m.total).sort((a, b) => a - b);
  const cut = totals.length >> 2;
  if (cut > 0) {
    const low = textDepth(totals[cut]!, unit);
    const high = textDepth(totals[totals.length - 1 - cut]!, unit)!;
    if (low !== null && low !== high) return { low, high };
  }
  return { low: about, high: about };
}

export function snowDayVerdict(c: SnowDayComputation): string {
  return c.reason && c.reason !== 'dry' ? SNOW_NONE_VERDICTS[c.reason] : SNOW_DAY_VERDICTS[c.band];
}

/** The API's snow day: display units and every copy string. */
export function formatSnowDay(c: SnowDayComputation, units: Units): ApiSnowDay {
  const unit = snowUnit(units);
  const answer = isSnow(c.band) ? 'yes' : c.band === 'maybesnow' ? 'maybe' : 'no';
  const models = c.models.map((m) => {
    const shown = toSnowUnits(m.total, unit);
    const expectsSnow = atLeast(m.total, c.thresholds.snow);
    return {
      id: m.id,
      name: m.name,
      amount: roundSnow(shown, unit),
      value: round2(shown),
      expectsSnow,
      agrees: answer === 'yes' ? expectsSnow : answer === 'no' ? !expectsSnow : true,
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
    answer: SNOW_ANSWERS[c.band],
    verdict: snowDayVerdict(c),
    detail: snowDayDetail(c, units),
    reason: c.reason,
    amount: roundSnow(toSnowUnits(c.amount, unit), unit),
    chance: round2(c.chance),
    snowy: c.snowy,
    total: c.models.length,
    confidence,
    threshold: round2(toSnowUnits(c.thresholds.snow, unit)),
    likely: c.likely ? { ...c.likely } : null,
    scale: { min: 0, max: niceCeil(Math.max(top * 1.15, SNOW.scaleFloor[unit])) },
    models,
    month: monthName(c.date),
    agreementText: snowAgreementLine(c.snowy, c.models.length),
    limitedText: confidence === 'limited' ? COPY.limited : null,
    stripSummary: snowStripSummary({
      min: snowText(Math.min(...amounts), unit),
      max: snowText(Math.max(...amounts), unit),
      snowy: c.snowy,
      total: c.models.length,
    }),
  };
}

// ---- The hourly series (for Now) --------------------------------------------------

/** One forecast hour of snow across the models, cm. */
export interface SnowSeriesPoint {
  /** Start of the hour, epoch milliseconds (UTC). */
  time: number;
  /** The median of the models' snow in the hour. */
  amount: number;
  /** Share of models with at least the hourly snow amount. */
  chance: number;
  /** Share of models with at least SNOW.blockSnow over this hour and the next. */
  chance2h: number;
  band: SnowBand;
  /** Why an hour without snow has none, or null. */
  reason: SnowReason | null;
}

/**
 * Every forecast hour with precipitation data, in order, each judged with the hourly thresholds,
 * as rainSeries does for rain.
 */
export function snowSeries(days: readonly DayData[]): SnowSeriesPoint[] {
  const thresholds = snowThresholds(1);
  const rainThresholds = windowThresholds(1);
  const hours = days.flatMap((d) => d.hourly);
  const snow = hours.map(depths);
  const points: SnowSeriesPoint[] = [];
  hours.forEach((h, j) => {
    const next = hours[j + 1]?.time === h.time + HOUR ? snow[j + 1] : undefined;
    const values: number[] = [];
    const blocks: number[] = [];
    const rain: number[] = [];
    const temps: (number | null)[] = [];
    snow[j]!.forEach((s, i) => {
      if (s === null) return;
      const after = next?.[i];
      values.push(s);
      blocks.push(s + (isFiniteNumber(after) ? after : 0));
      rain.push(h.rain![i]!);
      temps.push(h.temps[i] ?? null);
    });
    if (values.length === 0) return;
    const band = snowBand(values, thresholds);
    points.push({
      time: h.time,
      amount: median(values),
      chance: shareAtLeast(values, SNOW.hour.snow),
      chance2h: shareAtLeast(blocks, SNOW.blockSnow),
      band,
      reason: band === 'nosnow' ? noSnowReason(rain, rainThresholds, temps) : null,
    });
  });
  return points;
}

/** The series as the API sends it: display units, two decimals, local date and hour. */
export function judgeSnowSeries(
  points: readonly SnowSeriesPoint[],
  units: Units,
  timezone: string,
): ApiSnowPoint[] {
  const unit = snowUnit(units);
  return points.map((p) => {
    const local = localDateTime(timezone, new Date(p.time));
    return {
      time: p.time,
      date: local.date,
      hour: Math.floor(local.hours),
      amount: round2(toSnowUnits(p.amount, unit)),
      chance: round2(p.chance),
      chance2h: round2(p.chance2h),
      band: p.band,
      reason: p.reason,
      // Decided in cm, so the words never depend on the units.
      light: p.amount < SNOW.lightBelow,
    };
  });
}
