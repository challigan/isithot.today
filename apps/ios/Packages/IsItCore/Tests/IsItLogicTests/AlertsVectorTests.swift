import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

extension VectorPort {
  /// `alerts.json`: client `alertPlaceAllowed`, `registrationBody`, `fingerprint` and
  /// `alertAction`, ported as `AlertSync.placeAllowed`, `.body`, `.fingerprint` and `.action`.
  /// A body is decoded from the client's JSON and compared whole; a fingerprint byte for byte.
  /// Then the place and the switches the app keeps (`firstAlertPlace`, `followLocation`,
  /// `setAlert`, as `AlertSync.firstPlace`, `.following` and `.setting`) and what the server's
  /// replies mean (`syncReply`, `testOutcome`, as `AlertSync.syncReply` and `.testOutcome`, the
  /// reply's text as the bytes a transport hands over), each output decoded from the client's
  /// JSON.
  static let alerts = VectorPort { file in
    struct Place: Decodable, Sendable {
      let target: Target?
    }
    try file.compare("alertPlaceAllowed", input: Place.self, output: Bool.self) {
      AlertSync.placeAllowed($0.target)
    }

    struct Body: Decodable, Sendable {
      let token: String
      let env: RegistrationBody.Env
      let place: Target
      let units: Units
      let prefs: AlertPrefs
      let appVersion: String
    }
    try file.compare("registrationBody", input: Body.self, output: RegistrationBody?.self) {
      AlertSync.body(
        token: $0.token,
        env: $0.env,
        place: $0.place,
        units: $0.units,
        prefs: $0.prefs,
        appVersion: $0.appVersion
      )
    }

    struct Said: Decodable, Sendable {
      let body: RegistrationBody
    }
    try file.compare("fingerprint", input: Said.self, output: String.self) {
      AlertSync.fingerprint($0.body)
    }

    /// The registration last sent, `at` in epoch milliseconds.
    struct Last: Decodable, Sendable {
      let fingerprint: String
      let at: Int
    }
    struct Action: Decodable, Sendable {
      let prefs: AlertPrefs
      let permission: AlertSync.Permission
      let token: String?
      let place: Target?
      let units: Units
      let last: Last?
      let now: Int
      let env: RegistrationBody.Env
      let appVersion: String
    }
    try file.compare("alertAction", input: Action.self, output: AlertSync.Action.self) {
      AlertSync.action(
        prefs: $0.prefs,
        permission: $0.permission,
        token: $0.token,
        place: $0.place,
        units: $0.units,
        last: $0.last.map { AlertSync.Sent(fingerprint: $0.fingerprint, at: Date(epochMs: $0.at)) },
        now: Date(epochMs: $0.now),
        env: $0.env,
        appVersion: $0.appVersion
      )
    }

    struct First: Decodable, Sendable {
      let onScreen: Target
      let name: String?
    }
    try file.compare("firstAlertPlace", input: First.self, output: AlertPlace?.self) {
      AlertSync.firstPlace(onScreen: $0.onScreen, name: $0.name)
    }

    struct Fix: Decodable, Sendable {
      let place: AlertPlace?
      let fix: Target
    }
    // The client gives the place itself back when nothing changes; the port gives nil.
    try file.compare("followLocation", input: Fix.self, output: AlertPlace?.self) {
      AlertSync.following($0.place, fix: $0.fix) ?? $0.place
    }

    struct Setting: Decodable, Sendable {
      let prefs: AlertPrefs
      let which: AlertSwitch
      let on: Bool
    }
    try file.compare("setAlert", input: Setting.self, output: AlertPrefs.self) {
      AlertSync.setting($0.prefs, $0.which, on: $0.on)
    }

    struct Reply: Decodable, Sendable {
      let status: Int
      let text: String
      let retryAfter: String?
    }
    try file.compare("syncReply", input: Reply.self, output: AlertSync.SyncReply.self) {
      AlertSync.syncReply(status: $0.status, body: Data($0.text.utf8), retryAfter: $0.retryAfter)
    }

    struct TestReply: Decodable, Sendable {
      let status: Int
      let text: String
    }
    try file.compare("testOutcome", input: TestReply.self, output: AlertSync.TestOutcome.self) {
      AlertSync.testOutcome(status: $0.status, body: Data($0.text.utf8))
    }
  }
}

/// What the vectors don't reach: a registration's JSON as the app sends and stores it.
@Suite("Notification registrations")
struct AlertSyncTests {
  @Test("a body is never made for approximate IP location")
  func noBodyForIP() {
    let body = AlertSync.body(
      token: "a1b2", env: .sandbox, place: .ip, units: .c, prefs: AlertPrefs(evening: true),
      appVersion: "1.0 (1)")
    #expect(body == nil)
  }

  @Test(
    "a body reads back as itself from the JSON the app sends",
    arguments: [
      Target.city(slug: "durham-gb", name: "Durham"),
      .coords(Target.Coordinates(source: .device, lat: 53.8, lon: -1.55, name: "Leeds")),
      .coords(
        Target.Coordinates(
          source: .search, lat: 47.15, lon: 7.25, name: "Biel/Bienne", region: "", country: "CH",
          geonameId: 0, elevation: 437)),
    ])
  func roundTrip(_ place: Target) throws {
    let body = try #require(
      AlertSync.body(
        token: "a1b2", env: .production, place: place, units: .f,
        prefs: AlertPrefs(morning: true, possible: true), appVersion: "1.0 (1)"))
    let read = try JSONDecoder().decode(RegistrationBody.self, from: JSONEncoder().encode(body))
    #expect(read == body)
    #expect(AlertSync.fingerprint(read) == AlertSync.fingerprint(body))
  }

  @Test("a DELETE's and a test's body is the app and the token, and reads back as itself")
  func identity() throws {
    let identity = DeviceIdentity(token: "a1b2")
    #expect(identity.app == .snow)
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    let json = try encoder.encode(identity)
    #expect(String(decoding: json, as: UTF8.self) == #"{"app":"snow","token":"a1b2"}"#)
    #expect(try JSONDecoder().decode(DeviceIdentity.self, from: json) == identity)
  }
}
