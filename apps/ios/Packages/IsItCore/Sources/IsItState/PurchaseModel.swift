import Foundation
import IsItLogic
import IsItModel
import Observation

/// StoreKit as `PurchaseModel` uses it: IsItPurchases' `StoreKitPurchases` in the app, a Debug
/// build's stand-in under the UI tests' launch arguments, a fake in the tests. On the main actor.
@MainActor
public protocol PurchasePlatform: AnyObject {
  /// Starts listening to `Transaction.updates`, once, for the app's life: each transaction as
  /// StoreKit sends it, verified or not. `heard` returns before anything is finished.
  func listen(_ heard: @escaping @MainActor (PurchaseFact) async -> Void)
  /// `Transaction.currentEntitlements`, read whole.
  func entitlements() async -> [PurchaseFact]
  /// The product: `.ready` with StoreKit's `displayPrice` and `isFamilyShareable`, `.blocked`,
  /// or `.unavailable`; never `.loading`.
  func product(_ id: String) async -> PurchaseState.Product
  /// Buys `id`, which `product(_:)` loaded, with StoreKit's confirmation sheet over the app. An
  /// `id` not loaded is `.failed`, never `.cancelled`, so a test that skipped the load fails.
  func buy(_ id: String) async -> BuyResult
  /// Finishes the transaction `listen` or `buy` gave, once its unlock is kept.
  func finish(_ transactionID: UInt64) async
  /// `AppStore.sync()`, which may ask the user to sign in: only from Restore purchase.
  func sync() async -> SyncResult
}

/// What a tap on Buy came to.
public enum BuyResult: Sendable, Equatable {
  /// StoreKit's `.success`, verified or not: the fact says, and carries StoreKit's words for a
  /// failed check (`verificationFailure`). The App Store has taken the payment either way.
  case completed(PurchaseFact)
  /// Ask to Buy.
  case pending
  /// The user cancelled, by StoreKit's result or its `userCancelled` error.
  case cancelled
  /// Any other error: its `localizedDescription`.
  case failed(String)
}

/// What Restore purchase's `AppStore.sync()` came to.
public enum SyncResult: Sendable, Equatable {
  case synced
  /// The user cancelled the sign-in.
  case cancelled
  case failed(String)
}

/// `unlock.v1` (spec 9.6), which only the purchase's code writes: `SharedStore` (IsItServices) in
/// the app; `MemoryUnlockStore` without an App Group, under the Debug stand-in, and in the tests.
/// Apart from `StoredState`, which reads it, so nothing else can write it.
public protocol UnlockStore: Sendable {
  /// `unlock.v1` as written: nil for nothing, or anything that isn't a `StoredUnlock`.
  func loadUnlock() -> StoredUnlock?
  /// Keeps `unlock` in `unlock.v1`.
  func saveUnlock(_ unlock: StoredUnlock)
}

/// `unlock.v1` kept in memory only.
public final class MemoryUnlockStore: UnlockStore, @unchecked Sendable {
  private let lock = NSLock()
  private var unlock: StoredUnlock?

  public init(_ unlock: StoredUnlock? = nil) {
    self.unlock = unlock
  }

  public func loadUnlock() -> StoredUnlock? { lock.withLock { unlock } }

  public func saveUnlock(_ unlock: StoredUnlock) { lock.withLock { self.unlock = unlock } }
}

/// The one-off purchase (phase 7.1; spec sections 13, 10.4 and 10.5): StoreKit's answer, the
/// product's price, buying, restoring and revocation. StoreKit is behind `PurchasePlatform`, so
/// the tests run it on Linux with a fake.
///
/// Whether it is owned has one rule (`PurchaseRules.owned` over the entitlements, with every
/// verified update heard that they don't show yet merged in) and one writer: every answer is
/// written to `unlock.v1`, the widgets reload when what it says changes, and `changed` tells the
/// app's model. Answers are read in turn: one that started before another finished reading
/// StoreKit is dropped, and whoever asked for it waits for the newer one, so a slow launch check
/// can never undo a purchase made meanwhile, and nothing returns, or finishes a transaction,
/// before an answer that includes it has been kept.
@MainActor
@Observable
public final class PurchaseModel {
  /// The product, the last buy and the last restore, as the views show them.
  public private(set) var state = PurchaseState()
  /// Whether the purchase is owned: `unlock.v1` until the launch's check, then StoreKit's answer.
  public private(set) var owned: Bool
  /// How many times a link asked for the upgrade page (`willitsnow://upgrade`): the home screen
  /// opens it at each.
  public private(set) var sheetRequests = 0
  /// Told when `owned` changes, once `unlock.v1` is written: the app's
  /// `AppModel.purchaseChanged(owned:)`.
  @ObservationIgnored public var changed: (@MainActor (Bool) async -> Void)?

  @ObservationIgnored private let platform: any PurchasePlatform
  @ObservationIgnored private let store: any UnlockStore
  @ObservationIgnored private let widgets: any WidgetReloader
  @ObservationIgnored private let clock: any AppClock
  @ObservationIgnored private let productID: String
  /// Whether `start()` has run: the listener and the launch's check have begun.
  @ObservationIgnored private var started = false
  /// How many reads of the entitlements have begun; only the newest one's answer is kept.
  @ObservationIgnored private var settles = 0
  /// The newest read, which the caller of every read it dropped waits for.
  @ObservationIgnored private var latest: Task<Void, Never>?
  /// The launch's check, which `launchEntitlement()` waits for.
  @ObservationIgnored private var checking: Task<Void, Never>?
  /// The product's load under way, which any other `loadProduct()` waits for.
  @ObservationIgnored private var productLoad: Task<Void, Never>?
  /// The verified updates heard that the entitlements don't show yet, in the order heard:
  /// merged into every answer until they do.
  @ObservationIgnored private var heard: [PurchaseFact] = []
  /// The entitlements the last kept answer read.
  @ObservationIgnored private var lastRead: [PurchaseFact] = []

  /// A model for `productID` that answers from `store`'s `unlock.v1` until the launch's check.
  /// Nothing is asked of StoreKit until `start()`.
  public init(
    platform: any PurchasePlatform,
    store: any UnlockStore,
    widgets: any WidgetReloader,
    clock: any AppClock,
    productID: String
  ) {
    self.platform = platform
    self.store = store
    self.widgets = widgets
    self.clock = clock
    self.productID = productID
    owned = store.loadUnlock()?.unlocked ?? false
  }

  // MARK: - The launch

  /// Launch step 2, once: listens to `Transaction.updates` first, then checks the entitlements
  /// and asks for the product. Never `AppStore.sync()`: nothing prompts at launch (17.4.1).
  public func start() {
    guard !started else { return }
    started = true
    platform.listen { [weak self] fact in await self?.hear(fact) }
    checking = Task { await settle() }
    Task { await loadProduct() }
  }

  /// Launch step 5: once the launch's check, and every answer that started while it was out,
  /// has been kept (starting the check if `start()` hasn't), whether the purchase is owned now.
  public func launchEntitlement() async -> Bool {
    start()
    await checking?.value
    return owned
  }

  /// The app became active (`scenePhase` `.active`): asks for the product again unless it is
  /// ready, and reads the entitlements again while an update heard is still ahead of them.
  /// Nothing before `start()`, so a test host's model never asks StoreKit.
  public func becameActive() async {
    guard started else { return }
    await loadProduct()
    if !heard.isEmpty { await settle() }
  }

  // MARK: - The product, buying and restoring

  /// Asks for the product again unless it is ready; while it is being asked for, waits for that
  /// answer. Either way it returns with StoreKit's answer kept in `state.product`. Settings and
  /// the upgrade page call it as they appear, so a launch offline is put right later.
  public func loadProduct() async {
    if case .ready = state.product { return }
    if let productLoad {
      await productLoad.value
      return
    }
    let load = Task {
      state.product = .loading
      state.product = await platform.product(productID)
      productLoad = nil
    }
    productLoad = load
    await load.value
  }

  /// Buy: only for a product that is ready, not owned, and not being bought already. A verified
  /// purchase is kept before it is finished, and the page then thanks; Ask to Buy waits; a
  /// cancel changes nothing (10.5); a failure, or a purchase StoreKit couldn't verify, which
  /// neither unlocks nor is finished (spec 13), says StoreKit's own words.
  public func buy() async {
    guard case .ready = state.product, !owned, state.attempt != .buying else { return }
    let before = state.attempt
    state.attempt = .buying
    switch await platform.buy(productID) {
    case .completed(let fact)
    where fact.verified && !fact.revoked && fact.productID == productID:
      await settle(hearing: fact)
      await platform.finish(fact.transactionID)
      state.attempt = .idle
    case .completed(let fact) where !fact.verified:
      // The App Store has taken the payment, so the page says what StoreKit says.
      let failure = fact.verificationFailure ?? ""
      state.attempt = failure.isEmpty ? before : .failed(failure)
    case .completed, .cancelled:
      // Cancelled, nothing changes (10.5); revoked, or another product's, is nothing StoreKit
      // gives for a purchase made here.
      state.attempt = before
    case .pending:
      state.attempt = .pending
    case .failed(let text):
      state.attempt = text.isEmpty ? before : .failed(text)
    }
  }

  /// Restore purchase: `AppStore.sync()`, then the entitlements again, whatever it came to.
  /// Found, it is restored; with only a transaction StoreKit couldn't verify, StoreKit's words
  /// for that, as "No purchase found" would be false; otherwise none found. A cancelled sign-in
  /// says nothing, and a failure StoreKit's own words.
  public func restore() async {
    guard state.restore != .restoring else { return }
    state.restore = .restoring
    let answer = await platform.sync()
    await settle()
    switch answer {
    case .synced:
      if owned {
        state.restore = .restored
      } else if let unverified = lastRead.first(where: {
        $0.productID == productID && !$0.verified
      }) {
        state.restore = .failed(unverified.verificationFailure ?? "")
      } else {
        state.restore = .nothingFound
      }
    case .cancelled:
      state.restore = .idle
    case .failed(let text):
      state.restore = text.isEmpty ? .idle : .failed(text)
    }
  }

  /// The link's `.upgrade` route.
  public func requestSheet() {
    sheetRequests += 1
  }

  /// The upgrade page or Settings closed: a failure's line and the restore result go; Ask to
  /// Buy's line stays while it waits.
  public func dismissResults() {
    if case .failed = state.attempt { state.attempt = .idle }
    switch state.restore {
    case .restored, .nothingFound, .failed: state.restore = .idle
    case .idle, .restoring: break
    }
  }

  // MARK: - StoreKit's answer

  /// An update from the listener. Another product's is finished if verified, and nothing more;
  /// one StoreKit couldn't verify is neither kept nor finished, so StoreKit sends it again at the
  /// next launch (spec 13: no unlock). A verified one is kept before it is finished: an Ask to
  /// Buy approval unlocks, and a refund or a Family Sharing removal (the same transaction,
  /// revoked) locks at once, unless the entitlements show another transaction that still owns it.
  private func hear(_ fact: PurchaseFact) async {
    guard fact.productID == productID else {
      if fact.verified { await platform.finish(fact.transactionID) }
      return
    }
    guard fact.verified else { return }
    await settle(hearing: fact)
    await platform.finish(fact.transactionID)
  }

  /// Keeps `fact`, if any, among the updates heard, starts a read of the entitlements, and
  /// returns once an answer at least as new has been kept: its own, or the newer one that
  /// dropped it, which holds `fact` too.
  private func settle(hearing fact: PurchaseFact? = nil) async {
    if let fact { heard = PurchaseRules.merging(heard, [fact]) }
    settles += 1
    let mine = settles
    let read = Task { await self.read(mine) }
    latest = read
    await read.value
    await settled()
  }

  /// Read `mine`: the entitlements, kept with the updates heard merged in, unless a newer read
  /// has begun meanwhile, which answers instead.
  private func read(_ mine: Int) async {
    let facts = await platform.entitlements()
    guard mine == settles else { return }
    heard = PurchaseRules.unseen(heard, in: facts)
    lastRead = facts
    await apply(PurchaseRules.owned(PurchaseRules.merging(facts, heard), productID: productID))
  }

  /// Waits for the newest read until no newer one has begun meanwhile.
  private func settled() async {
    var awaited = -1
    while awaited != settles {
      awaited = settles
      await latest?.value
    }
  }

  /// Keeps the answer `now`: written to `unlock.v1` every time (its `checkedAt` moves on), the
  /// widgets reloaded when what it says changed, and the app's model told when `owned` did,
  /// before the read that gave it ends.
  private func apply(_ now: Bool) async {
    let before = store.loadUnlock()?.unlocked ?? false
    store.saveUnlock(StoredUnlock(unlocked: now, checkedAt: clock.now, productID: productID))
    if before != now { widgets.reloadAllTimelines() }
    let was = owned
    owned = now
    // Owned, the thanks shows instead of Ask to Buy's line or a failure's.
    if now, state.attempt != .idle { state.attempt = .idle }
    if was != now { await changed?(now) }
  }
}
