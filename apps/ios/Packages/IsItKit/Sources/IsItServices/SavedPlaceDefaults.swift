import Foundation
import IsItLogic
import IsItModel
import IsItState

/// The picker's saved places in the app's own defaults, `savedPlaces.v1`, beside the recent
/// places' `recent.v1`, as the client's JSON (`SavedPlaces.stored(_:)`), read as leniently
/// (`SavedPlaces.list(stored:)`). Only the app reads them: no widget chooses a place in this
/// version, so they aren't in the App Group. UserDefaults may be used from any thread, so it is
/// Sendable.
public struct SavedPlaceDefaults: SavedPlaceStore, @unchecked Sendable {
  public let defaults: UserDefaults

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  public func loadSavedPlaces() -> [SavedPlace] {
    SavedPlaces.list(stored: defaults.data(forKey: Keys.App.savedPlaces))
  }

  public func saveSavedPlaces(_ list: [SavedPlace]) {
    guard let data = try? SavedPlaces.stored(list) else { return }
    defaults.set(data, forKey: Keys.App.savedPlaces)
  }

  /// Forgets them all.
  public func removeAll() {
    defaults.removeObject(forKey: Keys.App.savedPlaces)
  }
}
