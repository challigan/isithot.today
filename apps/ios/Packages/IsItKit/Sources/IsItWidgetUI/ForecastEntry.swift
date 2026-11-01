import Foundation
import IsItLogic
import IsItState
import WidgetKit

/// One entry of the widget's timeline as WidgetKit takes it: when it starts showing, and what
/// every family shows then (`WidgetFace`), from `WidgetTimeline`'s plan.
public struct ForecastEntry: TimelineEntry, Sendable, Equatable {
  public let date: Date
  public let face: WidgetFace
}

extension ForecastEntry {
  /// The plan's entry, as it is.
  public init(_ entry: WidgetTimeline.Entry) {
    self.init(date: entry.date, face: entry.face)
  }
}
