/**
 * Where a link into the app, or a tap on one of its notifications, opens it.
 *
 * Swift: `IsItLogic/DeepLink.swift`, checked against the golden vectors in `links.json`.
 */
import { VIEWS, type View } from '@isithot/core';
import { targetFromQuery, type PlaceTarget, type Target } from './target';

const DAY = 24 * 60 * 60 * 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date (YYYY-MM-DD) as its UTC midnight, or null: 2026-02-30 is not one. */
function calendarDay(value: unknown): number | null {
  const ms = typeof value === 'string' && DATE.test(value) ? Date.parse(value) : NaN;
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

export type Route =
  /** willitsnow://view/now, today or week (a widget). */
  | { kind: 'view'; view: View }
  /** willitsnow://upgrade (a locked widget). */
  | { kind: 'upgrade' }
  /** willitsnow://settings/notifications. */
  | { kind: 'settings'; section: 'notifications' }
  /** A notification tap: its place, on a view or on the place's view for the time of day. */
  | { kind: 'place'; target: PlaceTarget; view: View | 'default' };

/**
 * A willitsnow:// link (the app's URL scheme). Case is ignored, and so is a query or fragment;
 * anything else is null, and the app opens as usual.
 */
export function parseDeepLink(url: string): Route | null {
  const m = /^willitsnow:\/\/([a-z]+)(?:\/([a-z]+))?\/?(?:[?#]|$)/.exec(url.trim().toLowerCase());
  const [, host, path] = m ?? [];
  if (host === 'view') {
    const view = VIEWS.find((v) => v === path);
    return view ? { kind: 'view', view } : null;
  }
  if (host === 'upgrade' && !path) return { kind: 'upgrade' };
  if (host === 'settings' && path === 'notifications') {
    return { kind: 'settings', section: 'notifications' };
  }
  return null;
}

/**
 * The willitsnow:// link that opens `route` (`parseDeepLink`'s inverse): a view, the upgrade, or
 * Settings' notifications. Null for a place, which only a notification's payload carries.
 */
export function routeLink(route: Route): string | null {
  switch (route.kind) {
    case 'view':
      return `willitsnow://view/${route.view}`;
    case 'upgrade':
      return 'willitsnow://upgrade';
    case 'settings':
      return `willitsnow://settings/${route.section}`;
    case 'place':
      return null;
  }
}

/**
 * Where a tap on a notification goes: to the notification's own place, which need not be the one
 * on screen. It opens on the notification's view (the middle one) while the day it was about is
 * still today or tomorrow there: after 6pm the middle view reads Tomorrow and after midnight
 * Today, either way that day. Once the day has passed it opens on the place's view for the time
 * of day ('default'). `placeToday` gives the place's date now (YYYY-MM-DD), or null when the app
 * can't tell (it has no answer there yet), and the notification is then taken as current. Where
 * you are comes as its cell, from the phone or from the connection alike. A payload that is
 * malformed, for another topic, or for approximate IP location (no place), is null: the app opens
 * as usual.
 */
export function notificationRoute(
  payload: unknown,
  placeToday: (t: Target) => string | null,
): Route | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { topic, date, view, place, name } = payload as Record<string, unknown>;
  const shown = VIEWS.find((v) => v === view);
  const day = calendarDay(date);
  if (topic !== 'snow' || !shown || day === null || typeof place !== 'string') return null;
  const found = targetFromQuery(place);
  // The server writes a place or a point into a payload, never approximate IP location.
  if (found === null || found.kind === 'ip') return null;
  // A city's query has no name, but the notification has.
  const target =
    found.kind === 'city' && typeof name === 'string' && name ? { ...found, name } : found;
  const today = placeToday(target);
  const ahead = today === null ? 0 : (day - Date.parse(today)) / DAY;
  return { kind: 'place', target, view: ahead === 0 || ahead === 1 ? shown : 'default' };
}
