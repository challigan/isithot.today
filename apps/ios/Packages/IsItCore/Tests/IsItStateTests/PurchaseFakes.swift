import Foundation
import IsItLogic
import IsItModel
import IsItState
import Testing

/// What the purchase's fakes did, in one order across them: the platform's calls ("buy",
/// "finish 7"), `unlock.v1`'s saves ("save true") and the widgets' reloads ("reload"), and
/// `PurchaseHooks`' steps ("startAds"), so a test can say what came before what.
final class Log: Sendable {
  private let entries = Locked<[String]>([])

  /// Everything noted, in order.
  var all: [String] { entries.read { $0 } }
  /// How many entries there are now: a mark for `since(_:)`.
  var mark: Int { entries.read(\.count) }

  func note(_ entry: String) {
    entries.change { $0.append(entry) }
  }

  /// The entries noted after `mark`.
  func since(_ mark: Int) -> [String] { Array(all.dropFirst(mark)) }

  /// How many entries are `entry`.
  func count(_ entry: String) -> Int { all.filter { $0 == entry }.count }
}

/// StoreKit as the tests have it answer, on the main actor, noting each call in the log. Each
/// call takes its own answer by its number as it is made, the last one repeating once the others
/// are used up; a call held (`hold(_:number:)`, before it is made) waits until the test releases
/// that one call, and no other, as `GatedTransport`'s first answer does.
@MainActor
final class FakePurchasePlatform: PurchasePlatform {
  /// The calls a test can hold and count.
  enum Call: Hashable {
    case entitlements
    case product
    case buy
    case sync
  }

  /// One call: the `number`th of its kind, from 1.
  private struct Numbered: Hashable {
    let call: Call
    let number: Int
  }

  /// What each read of the entitlements answers, in turn.
  var entitlementAnswers: [[PurchaseFact]] = [[]]
  /// What each ask for the product answers, in turn.
  var productAnswers: [PurchaseState.Product] = [.ready(price: "£1.99", familyShareable: true)]
  var buyAnswers: [BuyResult] = [.cancelled]
  var syncAnswers: [SyncResult] = [.synced]
  /// The calls made, in order: "listen", "entitlements", "product", "buy", "finish 7", "sync".
  private(set) var calls: [String] = []

  private let log: Log
  private var listener: (@MainActor (PurchaseFact) async -> Void)?
  private var made: [Call: Int] = [:]
  private var answered: [Call: Int] = [:]
  private var gates: [Numbered: Gate] = [:]

  init(log: Log) {
    self.log = log
  }

  /// Holds the `number`th call of `call`, which must not have been made yet, until released.
  func hold(_ call: Call, number: Int) {
    gates[Numbered(call: call, number: number)] = Gate()
  }

  /// Lets the held `number`th call of `call` through.
  func release(_ call: Call, number: Int) {
    gates[Numbered(call: call, number: number)]?.open()
  }

  /// How many calls of `call` have been made.
  func made(_ call: Call) -> Int { made[call] ?? 0 }

  /// How many calls of `call` have answered.
  func answered(_ call: Call) -> Int { answered[call] ?? 0 }

  /// Gives the listener `fact` as `Transaction.updates` would; the task ends when the model has
  /// done with it. Nothing before `listen`.
  @discardableResult
  func tell(_ fact: PurchaseFact) -> Task<Void, Never> {
    let listener = self.listener
    return Task { await listener?(fact) }
  }

  func listen(_ heard: @escaping @MainActor (PurchaseFact) async -> Void) {
    note("listen")
    listener = heard
  }

  func entitlements() async -> [PurchaseFact] {
    await answer(.entitlements, "entitlements", from: entitlementAnswers)
  }

  func product(_ id: String) async -> PurchaseState.Product {
    await answer(.product, "product", from: productAnswers)
  }

  func buy(_ id: String) async -> BuyResult {
    await answer(.buy, "buy", from: buyAnswers)
  }

  func finish(_ transactionID: UInt64) async {
    note("finish \(transactionID)")
  }

  func sync() async -> SyncResult {
    await answer(.sync, "sync", from: syncAnswers)
  }

  private func note(_ call: String) {
    calls.append(call)
    log.note(call)
  }

  /// Makes `call`, noted as `name`: its answer from `answers` by its number, as it is made,
  /// once it is let through.
  private func answer<Answer>(_ call: Call, _ name: String, from answers: [Answer]) async
    -> Answer
  {
    note(name)
    let number = made(call) + 1
    made[call] = number
    let answer = answers[min(number, answers.count) - 1]
    await gates[Numbered(call: call, number: number)]?.wait()
    answered[call] = answered(call) + 1
    return answer
  }
}

/// `unlock.v1` in memory, noting each save in the log ("save true", "save false").
final class RecordingUnlockStore: UnlockStore {
  private let unlock: Locked<StoredUnlock?>
  private let log: Log

  init(_ unlock: StoredUnlock? = nil, log: Log) {
    self.unlock = Locked(unlock)
    self.log = log
  }

  /// What `unlock.v1` holds now.
  var saved: StoredUnlock? { unlock.read { $0 } }

  func loadUnlock() -> StoredUnlock? { unlock.read { $0 } }

  func saveUnlock(_ unlock: StoredUnlock) {
    self.unlock.change { $0 = unlock }
    log.note("save \(unlock.unlocked)")
  }
}

/// The widgets, noting each reload in the log ("reload"). Fakes.swift's `FakeWidgets` only
/// counts them.
final class LoggingWidgets: WidgetReloader {
  private let log: Log

  init(log: Log) {
    self.log = log
  }

  func reloadAllTimelines() {
    log.note("reload")
  }
}

/// The app's hooks as LiveHooks makes them, over a real `PurchaseModel`, for AppModel's tests:
/// step 2 starts the model in a main-actor task, and step 5 asks it from a nonisolated method,
/// so other main-actor work can run between its answer and step 5's use of it, as in the app.
/// The other steps note themselves in the log.
struct PurchaseHooks: AppHooks {
  let purchases: PurchaseModel
  let log: Log

  func startEntitlementCheck() {
    Task { @MainActor in purchases.start() }
  }

  func entitlement() async -> Bool? { await purchases.launchEntitlement() }

  func startAds() async { log.note("startAds") }

  func stopAds() async { log.note("stopAds") }

  func syncAlerts(target: Target, units: Units?) async { log.note("syncAlerts") }

  func handle(_ route: DeepLink.Route) async { log.note("handle") }
}

/// A purchase model with a fake StoreKit, `unlock.v1` in memory (holding `stored`'s answer
/// from an earlier check, or nothing), widgets and `changed` that note what they hear, and a
/// clock at `moment`.
@MainActor
struct PurchaseHarness {
  /// The product the app sells.
  nonisolated static let id = "today.willitsnow.app.unlock"
  /// 9:05am on 2 December 2026.
  nonisolated static let moment = Date(epochMs: 1_796_202_300_000)
  /// For sale at £1.99, with Family Sharing on.
  nonisolated static let ready = PurchaseState.Product.ready(
    price: "£1.99", familyShareable: true)

  let log = Log()
  let platform: FakePurchasePlatform
  let store: RecordingUnlockStore
  let clock: TestClock
  let model: PurchaseModel
  private let heard = Locked<[Bool]>([])

  init(stored: Bool? = nil) {
    platform = FakePurchasePlatform(log: log)
    let earlier = Self.moment.addingTimeInterval(-86_400)
    store = RecordingUnlockStore(
      stored.map { StoredUnlock(unlocked: $0, checkedAt: earlier, productID: Self.id) }, log: log)
    clock = TestClock(Self.moment)
    model = PurchaseModel(
      platform: platform, store: store, widgets: LoggingWidgets(log: log), clock: clock,
      productID: Self.id)
    model.changed = { [heard] owned in heard.change { $0.append(owned) } }
  }

  /// What `changed` has heard, in order.
  var changes: [Bool] { heard.read { $0 } }
  /// How many times `unlock.v1` was written.
  var saves: Int { log.all.filter { $0.hasPrefix("save") }.count }

  /// Starts the model, and waits for the launch's check and the product's first answer, kept.
  func started() async {
    model.start()
    _ = await model.launchEntitlement()
    let answered = await yieldUntil {
      platform.answered(.product) == 1 && model.state.product != .loading
    }
    #expect(answered, "the product was never asked for")
  }
}

/// A transaction StoreKit holds for the app's product, verified, bought and unrevoked unless
/// said; one StoreKit couldn't verify fails with "Unverified.".
func fact(
  id: UInt64, verified: Bool = true, revoked: Bool = false, family: Bool = false,
  product: String = PurchaseHarness.id
) -> PurchaseFact {
  PurchaseFact(
    transactionID: id, productID: product, verificationFailure: verified ? nil : "Unverified.",
    revoked: revoked, familyShared: family)
}
