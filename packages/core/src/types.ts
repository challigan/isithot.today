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

export interface TodayResponse {
  location: ApiLocation;
  units: Units;
  days: ApiDay[];
  updatedAt: string;
  attribution: string[];
  /** Present and true when upstream failed and this is a cached result under 6 hours old. */
  stale?: boolean;
  /** The nearest city pages, for "Nearby" links. */
  nearby?: NearbyCity[];
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
