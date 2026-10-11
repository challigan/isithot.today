import { BLEND, NOW, type Band } from './config';
import type { ClimateRange } from './climate';
import type { DayData } from './compute';
import { ANSWERS, VERDICTS, formatHour } from './copy';
import { localDateTime } from './dates';
import { isFiniteNumber, trimmedMean } from './stats';
import { round1, roundTemp, toUnits, type Units } from './units';
import { verdict } from './verdict';
import { hourUv, uvLevel } from './uv';
import type { ApiNow, ApiNowPoint } from './types';

const HOUR = 3_600_000;

/** One forecast hour blended across models, °C. */
export interface SeriesPoint {
  /** Start of the hour, epoch milliseconds (UTC). */
  time: number;
  temperature: number;
  feelsLike: number;
  /** The median UV index of the models that give one, when any does. */
  uv?: number;
}

/**
 * Every forecast hour in order, each blended across the models with the same trimmed mean as
 * the daily highs, with the hour's UV index when there is one. Hours where no model has a
 * temperature are left out.
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
      const uv = hourUv(h);
      points.push({ time: h.time, temperature, feelsLike, ...(uv === null ? {} : { uv }) });
    }
  }
  return points;
}

/**
 * The series as the API sends it: each hour judged with the same verdict as the day's high
 * (so "hot" means the same thing in every view), put in display units to one decimal, and
 * labelled with its local date and hour in the place's time zone. Clients only interpolate
 * between these points; they need neither the verdict rules nor time-zone data.
 */
export function judgeSeries(
  series: readonly SeriesPoint[],
  climate: ClimateRange | null,
  units: Units,
  timezone: string,
): ApiNowPoint[] {
  return series.map((p) => {
    const local = localDateTime(timezone, new Date(p.time));
    return {
      time: p.time,
      date: local.date,
      hour: Math.floor(local.hours),
      temperature: round1(toUnits(p.temperature, units)),
      feelsLike: round1(toUnits(p.feelsLike, units)),
      band: verdict(p.feelsLike, climate).band,
      ...(p.uv === undefined ? {} : { uv: Math.round(p.uv) }),
    };
  });
}

/** The "now" view in display units, before formatting. */
export interface NowComputation {
  /** The moment the values are for, epoch milliseconds. */
  time: number;
  /** The local date of the hour containing the moment. */
  date: string;
  temperature: number;
  feelsLike: number;
  /** The band of the hour nearest the moment. */
  band: Band;
  /** The UV index of the hour containing the moment, when the series has one. */
  uv?: number;
  /** Judged hours from the one containing `time` to a day after it. */
  series: ApiNowPoint[];
}

/**
 * Temperature at a moment: the judged hourly series, interpolated between the hours either
 * side. Null when the series does not cover the moment. Works in whatever units the series
 * is in, so the server and the browser run the same code on the same numbers.
 */
export function computeNow(series: readonly ApiNowPoint[], time: number): NowComputation | null {
  const first = series[0];
  if (!first) return null;
  let i = -1;
  while (i + 1 < series.length && series[i + 1]!.time <= time) i++;
  // A clock a little behind the server's lands before the first hour: use that hour.
  const a = i >= 0 ? series[i]! : time > first.time - HOUR ? first : null;
  if (!a) return null;
  const b = i >= 0 ? series[i + 1] : undefined;
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
    date: a.date,
    temperature,
    feelsLike,
    band,
    // UV is the hour's average, so the hour containing the moment gives it.
    ...(a.uv === undefined ? {} : { uv: a.uv }),
    // One hour before the current one too, so a client whose clock is behind can interpolate.
    series: series.slice(Math.max(0, i - 1)).filter((p) => p.time <= time + NOW.seriesHours * HOUR),
  };
}

interface Shown {
  hour: number;
  temperature: number;
}

/** The warmest (or coolest) point, the earliest one on a tie. */
function extreme(points: readonly Shown[], sign: 1 | -1): Shown | null {
  let best: Shown | null = null;
  for (const p of points) if (!best || sign * (p.temperature - best.temperature) > 0) best = p;
  return best;
}

/**
 * Where the temperature goes next, as shown (rounded):
 * "Rising to 24° around 3pm." / "Cooling to 12° by 9pm." / "Little change for the next few hours."
 */
export function trendLine(now: NowComputation): string {
  const show = (p: ApiNowPoint): Shown => ({ hour: p.hour, temperature: roundTemp(p.temperature) });
  const current = roundTemp(now.temperature);
  const ahead = now.series.filter((p) => p.time > now.time);
  const restOfToday = ahead.filter((p) => p.date === now.date).map(show);
  const next12 = ahead.filter((p) => p.time <= now.time + 12 * HOUR).map(show);

  const peak = extreme(restOfToday, 1);
  if (peak && peak.temperature >= current + 1) {
    return `Rising to ${peak.temperature}° around ${formatHour(peak.hour)}.`;
  }
  const low = extreme(next12, -1);
  if (low && low.temperature <= current - 1) {
    return `Cooling to ${low.temperature}° by ${formatHour(low.hour)}.`;
  }
  const high = extreme(next12, 1);
  if (high && high.temperature >= current + 1) {
    return `Rising to ${high.temperature}° by ${formatHour(high.hour)}.`;
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

export function formatNow(now: NowComputation): ApiNow {
  const temperature = roundTemp(now.temperature);
  const feelsLike = roundTemp(now.feelsLike);
  const out: ApiNow = {
    time: new Date(now.time).toISOString(),
    band: now.band,
    answer: ANSWERS[now.band],
    verdict: VERDICTS[now.band],
    temperature,
    feelsLike,
    detail: `${temperature}° now, feels like ${feelsLike}°. ${trendLine(now)}`,
    hours: nextRows(now).map((p) => ({
      time: new Date(p.time).toISOString(),
      label: formatHour(p.hour),
      temperature: roundTemp(p.temperature),
    })),
    series: now.series.map((p) => ({ ...p })),
  };
  if (now.uv !== undefined) out.uv = { value: now.uv, level: uvLevel(now.uv) };
  return out;
}
