import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

/// The registration last sent or refused, as the vectors give it: `at` in epoch milliseconds.
private struct SentCase: Decodable, Sendable {
  let fingerprint: String
  let at: Int

  var sent: AlertSync.Sent { AlertSync.Sent(fingerprint: fingerprint, at: Date(epochMs: at)) }
}

/// Each place's zone by its key, as the client's object, compared in the keys' order: a
/// dictionary's own order is its hashing's, which `sameText` would read as a difference.
private struct Zones: Decodable, Equatable, Sendable {
  let pairs: [[String]]

  init(_ zones: [String: String]) {
    pairs = zones.sorted { $0.key.utf16.lexicographicallyPrecedes($1.key.utf16) }
      .map { [$0.key, $0.value] }
  }

  init(from decoder: any Decoder) throws {
    self.init(try [String: String](from: decoder))
  }
}

extension VectorPort {
  /// `alerts.json` (version 2, phase 8.4a): client `herePlace`, `registrationBody`,
  /// `fingerprint`, `alertAction`, `setAlert`, `syncReply`, `hereKind`, `hereName`, `replyZones`
  /// and `testOutcome`, ported as `AlertSync.here`, `.body`, `.fingerprint`, `.action`,
  /// `.setting`, `.syncReply`, `.hereKind`, `.hereName`, `.replyZones` and `.testOutcome`. Each
  /// output is decoded from the client's JSON and compared whole, a fingerprint byte for byte;
  /// a reply's text is the bytes a transport hands over.
  static let alerts = VectorPort { file in
    struct Here: Decodable, Sendable {
      let access: AlertSync.LocationAccess
      let fix: Target?
      let kept: KeptCell?
    }
    try file.compare("herePlace", input: Here.self, output: HerePlace.self) {
      AlertSync.here(access: $0.access, fix: $0.fix, kept: $0.kept)
    }

    struct Body: Decodable, Sendable {
      let token: String
      let env: RegistrationBody.Env
      let here: HerePlace
      let units: Units
      let prefs: AlertPrefs
      let appVersion: String
    }
    try file.compare("registrationBody", input: Body.self, output: RegistrationBody.self) {
      AlertSync.body(
        token: $0.token, env: $0.env, here: $0.here, units: $0.units, prefs: $0.prefs,
        appVersion: $0.appVersion)
    }

    struct Said: Decodable, Sendable {
      let body: RegistrationBody
    }
    try file.compare("fingerprint", input: Said.self, output: String.self) {
      AlertSync.fingerprint($0.body)
    }

    struct Action: Decodable, Sendable {
      let prefs: AlertPrefs
      let permission: AlertSync.Permission
      let token: String?
      let here: HerePlace
      let units: Units
      let last: SentCase?
      let refused: SentCase?
      let activeAt: Int
      let now: Int
      let env: RegistrationBody.Env
      let appVersion: String
    }
    try file.compare("alertAction", input: Action.self, output: AlertSync.Action.self) {
      AlertSync.action(
        prefs: $0.prefs, permission: $0.permission, token: $0.token, here: $0.here,
        units: $0.units, last: $0.last?.sent, refused: $0.refused?.sent,
        activeAt: Date(epochMs: $0.activeAt), now: Date(epochMs: $0.now), env: $0.env,
        appVersion: $0.appVersion)
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

    struct Kind: Decodable, Sendable {
      let here: HerePlace
      let reply: DeviceResponse?
      let refused: Bool
    }
    try file.compare("hereKind", input: Kind.self, output: AlertSync.HereKind.self) {
      AlertSync.hereKind(here: $0.here, reply: $0.reply, refused: $0.refused)
    }

    struct Name: Decodable, Sendable {
      let here: HerePlace
      let reply: DeviceResponse?
    }
    try file.compare("hereName", input: Name.self, output: String?.self) {
      AlertSync.hereName(here: $0.here, reply: $0.reply)
    }

    struct Answer: Decodable, Sendable {
      let reply: DeviceResponse
    }
    try file.compare("replyZones", input: Answer.self, output: Zones.self) {
      Zones(AlertSync.replyZones($0.reply))
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

/// What the vectors don't reach: a registration's JSON as the app sends it, where you are's as
/// the client writes it, and the forget's and the test's body.
@Suite("Notification registrations")
struct AlertSyncTests {
  /// Leeds's cell as the phone found it, named by an earlier answer.
  static let cell = Target.Coordinates(source: .device, lat: 53.8, lon: -1.55, name: "Leeds")

  @Test(
    "a body's JSON is version 2's, where you are as its point alone, and reads back as itself",
    arguments: [HerePlace.ip, .device(cell)])
  func theBodysJSON(_ here: HerePlace) throws {
    let body = AlertSync.body(
      token: "a1b2", env: .production, here: here, units: .f,
      prefs: AlertPrefs(morning: true, possible: true), appVersion: "1.0 (1)")
    #expect(body.v == 2)
    #expect(RegistrationBody.version == 2)
    #expect(body.saved.isEmpty)
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    let json = String(decoding: try encoder.encode(body), as: UTF8.self)
    let sent =
      here == .ip ? #"{"source":"ip"}"# : #"{"lat":53.8,"lon":-1.55,"source":"device"}"#
    #expect(
      json
        == #"{"alerts":{"snow":{"evening":false,"morning":true,"possible":true}},"#
        + #""app":"snow","appVersion":"1.0 (1)","env":"production","here":"# + sent
        + #","platform":"ios","saved":[],"token":"a1b2","units":"f","v":2}"#)
    let read = try JSONDecoder().decode(RegistrationBody.self, from: Data(json.utf8))
    #expect(read == body)
    #expect(AlertSync.fingerprint(read) == AlertSync.fingerprint(body))
  }

  @Test("where you are reads back as itself from the client's JSON, and is a point or nothing")
  func herePlaceJSON() throws {
    for here in [HerePlace.ip, .device(Self.cell)] {
      let json = try JSONEncoder().encode(here)
      #expect(try JSONDecoder().decode(HerePlace.self, from: json) == here)
    }
    #expect(HerePlace.device(Self.cell).target == .coords(Self.cell))
    #expect(HerePlace.device(Self.cell).cell == KeptCell(lat: 53.8, lon: -1.55))
    #expect(HerePlace.ip.target == .ip)
    #expect(HerePlace.ip.cell == nil)
    // A device place is the phone's point, never a city.
    let city = #"{"kind":"device","target":{"kind":"city","slug":"leeds-gb"}}"#
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(HerePlace.self, from: Data(city.utf8))
    }
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
