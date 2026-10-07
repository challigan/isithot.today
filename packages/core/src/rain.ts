/**
 * "Is it wet?": the shared parts of judging rain. Every model gives its own total for a window
 * (the rest of today, a whole day, an hour); the share of models with at least the window's wet
 * amount is the chance of rain and the median total is the amount (RAIN in config.ts). The
 * day, hour and week live in rainDay.ts, rainNow.ts and rainWeek.ts, so the browser loads only
 * the hour's code it needs.
 */
import { RAIN, RAIN_BANDS, type RainBand } from './config';
import { round1, roundTemp, type Units } from './units';
import type { RainUnit } from './types';

export const HOUR = 3_600_000;
const MM_PER_INCH = 25.4;
/** Sums of hourly amounts are compared with a little slack, so 0.1 + 0.2 still reaches 0.3. */
export const EPSILON = 1e-9;

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

export const atLeast = (value: number, min: number): boolean => value >= min - EPSILON;
export const rank = (band: RainBand): number => RAIN_BANDS.indexOf(band);
export const isRain = (band: RainBand): boolean => rank(band) >= rank('rain');

/** The middle value, or the mean of the middle two. Callers guarantee at least one value. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Share of the values at or above `min`. */
export function shareAtLeast(values: readonly number[], min: number): number {
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

export function snowAmount(share: number): SnowAmount {
  if (share >= RAIN.snowFrom) return 'most';
  return share >= RAIN.snowSomeFrom ? 'some' : 'none';
}

/** Rain or wetter that falls as snow. */
export const snowy = (band: RainBand, snow: boolean): boolean => snow && isRain(band);
