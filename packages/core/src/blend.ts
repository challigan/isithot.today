import { BLEND } from './config';
import { isFiniteNumber, mean, trimmedMean } from './stats';

export type Confidence = 'good' | 'limited';

/** One model's daily values for a single local day, °C. */
export interface ModelDay {
  id: string;
  name: string;
  high: number | null;
  feelsLike: number | null;
  /**
   * Total rain (precipitation, water equivalent) over the local day, mm, or null unless the model
   * has a value for every hour of the day. Absent for forecasts recorded without precipitation.
   */
  rain?: number | null;
  /** The part of `rain` that falls as snow (water equivalent, by snowWater in snow.ts), mm. */
  snow?: number | null;
  /** The same snow as depth, cm (SNOW.cmPerMm). */
  snowfall?: number | null;
  /**
   * The lowest temperature over the local day, °C, or null unless the model has every hour.
   * Present with precipitation, for the snow topic ("Too warm for snow.").
   */
  low?: number | null;
  /**
   * The strongest mean wind and the strongest gust over the day's waking hours (WIND.day), km/h,
   * or null unless the model has both for every one of those hours (dailyWind in windDay.ts). Kept
   * here because the server drops later days' hours before caching. Absent for forecasts recorded
   * without wind.
   */
  wind?: number | null;
  gust?: number | null;
  /** The mean of the day's 24 hourly wind speeds, km/h (for normals), or null without them all. */
  windMean?: number | null;
}

/** Hourly temperatures across all models for one local hour, °C. */
export interface HourTemps {
  /** Local hour of day, 0–23. */
  hour: number;
  /** Start of the hour, epoch milliseconds (UTC). */
  time: number;
  temps: readonly (number | null)[];
  /** Hourly apparent (feels-like) temperature per model, in the same order as `temps`. */
  feels?: readonly (number | null)[];
  /**
   * Rain per model during this hour (from `time` to an hour later), mm, in the same order as
   * `temps`. Open-Meteo labels precipitation with the end of the hour it fell in; the parser
   * moves it to the hour's start so it lines up with everything else here.
   */
  rain?: readonly (number | null)[];
  /**
   * Open-Meteo's snowfall per model during this hour, cm, moved to the hour's start as `rain` is.
   * Absent for forecasts recorded without it (judged by temperature instead).
   */
  snow?: readonly (number | null)[];
  /**
   * The UV index per model during this hour, null for the models that give none (most). Open-Meteo
   * labels it with the end of the hour it averages, so the parser moves it to the hour's start as
   * it does `rain`. Absent for forecasts recorded without it.
   */
  uv?: readonly (number | null)[];
  /**
   * The mean wind per model at 10 m, km/h: instant, at the hour's start (`time`), as the
   * temperatures are. Absent for forecasts recorded without wind.
   */
  wind?: readonly (number | null)[];
  /**
   * The strongest gust per model during this hour, km/h. Open-Meteo labels gusts with the end of
   * the hour they are the maximum of, so the parser moves them to the hour's start as it does
   * `rain`. Absent for forecasts recorded without wind.
   */
  gust?: readonly (number | null)[];
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
