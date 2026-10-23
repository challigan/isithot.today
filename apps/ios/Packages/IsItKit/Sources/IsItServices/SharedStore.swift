import Foundation
import IsItModel
import IsItState

/// What the app shares with its widgets through the App Group (iOS build spec, section 9.6): the
/// defaults (`place.v1`, `units.v1`, `unlock.v1`) and the last good answer, a file in the group's
/// container, `Library/Caches/today.v1.json`. It is the app's `StoredState`. UserDefaults and
/// FileManager may be used from any thread, so it is Sendable.
public struct SharedStore: StoredState, @unchecked Sendable {
  /// Where the store is.
  public enum Location: Equatable, Sendable {
    /// The App Group's defaults and container, which the app and its widgets share.
    case appGroup
    /// The process's own defaults and container, when the App Group can't open and the caller
    /// allows it: only the app's Debug builds do (V1 in the spec). The widgets can't see it.
    case ownContainer
  }

  public let location: Location
  public let defaults: UserDefaults
  /// The last good answer's file.
  public let todayURL: URL

  /// The App Group the bundle's Info.plist names (`IsItAppGroup`, from `APP_GROUP_ID`).
  public static func appGroupID(in bundle: Bundle = .main) -> String? {
    bundle.object(forInfoDictionaryKey: "IsItAppGroup") as? String
  }

  /// Opens the App Group `id`. When it can't open (a build signed without the App Group
  /// entitlement), `fallback` opens the process's own defaults and container instead; without
  /// it, the store is nil.
  public static func open(
    appGroup id: String,
    fallback: Bool,
    fileManager: FileManager = .default
  ) -> SharedStore? {
    if let container = fileManager.containerURL(forSecurityApplicationGroupIdentifier: id),
      let defaults = UserDefaults(suiteName: id)
    {
      let caches = container.appendingPathComponent("Library", isDirectory: true)
        .appendingPathComponent("Caches", isDirectory: true)
      return SharedStore(location: .appGroup, defaults: defaults, caches: caches)
    }
    // The app's own Library/Caches.
    guard fallback, let caches = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first
    else { return nil }
    return SharedStore(location: .ownContainer, defaults: .standard, caches: caches)
  }

  private init(location: Location, defaults: UserDefaults, caches: URL) {
    self.location = location
    self.defaults = defaults
    todayURL = caches.appendingPathComponent(Keys.AppGroup.today, isDirectory: false)
  }

  // MARK: - The last good answer, today.v1.json

  /// Saves `response` as the last good answer for the place `key` (`Target.key`), fetched at
  /// `savedAt`, replacing the one before.
  public func saveToday(_ response: TodayResponse, key: String, savedAt: Date) throws {
    try saveToday(SavedToday(key: key, savedAt: savedAt, response: response))
  }

  /// Saves `saved` as the last good answer, replacing the one before.
  public func saveToday(_ saved: SavedToday) throws {
    let data = try saved.encoded()
    try FileManager.default.createDirectory(
      at: todayURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try data.write(to: todayURL, options: .atomic)
  }

  /// The last good answer: nil when there is none, it can't be read, or another store version
  /// saved it (ignored, not migrated; `SavedToday(data:)`).
  public func loadToday() -> SavedToday? {
    guard let data = try? Data(contentsOf: todayURL) else { return nil }
    return SavedToday(data: data)
  }

  /// Forgets the last good answer.
  public func removeToday() throws {
    guard FileManager.default.fileExists(atPath: todayURL.path) else { return }
    try FileManager.default.removeItem(at: todayURL)
  }

  // MARK: - The defaults: place.v1, units.v1 and unlock.v1

  /// `place.v1`: the target's JSON; approximate IP location for none, or for anything that
  /// isn't a target (`Target(stored:)`).
  public func loadPlace() -> Target {
    Target(stored: defaults.data(forKey: Keys.AppGroup.place))
  }

  /// Keeps `target` in `place.v1`; approximate IP location is kept as no value.
  public func savePlace(_ target: Target) {
    if let data = try? target.stored() {
      defaults.set(data, forKey: Keys.AppGroup.place)
    } else {
      defaults.removeObject(forKey: Keys.AppGroup.place)
    }
  }

  /// `units.v1`: "c" or "f"; nil for none, or anything else.
  public func loadUnits() -> Units? {
    defaults.string(forKey: Keys.AppGroup.units).flatMap(Units.init(rawValue:))
  }

  /// Keeps `units` in `units.v1`, as "c" or "f".
  public func saveUnits(_ units: Units) {
    defaults.set(units.rawValue, forKey: Keys.AppGroup.units)
  }

  /// `unlock.v1`'s `unlocked`: false for nothing, or anything that isn't a `StoredUnlock`. Only
  /// the app's StoreKit code writes it (phase 7); this reads it.
  public func loadUnlocked() -> Bool {
    StoredUnlock.unlocked(stored: defaults.data(forKey: Keys.AppGroup.unlock))
  }
}
