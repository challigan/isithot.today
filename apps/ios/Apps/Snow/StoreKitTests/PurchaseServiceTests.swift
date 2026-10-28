import Foundation
import IsItLogic
import IsItModel
import IsItPurchases
import IsItServices
import IsItState
import StoreKit
import StoreKitTest
import UIKit
import XCTest

/// The purchase against StoreKit Test (iOS build spec, sections 13 and 17.2): the app's own
/// `StoreKitPurchases` under its own `PurchaseModel`, through their public APIs only, in the test
/// environment Snow.storekit sets up. Buying, Ask to Buy approved and declined, a refund while
/// the app runs and while it is closed, Restore purchase's four results, a purchase StoreKit
/// couldn't verify, a failure, a cancel, and `unlock.v1` in the App Group. A Family Sharing
/// removal can't be made in StoreKit Test (no API makes a family-shared transaction): it takes
/// the refund's path (`revocationDate`), and its rules are IsItCore's Linux tests.
///
/// Hosted by the app, as StoreKit Test needs. The app's own model never starts here
/// (`DebugHooks.launches()` is false while the app only hosts tests, and `becameActive()` does
/// nothing before `start()`), so its listener can't take these tests' transactions. Every
/// SKTestSession controls the one test environment, whose transactions and simulated errors
/// last from test to test, so the tests run one at a time (StoreKit.xctestplan, on the iOS 26.2
/// simulator), each from a cleared environment and with its own listener stopped after it.
@MainActor
final class PurchaseServiceTests: XCTestCase {
  private let id = Constants.Purchase.productID
  private var session: SKTestSession?
  /// The test's purchase, as the app makes it.
  private var purchase: StoreKitPurchase?
  /// A second, for the launch after the app was closed.
  private var relaunched: StoreKitPurchase?

  override func setUp() async throws {
    try await super.setUp()
    // The simulator's runtime, in the results, so a change of runtime shows beside its effect.
    XCTContext.runActivity(named: "iOS \(UIDevice.current.systemVersion)") { _ in }
    // By its URL in this bundle: Apple documents `init(configurationFileNamed:)` as reading a
    // file in the application's bundle, which never holds it.
    let session = try SKTestSession(contentsOf: snowStoreKitURL())
    clearSimulatedErrors(session)
    session.clearTransactions()
    self.session = session
    purchase = StoreKitPurchase()
  }

  /// Each listener stops first: XCTest keeps every test case, and what it holds, until the run
  /// ends, so a listener left running would hear, and finish, the next tests' transactions.
  override func tearDown() async throws {
    for made in [purchase, relaunched] { made?.storeKit.stopListening() }
    purchase = nil
    relaunched = nil
    if let session {
      session.clearTransactions()
      session.resetToDefaultState()
    }
    session = nil
    try await super.tearDown()
  }

  /// Clears every simulated error and puts the session's settings back:
  /// `resetToDefaultState()`, then the dialogs off and Ask to Buy off. Never
  /// `setSimulatedError(nil, forAPI: .purchase)`, which leaves every purchase the app makes
  /// failing (`StoreKitError.unknown`: the test server keeps the transaction and answers
  /// `cancel-purchase-batch` with an empty `failureType`) while `simulatedError(forAPI:
  /// .purchase)` reads nil. `resetToDefaultState()` clears that, and a real simulated error too
  /// (PR #41's probe, on the iOS 26.2 and 18.6 simulators, under Xcode 26.6 and 26.2).
  private func clearSimulatedErrors(_ session: SKTestSession) {
    session.resetToDefaultState()
    session.disableDialogs = true
    session.askToBuyEnabled = false
  }

  // MARK: - The product

  func testTheProductIsSnowStorekits() async throws {
    let purchase = try XCTUnwrap(purchase)
    let product = await purchase.platform.product(id)
    XCTAssertEqual(
      product, .ready(price: Constants.Purchase.displayPrice, familyShareable: true))
  }

  func testAnUnknownProductIsUnavailable() async throws {
    let platform = try XCTUnwrap(purchase).platform
    let known = await platform.product(id)
    XCTAssertEqual(
      known, .ready(price: Constants.Purchase.displayPrice, familyShareable: true),
      "Snow.storekit isn't in the test environment")
    let unknown = await platform.product("today.willitsnow.app.none")
    XCTAssertEqual(unknown, .unavailable)
  }

  // MARK: - Buying

  /// A product `product(_:)` never loaded fails in StoreKit's words, and never reads as the user
  /// cancelling, so a test that skipped the load can't pass as a cancel.
  func testBuyingBeforeTheProductLoadsFails() async throws {
    let session = try XCTUnwrap(session)
    let storeKit = StoreKitPurchases()
    let result = await storeKit.buy(id)
    guard case .failed(let text) = result else { return XCTFail("buy → \(result), not failed") }
    XCTAssertFalse(text.isEmpty)
    XCTAssertEqual(session.allTransactions().count, 0)
  }

  func testBuyUnlocksKeepsItAndFinishes() async throws {
    let session = try XCTUnwrap(session)
    let purchase = try XCTUnwrap(purchase)
    let model = purchase.model
    model.start()
    let atLaunch = await model.launchEntitlement()
    XCTAssertFalse(atLaunch)
    try await purchase.readyModel()

    await model.buy()

    XCTAssertTrue(model.owned)
    XCTAssertEqual(model.state.attempt, .idle)
    let kept = try XCTUnwrap(purchase.store.loadUnlock())
    XCTAssertTrue(kept.unlocked)
    XCTAssertEqual(kept.productID, id)
    XCTAssertEqual(purchase.widgets.reloads, 1)
    XCTAssertEqual(purchase.changes, [true])
    XCTAssertEqual(purchase.platform.answers("buy"), ["buy → completed"])
    let unfinished = await unfinishedTransactions()
    XCTAssertEqual(unfinished, [], "kept, then finished")
    XCTAssertEqual(session.allTransactions().count, 1)
  }

  /// Bought on another device, or in the App Store: only the updates listener can hear it, as
  /// the launch's check has already answered.
  func testAPurchaseElsewhereArrivesThroughUpdates() async throws {
    let session = try XCTUnwrap(session)
    let purchase = try XCTUnwrap(purchase)
    purchase.model.start()
    let atLaunch = await purchase.model.launchEntitlement()
    XCTAssertFalse(atLaunch)

    try await session.buyProduct(identifier: id)

    await eventually("owned", { purchase.model.owned }, is: true)
    XCTAssertEqual(purchase.store.loadUnlock()?.unlocked, true)
    XCTAssertEqual(purchase.widgets.reloads, 1)
    let calls = purchase.platform.calls
    XCTAssertTrue(calls.contains("heard → verified"), "\(calls)")
  }

  func testAskToBuyWaitsThenApproved() async throws {
    let session = try XCTUnwrap(session)
    let purchase = try XCTUnwrap(purchase)
    session.askToBuyEnabled = true
    purchase.model.start()
    try await purchase.readyModel()

    await purchase.model.buy()

    XCTAssertEqual(purchase.platform.answers("buy"), ["buy → pending"])
    XCTAssertEqual(purchase.model.state.attempt, .pending)
    XCTAssertFalse(purchase.model.owned)
    let asked = try XCTUnwrap(session.allTransactions().first { $0.pendingAskToBuyConfirmation })
    try session.approveAskToBuyTransaction(identifier: asked.identifier)
    await eventually("owned", { purchase.model.owned }, is: true)
    XCTAssertEqual(purchase.model.state.attempt, .idle)
    XCTAssertEqual(purchase.store.loadUnlock()?.unlocked, true)
  }

  /// A decline sends nothing, so the page keeps waiting, with Buy still there to ask again.
  func testAskToBuyDeclinedStaysLocked() async throws {
    let session = try XCTUnwrap(session)
    let purchase = try XCTUnwrap(purchase)
    session.askToBuyEnabled = true
    purchase.model.start()
    try await purchase.readyModel()
    await purchase.model.buy()
    XCTAssertEqual(purchase.model.state.attempt, .pending)
    let asked = try XCTUnwrap(session.allTransactions().first { $0.pendingAskToBuyConfirmation })

    try session.declineAskToBuyTransaction(identifier: asked.identifier)

    try await Task.sleep(for: .seconds(2))
    XCTAssertFalse(purchase.model.owned)
    XCTAssertNotEqual(purchase.store.loadUnlock()?.unlocked, true)
    XCTAssertEqual(purchase.model.state.attempt, .pending)
  }

  // MARK: - Refunds

  func testARefundLocksAgain() async throws {
    let session = try XCTUnwrap(session)
    let purchase = try XCTUnwrap(purchase)
    purchase.model.start()
    try await purchase.readyModel()
    await purchase.model.buy()
    XCTAssertTrue(purchase.model.owned)
    let bought = try XCTUnwrap(session.allTransactions().first)

    try session.refundTransaction(identifier: bought.identifier)

    await eventually("owned", { purchase.model.owned }, is: false)
    XCTAssertEqual(purchase.store.loadUnlock()?.unlocked, false)
    XCTAssertEqual(purchase.widgets.reloads, 2)
    XCTAssertEqual(purchase.changes, [true, false])
  }

  /// Refunded while the app was closed, so no listener heard it: the next launch reads StoreKit
  /// itself, and locks, whatever `unlock.v1` still says.
  func testARefundWhileClosedLocksAtLaunch() async throws {
    let session = try XCTUnwrap(session)
    let store: CountingUnlockStore
    weak var firstModel: PurchaseModel?
    weak var firstStoreKit: StoreKitPurchases?
    do {
      let first = try XCTUnwrap(purchase)
      store = first.store
      first.model.start()
      try await first.readyModel()
      await first.model.buy()
      XCTAssertTrue(first.model.owned)
      // The app closes.
      first.storeKit.stopListening()
      firstModel = first.model
      firstStoreKit = first.storeKit
    }
    purchase = nil
    // Not at once: an update the listener was still handling as the app closed (the purchase,
    // which `Transaction.updates` may also give) holds both until `hear` returns.
    await eventually("the first launch's model gone", { firstModel == nil }, is: true)
    await eventually(
      "the first launch's StoreKitPurchases gone", { firstStoreKit == nil }, is: true)
    let saves = store.saves
    let bought = try XCTUnwrap(session.allTransactions().first)

    try session.refundTransaction(identifier: bought.identifier)

    try await Task.sleep(for: .seconds(1))
    XCTAssertEqual(store.saves, saves, "something heard the refund while the app was closed")
    XCTAssertEqual(store.loadUnlock()?.unlocked, true)
    let second = StoreKitPurchase(store: store)
    relaunched = second
    XCTAssertTrue(second.model.owned, "unlock.v1 until the launch's check")
    let atLaunch = await second.model.launchEntitlement()
    XCTAssertFalse(atLaunch)
    XCTAssertGreaterThan(store.saves, saves, "the second launch never read StoreKit itself")
    XCTAssertEqual(store.loadUnlock()?.unlocked, false)
  }

  // MARK: - Restore purchase

  func testRestoreFindsAPurchase() async throws {
    let session = try XCTUnwrap(session)
    let purchase = try XCTUnwrap(purchase)
    // Bought elsewhere, with no listener: only Restore purchase can find it.
    try await session.buyProduct(identifier: id)
    try await purchase.readyModel()

    await purchase.model.restore()

    XCTAssertEqual(purchase.platform.answers("sync"), ["sync → synced"])
    XCTAssertEqual(purchase.model.state.restore, .restored)
    XCTAssertTrue(purchase.model.owned)
  }

  func testRestoreFindsNothing() async throws {
    let purchase = try XCTUnwrap(purchase)
    try await purchase.readyModel()

    await purchase.model.restore()

    // The environment answered: nothing found is no failure.
    XCTAssertEqual(purchase.platform.answers("sync"), ["sync → synced"])
    XCTAssertEqual(purchase.model.state.restore, .nothingFound)
    XCTAssertFalse(purchase.model.owned)
  }

  /// The user cancelling the sign-in shows nothing.
  func testRestoreCancelled() async throws {
    let session = try XCTUnwrap(session)
    let purchase = try XCTUnwrap(purchase)
    try await purchase.readyModel()
    try await session.setSimulatedError(.generic(.userCancelled), forAPI: .appStoreSync)

    await purchase.model.restore()

    XCTAssertEqual(purchase.platform.answers("sync"), ["sync → cancelled"])
    XCTAssertEqual(purchase.model.state.restore, .idle)
  }

  func testRestoreFailsWithStoreKitsWords() async throws {
    let session = try XCTUnwrap(session)
    let purchase = try XCTUnwrap(purchase)
    try await purchase.readyModel()
    try await session.setSimulatedError(
      .generic(.networkError(URLError(.notConnectedToInternet))), forAPI: .appStoreSync)

    await purchase.model.restore()

    XCTAssertEqual(purchase.platform.answers("sync"), ["sync → failed"])
    guard case .failed(let text) = purchase.model.state.restore else {
      return XCTFail("restore \(purchase.model.state.restore), not failed")
    }
    XCTAssertFalse(text.isEmpty)
  }

  // MARK: - What a purchase can come to

  /// The App Store took the payment, but StoreKit's check of the purchase failed: no unlock, and
  /// not finished (spec 13), so StoreKit gives it again; the page says StoreKit's words.
  func testAnUnverifiedPurchaseDoesntUnlock() async throws {
    let session = try XCTUnwrap(session)
    let purchase = try XCTUnwrap(purchase)
    try await purchase.readyModel()
    try await session.setSimulatedError(.verification(.invalidSignature), forAPI: .verification)

    await purchase.model.buy()

    XCTAssertEqual(purchase.platform.answers("buy"), ["buy → completed"])
    guard case .completed(let fact)? = purchase.platform.lastBuy else {
      return XCTFail("buy → \(String(describing: purchase.platform.lastBuy))")
    }
    XCTAssertFalse(fact.verified)
    XCTAssertFalse(fact.verificationFailure?.isEmpty ?? true)
    guard case .failed(let text) = purchase.model.state.attempt else {
      return XCTFail("attempt \(purchase.model.state.attempt), not failed")
    }
    XCTAssertFalse(text.isEmpty)
    XCTAssertFalse(purchase.model.owned)
    XCTAssertNotEqual(purchase.store.loadUnlock()?.unlocked, true)
    let unfinished = await unfinishedTransactions()
    XCTAssertEqual(unfinished.count, 1)
  }

  func testAFailedPurchaseSaysStoreKitsWords() async throws {
    let session = try XCTUnwrap(session)
    let purchase = try XCTUnwrap(purchase)
    try await purchase.readyModel()
    try await session.setSimulatedError(.purchase(.productUnavailable), forAPI: .purchase)

    await purchase.model.buy()

    XCTAssertEqual(purchase.platform.answers("buy"), ["buy → failed"])
    guard case .failed(let text) = purchase.model.state.attempt else {
      return XCTFail("attempt \(purchase.model.state.attempt), not failed")
    }
    XCTAssertFalse(text.isEmpty)
    XCTAssertFalse(purchase.model.owned)
  }

  /// StoreKit was asked, with the product ready, so the attempt went through `.buying` and came
  /// back: a cancel changes nothing the app keeps (10.5), so no `unlock.v1`, no widget reload and
  /// nothing told the app. StoreKit Test's own transactions aren't checked: it keeps one for a
  /// purchase whose answer it replaces with a simulated error (PR #41's probe, and PR #40's run
  /// with that fixed), which a real cancel never makes. Then, the simulated cancel cleared, the
  /// same model buys, so a test environment whose `purchase` answers `.userCancelled` to
  /// everything (the broken simulator runtimes' symptom, which a loaded product doesn't rule out)
  /// fails here.
  func testACancelledPurchaseChangesNothing() async throws {
    let session = try XCTUnwrap(session)
    let purchase = try XCTUnwrap(purchase)
    try await purchase.readyModel()
    try await session.setSimulatedError(.generic(.userCancelled), forAPI: .purchase)

    await purchase.model.buy()

    XCTAssertEqual(purchase.platform.answers("buy"), ["buy → cancelled"])
    XCTAssertEqual(purchase.model.state.attempt, .idle)
    XCTAssertFalse(purchase.model.owned)
    XCTAssertEqual(purchase.store.saves, 0, "a cancel wrote unlock.v1")
    XCTAssertEqual(purchase.widgets.reloads, 0, "a cancel reloaded the widgets")
    XCTAssertEqual(purchase.changes, [], "a cancel told the app the purchase changed")
    clearSimulatedErrors(session)
    await purchase.model.buy()
    XCTAssertEqual(
      purchase.platform.answers("buy"), ["buy → cancelled", "buy → completed"],
      "StoreKit Test cancelled the purchase with no simulated error")
    XCTAssertTrue(purchase.model.owned)
  }

  // MARK: - unlock.v1

  /// The App Group's own `unlock.v1`, which the widget reads (phase 7.2), put back afterwards as
  /// it was. Cleared first: one left saying unlocked (a Cmd-R purchase on this simulator, or a
  /// run stopped before it was put back) would start the model owned, and Buy would then ask
  /// StoreKit nothing.
  func testTheUnlockIsInTheAppGroup() async throws {
    let group = try XCTUnwrap(SharedStore.appGroupID())
    let shared = try XCTUnwrap(SharedStore.open(appGroup: group, fallback: false))
    let before = shared.defaults.object(forKey: Keys.AppGroup.unlock)
    defer {
      if let before {
        shared.defaults.set(before, forKey: Keys.AppGroup.unlock)
      } else {
        shared.defaults.removeObject(forKey: Keys.AppGroup.unlock)
      }
    }
    shared.defaults.removeObject(forKey: Keys.AppGroup.unlock)
    let purchase = StoreKitPurchase(store: CountingUnlockStore(shared))
    self.purchase = purchase
    XCTAssertFalse(purchase.model.owned, "unlock.v1 still says unlocked")
    try await purchase.readyModel()

    await purchase.model.buy()

    XCTAssertEqual(purchase.platform.answers("buy"), ["buy → completed"])
    XCTAssertTrue(purchase.model.owned)
    XCTAssertTrue(shared.loadUnlocked())
    XCTAssertEqual(shared.loadUnlock()?.productID, id)
  }

  /// The transactions StoreKit holds unfinished, by ID.
  private func unfinishedTransactions() async -> [UInt64] {
    var ids: [UInt64] = []
    for await result in StoreKit.Transaction.unfinished {
      ids.append(result.unsafePayloadValue.id)
    }
    return ids
  }
}
