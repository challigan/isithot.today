import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

extension VectorPort {
  /// `alerts.json`: client `alertPlaceAllowed`, `registrationBody`, `fingerprint` and
  /// `alertAction`, ported as `AlertSync.placeAllowed`, `.body`, `.fingerprint` and `.action`.
  /// A body is decoded from the client's JSON and compared whole; a fingerprint byte for byte.
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
}
