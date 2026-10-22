/**
 * The widget planner: what a widget shows from one answer until it is reloaded. A widget can't
 * work anything out as time passes, so each change the answer already knows about (the hours
 * ahead, 6pm and midnight at the place, the end of the forecast) is planned as an entry of its own.
 *
 * Swift: `IsItLogic/WidgetPlanner.swift`, checked against the golden vectors in `widget.json`.
 */
import { HOUR, WIDGET, type ApiSnowDay, type SnowBand } from '@isithot/core';
import type { AppResponse } from './types';
import { usableUntil } from './freshness';
import { middleDay, pickHour } from './hours';

const MINUTE = 60 * 1000;

/** A day in the medium widget's list. */
export interface WidgetDay {
  date: string;
  label: string;
  band: SnowBand;
  bandLabel: string;
  amount: number;
  snowy: number;
  total: number;
}

export interface WidgetEntry {
  /** When the entry starts showing. */
  date: number;
  /** Locked until bought; stale past `usableUntil`, or with nothing to show. */
  state: 'ok' | 'locked' | 'stale';
  placeName: string;
  /** "Today" or "Tomorrow" over the middle view's day; "today" when locked or stale. */
  slot: 'today' | 'tomorrow';
  day: ApiSnowDay | null;
  now: { answer: string; verdict: string; band: SnowBand } | null;
  /** Up to 4 days after the middle view's day. */
  week: WidgetDay[];
  /** The palette and glyph: the middle view's day's band, else `nosnow`. */
  palette: SnowBand;
}

/**
 * Entries from `now`: one now, one at each hour ahead after it, then a stale one at
 * `usableUntil`. Locked: a single entry, never reloaded (the app reloads widgets whenever the
 * purchase changes). No answer, or nothing usable now: a single stale entry. The reload comes
 * `WIDGET.refreshHours` after the answer was fetched, or at `usableUntil` if sooner; when that
 * has passed already, `WIDGET.retryMinutes` from now.
 */
export function widgetEntries(
  res: AppResponse | null,
  o: { fetchedAt: number; now: number; unlocked: boolean; placeName?: string },
): { entries: WidgetEntry[]; reloadAt: number | 'never' } {
  const placeName = o.placeName ?? res?.location.name ?? '';
  const blank = (date: number, state: 'locked' | 'stale'): WidgetEntry => ({
    date,
    state,
    placeName,
    slot: 'today',
    day: null,
    now: null,
    week: [],
    palette: 'nosnow',
  });
  if (!o.unlocked) return { entries: [blank(o.now, 'locked')], reloadAt: 'never' };

  const until = res ? usableUntil(res) : -Infinity;
  const reload = Math.min(o.fetchedAt + WIDGET.refreshHours * HOUR, until);
  const reloadAt = reload > o.now ? reload : o.now + WIDGET.retryMinutes * MINUTE;
  if (!res || !pickHour(res, o.now)) return { entries: [blank(o.now, 'stale')], reloadAt };

  const entry = (date: number): WidgetEntry => {
    const picked = pickHour(res, date)!;
    const { slot, day } = middleDay(res, picked, date);
    const after = day?.date ?? '';
    const now = picked.now;
    return {
      date,
      state: 'ok',
      placeName,
      slot,
      day,
      now: now && { answer: now.answer, verdict: now.verdict, band: now.band },
      week: (picked.week?.days ?? [])
        .filter((d) => d.date > after)
        .slice(0, 4)
        .map((d) => ({
          date: d.date,
          label: d.label,
          band: d.band,
          bandLabel: d.bandLabel,
          amount: d.amount,
          snowy: d.snowy,
          total: d.total,
        })),
      palette: day?.band ?? 'nosnow',
    };
  };
  const later = (res.snow?.ahead ?? [])
    .map((a) => Date.parse(a.time))
    .filter((t) => t > o.now && t < until);
  return { entries: [...[o.now, ...later].map(entry), blank(until, 'stale')], reloadAt };
}
