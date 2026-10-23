import Foundation
import IsItLogic
import IsItModel

/// How the app asks for an answer (iOS build spec, sections 5.6 and 9.5).
public enum Fetch: String, Sendable, Equatable, CaseIterable {
  /// Ask, and take what comes: the CDN's answer is never older than the forecast hour.
  case plain
  /// The answer on screen is out of date (`Freshness.outOfDate`): ask, and when the new answer
  /// is out of date too, which a phone clock running fast makes it, ask once more past the
  /// caches (`TodayQuery.fresh`), then hold it (`Freshness.hold`), as the website does. A fast
  /// clock then costs at most one extra request an hour.
  case fresh
}

/// What the app does at launch with what it saved (iOS build spec, section 9.4, steps 1 and 3).
/// Pure: the caller reads the stored state and the clock.
public enum Launch {
  /// The launch's first two decisions.
  public struct Plan: Sendable, Equatable {
    /// The saved answer to paint at once, or nil for the loading state.
    public let paint: SavedToday?
    /// How to fetch; nil to keep the saved answer without asking (`reuses`).
    public let fetch: Fetch?

    public init(paint: SavedToday?, fetch: Fetch?) {
      self.paint = paint
      self.fetch = fetch
    }
  }

  /// What to paint and whether to fetch, at `now`, for `target` in `units` (nil before the
  /// first answer), with `saved` the last good answer: paint it when it `paints`, and fetch
  /// unless it `reuses`, past the caches when it is out of date. Without one, the loading
  /// state and a fetch.
  public static func plan(
    _ saved: SavedToday?,
    target: Target,
    units: Units?,
    at now: Date
  ) -> Plan {
    guard let saved, paints(saved, target: target, units: units, at: now) else {
      return Plan(paint: nil, fetch: .plain)
    }
    if reuses(saved, at: now) { return Plan(paint: saved, fetch: nil) }
    return Plan(paint: saved, fetch: Refresh.fetch(saved.response, at: now, holds: .init()))
  }

  /// Whether the saved answer paints at once: it is for the place (its key is `target.key`,
  /// byte for byte, as the website compares keys) in the units asked for, and it still has an
  /// hour to show (`HourPicker.pick`, which is nil from `Freshness.usableUntil` on). The units
  /// are checked too, so an answer in centimetres never paints for someone who chose inches.
  public static func paints(
    _ saved: SavedToday,
    target: Target,
    units: Units?,
    at now: Date
  ) -> Bool {
    guard saved.key.utf8.elementsEqual(target.key.utf8) else { return false }
    if let units, saved.response.units != units { return false }
    return HourPicker.pick(saved.response, at: now) != nil
  }

  /// Whether a saved answer that paints is kept without asking again: fetched under
  /// `Constants.Client.reuseMs` (10 minutes) before `now`, which saves invocations on quick
  /// re-opens, and not out of date. A `savedAt` after `now` (the clock moved back) isn't
  /// reused.
  public static func reuses(_ saved: SavedToday, at now: Date) -> Bool {
    let age = now.epochMs - saved.savedAt.epochMs
    guard age >= 0, age < Constants.Client.reuseMs else { return false }
    return Freshness.outOfDate(saved.response, at: now, holds: .init()) == nil
  }
}
