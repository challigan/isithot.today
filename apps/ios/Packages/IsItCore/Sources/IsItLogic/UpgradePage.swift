import Foundation
import IsItModel

/// The upgrade page (spec 10.5): the title, what the purchase is, Family Sharing, then what can
/// be done (the Buy button with the price, a line saying why not, or nothing once owned), the last
/// outcome, and Restore purchase with its result. Nothing names another app, website or weather
/// type. The live widget previews (7.3) go between the body and the buying.
public struct UpgradePage: Sendable, Equatable {
  public enum Buying: Sendable, Equatable {
    /// StoreKit hasn't answered yet: a spinner.
    case loading
    /// "Buy for £1.99"; `busy` while StoreKit's purchase is under way (no second tap).
    case button(String, busy: Bool)
    /// Why it can't be bought: `upgradeUnavailable` or `purchasesOff`.
    case line(String)
    /// Owned: nothing to buy.
    case none
  }

  /// "Remove ads and add widgets"
  public let title: String
  /// `AppCopy.upgradeBody`
  public let body: String
  /// "Shared with your family through Family Sharing.", when the product says it is shared
  /// (`Product.isFamilyShareable`); nil until StoreKit has said.
  public let familySharing: String?
  public let buying: Buying
  /// Owned: `thanks`; Ask to Buy: `pending`; a failure: StoreKit's text; otherwise nil.
  public let outcome: String?
  /// "Restore purchase" (id `sheet-restore`, action `.restore`, icon `.restore`), its result as
  /// its detail, busy while restoring.
  public let restore: SettingsScreen.Row
  /// "Close", when it is a sheet of its own.
  public let close: String

  /// The page for the purchase as `PurchaseModel` keeps it, owned when `unlocked`.
  public init(unlocked: Bool, purchase: PurchaseState) {
    title = AppCopy.upgradeTitle
    body = AppCopy.upgradeBody
    if case .ready(_, familyShareable: true) = purchase.product {
      familySharing = AppCopy.familySharing
    } else {
      familySharing = nil
    }
    if unlocked {
      buying = .none
    } else {
      switch purchase.product {
      case .loading: buying = .loading
      case .unavailable: buying = .line(AppCopy.upgradeUnavailable)
      case .blocked: buying = .line(AppCopy.purchasesOff)
      case .ready(let price, _):
        buying = .button(AppCopy.buy(price: price), busy: purchase.attempt == .buying)
      }
    }
    if unlocked {
      outcome = AppCopy.thanks
    } else {
      switch purchase.attempt {
      case .pending: outcome = AppCopy.pending
      case .failed(let text) where !text.isEmpty: outcome = text
      case .idle, .buying, .failed: outcome = nil
      }
    }
    restore = Self.restoreRow(id: "sheet-restore", purchase.restore)
    close = CoreCopy.close
  }

  /// "Restore purchase" with `id`, as the upgrade page and Settings both show it: its result as
  /// its detail (StoreKit's own words for a failure, none when it gave none), busy while it
  /// restores.
  static func restoreRow(id: String, _ restore: PurchaseState.Restore) -> SettingsScreen.Row {
    let detail: String?
    switch restore {
    case .restored: detail = AppCopy.restored
    case .nothingFound: detail = AppCopy.nothingToRestore
    case .failed(let text) where !text.isEmpty: detail = text
    case .idle, .restoring, .failed: detail = nil
    }
    return SettingsScreen.Row(
      id: id, title: AppCopy.restore, action: .restore, icon: .restore, detail: detail,
      busy: restore == .restoring)
  }

  /// The home row at the end of the middle page (spec 10.2, item 6): in the free version, once
  /// StoreKit has a price, "No ads, plus widgets for your home and lock screen · £1.99"; nil
  /// otherwise (loading, unavailable, blocked, owned).
  public static func homeRow(unlocked: Bool, purchase: PurchaseState) -> String? {
    guard !unlocked, case .ready(let price, _) = purchase.product else { return nil }
    return AppCopy.upgradeRow(price: price)
  }
}
