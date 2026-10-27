import IsItLogic
import IsItServices
import IsItState
import StoreKit
import UIKit

/// StoreKit 2 as `PurchaseModel` uses it (spec section 13). Nothing here touches StoreKit until
/// the model asks: the unit tests' host builds the app and never launches it. The updates
/// listener is a task this object keeps, and the app keeps this object for its life (its model
/// is the app's `@State`), so the listener runs from launch step 2 until the app ends, as Apple
/// asks ("Create a Task to iterate through the transactions from the listener as soon as your
/// app launches").
///
/// On the main actor, as the model is and as `purchase(confirmIn:)` asks. Every StoreKit type it
/// keeps or hands on (`Transaction`, `Product`, `VerificationResult`) is Sendable. StoreKit's
/// errors (`StoreKitError`, `VerificationResult.VerificationError`) are `LocalizedError`s, so a
/// failure's words are StoreKit's own. A transaction StoreKit couldn't verify is never finished.
@MainActor
public final class StoreKitPurchases: PurchasePlatform {
  /// `Transaction.updates`, listened to once.
  private var listener: Task<Void, Never>?
  /// Verified transactions given to the model but not yet finished, by ID.
  private var unfinished: [UInt64: Transaction] = [:]
  /// The products `product(_:)` loaded, by ID, which `buy(_:)` buys.
  private var products: [String: Product] = [:]

  public init() {}

  deinit { listener?.cancel() }

  /// Ends the updates listener. The app never calls it (the listener runs for the app's life);
  /// the StoreKit tests call it in `tearDown`, since XCTest keeps every test case, and what it
  /// holds, until the run ends, and a listener left running would hear, and finish, the
  /// transactions of the tests after it.
  public func stopListening() {
    listener?.cancel()
    listener = nil
  }

  /// Listens to `Transaction.updates` (Ask to Buy's approvals, purchases on another device or in
  /// the App Store, refunds, Family Sharing), once: each transaction goes to `heard` as a fact,
  /// a verified one kept to be finished. The task holds this object only weakly: once the object
  /// has gone (its `deinit` cancels the task), the next update ends the task if cancelling
  /// hasn't.
  public func listen(_ heard: @escaping @MainActor (PurchaseFact) async -> Void) {
    guard listener == nil else { return }
    listener = Task { [weak self] in
      for await result in Transaction.updates {
        guard let self else { return }
        if case .verified(let transaction) = result { unfinished[transaction.id] = transaction }
        await heard(StoreKitFacts.fact(result))
      }
    }
  }

  /// `Transaction.currentEntitlements`, read whole (`StoreKitFacts`).
  public func entitlements() async -> [PurchaseFact] { await StoreKitFacts.entitlements() }

  /// The product: `.blocked` while the phone can't make payments (Screen Time, a managed phone),
  /// `.unavailable` when the App Store has none, else `.ready` with StoreKit's `displayPrice`
  /// and `isFamilyShareable`.
  public func product(_ id: String) async -> PurchaseState.Product {
    guard AppStore.canMakePayments else { return .blocked }
    // An unknown ID, or one the App Store can't find yet, is left out of the answer; only
    // system errors throw.
    guard let product = try? await Product.products(for: [id]).first else { return .unavailable }
    products[id] = product
    return .ready(price: product.displayPrice, familyShareable: product.isFamilyShareable)
  }

  /// Buys `id` with StoreKit's own confirmation sheet, over the app's scene. A verified
  /// purchase is kept to be finished once the model has kept its unlock.
  public func buy(_ id: String) async -> BuyResult {
    // PurchaseModel buys only a product this object loaded. Anything else is a fault, which
    // fails in StoreKit's words rather than reading as the user cancelling (so a StoreKit test
    // that never loaded the product can't pass as a cancel).
    guard let product = products[id] else {
      return .failed(StoreKitError.unknown.localizedDescription)
    }
    do {
      // In the app's scene: since iOS 18.2 a purchase StoreKit can't anchor to a window fails,
      // and `purchase(confirmIn:)` with a scene is iOS 17's.
      let result: Product.PurchaseResult
      if let scene = Self.scene() {
        result = try await product.purchase(confirmIn: scene)
      } else {
        result = try await product.purchase()
      }
      switch result {
      case .success(let verification):
        if case .verified(let transaction) = verification {
          unfinished[transaction.id] = transaction
        }
        return .completed(StoreKitFacts.fact(verification))
      case .pending:
        return .pending
      case .userCancelled:
        return .cancelled
      @unknown default:
        return .cancelled
      }
    } catch StoreKitError.userCancelled {
      return .cancelled
    } catch {
      return .failed(error.localizedDescription)
    }
  }

  /// Finishes the verified transaction `listen` or `buy` gave, once; nothing for any other.
  public func finish(_ transactionID: UInt64) async {
    await unfinished.removeValue(forKey: transactionID)?.finish()
  }

  /// `AppStore.sync()`, which may ask the user to sign in: only from Restore purchase.
  public func sync() async -> SyncResult {
    do {
      try await AppStore.sync()
      return .synced
    } catch StoreKitError.userCancelled {
      return .cancelled
    } catch {
      return .failed(error.localizedDescription)
    }
  }

  /// The scene in front, else any of the app's window scenes.
  private static func scene() -> UIWindowScene? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    return scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
  }
}
