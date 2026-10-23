import Foundation
import IsItModel

/// A day in the medium widget's list (client `WidgetDay`): one of the picked week's days.
public struct WidgetDay: Sendable, Equatable {
  /// The local date (YYYY-MM-DD).
  public let date: String
  /// The short weekday name, "Thu".
  public let label: String
  public let band: SnowBand
  /// "Heavy snow", "A few flakes", or for a day without snow why: "Too warm", "Rain", "Dry".
  public let bandLabel: String
  public let amount: Double
  /// Models expecting snow, and models with data for the day: nil in an answer from before
  /// the week had them, as the week's day has.
  public let snowy: Int?
  public let total: Int?

  public init(
    date: String,
    label: String,
    band: SnowBand,
    bandLabel: String,
    amount: Double,
    snowy: Int?,
    total: Int?
  ) {
    self.date = date
    self.label = label
    self.band = band
    self.bandLabel = bandLabel
    self.amount = amount
    self.snowy = snowy
    self.total = total
  }

  /// The week's day, as the list shows it.
  public init(_ day: ApiSnowWeekDay) {
    self.init(
      date: day.date,
      label: day.label,
      band: day.band,
      bandLabel: day.bandLabel,
      amount: day.amount,
      snowy: day.snowy,
      total: day.total
    )
  }
}

/// What a widget shows from one moment until the next entry (client `WidgetEntry`). Its `date`
/// is WidgetKit's: when the entry starts showing.
public struct WidgetEntry: Sendable, Equatable {
  /// Locked until bought; stale past `Freshness.usableUntil`, or with nothing to show.
  public enum State: String, Codable, Sendable, CaseIterable {
    case ok, locked, stale
  }

  /// The Now answer, as the medium widget shows it ("No. It's not snowing.").
  public struct Now: Sendable, Equatable {
    public let answer: String
    public let verdict: String
    public let band: SnowBand

    public init(answer: String, verdict: String, band: SnowBand) {
      self.answer = answer
      self.verdict = verdict
      self.band = band
    }
  }

  /// When the entry starts showing.
  public let date: Date
  public let state: State
  public let placeName: String
  /// "Today" or "Tomorrow" over the middle view's day (`MiddleDay.label`); today when locked
  /// or stale.
  public let slot: MiddleDay.Slot
  /// The middle view's day.
  public let day: ApiSnowDay?
  public let now: Now?
  /// Up to 4 days after the middle view's day.
  public let week: [WidgetDay]
  /// The palette and glyph: the middle view's day's band, else `nosnow`.
  public let palette: SnowBand

  public init(
    date: Date,
    state: State,
    placeName: String,
    slot: MiddleDay.Slot,
    day: ApiSnowDay?,
    now: Now?,
    week: [WidgetDay],
    palette: SnowBand
  ) {
    self.date = date
    self.state = state
    self.placeName = placeName
    self.slot = slot
    self.day = day
    self.now = now
    self.week = week
    self.palette = palette
  }
}

/// A widget's timeline: its entries, and when WidgetKit should ask for the next.
public struct WidgetPlan: Sendable, Equatable {
  /// When to reload the timeline, as WidgetKit's `TimelineReloadPolicy` has it: never (a locked
  /// widget, which the app reloads whenever the purchase changes), or after a moment.
  public enum Reload: Sendable, Equatable {
    case never
    case after(Date)
  }

  public let entries: [WidgetEntry]
  public let reloadAt: Reload

  public init(entries: [WidgetEntry], reloadAt: Reload) {
    self.entries = entries
    self.reloadAt = reloadAt
  }
}

/// The widget planner: what a widget shows from one answer until it is reloaded. The port of
/// client `widgetEntries` (`widget.ts`), checked against `widget.json`. A widget can't work
/// anything out as time passes, so each change the answer already knows about (the hours ahead,
/// 6pm and midnight at the place, the end of the forecast) is planned as an entry of its own.
public enum WidgetPlanner {
  /// Entries from `now` (client `widgetEntries`): one now, one at each hour ahead after it, then
  /// a stale one at `Freshness.usableUntil`. Each takes its answers from `HourPicker.pick` at its
  /// moment and its day from `MiddleDay`, and its week from the picked week, from the day after
  /// the middle view's. Locked: a single entry, never reloaded (the app reloads widgets
  /// whenever the purchase changes). No answer, or nothing usable now: a single stale entry.
  /// The reload comes `Constants.Widget.refreshHours` after the answer was fetched, or at
  /// `usableUntil` if sooner; when that has passed already, `Constants.Widget.retryMinutes`
  /// from now. `placeName` is the name the app keeps for the place, else the answer's.
  public static func entries(
    _ res: TodayResponse?,
    fetchedAt: Date,
    now: Date,
    unlocked: Bool,
    placeName: String? = nil
  ) -> WidgetPlan {
    let placeName = placeName ?? res?.location.name ?? ""
    func blank(_ date: Int, _ state: WidgetEntry.State) -> WidgetEntry {
      WidgetEntry(
        date: Date(epochMs: date),
        state: state,
        placeName: placeName,
        slot: .today,
        day: nil,
        now: nil,
        week: [],
        palette: .nosnow
      )
    }
    let start = now.epochMs
    guard unlocked else { return WidgetPlan(entries: [blank(start, .locked)], reloadAt: .never) }

    // Without an answer there is no limit to reload by, as JavaScript's -Infinity: a retry.
    let until = res.map { Freshness.usableUntil($0).epochMs }
    let reload = until.map {
      Swift.min(fetchedAt.epochMs + Constants.Widget.refreshHours * Date.hourMs, $0)
    }
    let reloadAt = Date(
      epochMs: reload.flatMap { $0 > start ? $0 : nil }
        ?? start + Constants.Widget.retryMinutes * minuteMs)
    guard let res, let until, HourPicker.pick(res, at: now) != nil else {
      return WidgetPlan(entries: [blank(start, .stale)], reloadAt: .after(reloadAt))
    }

    func entry(_ date: Int) -> WidgetEntry {
      let moment = Date(epochMs: date)
      // Every moment planned is before `until`, where an hour is always picked.
      guard let picked = HourPicker.pick(res, at: moment) else { return blank(date, .stale) }
      let middle = MiddleDay(res, picked: picked, at: moment)
      // Dates are YYYY-MM-DD, which Swift compares as JavaScript does.
      let after = middle.day?.date ?? ""
      return WidgetEntry(
        date: moment,
        state: .ok,
        placeName: placeName,
        slot: middle.slot,
        day: middle.day,
        now: picked.now.map {
          WidgetEntry.Now(answer: $0.answer, verdict: $0.verdict, band: $0.band)
        },
        week: (picked.week?.days ?? []).filter { $0.date > after }.prefix(4).map(WidgetDay.init),
        palette: middle.day?.band ?? .nosnow
      )
    }
    let later = (res.snow?.ahead ?? []).map(\.time.epochMs).filter { $0 > start && $0 < until }
    return WidgetPlan(
      entries: ([start] + later).map(entry) + [blank(until, .stale)],
      reloadAt: .after(reloadAt)
    )
  }

  private static let minuteMs = 60 * 1000
}
