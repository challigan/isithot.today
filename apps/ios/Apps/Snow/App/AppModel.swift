import Foundation
import IsItModel
import IsItServices
import Observation
import WidgetKit

/// The app's state (iOS build spec, section 9.4), as far as the skeleton has any: the answer on
/// screen, and the App Group store it saves answers to for the widget.
@MainActor
@Observable
final class AppModel {
  private(set) var response: TodayResponse? = nil
  let store: SharedStore?

  init() {
    DebugHooks.prepare()
    store = SharedStore.appGroupID().flatMap {
      SharedStore.open(appGroup: $0, fallback: DebugHooks.storeFallback)
    }
    if let launch = DebugHooks.launchAnswer() {
      show(launch.response, key: launch.key, savedAt: launch.savedAt)
    }
  }

  /// Shows `response`, saves it as the last good answer for the place `key`, and reloads the
  /// widgets, which read it.
  func show(_ response: TodayResponse, key: String, savedAt: Date) {
    self.response = response
    do {
      try store?.saveToday(response, key: key, savedAt: savedAt)
    } catch {
      // Not saved: the app still shows it, and the widget keeps the answer it had.
      return
    }
    WidgetCenter.shared.reloadAllTimelines()
  }
}
