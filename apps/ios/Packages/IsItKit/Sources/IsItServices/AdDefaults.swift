import Foundation
import IsItModel
import IsItState

/// When the last full-screen ad showed, in the app's own defaults, `ads.lastInterstitial`
/// (`Keys.App.lastInterstitial`), beside the recent places' `recent.v1`: `AdsModel` (IsItState)
/// reads it so that two full-screen ads are minutes apart across launches too. Only the app reads
/// it, so it isn't in the App Group. UserDefaults may be used from any thread, so it is Sendable.
public struct AdDefaults: AdsStore, @unchecked Sendable {
  public let defaults: UserDefaults

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  public func loadLastInterstitial() -> Date? {
    defaults.object(forKey: Keys.App.lastInterstitial) as? Date
  }

  public func saveLastInterstitial(_ date: Date?) {
    if let date {
      defaults.set(date, forKey: Keys.App.lastInterstitial)
    } else {
      removeAll()
    }
  }

  /// Forgets it.
  public func removeAll() {
    defaults.removeObject(forKey: Keys.App.lastInterstitial)
  }
}
