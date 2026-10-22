/**
 * Answers for the client's tests, shaped as the server's are in everything the client reads: the
 * forecast hours are the place's own (in India they start at :30 past the UTC hour), today's rain
 * and snow cover the rest of the day from the moment of the request, the series run from the hour
 * before it to a day after, and each hour ahead is the answer at that hour's start.
 */
import {
  CACHE,
  SNOW_ANSWERS,
  localDateTime,
  outboundLinks,
  snowLabel,
  updatedParts,
  type ApiDay,
  type ApiNowPoint,
  type ApiRainDay,
  type ApiRainPoint,
  type ApiSnowDay,
  type ApiSnowNow,
  type ApiSnowAhead,
  type ApiSnowPoint,
  type ApiSnowWeek,
  type SnowBand,
  type TodayResponse,
} from '@isithot/core';

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
/** The server's stale limit, ms: no answer is shown once its forecast is older. */
export const STALE = CACHE.forecastStale * 1000;

export const iso = (t: number): string => new Date(t).toISOString();
const nextDate = (date: string, days = 1): string =>
  iso(Date.parse(date) + days * DAY).slice(0, 10);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The start of the place's hour containing `t`. */
export function hourStart(tz: string, t: number): number {
  const minutes = Math.round((localDateTime(tz, new Date(t)).hours % 1) * 60);
  return t - (t % MINUTE) - minutes * MINUTE;
}

const hotDay = (date: string): ApiDay => ({
  date,
  band: 'mild',
  answer: 'No.',
  verdict: "It's mild.",
  high: 14,
  feelsLike: 13,
  peakTime: '2pm',
  normalHigh: 14,
  anomaly: 0,
  detail: 'High of 14°, feels like 13°.',
  consensus: { value: 14, agree: 6, total: 6, bandLow: 12, bandHigh: 16, confidence: 'good' },
  models: [],
  month: 'December',
  agreementText: '6 of 6 forecasts agree within 2°',
  limitedText: null,
  stripSummary: 'Forecasts range from 13° to 15°; 6 of 6 agree near 14°.',
  scale: { min: 10, max: 18 },
});

const rainDay = (date: string, from: number, partial: boolean): ApiRainDay => ({
  date,
  from: iso(from),
  partial,
  band: 'dry',
  answer: 'No.',
  verdict: 'It should stay dry.',
  detail: 'No rain expected.',
  amount: 0,
  chance: 0,
  wet: 0,
  total: 6,
  confidence: 'good',
  threshold: 1,
  snow: 'none',
  likely: null,
  scale: { min: 0, max: 5 },
  models: [],
  month: 'December',
  agreementText: '0 of 6 forecasts expect rain',
  limitedText: null,
  stripSummary: 'Forecasts range from 0mm to 0mm; 0 of 6 expect rain.',
});

/** A snow day; `label` tells the days apart in assertions ("today at 18:00"). */
export const snowDay = (
  date: string,
  from: number,
  partial: boolean,
  band: SnowBand = 'nosnow',
  label = date,
): ApiSnowDay => ({
  date,
  from: iso(from),
  partial,
  band,
  bandLabel: snowLabel(band, band === 'nosnow' ? 'warm' : null),
  answer: SNOW_ANSWERS[band],
  verdict: `Verdict for ${label}.`,
  detail: `Detail for ${label}.`,
  reason: band === 'nosnow' ? 'warm' : null,
  amount: band === 'nosnow' ? 0 : 2,
  chance: band === 'nosnow' ? 0 : 0.83,
  snowy: band === 'nosnow' ? 0 : 5,
  total: 6,
  confidence: 'good',
  threshold: 0.5,
  likely: null,
  scale: { min: 0, max: 5 },
  models: [],
  month: 'December',
  agreementText: `${band === 'nosnow' ? 0 : 5} of 6 forecasts expect snow`,
  limitedText: null,
  stripSummary: 'Forecasts range from 0cm to 3cm.',
});

const snowNow = (time: number, band: SnowBand, label: string): ApiSnowNow => ({
  time: iso(time),
  band,
  answer: SNOW_ANSWERS[band],
  verdict: `Now verdict at ${label}.`,
  detail: `Now detail at ${label}.`,
  amount: 0,
  chance: 0,
  hours: [],
  series: [],
});

/** The week from `date`, seven days, each with its agreement. */
export const snowWeek = (date: string, label = date): ApiSnowWeek => ({
  from: date,
  to: nextDate(date, 6),
  band: 'nosnow',
  answer: 'No.',
  verdict: `Week verdict from ${label}.`,
  detail: 'Too warm for snow all week.',
  total: 0,
  normal: null,
  snowDays: 0,
  maybeDays: 0,
  snowiest: { date, amount: 0 },
  days: Array.from({ length: 7 }, (_, i) => {
    const day = nextDate(date, i);
    return {
      date: day,
      label: i === 0 ? 'Today' : WEEKDAYS[new Date(Date.parse(day)).getUTCDay()]!,
      amount: i,
      band: 'nosnow' as const,
      bandLabel: snowLabel('nosnow', 'warm'),
      chance: 0,
      snowy: i % 7,
      total: 6,
      reason: 'warm' as const,
    };
  }),
});

export interface AnswerOptions {
  tz: string;
  /** The moment the server answered. */
  at: number;
  /** When the forecast behind the answer was fetched (default: `at`). */
  updatedAt?: number;
  /** How many hours ahead it carries: 6 as the apps ask, 0 as the website does. */
  ahead?: number;
  name?: string;
}

/** An answer as the server gives it at `at`. */
export function answer(o: AnswerOptions): TodayResponse {
  const local = (t: number) => localDateTime(o.tz, new Date(t));
  const start = hourStart(o.tz, o.at);
  const times = Array.from({ length: 26 }, (_, i) => start + (i - 1) * HOUR);
  const today = local(o.at).date;
  const tomorrow = nextDate(today);
  // Tomorrow starts at the place's midnight: up to 25 hours away on the day the clocks go back.
  const midnight = Array.from({ length: 26 }, (_, i) => start + i * HOUR).find(
    (t) => local(t).date > today,
  )!;
  const point = (t: number) => ({ time: t, date: local(t).date, hour: Math.floor(local(t).hours) });
  const hot: ApiNowPoint[] = times.map((t) => ({
    ...point(t),
    temperature: 10,
    feelsLike: 9,
    band: 'mild',
  }));
  const rain: ApiRainPoint[] = times.map((t) => ({
    ...point(t),
    amount: 0,
    chance: 0,
    chance2h: 0,
    band: 'dry',
    snow: false,
    light: false,
  }));
  const snow: ApiSnowPoint[] = times.map((t) => ({
    ...point(t),
    amount: 0,
    chance: 0,
    chance2h: 0,
    band: 'nosnow',
    reason: 'warm',
    light: false,
  }));
  const ahead: ApiSnowAhead[] = Array.from({ length: o.ahead ?? 6 }, (_, i) => {
    const time = start + (i + 1) * HOUR;
    const label = `the hour from ${iso(time)}`;
    const { series: _series, ...now } = snowNow(time, 'nosnow', label);
    return {
      time: iso(time),
      now,
      today: snowDay(local(time).date, time, true, 'nosnow', label),
      week: snowWeek(local(time).date, label),
    };
  });
  const location = {
    name: o.name ?? 'London',
    region: null,
    country: 'GB',
    lat: 51.5,
    lon: -0.1,
    timezone: o.tz,
    source: 'city',
    slug: 'london-gb',
  } as const;
  const updatedAt = iso(o.updatedAt ?? o.at);
  return {
    location,
    units: 'c',
    days: [hotDay(today), hotDay(tomorrow)],
    updatedAt,
    updated: updatedParts(updatedAt, o.tz),
    links: outboundLinks(location),
    attribution: [],
    now: {
      time: iso(o.at),
      band: 'mild',
      answer: 'No.',
      verdict: "It's mild.",
      temperature: 10,
      feelsLike: 9,
      detail: '10° now.',
      hours: [],
      series: hot,
    },
    rain: {
      unit: 'mm',
      days: [rainDay(today, o.at, true), rainDay(tomorrow, midnight, false)],
      now: {
        time: iso(o.at),
        band: 'dry',
        answer: 'No.',
        verdict: "It's dry.",
        detail: 'Dry now.',
        amount: 0,
        chance: 0,
        snow: false,
        hours: [],
        series: rain,
      },
    },
    snow: {
      unit: 'cm',
      days: [
        snowDay(today, o.at, true, 'nosnow', 'today'),
        snowDay(tomorrow, midnight, false, 'nosnow', 'tomorrow'),
      ],
      now: { ...snowNow(o.at, 'nosnow', 'the request'), series: snow },
      week: snowWeek(today, 'the request'),
      ...(ahead.length ? { ahead } : {}),
    },
  };
}
