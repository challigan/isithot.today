/**
 * "Will it snow?": units, and the one rule for how much of an hour's precipitation falls as snow.
 * The wet topic uses the same rule (rainDay.ts, rainNow.ts, the providers' daily totals), so the
 * two toggles never disagree about rain and snow. The day, hour and week live in snowDay.ts,
 * snowNow.ts and snowWeek.ts; the browser loads only this file and snowNow.ts.
 */
import { BLEND, RAIN, SNOW, SNOW_BANDS, type SnowBand } from './config';
import type { HourTemps } from './blend';
import { isFiniteNumber, trimmedMean } from './stats';
import { round1, roundTemp, type Units } from './units';
import type { SnowUnit } from './types';

const CM_PER_INCH = 2.54;

/** Centimetres with °C, inches with °F. */
export function snowUnit(units: Units): SnowUnit {
  return units === 'f' ? 'in' : 'cm';
}

/** Converts centimetres into the snow unit, at full precision. */
export function toSnowUnits(cm: number, unit: SnowUnit): number {
  return unit === 'in' ? cm / CM_PER_INCH : cm;
}

/**
 * Rounds a depth in `unit` for lists and the strip, never returning -0: centimetres to one
 * decimal under 1 and whole from 1; inches to one decimal under 3 and whole from 3.
 */
export function roundSnow(value: number, unit: SnowUnit): number {
  return value < (unit === 'in' ? 3 : 1) ? round1(value) : roundTemp(value);
}

/** "4cm", "0.3cm", "1.5in". Rounds first, so already rounded amounts are unchanged. */
export function snowText(amount: number, unit: SnowUnit): string {
  return `${roundSnow(amount, unit)}${unit}`;
}

export const snowRank = (band: SnowBand): number => SNOW_BANDS.indexOf(band);
/** Snow or more: the answer is Yes. */
export const isSnow = (band: SnowBand): boolean => snowRank(band) >= snowRank('snow');

/**
 * How much of each model's precipitation in one hour falls as snow, mm of water, or null without
 * precipitation. Each model's own snowfall (Open-Meteo's split of rain and snow) counts as water
 * at SNOW.cmPerMm, never more than the hour's precipitation; a model without it is all snow or
 * none by its own temperature (RAIN.snowAtOrBelowC). Nothing falls as snow in an hour whose
 * blended temperature is above SNOW.warmAboveC.
 */
export function snowWater(h: HourTemps): (number | null)[] {
  const temps = h.temps.filter(isFiniteNumber);
  const warm = temps.length > 0 && trimmedMean(temps, BLEND.trimFrom) > SNOW.warmAboveC;
  return (h.rain ?? []).map((p, i) => {
    if (!isFiniteNumber(p)) return null;
    if (warm) return 0;
    const snowfall = h.snow?.[i];
    if (isFiniteNumber(snowfall)) return Math.min(p, snowfall / SNOW.cmPerMm);
    const t = h.temps[i];
    return isFiniteNumber(t) && t <= RAIN.snowAtOrBelowC ? p : 0;
  });
}
