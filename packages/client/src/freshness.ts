/**
 * How long an answer holds, and when to ask again. Nothing here reads a clock: whatever needs the
 * time is given it (`now`, epoch ms).
 *
 * Swift: `IsItLogic/Freshness.swift`, checked against the golden vectors in `freshness.json`.
 */
import { CACHE, HOUR, computeNow, type TodayResponse } from '@isithot/core';

/** Why an answer is out of date: the place's day has moved on, or the hour it holds for. */
export type Stale = 'day' | 'hour';

/**
 * A clock running fast makes the answer look out of date before the server has a newer one: past
 * the hour today's rain, snow and wind hold for, or past the place's midnight. When a fresh answer
 * is out of date already, it is good until the server reaches that moment: at the latest, as long
 * from now as the server had left when working it out. So a fast clock costs at most one extra
 * request per server hour, and one at midnight. The caller keeps these and passes them back.
 */
export type Holds = Partial<Record<Stale, { until: number; at: number }>>;

/**
 * Today's rain, snow and wind answers all cover the rest of the day from when they were worked
 * out (the same moment): rain's carries it, or snow's in an answer without rain.
 */
const hourly = (res: TodayResponse) => res.rain ?? res.snow;

/** The start of the first forecast hour after `at`: the series' next, else the next UTC hour. */
const hourAfter = (series: readonly { time: number }[] | undefined, at: number): number =>
  series?.find((p) => p.time > at)?.time ?? Math.floor(at / HOUR) * HOUR + HOUR;

/** When today's rain, snow and wind answers go out of date: the next forecast hour. */
export function hourUntil(res: TodayResponse): number | null {
  const block = hourly(res);
  const from = block?.days[0]?.from;
  return from ? hourAfter(block.now?.series, Date.parse(from)) : null;
}

/** When today's answer goes out of date: the place's midnight (the next day's first hour). */
export function dayUntil(res: TodayResponse): number | null {
  const date = res.days[0]?.date ?? '';
  return res.now?.series.find((p) => p.date > date)?.time ?? null;
}

/** The holds for a fresh answer that is out of date already when it arrives (`Holds`). */
export function hold(holds: Holds, res: TodayResponse, now: number): Holds {
  const next = { ...holds };
  // `made`: when the server worked that part of the answer out.
  const set = (reason: Stale, until: number | null, made = ''): void => {
    const from = Date.parse(made);
    if (until !== null && now >= until && from < until) {
      next[reason] = { until, at: now + until - from };
    }
  };
  set('day', dayUntil(res), res.now?.time);
  set('hour', hourUntil(res), hourly(res)?.days[0]?.from);
  return next;
}

/**
 * Whether the answer is out of date: past local midnight (today's answer is yesterday's) or
 * past the end of the hourly series it carries ("day"), or past the hour today's rain, snow and
 * wind answers hold for ("hour"). A clock running far behind is not a reason, and one running fast
 * waits for the server (`Holds`).
 */
export function outOfDate(res: TodayResponse, now: number, holds: Holds): Stale | null {
  /** Whether the clock has passed `until` for `reason` (or the hold on it). */
  const past = (reason: Stale, until: number): boolean => {
    const held = holds[reason];
    return now >= (held?.until === until ? held.at : until);
  };
  if (res.now) {
    const series = res.now.series;
    const current = computeNow(series, now);
    const old = current
      ? current.date > (res.days[0]?.date ?? '')
      : now > (series.at(-1)?.time ?? Infinity);
    const midnight = dayUntil(res);
    if (old && (midnight === null || past('day', midnight))) return 'day';
  }
  const until = hourUntil(res);
  return until !== null && past('hour', until) ? 'hour' : null;
}

/**
 * Until when an answer may be shown at all: the end of its last hour ahead (or, without hours
 * ahead, the hour it holds for), and never once the forecast behind it is older than the
 * server's own stale limit. Past it the apps and widgets say they have no recent forecast,
 * rather than show an old hour.
 */
export function usableUntil(res: TodayResponse): number {
  const last = res.snow?.ahead?.at(-1);
  const end = last ? Date.parse(last.time) + HOUR : (hourUntil(res) ?? Infinity);
  return Math.min(end, Date.parse(res.updatedAt) + CACHE.forecastStale * 1000);
}

/**
 * When an app that stays open asks again: the start of the next forecast hour after `now`, plus
 * `jitterMs` (0 to `CLIENT.refreshJitterMs`, chosen at random by the caller).
 */
export function nextRefreshAt(res: TodayResponse, now: number, jitterMs: number): number {
  return hourAfter(hourly(res)?.now?.series, now) + jitterMs;
}
