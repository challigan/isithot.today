import IsItLogic
import StoreKit

/// What StoreKit holds for the app's purchase, as plain values (`PurchaseFact`): read by the app's
/// purchase code (IsItPurchases) and, from phase 7.2, the widget. Reading only: nothing here
/// buys, restores or prompts.
public enum StoreKitFacts {
  /// One transaction: its ID and product, StoreKit's words if its check failed, whether it was
  /// refunded or taken back (`revocationDate`), and whether it came through Family Sharing.
  public static func fact(_ result: VerificationResult<Transaction>) -> PurchaseFact {
    let transaction = result.unsafePayloadValue
    var failure: String?
    if case .unverified(_, let error) = result { failure = error.localizedDescription }
    return PurchaseFact(
      transactionID: transaction.id, productID: transaction.productID,
      verificationFailure: failure, revoked: transaction.revocationDate != nil,
      familyShared: transaction.ownershipType == .familyShared)
  }

  /// `Transaction.currentEntitlements`, read whole (iOS 15; `currentEntitlements(for:)` is iOS
  /// 18.4 and the app supports 17). It reads StoreKit's own cache, so it answers offline.
  public static func entitlements() async -> [PurchaseFact] {
    var facts: [PurchaseFact] = []
    for await result in Transaction.currentEntitlements { facts.append(fact(result)) }
    return facts
  }
}
