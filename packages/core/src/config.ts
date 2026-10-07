/**
 * Every tunable constant lives here so the verdict, blending and caching can be
 * adjusted without touching logic. The native apps should mirror this file.
 */

import { RAIN_PALETTES } from './palettes';

export type Band = 'freezing' | 'cold' | 'mild' | 'warm' | 'hot' | 'scorching';

/** Bands from coldest to hottest. The index is used for capping and flooring. */
export const BANDS: readonly Band[] = ['freezing', 'cold', 'mild', 'warm', 'hot', 'scorching'];

/** The two questions: "Is it hot?" and "Is it wet?". */
export type Topic = 'hot' | 'wet';
export const TOPICS: readonly Topic[] = ['hot', 'wet'];

/**
 * One site per topic, served by the same deploy: the domain a visitor arrives on decides which
 * topic the page opens on. Canonical URLs, robots.txt and sitemaps use these, never the deploy URL.
 */
export const SITES: Record<Topic, { name: string; url: string }> = {
  hot: { name: 'isithot.today', url: 'https://isithot.today' },
  wet: { name: 'isitwet.today', url: 'https://isitwet.today' },
};

/** The topic a host serves: isitwet.today (and www) is wet; everything else opens on hot. */
export function hostTopic(hostname: string): Topic {
  return hostname === SITES.wet.name || hostname === `www.${SITES.wet.name}` ? 'wet' : 'hot';
}

/** Whether a host is one of the real sites (not a deploy preview or a local server). */
export function isSiteHost(hostname: string): boolean {
  return TOPICS.some((t) => hostname === SITES[t].name || hostname === `www.${SITES[t].name}`);
}

/**
 * Where a link to `path` ("/", "/in/london-gb", "/?lat=…") goes for a topic. On the real sites
 * a link for the other topic crosses to its domain; anywhere else (deploy previews, a local
 * server) both topics live on one host and wet pages sit under /wet.
 */
export function sitePath(topic: Topic, path: string, hostname: string): string {
  if (isSiteHost(hostname))
    return hostTopic(hostname) === topic ? path : `${SITES[topic].url}${path}`;
  if (topic === 'hot') return path;
  return path === '/' ? '/wet' : path.startsWith('/?') ? `/wet${path.slice(1)}` : `/wet${path}`;
}

/** Rain bands from driest to wettest. */
export type RainBand = 'dry' | 'spots' | 'showers' | 'rain' | 'heavy' | 'drenched';
export const RAIN_BANDS: readonly RainBand[] = [
  'dry',
  'spots',
  'showers',
  'rain',
  'heavy',
  'drenched',
];

/**
 * How rain is judged. Every model gives its own total for a window (a whole day, the rest of
 * today, one hour or two); the share of models with at least the window's "wet" amount is the
 * chance of rain, and the median total is the amount.
 */
export const RAIN = {
  /**
   * Thresholds for one hour and for a whole day, mm. A window of h hours (the rest of today, or
   * a 2-hour block) uses the hourly value × h, capped at the day value, so a short window is
   * never judged against a whole day's worth of rain. Hourly heavy and drenched sit below the
   * usual 4 and 10 mm/h because several models are 3- or 6-hourly upstream and Open-Meteo
   * spreads their totals evenly over the hours.
   */
  hour: { wet: 0.2, spots: 0.1, heavy: 3, drenched: 8 },
  day: { wet: 1, spots: 0.2, heavy: 10, drenched: 25 },
  /** Share of models expecting rain for "Maybe" (showers), and for "Yes". */
  maybeFrom: 0.25,
  likelyFrom: 0.6,
  /** A model's 2-hour block is wet with at least this much rain, mm (the Now view's rows). */
  blockWet: 0.2,
  /** Rain in the current hour under this much is "light rain" (or "light snow"), mm. */
  lightBelow: 0.5,
  /** Hours where at least this share of models has rain are the "likely" hours. */
  hourLikely: 0.5,
  /** Without a likely hour, the wettest hour is named only from this share up. */
  hourPossible: 0.375,
  /** Rain in an hour at or below this blended temperature counts as snow, °C. */
  snowAtOrBelowC: 1,
  /** Share of a window's rain that falls as snow for "snow", and for "some may fall as snow". */
  snowFrom: 0.5,
  snowSomeFrom: 0.2,
  /** The model strip's scale never ends below this, so a dry day still shows the wet zone. */
  scaleFloor: { mm: 5, in: 0.2 },
  /** This week: rain days for a wet week, showery days for an unsettled one, days named at most. */
  week: { wetFrom: 4, unsettledFrom: 4, nameDays: 3 },
  /**
   * Comparing a week's rain with normal (NASA POWER PRECTOTCORR), mm. Wetter needs 1.5× normal and
   * 5 mm more; drier needs half and 5 mm less. Weeks where both are tiny say nothing, or "dry, as
   * usual" under 2 mm, so a dry climate's 0.3 mm is never called "wetter than usual".
   */
  normals: {
    wetterRatio: 1.5,
    drierRatio: 0.5,
    minDifference: 5,
    compareFrom: 5,
    usualDryBelow: 2,
  },
} as const;

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

export const FORECAST = {
  /** Days requested: today plus the next six, for the "this week" view. */
  days: 7,
  /**
   * A model's day counts only with hourly values for every hour in this local window, so a
   * forecast that ends mid-morning cannot pass off a morning reading as the day's high.
   */
  coverFromHour: 10,
  coverToHour: 18,
} as const;

export const NOW = {
  /** Rows in the "next hours" list, and the hours between them. */
  rows: 6,
  stepHours: 2,
  /** Hours of blended forecast sent with the answer so clients can keep "now" current. */
  seriesHours: 24,
} as const;

export const WEEK = {
  /** Days need at least this many models to count towards the week. */
  minModels: 3,
  /** Without this many usable days there is no week answer. */
  minDays: 5,
} as const;

/**
 * From this local hour at the place until midnight, the middle view answers for tomorrow
 * instead of today, and the page opens on Now.
 */
export const TOMORROW_FROM_HOUR = 18;

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
  /**
   * Climate normals cell, degrees. NASA POWER serves MERRA-2 data on a 0.5° × 0.625° grid;
   * snapping to its cell centres makes each request (and cache entry) one real grid cell.
   */
  climate: { lat: 0.5, lon: 0.625 },
} as const;

export const CACHE = {
  /**
   * Forecast data is fresh for this long, seconds. The global models update every 6 hours,
   * and "now" is worked out from the hourly forecast at request time, so an hour costs
   * nothing in accuracy and halves calls to Open-Meteo.
   */
  forecastFresh: 60 * 60,
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
  /**
   * Version of that saved answer (page markup and data). The page's inline restore script and
   * the app both read it, so bump it here whenever the saved markup or data changes shape.
   */
  snapshotVersion: 4,
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
  /** Gradient top-left and bottom-right, and the glow at the top right. */
  g1: string;
  g2: string;
  g3: string;
  /** Text and icons. */
  ink: string;
  /**
   * Backing for controls that sit on the glow (tabs, place, units), and the text colour on an
   * ink-filled selected control: the gradient colour with the most contrast against `ink`.
   */
  pill: string;
  /** Strength of the glow at its centre, as a CSS percentage. */
  glow: string;
}

export const PALETTES: Record<Band, Palette> = {
  freezing: {
    g1: '#12305a',
    g2: '#2a5d96',
    g3: '#b9dcf7',
    ink: '#ffffff',
    pill: '#12305a',
    glow: '60%',
  },
  cold: {
    g1: '#2b3f5c',
    g2: '#5a7896',
    g3: '#c9d6e2',
    ink: '#ffffff',
    pill: '#2b3f5c',
    glow: '45%',
  },
  mild: {
    g1: '#dfeadf',
    g2: '#a9c7b4',
    g3: '#fff6d6',
    ink: '#1d3328',
    pill: '#dfeadf',
    glow: '85%',
  },
  warm: {
    g1: '#ffe2bd',
    g2: '#f4ad66',
    g3: '#fff4c8',
    ink: '#40200a',
    pill: '#ffe2bd',
    glow: '85%',
  },
  hot: {
    g1: '#cc3d17',
    g2: '#a51c17',
    g3: '#ff9a4a',
    ink: '#ffffff',
    pill: '#a51c17',
    glow: '40%',
  },
  scorching: {
    g1: '#a3122a',
    g2: '#5c0a2e',
    g3: '#ff9a3c',
    ink: '#ffffff',
    pill: '#5c0a2e',
    glow: '70%',
  },
};

export { RAIN_PALETTES };

/** The palette for a hot or a rain band. */
export function paletteFor(band: Band | RainBand): Palette {
  return (PALETTES as Record<string, Palette>)[band] ?? RAIN_PALETTES[band as RainBand];
}

/** Neutral slate shown while loading. */
export const LOADING_PALETTE: Palette = {
  g1: '#3a4350',
  g2: '#59636f',
  g3: '#aab3bd',
  ink: '#ffffff',
  pill: '#3a4350',
  glow: '85%',
};
