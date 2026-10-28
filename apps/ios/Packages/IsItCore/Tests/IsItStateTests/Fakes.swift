import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItTestSupport
import Testing

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

/// A value behind a lock, for the fakes the model reaches from outside the main actor.
final class Locked<Value>: @unchecked Sendable {
  private let lock = NSLock()
  private var value: Value

  init(_ value: Value) {
    self.value = value
  }

  func read<T>(_ body: (Value) -> T) -> T { lock.withLock { body(value) } }

  func change<T>(_ body: (inout Value) throws -> T) rethrows -> T {
    try lock.withLock { try body(&value) }
  }
}

/// The server, as the tests have it answer: each request takes the next reply, and the last
/// reply stands once the others are used up.
final class FakeTransport: HTTPTransport {
  enum Reply: Sendable {
    case answer(HTTPResponse)
    case failure(URLError.Code)
  }

  private let state: Locked<(replies: [Reply], requests: [HTTPRequest])>

  init(_ replies: [Reply]) {
    state = Locked((replies, []))
  }

  /// The requests made, in order.
  var requests: [HTTPRequest] { state.read(\.requests) }
  /// The requests' URLs, in order.
  var urls: [String] { requests.map(\.url.absoluteString) }

  func get(_ request: HTTPRequest) async throws -> HTTPResponse {
    let reply = state.change { state -> Reply in
      state.requests.append(request)
      return state.replies.count > 1 ? state.replies.removeFirst() : state.replies[0]
    }
    switch reply {
    case .answer(let response): return response
    case .failure(let code): throw URLError(code)
    }
  }

  /// Replies with a fixture's JSON, with status 200.
  static func fixture(_ name: String) throws -> Reply {
    .answer(HTTPResponse(status: 200, body: try Fixtures.data(name)))
  }

  /// Replies with the server's error answer for `code`, with `status`.
  static func error(_ status: Int, code: String) throws -> Reply {
    let message = CoreCopy.errorMessage(code: code) ?? "?"
    let body = try JSONEncoder().encode(ApiError(code: code, message: message))
    return .answer(HTTPResponse(status: status, body: body))
  }
}

/// A clock the tests move by hand, which keeps what is scheduled until a test runs it.
final class TestClock: AppClock {
  struct Work {
    let date: Date
    let run: @MainActor @Sendable () async -> Void
    var cancelled = false
  }

  private let state: Locked<(now: Date, scheduled: [Work])>

  init(_ now: Date) {
    state = Locked((now, []))
  }

  var now: Date {
    get { state.read(\.now) }
    set { state.change { $0.now = newValue } }
  }

  /// When the work not yet run or cancelled is due, in the order it was scheduled.
  var pending: [Date] { state.read { $0.scheduled.filter { !$0.cancelled }.map(\.date) } }

  func schedule(at date: Date, _ work: @escaping @MainActor @Sendable () async -> Void)
    -> ScheduledWork
  {
    let index = state.change { state -> Int in
      state.scheduled.append(Work(date: date, run: work))
      return state.scheduled.count - 1
    }
    return ScheduledWork { [state] in state.change { $0.scheduled[index].cancelled = true } }
  }

  /// Moves the clock to the first pending work's time, and runs it. False when none is pending.
  @MainActor
  @discardableResult
  func runNext() async -> Bool {
    let work = state.change { state -> Work? in
      guard let index = state.scheduled.firstIndex(where: { !$0.cancelled }) else { return nil }
      state.scheduled[index].cancelled = true
      state.now = max(state.now, state.scheduled[index].date)
      return state.scheduled[index]
    }
    guard let work else { return false }
    await work.run()
    return true
  }
}

/// What is stored, as a test sets it up, counting what the app writes.
final class FakeState: StoredState {
  struct Contents {
    var place: Target = .ip
    var units: Units?
    var unlocked = false
    var today: SavedToday?
    var saves = 0
    var placeSaves = 0
    var unitsSaves = 0
    var failsToSave = false
  }

  struct SaveFailed: Error {}

  let contents: Locked<Contents>

  init(_ contents: Contents = Contents()) {
    self.contents = Locked(contents)
  }

  var today: SavedToday? { contents.read(\.today) }
  var saves: Int { contents.read(\.saves) }

  func loadPlace() -> Target { contents.read(\.place) }

  func savePlace(_ target: Target) {
    contents.change {
      $0.place = target
      $0.placeSaves += 1
    }
  }

  func loadUnits() -> Units? { contents.read(\.units) }

  func saveUnits(_ units: Units) {
    contents.change {
      $0.units = units
      $0.unitsSaves += 1
    }
  }

  func loadUnlocked() -> Bool { contents.read(\.unlocked) }

  func loadToday() -> SavedToday? { contents.read(\.today) }

  func saveToday(_ saved: SavedToday) throws {
    try contents.change {
      if $0.failsToSave { throw SaveFailed() }
      $0.today = saved
      $0.saves += 1
    }
  }
}

/// Counts the widget reloads.
final class FakeWidgets: WidgetReloader {
  private let count = Locked(0)

  var reloads: Int { count.read { $0 } }

  func reloadAllTimelines() {
    count.change { $0 += 1 }
  }
}

/// Holds whatever waits on it until the test opens it; once open, it holds nothing.
final class Gate: Sendable {
  private let state = Locked<(open: Bool, waiting: [CheckedContinuation<Void, Never>])>(
    (false, []))

  func wait() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      let open = state.change { state -> Bool in
        if !state.open { state.waiting.append(continuation) }
        return state.open
      }
      if open { continuation.resume() }
    }
  }

  func open() {
    let waiting = state.change { state -> [CheckedContinuation<Void, Never>] in
      state.open = true
      defer { state.waiting = [] }
      return state.waiting
    }
    for continuation in waiting { continuation.resume() }
  }
}

/// The later phases' steps and the phone's location, noting each call in order. The location's
/// permission is `access` (granted unless said), and after `requestAccess()`, `answer`; its fix
/// is at `moved`'s coordinates, or none without. With `holdingFix`, the fix waits until the test
/// releases it (`releaseFix()`); with `holdingEntitlement`, so does step 5's answer
/// (`releaseEntitlement()`), so a test can act while step 5 waits.
final class RecordingHooks: AppHooks, LocationService {
  private struct Record {
    var calls: [String] = []
    var routes: [DeepLink.Route] = []
    var owned: Bool?
    var moved: Target?
    var access: LocationAccess
  }

  private let state: Locked<Record>
  private let answer: LocationAccess
  private let gate: Gate?
  private let entitlementGate: Gate?

  init(
    owned: Bool? = nil,
    moved: Target? = nil,
    access: LocationAccess = .granted,
    answer: LocationAccess = .granted,
    holdingFix: Bool = false,
    holdingEntitlement: Bool = false
  ) {
    state = Locked(Record(owned: owned, moved: moved, access: access))
    self.answer = answer
    gate = holdingFix ? Gate() : nil
    entitlementGate = holdingEntitlement ? Gate() : nil
  }

  /// Lets a held location fix through.
  func releaseFix() {
    gate?.open()
  }

  /// Lets step 5's held answer through.
  func releaseEntitlement() {
    entitlementGate?.open()
  }

  var calls: [String] { state.read(\.calls) }
  /// The routes handled, in order.
  var routes: [DeepLink.Route] { state.read(\.routes) }

  private func note(_ call: String) {
    state.change { $0.calls.append(call) }
  }

  func startEntitlementCheck() { note("startEntitlementCheck") }

  func entitlement() async -> Bool? {
    note("entitlement")
    await entitlementGate?.wait()
    return state.read(\.owned)
  }

  func access() async -> LocationAccess {
    note("location access")
    return state.read(\.access)
  }

  func requestAccess() async -> LocationAccess {
    note("location request")
    return state.change { state -> LocationAccess in
      if state.access == .notDetermined { state.access = answer }
      return state.access
    }
  }

  func fix() async -> LocationFix {
    note("location fix")
    await gate?.wait()
    guard case .coords(let place)? = state.read(\.moved) else { return .unavailable }
    return .located(latitude: place.lat, longitude: place.lon)
  }

  func startAds() async { note("startAds") }

  func stopAds() async { note("stopAds") }

  func syncAlerts(target: Target, units: Units?) async {
    note("syncAlerts \(target.key) \(units?.rawValue ?? "none")")
  }

  func handle(_ route: DeepLink.Route) async {
    state.change {
      $0.calls.append("handle")
      $0.routes.append(route)
    }
  }
}

/// A model with fakes for everything, as a test sets them up. The later phases' steps are
/// `hooks`, which is also the phone's location, unless `appHooks` are given for them.
@MainActor
struct Harness {
  let transport: FakeTransport
  let clock: TestClock
  let store: FakeState
  let widgets = FakeWidgets()
  let hooks: RecordingHooks
  /// The recent places kept (`recent.v1`).
  let recents: MemoryRecents
  /// The saved places kept (`savedPlaces.v1`).
  let saved: MemorySavedPlaces
  let model: AppModel

  /// The jitter every draw gives: half the range.
  nonisolated static let jitterMs = 45_000

  init(
    now: Date,
    store: FakeState.Contents = FakeState.Contents(),
    replies: [FakeTransport.Reply],
    hooks: RecordingHooks = RecordingHooks(),
    appHooks: (any AppHooks)? = nil,
    recents: [RecentPlace] = [],
    saved: [SavedPlace] = []
  ) {
    transport = FakeTransport(replies)
    clock = TestClock(now)
    self.store = FakeState(store)
    self.hooks = hooks
    self.recents = MemoryRecents(recents)
    self.saved = MemorySavedPlaces(saved)
    model = AppModel(
      environment: AppEnvironment(
        client: APIClient(transport: transport),
        clock: clock,
        store: self.store,
        widgets: widgets,
        location: hooks,
        recents: self.recents,
        saved: self.saved,
        hooks: appHooks ?? hooks,
        random: { range in
          precondition(range == 0...90_000, "the jitter is 0 to 90 s")
          return Harness.jitterMs
        }
      ))
  }
}

/// A fixture's answer.
func fixture(_ name: String) throws -> TodayResponse {
  try TodayResponse.decode(from: Fixtures.data(name))
}

/// The moment a fixture was made, as its `_fixture` block gives it.
func fixtureNow(_ name: String) throws -> Date {
  try #require(ApiJSON.parseDate(Fixtures.info(name).now))
}

/// `date` plus `minutes`.
func later(_ date: Date, minutes: Double) -> Date {
  date.addingTimeInterval(minutes * 60)
}

/// The place a fixture's query asks about.
func fixtureTarget(_ name: String) throws -> Target {
  try #require(Target(query: Fixtures.info(name).query))
}

/// A server whose first answer waits until the test releases it; the others come at once.
final class GatedTransport: HTTPTransport {
  private let first: HTTPResponse
  private let others: HTTPResponse
  private let count = Locked(0)
  private let gate = Gate()

  init(first: HTTPResponse, others: HTTPResponse) {
    self.first = first
    self.others = others
  }

  var requests: Int { count.read { $0 } }

  func get(_ request: HTTPRequest) async throws -> HTTPResponse {
    let number = count.change { count -> Int in
      count += 1
      return count
    }
    guard number == 1 else { return others }
    await gate.wait()
    return first
  }

  /// Lets the first answer through.
  func release() {
    gate.open()
  }
}

/// Yields to the other tasks until `done` holds, or 100,000 turns have passed; whether it held.
@MainActor
func yieldUntil(_ done: () -> Bool) async -> Bool {
  var turns = 0
  while !done() && turns < 100_000 {
    turns += 1
    await Task.yield()
  }
  return done()
}
