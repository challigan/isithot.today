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

/// The later phases' steps, noting each call in order.
final class RecordingHooks: AppHooks {
  private let state:
    Locked<(calls: [String], routes: [DeepLink.Route], owned: Bool?, moved: Target?)>

  init(owned: Bool? = nil, moved: Target? = nil) {
    state = Locked(([], [], owned, moved))
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
    return state.read(\.owned)
  }

  func locate(_ target: Target) async -> Target? {
    note("locate \(target.key)")
    return state.read(\.moved)
  }

  func startAds() async { note("startAds") }

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

/// A model with fakes for everything, as a test sets them up.
@MainActor
struct Harness {
  let transport: FakeTransport
  let clock: TestClock
  let store: FakeState
  let widgets = FakeWidgets()
  let hooks: RecordingHooks
  let model: AppModel

  /// The jitter every draw gives: half the range.
  nonisolated static let jitterMs = 45_000

  init(
    now: Date,
    store: FakeState.Contents = FakeState.Contents(),
    replies: [FakeTransport.Reply],
    hooks: RecordingHooks = RecordingHooks()
  ) {
    transport = FakeTransport(replies)
    clock = TestClock(now)
    self.store = FakeState(store)
    self.hooks = hooks
    model = AppModel(
      environment: AppEnvironment(
        client: APIClient(transport: transport),
        clock: clock,
        store: self.store,
        widgets: widgets,
        hooks: hooks,
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
  private let state = Locked<
    (requests: Int, released: Bool, waiting: CheckedContinuation<Void, Never>?)
  >(
    (0, false, nil))

  init(first: HTTPResponse, others: HTTPResponse) {
    self.first = first
    self.others = others
  }

  var requests: Int { state.read(\.requests) }

  func get(_ request: HTTPRequest) async throws -> HTTPResponse {
    let number = state.change { state -> Int in
      state.requests += 1
      return state.requests
    }
    guard number == 1 else { return others }
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      state.change { state in
        if state.released {
          continuation.resume()
        } else {
          state.waiting = continuation
        }
      }
    }
    return first
  }

  /// Lets the first answer through.
  func release() {
    state.change { state in
      state.released = true
      state.waiting?.resume()
      state.waiting = nil
    }
  }
}
