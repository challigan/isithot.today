import Foundation
import IsItModel

/// What one widget entry shows in every family (iOS build spec, sections 11.1 and 11.3), as plain
/// values: the small family and the medium's left half, the medium's right half (Now and the
/// week's rows), the three Lock Screen families, and what VoiceOver reads for each, one sentence
/// a tap target. The port of packages/mobile `widgetFace` (`widgetFace.ts`), field for field and
/// with its keys, checked against `widgetFace.json`; the gallery's sample is its JSON
/// (`WidgetSample.face`, generated).
///
/// The face words nothing of its own. Its words are core's (`CoreCopy.viewLabel`, `weekdays`,
/// `notAvailable`, the agreement line) and the server's (the answer, the verdict, the band
/// labels), set in `AppCopy`'s templates; its links are `DeepLink.link`'s; and the week's rows read
/// as the app's week page reads them (`HomePage.spokenWeekDay`).
public struct WidgetFace: Codable, Sendable, Equatable {
  /// Models expecting snow, of those with data: the dots and the gauge.
  public struct Agreement: Codable, Sendable, Equatable {
    public let snowy: Int
    public let total: Int
  }

  /// Now on the medium's right half: "Now", "No. Too warm for snow.", read as "Now: No. Too warm
  /// for snow.".
  public struct Now: Codable, Sendable, Equatable {
    public let label: String
    public let text: String
    public let spoken: String
  }

  /// A day on the medium's right half, after the middle day.
  public struct Day: Codable, Sendable, Equatable {
    /// The server's label: "Fri", or "Today" for the week's first day.
    public let label: String
    public let band: SnowBand
    public let bandLabel: String
    /// Nil when the day has no counts, or none of the models has data for it: no dots.
    public let agreement: Agreement?
    /// As the app's week page reads the row: "Friday, 8cm, heavy snow, 6 of 6 forecasts expect
    /// snow".
    public let spoken: String
  }

  public let state: WidgetEntry.State
  /// Where a tap goes (`widgetURL`): view/today for an answer and the stale state, the upgrade
  /// when locked.
  public let link: String
  /// The palette and the glyph: the middle day's band; nosnow when locked, stale or without a
  /// day.
  public let band: SnowBand
  /// An answer's place, the caption; "" otherwise.
  public let place: String
  /// "Today" or "Tomorrow" (`MiddleDay.label`); "" when locked or stale.
  public let slot: String
  /// The middle day's answer, "Yes."; "" without one.
  public let answer: String
  /// "Heavy snow · 5cm", or the reason, "Too warm"; `CoreCopy.notAvailable` without a day; ""
  /// when locked or stale.
  public let detail: String
  /// Models expecting snow of those with data, for the dots and the gauge; nil without data.
  public let agreement: Agreement?
  /// "5 of 6 forecasts", the rectangular family's third line; "" without data.
  public let agreementShort: String
  /// "Tomorrow · Yes.", the rectangular family's first line; the slot alone without an answer.
  public let slotAnswer: String
  /// "Tomorrow: Heavy snow" (inline); the message when locked or stale.
  public let inline: String
  /// `AppCopy.widgetLocked` or `widgetStale`; "" with an answer.
  public let message: String
  /// VoiceOver: the small family and the medium's left half.
  public let spoken: String
  /// VoiceOver: the rectangular family (the same without the place).
  public let spokenShort: String
  /// VoiceOver: the circular family.
  public let spokenGauge: String
  /// The medium's right half: Now, or nil without it.
  public let now: Now?
  /// The medium's right half: up to 4 days after the middle day.
  public let week: [Day]
  /// The right half's link, view/week; "" when locked or stale.
  public let weekLink: String
}

extension WidgetFace {
  /// What `entry` shows, its amounts in `unit` (the answer's `snow.unit`). Locked and stale say
  /// their message; an answer shows the middle day, or says it is not available when the answer
  /// has no such day (no tomorrow from 6pm), with Now and the week's rows wherever the answer has
  /// them.
  public init(_ entry: WidgetEntry, unit: SnowUnit) {
    guard entry.state == .ok else {
      self = Self.message(entry.state)
      return
    }
    let day = entry.day
    let place = entry.placeName
    let slot = MiddleDay.label(.today, tomorrow: entry.slot == .tomorrow)
    let answer = day?.answer ?? ""
    let agreement = day.flatMap(Self.dayAgreement)
    let phrase = agreement.map { HomePage.agreementLine(snowy: $0.snowy, total: $0.total) }
    // What VoiceOver says for the answer, which is never silent.
    let said = answer.isEmpty ? CoreCopy.notAvailable : answer
    let slotLine = AppCopy.widgetSlotLine(slot: slot, text: said)
    let heading =
      place.isEmpty ? slotLine : AppCopy.widgetHeading(place: place, slot: slot, answer: said)
    // The locked and stale faces' alone: an answer says none.
    let message = ""
    func sentence(_ first: String) -> String {
      guard let day else { return first }
      let detail = Self.detail(day, unit: unit, AppCopy.widgetBandAmountSpoken)
      guard let phrase else { return AppCopy.widgetSentenceShort(heading: first, detail: detail) }
      return AppCopy.widgetSentence(heading: first, detail: detail, agreement: phrase)
    }
    self.init(
      state: .ok,
      link: Self.link(.view(.today)),
      band: entry.palette,
      place: place,
      slot: slot,
      answer: answer,
      detail: day.map { Self.detail($0, unit: unit, AppCopy.widgetBandAmount) }
        ?? CoreCopy.notAvailable,
      agreement: agreement,
      agreementShort: agreement.map {
        AppCopy.agreementShort(snowy: String($0.snowy), total: String($0.total))
      } ?? "",
      slotAnswer: answer.isEmpty ? slot : AppCopy.widgetSlotAnswer(slot: slot, answer: answer),
      inline: AppCopy.widgetSlotLine(
        slot: slot, text: day.map(Self.bandLabel) ?? CoreCopy.notAvailable),
      message: message,
      spoken: sentence(heading),
      spokenShort: sentence(slotLine),
      spokenGauge: phrase.map { AppCopy.widgetGauge(slot: slot, agreement: $0) } ?? slotLine,
      now: entry.now.map(Self.now),
      week: entry.week.map { Self.row($0, unit: unit) },
      weekLink: Self.link(.view(.week))
    )
  }

  /// The gallery's and the placeholder's face (`WidgetSample.face`, generated from
  /// durham-tomorrow at 6:05pm), decoded once; the stale face should it ever not decode, which a
  /// Linux test (`WidgetSampleTests`) fails first.
  public static let sample: WidgetFace =
    (try? JSONDecoder().decode(WidgetFace.self, from: Data(WidgetSample.face.utf8)))
    ?? message(.stale)

  // MARK: - Private

  /// A link the face taps through to, which `DeepLink.link` always has for a view or the
  /// upgrade.
  private static func link(_ route: DeepLink.Route) -> String {
    DeepLink.link(route)!
  }

  /// The locked or the stale face: its message in every family and to VoiceOver, the nosnow
  /// palette, and nothing of an answer. Locked taps through to the upgrade, stale to Today.
  private static func message(_ state: WidgetEntry.State) -> WidgetFace {
    let locked = state == .locked
    let message = locked ? AppCopy.widgetLocked : AppCopy.widgetStale
    return WidgetFace(
      state: state,
      link: link(locked ? .upgrade : .view(.today)),
      band: .nosnow,
      place: "",
      slot: "",
      answer: "",
      detail: "",
      agreement: nil,
      agreementShort: "",
      slotAnswer: "",
      inline: message,
      message: message,
      spoken: message,
      spokenShort: message,
      spokenGauge: message,
      now: nil,
      week: [],
      weekLink: ""
    )
  }

  /// The day's band label: the server's, or for an answer saved before it had one, core's label
  /// for its reason, else for its band.
  private static func bandLabel(_ day: ApiSnowDay) -> String {
    let core = day.reason.flatMap(CoreCopy.snowReasonLabel) ?? CoreCopy.snowBandLabel(day.band)
    return day.bandLabel ?? core ?? ""
  }

  /// The middle day's detail, shown with `template` ("Heavy snow · 5cm") or spoken ("Heavy snow,
  /// 5cm"): the band and the amount when it snows, else the band label alone, which for a day
  /// without snow is the reason ("Too warm").
  private static func detail(
    _ day: ApiSnowDay, unit: SnowUnit, _ template: (String, String) -> String
  ) -> String {
    guard day.reason == nil, day.amount > 0 else { return bandLabel(day) }
    return template(bandLabel(day), StripGeometry.amountText(day.amount, unit))
  }

  /// The day's agreement when any model has data for it: the dots and the gauge.
  private static func dayAgreement(_ day: ApiSnowDay) -> Agreement? {
    day.total > 0 ? Agreement(snowy: day.snowy, total: day.total) : nil
  }

  /// A row's agreement when both counts are there and any model has data for the day.
  private static func rowAgreement(_ day: WidgetDay) -> Agreement? {
    guard let snowy = day.snowy, let total = day.total, total > 0 else { return nil }
    return Agreement(snowy: snowy, total: total)
  }

  /// Now on the medium's right half: "No. Too warm for snow.", read as "Now: No. Too warm for
  /// snow.".
  private static func now(_ now: WidgetEntry.Now) -> Now {
    let label = CoreCopy.viewLabel(.now)
    let text = AppCopy.widgetNow(answer: now.answer, verdict: now.verdict)
    return Now(label: label, text: text, spoken: AppCopy.widgetSlotLine(slot: label, text: text))
  }

  /// A row as the app's week page reads it: its name is the server's "Today" for the week's first
  /// day (reached only without a middle day), and otherwise the weekday in full, from the date.
  private static func row(_ day: WidgetDay, unit: SnowUnit) -> Day {
    let name =
      day.label == CoreCopy.viewLabel(.today)
      ? day.label : CivilDate.weekday(day.date).map { CoreCopy.weekdays[$0] } ?? day.label
    return Day(
      label: day.label,
      band: day.band,
      bandLabel: day.bandLabel,
      agreement: rowAgreement(day),
      spoken: HomePage.spokenWeekDay(
        name: name, amount: StripGeometry.amountText(day.amount, unit), bandLabel: day.bandLabel,
        snowy: day.snowy, total: day.total)
    )
  }
}
