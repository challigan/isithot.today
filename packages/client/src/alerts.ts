/**
 * Keeping the server's record of an app's notifications in step with the app (`PUT` and `DELETE`
 * on `/api/v1/devices`): what to send, and whether anything needs sending at all.
 *
 * Swift: `IsItLogic/AlertSync.swift`, checked against the golden vectors in `alerts.json`.
 */
import { ALERTS, type Units } from '@isithot/core';
import type { PlaceTarget, Target } from './target';

const DAY = 24 * 60 * 60 * 1000;

/** The notification switches: the evening before, on the day, and also when snow is possible. */
export interface AlertPrefs {
  evening: boolean;
  morning: boolean;
  possible: boolean;
}

/** The app's notification permission, as the system reports it. */
export type Permission = 'authorized' | 'provisional' | 'denied' | 'notDetermined';

export type PushEnv = 'sandbox' | 'production';

/** A registration's place, in a form `/api/v1/today` takes too. */
export type RegistrationPlace =
  | { place: string }
  | {
      lat: number;
      lon: number;
      source: 'search';
      name?: string;
      region?: string;
      country?: string;
      geonameId?: number;
      elevation?: number;
    }
  | { lat: number; lon: number; source: 'device' };

/** The body of `PUT /api/v1/devices`. */
export interface RegistrationBody {
  app: 'snow';
  platform: 'ios';
  env: PushEnv;
  token: string;
  place: RegistrationPlace;
  units: Units;
  alerts: { snow: AlertPrefs };
  appVersion: string;
}

export type AlertAction = 'put' | 'delete' | 'none' | 'needsPlace' | 'needsToken';

/** Notifications are for a place someone chose: never the approximate IP one. */
export function alertPlaceAllowed(t: Target | null): t is PlaceTarget {
  return t !== null && t.kind !== 'ip';
}

/** The place as the today query names it (`todayQuery`), with the same fields. */
function registrationPlace(t: PlaceTarget): RegistrationPlace {
  if (t.kind === 'city') return { place: t.slug };
  if (t.source === 'device') return { lat: t.lat, lon: t.lon, source: 'device' };
  const p: Extract<RegistrationPlace, { source: 'search' }> = {
    lat: t.lat,
    lon: t.lon,
    source: 'search',
  };
  if (t.name) p.name = t.name;
  if (t.region) p.region = t.region;
  if (t.country) p.country = t.country;
  if (t.geonameId) p.geonameId = t.geonameId;
  if (t.elevation !== undefined) p.elevation = t.elevation;
  return p;
}

export function registrationBody(o: {
  token: string;
  env: PushEnv;
  place: PlaceTarget;
  units: Units;
  prefs: AlertPrefs;
  appVersion: string;
}): RegistrationBody {
  return {
    app: 'snow',
    platform: 'ios',
    env: o.env,
    token: o.token,
    place: registrationPlace(o.place),
    units: o.units,
    alerts: {
      snow: { evening: o.prefs.evening, morning: o.prefs.morning, possible: o.prefs.possible },
    },
    appVersion: o.appVersion,
  };
}

/**
 * What a registration says, as JSON with its keys sorted at every level (a list keeps its
 * order), leaving out `appVersion`: an app update alone is no reason to register again.
 */
export function fingerprint(body: RegistrationBody): string {
  const { appVersion: _, ...said } = body;
  return JSON.stringify(said, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, (value as Record<string, unknown>)[k]]),
        )
      : value,
  );
}

/**
 * What to do about the server's record, in order: delete it (if there is one) when no
 * notification is switched on or the permission is denied ("also when snow is possible" only
 * widens the other two, so alone it switches nothing on); ask for a place when there is none
 * chosen; wait for the push token; otherwise send it again when it has changed, or when
 * `ALERTS.heartbeatDays` have passed since it was last sent.
 */
export function alertAction(o: {
  prefs: AlertPrefs;
  permission: Permission;
  token: string | null;
  place: Target | null;
  units: Units;
  last: { fingerprint: string; at: number } | null;
  now: number;
  env: PushEnv;
  appVersion: string;
}): AlertAction {
  if ((!o.prefs.evening && !o.prefs.morning) || o.permission === 'denied') {
    return o.last ? 'delete' : 'none';
  }
  if (!alertPlaceAllowed(o.place)) return 'needsPlace';
  if (!o.token) return 'needsToken';
  const body = registrationBody({
    token: o.token,
    env: o.env,
    place: o.place,
    units: o.units,
    prefs: o.prefs,
    appVersion: o.appVersion,
  });
  if (!o.last || fingerprint(body) !== o.last.fingerprint) return 'put';
  return o.now - o.last.at >= ALERTS.heartbeatDays * DAY ? 'put' : 'none';
}
