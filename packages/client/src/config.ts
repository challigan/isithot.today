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
