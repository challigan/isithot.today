import Foundation

/// What `unlock.v1` keeps in the App Group (iOS build spec, section 9.6):
/// `{ unlocked, checkedAt, productID }`, as JSON. Only the app's StoreKit code writes it (phase
/// 7); the app and its widgets read it. Nothing, or anything that doesn't read as one, is locked.
public struct StoredUnlock: Codable, Sendable, Equatable {
  /// Whether the purchase that removes the ads and turns on the widgets is owned.
  public let unlocked: Bool
  /// When StoreKit last said so.
  public let checkedAt: Date
  /// The product's ID in App Store Connect.
  public let productID: String

  public init(unlocked: Bool, checkedAt: Date, productID: String) {
    self.unlocked = unlocked
    self.checkedAt = checkedAt
    self.productID = productID
  }

  /// As `unlock.v1` keeps it: the API's JSON (`ApiJSON`), its date as the server writes dates.
  public func stored() throws -> Data {
    try ApiJSON.encoder().encode(self)
  }

  /// What `unlock.v1` holds, or nil for nothing or anything that isn't one.
  public init?(stored data: Data?) {
    guard let data, let read = try? ApiJSON.decoder().decode(StoredUnlock.self, from: data)
    else { return nil }
    self = read
  }

  /// Whether `unlock.v1`'s `data` says the purchase is owned: false for nothing, or anything
  /// that isn't a `StoredUnlock`.
  public static func unlocked(stored data: Data?) -> Bool {
    StoredUnlock(stored: data)?.unlocked ?? false
  }
}
