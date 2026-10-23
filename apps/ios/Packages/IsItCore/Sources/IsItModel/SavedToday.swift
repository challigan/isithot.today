import Foundation

/// The last good answer as the app saves it for itself and its widgets (iOS build spec, section
/// 9.6): `today.v1.json` in the App Group's container, `{ v, savedAt, key, response }`.
/// `savedAt` is in the file, so nothing reads the file's own dates. A file another store
/// version wrote is ignored, not migrated.
public struct SavedToday: Codable, Sendable, Equatable {
  /// The store version that saved it (`Keys.storeVersion`).
  public let v: Int
  /// When the answer was fetched, to the millisecond, as the file keeps it.
  public let savedAt: Date
  /// The place it is for (`Target.key`).
  public let key: String
  public let response: TodayResponse

  /// `response` for the place `key`, fetched at `savedAt`, as this store version saves it.
  /// `savedAt` is kept to the nearest millisecond (`epochMs`), so what is read back from the
  /// file is equal to what was saved.
  public init(key: String, savedAt: Date, response: TodayResponse) {
    v = Keys.storeVersion
    self.savedAt = Date(epochMs: savedAt.epochMs)
    self.key = key
    self.response = response
  }

  /// The file's bytes: the API's JSON (`ApiJSON`), dates as the server writes them.
  public func encoded() throws -> Data {
    try ApiJSON.encoder().encode(self)
  }

  /// The saved answer in a file's bytes: nil when they don't read as one, or when another store
  /// version wrote them. The version is read first, on its own, so a later version's file is
  /// ignored whatever else it holds.
  public init?(data: Data) {
    let decoder = ApiJSON.decoder()
    guard let version = try? decoder.decode(Version.self, from: data),
      version.v == Keys.storeVersion,
      let saved = try? decoder.decode(SavedToday.self, from: data)
    else { return nil }
    self = saved
  }

  /// The file's store version, read before anything else.
  private struct Version: Decodable {
    let v: Int
  }
}
