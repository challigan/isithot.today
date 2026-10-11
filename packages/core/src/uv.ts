/**
 * The UV index on the hot views. A few forecast models give an hourly UV index and most give
 * none, so each hour's value is the median of those that do, and a day's is its highest hour.
 * Levels are WHO's five steps (UV in config.ts).
 */
import { FORECAST, UV, UV_LEVELS, type UvLevel } from './config';
import type { HourTemps } from './blend';
import { formatHour } from './copy';
import { median } from './rain';
import { isFiniteNumber } from './stats';
import type { ApiUvDay } from './types';

/** Low to extreme, decided on the index rounded to a whole number. */
export function uvLevel(value: number): UvLevel {
  const index = Math.round(value);
  let level: UvLevel = 'low';
  for (const l of UV_LEVELS.slice(1)) if (index >= UV.from[l as Exclude<UvLevel, 'low'>]) level = l;
  return level;
}

/** The median UV index of the models that give one for the hour, or null when none does. */
export function hourUv(hour: HourTemps): number | null {
  const values = (hour.uv ?? []).filter(isFiniteNumber);
  return values.length > 0 ? median(values) : null;
}

/** A day's UV index at full precision, before formatting. */
export interface UvDay {
  /** The highest hourly UV index. */
  max: number;
  /** The local hour it starts (the earlier one on a tie). */
  peakHour: number;
}

/**
 * The day's highest hourly UV index and when it is, or null unless every hour of the covered
 * afternoon window has one (as for highs), so a forecast that ends mid-morning cannot pass off a
 * morning value as the day's.
 */
export function dayUv(hourly: readonly HourTemps[]): UvDay | null {
  let best: UvDay | null = null;
  let covered = 0;
  for (const h of hourly) {
    const value = hourUv(h);
    if (value === null) continue;
    if (h.hour >= FORECAST.coverFromHour && h.hour <= FORECAST.coverToHour) covered++;
    if (!best || value > best.max) best = { max: value, peakHour: h.hour };
  }
  return covered === FORECAST.coverToHour - FORECAST.coverFromHour + 1 ? best : null;
}

/** The API's day UV: rounded, its level, and when it peaks ("1pm"), with no peak at 0. */
export function formatUvDay(uv: UvDay): ApiUvDay {
  const max = Math.round(uv.max);
  return { max, level: uvLevel(max), peak: max > 0 ? formatHour(uv.peakHour) : null };
}
