/**
 * "Is it wet right now?": the judged hourly series, and the hour containing a moment. The server
 * and the browser both run computeRainNow and formatRainNow, on the same numbers.
 */
import { BLEND, NOW, RAIN, type RainBand } from './config';
import type { DayData } from './compute';
import {
  RAIN_ANSWERS,
  RAIN_COPY,
  RAIN_NOW_PHRASES,
  RAIN_NOW_VERDICTS,
  SNOW_VERDICTS,
  dryFromLine,
  easingLine,
  formatHour,
  rainFromLine,
  showersFromLine,
} from './copy';
import { localDateTime } from './dates';
import { isFiniteNumber, trimmedMean } from './stats';
import { type Units } from './units';
import type { ApiRainNow, ApiRainPoint, RainUnit } from './types';
import {
  HOUR,
  rainUnit,
  toRainUnits,
  round2,
  roundRain,
  windowThresholds,
  rank,
  isRain,
  median,
  shareAtLeast,
  rainBand,
  snowy,
} from './rain';
import { snowWater } from './snow';

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
  /**
   * Most of the hour's precipitation falls as snow, by the rule the snow topic judges by
   * (snowWater in snow.ts). Only for forecasts with snowfall; the words go by `snow` without it.
   */
  asSnow?: boolean;
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
    const point: RainSeriesPoint = {
      time: h.time,
      amount: median(values),
      chance: shareAtLeast(values, RAIN.hour.wet),
      chance2h: shareAtLeast(blocks, RAIN.blockWet),
      band: rainBand(values, thresholds),
      snow: temps.length > 0 && trimmedMean(temps, BLEND.trimFrom) <= RAIN.snowAtOrBelowC,
    };
    if (h.snow) {
      const rain = values.reduce((a, b) => a + b, 0);
      const snow = snowWater(h).reduce<number>((a, w) => a + (w ?? 0), 0);
      point.asSnow = rain > 0 && snow >= RAIN.snowFrom * rain;
    }
    points.push(point);
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
      ...(p.asSnow === undefined ? {} : { asSnow: p.asSnow }),
      // Decided in mm, so the words never depend on the units.
      light: p.amount < RAIN.lightBelow,
    };
  });
}

/** The rain "now" view, before formatting (the snow topic's points share it). */
export interface RainNowComputation<P extends { time: number } = ApiRainPoint> {
  /** The moment the values are for, epoch milliseconds. */
  time: number;
  /** The hour containing the moment. */
  current: P;
  /** Judged hours from the one before the current hour to a day after the moment. */
  series: P[];
}

/**
 * The hour containing a moment, from the judged series (rain is per hour, so nothing is
 * interpolated). Null when the series does not cover the moment. The server and the browser
 * run this on the same numbers, for rain and for snow.
 */
export function computeRainNow<P extends { time: number }>(
  series: readonly P[],
  time: number,
): RainNowComputation<P> | null {
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

/** Whether the hour's rain is snow: by the shared rule, or by temperature for older answers. */
const asSnow = (p: ApiRainPoint): boolean => p.asSnow ?? p.snow;

/** "Light rain now.", "Snow now."… */
function nowPhrase(p: ApiRainPoint): string {
  if (snowy(p.band, asSnow(p))) {
    if (p.band !== 'rain') return RAIN_COPY.heavySnowNow;
    return p.light ? RAIN_COPY.lightSnowNow : RAIN_COPY.snowNow;
  }
  if (p.band === 'rain' && p.light) return RAIN_COPY.lightRainNow;
  return RAIN_NOW_PHRASES[p.band];
}

/** The hours that start the Now view's rows: two-hour blocks from the next full hour. */
export function rainRows<P extends { time: number }>(now: RainNowComputation<P>): P[] {
  const next = now.series.find((q) => q.time > now.time);
  const rows: P[] = [];
  for (let k = 0; next && k < NOW.rows; k++) {
    const q = now.series.find((s) => s.time === next.time + k * NOW.stepHours * HOUR);
    if (q) rows.push(q);
  }
  return rows;
}

/**
 * What the next 12 hours bring: when rain (or showers) under way now eases off, or when rain is
 * likely to start. "Dry for the next 12 hours" only when no row below it shows a fair chance.
 */
export function rainTrendLine(now: RainNowComputation): string {
  const start = now.current.time;
  const ahead = now.series.filter((p) => p.time > start && p.time <= start + 12 * HOUR);
  const easing = ahead.find((p) => rank(p.band) <= rank('spots'));
  if (isRain(now.current.band)) return easing ? easingLine(easing.hour) : RAIN_COPY.setToLast;
  const rain = ahead.find((p) => isRain(p.band));
  if (rain) return rainFromLine(rain.hour);
  if (now.current.band === 'showers') {
    return easing ? dryFromLine(easing.hour) : RAIN_COPY.showersNext12;
  }
  // The first showery hour, or the first row with a fair chance, whichever comes first.
  const showers = ahead.find((p) => p.band === 'showers');
  const row = rainRows(now).find((p) => p.chance2h >= RAIN.maybeFrom);
  const first = row && !(showers && showers.time < row.time) ? row : showers;
  return first ? showersFromLine(first.hour) : RAIN_COPY.dryNext12;
}

export function formatRainNow(now: RainNowComputation, unit: RainUnit): ApiRainNow {
  const p = now.current;
  let verdict = RAIN_NOW_VERDICTS[p.band];
  if (snowy(p.band, asSnow(p)))
    verdict = p.band === 'rain' ? SNOW_VERDICTS.now : SNOW_VERDICTS.heavy;
  return {
    time: new Date(now.time).toISOString(),
    band: p.band,
    answer: RAIN_ANSWERS[p.band],
    verdict,
    detail: `${nowPhrase(p)} ${rainTrendLine(now)}`,
    amount: roundRain(p.amount, unit),
    chance: p.chance,
    snow: p.snow,
    hours: rainRows(now).map((q) => ({
      time: new Date(q.time).toISOString(),
      label: formatHour(q.hour),
      chance: Math.round(q.chance2h * 10) * 10,
    })),
    series: now.series.map((q) => ({ ...q })),
  };
}
