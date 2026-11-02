import { describe, expect, it } from 'vitest';
import { ALERTS } from '@isithot/core';
import {
  alertAction,
  alertPlaceAllowed,
  fingerprint,
  firstAlertPlace,
  followLocation,
  registrationBody,
  setAlert,
  syncReply,
  testOutcome,
  type AlertPlace,
  type AlertPrefs,
  type AlertSwitch,
  type Permission,
  type RegistrationBody,
} from '../src/alerts';
import { CLIENT } from '../src/config';
import { deviceTarget, searchTarget, type PlaceTarget } from '../src/target';

const DAY = 24 * 60 * 60 * 1000;
const TOKEN = 'a1b2'.repeat(16);
const leeds: PlaceTarget = { kind: 'city', slug: 'leeds-gb', name: 'Leeds' };
const evening: AlertPrefs = { evening: true, morning: false, possible: false };

const body = (place: PlaceTarget = leeds, prefs = evening) =>
  registrationBody({
    token: TOKEN,
    env: 'production',
    place,
    units: 'c',
    prefs,
    appVersion: '1.0 (112)',
  });

describe('alertPlaceAllowed', () => {
  it('allows a chosen place only', () => {
    expect(alertPlaceAllowed(null)).toBe(false);
    expect(alertPlaceAllowed({ kind: 'ip' })).toBe(false);
    expect(alertPlaceAllowed(leeds)).toBe(true);
    expect(alertPlaceAllowed(deviceTarget(53.8, -1.55))).toBe(true);
  });
});

describe('registrationBody', () => {
  it('is the registration the server takes', () => {
    expect(body()).toEqual({
      app: 'snow',
      platform: 'ios',
      env: 'production',
      token: TOKEN,
      place: { place: 'leeds-gb' },
      units: 'c',
      alerts: { snow: { evening: true, morning: false, possible: false } },
      appVersion: '1.0 (112)',
    });
  });

  it('names a searched place with what the search knew, and a device location by its point', () => {
    const hexham = searchTarget({
      name: 'Hexham',
      region: 'England',
      country: 'GB',
      countryName: 'United Kingdom',
      lat: 54.97,
      lon: -2.1,
      geonameId: 2647356,
      elevation: 50,
    });
    expect(body(hexham).place).toEqual({
      lat: 54.95,
      lon: -2.1,
      name: 'Hexham',
      region: 'England',
      country: 'GB',
      geonameId: 2647356,
      elevation: 50,
      source: 'search',
    });
    // Nothing it doesn't know, not even as null.
    const bare = { kind: 'coords', source: 'search', lat: 1, lon: 2, region: null } as const;
    expect(JSON.stringify(body(bare).place)).toBe('{"lat":1,"lon":2,"source":"search"}');
    const named = { ...deviceTarget(53.8, -1.55), name: 'Leeds' };
    expect(body(named).place).toEqual({ lat: 53.8, lon: -1.55, source: 'device' });
  });

  it('copies the switches and nothing else', () => {
    const prefs = { evening: false, morning: true, possible: true, extra: 1 } as AlertPrefs;
    expect(body(leeds, prefs).alerts).toEqual({
      snow: { evening: false, morning: true, possible: true },
    });
  });
});

describe('fingerprint', () => {
  it('is the body as JSON, keys sorted at every level, without the app version', () => {
    expect(fingerprint(body())).toBe(
      '{"alerts":{"snow":{"evening":true,"morning":false,"possible":false}},"app":"snow",' +
        `"env":"production","place":{"place":"leeds-gb"},"platform":"ios","token":"${TOKEN}",` +
        '"units":"c"}',
    );
    expect(fingerprint({ ...body(), appVersion: '1.1 (130)' })).toBe(fingerprint(body()));
  });

  it('sorts keys only: a list keeps its order, as in canonical JSON', () => {
    const listed = { ...body(), topics: ['snow', 'wind'] } as RegistrationBody;
    expect(fingerprint(listed)).toContain(`"token":"${TOKEN}","topics":["snow","wind"],`);
  });

  it('changes with anything the server keeps', () => {
    const base = fingerprint(body());
    const changed = [
      { ...body(), token: 'f'.repeat(64) },
      { ...body(), env: 'sandbox' as const },
      { ...body(), units: 'f' as const },
      body({ kind: 'city', slug: 'york-gb' }),
      body(leeds, { ...evening, possible: true }),
    ];
    for (const b of changed) expect(fingerprint(b)).not.toBe(base);
  });
});

describe('alertAction', () => {
  const now = Date.parse('2026-12-01T18:00:00Z');
  const sent = { fingerprint: fingerprint(body()), at: now - DAY };
  const state = {
    prefs: evening,
    permission: 'authorized' as Permission,
    token: TOKEN as string | null,
    place: leeds as PlaceTarget | { kind: 'ip' } | null,
    units: 'c' as const,
    last: sent as typeof sent | null,
    now,
    env: 'production' as const,
    appVersion: '1.0 (112)',
  };
  const off = { evening: false, morning: false, possible: false };

  it('deletes the registration when every switch is off, if there is one', () => {
    expect(alertAction({ ...state, prefs: off })).toBe('delete');
    expect(alertAction({ ...state, prefs: off, last: null })).toBe('none');
    // "Also when snow is possible" alone switches nothing on.
    expect(alertAction({ ...state, prefs: { ...off, possible: true } })).toBe('delete');
    expect(alertAction({ ...state, prefs: off, place: null, token: null })).toBe('delete');
  });

  it('deletes it when the permission is denied, before asking for anything', () => {
    expect(alertAction({ ...state, permission: 'denied' })).toBe('delete');
    expect(alertAction({ ...state, permission: 'denied', last: null })).toBe('none');
    expect(alertAction({ ...state, permission: 'denied', place: { kind: 'ip' } })).toBe('delete');
  });

  it('asks for a chosen place, then waits for the push token', () => {
    expect(alertAction({ ...state, place: { kind: 'ip' } })).toBe('needsPlace');
    expect(alertAction({ ...state, place: null, token: null })).toBe('needsPlace');
    expect(alertAction({ ...state, token: null })).toBe('needsToken');
    expect(alertAction({ ...state, token: '' })).toBe('needsToken');
  });

  it('sends what changed, and otherwise again once a week', () => {
    expect(alertAction({ ...state, last: null })).toBe('put');
    expect(alertAction({ ...state, units: 'f' })).toBe('put');
    expect(alertAction({ ...state, prefs: { ...evening, morning: true } })).toBe('put');
    expect(alertAction({ ...state, place: deviceTarget(53.8, -1.55) })).toBe('put');
    expect(alertAction({ ...state, env: 'sandbox' })).toBe('put');
    expect(alertAction(state)).toBe('none');
    // An app update alone sends nothing.
    expect(alertAction({ ...state, appVersion: '1.1 (130)' })).toBe('none');
    const week = ALERTS.heartbeatDays * DAY;
    expect(alertAction({ ...state, last: { ...sent, at: now - week + 1 } })).toBe('none');
    expect(alertAction({ ...state, last: { ...sent, at: now - week } })).toBe('put');
  });

  it('treats a permission not yet asked, or quiet, like a granted one', () => {
    expect(alertAction({ ...state, permission: 'notDetermined' })).toBe('none');
    expect(alertAction({ ...state, permission: 'provisional', last: null })).toBe('put');
  });
});

describe('firstAlertPlace', () => {
  it('is never approximate IP location', () => {
    expect(firstAlertPlace({ kind: 'ip' }, null)).toBeNull();
    expect(firstAlertPlace({ kind: 'ip' }, 'Leeds')).toBeNull();
  });

  it('chooses a city or a searched place, fixed, under the name the app showed', () => {
    expect(firstAlertPlace(leeds, 'Leeds')).toEqual({
      follows: false,
      target: leeds,
      name: 'Leeds',
    });
    expect(firstAlertPlace(leeds, null)).toEqual({ follows: false, target: leeds, name: '' });
    const hexham = {
      kind: 'coords',
      source: 'search',
      lat: 54.95,
      lon: -2.1,
      name: 'Hexham',
    } as const;
    expect(firstAlertPlace(hexham, 'Hexham')).toEqual({
      follows: false,
      target: hexham,
      name: 'Hexham',
    });
  });

  it("follows the phone when the screen shows the phone's own place", () => {
    const here = deviceTarget(53.8, -1.55);
    expect(firstAlertPlace(here, 'Leeds')).toEqual({ follows: true, target: here });
    expect(firstAlertPlace(here, null)).toEqual({ follows: true, target: here });
  });
});

describe('followLocation', () => {
  const here = deviceTarget(53.8, -1.55);
  const following: AlertPlace = { follows: true, target: here };
  const chosen: AlertPlace = { follows: false, target: leeds, name: 'Leeds' };

  it('moves a place that follows the phone to a fix in another cell', () => {
    const there = deviceTarget(53.85, -1.55);
    expect(followLocation(following, there)).toEqual({ follows: true, target: there });
  });

  it('leaves everything else as it is, the same object', () => {
    expect(followLocation(null, here)).toBeNull();
    expect(followLocation(chosen, deviceTarget(53.85, -1.55))).toBe(chosen);
    // The same cell, however the fix was rounded.
    expect(followLocation(following, deviceTarget(53.81, -1.56))).toBe(following);
    // Only the phone's own place is a fix: a searched place or IP location never moves it.
    const searched = { kind: 'coords', source: 'search', lat: 53.85, lon: -1.55 } as const;
    expect(followLocation(following, searched)).toBe(following);
    expect(followLocation(following, { kind: 'ip' })).toBe(following);
    expect(followLocation(following, { kind: 'city', slug: 'york-gb' })).toBe(following);
  });
});

describe('setAlert', () => {
  const prefs = (evening: boolean, morning: boolean, possible: boolean): AlertPrefs => ({
    evening,
    morning,
    possible,
  });
  const from = {
    off: prefs(false, false, false),
    evening: prefs(true, false, false),
    both: prefs(true, true, false),
    all: prefs(true, true, true),
    possibleOnly: prefs(false, false, true),
  };

  it('turns the evening and the morning on and off', () => {
    for (const which of ['evening', 'morning'] as const) {
      for (const [name, before] of Object.entries(from)) {
        const on = setAlert(before, which, true);
        expect(on, `${name} ${which} on`).toEqual({ ...before, [which]: true });
      }
    }
    expect(setAlert(from.both, 'evening', false)).toEqual(prefs(false, true, false));
    expect(setAlert(from.both, 'morning', false)).toEqual(prefs(true, false, false));
    expect(setAlert(from.evening, 'morning', false)).toEqual(from.evening);
    expect(setAlert(from.off, 'evening', false)).toEqual(from.off);
  });

  it('keeps "possible" while one of the two is still on', () => {
    expect(setAlert(from.all, 'evening', false)).toEqual(prefs(false, true, true));
    expect(setAlert(from.all, 'morning', false)).toEqual(prefs(true, false, true));
  });

  it('turns "possible" off with the second of the two', () => {
    expect(setAlert(prefs(true, false, true), 'evening', false)).toEqual(from.off);
    expect(setAlert(prefs(false, true, true), 'morning', false)).toEqual(from.off);
    expect(setAlert(from.possibleOnly, 'evening', false)).toEqual(from.off);
  });

  it('turns "possible" on and off only beside one of the two', () => {
    expect(setAlert(from.evening, 'possible', true)).toEqual(prefs(true, false, true));
    expect(setAlert(from.both, 'possible', true)).toEqual(from.all);
    expect(setAlert(from.all, 'possible', false)).toEqual(from.both);
    expect(setAlert(from.possibleOnly, 'possible', false)).toEqual(from.off);
    // Alone, it would switch nothing on: refused, as a copy.
    for (const before of [from.off, from.possibleOnly]) {
      const after = setAlert(before, 'possible', true);
      expect(after).toEqual(before);
      expect(after).not.toBe(before);
    }
  });

  it('gives a copy of the three switches, and nothing else', () => {
    const extra = { ...from.evening, extra: 1 } as AlertPrefs;
    for (const which of ['evening', 'morning', 'possible'] satisfies AlertSwitch[]) {
      const after = setAlert(extra, which, true);
      expect(after).not.toBe(extra);
      expect(Object.keys(after)).toEqual(['evening', 'morning', 'possible']);
    }
    expect(extra).toEqual({ ...from.evening, extra: 1 });
  });
});

describe('syncReply', () => {
  const reply = {
    id: '3f9c1a2b4d5e6f708192a3b4c5d6e7f8',
    place: { name: 'Leeds', timezone: 'Europe/London', query: 'place=leeds-gb' },
    alerts: { snow: { evening: true, morning: false, possible: false } },
    seenAt: '2026-12-01T09:05:00.000Z',
  };
  const text = (o: unknown) => JSON.stringify(o);
  const failed = { kind: 'failed' };

  it("keeps the server's record from its 200, field by field", () => {
    expect(syncReply(200, text(reply), null)).toEqual({ kind: 'stored', reply });
    // Fields it doesn't know are left out of what is kept.
    expect(syncReply(200, text({ ...reply, tz: 'Europe/London' }), null)).toEqual({
      kind: 'stored',
      reply,
    });
  });

  it('fails a 200 that is not a record', () => {
    const changed = [
      { ...reply, id: reply.id.slice(1) },
      { ...reply, id: reply.id.toUpperCase() },
      { ...reply, id: 42 },
      { ...reply, place: { name: 'Leeds', timezone: 'Europe/London' } },
      { ...reply, place: null },
      { ...reply, place: { ...reply.place, name: 1 } },
      { ...reply, place: { ...reply.place, timezone: null } },
      { ...reply, place: { ...reply.place, query: 7 } },
      { ...reply, alerts: { snow: { ...reply.alerts.snow, evening: 'true' } } },
      { ...reply, alerts: { snow: { ...reply.alerts.snow, morning: 0 } } },
      { ...reply, alerts: { snow: { ...reply.alerts.snow, possible: null } } },
      { ...reply, alerts: { snow: null } },
      { ...reply, alerts: null },
      { ...reply, seenAt: 0 },
    ];
    for (const body of changed)
      expect(syncReply(200, text(body), null), text(body)).toEqual(failed);
    for (const body of ['[]', 'null', '', '<html>', '"x"', '{"id":']) {
      expect(syncReply(200, body, null), body).toEqual(failed);
    }
  });

  it('forgets the registration on a 204', () => {
    expect(syncReply(204, '', null)).toEqual({ kind: 'forgotten' });
  });

  it("retries a 429 after Retry-After's whole seconds, or a minute", () => {
    expect(syncReply(429, '', '42')).toEqual({ kind: 'retry', afterSeconds: 42 });
    expect(syncReply(429, '', '999999')).toEqual({ kind: 'retry', afterSeconds: 999999 });
    expect(syncReply(429, '', '007')).toEqual({ kind: 'retry', afterSeconds: 7 });
    // CLIENT.retryAfterMs, as a 429 to a forecast waits.
    const minute = { kind: 'retry', afterSeconds: 60 };
    expect(CLIENT.retryAfterMs).toBe(60_000);
    for (const after of ['0', '-3', '4.5', '1000000', 'Wed, 21 Oct 2026 07:28:00 GMT', ' 7']) {
      expect(syncReply(429, '', after), after).toEqual(minute);
    }
    expect(syncReply(429, '', null)).toEqual(minute);
    expect(syncReply(429, '', '')).toEqual(minute);
    expect(syncReply(429, '{"error":{"code":"rate_limited"}}', '50')).toEqual({
      kind: 'retry',
      afterSeconds: 50,
    });
  });

  it("shows the server's own words when it can't place the place", () => {
    const refusal = (message: unknown, code: unknown = 'bad_location') =>
      text({ error: { code, message } });
    expect(syncReply(400, refusal("We couldn't find that place."), null)).toEqual({
      kind: 'placeRefused',
      message: "We couldn't find that place.",
    });
    expect(syncReply(400, text({ error: { code: 'bad_location' } }), null)).toEqual(failed);
    expect(syncReply(400, refusal(''), null)).toEqual(failed);
    expect(syncReply(400, refusal(42), null)).toEqual(failed);
    // Any other 4xx is the app's mistake, whose words no one should read.
    expect(
      syncReply(400, refusal('token must be 64 to 200 hex characters.', 'bad_request'), null),
    ).toEqual(failed);
    expect(syncReply(400, refusal('There is no page for that place.', 1), null)).toEqual(failed);
    expect(syncReply(400, text({ error: null }), null)).toEqual(failed);
    expect(syncReply(400, '<html>', null)).toEqual(failed);
    expect(syncReply(404, refusal('There is no page for that place.'), null)).toEqual(failed);
  });

  it('fails everything else', () => {
    for (const status of [413, 404, 405, 500, 502, 503, 0]) {
      expect(syncReply(status, '', null), String(status)).toEqual(failed);
    }
    expect(syncReply(201, text(reply), null)).toEqual(failed);
  });
});

describe('testOutcome', () => {
  const error = (code: unknown) => JSON.stringify({ error: { code, message: 'Words.' } });

  it('says whether the test was sent, or only logged in a dry run', () => {
    expect(testOutcome(202, '{"sent":true}')).toBe('sent');
    expect(testOutcome(202, '{"sent":true,"dryRun":"x"}')).toBe('sent');
    expect(testOutcome(202, '{"sent":false,"dryRun":true}')).toBe('dryRun');
    for (const body of ['{"sent":false}', '{"sent":false,"dryRun":1}', '{"dryRun":true}']) {
      expect(testOutcome(202, body), body).toBe('failed');
    }
    for (const body of ['{"sent":"true"}', '{}', '[]', '', 'null', '<html>']) {
      expect(testOutcome(202, body), body).toBe('failed');
    }
  });

  it("names the server's refusals by their codes", () => {
    expect(testOutcome(429, error('test_limited'))).toBe('limited');
    expect(testOutcome(409, error('quiet_hours'))).toBe('quiet');
    expect(testOutcome(404, error('not_registered'))).toBe('notRegistered');
  });

  it("fails everything else: Netlify's own 429, another code, a code at another status", () => {
    expect(testOutcome(429, error('rate_limited'))).toBe('failed');
    expect(testOutcome(429, '')).toBe('failed');
    expect(testOutcome(409, error('bad_request'))).toBe('failed');
    expect(testOutcome(404, error('bad_request'))).toBe('failed');
    expect(testOutcome(404, error(404))).toBe('failed');
    expect(testOutcome(400, error('not_registered'))).toBe('failed');
    expect(testOutcome(404, JSON.stringify({ error: 'not_registered' }))).toBe('failed');
    for (const status of [200, 400, 413, 500, 502, 503, 0]) {
      expect(testOutcome(status, '{"sent":true}'), String(status)).toBe('failed');
    }
    expect(testOutcome(503, error('push_unavailable'))).toBe('failed');
    expect(testOutcome(502, error('push_refused'))).toBe('failed');
  });
});
