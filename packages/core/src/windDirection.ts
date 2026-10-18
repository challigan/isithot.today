/**
 * "Is it windy?": judging where the wind blows from. Each model gives a direction at 10 m every
 * hour, in meteorological degrees (where the wind comes from, clockwise from north). Angles are
 * never averaged, as 350° and 10° would make 180°, the opposite wind: each direction is a vector
 * as long as its wind speed, their sum points the mean way, and its length against the speeds'
 * sum says how far they agree. Server and preview only (windDay.ts): the browser only names the
 * whole degrees the server sends (windDirection in wind.ts), so both always say the same.
 */
import { WIND } from './config';
import type { HourTemps } from './blend';
import { median } from './rain';
import { isFiniteNumber } from './stats';
import { wholeDegrees } from './wind';

/** One model's wind at one moment: its speed (km/h) and the direction it blows from, degrees. */
export interface WindVector {
  speed: number;
  from: number;
}

/**
 * The mean direction of several winds (models, or models over hours), whole degrees, or null when
 * it is variable: their median speed (as the wind shown is) is under WIND.direction.fromMean, so
 * a couple of strong models cannot lend still air their direction, or their speed-weighted
 * vectors point so many ways that the resultant is shorter than WIND.direction.agreement of the
 * speeds' sum (two equal winds from opposite sides cancel out). A strong wind counts for more
 * than a light one. Null without any wind.
 */
export function meanDirection(winds: readonly WindVector[]): number | null {
  let east = 0;
  let north = 0;
  let total = 0;
  for (const w of winds) {
    const angle = (w.from * Math.PI) / 180;
    east += w.speed * Math.sin(angle);
    north += w.speed * Math.cos(angle);
    total += w.speed;
  }
  const { fromMean, agreement } = WIND.direction;
  if (winds.length === 0 || median(winds.map((w) => w.speed)) < fromMean) return null;
  if (Math.hypot(east, north) < agreement * total) return null;
  return wholeDegrees((Math.atan2(east, north) * 180) / Math.PI);
}

/** The winds of an hour with both a speed and a direction, every model's or only `index`'s. */
export function hourWinds(h: HourTemps, index?: number): WindVector[] {
  const winds: WindVector[] = [];
  (h.dir ?? []).forEach((from, i) => {
    const speed = h.wind?.[i];
    if ((index === undefined || i === index) && isFiniteNumber(from) && isFiniteNumber(speed)) {
      winds.push({ speed, from });
    }
  });
  return winds;
}

/**
 * The direction over some hours, across every model or only model `index`: whole degrees, null
 * when variable, or undefined when none of the hours has a direction to judge.
 */
export function directionOver(
  hours: readonly HourTemps[],
  index?: number,
): number | null | undefined {
  const winds = hours.flatMap((h) => hourWinds(h, index));
  return winds.length === 0 ? undefined : meanDirection(winds);
}
