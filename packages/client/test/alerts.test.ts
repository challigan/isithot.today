import { describe, expect, it } from 'vitest';
import { ALERTS } from '@isithot/core';
import {
  alertAction,
  alertPlaceAllowed,
  fingerprint,
  registrationBody,
  type AlertPrefs,
  type Permission,
  type RegistrationBody,
} from '../src/alerts';
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
