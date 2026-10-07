/**
 * Every user-facing string. The website, the API and the future apps all read from here so
 * the words never drift apart. Sentence case everywhere.
 */
import { SITES, type Band, type RainBand, type Topic } from './config';

export const SITE_NAME = SITES.hot.name;

/** The topic toggle's labels. */
export const TOPIC_LABELS: Record<Topic, string> = {
  hot: 'Hot',
  wet: 'Wet',
};

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
  rainUnitsLabel: 'Rain units',
  topicLabel: 'Forecast type',
  nextHoursRain: 'Chance of rain, next 12 hours',
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

/** "Is it hot today?" / "Is it wet in London right now?" */
export function question(city?: string | null, view: View = 'today', topic: Topic = 'hot'): string {
  const when = VIEW_WHEN[view];
  return city ? `Is it ${topic} in ${city} ${when}?` : `Is it ${topic} ${when}?`;
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

/** Each site's home page title and description. */
export const DEFAULT_TITLES: Record<Topic, string> = {
  hot: DEFAULT_TITLE,
  wet: `Is it wet today? | ${SITES.wet.name}`,
};
export const DEFAULT_DESCRIPTIONS: Record<Topic, string> = {
  hot: DEFAULT_DESCRIPTION,
  wet: 'Will it rain today where you are? One answer from several forecast models: how likely rain is, how much and when.',
};

// ---- Is it wet? -------------------------------------------------------------------

export const RAIN_BAND_LABELS: Record<RainBand, string> = {
  dry: 'Dry',
  spots: 'Mostly dry',
  showers: 'Showers',
  rain: 'Rain',
  heavy: 'Heavy rain',
  drenched: 'Washout',
};

/** The week row label for a day of rain (or wetter) that mostly falls as snow. */
export const SNOW_LABEL = 'Snow';

export const RAIN_ANSWERS: Record<RainBand, string> = {
  dry: 'No.',
  spots: 'No.',
  showers: 'Maybe.',
  rain: 'Yes.',
  heavy: 'Yes.',
  drenched: 'Yes.',
};

/** Today and tomorrow. */
export const RAIN_VERDICTS: Record<RainBand, string> = {
  dry: "It'll be dry.",
  spots: 'A few spots at most.',
  showers: 'Showers possible.',
  rain: "It'll rain.",
  heavy: "It'll pour.",
  drenched: "You'll get drenched.",
};

export const RAIN_NOW_VERDICTS: Record<RainBand, string> = {
  dry: "It's dry.",
  spots: 'Just a few spots.',
  showers: 'Showers around.',
  rain: "It's raining.",
  heavy: "It's pouring.",
  drenched: "It's torrential.",
};

/** Verdicts when most of the rain falls as snow (rain and wetter only). */
export const SNOW_VERDICTS = {
  day: "It'll snow.",
  now: "It's snowing.",
  heavy: 'Heavy snow.',
} as const;

/** The Now view's first sentence, about the current hour. */
export const RAIN_NOW_PHRASES: Record<RainBand, string> = {
  dry: 'Dry now.',
  spots: 'A few spots possible now.',
  showers: 'Showers possible now.',
  rain: 'Rain now.',
  heavy: 'Heavy rain now.',
  drenched: 'Torrential rain now.',
};

export const RAIN_COPY = {
  lightRainNow: 'Light rain now.',
  lightSnowNow: 'Light snow now.',
  snowNow: 'Snow now.',
  heavySnowNow: 'Heavy snow now.',
  dryRestOfDay: 'Dry for the rest of the day.',
  dryEveryForecast: 'Dry in every forecast.',
  dryMostForecasts: 'Dry in most forecasts.',
  spots: 'Little or no rain in most forecasts.',
  asSnow: 'Likely to fall as snow.',
  someSnow: 'Some may fall as snow.',
  onAndOff: 'On and off.',
  onAndOffRestOfDay: 'On and off for the rest of the day.',
  onAndOffAllDay: 'On and off all day.',
  restOfDay: 'For the rest of the day.',
  allDay: 'All day.',
  setToLast: 'Set to last the next 12 hours.',
  dryNext12: 'Dry for the next 12 hours.',
  noWeekTotal: 'Not enough forecasts for a weekly total.',
  barelyAnyRain: 'Barely any rain all week.',
} as const;

export const RAIN_WEEK_ANSWERS = {
  yes: 'Yes.',
  partly: 'Partly.',
  maybe: 'Maybe.',
  no: 'No.',
} as const;

export const RAIN_WEEK_VERDICTS = {
  wet: 'A wet week.',
  unsettled: 'An unsettled week.',
  mostlyDry: 'A mostly dry week.',
  dry: 'A dry week.',
} as const;

/** An end time: "3pm", with 0 and 24 as "midnight". */
export function endHour(hour: number): string {
  return hour % 24 === 0 ? 'midnight' : formatHour(hour);
}

/** "today", "on Thu and Fri", "today and on Sat". `others` names the days other than today. */
export function whenDays(today: boolean, others: string | null): string {
  const parts: string[] = [];
  if (today) parts.push('today');
  if (others) parts.push(`on ${others}`);
  return parts.join(' and ');
}

/** "Some forecasts say up to 4mm." / "One forecast says up to 4mm." */
export function upToLine(amount: string, one: boolean): string {
  return one ? `One forecast says up to ${amount}.` : `Some forecasts say up to ${amount}.`;
}

/** "About 6mm still to come." for the rest of today, "About 6mm of rain." for a whole day. */
export function rainAmountLine(amount: string, partial: boolean): string {
  return partial ? `About ${amount} still to come.` : `About ${amount} of rain.`;
}

export function aroundLine(hour: number): string {
  return `Most likely around ${formatHour(hour)}.`;
}

export function easingLine(hour: number): string {
  return `Easing off by about ${endHour(hour)}.`;
}

export function betweenLine(from: number, to: number): string {
  return `Mostly between ${formatHour(from)} and ${endHour(to)}.`;
}

export function rainFromLine(hour: number): string {
  return `Rain likely from about ${formatHour(hour)}.`;
}

export function showersFromLine(hour: number): string {
  return `Showers possible from about ${formatHour(hour)}.`;
}

/** "6 of 8 forecasts expect rain" / "1 of 8 forecasts expects rain". */
export function rainAgreementLine(wet: number, total: number): string {
  return `${wet} of ${total} forecasts ${wet === 1 ? 'expects' : 'expect'} rain`;
}

/** Accessible summary of the rain strip. `min` and `max` are amount texts ("0mm"). */
export function rainStripSummary(args: {
  min: string;
  max: string;
  wet: number;
  total: number;
}): string {
  const range =
    args.min === args.max
      ? `All forecasts say ${args.min}`
      : `Forecasts range from ${args.min} to ${args.max}`;
  const wet =
    args.wet === 0
      ? 'none expect rain'
      : `${args.wet} of ${args.total} ${args.wet === 1 ? 'expects' : 'expect'} rain`;
  return `${range}; ${wet}.`;
}

/** "A wet week." / "A wet week, heaviest on Fri." / "A wet week, heaviest today." */
export function wetWeekLine(heaviest: string | null): string {
  return heaviest ? `A wet week, heaviest ${heaviest}.` : RAIN_WEEK_VERDICTS.wet;
}

/**
 * "Rain on Thu and Fri." / "Rain on Thu and Fri, heavy on Fri." / "Heavy rain on Fri."
 * `heavy` is when the heavy days fall, or null without one; `allHeavy` when every day is heavy.
 */
export function rainDaysLine(when: string, heavy: string | null, allHeavy: boolean): string {
  if (allHeavy) return `Heavy rain ${when}.`;
  return heavy ? `Rain ${when}, heavy ${heavy}.` : `Rain ${when}.`;
}

export function mostlyDryLine(when: string): string {
  return `Mostly dry, but rain possible ${when}.`;
}

/**
 * "About 18mm across the week, most on Friday (12mm)." `wettest` is when the wettest day
 * falls ("on Friday", "today") and its amount, or null when no day stands out.
 */
export function rainWeekLine(
  total: string,
  wettest: { when: string; amount: string } | null,
): string {
  return wettest
    ? `About ${total} across the week, most ${wettest.when} (${wettest.amount}).`
    : `About ${total} across the week.`;
}

export type RainNormal = 'dry' | 'wetter' | 'drier' | 'normal';

/** The week's rain against normal for the month (or "the time of year"). */
export function rainNormalLine(kind: RainNormal, month: string): string {
  if (kind === 'dry') return `Dry, as usual for ${month}.`;
  if (kind === 'wetter') return `Wetter than usual for ${month}.`;
  if (kind === 'drier') return `Drier than usual for ${month}.`;
  return `About normal for ${month}.`;
}
