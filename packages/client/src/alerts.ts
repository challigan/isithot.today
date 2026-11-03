/**
 * Keeping the server's record of an app's notifications in step with the app (`PUT` and `DELETE`
 * on `/api/v1/devices`, version 2): where you are, the free place, and what to send for it;
 * whether anything needs sending at all; and what the server's replies mean, a test
 * notification's (`POST /api/v1/devices/test`) too. The app keeps the switches and the phone's
 * last cell in `alerts.v2`, and the last registration the server took in `alertSync.v2`.
 *
 * Swift: `IsItLogic/AlertSync.swift`, `AlertSettings.swift` and `DeviceReplies.swift`, checked
 * against the golden vectors in `alerts.json`.
 */
import { ALERTS, COPY, isValidLatLon, type Units } from '@isithot/core';
import { CLIENT } from './config';
import { deviceTarget, targetFromQuery, targetKey, type CoordsTarget, type Target } from './target';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** The notification switches: the evening before, on the day, and also when snow is possible. */
export interface AlertPrefs {
  evening: boolean;
  morning: boolean;
  possible: boolean;
}

/** The app's notification permission, as the system reports it. */
export type Permission = 'authorized' | 'provisional' | 'denied' | 'notDetermined';

/** The app's location access, as the system reports it: restricted reads as denied. */
export type LocationAccess = 'granted' | 'denied' | 'notDetermined';

export type PushEnv = 'sandbox' | 'production';

/**
 * Where you are, the free place: the phone's own 0.05° cell, or approximate, the town the server
 * finds from the connection of the registration itself. Never a place chosen on screen, so its
 * own type: a `PlaceTarget` can't be approximate.
 */
export type HerePlace = { kind: 'device'; target: CoordsTarget } | { kind: 'ip' };

/** A cell as `alerts.v2` keeps it (`here`): the phone's last, while location access is allowed. */
export interface KeptCell {
  lat: number;
  lon: number;
}

/**
 * Where you are, from the phone's location access, this launch's fix and the cell kept from an
 * earlier one: the phone's cell while access is allowed and there is a fix, else the kept cell;
 * otherwise approximate. A fix that isn't the phone's own (`source: 'device'`), or a point that
 * isn't on Earth, is no fix. The cell is on the grid and carries nothing else, so nothing finer
 * leaves the phone. What `alerts.v2` keeps is this cell, and nothing while approximate.
 */
export function herePlace(o: {
  access: LocationAccess;
  fix: Target | null;
  kept: KeptCell | null;
}): HerePlace {
  if (o.access !== 'granted') return { kind: 'ip' };
  const onEarth = (p: KeptCell | null): p is KeptCell => p !== null && isValidLatLon(p.lat, p.lon);
  const fix = o.fix?.kind === 'coords' && o.fix.source === 'device' ? o.fix : null;
  const cell = onEarth(fix) ? fix : onEarth(o.kept) ? o.kept : null;
  return cell ? { kind: 'device', target: deviceTarget(cell.lat, cell.lon) } : { kind: 'ip' };
}

/** Where you are as a registration names it: for the server to locate, or the phone's point. */
export type HereBody = { source: 'ip' } | { lat: number; lon: number; source: 'device' };

/** A saved place as a registration names it, in a form `/api/v1/today` takes too. */
export type SavedBody =
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
    };

/** The body of `PUT /api/v1/devices`, version 2: the device's whole set, which the server keeps. */
export interface RegistrationBody {
  v: 2;
  app: 'snow';
  platform: 'ios';
  env: PushEnv;
  token: string;
  units: Units;
  appVersion: string;
  alerts: { snow: AlertPrefs };
  here: HereBody;
  saved: SavedBody[];
}

export type AlertAction = 'put' | 'delete' | 'none' | 'needsToken';

/** Where you are as the body names it: the cell's point alone. */
function hereBody(here: HerePlace): HereBody {
  if (here.kind === 'ip') return { source: 'ip' };
  return { lat: here.target.lat, lon: here.target.lon, source: 'device' };
}

/** The registration: the switches for where you are, and no saved place. */
export function registrationBody(o: {
  token: string;
  env: PushEnv;
  here: HerePlace;
  units: Units;
  prefs: AlertPrefs;
  appVersion: string;
}): RegistrationBody {
  return {
    v: 2,
    app: 'snow',
    platform: 'ios',
    env: o.env,
    token: o.token,
    units: o.units,
    appVersion: o.appVersion,
    alerts: {
      snow: { evening: o.prefs.evening, morning: o.prefs.morning, possible: o.prefs.possible },
    },
    here: hereBody(o.here),
    saved: [],
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

/** A registration sent: its fingerprint, and when, epoch ms. */
export interface Sent {
  fingerprint: string;
  at: number;
}

/**
 * What to do about the server's record, in order: delete it (if there is one) when no
 * notification is switched on or the permission is denied ("also when snow is possible" only
 * widens the other two, so alone it switches nothing on); wait for the push token; nothing while
 * the server has refused this very registration (`refused`, a 400: it couldn't tell where you
 * are) and the app hasn't become active since; otherwise send it when it has changed since `last`
 * was sent, when `ALERTS.heartbeatDays` have passed since, or, while where you are is approximate,
 * when the app became active (`activeAt`) `ALERTS.hereRefreshMinutes` or more after it: the
 * server locates the connection afresh at each registration.
 */
export function alertAction(o: {
  prefs: AlertPrefs;
  permission: Permission;
  token: string | null;
  here: HerePlace;
  units: Units;
  last: Sent | null;
  refused: Sent | null;
  activeAt: number;
  now: number;
  env: PushEnv;
  appVersion: string;
}): AlertAction {
  if ((!o.prefs.evening && !o.prefs.morning) || o.permission === 'denied') {
    return o.last ? 'delete' : 'none';
  }
  if (!o.token) return 'needsToken';
  const said = fingerprint(
    registrationBody({
      token: o.token,
      env: o.env,
      here: o.here,
      units: o.units,
      prefs: o.prefs,
      appVersion: o.appVersion,
    }),
  );
  if (o.refused && o.refused.fingerprint === said && o.refused.at >= o.activeAt) return 'none';
  if (!o.last || said !== o.last.fingerprint) return 'put';
  if (o.now - o.last.at >= ALERTS.heartbeatDays * DAY) return 'put';
  const refresh = o.activeAt - o.last.at >= ALERTS.hereRefreshMinutes * MINUTE;
  return o.here.kind === 'ip' && refresh ? 'put' : 'none';
}

/** One of the three switches. */
export type AlertSwitch = keyof AlertPrefs;

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

/** One of the set's places as the server's answer names it. */
export interface PlaceReply {
  /** The place's `location.name`: core's "Your location" for a point with no town near. */
  name: string;
  timezone: string;
  /** The canonical today query: "place=durham-gb", or "lat=53.8&lon=-1.55&source=device". */
  query: string;
  /** ISO 3166-1 alpha-2, or null without one. */
  country: string | null;
}

/** Where you are, as the server stored it, and what it follows: the phone or the connection. */
export interface HereReply extends PlaceReply {
  follows: 'device' | 'ip';
}

/** A saved place, as the server stored it, by its pid (12 hex). */
export interface SavedReply extends PlaceReply {
  pid: string;
}

/**
 * `PUT /api/v1/devices`'s 200 answer to a version 2 body, as the server sends it (server
 * `DeviceResponseV2`): the set as stored, which "Your privacy" shows.
 */
export interface DeviceReply {
  id: string;
  /** The phone's zone while a saved place keeps it, else null. */
  deviceTz: string | null;
  /** Where you are, or null when the server has no free place (it couldn't locate one). */
  here: HereReply | null;
  /** The saved places, in the body's order. */
  saved: SavedReply[];
  /** The body's saved places the server dropped: each one's index there, and why. */
  refused: Array<{ index: number; code: string }>;
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

/** What a reply to a test means: `sent` with how many tests went (1 or 2). */
export type TestOutcome =
  | { kind: 'sent'; count: number }
  | { kind: 'dryRun' }
  | { kind: 'limited' }
  | { kind: 'quiet' }
  | { kind: 'notRegistered' }
  | { kind: 'failed' };

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

/** A place of the reply, its fields and only those; null for anything else. */
function placeReply(value: unknown): PlaceReply | null {
  if (!isObject(value)) return null;
  const { name, timezone, query, country } = value;
  if (typeof name !== 'string' || typeof timezone !== 'string' || typeof query !== 'string') {
    return null;
  }
  if (country !== null && typeof country !== 'string') return null;
  return { name, timezone, query, country };
}

/** Where you are in the reply: null for none, undefined for anything else. */
function hereReply(value: unknown): HereReply | null | undefined {
  if (value === null) return null;
  const place = placeReply(value);
  const follows = isObject(value) ? value.follows : undefined;
  if (!place || (follows !== 'device' && follows !== 'ip')) return undefined;
  return { ...place, follows };
}

/** A saved place in the reply, with its pid; null for anything else. */
function savedReply(value: unknown): SavedReply | null {
  const place = placeReply(value);
  const pid = isObject(value) ? value.pid : undefined;
  if (!place || typeof pid !== 'string' || !/^[0-9a-f]{12}$/.test(pid)) return null;
  return { pid, ...place };
}

/** A refused entry: its whole index, at least 0, and its code; null for anything else. */
function refusedReply(value: unknown): { index: number; code: string } | null {
  if (!isObject(value)) return null;
  const { index, code } = value;
  if (!Number.isInteger(index) || (index as number) < 0 || typeof code !== 'string') return null;
  return { index: index as number, code };
}

/** Each item of a list read by `read`, or null if it isn't a list or any item doesn't read. */
function listOf<T>(value: unknown, read: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map(read);
  return items.every((item) => item !== null) ? (items as T[]) : null;
}

/**
 * The server's set as the app keeps it, its fields and only those, each read on its own; null
 * for anything else (8.1's answer, which names one place, included). `refused` may be left out.
 */
function deviceReply(body: unknown): DeviceReply | null {
  if (!isObject(body) || !isObject(body.alerts)) return null;
  const { id, deviceTz, alerts, seenAt } = body;
  if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id) || typeof seenAt !== 'string') {
    return null;
  }
  if (deviceTz !== null && typeof deviceTz !== 'string') return null;
  const here = hereReply(body.here);
  const saved = listOf(body.saved, savedReply);
  const refused = body.refused === undefined ? [] : listOf(body.refused, refusedReply);
  if (here === undefined || !saved || !refused) return null;
  const snow = alerts.snow;
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
    deviceTz,
    here,
    saved,
    refused,
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
 * `CLIENT.retryAfterMs` (the one-write-a-minute rule, and the cap on places new to the set);
 * 400 whose error code is `bad_location` with a message that isn't empty, `placeRefused` with it
 * (the server couldn't tell where you are, and has forgotten the set); anything else `failed`.
 * Never throws.
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

/** How Settings tells where you are: the phone's location, approximate, or not found. */
export type HereKind = 'device' | 'ip' | 'unknown';

/**
 * How where you are was found, for Settings' row: the phone's location while its cell is what is
 * sent (`here`, from `herePlace`); otherwise approximate, unless the server couldn't tell where
 * the connection is: its last answer had no free place, or it refused the registration (a 400,
 * `refused`), after which no answer is kept.
 */
export function hereKind(o: {
  here: HerePlace;
  reply: DeviceReply | null;
  refused: boolean;
}): HereKind {
  if (o.here.kind === 'device') return 'device';
  return o.refused || o.reply?.here === null ? 'unknown' : 'ip';
}

/**
 * The town the server named where you are, for Settings' row and the card: its last answer's,
 * when that answer is about the kind of place sent now (`here`); null before an answer, for one
 * about the other kind, and for a name the server couldn't give (core's "Your location", or
 * none), which is never shown as a town.
 */
export function hereName(o: { here: HerePlace; reply: DeviceReply | null }): string | null {
  const found = o.reply?.here;
  if (!found || found.follows !== o.here.kind) return null;
  return found.name && found.name !== COPY.yourLocation ? found.name : null;
}

/**
 * Each place's zone in the server's answer, by the place's `targetKey`, where you are first: what
 * a notification's tap opens its day by. A query that names no place is left out, and the first
 * zone is kept for one key.
 */
export function replyZones(reply: DeviceReply): Record<string, string> {
  const zones: Record<string, string> = {};
  for (const place of [reply.here, ...reply.saved]) {
    const target = place && targetFromQuery(place.query);
    if (!target || target.kind === 'ip') continue;
    zones[targetKey(target)] ??= place.timezone;
  }
  return zones;
}

/** The test's refusals the app has words for, by status and the server's code. */
const TEST_REFUSALS: Record<number, [string, TestOutcome]> = {
  429: ['test_limited', { kind: 'limited' }],
  409: ['quiet_hours', { kind: 'quiet' }],
  404: ['not_registered', { kind: 'notRegistered' }],
};

/**
 * `POST /api/v1/devices/test`'s reply: 202 whose `sent` is true `sent`, with its `count` when
 * that is a whole number 1 or more, else 1 (the server says `count` only above one); 202 whose
 * `sent` is false and `dryRun` true `dryRun`; 429 with code `test_limited` `limited` (Netlify's
 * own 429, `rate_limited`, is `failed`); 409 `quiet_hours` `quiet`; 404 `not_registered`
 * `notRegistered`; anything else `failed`. Never throws.
 */
export function testOutcome(status: number, text: string): TestOutcome {
  const body = parsed(text);
  if (status === 202) {
    if (!isObject(body)) return { kind: 'failed' };
    if (body.sent === true) {
      const count = Number.isInteger(body.count) && (body.count as number) >= 1 ? body.count : 1;
      return { kind: 'sent', count: count as number };
    }
    return body.sent === false && body.dryRun === true ? { kind: 'dryRun' } : { kind: 'failed' };
  }
  const refusal = TEST_REFUSALS[status];
  return refusal && errorOf(body).code === refusal[0] ? { ...refusal[1] } : { kind: 'failed' };
}
