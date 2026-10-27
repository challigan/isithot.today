import Foundation
import IsItLogic
import IsItModel
import Testing

/// The product the tests own or don't.
private let id = "today.willitsnow.app.unlock"

/// A transaction StoreKit could hold: bought, verified and unrevoked unless said.
private func fact(
  _ transactionID: UInt64, failure: String? = nil, revoked: Bool = false, family: Bool = false,
  product: String = id
) -> PurchaseFact {
  PurchaseFact(
    transactionID: transactionID, productID: product, verificationFailure: failure,
    revoked: revoked, familyShared: family)
}

/// Whether the purchase is owned (spec 13), over shapes StoreKit can give:
/// `currentEntitlements` holds at most one transaction per non-consumable, so two for the
/// product come only from merging an update heard.
@Suite("The purchase's rules")
struct PurchaseRulesTests {
  @Test("a verified, unrevoked purchase owns it")
  func ownedByAVerifiedPurchase() {
    #expect(PurchaseRules.owned([fact(1)], productID: id))
  }

  @Test("nothing owns nothing")
  func notOwnedByNothing() {
    #expect(!PurchaseRules.owned([], productID: id))
  }

  @Test("one StoreKit couldn't verify doesn't own it")
  func notOwnedUnverified() {
    let unverified = fact(1, failure: "Unverified.")
    #expect(!unverified.verified)
    #expect(fact(1).verified)
    #expect(!PurchaseRules.owned([unverified], productID: id))
  }

  @Test("a refunded or revoked one doesn't own it")
  func notOwnedRevoked() {
    #expect(!PurchaseRules.owned([fact(1, revoked: true)], productID: id))
  }

  @Test("another product doesn't own it")
  func notOwnedByAnotherProduct() {
    #expect(!PurchaseRules.owned([fact(1, product: "today.willitsnow.app.other")], productID: id))
  }

  @Test("one shared through Family Sharing owns it")
  func ownedThroughFamilySharing() {
    #expect(PurchaseRules.owned([fact(1, family: true)], productID: id))
  }

  @Test("bought and shared, the shared one taken back: still owned through the other")
  func ownedByAnyOne() {
    let merged = PurchaseRules.merging([fact(1)], [fact(2, revoked: true, family: true)])
    #expect(merged == [fact(1), fact(2, revoked: true, family: true)])
    #expect(PurchaseRules.owned(merged, productID: id))
  }

  @Test("an update replaces the transaction with its ID")
  func mergingReplacesTheSameTransaction() {
    #expect(PurchaseRules.merging([fact(1)], [fact(1, revoked: true)]) == [fact(1, revoked: true)])
  }

  @Test("an update for a transaction not there is added, after the others")
  func mergingAddsANewOne() {
    #expect(PurchaseRules.merging([fact(1)], [fact(2)]) == [fact(1), fact(2)])
  }

  @Test("several updates are merged in turn, the last for a transaction standing")
  func mergingSeveralInTurn() {
    #expect(
      PurchaseRules.merging([], [fact(1), fact(1, revoked: true)]) == [fact(1, revoked: true)])
  }

  @Test("an update is kept until the entitlements show it, in either direction")
  func unseenKeepsWhatTheEntitlementsDontShow() {
    #expect(PurchaseRules.unseen([fact(9)], in: []) == [fact(9)])
    #expect(PurchaseRules.unseen([fact(9)], in: [fact(9)]).isEmpty)
    #expect(
      PurchaseRules.unseen([fact(7, revoked: true)], in: [fact(7)]) == [fact(7, revoked: true)])
    #expect(PurchaseRules.unseen([fact(7, revoked: true)], in: []).isEmpty)
    #expect(PurchaseRules.unseen([fact(7, revoked: true)], in: [fact(1)]).isEmpty)
    // In the order heard.
    #expect(PurchaseRules.unseen([fact(9), fact(8)], in: []) == [fact(9), fact(8)])
  }
}
