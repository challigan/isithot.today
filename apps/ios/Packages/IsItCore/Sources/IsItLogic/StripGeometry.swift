import Foundation
import IsItModel

/// The Today and Tomorrow pages' model strip: the port of the snow strip in core `viewDisplay`
/// (`display.ts`, `precipModels`), checked against `strip.json`. Positions are percentages of
/// the strip's width, from its left end; the texts are the server's, or amounts worded as the
/// website words them ("0cm", "2.5in").
public struct StripGeometry: Codable, Sendable, Equatable {
  /// The snowy zone: from the amount a model must forecast to "expect snow", to the strip's
  /// end.
  public struct Zone: Codable, Sendable, Equatable {
    public let left: Double
    public let width: Double

    public init(left: Double, width: Double) {
      self.left = left
      self.width = width
    }
  }

  /// One model's dot, at its amount (`value`).
  public struct Dot: Codable, Sendable, Equatable {
    public let left: Double
    /// True for a model that doesn't agree with the answer: drawn dimmed.
    public let out: Bool
    /// "ECMWF 2cm"
    public let title: String

    public init(left: Double, out: Bool, title: String) {
      self.left = left
      self.out = out
      self.title = title
    }
  }

  /// One row of the model list under the strip.
  public struct Item: Codable, Sendable, Equatable {
    /// "2cm"
    public let value: String
    /// "ECMWF"
    public let name: String
    /// True for a model that doesn't agree with the answer.
    public let out: Bool

    public init(value: String, name: String, out: Bool) {
      self.value = value
      self.name = name
      self.out = out
    }
  }

  /// "5 of 6 forecasts expect snow"
  public let heading: String
  /// The strip for VoiceOver, the day's `stripSummary`.
  public let summary: String
  /// The end labels, "0cm" and "5cm".
  public let min: String
  public let max: String
  /// Nil for a page without a day.
  public let zone: Zone?
  /// Where the answer's own amount sits.
  public let origin: Double
  public let dots: [Dot]
  public let items: [Item]
  /// "Limited forecast data", when fewer than 3 models cover the window.
  public let limited: String?

  public init(
    heading: String,
    summary: String,
    min: String,
    max: String,
    zone: Zone?,
    origin: Double,
    dots: [Dot],
    items: [Item],
    limited: String?
  ) {
    self.heading = heading
    self.summary = summary
    self.min = min
    self.max = max
    self.zone = zone
    self.origin = origin
    self.dots = dots
    self.items = items
    self.limited = limited
  }

  /// The strip for a snow day, in the answer's unit (core `precipModels`): the snowy zone from
  /// the day's `threshold` to the scale's end, and each model's amount, from none.
  public init(day: ApiSnowDay, unit: SnowUnit) {
    let position = Self.track(day.scale.min, day.scale.max)
    let left = position(day.threshold)
    self.init(
      heading: day.agreementText,
      summary: day.stripSummary,
      min: Self.amountText(day.scale.min, unit),
      max: Self.amountText(day.scale.max, unit),
      zone: Zone(left: left, width: Swift.max(0, position(day.scale.max) - left)),
      origin: position(day.amount),
      dots: day.models.map { model in
        Dot(
          left: position(model.value),
          out: !model.agrees,
          title: "\(model.name) \(Self.amountText(model.amount, unit))"
        )
      },
      items: day.models.map { model in
        Item(value: Self.amountText(model.amount, unit), name: model.name, out: !model.agrees)
      },
      limited: day.limitedText
    )
  }

  /// The middle view's strip (core `viewDisplay(res, 'snow', 'today', 'ready', { tomorrow })`):
  /// today's, or tomorrow's in the evening; `empty` when the answer has no such day.
  public init(_ res: TodayResponse, tomorrow: Bool) {
    let index = tomorrow ? 1 : 0
    guard let snow = res.snow, snow.days.indices.contains(index) else {
      self = .empty
      return
    }
    self.init(day: snow.days[index], unit: snow.unit)
  }

  /// A page without a day to show: no zone, no dots and no labels.
  public static let empty = StripGeometry(
    heading: "",
    summary: "",
    min: "",
    max: "",
    zone: nil,
    origin: 0,
    dots: [],
    items: [],
    limited: nil
  )

  /// Where `value` sits between `lo` and `hi`, as a percentage clamped to the strip (core
  /// `track`). A strip with no range divides by 1, as core's does. The week's rows place their
  /// dots by it too (`HomePage.WeekRow`), from none to the snowiest day.
  static func track(_ lo: Double, _ hi: Double) -> (Double) -> Double {
    let range = hi - lo
    let span = range == 0 || range.isNaN ? 1 : range
    return { value in Swift.min(100, Swift.max(0, ((value - lo) / span) * 100)) }
  }

  /// "2cm": the amount as JavaScript writes the number, then the unit (core `amountText`). The
  /// week's rows write their amounts so too (`HomePage.WeekRow`).
  static func amountText(_ amount: Double, _ unit: SnowUnit) -> String {
    JavaScriptNumber.string(amount) + unit.rawValue
  }
}
