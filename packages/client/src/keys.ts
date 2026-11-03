/**
 * Where the native apps keep things. Shared with the widgets through the App Group: the place
 * (`Target` JSON; absent for approximate IP location), the units ("c" or "f"), the purchase
 * (written only by the app's StoreKit code) and the last good answer, a file. The app's own: recent
 * places, saved places, the notifications' switches with the phone's last cell for where you are
 * and the saved places' bells (`alerts`), the last registration the server took, its set
 * (`alertSync`), the last view, the dismissed notifications card, and when the app last showed a
 * full-screen ad, so the next waits `ADS.interstitialGapMinutes` across launches too. Saved places
 * are the app's alone, as recent places are: no widget reads them.
 *
 * The notifications' two moved to version 2 with "where you are" (phase 8.4): `alerts.v1` held a
 * place chosen on screen, and `alertSync.v1` the server's answer for that one place. Nothing moves
 * across: the version 1 keys are left unread, so an install updated from 8.1 starts with every
 * switch off.
 *
 * Swift: the generated `Keys.swift`.
 */
export const APP_GROUP_KEYS = {
  place: 'place.v1',
  units: 'units.v1',
  unlock: 'unlock.v1',
  today: 'today.v1.json',
} as const;

export const APP_KEYS = {
  recent: 'recent.v1',
  savedPlaces: 'savedPlaces.v1',
  alerts: 'alerts.v2',
  alertSync: 'alertSync.v2',
  lastView: 'ui.lastView',
  card: 'ui.alertCard',
  lastInterstitial: 'ads.lastInterstitial',
} as const;

/** The version of what is stored under those keys. Another version is ignored, not migrated. */
export const STORE_VERSION = 1;
