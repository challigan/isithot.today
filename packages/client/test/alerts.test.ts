import { describe, expect, it } from 'vitest';
import { ALERTS, COPY } from '@isithot/core';
import {
  alertAction,
  fingerprint,
  hereKind,
  hereName,
  herePlace,
  registrationBody,
  replyZones,
  setAlert,
  syncReply,
  testOutcome,
  type AlertPrefs,
  type AlertSwitch,
  type DeviceReply,
  type HerePlace,
  type LocationAccess,
  type Permission,
  type RegistrationBody,
} from '../src/alerts';
import { CLIENT } from '../src/config';
import { deviceTarget, type Target } from '../src/target';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const TOKEN = 'a1b2'.repeat(16);
const evening: AlertPrefs = { evening: true, morning: false, possible: false };
const ip: HerePlace = { kind: 'ip' };
const leedsCell: HerePlace = { kind: 'device', target: deviceTarget(53.8, -1.55) };

const body = (here: HerePlace = ip, prefs = evening) =>
  registrationBody({
    token: TOKEN,
    env: 'production',
    here,
    units: 'c',
    prefs,
    appVersion: '1.0 (112)',
  });

describe('herePlace', () => {
  // The phone's fix as the app makes it (deviceTarget), and the cell alerts.v2 kept.
  const fix = deviceTarget(53.81, -1.56);
  const kept = { lat: 54.75, lon: -1.6 };
  const fixCell = { kind: 'device', target: deviceTarget(53.8, -1.55) };
  const keptCell = { kind: 'device', target: deviceTarget(54.75, -1.6) };

  it("is the phone's fix while location access is allowed, before any kept cell", () => {
    expect(herePlace({ access: 'granted', fix, kept: null })).toEqual(fixCell);
    expect(herePlace({ access: 'granted', fix, kept })).toEqual(fixCell);
  });

  it('is the kept cell while access is allowed and there is no fix this launch', () => {
    expect(herePlace({ access: 'granted', fix: null, kept })).toEqual(keptCell);
  });

  it('is approximate while access is allowed with no fix and none kept', () => {
    expect(herePlace({ access: 'granted', fix: null, kept: null })).toEqual(ip);
  });

  it('is approximate without location access, whatever was fixed or kept', () => {
    for (const access of ['denied', 'notDetermined'] satisfies LocationAccess[]) {
      for (const f of [null, fix]) {
        for (const k of [null, kept]) {
          expect(herePlace({ access, fix: f, kept: k }), access).toEqual(ip);
        }
      }
    }
  });

  it("ignores a fix that isn't the phone's own: a searched place, a city or IP location", () => {
    const others: Target[] = [
      { kind: 'coords', source: 'search', lat: 53.8, lon: -1.55, name: 'Leeds' },
      { kind: 'city', slug: 'leeds-gb', name: 'Leeds' },
      { kind: 'ip' },
    ];
    for (const other of others) {
      expect(herePlace({ access: 'granted', fix: other, kept: null })).toEqual(ip);
      expect(herePlace({ access: 'granted', fix: other, kept })).toEqual(keptCell);
    }
  });

  it('ignores a point that is not on Earth, fixed or kept', () => {
    const off = { kind: 'coords', source: 'device', lat: 95, lon: 0 } as const;
    expect(herePlace({ access: 'granted', fix: off, kept })).toEqual(keptCell);
    for (const bad of [
      { lat: 91, lon: 0 },
      { lat: 0, lon: -181 },
      { lat: Number.NaN, lon: 0 },
    ]) {
      const where = JSON.stringify(bad);
      expect(herePlace({ access: 'granted', fix: null, kept: bad }), where).toEqual(ip);
      expect(herePlace({ access: 'granted', fix, kept: bad }), where).toEqual(fixCell);
    }
  });

  it('gives the cell alone, on the grid: no name or detail leaves the phone', () => {
    const named = {
      kind: 'coords',
      source: 'device',
      lat: 53.8123,
      lon: -1.5561,
      name: 'Leeds',
      region: 'England',
      country: 'GB',
    } as const;
    const here = herePlace({ access: 'granted', fix: named, kept: null });
    expect(here).toEqual(fixCell);
    expect(JSON.stringify(here)).toBe(
      '{"kind":"device","target":{"kind":"coords","source":"device","lat":53.8,"lon":-1.55}}',
    );
    const unrounded = { lat: 54.7712, lon: -1.5713 };
    expect(herePlace({ access: 'granted', fix: null, kept: unrounded })).toEqual({
      kind: 'device',
      target: deviceTarget(54.75, -1.55),
    });
  });
});

describe('registrationBody', () => {
  it('is version 2: the switches, where you are, and no saved place', () => {
    expect(body()).toEqual({
      v: 2,
      app: 'snow',
      platform: 'ios',
      env: 'production',
      token: TOKEN,
      units: 'c',
      appVersion: '1.0 (112)',
      alerts: { snow: { evening: true, morning: false, possible: false } },
      here: { source: 'ip' },
      saved: [],
    });
  });

  it("sends approximate location as its source alone, and the phone's cell as its point", () => {
    const point = '{"lat":53.8,"lon":-1.55,"source":"device"}';
    expect(JSON.stringify(body().here)).toBe('{"source":"ip"}');
    expect(JSON.stringify(body(leedsCell).here)).toBe(point);
    // Whatever the target carries, only its point.
    const named: HerePlace = {
      kind: 'device',
      target: { ...deviceTarget(53.8, -1.55), name: 'Leeds', region: 'England', country: 'GB' },
    };
    expect(JSON.stringify(body(named).here)).toBe(point);
  });

  it('copies the switches and nothing else', () => {
    const prefs = { evening: false, morning: true, possible: true, extra: 1 } as AlertPrefs;
    expect(body(ip, prefs).alerts).toEqual({
      snow: { evening: false, morning: true, possible: true },
    });
  });
});

describe('fingerprint', () => {
  it('is the body as JSON, keys sorted at every level, without the app version', () => {
    expect(fingerprint(body())).toBe(
      '{"alerts":{"snow":{"evening":true,"morning":false,"possible":false}},"app":"snow",' +
        '"env":"production","here":{"source":"ip"},"platform":"ios","saved":[],' +
        `"token":"${TOKEN}","units":"c","v":2}`,
    );
    expect(fingerprint({ ...body(), appVersion: '1.1 (130)' })).toBe(fingerprint(body()));
  });

  it('sorts keys only: a list keeps its order, as in canonical JSON', () => {
    const listed = { ...body(), saved: [{ place: 'york-gb' }, { place: 'durham-gb' }] };
    expect(fingerprint(listed as RegistrationBody)).toContain(
      '"saved":[{"place":"york-gb"},{"place":"durham-gb"}],',
    );
  });

  it('changes with anything the server keeps', () => {
    const base = fingerprint(body());
    const changed = [
      { ...body(), token: 'f'.repeat(64) },
      { ...body(), env: 'sandbox' as const },
      { ...body(), units: 'f' as const },
      body(leedsCell),
      body(ip, { ...evening, possible: true }),
    ];
    for (const b of changed) expect(fingerprint(b)).not.toBe(base);
    // Another cell is another place.
    const there: HerePlace = { kind: 'device', target: deviceTarget(53.85, -1.55) };
    expect(fingerprint(body(there))).not.toBe(fingerprint(body(leedsCell)));
  });
});

describe('alertAction', () => {
  const now = Date.parse('2026-12-01T18:00:00Z');
  const hour = ALERTS.hereRefreshMinutes * MINUTE;
  const week = ALERTS.heartbeatDays * DAY;
  type Sent = { fingerprint: string; at: number } | null;
  const sent = { fingerprint: fingerprint(body()), at: now - 30 * MINUTE };
  const state = {
    prefs: evening,
    permission: 'authorized' as Permission,
    token: TOKEN as string | null,
    here: ip,
    units: 'c' as const,
    last: sent as Sent,
    refused: null as Sent,
    activeAt: now,
    now,
    env: 'production' as const,
    appVersion: '1.0 (112)',
  };
  /** Where you are is the phone's cell, sent `ago`. */
  const atCell = (ago: number) => ({
    ...state,
    here: leedsCell,
    last: { fingerprint: fingerprint(body(leedsCell)), at: now - ago },
  });
  const off = { evening: false, morning: false, possible: false };

  it('deletes the registration when every switch is off, if there is one', () => {
    expect(alertAction({ ...state, prefs: off })).toBe('delete');
    expect(alertAction({ ...state, prefs: off, last: null })).toBe('none');
    // "Also when snow is possible" alone switches nothing on.
    expect(alertAction({ ...state, prefs: { ...off, possible: true } })).toBe('delete');
    expect(alertAction({ ...state, prefs: off, token: null })).toBe('delete');
  });

  it('deletes it when the permission is denied, before anything else', () => {
    expect(alertAction({ ...state, permission: 'denied' })).toBe('delete');
    expect(alertAction({ ...state, permission: 'denied', last: null })).toBe('none');
    expect(alertAction({ ...state, permission: 'denied', token: null })).toBe('delete');
  });

  it('never needs a place, as where you are is always one: it waits for the push token', () => {
    expect(alertAction({ ...state, token: null })).toBe('needsToken');
    expect(alertAction({ ...state, token: '' })).toBe('needsToken');
    expect(alertAction({ ...state, here: leedsCell, token: null, last: null })).toBe('needsToken');
  });

  it('sends what changed', () => {
    expect(alertAction({ ...state, last: null })).toBe('put');
    expect(alertAction({ ...state, units: 'f' })).toBe('put');
    expect(alertAction({ ...state, prefs: { ...evening, morning: true } })).toBe('put');
    expect(alertAction({ ...state, here: leedsCell })).toBe('put');
    expect(alertAction({ ...atCell(DAY), here: ip })).toBe('put');
    expect(alertAction({ ...state, env: 'sandbox' })).toBe('put');
    expect(alertAction({ ...state, token: 'f'.repeat(64) })).toBe('put');
    expect(alertAction(state)).toBe('none');
    // An app update alone sends nothing.
    expect(alertAction({ ...state, appVersion: '1.1 (130)' })).toBe('none');
  });

  it("sends the phone's cell again only once a week", () => {
    expect(alertAction(atCell(DAY))).toBe('none');
    expect(alertAction(atCell(week - 1))).toBe('none');
    expect(alertAction(atCell(week))).toBe('put');
    expect(alertAction(atCell(-hour))).toBe('none');
  });

  it('while approximate, sends it again on becoming active an hour or more after it was', () => {
    expect(hour).toBe(60 * MINUTE);
    const last = (at: number) => ({ fingerprint: sent.fingerprint, at });
    expect(alertAction({ ...state, last: last(now - hour) })).toBe('put');
    expect(alertAction({ ...state, last: last(now - hour + 1) })).toBe('none');
    // Later in the same visit too, until it has been sent.
    const visit = { ...state, activeAt: now - 20 * MINUTE };
    expect(alertAction({ ...visit, last: last(visit.activeAt - hour) })).toBe('put');
    expect(alertAction({ ...visit, last: last(visit.activeAt - hour + 1) })).toBe('none');
    // Once sent in this visit, not again until the next, however long the visit; but weekly.
    const long = { ...state, activeAt: now - 3 * hour };
    expect(alertAction({ ...long, last: last(now - 2 * hour) })).toBe('none');
    const week1 = { ...state, activeAt: now - week - hour };
    expect(alertAction({ ...week1, last: last(now - week + 1) })).toBe('none');
    expect(alertAction({ ...week1, last: last(now - week) })).toBe('put');
    // A clock that went back: nothing.
    expect(alertAction({ ...state, last: last(now + hour) })).toBe('none');
  });

  it('after a refused set, waits until the set changes or the app becomes active again', () => {
    const refusal = { fingerprint: fingerprint(body()), at: now + MINUTE };
    const refused = { ...state, last: null, refused: refusal };
    expect(alertAction(refused)).toBe('none');
    expect(alertAction({ ...refused, refused: { ...refusal, at: now } })).toBe('none');
    // Active again since.
    expect(alertAction({ ...refused, activeAt: now + 2 * MINUTE })).toBe('put');
    // Something else to send: the phone's cell, other switches or units.
    expect(alertAction({ ...refused, here: leedsCell })).toBe('put');
    expect(alertAction({ ...refused, prefs: { ...evening, morning: true } })).toBe('put');
    expect(alertAction({ ...refused, units: 'f' })).toBe('put');
    // It never stops a delete, nor waiting for a token.
    expect(alertAction({ ...refused, prefs: off, last: sent })).toBe('delete');
    expect(alertAction({ ...refused, token: null })).toBe('needsToken');
  });

  it('after a refused set, sends neither refresh nor heartbeat until active again', () => {
    // What was last sent is the set the server has refused since: the hour or the week since
    // it was sent is no reason to send it again in this visit.
    const refusal = { fingerprint: fingerprint(body()), at: now - MINUTE };
    const visit = { ...state, refused: refusal, activeAt: now - 2 * MINUTE };
    const sentAgo = (ago: number) => ({ fingerprint: refusal.fingerprint, at: now - ago });
    expect(alertAction({ ...visit, last: sentAgo(2 * hour) })).toBe('none');
    expect(alertAction({ ...visit, last: sentAgo(week) })).toBe('none');
    // Once the app is active again, either is due as ever.
    expect(alertAction({ ...visit, activeAt: now, last: sentAgo(2 * hour) })).toBe('put');
    expect(alertAction({ ...visit, activeAt: now, last: sentAgo(week) })).toBe('put');
  });

  it('treats a permission not yet asked, or quiet, like a granted one', () => {
    expect(alertAction({ ...state, permission: 'notDetermined' })).toBe('none');
    expect(alertAction({ ...state, permission: 'provisional', last: null })).toBe('put');
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

/** The server's 200 to a version 2 PUT whose connection it located in Leeds. */
const reply: DeviceReply = {
  id: '3f9c1a2b4d5e6f708192a3b4c5d6e7f8',
  deviceTz: null,
  here: {
    name: 'Leeds',
    timezone: 'Europe/London',
    query: 'lat=53.8&lon=-1.55&source=device',
    country: 'GB',
    follows: 'ip',
  },
  saved: [],
  refused: [],
  alerts: { snow: { evening: true, morning: false, possible: false } },
  seenAt: '2026-12-01T09:05:00.000Z',
};
const durham = {
  pid: '1a2b3c4d5e6f',
  name: 'Durham',
  timezone: 'Europe/London',
  query: 'place=durham-gb',
  country: 'GB',
};
const kathmandu = {
  pid: '0f1e2d3c4b5a',
  name: 'Kathmandu',
  timezone: 'Asia/Kathmandu',
  query: 'lat=27.7&lon=85.3&name=Kathmandu&country=NP&source=search',
  country: 'NP',
};

describe('syncReply', () => {
  const text = (o: unknown) => JSON.stringify(o);
  const failed = { kind: 'failed' };

  it("keeps the server's set from its 200, field by field", () => {
    expect(syncReply(200, text(reply), null)).toEqual({ kind: 'stored', reply });
    const device = { ...reply, here: { ...reply.here!, follows: 'device' } };
    expect(syncReply(200, text(device), null)).toEqual({ kind: 'stored', reply: device });
    const both = { ...reply, deviceTz: 'Europe/London', saved: [durham, kathmandu] };
    expect(syncReply(200, text(both), null)).toEqual({ kind: 'stored', reply: both });
    // No free place, while a saved place is kept; a place with no country.
    const away = { ...reply, here: null, saved: [{ ...kathmandu, country: null }] };
    expect(syncReply(200, text(away), null)).toEqual({ kind: 'stored', reply: away });
    // The phone far from any town (at sea, say): core's "Your location", and no country.
    const atSea = {
      ...reply,
      here: { ...reply.here!, name: COPY.yourLocation, country: null, follows: 'device' },
    };
    expect(syncReply(200, text(atSea), null)).toEqual({ kind: 'stored', reply: atSea });
  });

  it('keeps the saved places the server refused, and none when it lists none', () => {
    const refused = { ...reply, saved: [durham], refused: [{ index: 1, code: 'not_found' }] };
    expect(syncReply(200, text(refused), null)).toEqual({ kind: 'stored', reply: refused });
    const { refused: _, ...unlisted } = reply;
    expect(syncReply(200, text(unlisted), null)).toEqual({ kind: 'stored', reply });
  });

  it('leaves out fields it does not know, at every level', () => {
    const extra = {
      ...reply,
      tz: 'Europe/London',
      here: { ...reply.here, locatedAt: '2026-12-01T09:05:00.000Z' },
      saved: [{ ...durham, slot: 'x' }],
      refused: [{ index: 3, code: 'not_found', why: 'gone' }],
      alerts: { snow: { ...reply.alerts.snow, loud: true }, wind: {} },
    };
    expect(syncReply(200, text(extra), null)).toEqual({
      kind: 'stored',
      reply: { ...reply, saved: [durham], refused: [{ index: 3, code: 'not_found' }] },
    });
  });

  it("fails 8.1's reply, which names one place", () => {
    const v1 = {
      id: reply.id,
      place: { name: 'Leeds', timezone: 'Europe/London', query: 'place=leeds-gb' },
      alerts: reply.alerts,
      seenAt: reply.seenAt,
    };
    expect(syncReply(200, text(v1), null)).toEqual(failed);
  });

  it('fails a 200 that is not a set', () => {
    const here = reply.here!;
    const without = (key: keyof DeviceReply) => {
      const copy: Record<string, unknown> = { ...reply };
      delete copy[key];
      return copy;
    };
    // A place's country may be null, but never left out.
    const { country: _here, ...hereNoCountry } = here;
    const { country: _durham, ...durhamNoCountry } = durham;
    const changed = [
      { ...reply, id: reply.id.slice(1) },
      { ...reply, id: reply.id.toUpperCase() },
      { ...reply, id: 42 },
      without('deviceTz'),
      { ...reply, deviceTz: 0 },
      without('here'),
      { ...reply, here: [] },
      { ...reply, here: 'Leeds' },
      { ...reply, here: { ...here, name: 1 } },
      { ...reply, here: { ...here, timezone: null } },
      { ...reply, here: { ...here, query: 7 } },
      { ...reply, here: { ...here, country: 44 } },
      { ...reply, here: { name: 'Leeds', timezone: 'Europe/London', query: here.query } },
      { ...reply, here: { ...here, follows: 'search' } },
      { ...reply, here: { ...here, follows: undefined } },
      { ...reply, here: hereNoCountry },
      without('saved'),
      { ...reply, saved: null },
      { ...reply, saved: { 0: durham } },
      { ...reply, saved: [null] },
      { ...reply, saved: [{ ...durham, pid: '1a2b3c4d5e6' }] },
      { ...reply, saved: [{ ...durham, pid: '1A2B3C4D5E6F' }] },
      { ...reply, saved: [{ ...durham, pid: 12 }] },
      { ...reply, saved: [durham, { ...kathmandu, name: null }] },
      { ...reply, saved: [{ ...durham, timezone: 1 }] },
      { ...reply, saved: [{ ...durham, query: null }] },
      { ...reply, saved: [{ ...durham, country: false }] },
      { ...reply, saved: [durhamNoCountry] },
      { ...reply, saved: [{ pid: durham.pid, name: 'Durham', timezone: 'Europe/London' }] },
      { ...reply, refused: null },
      { ...reply, refused: {} },
      { ...reply, refused: [null] },
      { ...reply, refused: [{ index: -1, code: 'not_found' }] },
      { ...reply, refused: [{ index: 1.5, code: 'not_found' }] },
      { ...reply, refused: [{ index: '0', code: 'not_found' }] },
      { ...reply, refused: [{ index: 0, code: 1 }] },
      { ...reply, refused: [{ index: 0 }] },
      { ...reply, alerts: { snow: { ...reply.alerts.snow, evening: 'true' } } },
      { ...reply, alerts: { snow: { ...reply.alerts.snow, morning: 0 } } },
      { ...reply, alerts: { snow: { ...reply.alerts.snow, possible: null } } },
      { ...reply, alerts: { snow: null } },
      { ...reply, alerts: null },
      { ...reply, seenAt: 0 },
    ];
    for (const body of changed) {
      expect(syncReply(200, text(body), null), text(body)).toEqual(failed);
    }
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
    // The cap on places new to the set: the next sync, a minute on, carries on.
    const capped = {
      error: {
        code: 'rate_limited',
        message: 'Up to 3 new places are added at a time. Try again in a minute.',
      },
    };
    expect(syncReply(429, text(capped), '60')).toEqual(minute);
  });

  it("shows the server's own words when it can't tell where you are", () => {
    const refusal = (message: unknown, code: unknown = 'bad_location') =>
      text({ error: { code, message } });
    const words =
      "We couldn't tell where you are from your internet connection. Try again later, or use " +
      'your location.';
    expect(syncReply(400, refusal(words), null)).toEqual({ kind: 'placeRefused', message: words });
    expect(syncReply(400, text({ error: { code: 'bad_location' } }), null)).toEqual(failed);
    expect(syncReply(400, refusal(''), null)).toEqual(failed);
    expect(syncReply(400, refusal(42), null)).toEqual(failed);
    // Any other 4xx is the app's mistake, whose words no one should read.
    const malformed = refusal('here from the connection has no place.', 'bad_request');
    expect(syncReply(400, malformed, null)).toEqual(failed);
    expect(syncReply(400, refusal('There is no page for that place.', 1), null)).toEqual(failed);
    expect(syncReply(400, text({ error: null }), null)).toEqual(failed);
    expect(syncReply(400, '<html>', null)).toEqual(failed);
    expect(syncReply(404, refusal(words), null)).toEqual(failed);
  });

  it('fails everything else', () => {
    for (const status of [413, 404, 405, 500, 502, 503, 0]) {
      expect(syncReply(status, '', null), String(status)).toEqual(failed);
    }
    expect(syncReply(201, text(reply), null)).toEqual(failed);
  });
});

describe('hereKind', () => {
  const at = (here: DeviceReply['here']): DeviceReply => ({ ...reply, here });
  const located = at(reply.here);
  const fromPhone = at({ ...reply.here!, follows: 'device' });
  const notLocated = at(null);

  it("is the phone's location while its cell is what is sent, whatever was last answered", () => {
    for (const last of [null, located, fromPhone, notLocated]) {
      for (const refused of [false, true]) {
        expect(hereKind({ here: leedsCell, reply: last, refused })).toBe('device');
      }
    }
  });

  it('is approximate while it is, before an answer and after one that located it', () => {
    expect(hereKind({ here: ip, reply: null, refused: false })).toBe('ip');
    expect(hereKind({ here: ip, reply: located, refused: false })).toBe('ip');
    // Location access gone since the phone's cell was answered: approximate from now on.
    expect(hereKind({ here: ip, reply: fromPhone, refused: false })).toBe('ip');
  });

  it("is unknown once the server couldn't tell where the connection is", () => {
    expect(hereKind({ here: ip, reply: notLocated, refused: false })).toBe('unknown');
    // The 400, which forgot the set, so no reply is kept.
    expect(hereKind({ here: ip, reply: null, refused: true })).toBe('unknown');
    expect(hereKind({ here: ip, reply: located, refused: true })).toBe('unknown');
  });
});

describe('hereName', () => {
  const at = (here: DeviceReply['here']): DeviceReply => ({ ...reply, here });
  const fromPhone = at({ ...reply.here!, follows: 'device' });

  it('is the town the server named for the kind of place sent', () => {
    expect(hereName({ here: ip, reply })).toBe('Leeds');
    expect(hereName({ here: leedsCell, reply: fromPhone })).toBe('Leeds');
  });

  it('is none before an answer, for an answer about the other kind, or with no free place', () => {
    expect(hereName({ here: ip, reply: null })).toBeNull();
    expect(hereName({ here: leedsCell, reply: null })).toBeNull();
    expect(hereName({ here: leedsCell, reply })).toBeNull();
    expect(hereName({ here: ip, reply: fromPhone })).toBeNull();
    expect(hereName({ here: ip, reply: at(null) })).toBeNull();
  });

  it("is none for a name the server couldn't give, never shown as a town", () => {
    for (const name of [COPY.yourLocation, '']) {
      const unnamed = at({ ...reply.here!, follows: 'device', name });
      expect(hereName({ here: leedsCell, reply: unnamed }), name).toBeNull();
    }
  });
});

describe('replyZones', () => {
  it("gives each place's zone by its key, where you are first", () => {
    const set = { ...reply, saved: [durham, kathmandu] };
    expect(Object.entries(replyZones(set))).toEqual([
      ['device:53.8,-1.55', 'Europe/London'],
      ['city:durham-gb', 'Europe/London'],
      ['search:27.7,85.3', 'Asia/Kathmandu'],
    ]);
  });

  it('gives none for no place, and leaves out a query that names none', () => {
    expect(replyZones({ ...reply, here: null })).toEqual({});
    const odd = [
      { ...durham, query: '' },
      { ...durham, query: 'lat=95&lon=0&source=search' },
      { ...durham, query: 'units=c' },
    ];
    expect(replyZones({ ...reply, here: null, saved: odd })).toEqual({});
  });

  it('keeps the first zone for one key', () => {
    const twice = { ...reply, here: null, saved: [durham, { ...durham, timezone: 'Etc/UTC' }] };
    expect(replyZones(twice)).toEqual({ 'city:durham-gb': 'Europe/London' });
  });
});

describe('testOutcome', () => {
  const error = (code: unknown) => JSON.stringify({ error: { code, message: 'Words.' } });
  const outcome = (kind: string) => ({ kind });
  const failed = outcome('failed');

  it('says how many tests were sent, or that they were only logged in a dry run', () => {
    expect(testOutcome(202, '{"sent":true}')).toEqual({ kind: 'sent', count: 1 });
    expect(testOutcome(202, '{"sent":true,"count":2}')).toEqual({ kind: 'sent', count: 2 });
    expect(testOutcome(202, '{"sent":true,"dryRun":"x"}')).toEqual({ kind: 'sent', count: 1 });
    // A count that isn't a whole number of tests is one: the server said one was sent.
    for (const count of ['"2"', '0', '-2', '1.5', 'null', 'true']) {
      expect(testOutcome(202, `{"sent":true,"count":${count}}`), count).toEqual({
        kind: 'sent',
        count: 1,
      });
    }
    expect(testOutcome(202, '{"sent":false,"dryRun":true}')).toEqual(outcome('dryRun'));
    for (const body of ['{"sent":false}', '{"sent":false,"dryRun":1}', '{"dryRun":true}']) {
      expect(testOutcome(202, body), body).toEqual(failed);
    }
    for (const body of ['{"sent":"true"}', '{"count":2}', '{}', '[]', '', 'null', '<html>']) {
      expect(testOutcome(202, body), body).toEqual(failed);
    }
  });

  it("names the server's refusals by their codes", () => {
    expect(testOutcome(429, error('test_limited'))).toEqual(outcome('limited'));
    expect(testOutcome(409, error('quiet_hours'))).toEqual(outcome('quiet'));
    expect(testOutcome(404, error('not_registered'))).toEqual(outcome('notRegistered'));
  });

  it("fails everything else: Netlify's own 429, another code, a code at another status", () => {
    expect(testOutcome(429, error('rate_limited'))).toEqual(failed);
    expect(testOutcome(429, '')).toEqual(failed);
    expect(testOutcome(409, error('bad_request'))).toEqual(failed);
    expect(testOutcome(404, error('bad_request'))).toEqual(failed);
    expect(testOutcome(404, error(404))).toEqual(failed);
    expect(testOutcome(400, error('not_registered'))).toEqual(failed);
    expect(testOutcome(404, JSON.stringify({ error: 'not_registered' }))).toEqual(failed);
    for (const status of [200, 400, 413, 500, 502, 503, 0]) {
      expect(testOutcome(status, '{"sent":true}'), String(status)).toEqual(failed);
    }
    expect(testOutcome(503, error('push_unavailable'))).toEqual(failed);
    expect(testOutcome(502, error('push_refused'))).toEqual(failed);
  });
});
