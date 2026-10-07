/**
 * The /api/v1 contract shared by the website and the future apps. Never change the meaning
 * of a field; add fields or create /api/v2.
 */
import type { Band } from './config';
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
