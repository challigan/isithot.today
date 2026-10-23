import Foundation
import IsItModel

/// One of the home screen's forecast pages as plain values (iOS build spec, section 10.2): what
/// it shows of the answer, top to bottom, for one view at one moment, and the states without an
/// answer to show. The port of packages/mobile `homePage` (`page.ts`), checked against
/// `page.json`. The page words nothing of its own: what it shows of the answer is the hour picked
/// for the moment (`HourPicker`, `MiddleDay`), as the website shows the same answer (core
/// `viewDisplay`); the footer's lines are the website's; the rest is `CoreCopy` and `AppCopy`.
public struct HomePage: Sendable, Equatable {
  /// How the last request went, as the app's model keeps it (spec 9.4): asking, answered,
  /// failed, or failed for want of a connection.
  public enum Phase: String, Codable, Sendable, CaseIterable {
    case loading, ready, error, offline
  }

  /// What the page shows: an answer; "Checking…" while the first is on its way; the error, with
  /// Retry, when there is no answer at all (offline, that there is no recent forecast); "Not
  /// available right now." when the answer has no block for the view; or, past
  /// `Freshness.usableUntil`, that there is no recent forecast.
  public enum State: String, Codable, Sendable, CaseIterable {
    case ready, loading, error, notAvailable, noRecent
  }

  /// A row of the model list under the strip.
  public struct ModelLine: Sendable, Equatable {
    /// "ECMWF · 2cm"
    public let text: String
    /// "ECMWF", and "2cm": the row in two lines, at accessibility text sizes.
    public let name: String
    public let value: String
    /// True for a model that doesn't agree with the answer: drawn lighter.
    public let out: Bool

    public init(text: String, name: String, value: String, out: Bool) {
      self.text = text
      self.name = name
      self.value = value
      self.out = out
    }
  }

  /// What the middle page (Today, or Tomorrow from 6pm) shows below the answer.
  public struct Day: Sendable, Equatable {
    /// "5 of 6 forecasts expect snow"
    public let heading: String
    /// The models strip, one accessibility element read as `summary`.
    public let strip: StripGeometry
    /// "Forecasts range from 0.9cm to 5cm; 6 of 6 expect snow."
    public let summary: String
    public let lines: [ModelLine]
    /// "Limited forecast data", when fewer than 3 models cover the window.
    public let limited: String?

    public init(
      heading: String,
      strip: StripGeometry,
      summary: String,
      lines: [ModelLine],
      limited: String?
    ) {
      self.heading = heading
      self.strip = strip
      self.summary = summary
      self.lines = lines
      self.limited = limited
    }

    /// The day's agreement, strip and model list, in the answer's unit.
    public init(day: ApiSnowDay, unit: SnowUnit) {
      let strip = StripGeometry(day: day, unit: unit)
      self.init(
        heading: strip.heading,
        strip: strip,
        summary: strip.summary,
        lines: strip.items.map { item in
          ModelLine(
            text: AppCopy.modelLine(name: item.name, value: item.value),
            name: item.name,
            value: item.value,
            out: item.out
          )
        },
        limited: strip.limited
      )
    }
  }

  /// The footer, with an answer (spec 10.2, item 7).
  public struct Footer: Sendable, Equatable {
    /// "Updated 3:05pm GMT", or "Updated yesterday, 11:40pm GMT"; nil for an answer without
    /// `updated`.
    public let updated: String?
    /// "You're offline. Showing the forecast from 3:05pm GMT.", or the stale line; nil when
    /// neither applies, and past `usableUntil`, when there is no forecast showing.
    public let notice: String?
    /// "Want the full picture? See the forecast on", then `links`, which open in Safari.
    public let outboundIntro: String
    public let links: [OutboundLink]
    /// "Nearby:", then `nearby`, which load in place.
    public let nearbyLabel: String
    public let nearby: [NearbyCity]
    /// The answer's `attribution`, each line in pieces with its links (`Credits.parts`).
    public let credits: [[CreditPart]]

    public init(
      updated: String?,
      notice: String?,
      outboundIntro: String,
      links: [OutboundLink],
      nearbyLabel: String,
      nearby: [NearbyCity],
      credits: [[CreditPart]]
    ) {
      self.updated = updated
      self.notice = notice
      self.outboundIntro = outboundIntro
      self.links = links
      self.nearbyLabel = nearbyLabel
      self.nearby = nearby
      self.credits = credits
    }
  }

  public let view: AppView
  public let state: State
  /// The middle view answers for tomorrow (`MiddleDay.showsTomorrow`).
  public let tomorrow: Bool
  /// The view's label in the switcher: "Now", "Today" or "Tomorrow", "This week".
  public let label: String
  /// The band shown, which picks the glyph; nil without an answer to show.
  public let band: SnowBand?
  /// The band's palette, or `nosnow`'s without one.
  public let palette: Palette
  /// "Will it snow tomorrow?", without the place, as on the website's home page.
  public let question: String
  /// The answer word, "Yes.", or what the state says in its place ("Checking…").
  public let answer: String
  /// The question and the answer as one heading for VoiceOver, with the place: "Leeds. Will it
  /// snow tomorrow? Yes."
  public let headingLabel: String
  /// The server's verdict and detail; nil without an answer to show.
  public let verdict: String?
  public let detail: String?
  /// The middle page's body, with an answer to show.
  public let day: Day?
  /// "Retry", in the error state.
  public let retry: String?
  /// The footer, whenever there is an answer, shown or not.
  public let footer: Footer?

  /// The page for `view` at `now`, from the answer the app has (nil before the first), after a
  /// request that went as `phase`. `placeName` is the place as the top bar names it; without one,
  /// the answer's.
  public init(
    _ res: TodayResponse?,
    view: AppView,
    at now: Date,
    phase: Phase,
    placeName: String? = nil
  ) {
    let tomorrow = MiddleDay.showsTomorrow(res, at: now)
    // Nil without snow answers, and from `usableUntil` on.
    let picked = res.flatMap { HourPicker.pick($0, at: now) }
    // Nil, too, when the answer has nothing for the view.
    let shown = res.flatMap { res in
      picked.flatMap { Self.shown(res, picked: $0, view: view, at: now) }
    }
    let state: State
    if let res {
      if res.snow == nil {
        state = .notAvailable
      } else if picked == nil {
        state = .noRecent
      } else {
        state = shown == nil ? .notAvailable : .ready
      }
    } else {
      state = phase == .error || phase == .offline ? .error : .loading
    }
    let question = Questions.snow(view: view, place: nil, tomorrow: tomorrow)
    let answer = shown?.answer ?? Self.noAnswer(state, phase: phase)
    let place = placeName ?? res?.location.name ?? ""
    self.view = view
    self.state = state
    self.tomorrow = tomorrow
    label = MiddleDay.label(view, tomorrow: tomorrow)
    band = shown?.band
    palette = Palettes.snow(shown?.band ?? .nosnow)
    self.question = question
    self.answer = answer
    // Without a place, the website's heading: the question, then the answer.
    headingLabel =
      place.isEmpty
      ? "\(question) \(answer)"
      : AppCopy.headingLabel(place: place, question: question, answer: answer)
    verdict = shown?.verdict
    detail = shown?.detail
    day = shown?.day
    retry = state == .error ? CoreCopy.retry : nil
    footer = res.map { Self.footer($0, state: state, phase: phase, at: now) }
  }

  /// What the page shows of the answer picked, as core `viewDisplay` shows it.
  private struct Shown: Equatable {
    let band: SnowBand
    let answer: String
    let verdict: String
    let detail: String
    let day: Day?
  }

  /// The picked hour's Now or week, or the middle view's day (today's, or tomorrow's from
  /// 6pm); nil when the answer has none.
  private static func shown(
    _ res: TodayResponse,
    picked: PickedHour,
    view: AppView,
    at now: Date
  ) -> Shown? {
    switch view {
    case .now:
      guard let shown = picked.now else { return nil }
      return Shown(
        band: shown.band,
        answer: shown.answer,
        verdict: shown.verdict,
        detail: shown.detail,
        day: nil
      )
    case .week:
      guard let shown = picked.week else { return nil }
      return Shown(
        band: shown.band,
        answer: shown.answer,
        verdict: shown.verdict,
        detail: shown.detail,
        day: nil
      )
    case .today:
      guard let shown = MiddleDay(res, picked: picked, at: now).day, let snow = res.snow else {
        return nil
      }
      return Shown(
        band: shown.band,
        answer: shown.answer,
        verdict: shown.verdict,
        detail: shown.detail,
        day: Day(day: shown, unit: snow.unit)
      )
    }
  }

  /// What the page says in the answer's place, without one to show (`ready` always has one).
  /// With no answer at all for want of a connection, the forecasts aren't what is unavailable:
  /// as past `usableUntil`, there is no recent forecast, and a connection brings one.
  private static func noAnswer(_ state: State, phase: Phase) -> String {
    switch state {
    case .ready, .notAvailable: CoreCopy.notAvailable
    case .loading: CoreCopy.checking
    case .error: phase == .offline ? AppCopy.staleApp : CoreCopy.unavailable
    case .noRecent: AppCopy.staleApp
    }
  }

  /// The footer: when the forecast was fetched, at the place (`UpdatedLine`); the offline line,
  /// or the stale line, while there is a forecast to show; the links out, the places nearby and
  /// the credits.
  private static func footer(
    _ res: TodayResponse,
    state: State,
    phase: Phase,
    at now: Date
  ) -> Footer {
    let when = UpdatedLine.text(for: res, at: now)
    let notice: String?
    if state == .noRecent {
      notice = nil
    } else if phase == .offline {
      notice = when.map { AppCopy.offline(time: $0) }
    } else {
      notice = res.stale == true ? CoreCopy.stale : nil
    }
    return Footer(
      updated: when.map { "\(CoreCopy.updated) \($0)" },
      notice: notice,
      outboundIntro: CoreCopy.outboundIntro,
      links: res.links ?? [],
      nearbyLabel: CoreCopy.nearby,
      nearby: res.nearby ?? [],
      credits: res.attribution.map(Credits.parts)
    )
  }
}
