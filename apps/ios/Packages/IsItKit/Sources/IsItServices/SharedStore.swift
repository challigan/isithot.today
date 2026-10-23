import Foundation
import IsItModel

/// What the app shares with its widgets through the App Group (iOS build spec, section 9.6): the
/// defaults (`place.v1`, `units.v1`, `unlock.v1`) and the last good answer, a file in the group's
/// container, `Library/Caches/today.v1.json`.
public struct SharedStore {
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

  /// Saves `response` as the last good answer for the place `key` (`Target.key`), fetched at
  /// `savedAt`, replacing the one before.
  public func saveToday(_ response: TodayResponse, key: String, savedAt: Date) throws {
    let saved = SavedToday(v: Keys.storeVersion, savedAt: savedAt, key: key, response: response)
    let data = try ApiJSON.encoder().encode(saved)
    try FileManager.default.createDirectory(
      at: todayURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try data.write(to: todayURL, options: .atomic)
  }

  /// The last good answer: nil when there is none, it can't be read, or another store version
  /// saved it (ignored, not migrated).
  public func loadToday() -> SavedToday? {
    guard let data = try? Data(contentsOf: todayURL),
      let saved = try? ApiJSON.decoder().decode(SavedToday.self, from: data),
      saved.v == Keys.storeVersion
    else { return nil }
    return saved
  }

  /// Forgets the last good answer.
  public func removeToday() throws {
    guard FileManager.default.fileExists(atPath: todayURL.path) else { return }
    try FileManager.default.removeItem(at: todayURL)
  }
}

/// The last good answer as saved: `{ v, savedAt, key, response }`. `savedAt` is in the file, so
/// nothing reads the file's own dates.
public struct SavedToday: Codable, Sendable, Equatable {
  /// The store version that saved it (`Keys.storeVersion`).
  public let v: Int
  /// When the answer was fetched.
  public let savedAt: Date
  /// The place it is for (`Target.key`).
  public let key: String
  public let response: TodayResponse
}
