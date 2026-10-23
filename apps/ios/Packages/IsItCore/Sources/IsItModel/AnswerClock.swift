import Foundation

// What the client's clock rules read from the answers the snow app otherwise leaves undecoded
// (client `freshness.ts`, core `showsTomorrow`): the hot answer's days and Now, and the rain
// answer's today and Now. Only their moments and dates are decoded, leniently, so the app knows
// when an answer goes out of date exactly as the website does.

/// One hour of an answer's hourly series, as the clock rules read it: when it starts, and its
/// local date (core `ApiNowPoint`, `ApiRainPoint` and `ApiSnowPoint`; nothing else is decoded).
public struct ApiClockHour: Codable, Sendable, Equatable {
  /// The hour's start. The API sends it as epoch milliseconds, unlike its other moments.
  public let time: Date
  /// The local date (YYYY-MM-DD).
  public let date: String

  public init(time: Date, date: String) {
    self.time = time
    self.date = date
  }

  enum CodingKeys: String, CodingKey {
    case time, date
  }

  /// The largest moment JavaScript's `Date` can hold, either side of 1970: 8.64e15 ms
  /// (ECMAScript's time value range, 100 million days).
  static let maxEpochMs = 8.64e15

  /// Refuses a start that isn't a moment JavaScript's `Date` could hold (not finite, or beyond
  /// `maxEpochMs`), so `@Lenient` drops the series as it does any other damage, rather than the
  /// rules trapping on it later (`epochMs` is an `Int`).
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let ms = try container.decode(Double.self, forKey: .time)
    guard ms.isFinite, abs(ms) <= Self.maxEpochMs else {
      throw DecodingError.dataCorruptedError(
        forKey: .time, in: container, debugDescription: "Not a moment: \(ms) ms")
    }
    time = Date(timeIntervalSince1970: ms / 1000)
    date = try container.decode(String.self, forKey: .date)
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(time.epochMs, forKey: .time)
    try container.encode(date, forKey: .date)
  }
}

/// The hot or rain answer's Now, as the clock rules read it: when it was worked out, and the
/// hours of its series (core `ApiNow`, `ApiRainNow`).
public struct ApiClockNow: Codable, Sendable, Equatable {
  public let time: Date
  public let series: [ApiClockHour]
}

/// A day of the hot answer, as the clock rules read it: its local date (core `ApiDay`).
public struct ApiClockDay: Codable, Sendable, Equatable {
  /// The local date (YYYY-MM-DD).
  public let date: String
}

/// The rain answer, as the clock rules read it (core `ApiRain`): when its days start, and its
/// Now's hours. Client `hourUntil` reads rain's before snow's, which are the same moments.
public struct ApiRainClock: Codable, Sendable, Equatable {
  public let days: [Day]
  @Lenient public var now: ApiClockNow?

  /// A rain day, as the clock rules read it: when its window starts (core `ApiRainDay.from`).
  public struct Day: Codable, Sendable, Equatable {
    public let from: Date
  }
}
