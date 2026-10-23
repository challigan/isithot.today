import Foundation
import IsItModel

/// The snow answers that hold at a moment, and for how long (client `PickedHour`).
public struct PickedHour: Sendable, Equatable {
  /// Where the answers come from: the answer's own, or one of its hours ahead.
  public enum Source: String, Codable, Sendable, CaseIterable {
    case response, ahead
  }

  /// The start of the hour ahead picked, or nil for the answer's own (the moment it was made).
  public let start: Date?
  /// When the next hour ahead starts, or `Freshness.usableUntil`, whichever comes first.
  public let end: Date
  /// Now, as the answer gives it or as the hour ahead does (without the series).
  public let now: ApiSnowNow?
  public let today: ApiSnowDay?
  public let week: ApiSnowWeek?
  public let source: Source

  public init(
    start: Date?,
    end: Date,
    now: ApiSnowNow?,
    today: ApiSnowDay?,
    week: ApiSnowWeek?,
    source: Source
  ) {
    self.start = start
    self.end = end
    self.now = now
    self.today = today
    self.week = week
    self.source = source
  }
}

/// Which answer to show at a moment, between requests: the port of client `pickHour`
/// (`hours.ts`), checked against `hours.json`. The server judges and words every answer, the
/// hours ahead included; the app only picks one, minute by minute.
public enum HourPicker {
  /// The snow answers for `now` (client `pickHour`). Before the first hour ahead, or without
  /// any, the answer's own Now, today and week (also for a clock running behind the server's,
  /// as core `computeRainNow` takes the first hour); after that, those of the last hour ahead
  /// begun by `now`. Nil from `Freshness.usableUntil` on, which is never later than the end of
  /// the last hour ahead, and nil without snow answers: the caller then says it has no recent
  /// forecast.
  public static func pick(_ res: TodayResponse, at now: Date) -> PickedHour? {
    let until = Freshness.usableUntilMs(res)
    let now = now.epochMs
    guard let snow = res.snow, now < until else { return nil }
    let ahead = snow.ahead ?? []
    let times = ahead.map(\.time.epochMs)
    let begun = times.filter { $0 <= now }.count
    let end = Date(epochMs: Swift.min(begun < times.count ? times[begun] : until, until))
    guard begun > 0 else {
      return PickedHour(
        start: nil,
        end: end,
        now: snow.now,
        today: snow.days.first,
        week: snow.week,
        source: .response
      )
    }
    let entry = ahead[begun - 1]
    return PickedHour(
      start: Date(epochMs: times[begun - 1]),
      end: end,
      now: entry.now,
      today: entry.today,
      week: entry.week,
      source: .ahead
    )
  }
}
