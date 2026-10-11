/** "Is it wet today?": the rest of today, or a whole day (tomorrow, the days of the week). */
import { BLEND, RAIN, type RainBand } from './config';
import { parseDate } from './climate';
import type { HourTemps } from './blend';
import type { DayData } from './compute';
import {
  COPY,
  RAIN_ANSWERS,
  RAIN_COPY,
  RAIN_VERDICTS,
  SNOW_VERDICTS,
  aroundLine,
  betweenLine,
  easingLine,
  monthName,
  rainAgreementLine,
  rainAmountLine,
  rainFromLine,
  rainStripSummary,
  upToLine,
} from './copy';
import { isFiniteNumber } from './stats';
import { type Units } from './units';
import type { ApiRainDay, RainUnit } from './types';
import {
  HOUR,
  EPSILON,
  rainUnit,
  toRainUnits,
  round2,
  roundRain,
  rainText,
  niceCeil,
  type RainThresholds,
  windowThresholds,
  atLeast,
  rank,
  isRain,
  median,
  shareAtLeast,
  rainBand,
  type SnowAmount,
  snowAmount,
  snowy,
} from './rain';
import { snowWater } from './snow';

// ---- Today and tomorrow ----------------------------------------------------------

/** One model's rain over a window, mm. */
export interface RainModelTotal {
  id: string;
  name: string;
  total: number;
  /** The part of `total` that falls as snow (snowWater in snow.ts). */
  snow: number;
}

/** One local hour of the window with rain data. */
export interface RainHourChance {
  /** Local hour of day, 0–23. */
  hour: number;
  /** The share of models with rain in the hour. */
  chance: number;
  /** The hour judged with the hourly thresholds, as the Now view judges it. */
  band: RainBand;
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
  /**
   * The window's length in hours, the current hour counting what is left of it, or all of it
   * while it is wet now (24 for a day).
   */
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
  /**
   * The rest of today only: the current hour is judged rain or wetter, as the Now view judges
   * it, so Now says it is raining. Today then says Yes and when it eases off, as Now does.
   */
  raining: boolean;
}

export interface RainDayOptions {
  /** Judge the rest of the day from this moment (epoch ms) rather than the whole day. */
  from?: number;
}

/** One hour of rain across the models, judged as the Now view judges it; null without data. */
function judgeHour(h: HourTemps): RainHourChance | null {
  const values = (h.rain ?? []).filter(isFiniteNumber);
  if (values.length === 0) return null;
  return {
    hour: h.hour,
    chance: shareAtLeast(values, RAIN.hour.wet),
    band: rainBand(values, windowThresholds(1)),
  };
}

/**
 * The rest of today (with `opts.from`, from the hourly values; the current hour weighted by
 * the minutes left) or a whole day (from each model's daily total). Null when no model has
 * rain for the whole window.
 *
 * While it is wet now (the current hour judged showers or wetter, so the Now view says Maybe or
 * Yes), the current hour counts in full, as Now counts it, and a model expects rain from an
 * hour's wet amount. Today then never answers drier than Now: a rest of the day that starts in
 * the rain is wet, however soon the rain eases.
 */
export function computeRainDay(day: DayData, opts: RainDayOptions = {}): RainDayComputation | null {
  const partial = opts.from !== undefined;
  const fromTime = opts.from ?? Number.NEGATIVE_INFINITY;
  const window: { h: HourTemps; weight: number }[] = [];
  // The current hour's band (the rest of today only), as Now judges it.
  let now: RainBand = 'dry';
  let wetNow = false;
  for (const h of day.hourly) {
    if (h.time >= fromTime) {
      window.push({ h, weight: 1 });
    } else if (h.time + HOUR > fromTime) {
      // The hour containing the moment counts the minutes left in it, or all of it while wet.
      now = judgeHour(h)?.band ?? 'dry';
      wetNow = rank(now) >= rank('showers');
      window.push({ h, weight: wetNow ? 1 : (60 - Math.floor((fromTime - h.time) / 60_000)) / 60 });
    }
  }

  let models: RainModelTotal[];
  let hours = 24;
  let thresholds: RainThresholds = RAIN.day;
  if (partial) {
    if (window.length === 0) return null;
    hours = window.reduce((sum, w) => sum + w.weight, 0);
    // Never less than an hour's thresholds, so the day's last minutes are not judged against
    // next to nothing.
    thresholds = windowThresholds(Math.max(1, hours));
    if (wetNow) thresholds = { ...thresholds, wet: RAIN.hour.wet };
    // The part of each hour that falls as snow: the rule the snow topic judges by too.
    const water = window.map(({ h }) => snowWater(h));
    models = day.models.flatMap((m, i) => {
      let total = 0;
      let snow = 0;
      for (const [k, { h, weight }] of window.entries()) {
        const rain = h.rain?.[i];
        if (!isFiniteNumber(rain)) return [];
        total += rain * weight;
        snow += water[k]![i]! * weight;
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

  const hourly = window.flatMap(({ h }) => judgeHour(h) ?? []);
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
    raining: isRain(now),
  };
}

/** When the rain is most likely, for showers and wetter. */
export function timingLine(c: RainDayComputation): string {
  const every = c.hourly.every((h) => h.chance >= RAIN.hourLikely);
  if (c.raining) {
    // Raining now: easing off at the first later hour judged spots or drier, as Now says, and
    // when rain is back if it comes back later today.
    const later = c.hourly.slice(1);
    const easing = later.findIndex((h) => rank(h.band) <= rank('spots'));
    if (easing < 0) return every ? RAIN_COPY.restOfDay : RAIN_COPY.onAndOffRestOfDay;
    const back = later.slice(easing).find((h) => isRain(h.band));
    const eases = easingLine(later[easing]!.hour);
    return back ? `${eases} ${rainFromLine(back.hour)}` : eases;
  }
  const likely = c.likely;
  if (!likely) {
    let best: RainHourChance | undefined;
    for (const h of c.hourly) if (!best || h.chance > best.chance) best = h;
    return best && best.chance >= RAIN.hourPossible ? aroundLine(best.hour) : RAIN_COPY.onAndOff;
  }
  if (likely.from === c.hourly[0]!.hour && likely.to === 24) {
    if (c.partial) return every ? RAIN_COPY.restOfDay : RAIN_COPY.onAndOffRestOfDay;
    return every ? RAIN_COPY.allDay : RAIN_COPY.onAndOffAllDay;
  }
  if (likely.to - likely.from === 1) return aroundLine(likely.from);
  return betweenLine(likely.from, likely.to);
}

/**
 * The detail line: how much (or how dry), when, and whether it may be snow. A model expects rain
 * from at least an hour's wet amount (0.2mm, shown as 0.2mm or 0.01in), so an amount named here
 * never rounds to nothing.
 */
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
