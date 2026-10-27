import Foundation
import IsItModel

/// One transaction StoreKit holds for a product, as plain values (`Transaction` has no public
/// initialiser, so the tests can't make one): IsItServices' `StoreKitFacts` maps each.
public struct PurchaseFact: Sendable, Equatable {
  /// `Transaction.id`: a refund or a Family Sharing removal comes back as the same transaction,
  /// revoked.
  public let transactionID: UInt64
  public let productID: String
  /// Why StoreKit's own check failed, in its words (`VerificationResult.unverified`'s
  /// `VerificationError.localizedDescription`); nil when it passed.
  public let verificationFailure: String?
  /// The App Store refunded it or took it back from Family Sharing (`revocationDate != nil`).
  public let revoked: Bool
  /// Shared by a family member (`ownershipType == .familyShared`), which owns it all the same.
  public let familyShared: Bool

  /// StoreKit's own check passed (`VerificationResult.verified`).
  public var verified: Bool { verificationFailure == nil }

  public init(
    transactionID: UInt64, productID: String, verificationFailure: String?, revoked: Bool,
    familyShared: Bool
  ) {
    self.transactionID = transactionID
    self.productID = productID
    self.verificationFailure = verificationFailure
    self.revoked = revoked
    self.familyShared = familyShared
  }
}

/// Whether the purchase is owned (spec 13), from what StoreKit holds.
public enum PurchaseRules {
  /// A verified, unrevoked transaction for `productID` among `facts`, bought or shared through
  /// Family Sharing. StoreKit leaves refunded and revoked products out of
  /// `currentEntitlements`, so none is the locked state.
  public static func owned(_ facts: [PurchaseFact], productID: String) -> Bool {
    facts.contains { $0.productID == productID && $0.verified && !$0.revoked }
  }

  /// `facts` with each of `updates` in place of the transaction with its ID, or added, in turn:
  /// an update that StoreKit's entitlements haven't caught up with yet still counts, in either
  /// direction.
  public static func merging(_ facts: [PurchaseFact], _ updates: [PurchaseFact]) -> [PurchaseFact] {
    var merged = facts
    for update in updates {
      if let index = merged.firstIndex(where: { $0.transactionID == update.transactionID }) {
        merged[index] = update
      } else {
        merged.append(update)
      }
    }
    return merged
  }

  /// The updates among `heard` that `entitlements` don't show yet, in order: an unrevoked one
  /// whose transaction isn't among them unrevoked, and a revoked one whose transaction still is.
  /// The rest are shown, and need keeping no longer.
  public static func unseen(_ heard: [PurchaseFact], in entitlements: [PurchaseFact])
    -> [PurchaseFact]
  {
    let shown = Set(entitlements.filter { !$0.revoked }.map(\.transactionID))
    return heard.filter { fact in
      fact.revoked ? shown.contains(fact.transactionID) : !shown.contains(fact.transactionID)
    }
  }
}

/// The purchase as Settings, the upgrade page and the home row show it: the values
/// `PurchaseModel` (IsItState) keeps. Whether it is owned is `AppModel.unlocked`.
public struct PurchaseState: Sendable, Equatable {
  public enum Product: Sendable, Equatable {
    /// Not asked for yet, or being asked for.
    case loading
    /// The App Store had none to sell: offline, not answering, or the product isn't live (no
    /// Paid Apps Agreement, metadata not yet propagated, not attached to the version in review).
    /// Asked for again as Settings or the upgrade page appears and as the app becomes active.
    case unavailable
    /// The phone can't make payments (`AppStore.canMakePayments`: Screen Time, a managed phone).
    case blocked
    /// For sale: StoreKit's `displayPrice` ("£1.99"), and whether Family Sharing is on.
    case ready(price: String, familyShareable: Bool)
  }

  /// The last tap on Buy, this session.
  public enum Attempt: Sendable, Equatable {
    case idle
    case buying
    /// Ask to Buy: waiting for a parent. Ends when the approval comes through
    /// `Transaction.updates`; a decline sends nothing.
    case pending
    /// StoreKit's own words for what went wrong (`localizedDescription`).
    case failed(String)
  }

  /// The last tap on Restore purchase, this session.
  public enum Restore: Sendable, Equatable {
    case idle
    case restoring
    case restored
    case nothingFound
    case failed(String)
  }

  public var product: Product
  public var attempt: Attempt
  public var restore: Restore

  public init(product: Product = .loading, attempt: Attempt = .idle, restore: Restore = .idle) {
    self.product = product
    self.attempt = attempt
    self.restore = restore
  }
}
