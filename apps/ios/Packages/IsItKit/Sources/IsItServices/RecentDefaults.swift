import Foundation
import IsItLogic
import IsItModel
import IsItState

/// The picker's recent places in the app's own defaults, `recent.v1` (iOS build spec, section
/// 9.6), as the client's JSON (`RecentPlaces.stored(_:)`). Only the app reads them: the widgets
/// never do, so they aren't in the App Group. UserDefaults may be used from any thread, so it is
/// Sendable.
public struct RecentDefaults: RecentStore, @unchecked Sendable {
  public let defaults: UserDefaults

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  public func loadRecents() -> [RecentPlace] {
    RecentPlaces.list(stored: defaults.data(forKey: Keys.App.recent))
  }

  public func saveRecents(_ list: [RecentPlace]) {
    guard let data = try? RecentPlaces.stored(list) else { return }
    defaults.set(data, forKey: Keys.App.recent)
  }

  /// Forgets them all.
  public func removeAll() {
    defaults.removeObject(forKey: Keys.App.recent)
  }
}
