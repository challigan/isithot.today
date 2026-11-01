import Foundation
import IsItLogic
import IsItModel
import IsItState
import Testing

/// The App Group as the widget reads and writes it, as a test sets it up, counting the saves.
/// `unlock.v1` is kept as bytes, as the defaults keep it, so junk reads as no flag.
final class FakeWidgetStore: WidgetStore {
  struct Contents {
    var place: Target = .ip
    var units: Units?
    var unlock: Data?
    var today: SavedToday?
    var saves = 0
    var failsToSave = false
    /// Runs once, just before the next load of the saved answer: what the app writes in the
    /// meantime, for the races the guarded save is for.
    var onLoadToday: (@Sendable (inout Contents) -> Void)?
  }

  struct SaveFailed: Error {}

  let contents: Locked<Contents>

  init(_ contents: Contents = Contents()) {
    self.contents = Locked(contents)
  }

  var today: SavedToday? { contents.read(\.today) }
  var saves: Int { contents.read(\.saves) }

  func loadPlace() -> Target { contents.read(\.place) }

  func loadUnits() -> Units? { contents.read(\.units) }

  func loadUnlock() -> StoredUnlock? { StoredUnlock(stored: contents.read(\.unlock)) }

  func loadToday() -> SavedToday? {
    contents.change { contents in
      if let hook = contents.onLoadToday {
        contents.onLoadToday = nil
        hook(&contents)
      }
      return contents.today
    }
  }

  func saveToday(_ saved: SavedToday) throws {
    try contents.change {
      if $0.failsToSave { throw SaveFailed() }
      $0.today = saved
      $0.saves += 1
    }
  }
}

/// `unlock.v1` as the app writes it: `unlocked`, checked at `checkedAt`.
func flag(_ unlocked: Bool, at checkedAt: Date) throws -> Data {
  try StoredUnlock(unlocked: unlocked, checkedAt: checkedAt, productID: PurchaseHarness.id)
    .stored()
}

/// StoreKit's entitlements as the widget reads them: `facts`, or with `held`, no answer for ten
/// seconds, far past every limit a test gives it, as iOS 26.4 and 26.5 are reported to leave
/// `Transaction.currentEntitlements` (V3). It counts the calls.
final class FakeEntitlements: EntitlementReader {
  private let facts: [PurchaseFact]
  private let held: Bool
  private let gate = Gate()
  private let count = Locked(0)

  init(_ facts: [PurchaseFact] = [], held: Bool = false) {
    self.facts = facts
    self.held = held
    if held { releasing { [gate] in gate.open() } }
  }

  /// How many times the entitlements were read.
  var calls: Int { count.read { $0 } }

  func entitlements() async -> [PurchaseFact] {
    count.change { $0 += 1 }
    if held { await gate.wait() }
    return facts
  }
}

/// A widget's timeline over `store`, `transport` and `entitlements`, with a gate of its own unless
/// one is given: with `.shared`, two tests running together would ask for the same URL
/// (`city:aberdeen-gb` at the default origin), and one would get the other's held or failed
/// answer.
func timeline(
  _ store: FakeWidgetStore,
  transport: any HTTPTransport,
  entitlements: FakeEntitlements = FakeEntitlements(),
  gate: FetchGate = FetchGate(),
  checkWithin: TimeInterval = 2,
  fetchWithin: TimeInterval = 12
) -> WidgetTimeline {
  WidgetTimeline(
    store: store, client: APIClient(transport: transport), entitlements: entitlements,
    gate: gate, checkWithin: checkWithin, fetchWithin: fetchWithin)
}

/// Calls `release` after `seconds`: a held answer that a regression waits for then ends the wait,
/// and the test fails on its timing or its result, rather than holding the whole run, which a
/// suite's time limit can't end while the test ignores cancellation.
func releasing(after seconds: TimeInterval = 10, _ release: @escaping @Sendable () -> Void) {
  Task {
    try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    release()
  }
}

/// Whether `count` callers have joined `key`'s request at `gate`, yielding to the other tasks
/// until they have, for ten seconds at most (well inside a suite's time limit). Two tasks started
/// together reach the gate in no set order, and nothing else shows that a second caller is
/// waiting on the first's request, so a held request is let through only once this holds.
func joined(_ gate: FetchGate, key: String, count: Int) async -> Bool {
  let until = Date().addingTimeInterval(10)
  while await gate.callers(for: key) != count {
    guard Date() < until else { return false }
    await Task.yield()
  }
  return true
}

/// Whether `done` holds, yielding to the other tasks until it does, for ten seconds at most.
func eventually(_ done: () -> Bool) async -> Bool {
  let until = Date().addingTimeInterval(10)
  while !done() {
    guard Date() < until else { return false }
    await Task.yield()
  }
  return true
}
