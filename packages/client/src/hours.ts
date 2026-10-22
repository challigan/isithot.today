/**
 * Which answer to show at a moment, between requests. The server judges and words every answer,
 * the hours ahead included; the apps only pick one, minute by minute.
 *
 * Swift: `IsItLogic/HourPicker.swift`, `MiddleDay.swift` and `UpdatedLine.swift`, checked against
 * the golden vectors in `hours.json`.
 */
import { COPY, showsTomorrow, type ApiSnowDay, type ApiSnowNow } from '@isithot/core';
import type { AppResponse, SnowWeek } from './types';
import { usableUntil } from './freshness';

/** The snow answers that hold at a moment, and for how long. */
export interface PickedHour {
  /** The start of the hour ahead picked, or null for the answer's own (the moment it was made). */
  start: number | null;
  /** When the next hour ahead starts, or `usableUntil`, whichever comes first. */
  end: number;
  now: ApiSnowNow | Omit<ApiSnowNow, 'series'> | null;
  today: ApiSnowDay | null;
  week: SnowWeek | null;
  source: 'response' | 'ahead';
}

/**
 * The snow answers for `now`. Before the first hour ahead, or without any, the answer's own Now,
 * today and week (also for a clock running behind the server's, as core `computeRainNow` takes
 * the first hour); after that, those of the last hour ahead begun by `now`. Null from
 * `usableUntil` on, which is never later than the end of the last hour ahead, and null without
 * snow answers: the caller then says it has no recent forecast.
 */
export function pickHour(res: AppResponse, now: number): PickedHour | null {
  const snow = res.snow;
  const until = usableUntil(res);
  if (!snow || now >= until) return null;
  const times = (snow.ahead ?? []).map((a) => Date.parse(a.time));
  const begun = times.filter((t) => t <= now).length;
  const end = Math.min(times[begun] ?? Infinity, until);
  const entry = snow.ahead?.[begun - 1];
  if (!entry) {
    return {
      start: null,
      end,
      now: snow.now ?? null,
      today: snow.days[0] ?? null,
      week: snow.week ?? null,
      source: 'response',
    };
  }
  return {
    start: times[begun - 1]!,
    end,
    now: entry.now,
    today: entry.today,
    week: entry.week,
    source: 'ahead',
  };
}

/**
 * The middle view's day: tomorrow's from 6pm at the place (core `showsTomorrow`), else the picked
 * hour's today. Its tab reads `viewLabel('today', slot === 'tomorrow')`.
 */
export function middleDay(
  res: AppResponse,
  picked: PickedHour,
  now: number,
): { slot: 'today' | 'tomorrow'; day: ApiSnowDay | null } {
  return showsTomorrow(res, now)
    ? { slot: 'tomorrow', day: res.snow?.days[1] ?? null }
    : { slot: 'today', day: picked.today };
}

/**
 * When the forecast was fetched, at the place: "3:05pm GMT", or "yesterday, 11:40pm GMT" before
 * `today` there (the place's date now). Core `updatedTime`'s rule, from the answer's `updated`.
 */
export function updatedLine(updated: { date: string; clock: string }, today: string): string {
  return updated.date < today ? `${COPY.yesterday}, ${updated.clock}` : updated.clock;
}
