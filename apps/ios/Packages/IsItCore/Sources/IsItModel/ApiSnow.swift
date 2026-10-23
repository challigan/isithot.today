import Foundation

/// "Will it snow?" for the place (core `ApiSnow`). Amounts are depths in `unit`, rounded for
/// display, so the text for an amount is always the amount and the unit.
public struct ApiSnow: Codable, Sendable, Equatable {
  public let unit: SnowUnit
  /// Today (the rest of the day), then tomorrow when the forecast has it.
  public let days: [ApiSnowDay]
  @Lenient public var now: ApiSnowNow?
  @Lenient public var week: ApiSnowWeek?
  /// The next forecast hours, each answered as at its start (`ahead=snow`, the apps only).
  @Lenient public var ahead: [ApiSnowAhead]?
}

/// "Will it snow today?" for one window: the rest of today, or a whole day.
public struct ApiSnowDay: Codable, Sendable, Equatable {
  /// The local date (YYYY-MM-DD).
  public let date: String
  /// When the window starts.
  public let from: Date
  /// True when the window is the rest of the day rather than the whole day.
  public let partial: Bool
  public let band: SnowBand
  /// "No." / "Maybe." / "Yes."
  public let answer: String
  /// "It'll snow." / "Too warm for snow."
  public let verdict: String
  /// "2 to 5cm of snow. Mostly between 2pm and 8pm."
  public let detail: String
  /// Why a day without snow has none (`nosnow` only).
  public let reason: SnowReason?
  /// "Heavy snow", "Snow possible", "Too warm". Optional, so an answer from before it decodes.
  public let bandLabel: String?
  /// The median of the models' snow.
  public let amount: Double
  /// The share of models expecting snow, 0 to 1.
  public let chance: Double
  /// Models expecting snow, and models with data for the whole window.
  public let snowy: Int
  public let total: Int
  public let confidence: Confidence
  /// The amount from which a model "expects snow" (the strip's highlighted zone).
  public let threshold: Double
  /// The local hours most likely to have snow.
  public let likely: HourSpan?
  /// The strip's range.
  public let scale: SnowScale
  public let models: [ApiSnowModel]
  /// The month's name, "December".
  public let month: String
  /// "5 of 6 forecasts expect snow"
  public let agreementText: String
  /// "Limited forecast data" when fewer than 3 models cover the window.
  public let limitedText: String?
  /// The model strip, for VoiceOver.
  public let stripSummary: String
}

/// Local hours, `to` exclusive: 24 is midnight.
public struct HourSpan: Codable, Sendable, Equatable {
  public let from: Int
  public let to: Int
}

/// The model strip's range (`min` is always 0).
public struct SnowScale: Codable, Sendable, Equatable {
  public let min: Double
  public let max: Double
}

/// One model on the strip.
public struct ApiSnowModel: Codable, Sendable, Equatable {
  public let id: String
  public let name: String
  /// The model's snow over the window, rounded for display.
  public let amount: Double
  /// The same to two decimals, for its place on the strip.
  public let value: Double
  public let expectsSnow: Bool
  /// Agrees with the answer.
  public let agrees: Bool
}

/// "Is it snowing right now?" for the current hour. The answer's `series` isn't decoded: the
/// next hours come from `ApiSnow.ahead` instead.
public struct ApiSnowNow: Codable, Sendable, Equatable {
  public let time: Date
  public let band: SnowBand
  public let answer: String
  public let verdict: String
  /// "Snow now, about 1cm an hour. Easing off by about 3pm."
  public let detail: String
  /// This hour's median amount.
  public let amount: Double
  /// The share of models with snow this hour, 0 to 1.
  public let chance: Double
  /// The next 12 hours in 2-hour blocks.
  public let hours: [ApiSnowHour]
}

/// The chance of snow in the two hours from `time`.
public struct ApiSnowHour: Codable, Sendable, Equatable {
  public let time: Date
  /// The local time, "3pm".
  public let label: String
  /// Percent, rounded to the nearest 10.
  public let chance: Int
}

/// "Will it snow this week?": today and the next six days.
public struct ApiSnowWeek: Codable, Sendable, Equatable {
  /// The first and last dates (YYYY-MM-DD).
  public let from: String
  public let to: String
  public let band: SnowBand
  public let answer: String
  /// "Snow on Thu and Fri, heavy on Fri."
  public let verdict: String
  public let detail: String
  /// The median of each model's own total across the days.
  public let total: Double?
  /// Normal snowfall over the same days, without which there's no comparison.
  public let normal: Double?
  /// Days judged snow or more, and days judged snow possible.
  public let snowDays: Int
  public let maybeDays: Int
  public let snowiest: SnowiestDay
  public let days: [ApiSnowWeekDay]
}

/// The week's snowiest day.
public struct SnowiestDay: Codable, Sendable, Equatable {
  public let date: String
  public let amount: Double
}

/// One day in the week. The models' agreement is optional, so an answer from before it decodes.
public struct ApiSnowWeekDay: Codable, Sendable, Equatable {
  public let date: String
  /// "Today", then short weekday names ("Thu").
  public let label: String
  public let amount: Double
  public let band: SnowBand
  /// "Heavy snow", "A few flakes", or for a day without snow why: "Too warm", "Rain", "Dry".
  public let bandLabel: String
  public let chance: Double?
  public let snowy: Int?
  public let total: Int?
  public let reason: SnowReason?
}

/// One forecast hour after the answer's: the views as the server answers at its start, from the
/// same forecast (core `ApiSnowAhead`).
public struct ApiSnowAhead: Codable, Sendable, Equatable {
  /// The hour's start.
  public let time: Date
  public let now: ApiSnowNow
  /// The rest of that hour's local day, as answered at the hour's start.
  public let today: ApiSnowDay
  public let week: ApiSnowWeek?
}
