import { BLEND, NOW, type Band } from './config';
import type { ClimateRange } from './climate';
import type { DayData } from './compute';
import { ANSWERS, VERDICTS, formatHour } from './copy';
import { localDateTime } from './dates';
import { isFiniteNumber, trimmedMean } from './stats';
import { round1, roundTemp, toUnits, type Units } from './units';
import { verdict } from './verdict';
import type { ApiNow, ApiNowPoint } from './types';

const HOUR = 3_600_000;

/** One forecast hour blended across models, °C. */
export interface SeriesPoint {
  /** Start of the hour, epoch milliseconds (UTC). */
  time: number;
  temperature: number;
  feelsLike: number;
}

/**
 * Every forecast hour in order, each blended across the models with the same trimmed mean as
 * the daily highs. Hours where no model has a temperature are left out.
 */
export function hourlySeries(days: readonly DayData[]): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const day of days) {
    for (const h of day.hourly) {
      const temps = h.temps.filter(isFiniteNumber);
      if (temps.length === 0) continue;
      const temperature = trimmedMean(temps, BLEND.trimFrom);
      const feels = (h.feels ?? []).filter(isFiniteNumber);
      const feelsLike = feels.length > 0 ? trimmedMean(feels, BLEND.trimFrom) : temperature;
      points.push({ time: h.time, temperature, feelsLike });
    }
  }
  return points;
}

/**
 * The series as the API sends it: each hour judged with the same verdict as the day's high
 * (so "hot" means the same thing in every view), then put in display units to one decimal.
 * Clients only interpolate between these points; they never need the verdict rules.
 */
export function judgeSeries(
  series: readonly SeriesPoint[],
  climate: ClimateRange | null,
  units: Units,
): ApiNowPoint[] {
  return series.map((p) => ({
    time: p.time,
    temperature: round1(toUnits(p.temperature, units)),
    feelsLike: round1(toUnits(p.feelsLike, units)),
    band: verdict(p.feelsLike, climate).band,
  }));
}

/** The "now" view in display units, before formatting. */
export interface NowComputation {
  /** The moment the values are for, epoch milliseconds. */
  time: number;
  temperature: number;
  feelsLike: number;
  /** The band of the hour nearest the moment. */
  band: Band;
  /** Judged hours from the one containing `time` to a day after it. */
  series: ApiNowPoint[];
}

/**
 * Temperature at a moment: the judged hourly series, interpolated between the hours either
 * side. Null when the series does not cover the moment. Works in whatever units the series
 * is in, so the server and the browser run the same code on the same numbers.
 */
export function computeNow(series: readonly ApiNowPoint[], time: number): NowComputation | null {
  let i = -1;
  while (i + 1 < series.length && series[i + 1]!.time <= time) i++;
  const a = series[i];
  if (!a) return null;
  const b = series[i + 1];
  let temperature: number;
  let feelsLike: number;
  let band: Band;
  if (b && b.time - a.time <= 3 * HOUR) {
    const f = (time - a.time) / (b.time - a.time);
    temperature = a.temperature + (b.temperature - a.temperature) * f;
    feelsLike = a.feelsLike + (b.feelsLike - a.feelsLike) * f;
    band = f < 0.5 ? a.band : b.band;
  } else if (time - a.time < HOUR) {
    ({ temperature, feelsLike, band } = a);
  } else {
    return null;
  }
  return {
    time,
    temperature,
    feelsLike,
    band,
    series: series.slice(i).filter((p) => p.time <= time + NOW.seriesHours * HOUR),
  };
}

interface Shown {
  time: number;
  temperature: number;
}

/** The warmest (or coolest) point, the earliest one on a tie. */
function extreme(points: readonly Shown[], sign: 1 | -1): Shown | null {
  let best: Shown | null = null;
  for (const p of points) if (!best || sign * (p.temperature - best.temperature) > 0) best = p;
  return best;
}

/** "3pm" for a moment, in the place's own time zone. */
function hourLabel(time: number, timezone: string): string {
  return formatHour(Math.floor(localDateTime(timezone, new Date(time)).hours));
}

/**
 * Where the temperature goes next, as shown (rounded):
 * "Rising to 24° around 3pm." / "Cooling to 12° by 9pm." / "Little change for the next few hours."
 */
export function trendLine(now: NowComputation, timezone: string): string {
  const show = (p: Shown): Shown => ({ time: p.time, temperature: roundTemp(p.temperature) });
  const current = roundTemp(now.temperature);
  const today = localDateTime(timezone, new Date(now.time)).date;
  const ahead = now.series.filter((p) => p.time > now.time);
  const restOfToday = ahead
    .filter((p) => localDateTime(timezone, new Date(p.time)).date === today)
    .map(show);
  const next12 = ahead.filter((p) => p.time <= now.time + 12 * HOUR).map(show);

  const peak = extreme(restOfToday, 1);
  if (peak && peak.temperature >= current + 1) {
    return `Rising to ${peak.temperature}° around ${hourLabel(peak.time, timezone)}.`;
  }
  const low = extreme(next12, -1);
  if (low && low.temperature <= current - 1) {
    return `Cooling to ${low.temperature}° by ${hourLabel(low.time, timezone)}.`;
  }
  const high = extreme(next12, 1);
  if (high && high.temperature >= current + 1) {
    return `Rising to ${high.temperature}° by ${hourLabel(high.time, timezone)}.`;
  }
  return 'Little change for the next few hours.';
}

/** The rows for the next hours list: the next full hour, then every few hours after it. */
export function nextRows(now: NowComputation): ApiNowPoint[] {
  const first = now.series.find((p) => p.time > now.time);
  if (!first) return [];
  const rows: ApiNowPoint[] = [];
  for (let k = 0; k < NOW.rows; k++) {
    const p = now.series.find((q) => q.time === first.time + k * NOW.stepHours * HOUR);
    if (p) rows.push(p);
  }
  return rows;
}

export function formatNow(now: NowComputation, timezone: string): ApiNow {
  const temperature = roundTemp(now.temperature);
  const feelsLike = roundTemp(now.feelsLike);
  return {
    time: new Date(now.time).toISOString(),
    band: now.band,
    answer: ANSWERS[now.band],
    verdict: VERDICTS[now.band],
    temperature,
    feelsLike,
    detail: `${temperature}° now, feels like ${feelsLike}°. ${trendLine(now, timezone)}`,
    hours: nextRows(now).map((p) => ({
      time: new Date(p.time).toISOString(),
      label: hourLabel(p.time, timezone),
      temperature: roundTemp(p.temperature),
    })),
    series: now.series.map((p) => ({ ...p })),
  };
}
