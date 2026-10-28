import Foundation

/// What the upgrade page and Restore purchase ask the app to do (spec 10.4, 10.5). The page keeps
/// no state of its own: it draws IsItLogic's `UpgradePage` and hands each tap to the app's
/// purchase model through these.
public struct UpgradeActions {
  /// Buy: StoreKit's confirmation sheet, over the app.
  public var buy: () -> Void
  /// Restore purchase: may ask the user to sign in.
  public var restore: () -> Void
  /// The page is on screen: the product is asked for again if StoreKit hadn't answered.
  public var appeared: () -> Void
  /// The page left the screen: a failure's line and the restore result go.
  public var disappeared: () -> Void

  public init(
    buy: @escaping () -> Void,
    restore: @escaping () -> Void,
    appeared: @escaping () -> Void,
    disappeared: @escaping () -> Void
  ) {
    self.buy = buy
    self.restore = restore
    self.appeared = appeared
    self.disappeared = disappeared
  }
}
