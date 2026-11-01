import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItTestSupport
import Testing

// The one-off purchase (phase 7.1; spec sections 13, 10.4 and 10.5), with a fake StoreKit whose
// calls are held and answered one by one. Each suite has a minute's limit, so a held call never
// released fails there, not at the Linux job's limit, which every macOS job waits for.

/// The product the app sells.
private let id = PurchaseHarness.id

@MainActor
@Suite("The purchase at launch", .timeLimit(.minutes(1)))
struct PurchaseLaunchTests {
  @Test("start listens to the updates before it checks the entitlements, then asks for the product")
  func startListensBeforeItChecks() async {
    let h = PurchaseHarness()
    h.model.start()
    #expect(await yieldUntil { h.platform.calls.count == 3 })
    #expect(h.platform.calls == ["listen", "entitlements", "product"])
  }

  @Test("a second start does nothing")
  func startOnce() async {
    let h = PurchaseHarness()
    h.model.start()
    h.model.start()
    await h.started()
    #expect(h.platform.calls.filter { $0 == "listen" }.count == 1)
    #expect(h.platform.made(.entitlements) == 1)
    #expect(h.platform.made(.product) == 1)
  }

  @Test("nothing at launch asks the user to sign in (17.4.1)")
  func nothingAtLaunchAsksToSignIn() async {
    let h = PurchaseHarness()
    h.model.start()
    _ = await h.model.launchEntitlement()
    await h.model.loadProduct()
    #expect(!h.platform.calls.contains("sync"))
    #expect(h.platform.made(.sync) == 0)
  }

  @Test("until the launch's check, owned is what unlock.v1 says, and StoreKit isn't asked")
  func initialAnswerIsTheFlag() {
    let bought = PurchaseHarness(stored: true)
    #expect(bought.model.owned)
    let free = PurchaseHarness(stored: false)
    #expect(!free.model.owned)
    let none = PurchaseHarness()
    #expect(!none.model.owned)
    for h in [bought, free, none] {
      #expect(h.platform.calls.isEmpty)
      #expect(h.model.state == PurchaseState())
      #expect(h.log.all.isEmpty)
    }
  }

  @Test("owned at the check: unlock.v1 written, the widgets reloaded, the app told")
  func launchCheckOwnedWritesReloadsAndTells() async {
    let h = PurchaseHarness()
    h.platform.entitlementAnswers = [[fact(id: 7)]]
    #expect(await h.model.launchEntitlement())
    #expect(h.model.owned)
    #expect(h.store.saved == StoredUnlock(unlocked: true, checkedAt: h.clock.now, productID: id))
    #expect(h.log.count("reload") == 1)
    #expect(h.changes == [true])
  }

  @Test("the check agreeing with unlock.v1 writes its time again, and reloads nothing")
  func launchCheckAgreeingRewritesWithoutReloading() async {
    let h = PurchaseHarness(stored: true)
    #expect(h.store.saved?.checkedAt != h.clock.now)
    h.platform.entitlementAnswers = [[fact(id: 7)]]
    #expect(await h.model.launchEntitlement())
    #expect(h.store.saved == StoredUnlock(unlocked: true, checkedAt: h.clock.now, productID: id))
    #expect(h.saves == 1)
    #expect(h.log.count("reload") == 0)
    #expect(h.changes.isEmpty)
  }

  @Test("refunded while the app was closed: the check locks it")
  func launchCheckLocksARefundMadeWhileClosed() async {
    let h = PurchaseHarness(stored: true)
    h.platform.entitlementAnswers = [[]]
    #expect(await h.model.launchEntitlement() == false)
    #expect(!h.model.owned)
    #expect(h.store.saved?.unlocked == false)
    #expect(h.log.count("reload") == 1)
    #expect(h.changes == [false])
  }

  @Test("the check ignores what doesn't own it: unverified, revoked, another product's")
  func launchCheckIgnoresWhatDoesntOwnIt() async {
    let others = [
      fact(id: 7, verified: false), fact(id: 7, revoked: true),
      fact(id: 7, product: "today.willitsnow.app.other"),
    ]
    for other in others {
      let h = PurchaseHarness()
      h.platform.entitlementAnswers = [[other]]
      #expect(await h.model.launchEntitlement() == false, "\(other)")
      #expect(h.store.saved?.unlocked == false, "\(other)")
      #expect(h.log.count("reload") == 0, "\(other)")
      #expect(h.changes.isEmpty, "\(other)")
    }
  }

  @Test("shared through Family Sharing, it is owned")
  func familySharedOwns() async {
    let h = PurchaseHarness()
    h.platform.entitlementAnswers = [[fact(id: 2, family: true)]]
    #expect(await h.model.launchEntitlement())
    #expect(h.changes == [true])
  }

  @Test("launch step 5 starts the listener and the check if step 2 hasn't")
  func launchEntitlementStartsIfNeeded() async {
    let h = PurchaseHarness()
    #expect(await h.model.launchEntitlement() == false)
    #expect(Array(h.platform.calls.prefix(2)) == ["listen", "entitlements"])
  }

  @Test("a purchase made while the check is out wins, though the check answers last")
  func aPurchaseDuringTheCheckWins() async {
    let h = PurchaseHarness()
    h.platform.entitlementAnswers = [[], [fact(id: 7)]]
    h.platform.buyAnswers = [.completed(fact(id: 7))]
    h.platform.hold(.entitlements, number: 1)
    h.model.start()
    #expect(
      await yieldUntil {
        h.platform.made(.entitlements) == 1 && h.model.state.product == PurchaseHarness.ready
      })
    // Its read is the second, kept: it never waits for the first, which it dropped.
    await h.model.buy()
    #expect(h.model.owned)
    #expect(h.platform.made(.entitlements) == 2)
    #expect(h.platform.answered(.entitlements) == 1)
    h.platform.release(.entitlements, number: 1)
    #expect(await h.model.launchEntitlement())
    #expect(h.model.owned)
    #expect(h.store.saved?.unlocked == true)
    #expect(h.changes == [true])
    #expect(h.saves == 1)
  }

  @Test("the check waits for a newer answer, and nothing is finished before it is kept")
  func theCheckWaitsForTheNewerAnswer() async {
    // An unfinished transaction arrives through the listener just after the launch (Apple,
    // `Transaction.updates`), and its read outlasts the check's.
    let h = PurchaseHarness(stored: false)
    h.platform.entitlementAnswers = [[], [fact(id: 9)]]
    h.platform.hold(.entitlements, number: 1)
    h.platform.hold(.entitlements, number: 2)
    h.model.start()
    #expect(await yieldUntil { h.platform.made(.entitlements) == 1 })
    h.platform.tell(fact(id: 9))
    #expect(
      await yieldUntil { h.platform.made(.entitlements) == 2 && h.platform.made(.product) == 1 })
    let answer = Locked<Bool?>(nil)
    let launch = Task {
      let owned = await h.model.launchEntitlement()
      answer.change { $0 = owned }
    }
    h.platform.release(.entitlements, number: 1)
    #expect(await yieldUntil { h.platform.answered(.entitlements) == 1 })
    await settle()
    // The check's read was dropped; its caller waits for the newer one.
    #expect(answer.read { $0 } == nil)
    #expect(h.saves == 0)
    #expect(!h.log.all.contains("finish 9"))
    let mark = h.log.mark
    h.platform.release(.entitlements, number: 2)
    await launch.value
    #expect(answer.read { $0 } == true)
    #expect(await yieldUntil { h.log.all.contains("finish 9") })
    #expect(h.log.since(mark) == ["save true", "reload", "finish 9"])
  }

  @Test("an update heard while the check is out never starts the ads (with AppModel)")
  func anUpdateHeardDuringTheCheckNeverStartsTheAds() async throws {
    let p = PurchaseHarness(stored: false)
    p.platform.entitlementAnswers = [[], [fact(id: 9)]]
    p.platform.hold(.entitlements, number: 1)
    p.platform.hold(.entitlements, number: 2)
    let h = Harness(
      now: try fixtureNow("aberdeen-snow"),
      store: .init(place: aberdeen, units: .c),
      replies: [try FakeTransport.fixture("aberdeen-snow")],
      appHooks: PurchaseHooks(purchases: p.model, log: p.log)
    )
    p.model.changed = { [weak model = h.model] owned in await model?.purchaseChanged(owned: owned) }
    let launch = Task { await h.model.launch() }
    #expect(await yieldUntil { p.platform.made(.entitlements) == 1 })
    p.platform.tell(fact(id: 9))
    #expect(await yieldUntil { p.platform.made(.entitlements) == 2 })
    p.platform.release(.entitlements, number: 1)
    await settle()
    p.platform.release(.entitlements, number: 2)
    await launch.value
    #expect(h.model.unlocked)
    #expect(!p.log.all.contains("startAds"))
    #expect(await yieldUntil { p.log.all.contains("finish 9") })
    let saved = try #require(p.log.all.firstIndex(of: "save true"))
    let finished = try #require(p.log.all.firstIndex(of: "finish 9"))
    #expect(saved < finished)
  }
}

@MainActor
@Suite("The purchase's product", .timeLimit(.minutes(1)))
struct PurchaseProductTests {
  @Test("asked for at the start: loading, then StoreKit's price and Family Sharing")
  func productAskedForAtStart() async {
    let h = PurchaseHarness()
    #expect(h.model.state.product == .loading)
    await h.started()
    #expect(h.model.state.product == .ready(price: "£1.99", familyShareable: true))
    #expect(h.platform.made(.product) == 1)
  }

  @Test("none for sale: asked for again, as Settings or the page appears")
  func productAgainAfterUnavailable() async {
    let h = PurchaseHarness()
    h.platform.productAnswers = [.unavailable, PurchaseHarness.ready]
    await h.started()
    #expect(h.model.state.product == .unavailable)
    await h.model.loadProduct()
    #expect(h.model.state.product == PurchaseHarness.ready)
    #expect(h.platform.made(.product) == 2)
  }

  @Test("once it is for sale, it isn't asked for again")
  func productNotAskedForAgainWhenReady() async {
    let h = PurchaseHarness()
    await h.started()
    await h.model.loadProduct()
    await h.model.loadProduct()
    #expect(h.platform.made(.product) == 1)
  }

  @Test("a load under way is waited for, not made again")
  func aLoadUnderWayIsWaitedFor() async {
    let h = PurchaseHarness()
    h.platform.hold(.product, number: 1)
    let first = Task {
      await h.model.loadProduct()
      return h.model.state.product
    }
    let second = Task {
      await h.model.loadProduct()
      return h.model.state.product
    }
    #expect(await yieldUntil { h.platform.made(.product) == 1 })
    let returned = Locked(0)
    let watch = Task {
      _ = await first.value
      _ = await second.value
      returned.change { $0 += 1 }
    }
    await settle()
    #expect(returned.read { $0 } == 0)
    #expect(h.platform.made(.product) == 1)
    #expect(h.model.state.product == .loading)
    h.platform.release(.product, number: 1)
    #expect(await first.value == PurchaseHarness.ready)
    #expect(await second.value == PurchaseHarness.ready)
    await watch.value
    #expect(h.platform.made(.product) == 1)
  }

  @Test("payments turned off on the phone: blocked, and blocked again when asked again")
  func blocked() async {
    let h = PurchaseHarness()
    h.platform.productAnswers = [.blocked]
    await h.started()
    #expect(h.model.state.product == .blocked)
    await h.model.loadProduct()
    #expect(h.model.state.product == .blocked)
  }

  @Test("becoming active asks again until it is for sale, then asks nothing")
  func becomingActiveAsksAgain() async {
    let h = PurchaseHarness()
    h.platform.productAnswers = [.unavailable, PurchaseHarness.ready]
    await h.started()
    #expect(h.model.state.product == .unavailable)
    await h.model.becameActive()
    #expect(h.model.state.product == PurchaseHarness.ready)
    await h.model.becameActive()
    #expect(h.platform.made(.product) == 2)
    #expect(h.platform.made(.entitlements) == 1)
  }

  @Test("becoming active before the start asks StoreKit nothing")
  func becomingActiveBeforeStartDoesNothing() async {
    let h = PurchaseHarness()
    await h.model.becameActive()
    await settle()
    #expect(h.platform.calls.isEmpty)
    #expect(h.model.state == PurchaseState())
  }
}

@MainActor
@Suite("Buying", .timeLimit(.minutes(1)))
struct PurchaseBuyTests {
  @Test("a purchase unlocks, is kept, and only then finished")
  func buyUnlocksKeepsItThenFinishes() async {
    let h = PurchaseHarness()
    h.platform.entitlementAnswers = [[], [fact(id: 7)]]
    h.platform.buyAnswers = [.completed(fact(id: 7))]
    await h.started()
    let mark = h.log.mark
    await h.model.buy()
    #expect(h.log.since(mark) == ["buy", "entitlements", "save true", "reload", "finish 7"])
    #expect(h.model.owned)
    #expect(h.model.state.attempt == .idle)
    #expect(h.changes == [true])
  }

  @Test("a purchase StoreKit couldn't verify says why, and neither unlocks nor is finished")
  func buyUnverifiedSaysWhyAndNeitherUnlocksNorFinishes() async {
    let h = PurchaseHarness()
    let silent = PurchaseFact(
      transactionID: 8, productID: id, verificationFailure: "", revoked: false,
      familyShared: false)
    h.platform.buyAnswers = [
      .completed(fact(id: 7, verified: false)), .pending, .completed(silent),
    ]
    await h.started()
    let mark = h.log.mark
    await h.model.buy()
    #expect(!h.model.owned)
    #expect(h.model.state.attempt == .failed("Unverified."))
    // With no words of StoreKit's, the line before stays.
    await h.model.buy()
    #expect(h.model.state.attempt == .pending)
    await h.model.buy()
    #expect(h.model.state.attempt == .pending)
    #expect(!h.model.owned)
    #expect(h.log.since(mark) == ["buy", "buy", "buy"])
    #expect(h.changes.isEmpty)
  }

  @Test("a revoked transaction from a buy doesn't unlock")
  func buyRevokedFactDoesntUnlock() async {
    let h = PurchaseHarness()
    h.platform.buyAnswers = [.completed(fact(id: 7, revoked: true))]
    await h.started()
    let mark = h.log.mark
    await h.model.buy()
    #expect(!h.model.owned)
    #expect(h.model.state.attempt == .idle)
    #expect(h.log.since(mark) == ["buy"])
  }

  @Test("Ask to Buy: waiting for approval, nothing kept")
  func buyPending() async {
    let h = PurchaseHarness()
    h.platform.buyAnswers = [.pending]
    await h.started()
    let mark = h.log.mark
    await h.model.buy()
    #expect(h.model.state.attempt == .pending)
    #expect(!h.model.owned)
    #expect(h.log.since(mark) == ["buy"])
  }

  @Test("cancelled: nothing changes")
  func buyCancelledChangesNothing() async {
    let h = PurchaseHarness()
    h.platform.buyAnswers = [.cancelled, .pending, .cancelled]
    await h.started()
    await h.model.buy()
    #expect(h.model.state.attempt == .idle)
    await h.model.buy()
    #expect(h.model.state.attempt == .pending)
    await h.model.buy()
    #expect(h.model.state.attempt == .pending)
    #expect(!h.model.owned)
  }

  @Test("a failure says StoreKit's own words; with none, the line before stays")
  func buyFailedSaysStoreKitsWords() async {
    let h = PurchaseHarness()
    h.platform.buyAnswers = [.failed("Cannot connect"), .pending, .failed("")]
    await h.started()
    await h.model.buy()
    #expect(h.model.state.attempt == .failed("Cannot connect"))
    await h.model.buy()
    #expect(h.model.state.attempt == .pending)
    await h.model.buy()
    #expect(h.model.state.attempt == .pending)
  }

  @Test("two taps on Buy ask StoreKit once")
  func buyingTwiceAsksOnce() async {
    let h = PurchaseHarness()
    h.platform.hold(.buy, number: 1)
    await h.started()
    let first = Task { await h.model.buy() }
    #expect(await yieldUntil { h.platform.made(.buy) == 1 })
    #expect(h.model.state.attempt == .buying)
    await h.model.buy()
    #expect(h.platform.made(.buy) == 1)
    #expect(h.model.state.attempt == .buying)
    h.platform.release(.buy, number: 1)
    await first.value
    #expect(h.model.state.attempt == .idle)
    #expect(h.platform.made(.buy) == 1)
  }

  @Test("nothing to buy until StoreKit has a product for sale")
  func buyNeedsAProduct() async {
    let none = PurchaseHarness()
    none.platform.productAnswers = [.unavailable]
    await none.started()
    await none.model.buy()
    #expect(none.platform.made(.buy) == 0)

    let loading = PurchaseHarness()
    loading.platform.hold(.product, number: 1)
    loading.model.start()
    #expect(await yieldUntil { loading.platform.made(.product) == 1 })
    #expect(loading.model.state.product == .loading)
    await loading.model.buy()
    #expect(loading.platform.made(.buy) == 0)
    #expect(loading.model.state.attempt == .idle)
    loading.platform.release(.product, number: 1)
    await loading.model.loadProduct()
  }

  @Test("owned: nothing to buy")
  func buyWhenOwnedAsksNothing() async {
    let h = PurchaseHarness()
    h.platform.entitlementAnswers = [[fact(id: 7)]]
    await h.started()
    #expect(h.model.owned)
    await h.model.buy()
    #expect(h.platform.made(.buy) == 0)
  }
}

@MainActor
@Suite("The purchase's updates", .timeLimit(.minutes(1)))
struct PurchaseUpdateTests {
  @Test("an Ask to Buy approval unlocks, ends the wait, and is finished once kept")
  func approvalUnlocksAndEndsThePending() async {
    let h = PurchaseHarness()
    h.platform.entitlementAnswers = [[], [fact(id: 9)]]
    h.platform.buyAnswers = [.pending]
    await h.started()
    await h.model.buy()
    #expect(h.model.state.attempt == .pending)
    let mark = h.log.mark
    await h.platform.tell(fact(id: 9)).value
    #expect(h.model.owned)
    #expect(h.model.state.attempt == .idle)
    #expect(h.log.since(mark) == ["entitlements", "save true", "reload", "finish 9"])
  }

  @Test("a refund locks at once, before the entitlements catch up")
  func refundLocksEvenBeforeTheEntitlementsCatchUp() async {
    let h = PurchaseHarness(stored: true)
    h.platform.entitlementAnswers = [[fact(id: 7)]]
    await h.started()
    #expect(h.model.owned)
    let mark = h.log.mark
    await h.platform.tell(fact(id: 7, revoked: true)).value
    #expect(!h.model.owned)
    #expect(h.store.saved?.unlocked == false)
    #expect(h.log.since(mark) == ["entitlements", "save false", "reload", "finish 7"])
    #expect(h.changes == [false])
  }

  @Test("a revocation heard during a restore stands, whichever read answers last")
  func aRevocationHeardDuringARestoreStands() async {
    // The restore's read held, the update's newer and kept.
    let first = PurchaseHarness(stored: true)
    first.platform.entitlementAnswers = [[fact(id: 7)]]
    first.platform.hold(.entitlements, number: 2)
    await first.started()
    #expect(first.model.owned)
    let restore = Task { await first.model.restore() }
    #expect(await yieldUntil { first.platform.made(.entitlements) == 2 })
    await first.platform.tell(fact(id: 7, revoked: true)).value
    #expect(!first.model.owned)
    first.platform.release(.entitlements, number: 2)
    await restore.value
    #expect(!first.model.owned)
    #expect(first.model.state.restore == .nothingFound)
    #expect(first.changes == [false])

    // The update's read held, the restore's newer and kept.
    let second = PurchaseHarness(stored: true)
    second.platform.entitlementAnswers = [[fact(id: 7)]]
    second.platform.hold(.entitlements, number: 2)
    await second.started()
    let update = second.platform.tell(fact(id: 7, revoked: true))
    #expect(await yieldUntil { second.platform.made(.entitlements) == 2 })
    await second.model.restore()
    #expect(!second.model.owned)
    #expect(second.model.state.restore == .nothingFound)
    second.platform.release(.entitlements, number: 2)
    await update.value
    #expect(!second.model.owned)
    #expect(second.log.all.contains("finish 7"))
    // Kept in every answer while the entitlements still show it unrevoked.
    await second.model.restore()
    #expect(!second.model.owned)
    #expect(second.changes == [false])
  }

  @Test("a purchase heard outlives a read that lags behind it, until a read shows it")
  func aHeardPurchaseOutlivesALaggingRead() async {
    let h = PurchaseHarness()
    h.platform.entitlementAnswers = [[], [], [], [fact(id: 9)], []]
    await h.started()
    await h.platform.tell(fact(id: 9)).value
    #expect(h.model.owned)
    await h.model.restore()
    #expect(h.model.owned)
    #expect(h.model.state.restore == .restored)
    // Becoming active reads again while the update is ahead; this read shows it.
    await h.model.becameActive()
    #expect(h.platform.made(.entitlements) == 4)
    #expect(h.model.owned)
    await h.model.becameActive()
    #expect(h.platform.made(.entitlements) == 4)
    // Nothing kept now: a read without it locks.
    await h.model.restore()
    #expect(!h.model.owned)
    #expect(h.changes == [true, false])
  }

  @Test("taken back from Family Sharing: locked at once")
  func familyRemovalLocksAtOnce() async {
    let h = PurchaseHarness(stored: true)
    h.platform.entitlementAnswers = [[fact(id: 2, family: true)]]
    await h.started()
    #expect(h.model.owned)
    let mark = h.log.mark
    await h.platform.tell(fact(id: 2, revoked: true, family: true)).value
    #expect(!h.model.owned)
    #expect(h.store.saved?.unlocked == false)
    #expect(h.log.since(mark) == ["entitlements", "save false", "reload", "finish 2"])
    #expect(h.changes == [false])
  }

  @Test("taken back from Family Sharing while your own purchase is listed: still owned")
  func familyRemovalWhileYourOwnPurchaseIsListedKeepsIt() async {
    let h = PurchaseHarness(stored: true)
    h.platform.entitlementAnswers = [[fact(id: 1)]]
    await h.started()
    let mark = h.log.mark
    await h.platform.tell(fact(id: 2, revoked: true, family: true)).value
    #expect(h.model.owned)
    #expect(h.log.since(mark) == ["entitlements", "save true", "finish 2"])
    #expect(h.changes.isEmpty)
  }

  @Test("a family removal ahead of the entitlements gives way once they show your purchase")
  func familyRemovalAheadOfTheEntitlementsComesBackOnceTheyCatchUp() async {
    let h = PurchaseHarness(stored: true)
    h.platform.entitlementAnswers = [
      [fact(id: 2, family: true)], [fact(id: 2, family: true)], [fact(id: 1)],
    ]
    await h.started()
    #expect(h.model.owned)
    await h.platform.tell(fact(id: 2, revoked: true, family: true)).value
    #expect(!h.model.owned)
    #expect(h.changes == [false])
    await h.model.becameActive()
    #expect(h.model.owned)
    #expect(h.changes == [false, true])
    #expect(h.platform.made(.entitlements) == 3)
    await h.model.becameActive()
    #expect(h.platform.made(.entitlements) == 3)
  }

  @Test("another product's update is finished, and nothing more")
  func updateForAnotherProductIsFinishedOnly() async {
    let h = PurchaseHarness()
    await h.started()
    let mark = h.log.mark
    await h.platform.tell(fact(id: 5, product: "today.willitsnow.app.other")).value
    await h.platform.tell(fact(id: 6, verified: false, product: "today.willitsnow.app.other"))
      .value
    #expect(h.log.since(mark) == ["finish 5"])
  }

  @Test("an update StoreKit couldn't verify is neither kept nor finished")
  func unverifiedUpdateIsIgnored() async {
    let h = PurchaseHarness()
    await h.started()
    let mark = h.log.mark
    await h.platform.tell(fact(id: 5, verified: false)).value
    await settle()
    #expect(h.log.since(mark).isEmpty)
    #expect(!h.model.owned)
  }
}

@MainActor
@Suite("Restore purchase", .timeLimit(.minutes(1)))
struct PurchaseRestoreTests {
  @Test("found: restored, owned, kept and told; the sync before the entitlements")
  func restoreFindsIt() async {
    let h = PurchaseHarness()
    h.platform.entitlementAnswers = [[], [fact(id: 7)]]
    await h.started()
    let mark = h.log.mark
    await h.model.restore()
    #expect(h.model.state.restore == .restored)
    #expect(h.model.owned)
    #expect(h.log.since(mark) == ["sync", "entitlements", "save true", "reload"])
    #expect(h.changes == [true])
  }

  @Test("nothing found for this Apple Account")
  func restoreFindsNothing() async {
    let h = PurchaseHarness()
    await h.started()
    await h.model.restore()
    #expect(h.model.state.restore == .nothingFound)
    #expect(!h.model.owned)
  }

  @Test("only a purchase StoreKit couldn't verify: StoreKit's words, not none found")
  func restoreWithOnlyAnUnverifiedEntitlementSaysWhy() async {
    let h = PurchaseHarness()
    h.platform.entitlementAnswers = [[], [fact(id: 7, verified: false)]]
    await h.started()
    await h.model.restore()
    #expect(h.model.state.restore == .failed("Unverified."))
    #expect(!h.model.owned)
  }

  @Test("the sign-in cancelled: nothing said, and the entitlements read anyway")
  func restoreCancelled() async {
    let h = PurchaseHarness()
    h.platform.syncAnswers = [.cancelled]
    await h.started()
    await h.model.restore()
    #expect(h.model.state.restore == .idle)
    #expect(h.platform.made(.entitlements) == 2)
  }

  @Test("a failure says StoreKit's own words, and the entitlements are read anyway")
  func restoreFailedSaysStoreKitsWords() async {
    let h = PurchaseHarness()
    h.platform.syncAnswers = [.failed("x"), .failed("")]
    h.platform.entitlementAnswers = [[], [fact(id: 7)], []]
    await h.started()
    let mark = h.log.mark
    await h.model.restore()
    #expect(h.model.state.restore == .failed("x"))
    #expect(Array(h.log.since(mark).prefix(2)) == ["sync", "entitlements"])
    #expect(h.model.owned)
    await h.model.restore()
    #expect(h.model.state.restore == .idle)
  }

  @Test("two taps on Restore purchase ask StoreKit once")
  func restoringTwiceAsksOnce() async {
    let h = PurchaseHarness()
    h.platform.hold(.sync, number: 1)
    await h.started()
    let first = Task { await h.model.restore() }
    #expect(await yieldUntil { h.platform.made(.sync) == 1 })
    #expect(h.model.state.restore == .restoring)
    await h.model.restore()
    #expect(h.platform.made(.sync) == 1)
    #expect(h.model.state.restore == .restoring)
    h.platform.release(.sync, number: 1)
    await first.value
    #expect(h.model.state.restore == .nothingFound)
  }

  @Test("restored while Ask to Buy waits: the wait ends")
  func restoreEndsAPendingBuy() async {
    let h = PurchaseHarness()
    h.platform.entitlementAnswers = [[], [fact(id: 7)]]
    h.platform.buyAnswers = [.pending]
    await h.started()
    await h.model.buy()
    #expect(h.model.state.attempt == .pending)
    await h.model.restore()
    #expect(h.model.state.attempt == .idle)
    #expect(h.model.state.restore == .restored)
  }
}

@MainActor
@Suite("The purchase's links and lines", .timeLimit(.minutes(1)))
struct PurchaseRestTests {
  @Test("each link asks for the upgrade page, and asks StoreKit nothing")
  func linksAskForTheSheet() {
    let h = PurchaseHarness()
    #expect(h.model.sheetRequests == 0)
    h.model.requestSheet()
    h.model.requestSheet()
    #expect(h.model.sheetRequests == 2)
    #expect(h.platform.calls.isEmpty)
  }

  @Test("closing the page clears a failure and the restore result; what is under way stays")
  func dismissKeepsOnlyWhatIsStillUnderWay() async {
    let h = PurchaseHarness()
    h.platform.buyAnswers = [.failed("x"), .pending]
    h.platform.syncAnswers = [.synced, .failed("y")]
    h.platform.hold(.sync, number: 3)
    await h.started()
    await h.model.buy()
    await h.model.restore()
    #expect(h.model.state.attempt == .failed("x"))
    #expect(h.model.state.restore == .nothingFound)
    h.model.dismissResults()
    #expect(h.model.state == PurchaseState(product: PurchaseHarness.ready))
    await h.model.buy()
    await h.model.restore()
    #expect(h.model.state.restore == .failed("y"))
    h.model.dismissResults()
    #expect(h.model.state.attempt == .pending)
    #expect(h.model.state.restore == .idle)
    let restoring = Task { await h.model.restore() }
    #expect(await yieldUntil { h.model.state.restore == .restoring })
    h.model.dismissResults()
    #expect(h.model.state.restore == .restoring)
    #expect(h.model.state.attempt == .pending)
    h.platform.release(.sync, number: 3)
    await restoring.value
  }

  @Test("unlock.v1 in memory keeps what it was given")
  func memoryUnlockStoreKeepsWhatItWasGiven() {
    let empty = MemoryUnlockStore()
    #expect(empty.loadUnlock() == nil)
    let unlock = StoredUnlock(unlocked: true, checkedAt: PurchaseHarness.moment, productID: id)
    empty.saveUnlock(unlock)
    #expect(empty.loadUnlock() == unlock)
    let locked = StoredUnlock(unlocked: false, checkedAt: PurchaseHarness.moment, productID: id)
    empty.saveUnlock(locked)
    #expect(empty.loadUnlock() == locked)
    #expect(MemoryUnlockStore(unlock).loadUnlock() == unlock)
  }
}
