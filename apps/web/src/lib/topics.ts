/**
 * What the pages and the browser need to know about each topic, in tables, so nothing tests for a
 * topic by name: where its answer is in a response, how a city page's share card is titled, how
 * long today's answer holds, where each site keeps its last answer, and the colours its pages take
 * without an answer.
 */
import {
  PALETTES,
  RAIN_PALETTES,
  SITES,
  SNOW_PALETTES,
  TOPICS,
  pageTitle,
  snowPageTitle,
  wetPageTitle,
  type AnyBand,
  type Palette,
  type TodayResponse,
  type Topic,
} from '@isithot/core';

/** What every topic's day has. */
export interface TopicDay {
  band: AnyBand;
  answer: string;
  verdict: string;
  detail: string;
}

/** A topic's days in a response: today (or the rest of it), then tomorrow. */
export const TOPIC_DAYS: Record<Topic, (res: TodayResponse) => readonly TopicDay[] | undefined> = {
  hot: (res) => res.days,
  wet: (res) => res.rain?.days,
  snow: (res) => res.snow?.days,
};

/**
 * A city page's share-card title (og:title) with today's answer to the topic's question, or
 * undefined without one. Its search and browser title never carries the answer (core `cityTitle`).
 */
export const SHARE_TITLES: Record<Topic, (city: string, res: TodayResponse) => string | undefined> =
  {
    hot: (city, res) => {
      const day = res.days[0];
      return day && pageTitle({ city, answer: day.answer, high: day.high });
    },
    wet: (city, res) => {
      const day = res.rain?.days[0];
      return day && wetPageTitle({ city, answer: day.answer, band: day.band, snow: day.snow });
    },
    snow: (city, res) => {
      const day = res.snow?.days[0];
      return day && snowPageTitle({ city, answer: day.answer, band: day.band, reason: day.reason });
    },
  };

/**
 * Today's rain and snow answers are for the rest of the day from when they were worked out, so
 * they hold only until the next forecast hour; hot's holds all day.
 */
export const HOURLY: Record<Topic, boolean> = { hot: false, wet: true, snow: true };

/** Each site's last answer in local storage: "isithot:last", "isitwet:last", "willitsnow:last". */
export const lastKey = (topic: Topic): string => `${SITES[topic].name.split('.')[0]}:last`;

/**
 * The site's own name first, then the others: "isitwet.today, isithot.today and
 * willitsnow.today".
 */
export function siteNames(topic: Topic): string {
  const names = [topic, ...TOPICS.filter((t) => t !== topic)].map((t) => SITES[t].name);
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** How a site's pages look where no answer sets the colours. */
export interface SiteLook {
  /** About, Privacy, Cookies and Terms. */
  content: Palette;
  notFound: Palette;
  /** Behind the page (overscroll, before the gradient paints), or null for the default slate. */
  fallback: string | null;
  /** The site's own share image, and a city's while its answer is unavailable. */
  og: AnyBand;
  ogPending: AnyBand;
}

export const LOOKS: Record<Topic, SiteLook> = {
  hot: {
    content: PALETTES.mild,
    notFound: PALETTES.cold,
    fallback: null,
    og: 'hot',
    ogPending: 'mild',
  },
  wet: {
    content: RAIN_PALETTES.rain,
    notFound: RAIN_PALETTES.showers,
    fallback: RAIN_PALETTES.rain.g2,
    og: 'rain',
    ogPending: 'spots',
  },
  snow: {
    content: SNOW_PALETTES.snow,
    notFound: SNOW_PALETTES.maybesnow,
    fallback: SNOW_PALETTES.snow.g2,
    og: 'snow',
    ogPending: 'flakes',
  },
};
