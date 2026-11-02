import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItTestSupport
import Testing

/// A devices fixture's reply (`Fixtures/Devices`), as the fake server gives it: its status, its
/// text and its `Retry-After`.
func deviceReply(_ name: String) throws -> FakeTransport.Reply {
  let info = try Fixtures.deviceInfo(name)
  return .answer(HTTPResponse(status: info.status, body: info.reply, retryAfter: info.retryAfter))
}

/// JSON as one string, its keys sorted at every level, so two bodies compare as JSON.
func sortedJSON(_ data: Data?) throws -> String {
  let value = try JSONSerialization.jsonObject(with: try #require(data), options: [])
  let sorted = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
  return try #require(String(data: sorted, encoding: .utf8))
}

/// What a devices fixture sent (`_fixture.body`), as `sortedJSON` writes it.
func deviceSentJSON(_ name: String) throws -> String {
  try sortedJSON(Fixtures.deviceInfo(name).body)
}

/// A PUT fixture's registration body, decoded.
func sentBody(_ name: String) throws -> RegistrationBody {
  let body = try #require(try Fixtures.deviceInfo(name).body)
  return try JSONDecoder().decode(RegistrationBody.self, from: body)
}

/// The token every devices fixture registers with (`put-leeds`'s): the tests type none.
func fixtureToken() throws -> String {
  try sentBody("put-leeds").token
}

/// The server's record in a PUT fixture's 200 reply, in another zone when `timezone` says.
func deviceResponse(_ name: String, timezone: String? = nil) throws -> DeviceResponse {
  let reply = try JSONDecoder().decode(DeviceResponse.self, from: Fixtures.deviceInfo(name).reply)
  guard let timezone else { return reply }
  let place = DeviceResponse.Place(
    name: reply.place.name, timezone: timezone, query: reply.place.query)
  return DeviceResponse(id: reply.id, place: place, alerts: reply.alerts, seenAt: reply.seenAt)
}

/// `alertSync.v1` as the model keeps it after the PUT in fixture `name` was answered at `at`.
func registration(
  _ name: String = "put-leeds", at: Date, timezone: String? = nil
) throws -> AlertRegistration {
  let body = try sentBody(name)
  return AlertRegistration(
    fingerprint: AlertSync.fingerprint(body), at: at, token: body.token, env: body.env,
    units: body.units, response: try deviceResponse(name, timezone: timezone))
}

/// One devices call as the server saw it: its method, its path and its body as `sortedJSON`.
struct DeviceCall: Equatable, CustomStringConvertible {
  let method: HTTPMethod
  let path: String
  let body: String?

  var description: String { "\(method.rawValue) \(path) \(body ?? "")" }
}

extension FakeTransport {
  /// The devices calls made, in order; the GETs left out.
  var deviceCalls: [DeviceCall] {
    get throws {
      try requests.filter { $0.url.path.hasPrefix("/api/v1/devices") }.map { request in
        DeviceCall(
          method: request.method, path: request.url.path,
          body: try request.body.map { try sortedJSON($0) })
      }
    }
  }
}

/// The system's notifications as the tests have them answer, on the main actor, noting each
/// call ("permission", "request", "register"). The permission is `current`; the prompt, asked
/// while it is `.notDetermined`, makes it `.authorized` or `.denied` as `answer` says, and
/// asked again gives the answer already given. A call held (`hold(_:number:)`, before it is
/// made) waits until the test releases that one call. It posts nothing: the tests call
/// `tokenArrived` themselves.
@MainActor
final class FakeNotificationPlatform: NotificationPlatform {
  enum Call: Hashable {
    case permission
    case request
  }

  private struct Numbered: Hashable {
    let call: Call
    let number: Int
  }

  var current: AlertSync.Permission
  var answer: Bool
  /// The calls made, in order.
  private(set) var calls: [String] = []
  private var made: [Call: Int] = [:]
  private var gates: [Numbered: Gate] = [:]

  init(_ current: AlertSync.Permission, answer: Bool = true) {
    self.current = current
    self.answer = answer
  }

  /// How many times the prompt was asked for.
  var requests: Int { made[.request] ?? 0 }
  /// How many times the app registered for remote notifications.
  var registers: Int { calls.filter { $0 == "register" }.count }
  /// How many times the permission was read.
  var reads: Int { made[.permission] ?? 0 }

  /// Holds the `number`th call of `call` (from 1), which must not have been made yet.
  func hold(_ call: Call, number: Int) {
    gates[Numbered(call: call, number: number)] = Gate()
  }

  /// Lets the held `number`th call of `call` through.
  func release(_ call: Call, number: Int) {
    gates[Numbered(call: call, number: number)]?.open()
  }

  func permission() async -> AlertSync.Permission {
    await made(.permission, "permission")
    return current
  }

  func requestPermission() async -> Bool {
    await made(.request, "request")
    if current == .notDetermined { current = answer ? .authorized : .denied }
    return current == .authorized || current == .provisional
  }

  func register() {
    calls.append("register")
  }

  private func made(_ call: Call, _ name: String) async {
    calls.append(name)
    let number = (made[call] ?? 0) + 1
    made[call] = number
    await gates[Numbered(call: call, number: number)]?.wait()
  }
}

/// The phone's location as the tests have it answer, noting each call ("access", "request",
/// "fix"). Its permission is `access`, which the prompt, asked while it is `.notDetermined`,
/// makes `answer`; each fix takes the next of `fixes`, the last standing once the others are
/// used up. A fix held (`holdFix(_:)`, before it is asked for) waits until the test releases it.
final class FakeLocation: LocationService {
  private struct Record {
    var access: LocationAccess
    var answer: LocationAccess
    var fixes: [LocationFix]
    var calls: [String] = []
    var gates: [Int: Gate] = [:]
    var fixesAsked = 0
  }

  private let state: Locked<Record>

  init(
    access: LocationAccess = .granted, answer: LocationAccess = .granted,
    fixes: [LocationFix] = [.unavailable]
  ) {
    state = Locked(Record(access: access, answer: answer, fixes: fixes))
  }

  /// The calls made, in order.
  var calls: [String] { state.read(\.calls) }

  /// From now on, the permission is `access` and the fixes are `fixes`.
  func change(access: LocationAccess, fixes: [LocationFix]? = nil) {
    state.change {
      $0.access = access
      if let fixes { $0.fixes = fixes }
    }
  }

  /// Holds the `number`th fix (from 1), which must not have been asked for yet.
  func holdFix(_ number: Int) {
    state.change { $0.gates[number] = Gate() }
  }

  /// Lets the held `number`th fix through.
  func releaseFix(_ number: Int) {
    state.read { $0.gates[number] }?.open()
  }

  func access() async -> LocationAccess {
    state.change {
      $0.calls.append("access")
      return $0.access
    }
  }

  func requestAccess() async -> LocationAccess {
    state.change {
      $0.calls.append("request")
      if $0.access == .notDetermined { $0.access = $0.answer }
      return $0.access
    }
  }

  func fix() async -> LocationFix {
    let (fix, gate) = state.change { state -> (LocationFix, Gate?) in
      state.calls.append("fix")
      state.fixesAsked += 1
      let fix = state.fixes.count > 1 ? state.fixes.removeFirst() : state.fixes[0]
      return (fix, state.gates[state.fixesAsked])
    }
    await gate?.wait()
    return fix
  }
}

/// A fix at `target`'s coordinates.
func located(_ target: Target) -> LocationFix {
  guard case .coords(let place) = target else { return .unavailable }
  return .located(latitude: place.lat, longitude: place.lon)
}

/// A notifications model with fakes for everything, as a test sets them up: the server
/// (`FakeTransport`, which a test can share with an app `Harness`), a clock at `now`, the three
/// keys in memory, the system's notifications and the phone's location, in the sandbox, as
/// version "1.0 (42)".
@MainActor
struct NotificationsHarness {
  let transport: FakeTransport
  let clock: TestClock
  let store: MemoryNotificationStore
  let platform: FakeNotificationPlatform
  let location: FakeLocation
  let model: NotificationsModel

  init(
    now: Date,
    settings: AlertSettings = AlertSettings(),
    registration: AlertRegistration? = nil,
    cardDismissed: Bool = false,
    permission: AlertSync.Permission = .authorized,
    answer: Bool = true,
    location: FakeLocation = FakeLocation(),
    replies: [FakeTransport.Reply] = [.failure(.notConnectedToInternet)],
    transport: FakeTransport? = nil,
    clock: TestClock? = nil,
    env: RegistrationBody.Env = .sandbox,
    appVersion: String = "1.0 (42)"
  ) {
    self.transport = transport ?? FakeTransport(replies)
    self.clock = clock ?? TestClock(now)
    store = MemoryNotificationStore(
      settings: settings, registration: registration, cardDismissed: cardDismissed)
    platform = FakeNotificationPlatform(permission, answer: answer)
    self.location = location
    model = NotificationsModel(
      platform: platform,
      store: store,
      client: APIClient(transport: self.transport),
      location: location,
      clock: self.clock,
      env: env,
      appVersion: appVersion
    )
  }

  /// The devices calls made, in order.
  var requests: [DeviceCall] {
    get throws { try transport.deviceCalls }
  }
}

/// 9:05am on 1 December 2026, leeds-dry's moment, when the devices fixtures were made.
func devicesMoment() throws -> Date {
  try fixtureNow("leeds-dry")
}

/// The place on screen as Settings and the card give it.
func onScreen(_ target: Target, units: Units? = .c, country: String? = "GB") -> OnScreen {
  OnScreen(target: target, name: target.ownName, country: country, units: units)
}

/// Evening on, for Leeds, chosen: what put-leeds registers.
let eveningInLeeds = AlertSettings(
  prefs: AlertPrefs(evening: true), place: .chosen(leedsCity, name: "Leeds"))
