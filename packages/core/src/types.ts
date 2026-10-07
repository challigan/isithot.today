/**
 * The /api/v1 contract shared by the website and the future apps. Never change the meaning
 * of a field; add fields or create /api/v2.
 */
import type { Band, RainBand } from './config';
import type { Confidence } from './blend';
import type { Units } from './units';

export type LocationSource = 'device' | 'ip' | 'search' | 'city';

export interface ApiLocation {
  name: string;
  region: string | null;
  country: string | null;
  lat: number;
  lon: number;
  timezone: string;
  source: LocationSource;
  /** City page slug when the place is in cities.json. */
  slug?: string;
  /** GeoNames ID when known (used for BBC Weather deep links). */
  geonameId?: number;
}

export interface ApiModel {
  id: string;
  name: string;
  /** Rounded high in display units. */
  high: number;
  /** High to one decimal in display units (for positioning on the strip). */
  value: number;
  agrees: boolean;
}

export interface ApiConsensus {
  value: number;
  agree: number;
  total: number;
  bandLow: number;
  bandHigh: number;
  confidence: Confidence;
}

export interface ApiDay {
  date: string;
  band: Band;
  answer: string;
  verdict: string;
  high: number;
  feelsLike: number;
  peakTime: string | null;
  normalHigh: number | null;
  anomaly: number | null;
  detail: string;
  consensus: ApiConsensus;
  models: ApiModel[];
  /** Month name for the date, e.g. "October". */
  month: string;
  /** "5 of 6 forecasts agree within 2°". */
  agreementText: string;
  /** "Limited forecast data" when fewer than 3 models returned data, otherwise null. */
  limitedText: string | null;
  /** Accessible summary of the model strip. */
  stripSummary: string;
  /** Data range for the strip labels (min and max model ±3°), display units. */
  scale: { min: number; max: number };
}

/** One row in the now view's "next hours" list, in display units. */
export interface ApiNowHour {
  /** Start of the hour, ISO 8601 UTC. */
  time: string;
  /** Local time, "3pm". */
  label: string;
  temperature: number;
}

/** One blended forecast hour, judged by the server, for recomputing "now" later. */
export interface ApiNowPoint {
  /** Start of the hour, epoch milliseconds. */
  time: number;
  /** Local date (YYYY-MM-DD) and hour (0–23) in the place's time zone. */
  date: string;
  hour: number;
  /** Display units, one decimal. */
  temperature: number;
  feelsLike: number;
  /** The verdict for this hour, judged like a day's high. */
  band: Band;
}

/** The "now" view: the blended forecast at the current moment. Display units. */
export interface ApiNow {
  /** The moment the values are for, ISO 8601 UTC. */
  time: string;
  band: Band;
  answer: string;
  verdict: string;
  temperature: number;
  feelsLike: number;
  detail: string;
  /** The next few hours, every couple of hours. */
  hours: ApiNowHour[];
  /**
   * The judged hourly forecast from the current hour to a day ahead, so clients can keep
   * "now" current between requests: interpolate the temperatures and take the band of the
   * nearest hour (core `computeNow` and `formatNow`).
   */
  series: ApiNowPoint[];
}

/** One day in the week view, in display units. */
export interface ApiWeekDay {
  date: string;
  /** "Today", then short weekday names ("Thu"). */
  label: string;
  high: number;
  band: Band;
  /** "Hot", "Mild"… */
  bandLabel: string;
}

/** The "this week" view: today and the next six days, averaged. Display units. */
export interface ApiWeek {
  /** First and last dates averaged (YYYY-MM-DD). */
  from: string;
  to: string;
  band: Band;
  answer: string;
  /** "A warm week, not hot." / "A mild week, but hot on Thu and Fri." */
  verdict: string;
  /** Average of the daily highs. */
  high: number;
  /** The lowest and highest of the daily highs. */
  highs: { min: number; max: number };
  /** Average of the daily feels-like highs (the verdict is judged on this). */
  feelsLike: number;
  normalHigh: number | null;
  anomaly: number | null;
  detail: string;
  hottest: { date: string; high: number };
  days: ApiWeekDay[];
}

/** Rain amounts follow the temperature units: millimetres with °C, inches with °F. */
export type RainUnit = 'mm' | 'in';

/**
 * Amounts in the rain types below are in `ApiRain.unit`, rounded for display: millimetres to one
 * decimal under 1 and whole above; inches to two decimals under 1 and one decimal above. So the
 * text for an amount is always `${amount}${unit}`.
 */
export interface ApiRainModel {
  id: string;
  name: string;
  /** The model's total over the window, rounded for display. */
  amount: number;
  /** The same total to two decimals, for positioning on the strip. */
  value: number;
  /** At least the window's `threshold`. */
  expectsRain: boolean;
  /** Agrees with the answer: wet models on a Yes day, dry ones on a No day, all on a Maybe day. */
  agrees: boolean;
}

/** "Is it wet today?" for one window: the rest of today, or a whole day. */
export interface ApiRainDay {
  /** The local date (YYYY-MM-DD). */
  date: string;
  /**
   * When the window judged starts, ISO 8601 UTC. Today's window is the rest of the day from the
   * moment of the request; later days start at local midnight. The answer is out of date an hour
   * after this (clients refetch then).
   */
  from: string;
  /** True when the window is the rest of the day rather than the whole day. */
  partial: boolean;
  band: RainBand;
  /** "No." / "Maybe." / "Yes." */
  answer: string;
  /** "It'll rain." */
  verdict: string;
  /** "About 6mm of rain. Mostly between 2pm and 6pm." */
  detail: string;
  /** The consensus amount: the median of the models' totals. */
  amount: number;
  /** The share of models expecting rain, 0–1, two decimals. */
  chance: number;
  /** Models expecting rain, and models with data for the whole window. */
  wet: number;
  total: number;
  confidence: Confidence;
  /** The window's wet amount: a model "expects rain" from here (the strip's highlighted zone). */
  threshold: number;
  /** How much of the rain is likely to fall as snow. */
  snow: 'none' | 'some' | 'most';
  /**
   * The local hours most likely to be wet, start inclusive and end exclusive (24 is midnight),
   * or null when no hour has rain in at least half the models.
   */
  likely: { from: number; to: number } | null;
  /** The strip's range (min is always 0). */
  scale: { min: number; max: number };
  models: ApiRainModel[];
  /** Month name for the date, e.g. "October". */
  month: string;
  /** "6 of 8 forecasts expect rain" */
  agreementText: string;
  /** "Limited forecast data" when fewer than 3 models cover the window, otherwise null. */
  limitedText: string | null;
  /** Accessible summary of the model strip. */
  stripSummary: string;
}

/** One forecast hour of rain, judged by the server, for recomputing "now" later. */
export interface ApiRainPoint {
  /** Start of the hour, epoch milliseconds. */
  time: number;
  /** Local date (YYYY-MM-DD) and hour (0–23) in the place's time zone. */
  date: string;
  hour: number;
  /** The median of the models' rain in this hour, in `ApiRain.unit`, two decimals. */
  amount: number;
  /** The share of models with rain in this hour, 0–1, two decimals. */
  chance: number;
  /** The share of models with rain in the two hours from this one (the Now view's rows). */
  chance2h: number;
  /** The verdict for this hour, judged with the hourly thresholds. */
  band: RainBand;
  /** The blended temperature is at or below the snow line. */
  snow: boolean;
}

/** One row in the rain Now view's list: the chance of rain in the two hours from `time`. */
export interface ApiRainHour {
  /** Start of the two hours, ISO 8601 UTC. */
  time: string;
  /** Local time, "3pm". */
  label: string;
  /** Percent, rounded to the nearest 10. */
  chance: number;
}

/** "Is it wet right now?": the forecast for the current hour and the next twelve. */
export interface ApiRainNow {
  /** The moment the values are for, ISO 8601 UTC. */
  time: string;
  band: RainBand;
  answer: string;
  verdict: string;
  /** "Light rain now. Easing off by about 3pm." */
  detail: string;
  /** This hour's median amount, in `ApiRain.unit`. */
  amount: number;
  /** The share of models with rain this hour, 0–1. */
  chance: number;
  snow: boolean;
  /** The next 12 hours in 2-hour blocks. */
  hours: ApiRainHour[];
  /**
   * The judged hourly forecast from the hour before now to a day ahead, so clients can keep
   * "now" current between requests (core `computeRainNow` and `formatRainNow`).
   */
  series: ApiRainPoint[];
}

/** One day in the rain week view. */
export interface ApiRainWeekDay {
  date: string;
  /** "Today", then short weekday names ("Thu"). */
  label: string;
  /** The day's consensus amount (today: the rest of the day). */
  amount: number;
  band: RainBand;
  /** "Rain", "Mostly dry"… ("Snow" for a snowy wet day). */
  bandLabel: string;
  snow: boolean;
}

/** "Is it wet this week?": today and the next six days. */
export interface ApiRainWeek {
  /** First and last dates (YYYY-MM-DD). */
  from: string;
  to: string;
  band: RainBand;
  /** "No." / "Maybe." / "Partly." / "Yes." */
  answer: string;
  /** "Rain on Thu and Fri." / "A wet week, heaviest on Sat." */
  verdict: string;
  detail: string;
  /**
   * The median of each model's own total across the days (models disagree on which day it rains,
   * so adding up daily medians would undercount), or null with fewer than 3 models covering
   * every day.
   */
  total: number | null;
  /** Normal rainfall over the same days (NASA POWER), or null without rain normals. */
  normal: number | null;
  /** Days judged rain or wetter, and days judged showers. */
  rainDays: number;
  showerDays: number;
  /** The day with the largest consensus amount (the earlier one on a tie). */
  wettest: { date: string; amount: number };
  days: ApiRainWeekDay[];
}

/** The "Is it wet?" answers. Present exactly when `days[0]` (today) has an answer. */
export interface ApiRain {
  unit: RainUnit;
  /** Today (the rest of the day), then tomorrow (the whole day) when the forecast has it. */
  days: ApiRainDay[];
  /** Absent when the forecast has no hourly rain for the current time. */
  now?: ApiRainNow;
  /** Absent without five usable days. */
  week?: ApiRainWeek;
}

export interface TodayResponse {
  location: ApiLocation;
  units: Units;
  /** Today, then tomorrow when the forecast has it (never more than two). */
  days: ApiDay[];
  updatedAt: string;
  attribution: string[];
  /** Present and true when upstream failed and this is a cached result under 6 hours old. */
  stale?: boolean;
  /** The nearest city pages, for "Nearby" links. */
  nearby?: NearbyCity[];
  /** The "now" view. Absent when the forecast has no hourly data for the current time. */
  now?: ApiNow;
  /** The "this week" view. Absent when the forecast has no usable days. */
  week?: ApiWeek;
  /** "Is it wet?" for the same place. Absent when the forecast has no precipitation. */
  rain?: ApiRain;
}

export interface NearbyCity {
  slug: string;
  name: string;
}

export interface SearchResult {
  name: string;
  region: string | null;
  country: string | null;
  countryName: string | null;
  lat: number;
  lon: number;
  slug?: string;
  geonameId?: number;
}

export interface SearchResponse {
  results: SearchResult[];
}

export type ErrorCode = 'bad_location' | 'not_found' | 'upstream_unavailable' | 'rate_limited';

export interface ApiError {
  error: { code: ErrorCode; message: string };
}

/** A city from data/cities.json. */
export interface City {
  slug: string;
  name: string;
  region: string | null;
  country: string;
  countryName: string;
  lat: number;
  lon: number;
  population: number;
  geonameId: number;
}
