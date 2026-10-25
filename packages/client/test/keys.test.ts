import { describe, expect, it } from 'vitest';
import { CLIENT, PLACES } from '../src/config';
import { APP_GROUP_KEYS, APP_KEYS, STORE_VERSION } from '../src/keys';

describe('keys', () => {
  it('stay as phones store them: a new name would lose what is saved', () => {
    expect(APP_GROUP_KEYS).toEqual({
      place: 'place.v1',
      units: 'units.v1',
      unlock: 'unlock.v1',
      today: 'today.v1.json',
    });
    expect(APP_KEYS).toEqual({
      recent: 'recent.v1',
      savedPlaces: 'savedPlaces.v1',
      alerts: 'alerts.v1',
      alertSync: 'alertSync.v1',
      lastView: 'ui.lastView',
      card: 'ui.alertCard',
    });
    expect(STORE_VERSION).toBe(1);
    const all = [...Object.values(APP_GROUP_KEYS), ...Object.values(APP_KEYS)];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('CLIENT', () => {
  it('keeps the website’s half hour away, and the apps’ timings', () => {
    expect(CLIENT).toEqual({
      refreshAfterMs: 30 * 60 * 1000,
      refreshJitterMs: 90 * 1000,
      reuseMs: 10 * 60 * 1000,
      requestTimeoutMs: 12 * 1000,
      retryAfterMs: 60 * 1000,
    });
  });
});

describe('PLACES', () => {
  it('keeps five recent places and ten saved ones', () => {
    expect(PLACES).toEqual({ recentMax: 5, savedMax: 10 });
  });
});
