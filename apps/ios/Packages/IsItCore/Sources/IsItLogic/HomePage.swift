import Foundation
import IsItModel

/// One of the home screen's forecast pages as plain values (iOS build spec, section 10.2): what
/// it shows of the answer, top to bottom, for one view at one moment, and the states without an
/// answer to show. The port of packages/mobile `homePage` (`page.ts`), checked against
/// `page.json`. The page words nothing of its own: what it shows of the answer is the hour picked
/// for the moment (`HourPicker`, `MiddleDay`), as the website shows the same answer (core
/// `viewDisplay`); the footer's lines are the website's; a failed request says what spec section
/// 4 has the app say (`CoreCopy.unavailable`, the server's message, or core's for a 429); the
/// rest is `CoreCopy` and `AppCopy`.
public struct HomePage: Sendable, Equatable {
  /// How the last request went, as the app's model keeps it (spec 9.4): asking, answered,
  /// failed, failed for want of a connection, or turned away for asking too often (429), which
  /// the app asks again after quietly (section 4).
  public enum Phase: String, Codable, Sendable, CaseIterable {
    case loading, ready, error, offline, limited
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

  /// A row of Now's next hours (spec 10.2): "6pm" and "60%", the chance for the row's bar, and
  /// what VoiceOver reads for the row, "60% chance at 6pm", as the website's screen readers hear
  /// it (core `viewDisplay`'s `sr`).
  public struct HourRow: Sendable, Equatable {
    /// "6pm", the block's start, local time.
    public let label: String
    /// "60%"
    public let value: String
    /// Percent, rounded to the nearest 10 (`ApiSnowHour.chance`).
    public let chance: Int
    /// "60% chance at 6pm"
    public let spoken: String

    public init(label: String, value: String, chance: Int, spoken: String) {
      self.label = label
      self.value = value
      self.chance = chance
      self.spoken = spoken
    }

    /// The row for one of Now's 2-hour blocks.
    public init(hour: ApiSnowHour) {
      let value = AppCopy.percent(value: String(hour.chance))
      self.init(
        label: hour.label,
        value: value,
        chance: hour.chance,
        spoken: AppCopy.hourRowLabel(chance: value, time: hour.label)
      )
    }
  }

  /// What the Now page shows below the answer: "Chance of snow, next 12 hours", then up to six
  /// 2-hour rows (fewer where the forecast ends).
  public struct Hours: Sendable, Equatable {
    public let heading: String
    public let rows: [HourRow]

    public init(heading: String, rows: [HourRow]) {
      self.heading = heading
      self.rows = rows
    }

    /// The next hours of `now`, the picked hour's Now.
    public init(now: ApiSnowNow) {
      self.init(heading: CoreCopy.nextHoursSnow, rows: now.hours.map(HourRow.init(hour:)))
    }
  }

  /// A day of the week (spec 10.2): its label ("Today", "Tue"), amount ("2cm") and band label
  /// ("Snow", or for a day without snow why: "Too warm"), the models expecting snow of those
  /// with data, drawn as `total` dots with `snowy` filled, and what VoiceOver reads for the row:
  /// "Tuesday, 2cm, snow, 4 of 6 forecasts expect snow", never a percentage.
  public struct WeekRow: Sendable, Equatable {
    public let label: String
    public let amount: String
    public let bandLabel: String
    /// Models expecting snow, and models with data for the day (S1); nil in an answer saved
    /// before the week's days had them, which then has no dots, and isn't read with them.
    public let snowy: Int?
    public let total: Int?
    public let spoken: String

    public init(
      label: String,
      amount: String,
      bandLabel: String,
      snowy: Int?,
      total: Int?,
      spoken: String
    ) {
      self.label = label
      self.amount = amount
      self.bandLabel = bandLabel
      self.snowy = snowy
      self.total = total
      self.spoken = spoken
    }

    /// The row for `day` of `week`, in the answer's unit. VoiceOver hears the day's name in full
    /// ("Today" for the week's first day, which the server labels so, else the weekday of its
    /// date), the amount, the band label starting in lower case, as it is mid-sentence, and the
    /// agreement (core `snowAgreementLine`, which `AppCopy.dayAgreement` words as core does).
    public init(day: ApiSnowWeekDay, of week: ApiSnowWeek, unit: SnowUnit) {
      let amount = StripGeometry.amountText(day.amount, unit)
      let name =
        day.date == week.from
        ? day.label : CivilDate.weekday(day.date).map { CoreCopy.weekdays[$0] } ?? day.label
      let band = day.bandLabel.prefix(1).lowercased() + day.bandLabel.dropFirst()
      let spoken: String
      if let snowy = day.snowy, let total = day.total {
        let values = (snowy: String(snowy), total: String(total))
        let agreement =
          snowy == 1
          ? AppCopy.dayAgreementOne(snowy: values.snowy, total: values.total)
          : AppCopy.dayAgreement(snowy: values.snowy, total: values.total)
        spoken = AppCopy.weekRowLabel(day: name, amount: amount, band: band, agreement: agreement)
      } else {
        spoken = AppCopy.weekRowLabelShort(day: name, amount: amount, band: band)
      }
      self.init(
        label: day.label,
        amount: amount,
        bandLabel: day.bandLabel,
        snowy: day.snowy,
        total: day.total,
        spoken: spoken
      )
    }
  }

  /// What the week page shows below its verdict and detail: a row for each day.
  public struct Week: Sendable, Equatable {
    public let rows: [WeekRow]

    public init(rows: [WeekRow]) {
      self.rows = rows
    }

    /// The days of `week`, the picked hour's week, in the answer's unit.
    public init(week: ApiSnowWeek, unit: SnowUnit) {
      self.init(rows: week.days.map { WeekRow(day: $0, of: week, unit: unit) })
    }
  }

  /// The footer, with an answer (spec 10.2, item 7).
  public struct Footer: Sendable, Equatable {
    /// "Updated 3:05pm GMT", or "Updated yesterday, 11:40pm GMT"; nil for an answer without
    /// `updated`.
    public let updated: String?
    /// "You're offline. Showing the forecast from 3:05pm GMT."; after a failed request,
    /// "Forecasts are unavailable right now…", with Retry (section 4); or the stale line. Nil
    /// when none applies (rate limited adds nothing, since it asks again by itself), and past
    /// `usableUntil`, when there is no forecast showing.
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
  /// The Now page's body, with an answer to show: the next hours.
  public let hours: Hours?
  /// The week page's body, with an answer to show: the days.
  public let week: Week?
  /// "Retry", after a failed request: in the error state, and under the footer's line while an
  /// answer shows; never offline over an answer, or rate limited, which ask again by themselves.
  public let retry: String?
  /// The footer, whenever there is an answer, shown or not.
  public let footer: Footer?

  /// The page for `view` at `now`, from the answer the app has (nil before the first), after a
  /// request that went as `phase`. `message` is the server's own message after a failed request
  /// (`error`), which the page says when it has no answer to show; without one,
  /// `CoreCopy.unavailable`. `placeName` is the place as the top bar names it; without one, the
  /// answer's.
  public init(
    _ res: TodayResponse?,
    view: AppView,
    at now: Date,
    phase: Phase,
    message: String? = nil,
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
      state = phase == .loading || phase == .ready ? .loading : .error
    }
    let question = Questions.snow(view: view, place: nil, tomorrow: tomorrow)
    let answer = shown?.answer ?? Self.noAnswer(state, phase: phase, message: message)
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
    hours = shown?.hours
    week = shown?.week
    retry = state == .error || (phase == .error && state != .noRecent) ? CoreCopy.retry : nil
    footer = res.map { Self.footer($0, state: state, phase: phase, at: now) }
  }

  /// What the page shows of the answer picked, as core `viewDisplay` shows it.
  private struct Shown: Equatable {
    let band: SnowBand
    let answer: String
    let verdict: String
    let detail: String
    var day: Day?
    var hours: Hours?
    var week: Week?
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
        hours: Hours(now: shown)
      )
    case .week:
      guard let shown = picked.week, let snow = res.snow else { return nil }
      return Shown(
        band: shown.band,
        answer: shown.answer,
        verdict: shown.verdict,
        detail: shown.detail,
        week: Week(week: shown, unit: snow.unit)
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
  private static func noAnswer(_ state: State, phase: Phase, message: String?) -> String {
    switch state {
    case .ready, .notAvailable: CoreCopy.notAvailable
    case .loading: CoreCopy.checking
    case .error: failure(phase, message: message)
    case .noRecent: AppCopy.staleApp
    }
  }

  /// What the error state says, with no answer at all, after a request that went as `phase`.
  /// Offline, the forecasts aren't what is unavailable: as past `usableUntil`, there is no recent
  /// forecast, and a connection brings one. Rate limited, core's words for it. Otherwise the
  /// server's message, as section 4 has the app show it, or `CoreCopy.unavailable` without one.
  private static func failure(_ phase: Phase, message: String?) -> String {
    switch phase {
    case .offline: AppCopy.staleApp
    case .limited: CoreCopy.errorMessage(code: "rate_limited") ?? CoreCopy.unavailable
    case .loading, .ready, .error: message.flatMap { $0.isEmpty ? nil : $0 } ?? CoreCopy.unavailable
    }
  }

  /// The footer: when the forecast was fetched, at the place (`UpdatedLine`); while there is a
  /// forecast to show, the offline line, the unavailable line after a failed request (with Retry,
  /// section 4), or the stale line, rate limited adding nothing; the links out, the places nearby
  /// and the credits.
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
    } else if phase == .error {
      notice = CoreCopy.unavailable
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
