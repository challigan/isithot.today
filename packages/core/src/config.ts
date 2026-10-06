/**
 * Every tunable constant lives here so the verdict, blending and caching can be
 * adjusted without touching logic. The native apps should mirror this file.
 */

export type Band = 'freezing' | 'cold' | 'mild' | 'warm' | 'hot' | 'scorching';

/** Bands from coldest to hottest. The index is used for capping and flooring. */
export const BANDS: readonly Band[] = ['freezing', 'cold', 'mild', 'warm', 'hot', 'scorching'];

export const VERDICT = {
  /** Weight given to the climate-adjusted temperature (0 = absolute only). */
  alpha: 0.5,
  /** Reference climate (roughly lowland UK): coldest and warmest monthly normal highs, °C. */
  refColdHigh: 7,
  refWarmHigh: 21,
  /** Minimum local range (Tw − Tc) so tropical places do not explode the scale, °C. */
  minRange: 8,
  /**
   * Upper edge (inclusive) of each band for the effective temperature E, °C.
   * Anything above `hot` is scorching.
   */
  bandUpper: {
    freezing: 0,
    cold: 10,
    mild: 17,
    warm: 23,
    hot: 31,
  },
  /** Guard rails applied after banding, on the raw feels-like high F, °C. */
  guards: {
    /** F below this can never be hot or scorching (capped at warm). */
    notHotBelow: 18,
    /** F above this can never be cold or freezing (floored at mild). */
    notColdAbove: 25,
    /** F at or below this can never be warmer than cold. */
    atMostColdAtOrBelow: 0,
    /** F at or above this is at least hot. */
    atLeastHotAtOrAbove: 35,
    /** F at or above this is scorching. */
    scorchingAtOrAbove: 40,
  },
} as const;

export const BLEND = {
  /** Models within this many °C of the consensus high "agree". */
  agreeWithinC: 2,
  /** The same tolerance when displaying °F. */
  agreeWithinF: 4,
  /** With this many models or more, drop the single highest and lowest before averaging. */
  trimFrom: 5,
  /** Fewer models than this gives `confidence: "limited"`. */
  minModels: 3,
  /** The strip's data range extends this many display degrees beyond the min and max model. */
  stripPadding: 3,
} as const;

export interface ModelConfig {
  /** Open-Meteo `models=` ID. */
  id: string;
  /** Display name. */
  name: string;
  /**
   * Older or alternative IDs the API may echo back as a response key suffix.
   * Open-Meteo renamed several models (e.g. `gfs_seamless` → `ncep_gfs_seamless`).
   */
  aliases?: readonly string[];
}

/**
 * Forecast models blended into the answer. Checked against the current Open-Meteo
 * docs (open-meteo-website `src/routes/en/docs/options.ts`, October 2026). The spec's
 * `gfs_seamless`, `icon_seamless` and `gem_seamless` now appear in the docs as
 * `ncep_gfs_seamless`, `dwd_icon_seamless` and `cmc_gem_seamless`.
 */
export const MODELS: readonly ModelConfig[] = [
  { id: 'ecmwf_ifs025', name: 'ECMWF' },
  { id: 'ncep_gfs_seamless', name: 'GFS', aliases: ['gfs_seamless'] },
  { id: 'dwd_icon_seamless', name: 'ICON', aliases: ['icon_seamless'] },
  { id: 'ukmo_seamless', name: 'UKMO' },
  { id: 'meteofrance_seamless', name: 'Météo-France' },
  { id: 'metno_seamless', name: 'MET Norway' },
  { id: 'cmc_gem_seamless', name: 'GEM', aliases: ['gem_seamless'] },
  { id: 'jma_seamless', name: 'JMA' },
];

export const GRID = {
  /** Forecast cache cell, degrees (about 5 km). Coordinates are rounded to this before leaving the browser. */
  forecast: 0.05,
  /** Climate normals cache cell, degrees (NASA POWER's native grid is about 0.5°). */
  climate: 0.5,
} as const;

export const CACHE = {
  /** Forecast data is fresh for this long, seconds. */
  forecastFresh: 30 * 60,
  /** Forecast data may be served as a stale fallback for this long, seconds. */
  forecastStale: 6 * 60 * 60,
  /** Search results, seconds. */
  search: 7 * 24 * 60 * 60,
  /** Failed climate lookups are not retried for this long, seconds. */
  climateFailure: 60 * 60,
  /** Edge HTTP cache for API responses, seconds. */
  edgeMaxAge: 600,
  /** City pages and OG images, seconds. */
  cityPage: 600,
  ogImage: 30 * 60,
  /** The browser shows the last answer from localStorage when it is younger than this, ms. */
  localAnswerMaxAgeMs: 3 * 60 * 60 * 1000,
} as const;

export const RATE_LIMIT = {
  /** Requests per window per IP on each API endpoint. */
  windowLimit: 60,
  /** Window size, seconds. */
  windowSize: 60,
} as const;

export const SEARCH = {
  minChars: 2,
  maxResults: 8,
  debounceMs: 250,
} as const;

/**
 * Countries that use °F by default. The spec asks for the US; its territories and the
 * handful of other countries that use Fahrenheit day to day are included too.
 */
export const FAHRENHEIT_COUNTRIES: readonly string[] = [
  'US',
  'PR',
  'GU',
  'VI',
  'AS',
  'MP',
  'UM',
  'BS',
  'BZ',
  'KY',
  'LR',
  'PW',
  'FM',
  'MH',
];

export interface Palette {
  g1: string;
  g2: string;
  g3: string;
  ink: string;
}

export const PALETTES: Record<Band, Palette> = {
  freezing: { g1: '#12305a', g2: '#2a5d96', g3: '#b9dcf7', ink: '#ffffff' },
  cold: { g1: '#2b3f5c', g2: '#5a7896', g3: '#c9d6e2', ink: '#ffffff' },
  mild: { g1: '#dfeadf', g2: '#a9c7b4', g3: '#fff6d6', ink: '#1d3328' },
  warm: { g1: '#ffe2bd', g2: '#f4ad66', g3: '#fff4c8', ink: '#40200a' },
  hot: { g1: '#e8571f', g2: '#b3211b', g3: '#ffd36b', ink: '#ffffff' },
  scorching: { g1: '#a3122a', g2: '#5c0a2e', g3: '#ff9a3c', ink: '#ffffff' },
};

/** Neutral slate shown while loading. */
export const LOADING_PALETTE: Palette = {
  g1: '#3a4350',
  g2: '#59636f',
  g3: '#aab3bd',
  ink: '#ffffff',
};
