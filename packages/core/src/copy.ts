/**
 * Every user-facing string. The website, the API and the future apps all read from here so
 * the words never drift apart. Sentence case everywhere.
 */
import type { Band } from './config';

export const SITE_NAME = 'isithot.today';

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const BAND_LABELS: Record<Band, string> = {
  freezing: 'Freezing',
  cold: 'Cold',
  mild: 'Mild',
  warm: 'Warm',
  hot: 'Hot',
  scorching: 'Scorching',
};

export const ANSWERS: Record<Band, string> = {
  freezing: 'No.',
  cold: 'No.',
  mild: 'No.',
  warm: 'Almost.',
  hot: 'Yes.',
  scorching: 'Yes.',
};

/** The three views, left to right. Today is the default and the site's main purpose. */
export type View = 'now' | 'today' | 'week';
export const VIEWS: readonly View[] = ['now', 'today', 'week'];

export const VIEW_LABELS: Record<View, string> = {
  now: 'Now',
  today: 'Today',
  week: 'This week',
};

const VIEW_WHEN: Record<View, string> = {
  now: 'right now',
  today: 'today',
  week: 'this week',
};

export const VERDICTS: Record<Band, string> = {
  freezing: "It's freezing.",
  cold: "It's cold.",
  mild: "It's mild.",
  warm: "It's warm, not hot.",
  hot: "It's hot.",
  scorching: "It's scorching.",
};

/** The week view's verdict line. */
export const WEEK_VERDICTS: Record<Band, string> = {
  freezing: 'A freezing week.',
  cold: 'A cold week.',
  mild: 'A mild week.',
  warm: 'A warm week, not hot.',
  hot: 'A hot week.',
  scorching: 'A scorching week.',
};

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const COPY = {
  question: 'Is it hot today?',
  viewsLabel: 'Forecast period',
  today: 'Today',
  nextHours: 'Next 12 hours',
  nextDays: 'The week ahead',
  notAvailable: 'Not available right now.',
  checking: 'Checking…',
  limited: 'Limited forecast data',
  unavailable: 'Forecasts are unavailable right now. Try again in a few minutes.',
  retry: 'Retry',
  approximate: 'Using approximate location.',
  change: 'Change',
  useExactLocation: 'Use my exact location',
  useMyLocation: 'Use my location',
  locating: 'Finding you…',
  locationDenied: 'Location access is off. Search for a place instead.',
  searchLabel: 'Search for a place',
  searchPlaceholder: 'Town or city',
  searchNoResults: 'No places found.',
  searchTooShort: 'Type at least 2 letters.',
  close: 'Close',
  yourLocation: 'Your location',
  outboundIntro: 'Want the full picture? See the forecast on',
  nearby: 'Nearby:',
  forecastCredit: 'Forecast data: Open-Meteo.com (CC BY 4.0)',
  climateCredit: 'Climate data: NASA POWER',
  unitsLabel: 'Temperature units',
  changeLocation: 'change location',
  stale: 'Showing the last forecast we have. It will refresh shortly.',
  previewLabel: 'Preview each kind of day',
  previewNote: 'Sample data for design preview.',
} as const;

/** Messages for the API error envelope. */
export const ERROR_MESSAGES = {
  bad_location: 'Latitude and longitude must be decimal degrees.',
  not_found: 'There is no page for that place.',
  upstream_unavailable: COPY.unavailable,
  rate_limited: 'Too many requests. Try again in a minute.',
} as const;

export function question(city?: string | null, view: View = 'today'): string {
  const when = VIEW_WHEN[view];
  return city ? `Is it hot in ${city} ${when}?` : `Is it hot ${when}?`;
}

export function monthName(date: string): string {
  return MONTHS[Number(date.slice(5, 7)) - 1] ?? '';
}

/** 0 → "12am", 12 → "12pm", 14 → "2pm". */
export function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? 'am' : 'pm';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${suffix}`;
}

export function deg(value: number): string {
  return `${value}°`;
}

/**
 * "About normal for October." / "4° colder than usual for October."
 * `anomaly` is already rounded in display units; `aboutNormal` is decided in °C.
 */
export function anomalyLine(anomaly: number, aboutNormal: boolean, month: string): string {
  if (aboutNormal) return `About normal for ${month}.`;
  const direction = anomaly > 0 ? 'warmer' : 'colder';
  return `${Math.abs(anomaly)}° ${direction} than usual for ${month}.`;
}

export function detailLine(args: {
  high: number;
  feelsLike: number;
  peakTime: string | null;
  anomalyText: string | null;
}): string {
  const parts = [`High of ${args.high}°, feels like ${args.feelsLike}°.`];
  if (args.peakTime) parts.push(`Warmest around ${args.peakTime}.`);
  if (args.anomalyText) parts.push(args.anomalyText);
  return parts.join(' ');
}

export function agreementLine(agree: number, total: number, tolerance: number): string {
  return `${agree} of ${total} forecasts agree within ${tolerance}°`;
}

/** Accessible summary of the model strip. */
export function stripSummary(args: {
  min: number;
  max: number;
  agree: number;
  total: number;
  consensus: number;
}): string {
  const range =
    args.min === args.max
      ? `All forecasts say ${args.min}°`
      : `Forecasts range from ${args.min}° to ${args.max}°`;
  return `${range}; ${args.agree} of ${args.total} agree near ${args.consensus}°.`;
}

export function pageTitle(args: { city?: string | null; answer: string; high: number }): string {
  return `${question(args.city)} ${args.answer} ${args.high}° | ${SITE_NAME}`;
}

export const DEFAULT_TITLE = `Is it hot today? | ${SITE_NAME}`;
export const DEFAULT_DESCRIPTION =
  'Will today feel hot where you are? One answer from several forecast models, judged against what is normal for your place and time of year.';
