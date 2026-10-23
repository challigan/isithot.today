import IsItState
import WidgetKit

/// Tells WidgetKit that the saved answer changed, so the widgets read it again: after each
/// answer the app saves (iOS build spec, section 9.4, step 3).
public struct WidgetCenterReloader: WidgetReloader {
  public init() {}

  public func reloadAllTimelines() {
    WidgetCenter.shared.reloadAllTimelines()
  }
}
