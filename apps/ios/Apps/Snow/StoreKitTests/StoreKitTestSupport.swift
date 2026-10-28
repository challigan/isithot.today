import Foundation
import IsItLogic
import IsItModel
import IsItPurchases
import IsItState
import XCTest

/// StoreKit 2 as the app has it (`StoreKitPurchases`), forwarding every call `PurchaseModel`
/// makes and noting each with StoreKit's answer ("buy → cancelled", "sync → synced"), so a test
/// reads what StoreKit Test itself said beside what the model made of it.
@MainActor
final class RecordingPlatform: PurchasePlatform {
  let storeKit: StoreKitPurchases
  /// Each call, with its answer, in order.
  private(set) var calls: [String] = []
  /// What the last buy came to, as StoreKit gave it.
  private(set) var lastBuy: BuyResult?

  init(_ storeKit: StoreKitPurchases) {
    self.storeKit = storeKit
  }

  func listen(_ heard: @escaping @MainActor (PurchaseFact) async -> Void) {
    calls.append("listen")
    // Weakly, so a listener still waiting for an update keeps nothing of the test's alive.
    storeKit.listen { [weak self] fact in
      self?.calls.append("heard → \(Self.word(fact))")
      await heard(fact)
    }
  }

  func entitlements() async -> [PurchaseFact] {
    let facts = await storeKit.entitlements()
    calls.append("entitlements → \(facts.map(Self.word).joined(separator: ", "))")
    return facts
  }

  func product(_ id: String) async -> PurchaseState.Product {
    let product = await storeKit.product(id)
    calls.append("product → \(Self.word(product))")
    return product
  }

  func buy(_ id: String) async -> BuyResult {
    let result = await storeKit.buy(id)
    lastBuy = result
    calls.append("buy → \(Self.word(result))")
    return result
  }

  func finish(_ transactionID: UInt64) async {
    await storeKit.finish(transactionID)
    calls.append("finish")
  }

  func sync() async -> SyncResult {
    let result = await storeKit.sync()
    calls.append("sync → \(Self.word(result))")
    return result
  }

  /// The notes of every `call` ("buy", "sync"), in order.
  func answers(_ call: String) -> [String] {
    calls.filter { $0.hasPrefix("\(call) → ") }
  }

  private static func word(_ fact: PurchaseFact) -> String {
    if !fact.verified { return "unverified" }
    return fact.revoked ? "revoked" : "verified"
  }

  private static func word(_ product: PurchaseState.Product) -> String {
    switch product {
    case .loading: "loading"
    case .unavailable: "unavailable"
    case .blocked: "blocked"
    case .ready: "ready"
    }
  }

  private static func word(_ result: BuyResult) -> String {
    switch result {
    case .completed: "completed"
    case .pending: "pending"
    case .cancelled: "cancelled"
    case .failed: "failed"
    }
  }

  private static func word(_ result: SyncResult) -> String {
    switch result {
    case .synced: "synced"
    case .cancelled: "cancelled"
    case .failed: "failed"
    }
  }
}

/// `unlock.v1` in memory, or in the store it wraps, counting the saves made through it.
final class CountingUnlockStore: UnlockStore, @unchecked Sendable {
  private let store: any UnlockStore
  private let lock = NSLock()
  private var count = 0

  init(_ store: any UnlockStore = MemoryUnlockStore()) {
    self.store = store
  }

  /// How many times `unlock.v1` was written.
  var saves: Int { lock.withLock { count } }

  func loadUnlock() -> StoredUnlock? { store.loadUnlock() }

  func saveUnlock(_ unlock: StoredUnlock) {
    lock.withLock { count += 1 }
    store.saveUnlock(unlock)
  }
}

/// WidgetKit's reloads, counted.
final class CountingReloader: WidgetReloader, @unchecked Sendable {
  private let lock = NSLock()
  private var count = 0

  var reloads: Int { lock.withLock { count } }

  func reloadAllTimelines() { lock.withLock { count += 1 } }
}

/// The purchase as the app makes it, over a fresh `StoreKitPurchases`: a `PurchaseModel` for
/// the app's product over the recording platform, with a counting `unlock.v1` and widget
/// reloader, and each change it tells the app (`changed`) kept.
@MainActor
final class StoreKitPurchase {
  let storeKit = StoreKitPurchases()
  let platform: RecordingPlatform
  let store: CountingUnlockStore
  let widgets = CountingReloader()
  let model: PurchaseModel
  /// What `changed` told the app, in order.
  private(set) var changes: [Bool] = []

  init(store: CountingUnlockStore = CountingUnlockStore()) {
    platform = RecordingPlatform(storeKit)
    self.store = store
    model = PurchaseModel(
      platform: platform,
      store: store,
      widgets: widgets,
      clock: SystemClock(),
      productID: Constants.Purchase.productID
    )
    model.changed = { [weak self] owned in self?.changes.append(owned) }
  }

  /// Asks for the product as Settings does, and stops the test unless StoreKit Test gave
  /// Snow.storekit's. Every buy and restore test starts here, so none can pass with a product
  /// that never loaded. A loaded product doesn't show that a purchase can complete: on the broken
  /// simulator runtimes `purchase` answers `.userCancelled` at once, so the cancel test also buys
  /// once its simulated cancel is cleared, and needs that to complete.
  func readyModel(file: StaticString = #filePath, line: UInt = #line) async throws {
    await model.loadProduct()
    let ready = PurchaseState.Product.ready(
      price: Constants.Purchase.displayPrice, familyShareable: true)
    XCTAssertEqual(model.state.product, ready, "Snow.storekit's product", file: file, line: line)
    guard model.state.product == ready else { throw StoreKitTestStop.productNotReady }
  }
}

/// Why a test stopped before its steps: what it needs from StoreKit Test isn't there.
enum StoreKitTestStop: Error {
  /// Snow.storekit's product didn't load (`readyModel()`).
  case productNotReady
  /// Snow.storekit isn't in the test bundle.
  case noConfiguration
}

/// Waits up to `timeout` seconds, looking every 0.1 s, until `read()` gives `expected`; fails
/// with what it last read, after `what`, when it never does.
@MainActor
func eventually<Value: Equatable>(
  timeout: TimeInterval = 10,
  _ what: String,
  _ read: () -> Value,
  is expected: Value,
  file: StaticString = #filePath,
  line: UInt = #line
) async {
  let deadline = Date().addingTimeInterval(timeout)
  var seen = read()
  while seen != expected, Date() < deadline {
    try? await Task.sleep(for: .milliseconds(100))
    seen = read()
  }
  XCTAssertEqual(seen, expected, "\(what), after \(timeout) s", file: file, line: line)
}

/// Snow.storekit, from this test bundle's own resources: never the app's bundle, which doesn't
/// hold it (InfoPlistTests).
func snowStoreKitURL() throws -> URL {
  guard let url = Bundle(for: Marker.self).url(forResource: "Snow", withExtension: "storekit")
  else { throw StoreKitTestStop.noConfiguration }
  return url
}

/// A class of this bundle's, which `Bundle(for:)` finds it by.
private final class Marker {}
