/**
 * Keeping the server's record of an app's notifications in step with the app (`PUT` and `DELETE`
 * on `/api/v1/devices`): what to send, and whether anything needs sending at all; the place and
 * the switches the app keeps for them (`alerts.v1`); and what the server's replies mean, a test
 * notification's (`POST /api/v1/devices/test`) too.
 *
 * Swift: `IsItLogic/AlertSync.swift`, `AlertSettings.swift` and `DeviceReplies.swift`, checked
 * against the golden vectors in `alerts.json`.
 */
import { ALERTS, type Units } from '@isithot/core';
import { CLIENT } from './config';
import { targetKey, type PlaceTarget, type Target } from './target';

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

/**
 * Where the app's notifications are for (`alerts.v1`'s place): a place chosen and fixed, which
 * never follows browsing, so checking a holiday town never moves them; or the phone's location,
 * the 0.05° cell it was last in, followed each time the app is opened. `name` is the chosen
 * place's name as the app showed it ("Leeds"), or '' when it had none.
 */
export type AlertPlace =
  { follows: false; target: PlaceTarget; name: string } | { follows: true; target: PlaceTarget };

/** One of the three switches. */
export type AlertSwitch = keyof AlertPrefs;

/**
 * The notification place when notifications are first turned on: the place on screen, chosen
 * and fixed, under `name`; the phone's location, followed, when the screen shows the phone's own
 * place; none for approximate IP location, which is never a notification place.
 */
export function firstAlertPlace(onScreen: Target, name: string | null): AlertPlace | null {
  if (onScreen.kind === 'ip') return null;
  if (onScreen.kind === 'coords' && onScreen.source === 'device') {
    return { follows: true, target: onScreen };
  }
  return { follows: false, target: onScreen, name: name ?? '' };
}

/**
 * A place that follows the phone, moved to `fix` when `fix` is the phone's place
 * (`source: 'device'`) in another cell; anything else is `place` itself (the same object).
 */
export function followLocation(place: AlertPlace | null, fix: Target): AlertPlace | null {
  if (!place?.follows || fix.kind !== 'coords' || fix.source !== 'device') return place;
  return targetKey(fix) === targetKey(place.target) ? place : { follows: true, target: fix };
}

/**
 * The switches once `which` is set to `on`. "Also when snow is possible" only widens the other
 * two: it can't be turned on while both are off, and turning the second of them off turns it off
 * too, so what the app keeps is what the server holds.
 */
export function setAlert(prefs: AlertPrefs, which: AlertSwitch, on: boolean): AlertPrefs {
  const next: AlertPrefs = {
    evening: prefs.evening,
    morning: prefs.morning,
    possible: prefs.possible,
  };
  if (which === 'possible' && on && !next.evening && !next.morning) return next;
  next[which] = on;
  if (!next.evening && !next.morning) next.possible = false;
  return next;
}

/** `PUT /api/v1/devices`'s 200 answer, as the server sends it (server `DeviceResponse`). */
export interface DeviceReply {
  id: string;
  place: { name: string; timezone: string; query: string };
  alerts: { snow: AlertPrefs };
  seenAt: string;
}

/** What a reply to `PUT` or `DELETE /api/v1/devices` means to the app. */
export type SyncReply =
  | { kind: 'stored'; reply: DeviceReply }
  | { kind: 'forgotten' }
  | { kind: 'retry'; afterSeconds: number }
  | { kind: 'placeRefused'; message: string }
  | { kind: 'failed' };

export type TestOutcome = 'sent' | 'dryRun' | 'limited' | 'quiet' | 'notRegistered' | 'failed';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A body as JSON, or undefined for one that isn't (a proxy's page, or none at all). */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** An error body's code and its message, each when it is text, each read on its own. */
function errorOf(body: unknown): { code?: string; message?: string } {
  const error = isObject(body) ? body.error : undefined;
  if (!isObject(error)) return {};
  const out: { code?: string; message?: string } = {};
  if (typeof error.code === 'string') out.code = error.code;
  if (typeof error.message === 'string') out.message = error.message;
  return out;
}

/** The server's record as the app keeps it, its fields and only those; null for anything else. */
function deviceReply(body: unknown): DeviceReply | null {
  if (!isObject(body) || !isObject(body.place) || !isObject(body.alerts)) return null;
  const { id, place, alerts, seenAt } = body;
  const snow = alerts.snow;
  if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id) || typeof seenAt !== 'string') {
    return null;
  }
  const { name, timezone, query } = place;
  if (typeof name !== 'string' || typeof timezone !== 'string' || typeof query !== 'string') {
    return null;
  }
  if (!isObject(snow)) return null;
  const { evening, morning, possible } = snow;
  if (
    typeof evening !== 'boolean' ||
    typeof morning !== 'boolean' ||
    typeof possible !== 'boolean'
  ) {
    return null;
  }
  return {
    id,
    place: { name, timezone, query },
    alerts: { snow: { evening, morning, possible } },
    seenAt,
  };
}

/** `Retry-After`'s whole seconds, 1 to 999999 written as digits; else the clients' minute. */
function retrySeconds(retryAfter: string | null): number {
  const seconds = retryAfter !== null && /^\d{1,6}$/.test(retryAfter) ? Number(retryAfter) : 0;
  return seconds >= 1 ? seconds : CLIENT.retryAfterMs / 1000;
}

/**
 * A devices reply, from its status, its body as text ('' for none) and its `Retry-After` header:
 * 200 with a `DeviceReply` is `stored` (any other 200 `failed`); 204 `forgotten`; 429 `retry`,
 * after `Retry-After`'s whole seconds when it is 1 to 999999 written as digits, else
 * `CLIENT.retryAfterMs`; 400 whose error code is `bad_location` with a message that isn't empty,
 * `placeRefused` with it; anything else `failed`. Never throws.
 */
export function syncReply(status: number, text: string, retryAfter: string | null): SyncReply {
  if (status === 200) {
    const reply = deviceReply(parsed(text));
    return reply ? { kind: 'stored', reply } : { kind: 'failed' };
  }
  if (status === 204) return { kind: 'forgotten' };
  if (status === 429) return { kind: 'retry', afterSeconds: retrySeconds(retryAfter) };
  if (status === 400) {
    const { code, message } = errorOf(parsed(text));
    if (code === 'bad_location' && message) return { kind: 'placeRefused', message };
  }
  return { kind: 'failed' };
}

/** The test's refusals the app has words for, by status and the server's code. */
const TEST_REFUSALS: Record<number, [string, TestOutcome]> = {
  429: ['test_limited', 'limited'],
  409: ['quiet_hours', 'quiet'],
  404: ['not_registered', 'notRegistered'],
};

/**
 * `POST /api/v1/devices/test`'s reply: 202 whose `sent` is true `sent`; 202 whose `sent` is false
 * and `dryRun` true `dryRun`; 429 with code `test_limited` `limited` (Netlify's own 429,
 * `rate_limited`, is `failed`); 409 `quiet_hours` `quiet`; 404 `not_registered`
 * `notRegistered`; anything else `failed`. Never throws.
 */
export function testOutcome(status: number, text: string): TestOutcome {
  const body = parsed(text);
  if (status === 202) {
    if (!isObject(body)) return 'failed';
    if (body.sent === true) return 'sent';
    return body.sent === false && body.dryRun === true ? 'dryRun' : 'failed';
  }
  const refusal = TEST_REFUSALS[status];
  return refusal && errorOf(body).code === refusal[0] ? refusal[1] : 'failed';
}
