import Foundation
import IsItLogic
import IsItModel

/// When an app that is open asks again, and how (iOS build spec, section 9.5). Pure: the
/// caller gives the clock's time and the jitter, a random 0 to `Constants.Client.refreshJitterMs`
/// it draws, so that phones opened at the same moment don't all ask at the same second.
public enum Refresh {
  /// How to ask again for the place of `response`, the answer on screen, at `now`: past the
  /// caches when it is out of date (`Freshness.outOfDate`, with the holds the app keeps), plainly
  /// otherwise or when there is no answer yet.
  public static func fetch(
    _ response: TodayResponse?,
    at now: Date,
    holds: Freshness.Holds
  ) -> Fetch {
    guard let response, Freshness.outOfDate(response, at: now, holds: holds) != nil else {
      return .plain
    }
    return .fresh
  }

  /// When to ask again after `response` arrived at `now`: the next forecast hour plus the
  /// jitter (`Freshness.nextRefreshAt`).
  public static func next(after response: TodayResponse, at now: Date, jitterMs: Int) -> Date {
    Freshness.nextRefreshAt(response, after: now, jitterMs: jitterMs)
  }

  /// When to ask again after a fetch failed at `now`, with `response` still on screen. Offline
  /// or rate limited: `Constants.Client.retryAfterMs` later plus the jitter, quietly, which costs
  /// the server nothing while there is no connection. Any other failure waits for the next
  /// forecast hour of the answer on screen, as a fetch that worked would; with nothing on
  /// screen, nil: the user's "Try again", or the next return to the app, asks.
  public static func retry(
    after error: FetchError,
    response: TodayResponse?,
    at now: Date,
    jitterMs: Int
  ) -> Date? {
    switch error {
    case .offline, .rateLimited:
      Date(epochMs: now.epochMs + Constants.Client.retryAfterMs + jitterMs)
    case .failed:
      response.map { next(after: $0, at: now, jitterMs: jitterMs) }
    }
  }

  /// What the app does on coming back to the foreground.
  public struct Foreground: Sendable, Equatable {
    /// Go back to the view for the time of day (`MiddleDay.defaultView`).
    public let resetView: Bool
    /// How to fetch; nil to keep the answer on screen (and ask at the next forecast hour).
    public let fetch: Fetch?

    public init(resetView: Bool, fetch: Fetch?) {
      self.resetView = resetView
      self.fetch = fetch
    }
  }

  /// Back in the foreground at `now`, after going to the background at `awayFrom`, with
  /// `response` on screen, fetched at `fetchedAt` (section 9.5). After more than
  /// `Constants.Client.refreshAfterMs` (30 minutes) away, back to the view for the time of day,
  /// and a fetch. Sooner than that, a fetch only when the answer is out of date (past the
  /// caches), and, beyond the spec, when it is past `Freshness.usableUntil` and so shows the
  /// stale state, when there is none, or when its fetch time is unknown or after `now` (the clock
  /// moved back). However old the answer, a short time away asks nothing more: the quiet refresh
  /// at the next forecast hour, which the app schedules again, keeps it current.
  public static func foreground(
    _ response: TodayResponse?,
    fetchedAt: Date?,
    awayFrom: Date,
    at now: Date,
    holds: Freshness.Holds
  ) -> Foreground {
    let ms = now.epochMs
    let long = ms - awayFrom.epochMs > Constants.Client.refreshAfterMs
    guard let response else { return Foreground(resetView: long, fetch: .plain) }
    let how = Self.fetch(response, at: now, holds: holds)
    let backwards = fetchedAt.map { $0.epochMs > ms } ?? true
    let unusable = ms >= Freshness.usableUntil(response).epochMs
    let asks = long || how == .fresh || unusable || backwards
    return Foreground(resetView: long, fetch: asks ? how : nil)
  }
}
