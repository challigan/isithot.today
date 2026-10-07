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
