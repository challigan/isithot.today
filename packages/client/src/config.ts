/**
 * The clients' own timings and limits. The website uses `refreshAfterMs`; the rest are the native
 * apps', and reach Swift with core's constants.
 */

const MINUTE = 60 * 1000;

export const CLIENT = {
  /** Back after this long away, a page or app opens on its view for the time of day, afresh. */
  refreshAfterMs: 30 * MINUTE,
  /** A refetch while open waits up to this long past the forecast hour, so phones spread out. */
  refreshJitterMs: 90 * 1000,
  /** Opened again within this long of its last answer for the same place, an app keeps it. */
  reuseMs: 10 * MINUTE,
  /** The server allows 6 s upstream, with a second request inside it: an app waits this long. */
  requestTimeoutMs: 12 * 1000,
  /** Asked too often (429), an app keeps its saved answer and asks again after this, and jitter. */
  retryAfterMs: 60 * 1000,
} as const;

/**
 * The picker's two lists in the apps: the most recent places it keeps, and the most saved places.
 * Both reach Swift with core's constants (`Constants.Places`).
 */
export const PLACES = {
  /** Recent places: the last five chosen, newest first. */
  recentMax: 5,
  /** Saved places: ten, in the order saved, so the list never scrolls far. */
  savedMax: 10,
} as const;

/**
 * The iPhone app's ads, in the free version, which reach Swift with core's constants
 * (`Constants.Ads`).
 */
export const ADS = {
  /**
   * A full-screen ad shows when a place is chosen, at most once in this long. The app keeps when
   * it last showed one, so the wait holds across launches; Your privacy and the website's privacy
   * notice say so, with this number.
   */
  interstitialGapMinutes: 5,
  /**
   * Google's full-screen ads expire an hour after they load: one loaded this long ago or longer
   * isn't shown, and another is loaded.
   */
  interstitialMaxAgeMinutes: 55,
  /**
   * An ad that fails to load is asked for again after this. The wait doubles with each failure in
   * a row, and starts again from this once an ad loads.
   */
  retryFirstSeconds: 60,
  /** The longest wait before asking again, however many loads have failed. */
  retryMaxSeconds: 600,
} as const;
