import { describe, expect, it } from 'vitest';
import { ADS, CLIENT, PLACES } from '../src/config';
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
      alerts: 'alerts.v2',
      alertSync: 'alertSync.v2',
      lastView: 'ui.lastView',
      card: 'ui.alertCard',
      lastInterstitial: 'ads.lastInterstitial',
    });
    expect(STORE_VERSION).toBe(1);
    const all = [...Object.values(APP_GROUP_KEYS), ...Object.values(APP_KEYS)];
    expect(new Set(all).size).toBe(all.length);
  });

  it("move the notifications' to new names, so 8.1's are ignored, not read as 8.4's", () => {
    // 8.1 kept a place chosen on screen; 8.4 keeps the phone's last cell and the bells, and the
    // server's set. Nothing is migrated: an 8.1 install starts with notifications off.
    expect([APP_KEYS.alerts, APP_KEYS.alertSync]).toEqual(['alerts.v2', 'alertSync.v2']);
    const all: string[] = [...Object.values(APP_GROUP_KEYS), ...Object.values(APP_KEYS)];
    expect(all).not.toContain('alerts.v1');
    expect(all).not.toContain('alertSync.v1');
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

describe('ADS', () => {
  it('keeps full-screen ads 5 minutes apart and under an hour old, and the retries’ waits', () => {
    expect(ADS).toEqual({
      interstitialGapMinutes: 5,
      interstitialMaxAgeMinutes: 55,
      retryFirstSeconds: 60,
      retryMaxSeconds: 600,
    });
    expect(ADS.interstitialMaxAgeMinutes).toBeLessThan(60);
  });
});
