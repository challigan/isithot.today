import Foundation
import IsItModel

/// Which answer a widget plans from (client `widgetReuses` and `widgetFallsBack`, iOS build spec
/// 11.2 steps 3 to 5), checked against `widgetSource.json`: the saved answer when it is for the
/// place in the units asked for, and either recent or all there is after a failed request; never
/// another place's answer under this place's name.
public enum WidgetSource {
  /// The saved answer with no request: for `key` byte for byte, in `units` when there are
  /// some, saved under `Constants.Widget.reuseMinutes` before `now` and not after it (a clock
  /// moved back), with an hour to show (`HourPicker.pick`). Otherwise the widget asks, as the app
  /// does.
  public static func reuses(_ saved: SavedToday?, key: String, units: Units?, at now: Date) -> Bool
  {
    guard let saved, fallsBack(saved, key: key, units: units) else { return false }
    let age = now.epochMs - saved.savedAt.epochMs
    return age >= 0 && age < Constants.Widget.reuseMinutes * minuteMs
      && HourPicker.pick(saved.response, at: now) != nil
  }

  /// After a failed request: the saved answer only for `key` in `units`, however old, as the
  /// planner makes it stale past `Freshness.usableUntil`.
  public static func fallsBack(_ saved: SavedToday?, key: String, units: Units?) -> Bool {
    // Compared byte for byte, as `Launch.paints` compares the app's keys.
    guard let saved, saved.key.utf8.elementsEqual(key.utf8) else { return false }
    return units.map { saved.response.units == $0 } ?? true
  }

  private static let minuteMs = 60 * 1000
}
