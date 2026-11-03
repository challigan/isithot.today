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

/// The text of each of `fn`'s outputs in `alerts.json`, in order, as the reference wrote it:
/// the generator writes each case on a line of its own, as `JSON.stringify` writes it, its
/// output last.
private func writtenOutputs(_ fn: String) throws -> [String] {
  let text = String(decoding: try Vectors.data("alerts"), as: UTF8.self)
  let start = #"{"fn":""# + fn + #"","#
  return try text.split(separator: "\n").compactMap { line -> String? in
    var item = Substring(line.drop { $0 == " " })
    guard item.hasPrefix(start) else { return nil }
    if item.hasSuffix(",") { item = item.dropLast() }
    // The case's own closing brace.
    item = item.dropLast()
    let out = try #require(item.range(of: #","out":"#, options: .backwards))
    return String(item[out.upperBound...])
  }
}

extension VectorPort {
  /// `alerts.json` (version 2, phases 8.4a and 8.4b): client `herePlace`, `registrationBody`,
  /// `fingerprint`, `alertAction`, `setAlert`, `syncReply`, `hereKind`, `hereName`, `replyZones`,
  /// `testOutcome`, `alertsActive`, `bellState`, `setBell`, `keptBells`, `ownsSaved`,
  /// `savedForBody`, `tapBell` and `savedLines`, ported as `AlertSync.here`, `.body`,
  /// `.fingerprint`, `.action`, `.setting`, `.syncReply`, `.hereKind`, `.hereName`,
  /// `.replyZones`, `.testOutcome`, `.active`, `.bellState`, `.settingBell`, `.keptBells`,
  /// `.ownsSaved`, `.savedForBody`, `.tapBell` and `PlacePicker.savedLines`. Each output is
  /// decoded from the client's JSON and compared whole, a fingerprint byte for byte, and each
  /// body's JSON (`RegistrationBody.json`) byte for byte with the reference's; a reply's text is
  /// the bytes a transport hands over. The inputs 8.4a's cases leave out, the saved places and
  /// the phone's zone, read as none.
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
      let saved: [Target]?
      let deviceTz: String?

      var body: RegistrationBody {
        AlertSync.body(
          token: token, env: env, here: here, units: units, prefs: prefs,
          appVersion: appVersion, saved: saved ?? [], deviceTz: deviceTz)
      }
    }
    try file.compare("registrationBody", input: Body.self, output: RegistrationBody.self) {
      $0.body
    }
    // Byte for byte as the client sends it: the keys in its order, `deviceTz` after
    // `appVersion` and only with a saved place, a "/" in a name as it is.
    let written = try writtenOutputs("registrationBody")
    let bodies = try file.cases("registrationBody", input: Body.self, output: RegistrationBody.self)
    #expect(written.count == bodies.count)
    #expect(written.contains { $0.contains("/") })
    for (item, text) in zip(bodies, written) {
      let json = String(decoding: item.input.body.json, as: UTF8.self)
      #expect(json.utf8.elementsEqual(text.utf8), "alerts.json case \(item.index): \(json)")
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
      let saved: [Target]?
      let deviceTz: String?
      let unconfirmed: Bool?
    }
    try file.compare("alertAction", input: Action.self, output: AlertSync.Action.self) {
      AlertSync.action(
        prefs: $0.prefs, permission: $0.permission, token: $0.token, here: $0.here,
        units: $0.units, last: $0.last?.sent, refused: $0.refused?.sent,
        activeAt: Date(epochMs: $0.activeAt), now: Date(epochMs: $0.now), env: $0.env,
        appVersion: $0.appVersion, saved: $0.saved ?? [], deviceTz: $0.deviceTz,
        unconfirmed: $0.unconfirmed ?? false)
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

    // The saved places' bells (phase 8.4b).
    struct Active: Decodable, Sendable {
      let prefs: AlertPrefs
      let permission: AlertSync.Permission
    }
    try file.compare("alertsActive", input: Active.self, output: Bool.self) {
      AlertSync.active(prefs: $0.prefs, permission: $0.permission)
    }

    struct Bell: Decodable, Sendable {
      let on: Bool
      let unlocked: Bool
      let active: Bool
    }
    try file.compare("bellState", input: Bell.self, output: AlertSync.BellState.self) {
      AlertSync.bellState(on: $0.on, unlocked: $0.unlocked, active: $0.active)
    }

    struct SetBell: Decodable, Sendable {
      let bells: [String]
      let key: String
      let on: Bool
      let savedKeys: [String]
    }
    try file.compare("setBell", input: SetBell.self, output: [String].self) {
      AlertSync.settingBell($0.bells, $0.key, on: $0.on, savedKeys: $0.savedKeys)
    }

    struct Kept: Decodable, Sendable {
      let bells: [String]
      let savedKeys: [String]
    }
    try file.compare("keptBells", input: Kept.self, output: [String].self) {
      AlertSync.keptBells($0.bells, savedKeys: $0.savedKeys)
    }

    struct Owns: Decodable, Sendable {
      let unlocked: Bool?
      let last: DeviceResponse?
    }
    try file.compare("ownsSaved", input: Owns.self, output: Bool.self) {
      AlertSync.ownsSaved(unlocked: $0.unlocked, last: $0.last)
    }

    struct ForBody: Decodable, Sendable {
      let saved: [SavedPlace]
      let bells: [String]
      let owns: Bool
    }
    try file.compare("savedForBody", input: ForBody.self, output: [Target].self) {
      AlertSync.savedForBody($0.saved, bells: $0.bells, owns: $0.owns)
    }

    struct Tap: Decodable, Sendable {
      let key: String
      let bells: [String]
      let savedKeys: [String]
      let prefs: AlertPrefs
      let unlocked: Bool
      let permission: AlertSync.Permission
    }
    try file.compare("tapBell", input: Tap.self, output: AlertSync.BellTap.self) {
      AlertSync.tapBell(
        key: $0.key, bells: $0.bells, savedKeys: $0.savedKeys, prefs: $0.prefs,
        unlocked: $0.unlocked, permission: $0.permission)
    }

    struct Lines: Decodable, Sendable {
      let savedCount: Int
      let unlocked: Bool
      let anyBellOn: Bool
    }
    try file.compare("savedLines", input: Lines.self, output: [PlacePicker.SavedLine].self) {
      PlacePicker.savedLines(
        savedCount: $0.savedCount, unlocked: $0.unlocked, anyBellOn: $0.anyBellOn)
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

  @Test(
    "the bells' sets: the body the app makes is what each fixture sent, its zone with it",
    arguments: [
      ("put-here-ip-durham", ["city:durham-gb"]),
      ("put-here-ip-kathmandu", ["search:27.7,85.3"]),
      ("put-here-ip-durham-kathmandu", ["search:27.7,85.3", "city:durham-gb"]),
      ("put-refused", ["city:durham-gb", "city:nowhere-xx"]),
      (
        "put-capped",
        ["city:edinburgh-gb", "city:york-gb", "city:aberdeen-gb", "city:durham-gb", "city:x"]
      ),
    ])
  func theBellsSets(_ name: String, bells: [String]) throws {
    let info = try Fixtures.deviceInfo(name)
    let sent = try JSONDecoder().decode(RegistrationBody.self, from: try #require(info.body))
    let kathmandu = try SearchResponse.decode(from: Fixtures.search("search-kathmandu")).results[0]
    // Every place the fixtures save, in the order the app saved them, each with its bell or not.
    var saved = ["nowhere-xx", "durham-gb", "york-gb", "aberdeen-gb", "edinburgh-gb"].map {
      SavedPlace(target: .city(slug: $0), name: $0)
    }
    saved.insert(SavedPlace(target: Target(search: kathmandu), name: "Kathmandu"), at: 2)
    let places = AlertSync.savedForBody(saved, bells: bells, owns: true)
    let body = AlertSync.body(
      token: sent.token, env: .sandbox, here: .ip, units: .c, prefs: AlertPrefs(evening: true),
      appVersion: "1.0 (42)", saved: places, deviceTz: "Europe/London")
    #expect(body == sent)
    #expect(body.deviceTz == "Europe/London")
    #expect(AlertSync.fingerprint(body) == AlertSync.fingerprint(sent))
    let json = try JSONSerialization.jsonObject(with: body.json)
    let fixture = try JSONSerialization.jsonObject(with: try #require(info.body))
    #expect(
      try JSONSerialization.data(withJSONObject: json, options: [.sortedKeys])
        == JSONSerialization.data(withJSONObject: fixture, options: [.sortedKeys]))
    // Without the purchase none is sent, and nor is the zone.
    let free = AlertSync.body(
      token: sent.token, env: .sandbox, here: .ip, units: .c, prefs: AlertPrefs(evening: true),
      appVersion: "1.0 (42)", saved: AlertSync.savedForBody(saved, bells: bells, owns: false),
      deviceTz: "Europe/London")
    #expect(free.saved.isEmpty)
    #expect(free.deviceTz == nil)
  }

  @Test("a body with saved places and the phone's zone reads back as itself, through Codable too")
  func savedBodysJSON() throws {
    let kathmandu = Target.Coordinates(
      source: .search, lat: 27.7, lon: 85.3, name: "Kathmandu / Nepal", region: "", country: "NP",
      geonameId: 0, elevation: 1337)
    let body = AlertSync.body(
      token: "a1b2", env: .production, here: .ip, units: .c, prefs: AlertPrefs(evening: true),
      appVersion: "1.0 (1)", saved: [.city(slug: "durham-gb", name: "Durham"), .coords(kathmandu)],
      deviceTz: "Asia/Kathmandu")
    // A city by its slug alone; a searched place by its point and the words it has, none empty,
    // and no geonameId of 0.
    #expect(
      body.saved == [
        .city(slug: "durham-gb"),
        .search(
          Target.Coordinates(
            source: .search, lat: 27.7, lon: 85.3, name: "Kathmandu / Nepal", country: "NP",
            elevation: 1337)),
      ])
    let text = String(decoding: body.json, as: UTF8.self)
    #expect(
      text
        == #"{"v":2,"app":"snow","platform":"ios","env":"production","token":"a1b2","units":"c","#
        + #""appVersion":"1.0 (1)","deviceTz":"Asia/Kathmandu","#
        + #""alerts":{"snow":{"evening":true,"morning":false,"possible":false}},"#
        + #""here":{"source":"ip"},"saved":[{"place":"durham-gb"},"#
        + #"{"lat":27.7,"lon":85.3,"source":"search","name":"Kathmandu / Nepal","country":"NP","#
        + #""elevation":1337}]}"#)
    #expect(try JSONDecoder().decode(RegistrationBody.self, from: body.json) == body)
    let encoded = try JSONEncoder().encode(body)
    #expect(try JSONDecoder().decode(RegistrationBody.self, from: encoded) == body)
    // The zone goes only with a saved place, and never empty.
    for (saved, zone) in [([Target](), "Europe/London"), ([.city(slug: "durham-gb")], "")] {
      let none = AlertSync.body(
        token: "a1b2", env: .production, here: .ip, units: .c, prefs: AlertPrefs(evening: true),
        appVersion: "1.0 (1)", saved: saved, deviceTz: zone)
      #expect(none.deviceTz == nil)
      #expect(!String(decoding: none.json, as: UTF8.self).contains("deviceTz"))
    }
  }

  @Test("a bell's tap reads back as itself from the client's JSON, `{ kind, bells?, prefs? }`")
  func bellTapJSON() throws {
    let evening = AlertPrefs(evening: true)
    let taps: [AlertSync.BellTap] = [
      .needsPurchase, .needsPermission, .denied, .on(bells: ["city:durham-gb"], prefs: evening),
      .onWithHere(bells: ["city:durham-gb"], prefs: evening), .off(bells: []),
    ]
    let json = try JSONEncoder().encode(taps)
    #expect(try JSONDecoder().decode([AlertSync.BellTap].self, from: json) == taps)
    let written = try #require(try JSONSerialization.jsonObject(with: json) as? [[String: Any]])
    #expect(
      written.map { $0["kind"] as? String } == [
        "needsPurchase", "needsPermission", "denied", "on", "onWithHere", "off",
      ])
    #expect(
      written.map { $0.keys.sorted() } == [
        ["kind"], ["kind"], ["kind"], ["bells", "kind", "prefs"], ["bells", "kind", "prefs"],
        ["bells", "kind"],
      ])
    let other = Data(#"{"kind":"ring"}"#.utf8)
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(AlertSync.BellTap.self, from: other)
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
