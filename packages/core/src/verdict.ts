import { BANDS, VERDICT, type Band } from './config';
import type { ClimateRange } from './climate';

/**
 * Maps the feels-like high F onto the reference climate, then blends it half-and-half with
 * the absolute value. Without normals the result is F itself (α = 0).
 */
export function effectiveTemperature(feelsLike: number, climate: ClimateRange | null): number {
  if (!climate) return feelsLike;
  const range = Math.max(climate.warmest - climate.coldest, VERDICT.minRange);
  const ref =
    VERDICT.refColdHigh +
    ((feelsLike - climate.coldest) * (VERDICT.refWarmHigh - VERDICT.refColdHigh)) / range;
  return VERDICT.alpha * ref + (1 - VERDICT.alpha) * feelsLike;
}

export function bandFor(effective: number): Band {
  const edges = VERDICT.bandUpper;
  if (effective <= edges.freezing) return 'freezing';
  if (effective <= edges.cold) return 'cold';
  if (effective <= edges.mild) return 'mild';
  if (effective <= edges.warm) return 'warm';
  if (effective <= edges.hot) return 'hot';
  return 'scorching';
}

const rank = (band: Band): number => BANDS.indexOf(band);
const atMost = (band: Band, cap: Band): Band => (rank(band) > rank(cap) ? cap : band);
const atLeast = (band: Band, floor: Band): Band => (rank(band) < rank(floor) ? floor : band);

/** Absolute guard rails on the raw feels-like high, applied after banding. */
export function applyGuards(band: Band, feelsLike: number): Band {
  const g = VERDICT.guards;
  let result = band;
  if (feelsLike < g.notHotBelow) result = atMost(result, 'warm');
  if (feelsLike <= g.atMostColdAtOrBelow) result = atMost(result, 'cold');
  if (feelsLike > g.notColdAbove) result = atLeast(result, 'mild');
  if (feelsLike >= g.atLeastHotAtOrAbove) result = atLeast(result, 'hot');
  if (feelsLike >= g.scorchingAtOrAbove) result = 'scorching';
  return result;
}

export interface Verdict {
  band: Band;
  /** Effective temperature E, °C, full precision. */
  effective: number;
  /** Whether local climate normals were used. */
  climateAdjusted: boolean;
}

export function verdict(feelsLike: number, climate: ClimateRange | null): Verdict {
  const effective = effectiveTemperature(feelsLike, climate);
  return {
    band: applyGuards(bandFor(effective), feelsLike),
    effective,
    climateAdjusted: climate !== null,
  };
}
