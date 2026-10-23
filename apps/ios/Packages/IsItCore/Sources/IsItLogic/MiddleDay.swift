import Foundation
import IsItModel

/// The middle view's day: today's, or tomorrow's from 6pm at the place (client `middleDay`), and
/// the rules for when (core `showsTomorrow`, `defaultView` and `viewLabel`, `display.ts` and
/// `copy.ts`). Checked against `tomorrow.json` and `hours.json`.
public struct MiddleDay: Sendable, Equatable {
  /// Which day the middle view answers for. Its tab reads `label`.
  public enum Slot: String, Codable, Sendable, CaseIterable {
    case today, tomorrow
  }

  public let slot: Slot
  /// The day's answer: tomorrow's (`snow.days[1]`), or the picked hour's today; nil without one.
  public let day: ApiSnowDay?

  public init(slot: Slot, day: ApiSnowDay?) {
    self.slot = slot
    self.day = day
  }

  /// The middle view's day at `now`, for the hour picked for it (client `middleDay`):
  /// tomorrow's from 6pm at the place (`showsTomorrow`), else the picked hour's today.
  public init(_ res: TodayResponse, picked: PickedHour, at now: Date) {
    if Self.showsTomorrow(res, at: now) {
      let days = res.snow?.days ?? []
      self.init(slot: .tomorrow, day: days.count > 1 ? days[1] : nil)
    } else {
      self.init(slot: .today, day: picked.today)
    }
  }

  /// The middle view's tab label: "Tomorrow" while it shows tomorrow, else "Today".
  public var label: String {
    Self.label(.today, tomorrow: slot == .tomorrow)
  }

  /// Whether the middle view answers for tomorrow (core `showsTomorrow`): from
  /// `Constants.tomorrowFromHour` to midnight, local time at the place, when the answer is for
  /// the place's today and has tomorrow. As in core, the answer's days are the hot answer's
  /// (`hotDays`), which have the same dates as snow's.
  public static func showsTomorrow(_ res: TodayResponse?, at now: Date) -> Bool {
    guard let res, let days = res.hotDays, days.count > 1 else { return false }
    let local = PlaceTime.local(now, in: res.location.timezone)
    // Dates are YYYY-MM-DD, which Swift compares as JavaScript does.
    return local.hours >= Double(Constants.tomorrowFromHour) && local.date == days[0].date
  }

  /// The view the app opens on (core `defaultView`): Now while the middle view shows tomorrow,
  /// else Today.
  public static func defaultView(_ res: TodayResponse?, at now: Date) -> AppView {
    showsTomorrow(res, at: now) ? .now : .today
  }

  /// A view's tab label (core `viewLabel`): the middle view reads "Tomorrow" while it shows
  /// tomorrow.
  public static func label(_ view: AppView, tomorrow: Bool) -> String {
    view == .today && tomorrow ? CoreCopy.tomorrowLabel : CoreCopy.viewLabel(view)
  }
}
