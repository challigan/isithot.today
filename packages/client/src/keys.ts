/**
 * Where the native apps keep things. Shared with the widgets through the App Group: the place
 * (`Target` JSON; absent for approximate IP location), the units ("c" or "f"), the purchase
 * (written only by the app's StoreKit code) and the last good answer, a file. The app's own: recent
 * places, saved places, the notification switches and place, the last registration sent, the last
 * view, the dismissed notifications card, and when the app last showed a full-screen ad, so the
 * next waits `ADS.interstitialGapMinutes` across launches too. Saved places are the app's alone,
 * as recent places are: no widget reads them.
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
  alerts: 'alerts.v1',
  alertSync: 'alertSync.v1',
  lastView: 'ui.lastView',
  card: 'ui.alertCard',
  lastInterstitial: 'ads.lastInterstitial',
} as const;

/** The version of what is stored under those keys. Another version is ignored, not migrated. */
export const STORE_VERSION = 1;
