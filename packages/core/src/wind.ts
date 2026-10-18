/**
 * "Is it windy?": units, bands and the names of directions. A band is reached by its mean wind or
 * its gust, whichever gets there first (WIND in config.ts), always on whole km/h, so the number
 * shown in either unit agrees with the band. The day, hour and week live in windDay.ts,
 * windNow.ts and windWeek.ts, and the judging of directions in windDirection.ts; the browser
 * loads only this file and windNow.ts.
 */
import { COMPASS_POINTS, WIND, WIND_BANDS, type Compass, type WindBand } from './config';
import { windFromWords } from './copy';
import { isFiniteNumber } from './stats';
import { round1 } from './units';
import type { ApiWindDirection, WindUnit } from './types';

/** Kilometres in a mile: an mph value is km/h ÷ this. */
export const KMH_PER_MPH = 1.609344;

/**
 * A speed in the wind unit: whole km/h first, then whole mph from that whole number, so a value
 * shown in either unit is on the same side of every band edge (each edge in WIND converts so).
 */
export function toWindUnits(kmh: number, unit: WindUnit): number {
  const whole = Math.round(kmh);
  return unit === 'mph' ? Math.round(whole / KMH_PER_MPH) : whole;
}

/** The same to one decimal (from whole km/h), for positioning on the strip. */
export function windValue(kmh: number, unit: WindUnit): number {
  const whole = Math.round(kmh);
  return unit === 'mph' ? round1(whole / KMH_PER_MPH) : whole;
}

/** "45mph", "72km/h": a speed already in `unit`. */
export function windText(speed: number, unit: WindUnit): string {
  return `${speed}${unit === 'mph' ? 'mph' : 'km/h'}`;
}

export const windRank = (band: WindBand): number => WIND_BANDS.indexOf(band);
/** Windy or more: the answer is Yes. */
export const isWindy = (band: WindBand): boolean => windRank(band) >= windRank('windy');

/** The band for a mean wind and a gust, whole km/h: the highest band either reaches. */
export function windBand(mean: number, gust: number): WindBand {
  let band: WindBand = 'calm';
  for (const b of WIND_BANDS.slice(1) as Exclude<WindBand, 'calm'>[]) {
    if (mean >= WIND.from[b].mean || gust >= WIND.from[b].gust) band = b;
  }
  return band;
}

/** Still air: a mean wind and a gust below WIND.still (calm in Beaufort's sense). */
export function isStill(mean: number, gust: number): boolean {
  return mean < WIND.still.mean && gust < WIND.still.gust;
}

/** The gust range of a band, whole km/h, for the strip's zone: `to` is null for storm. */
export function gustRange(band: WindBand): { from: number; to: number | null } {
  const next = WIND_BANDS[windRank(band) + 1] as Exclude<WindBand, 'calm'> | undefined;
  return {
    from: band === 'calm' ? 0 : WIND.from[band].gust,
    to: next ? WIND.from[next].gust : null,
  };
}

/** Whole degrees from 0 to 359. */
export const wholeDegrees = (degrees: number): number => ((Math.round(degrees) % 360) + 360) % 360;

/** The nearest of the eight compass points, from whole degrees: 23° to 67° is north-east. */
export function compassPoint(degrees: number): Compass {
  return COMPASS_POINTS[Math.round(wholeDegrees(degrees) / 45) % COMPASS_POINTS.length]!;
}

/**
 * A judged direction (whole degrees, meanDirection in windDirection.ts) as the API gives it:
 * degrees, compass point and words.
 */
export function windDirection(degrees: number): ApiWindDirection {
  const compass = compassPoint(degrees);
  return { degrees: wholeDegrees(degrees), compass, words: windFromWords(compass) };
}

/**
 * The API's `direction` field for a judged direction: the direction, null when variable, or no
 * field at all without one, so answers from forecasts without directions keep their shape.
 */
export function directionField(dir: number | null | undefined): {
  direction?: ApiWindDirection | null;
} {
  if (dir === undefined) return {};
  return { direction: dir === null ? null : windDirection(dir) };
}

/** "from the south-west" for a judged direction, or null when it is variable or unknown. */
export function directionWords(dir: number | null | undefined): string | null {
  return isFiniteNumber(dir) ? windFromWords(compassPoint(dir)) : null;
}
