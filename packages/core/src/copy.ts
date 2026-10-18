/**
 * Every user-facing string. The website, the API and the future apps all read from here so
 * the words never drift apart. Sentence case everywhere.
 */
import {
  MODELS,
  RAIN_BANDS,
  SITES,
  TITLE_MAX_LENGTH,
  type Band,
  type Compass,
  type RainBand,
  type SnowBand,
  type SnowReason,
  type Topic,
  type UvLevel,
  type WindBand,
} from './config';
import { localDateTime, zoneAbbreviation } from './dates';
import type { Units } from './units';
import type { WindUnit } from './types';

export const SITE_NAME = SITES.hot.name;

/** The topic toggle's labels. */
export const TOPIC_LABELS: Record<Topic, string> = {
  hot: 'Hot',
  wet: 'Wet',
  snow: 'Snow',
  wind: 'Wind',
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

/** The middle view's label in the evening, when it answers for tomorrow. */
export const TOMORROW_LABEL = 'Tomorrow';

/** A view's tab label: the middle view reads "Tomorrow" while it shows tomorrow. */
export function viewLabel(view: View, tomorrow = false): string {
  return view === 'today' && tomorrow ? TOMORROW_LABEL : VIEW_LABELS[view];
}

export const VERDICTS: Record<Band, string> = {
  freezing: "It's freezing.",
  cold: "It's cold.",
  mild: "It's mild.",
  warm: "It's warm, not hot.",
  hot: "It's hot.",
  scorching: "It's scorching.",
};

/** Tomorrow's verdict (the API's `days[1]`). */
export const TOMORROW_VERDICTS: Record<Band, string> = {
  freezing: "It'll be freezing.",
  cold: "It'll be cold.",
  mild: "It'll be mild.",
  warm: "It'll be warm, not hot.",
  hot: "It'll be hot.",
  scorching: "It'll be scorching.",
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
  /**
   * Open-Meteo's licence asks for "Weather data by Open-Meteo.com", linked, next to the data, and
   * CC BY for a note that we changed it (the blends and verdicts are ours).
   */
  forecastCredit: 'Weather data by Open-Meteo.com (CC BY 4.0), modified',
  /** The Met Office's grids (the UKMO model) are CC BY-SA 4.0 and need their own credit. */
  metOfficeCredit:
    'Contains Met Office data © Crown copyright, the Met Office, licensed under CC BY-SA 4.0',
  climateCredit: 'Climate data: NASA POWER',
  unitsLabel: 'Temperature units',
  rainUnitsLabel: 'Rain units',
  snowUnitsLabel: 'Snow units',
  windUnitsLabel: 'Wind units',
  topicLabel: 'Forecast type',
  nextHoursRain: 'Chance of rain, next 12 hours',
  nextHoursSnow: 'Chance of snow, next 12 hours',
  nextHoursWind: 'Gusts, next 12 hours',
  changeLocation: 'change location',
  stale: 'Showing the last forecast we have. It will refresh shortly.',
  previewLabel: 'Preview each kind of day',
  previewNote: 'Sample data for design preview.',
  /** When the forecast behind the answer was fetched ("Updated 3:05pm BST"). */
  updated: 'Updated',
  yesterday: 'yesterday',
  howItWorks: 'How it works',
  places: 'Places',
  allPlaces: 'All places',
  popularPlaces: 'Popular places',
  /** The places page's two parts. */
  uk: 'United Kingdom',
  world: 'Around the world',
  /** willitsnow.today's places page leaves out places where it never snows (SNOWLESS). */
  snowlessNote:
    'Places in the tropics and subtropics, where it does not snow, are left out here, but you can still search for them.',
  /**
   * The link under a gale or storm answer for a UK place (core `warningsLink`): the official
   * warnings, never a warning of ours.
   */
  metOfficeWarnings: 'Met Office warnings',
} as const;

/** The data credits: the API's `attribution`, and the footer of every page with links added. */
export const ATTRIBUTION: readonly string[] = [
  COPY.forecastCredit,
  COPY.metOfficeCredit,
  COPY.climateCredit,
];

/** Messages for the API error envelope. */
export const ERROR_MESSAGES = {
  bad_location: 'Latitude and longitude must be decimal degrees.',
  not_found: 'There is no page for that place.',
  upstream_unavailable: COPY.unavailable,
  rate_limited: 'Too many requests. Try again in a minute.',
} as const;

/**
 * Each topic's question for each view, and for the middle view while it shows tomorrow; `{where}`
 * is " in London" on a city page. Snow is a verb, so its questions are worded on their own; wind
 * asks about the week ahead as a forecast ("Will it be windy this week?").
 */
const QUESTIONS: Record<Topic, Record<View | 'tomorrow', string>> = {
  hot: {
    today: 'Is it hot{where} today?',
    now: 'Is it hot{where} right now?',
    week: 'Is it hot{where} this week?',
    tomorrow: 'Will it be hot{where} tomorrow?',
  },
  wet: {
    today: 'Is it wet{where} today?',
    now: 'Is it wet{where} right now?',
    week: 'Is it wet{where} this week?',
    tomorrow: 'Will it be wet{where} tomorrow?',
  },
  snow: {
    today: 'Will it snow{where} today?',
    now: 'Is it snowing{where} right now?',
    week: 'Will it snow{where} this week?',
    tomorrow: 'Will it snow{where} tomorrow?',
  },
  wind: {
    today: 'Is it windy{where} today?',
    now: 'Is it windy{where} right now?',
    week: 'Will it be windy{where} this week?',
    tomorrow: 'Will it be windy{where} tomorrow?',
  },
};

/**
 * "Is it hot today?" / "Is it wet in London right now?" / "Will it snow this week?", and for the
 * middle view while it shows tomorrow, "Will it be hot in London tomorrow?".
 */
export function question(
  city?: string | null,
  view: View = 'today',
  topic: Topic = 'hot',
  tomorrow = false,
): string {
  const slot = view === 'today' && tomorrow ? 'tomorrow' : view;
  // A function, so a "$" in a searched place's name is never read as a replacement pattern.
  return QUESTIONS[topic][slot].replace('{where}', () => (city ? ` in ${city}` : ''));
}

/** The not-found page's question, for a place that is not there. */
export const HERE_QUESTIONS: Record<Topic, string> = {
  hot: 'Is it hot here?',
  wet: 'Is it wet here?',
  snow: 'Will it snow here?',
  wind: 'Is it windy here?',
};

/** The units control's group label for each topic. */
export const UNITS_LABELS: Record<Topic, string> = {
  hot: COPY.unitsLabel,
  wet: COPY.rainUnitsLabel,
  snow: COPY.snowUnitsLabel,
  wind: COPY.windUnitsLabel,
};

/** The topics whose units follow the temperature setting; wind has a setting of its own. */
export type TemperatureUnitsTopic = Exclude<Topic, 'wind'>;

/** The units control's two choices for hot, wet and snow: one setting serves all three. */
export const UNIT_NAMES: Record<TemperatureUnitsTopic, Record<Units, string>> = {
  hot: { c: '°C', f: '°F' },
  wet: { c: 'mm', f: 'in' },
  snow: { c: 'cm', f: 'in' },
};

/** The wind site's units control, in the toggle's order: its own setting, "Wind units". */
export const WIND_UNITS: readonly WindUnit[] = ['mph', 'kmh'];
export const WIND_UNIT_NAMES: Record<WindUnit, string> = { mph: 'mph', kmh: 'km/h' };

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

// ---- UV index (the hot views) ---------------------------------------------------

/** WHO's five steps, with "Medium" for WHO's "Moderate" (UV in config.ts). */
export const UV_LEVEL_LABELS: Record<UvLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  veryhigh: 'Very high',
  extreme: 'Extreme',
};

/** Today and tomorrow: "UV 7 · High, highest around 1pm" ("UV 0 · Low" without a peak). */
export function uvDayLine(max: number, level: UvLevel, peak: string | null): string {
  const line = `UV ${max} · ${UV_LEVEL_LABELS[level]}`;
  return peak ? `${line}, highest around ${peak}` : line;
}

/** Now: "UV 5 · Medium now". */
export function uvNowLine(value: number, level: UvLevel): string {
  return `UV ${value} · ${UV_LEVEL_LABELS[level]} now`;
}

/**
 * What a screen reader hears for either line, without the dot: "UV index 9, very high, highest
 * around 1pm" / "UV index 5, medium".
 */
export function uvSpoken(value: number, level: UvLevel, peak: string | null = null): string {
  const spoken = `UV index ${value}, ${UV_LEVEL_LABELS[level].toLowerCase()}`;
  return peak ? `${spoken}, highest around ${peak}` : spoken;
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

/**
 * "Is it wet in London today? Yes. Rain | isitwet.today". A day of rain (or wetter) that mostly
 * falls as snow is "Snow", or "Heavy snow" when heavy, as its verdict says.
 */
export function wetPageTitle(args: {
  city?: string | null;
  answer: string;
  band: RainBand;
  /** The day's `snow`. */
  snow: 'none' | 'some' | 'most';
}): string {
  const rank = RAIN_BANDS.indexOf(args.band);
  const label =
    args.snow === 'most' && rank >= RAIN_BANDS.indexOf('rain')
      ? rank >= RAIN_BANDS.indexOf('heavy')
        ? HEAVY_SNOW_LABEL
        : SNOW_LABEL
      : RAIN_BAND_LABELS[args.band];
  return `${question(args.city, 'today', 'wet')} ${args.answer} ${label} | ${SITES.wet.name}`;
}

export const DEFAULT_TITLE = `Is it hot today? | ${SITE_NAME}`;
export const DEFAULT_DESCRIPTION =
  'Will today feel hot where you are? One answer from several forecast models, judged against what is normal for your place and time of year.';

/** Each site's home page title and description. */
export const DEFAULT_TITLES: Record<Topic, string> = {
  hot: DEFAULT_TITLE,
  wet: `Is it wet today? | ${SITES.wet.name}`,
  snow: `Will it snow today? | ${SITES.snow.name}`,
  wind: `Is it windy today? | ${SITES.wind.name}`,
};
export const DEFAULT_DESCRIPTIONS: Record<Topic, string> = {
  hot: DEFAULT_DESCRIPTION,
  wet: 'Will it rain today where you are? One answer from several forecast models: how likely rain is, how much and when.',
  snow: 'Will it snow today where you are? One answer from several forecast models: how likely snow is, how much and when.',
  wind: 'Will it be windy today where you are? One answer from several forecast models: how strong the wind and gusts get, and when.',
};

/** "{n}" in a string is the number of forecast models, "{city}" a city page's place. */
const fill = (text: string, city = ''): string =>
  text.replace('{n}', String(MODELS.length)).replace('{city}', () => city);

/**
 * What a city page offers, after its question in the search title, the longest that fits first.
 * Wet's say "rain", the word people search with; snow's and wind's questions already say "snow"
 * and "windy".
 */
const CITY_TITLE_TAILS: Record<Topic, readonly string[]> = {
  hot: ['Hour by hour from {n} forecasts', 'From {n} forecasts'],
  wet: [
    'Rain hour by hour from {n} forecasts',
    'Hourly rain from {n} forecasts',
    'Rain from {n} forecasts',
  ],
  snow: ['Hour by hour from {n} forecasts', 'From {n} forecasts'],
  wind: ['Hour by hour from {n} forecasts', 'From {n} forecasts'],
};

/**
 * A city page's title in search results and the browser: its question and what the page offers,
 * never the answer, which would go out of date in the results ("Is it wet in Leeds today? Rain
 * hour by hour from 6 forecasts | isitwet.today"). The words after the question give way to keep
 * it within TITLE_MAX_LENGTH; the question never does. Share cards carry the answer instead.
 */
export function cityTitle(city: string, topic: Topic): string {
  const asked = question(city, 'today', topic);
  const title =
    CITY_TITLE_TAILS[topic]
      .map((tail) => `${asked} ${fill(tail)}`)
      .find((t) => t.length <= TITLE_MAX_LENGTH) ?? asked;
  return `${title} | ${SITES[topic].name}`;
}

const CITY_DESCRIPTIONS: Record<Topic, string> = {
  hot: 'Will today feel hot in {city}? One answer from {n} forecast models, judged against what is normal there, with the next 12 hours and the week ahead.',
  wet: 'Will it rain in {city} today? One answer from {n} forecast models: how likely rain is, how much and when, with the next 12 hours and the week ahead.',
  snow: 'Will it snow in {city} today? One answer from {n} forecast models: how likely snow is, how much and when, with the next 12 hours and the week ahead.',
  wind: 'Will it be windy in {city} today? One answer from {n} forecast models: how strong the wind and gusts get and when, with the next 12 hours and the week ahead.',
};

/** A city page's description for search results: what the page answers, never the answer. */
export function cityDescription(city: string, topic: Topic): string {
  return fill(CITY_DESCRIPTIONS[topic], city);
}

/** What each site answers and how; "{site}" is its name. */
const INTROS: Record<Topic, string> = {
  hot: '{site} answers one question: will today feel hot where you are? It combines {n} forecast models and judges the day against what is normal for the place and the time of year, so 24°C can be hot in Newcastle and mild in Seville.',
  wet: '{site} answers one question: will it rain where you are today? It combines {n} forecast models into one answer, with how likely rain is, how much and when, and compares the week with what is normal for the place.',
  snow: '{site} answers one question: will it snow where you are today? It combines {n} forecast models into one answer, with how likely snow is, how much and when, and compares the week with what is normal for the place.',
  wind: '{site} answers one question: will it be windy where you are today? It combines {n} forecast models into one answer, with how strong the wind and gusts get and when, and compares the week with what is normal for the place.',
};

/**
 * A home page's introduction under the answer, for visitors and search engines alike (the answer
 * itself is the visitor's own, worked out in the browser).
 */
export function intro(topic: Topic): { heading: string; text: string } {
  return {
    heading: fill('One answer from {n} forecasts'),
    text: fill(INTROS[topic]).replace('{site}', SITES[topic].name),
  };
}

/** The places page's introduction and description: "Is it hot today? Choose a town or city…". */
export function placesIntro(topic: Topic): string {
  return `${question(null, 'today', topic)} Choose a town or city: the UK by nation, then the rest of the world by country.`;
}

/** "3:05pm" from a time of day in hours (15.0833…), to the minute. */
export function clockTime(hours: number): string {
  const minutes = Math.round(hours * 60);
  const mm = String(minutes % 60).padStart(2, '0');
  return formatHour(Math.floor(minutes / 60)).replace(/[ap]m$/, (suffix) => `:${mm}${suffix}`);
}

/**
 * When the forecast behind an answer was fetched (the API's `updatedAt`), in the place's own time:
 * "3:05pm BST", or "yesterday, 11:40pm GMT" when that was before `today` there (the answer's
 * date: a stale copy can be from the evening before). The zone is named where it has an
 * abbreviation (`zoneAbbreviation`).
 */
export function updatedTime(iso: string, timezone: string, today: string): string {
  const at = new Date(iso);
  const local = localDateTime(timezone, at);
  const zone = zoneAbbreviation(timezone, at);
  const time = zone ? `${clockTime(local.hours)} ${zone}` : clockTime(local.hours);
  return local.date < today ? `${COPY.yesterday}, ${time}` : time;
}

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
/** A heavy (or wetter) day of snow, in the page title. */
export const HEAVY_SNOW_LABEL = 'Heavy snow';

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
  showersNext12: 'On and off for the next 12 hours.',
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

/** When showers under way now clear. */
export function dryFromLine(hour: number): string {
  return `Dry from about ${formatHour(hour)}.`;
}

/** "5 of 6 forecasts expect rain" / "1 of 6 forecasts expects rain". */
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

// ---- Will it snow? ----------------------------------------------------------------

export const SNOW_BAND_LABELS: Record<SnowBand, string> = {
  nosnow: 'No snow',
  flakes: 'A few flakes',
  maybesnow: 'Snow possible',
  snow: 'Snow',
  heavysnow: 'Heavy snow',
  deepsnow: 'Deep snow',
};

/** A day without snow is labelled with why (week rows, page titles), never "No snow". */
export const SNOW_REASON_LABELS: Record<SnowReason, string> = {
  warm: 'Too warm',
  rain: 'Rain',
  dry: 'Dry',
};

/** A band's label, or for a day without snow, why. */
export function snowLabel(band: SnowBand, reason: SnowReason | null): string {
  return reason ? SNOW_REASON_LABELS[reason] : SNOW_BAND_LABELS[band];
}

export const SNOW_ANSWERS: Record<SnowBand, string> = {
  nosnow: 'No.',
  flakes: 'No.',
  maybesnow: 'Maybe.',
  snow: 'Yes.',
  heavysnow: 'Yes.',
  deepsnow: 'Yes.',
};

/** Today and tomorrow (the same words serve both). */
export const SNOW_DAY_VERDICTS: Record<SnowBand, string> = {
  nosnow: "It won't snow.",
  flakes: 'A few flakes at most.',
  maybesnow: 'It might snow.',
  snow: "It'll snow.",
  heavysnow: 'Heavy snow.',
  deepsnow: 'Deep snow.',
};

export const SNOW_NOW_VERDICTS: Record<SnowBand, string> = {
  nosnow: "It's not snowing.",
  flakes: 'Just a few flakes.',
  maybesnow: 'Snow showers around.',
  snow: "It's snowing.",
  heavysnow: 'Heavy snow.',
  deepsnow: 'Very heavy snow.',
};

/** A day, or an hour, without snow says why when it is too warm or wet. */
export const SNOW_NONE_VERDICTS = { warm: 'Too warm for snow.', rain: 'Rain, not snow.' } as const;
export const SNOW_NONE_NOW_VERDICTS = {
  warm: 'Too warm for snow.',
  rain: 'Raining, not snowing.',
} as const;

/** The Now view's first sentence, about the current hour (snow and more add the rate). */
export const SNOW_NOW_PHRASES: Record<SnowBand, string> = {
  nosnow: 'Dry now.',
  flakes: 'A few flakes possible now.',
  maybesnow: 'Snow possible now.',
  snow: 'Snow now',
  heavysnow: 'Heavy snow now',
  deepsnow: 'Very heavy snow now',
};

export const SNOW_COPY = {
  rainNow: 'Rain now.',
  lightSnowNow: 'Light snow now.',
  littleOrNone: 'Little or no snow in most forecasts.',
  noSnowNext12: 'No snow for the next 12 hours.',
  barelyAny: 'Barely any snow all week.',
} as const;

export const SNOW_WEEK_VERDICTS = {
  snowy: 'A snowy week.',
  possibleMost: 'Snow possible most days.',
  warm: 'Too warm for snow all week.',
  none: 'No snow this week.',
} as const;

/** "Snow now, about 1cm an hour." */
export function snowRateLine(phrase: string, rate: string): string {
  return `${phrase}, about ${rate} an hour.`;
}

/**
 * "About 3cm still to come." for the rest of today, "2 to 5cm of snow." for a whole day, or "A
 * dusting…". `amount` is the depth (one number, or a range written "2 to 5cm" so screen readers
 * say it), or null for a dusting.
 */
export function snowAmountLine(
  amount: { low: number; high: number } | null,
  unit: string,
  partial: boolean,
): string {
  const what = !amount
    ? 'A dusting'
    : amount.low === amount.high
      ? `About ${amount.high}${unit}`
      : `${amount.low} to ${amount.high}${unit}`;
  return partial ? `${what} still to come.` : `${what} of snow.`;
}

/** "Some forecasts say up to 2cm." / "One forecast says a dusting." (null for a dusting). */
export function snowUpToLine(amount: string | null, one: boolean): string {
  if (amount) return upToLine(amount, one);
  return one ? 'One forecast says a dusting.' : 'Some forecasts say a dusting.';
}

/** "No lower than 9° for the rest of the day." / "… all day." / "… all week." */
export function noLowerLine(low: number, when: 'rest' | 'day' | 'week'): string {
  const span = when === 'rest' ? 'for the rest of the day' : `all ${when}`;
  return `No lower than ${low}° ${span}.`;
}

/** "Down to -4° at the coldest." */
export function coldestLine(low: number): string {
  return `Down to ${low}° at the coldest.`;
}

export function snowFromLine(hour: number): string {
  return `Snow likely from about ${formatHour(hour)}.`;
}

export function snowPossibleFromLine(hour: number): string {
  return `Snow possible from about ${formatHour(hour)}.`;
}

/** While snow is possible now: snow likely later. */
export function likelyFromLine(hour: number): string {
  return `Likely from about ${formatHour(hour)}.`;
}

/** While snow is possible now: when it clears. */
export function clearingLine(hour: number): string {
  return `Clearing by about ${endHour(hour)}.`;
}

/** "5 of 6 forecasts expect snow" / "1 of 6 forecasts expects snow". */
export function snowAgreementLine(snowy: number, total: number): string {
  return `${snowy} of ${total} forecasts ${snowy === 1 ? 'expects' : 'expect'} snow`;
}

/** Accessible summary of the snow strip. `min` and `max` are amount texts ("0cm"). */
export function snowStripSummary(args: {
  min: string;
  max: string;
  snowy: number;
  total: number;
}): string {
  const range =
    args.min === args.max
      ? `All forecasts say ${args.min}`
      : `Forecasts range from ${args.min} to ${args.max}`;
  const snowy =
    args.snowy === 0
      ? 'none expect snow'
      : `${args.snowy} of ${args.total} ${args.snowy === 1 ? 'expects' : 'expect'} snow`;
  return `${range}; ${snowy}.`;
}

/** "A snowy week." / "A snowy week, heaviest on Fri." / "A snowy week, heaviest today." */
export function snowyWeekLine(heaviest: string | null): string {
  return heaviest ? `A snowy week, heaviest ${heaviest}.` : SNOW_WEEK_VERDICTS.snowy;
}

/**
 * "Snow on Thu and Fri." / "Snow today and on Sat, heavy on Sat." / "Heavy snow on Fri."
 * `heavy` is when the heavy days fall, or null without one; `allHeavy` when every day is heavy.
 */
export function snowDaysLine(when: string, heavy: string | null, allHeavy: boolean): string {
  if (allHeavy) return `Heavy snow ${when}.`;
  return heavy ? `Snow ${when}, heavy ${heavy}.` : `Snow ${when}.`;
}

/** "Snow possible on Sat." */
export function possibleDaysLine(when: string): string {
  return `Snow possible ${when}.`;
}

/** "A few flakes on Thu, nothing more." */
export function flakesDaysLine(when: string): string {
  return `A few flakes ${when}, nothing more.`;
}

/** Snow against normal: a month where it is rare or common, or a week's snow compared. */
export type SnowNormal = 'rare' | 'common' | 'more' | 'less' | 'usual';

/**
 * "Snow is rare here in October." / "More snow than usual for January." `month` is null for a
 * week across two months.
 */
export function snowNormalLine(kind: SnowNormal, month: string | null): string {
  const inMonth = month ? `in ${month}` : 'at this time of year';
  const forMonth = month ?? 'the time of year';
  if (kind === 'rare') return `Snow is rare here ${inMonth}.`;
  if (kind === 'common') return `Snow is common here ${inMonth}.`;
  if (kind === 'more') return `More snow than usual for ${forMonth}.`;
  if (kind === 'less') return `Less snow than usual for ${forMonth}.`;
  return `About usual for ${forMonth}.`;
}

/**
 * "Will it snow in Oslo today? Yes. Heavy snow | willitsnow.today". A day without snow is
 * labelled with why ("No. Too warm"), never "No. No snow".
 */
export function snowPageTitle(args: {
  city?: string | null;
  answer: string;
  band: SnowBand;
  reason: SnowReason | null;
}): string {
  return `${question(args.city, 'today', 'snow')} ${args.answer} ${snowLabel(args.band, args.reason)} | ${SITES.snow.name}`;
}

// ---- Is it windy? -----------------------------------------------------------------

/**
 * The calm band is "Light winds", the Met Office's everyday words for force 1 to 3; still air
 * within it is "Calm" (STILL_LABEL).
 */
export const WIND_BAND_LABELS: Record<WindBand, string> = {
  calm: 'Light winds',
  breezy: 'Breezy',
  windy: 'Windy',
  verywindy: 'Very windy',
  gale: 'Gale',
  storm: 'Storm',
};
/** A calm day or hour of still air (WIND.still). */
export const STILL_LABEL = 'Calm';

/** A band's label, or "Calm" for still air. */
export function windLabel(band: WindBand, still: boolean): string {
  return still ? STILL_LABEL : WIND_BAND_LABELS[band];
}

export const WIND_ANSWERS: Record<WindBand, string> = {
  calm: 'No.',
  breezy: 'A bit.',
  windy: 'Yes.',
  verywindy: 'Yes.',
  gale: 'Yes.',
  storm: 'Yes.',
};

/**
 * Today (the rest of it) and tomorrow: the same words serve both, as for rain and snow. "Breezy,
 * not windy." answers "A bit." as hot's "It's warm, not hot." answers "Almost."; gales and storms
 * are named as the Met Office defines them, never as a warning.
 */
export const WIND_DAY_VERDICTS: Record<WindBand, string> = {
  calm: "It won't be windy.",
  breezy: 'Breezy, not windy.',
  windy: "It'll be windy.",
  verywindy: "It'll be very windy.",
  gale: 'Gales.',
  storm: 'Storm-force winds.',
};

export const WIND_NOW_VERDICTS: Record<WindBand, string> = {
  calm: "It's not windy.",
  breezy: 'Breezy, not windy.',
  windy: "It's windy.",
  verywindy: "It's very windy.",
  gale: 'Gales.',
  storm: 'Storm-force winds.',
};

/** Still air in place of the calm band's verdict. */
export const STILL_VERDICTS = { day: "It'll be calm.", now: "It's calm." } as const;

/** Bands from windy up in a sentence: "gales on Fri", "Very windy from about 3pm". */
export type WindyBand = Exclude<WindBand, 'calm' | 'breezy'>;
export const WIND_PHRASES: Record<WindyBand, string> = {
  windy: 'windy',
  verywindy: 'very windy',
  gale: 'gales',
  storm: 'storm-force winds',
};

/** What a forecast "says" in the agreement line. */
export const WIND_AGREE_WORDS: Record<WindBand, string> = {
  calm: 'light winds',
  breezy: 'breezy',
  windy: 'windy',
  verywindy: 'very windy',
  gale: 'gales',
  storm: 'storm force',
};

export const WIND_WEEK_ANSWERS = {
  yes: 'Yes.',
  partly: 'Partly.',
  bit: 'A bit.',
  no: 'No.',
} as const;

export const WIND_WEEK_VERDICTS = {
  windy: 'A windy week.',
  breezy: 'A breezy week.',
  light: 'Light winds all week.',
  calm: 'A calm week.',
} as const;

export const WIND_COPY = {
  breezyNext12: 'Breezy for the next 12 hours.',
  lightNext12: 'Light winds for the next 12 hours.',
  /** When a windy week's strongest band covers more days than are named. */
  allWeek: 'all week',
  mostDays: 'on most days',
} as const;

const capitalise = (text: string): string => `${text[0]!.toUpperCase()}${text.slice(1)}`;

/** The compass points in words, as the Met Office writes them mid-sentence. */
export const COMPASS_WORDS: Record<Compass, string> = {
  N: 'north',
  NE: 'north-east',
  E: 'east',
  SE: 'south-east',
  S: 'south',
  SW: 'south-west',
  W: 'west',
  NW: 'north-west',
};

/** Where the wind blows from: "from the south-west" (core `windDirection`'s `words`). */
export function windFromWords(point: Compass): string {
  return `from the ${COMPASS_WORDS[point]}`;
}

/**
 * The lines below name the direction after the speed it goes with ("Gusts up to 45mph from the
 * south-west") and leave it out when it is variable or unknown (`from` null or absent).
 */
const fromText = (from?: string | null): string => (from ? ` ${from}` : '');

/**
 * "Gusts up to 45mph from the south-west, wind up to 25mph." (hot's "High of 21°, feels like
 * 24°.").
 */
export function windDayLine(gust: string, mean: string, from?: string | null): string {
  return `Gusts up to ${gust}${fromText(from)}, wind up to ${mean}.`;
}

/** "Light winds from the south-west, gusts up to 15mph." */
export function lightWindsLine(gust: string, from?: string | null): string {
  return `Light winds${fromText(from)}, gusts up to ${gust}.`;
}

/** "Windiest around 3pm." */
export function windiestAroundLine(hour: number): string {
  return `Windiest around ${formatHour(hour)}.`;
}

/**
 * "Wind 18mph from the west, gusts 32mph right now." (hot's "13° right now, feels like 11°.").
 */
export function windNowLine(mean: string, gust: string, from?: string | null): string {
  return `Wind ${mean}${fromText(from)}, gusts ${gust} right now.`;
}

/** "Windy from about 3pm." / "Gales from about 3pm." */
export function windyFromLine(band: WindyBand, hour: number): string {
  return `${capitalise(WIND_PHRASES[band])} from about ${formatHour(hour)}.`;
}

/** While breezy now: when the wind drops to light. */
export function lighterFromLine(hour: number): string {
  return `Lighter from about ${formatHour(hour)}.`;
}

/** While calm now: when it turns breezy. */
export function breezierFromLine(hour: number): string {
  return `Breezier from about ${formatHour(hour)}.`;
}

/**
 * "Gusts up to 32mph from 3pm, wind from the south-west", what a screen reader hears for a Now
 * row in place of its figures, letters and arrow.
 */
export function windRowSpoken(gust: string, label: string, from?: string | null): string {
  return `Gusts up to ${gust} from ${label}${from ? `, wind ${from}` : ''}`;
}

/** "4 of 6 forecasts say windy" / "1 of 6 forecasts says gales". */
export function windAgreementLine(agree: number, total: number, band: WindBand): string {
  return `${agree} of ${total} forecasts ${agree === 1 ? 'says' : 'say'} ${WIND_AGREE_WORDS[band]}`;
}

/** Accessible summary of the wind strip: "Forecast gusts range from 25mph to 48mph; 4 of 6 say windy." */
export function windStripSummary(args: {
  min: string;
  max: string;
  agree: number;
  total: number;
  band: WindBand;
}): string {
  const range =
    args.min === args.max
      ? `All forecasts give gusts of ${args.min}`
      : `Forecast gusts range from ${args.min} to ${args.max}`;
  return `${range}; ${args.agree} of ${args.total} ${args.agree === 1 ? 'says' : 'say'} ${WIND_AGREE_WORDS[args.band]}.`;
}

/** The strongest band of a week and when: "gales" and "on Fri". */
export interface WindTop {
  phrase: string;
  when: string;
}

/** "A windy week." / "A windy week, gales on Fri." */
export function windyWeekLine(top: WindTop | null): string {
  return top ? `A windy week, ${top.phrase} ${top.when}.` : WIND_WEEK_VERDICTS.windy;
}

/**
 * "Windy on Thu and Fri." / "Windy on Thu and Fri, gales on Fri." / "Gales on Fri." `top` is the
 * strongest band's phrase and days when it is stronger than windy; `allTop` when every windy day
 * is at it.
 */
export function windDaysLine(when: string, top: WindTop | null, allTop: boolean): string {
  if (top && allTop) return `${capitalise(top.phrase)} ${top.when}.`;
  return top ? `Windy ${when}, ${top.phrase} ${top.when}.` : `Windy ${when}.`;
}

/** "Breezy on Mon and Tue." */
export function breezyDaysLine(when: string): string {
  return `Breezy ${when}.`;
}

/** "Windiest on Friday, gusts up to 45mph." / "Windiest today, gusts up to 45mph." */
export function windiestLine(when: string, gust: string): string {
  return `Windiest ${when}, gusts up to ${gust}.`;
}

/** "Gusts no stronger than 15mph all week." */
export function calmWeekLine(gust: string): string {
  return `Gusts no stronger than ${gust} all week.`;
}

/** Wind against normal. */
export type WindNormal = 'windier' | 'calmer' | 'usual';

/** "Windier than usual for October." `month` is null for a week across two months. */
export function windNormalLine(kind: WindNormal, month: string | null): string {
  const forMonth = month ?? 'the time of year';
  if (kind === 'windier') return `Windier than usual for ${forMonth}.`;
  if (kind === 'calmer') return `Calmer than usual for ${forMonth}.`;
  return `About usual for ${forMonth}.`;
}

/** "Is it windy in Leeds today? Yes. Windy | isitwindy.today" (share cards only). */
export function windPageTitle(args: {
  city?: string | null;
  answer: string;
  band: WindBand;
  still: boolean;
}): string {
  return `${question(args.city, 'today', 'wind')} ${args.answer} ${windLabel(args.band, args.still)} | ${SITES.wind.name}`;
}
