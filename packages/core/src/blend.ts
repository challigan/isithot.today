import { BLEND } from './config';
import { isFiniteNumber, mean, trimmedMean } from './stats';

export type Confidence = 'good' | 'limited';

/** One model's daily values for a single local day, °C. */
export interface ModelDay {
  id: string;
  name: string;
  high: number | null;
  feelsLike: number | null;
}

/** Hourly temperatures across all models for one local hour, °C. */
export interface HourTemps {
  /** Local hour of day, 0–23. */
  hour: number;
  temps: readonly (number | null)[];
}

export interface BlendedModel {
  id: string;
  name: string;
  high: number;
}

export interface Blend {
  /** Consensus actual high, °C, full precision. */
  high: number;
  /** Consensus feels-like high, °C, full precision. */
  feelsLike: number;
  /** Local hour with the highest mean temperature across models, or null without hourly data. */
  peakHour: number | null;
  confidence: Confidence;
  /** Models that returned a value for the day. */
  models: BlendedModel[];
}

/**
 * Blends every model that returned data into one consensus. Returns null when no model
 * has a value for the day.
 */
export function blend(
  models: readonly ModelDay[],
  hourly: readonly HourTemps[] = [],
): Blend | null {
  const withHigh: BlendedModel[] = [];
  for (const m of models) {
    if (isFiniteNumber(m.high)) withHigh.push({ id: m.id, name: m.name, high: m.high });
  }
  if (withHigh.length === 0) return null;

  const high = trimmedMean(
    withHigh.map((m) => m.high),
    BLEND.trimFrom,
  );

  const feels = models.map((m) => m.feelsLike).filter(isFiniteNumber);
  const feelsLike = feels.length > 0 ? trimmedMean(feels, BLEND.trimFrom) : high;

  return {
    high,
    feelsLike,
    peakHour: peakHour(hourly),
    confidence: withHigh.length >= BLEND.minModels ? 'good' : 'limited',
    models: withHigh,
  };
}

/** The local hour whose mean temperature across models is highest. Ties go to the earlier hour. */
export function peakHour(hourly: readonly HourTemps[]): number | null {
  let best: number | null = null;
  let bestValue = -Infinity;
  for (const h of hourly) {
    const temps = h.temps.filter(isFiniteNumber);
    if (temps.length === 0) continue;
    const value = mean(temps);
    if (value > bestValue) {
      bestValue = value;
      best = h.hour;
    }
  }
  return best;
}

export interface Agreement {
  agrees: boolean[];
  count: number;
}

/**
 * Which values sit within `tolerance` of the consensus. Values and tolerance must be in the
 * same units (±2 for °C, ±4 for °F).
 */
export function agreement(
  values: readonly number[],
  consensus: number,
  tolerance: number,
): Agreement {
  const agrees = values.map((v) => Math.abs(v - consensus) <= tolerance + 1e-9);
  return { agrees, count: agrees.filter(Boolean).length };
}
