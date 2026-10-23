/**
 * The apps' notifications: when a place is due one, whether its forecast sends one, and what it
 * says. The server's run every 15 minutes decides with these (packages/server), and the native
 * apps never judge or word a notification themselves. Every rule reuses an existing verdict, with
 * no new thresholds. Only snow has a rule; each other topic can add its own (`TopicAlertRule`)
 * from its own verdict.
 */
import { ALERTS, type AnyBand, type SnowBand, type Topic } from './config';
import { ALERT_COPY, alertBody, alertText } from './copy';
import { localDateTime } from './dates';
import { isSnow } from './snow';
import type { ApiSnow, TodayResponse } from './types';

/** The evening before a day, about tomorrow, and the morning of it, about the rest of today. */
export type AlertKind = 'evening' | 'morning';
export const ALERT_KINDS: readonly AlertKind[] = ['evening', 'morning'];

/**
 * One topic's switches: the evening before, the morning of, and "also when snow is possible",
 * which only widens the other two.
 */
export interface TopicAlertPrefs {
  evening: boolean;
  morning: boolean;
  possible: boolean;
}

/** A notification: its words, and the day it is about. */
export interface AlertContent<B extends AnyBand = AnyBand> {
  title: string;
  body: string;
  /** The band of the day it is about. */
  band: B;
  /** Apple's `relevance-score`, 0 to 1: which notification the summary puts first. */
  relevance: number;
  /** The local date it is about (YYYY-MM-DD): tomorrow's in the evening, today's in the morning. */
  date: string;
}

/**
 * How a topic decides its notifications, so the run can serve every topic alike. `pick` finds the
 * topic's answers in a `/api/v1/today` response; `decide` returns the notification for `kind`, or
 * null when none is due. `placeName` is the place's `location.name`, or null without one.
 */
export interface TopicAlertRule<T> {
  topic: Topic;
  pick(response: TodayResponse): T | undefined;
  decide(
    block: T,
    kind: AlertKind,
    prefs: TopicAlertPrefs,
    placeName: string | null,
  ): AlertContent | null;
}

// ---- When ----------------------------------------------------------------------

/** A place's clock: its local date and time, and the window it is in. */
export interface AlertClock {
  /** The local date at the place (YYYY-MM-DD). */
  date: string;
  /** The local time of day in hours (18:30 is 18.5). */
  hours: number;
  /** The window the place is in, or null outside both. */
  kind: AlertKind | null;
}

/** Whether a time of day falls from `from` until `to` (end exclusive), across midnight too. */
const within = (hours: number, from: number, to: number): boolean =>
  (hours - from + 24) % 24 < (to - from + 24) % 24;

/**
 * Which window, if any, a place is in at `now`, by its own clock (an unknown time zone reads as
 * UTC, as everywhere else in core), and its local date then.
 */
export function alertWindows(tz: string, now: Date): AlertClock {
  const { date, hours } = localDateTime(tz, now);
  const kind =
    ALERT_KINDS.find((k) => within(hours, ALERTS.windows[k].from, ALERTS.windows[k].to)) ?? null;
  return { date, hours, kind };
}

/** Whether it is the quiet hours at the place (21:00 to 06:59), when nothing may be sent. */
export function inQuietHours(tz: string, now: Date): boolean {
  return within(localDateTime(tz, now).hours, ALERTS.quiet.from, ALERTS.quiet.to);
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

/**
 * When `date` reaches `hour` o'clock in a time zone, epoch ms: the zone's offset at a guess, then
 * again at that answer, so a clock change between the guess and the answer is allowed for.
 */
function zonedTime(tz: string, date: string, hour: number): number {
  const wall = Date.parse(`${date}T00:00:00Z`) + hour * HOUR;
  let t = wall;
  for (let pass = 0; pass < 2; pass++) {
    const local = localDateTime(tz, new Date(t));
    t = wall - (Date.parse(`${local.date}T00:00:00Z`) + local.hours * HOUR - t);
  }
  // Offsets are whole minutes; local hours carry minutes as a fraction.
  return Math.round(t / MINUTE) * MINUTE;
}

/**
 * When Apple stops trying to deliver a notification sent in `kind`'s window on the local `date`:
 * 21:00 at the place for the evening, so "tomorrow" is never read after the evening, and 11:00
 * for the morning. Unix seconds, as `apns-expiration` takes it.
 */
export function expiresAt(tz: string, kind: AlertKind, date: string): number {
  return zonedTime(tz, date, ALERTS.windows[kind].expireAt) / 1000;
}

/**
 * `apns-collapse-id`, "snow-evening-2026-12-02": a second notification about the same day
 * replaces the first on the phone rather than adding another. `date` is the day it is about.
 */
export function collapseId(topic: Topic, kind: AlertKind, date: string): string {
  return `${topic}-${kind}-${date}`;
}

// ---- Snow ----------------------------------------------------------------------

/** The snow bands a notification is sent for: snow or more, and "snow possible" when asked. */
export type SnowAlertBand = Exclude<SnowBand, 'nosnow' | 'flakes'>;

/** Deep snow first in the summary, "snow possible" last. */
export const SNOW_RELEVANCE: Record<SnowAlertBand, number> = {
  maybesnow: 0.3,
  snow: 0.6,
  heavysnow: 0.8,
  deepsnow: 1,
};

const sends = (band: SnowBand, possible: boolean): band is SnowAlertBand =>
  isSnow(band) || (possible && band === 'maybesnow');

/**
 * The snow notification for `kind`, or null. The evening reads tomorrow's whole day
 * (`snow.days[1]`); the morning the rest of today (`snow.days[0]`, judged from the moment the
 * answer was asked for). Snow, heavy snow and deep snow always send; "snow possible" only with
 * `prefs.possible`; no snow and a few flakes never; nothing sends with `prefs[kind]` off. The
 * body is the day's detail and agreement, in the answer's units; in the morning, while it is
 * already snowing (Now is snow or more), the title says so. `placeName` null, or a device
 * location's "Your location", reads "near you".
 */
export function snowAlert(
  snow: ApiSnow,
  kind: AlertKind,
  prefs: TopicAlertPrefs,
  placeName: string | null,
): AlertContent<SnowAlertBand> | null {
  const day = snow.days[kind === 'evening' ? 1 : 0];
  if (!prefs[kind] || !day || !sends(day.band, prefs.possible)) return null;
  const snowing = kind === 'morning' && isSnow(snow.now?.band ?? 'nosnow');
  return {
    title: alertText(
      snowing ? ALERT_COPY.snowingNow : ALERT_COPY.titles[kind][day.band],
      placeName,
    ),
    body: alertBody(day.detail, day.agreementText),
    band: day.band,
    relevance: SNOW_RELEVANCE[day.band],
    date: day.date,
  };
}

/** Snow's rule, for the run. */
export const SNOW_ALERT_RULE: TopicAlertRule<ApiSnow> = {
  topic: 'snow',
  pick: (response) => response.snow,
  decide: snowAlert,
};

/** The fixed test notification, for "Send a test notification" when no real one is due. */
export function testAlert(placeName: string | null): { title: string; body: string } {
  return { title: ALERT_COPY.test.title, body: alertText(ALERT_COPY.test.body, placeName) };
}
