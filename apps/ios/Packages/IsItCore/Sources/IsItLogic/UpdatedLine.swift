import Foundation
import IsItModel

/// When the forecast was fetched, at the place, for the footer's "Updated" line: the port of
/// client `updatedLine` (`hours.ts`), core `updatedTime`'s rule, checked against `hours.json`.
public enum UpdatedLine {
  /// "3:05pm GMT", or "yesterday, 11:40pm GMT" when the answer's `updated` date is before
  /// `today`, the place's date now (client `updatedLine`).
  public static func text(_ updated: ApiUpdated, today: String) -> String {
    // Dates are YYYY-MM-DD, which Swift orders as JavaScript does.
    updated.date < today ? "\(CoreCopy.yesterday), \(updated.clock)" : updated.clock
  }

  /// The answer's line at `now`, with today being the place's date then (`PlaceTime`); nil for
  /// an answer without `updated`.
  public static func text(for res: TodayResponse, at now: Date) -> String? {
    guard let updated = res.updated else { return nil }
    return text(updated, today: PlaceTime.local(now, in: res.location.timezone).date)
  }
}
