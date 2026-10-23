import Foundation
import IsItModel

/// A calendar date and time of day at a place (core `LocalDateTime`).
public struct LocalDateTime: Codable, Sendable, Equatable {
  /// The calendar date, YYYY-MM-DD.
  public let date: String
  /// The time of day in hours, to the minute: 0 ≤ hours < 24, and 14:30 is 14.5.
  public let hours: Double

  public init(date: String, hours: Double) {
    self.date = date
    self.hours = hours
  }
}

/// The time at a place: the port of core `localDateTime` (`dates.ts`), checked against
/// `placeTime.json`. Only `TimeZone(identifier:)` and `secondsFromGMT(for:)` read the zone, and
/// a Gregorian calendar in UTC reads the shifted clock, which Linux and iOS agree on (V4).
///
/// It is exact for the zones the API sends: Open-Meteo's IANA names, as written ("Europe/London",
/// "Asia/Kolkata", "Etc/GMT+1"), aliases included, from 1582 on. Core's `Intl.DateTimeFormat`
/// and Foundation disagree on names the API never sends: Intl reads a name in any case
/// ("europe/london") and a UTC offset ("+05:30"), where this falls back to UTC, and it refuses
/// "GMT+5", which this reads as UTC+5. Before 1582 Foundation's calendar is Julian, where Intl's
/// stays Gregorian.
public enum PlaceTime {
  /// The local date and time of day at `moment` in the IANA time zone `timezone`, to the minute,
  /// as core's formatter gives it: the seconds are dropped, not rounded. A zone the system
  /// doesn't know is UTC, as in core.
  public static func local(_ moment: Date, in timezone: String) -> LocalDateTime {
    let zone = TimeZone(identifier: timezone)
    let offset = zone?.secondsFromGMT(for: moment) ?? 0
    // Whole seconds, rounded down as JavaScript's clock reads, then the place's offset.
    let seconds = (Double(moment.epochMs) / 1000).rounded(.down) + Double(offset)
    let parts = calendar.dateComponents(
      [.year, .month, .day, .hour, .minute],
      from: Date(timeIntervalSince1970: seconds)
    )
    // Core's UTC fallback is `toISOString`, whose year has four digits; its formatter's has as
    // many as it needs.
    let year = zone == nil ? padded(parts.year ?? 1970, 4) : String(parts.year ?? 1970)
    return LocalDateTime(
      date: "\(year)-\(padded(parts.month ?? 1, 2))-\(padded(parts.day ?? 1, 2))",
      hours: Double(parts.hour ?? 0) + Double(parts.minute ?? 0) / 60
    )
  }

  /// Reads a moment already shifted to the place's clock.
  private static let calendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? calendar.timeZone
    return calendar
  }()

  private static func padded(_ value: Int, _ width: Int) -> String {
    let digits = String(value)
    return String(repeating: "0", count: Swift.max(0, width - digits.count)) + digits
  }
}
