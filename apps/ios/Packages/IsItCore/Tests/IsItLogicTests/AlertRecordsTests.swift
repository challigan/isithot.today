import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

/// Leeds, a city page, as the screen names it.
private let leeds = Target.city(slug: "leeds-gb", name: "Leeds")

/// The phone's own point in Leeds, on the forecast grid.
private let leedsCell = Target.device(lat: 53.8, lon: -1.55)

/// Kathmandu as the search found it.
private let kathmandu = Target.coords(
  Target.Coordinates(source: .search, lat: 27.7, lon: 85.3, name: "Kathmandu", country: "NP"))

/// The JSON object `data` holds.
private func object(_ data: Data) throws -> [String: Any] {
  try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
}

/// The server's record a reply stored, or nil for any other reply.
func storedResponse(_ reply: AlertSync.SyncReply) -> DeviceResponse? {
  guard case .stored(let response) = reply else { return nil }
  return response
}

/// The record the devices fixture `name` (a 200) holds.
func deviceResponse(_ name: String) throws -> DeviceResponse {
  let info = try Fixtures.deviceInfo(name)
  return try #require(
    storedResponse(AlertSync.syncReply(status: info.status, body: info.reply, retryAfter: nil)),
    "\(name)")
}

/// The registration the devices fixture `name` (a PUT's 200) answered, sent in `units`, as
/// `alertSync.v1` keeps it.
func registration(_ name: String, units: Units = .c) throws -> AlertRegistration {
  let info = try Fixtures.deviceInfo(name)
  return AlertRegistration(
    fingerprint: "{\"alerts\":{}}", at: try #require(ApiJSON.parseDate(info.now)),
    token: String(repeating: "0f", count: 32), env: .sandbox, units: units,
    response: try deviceResponse(name))
}

/// What the app keeps for its notifications (`alerts.v1` and `alertSync.v1`), what the server's
/// replies mean, and the small rules beside them: the token's hex, the place's country, the
/// version a registration sends.
@Suite("Notification records and replies")
struct AlertRecordsTests {
  @Test(
    "alerts.v1 reads back as itself: a chosen city, a followed cell, a searched place",
    arguments: [
      AlertPlace.chosen(leeds, name: "Leeds"), .follows(leedsCell), .chosen(kathmandu, name: ""),
    ])
  func alertsV1RoundTrips(_ place: AlertPlace) throws {
    let settings = AlertSettings(prefs: AlertPrefs(evening: true, possible: true), place: place)
    #expect(settings.v == 1)
    #expect(AlertSettings.version == 1)
    let stored = try settings.stored()
    #expect(AlertSettings(stored: stored) == settings)
    let json = try object(stored)
    #expect(Set(json.keys) == ["v", "prefs", "place"])
    #expect(json["v"] as? Int == 1)
    let kept = try #require(json["place"] as? [String: Any])
    switch place {
    case .chosen(_, let name):
      #expect(Set(kept.keys) == ["follows", "target", "name"])
      #expect(kept["follows"] as? Bool == false)
      #expect(kept["name"] as? String == name)
    case .follows:
      #expect(Set(kept.keys) == ["follows", "target"])
      #expect(kept["follows"] as? Bool == true)
    }
    let target = try JSONSerialization.data(withJSONObject: try #require(kept["target"]))
    #expect(try JSONDecoder().decode(Target.self, from: target) == place.target)
  }

  @Test("alerts.v1 with no place leaves it out, and the switches on are evening or morning")
  func alertsV1WithoutAPlace() throws {
    let off = AlertSettings()
    #expect(off.prefs == AlertPrefs())
    #expect(off.place == nil)
    #expect(Set(try object(try off.stored()).keys) == ["v", "prefs"])
    #expect(!off.anyOn)
    #expect(!AlertSettings(prefs: AlertPrefs(possible: true)).anyOn)
    #expect(AlertSettings(prefs: AlertPrefs(evening: true)).anyOn)
    #expect(AlertSettings(prefs: AlertPrefs(morning: true)).anyOn)
  }

  @Test(
    "alerts.v1: nothing, another version or anything unreadable is every switch off, no place",
    arguments: [
      nil, "{}", #"{"v":2,"prefs":{"evening":true,"morning":false,"possible":false}}"#, "[]",
      #""x""#, #"{"v":1,"prefs":{"evening":true}}"#,
      // Approximate IP location is never a notification place.
      #"{"v":1,"prefs":{"evening":true,"morning":false,"possible":false},"#
        + #""place":{"follows":false,"target":{"kind":"ip"},"name":""}}"#,
    ])
  func alertsV1DefaultsForAnythingElse(_ text: String?) {
    let settings = AlertSettings(stored: text.map { Data($0.utf8) })
    #expect(settings == AlertSettings())
    #expect(settings.prefs == AlertPrefs(evening: false, morning: false, possible: false))
    #expect(settings.place == nil)
  }

  @Test("alertSync.v1 reads back as itself, `at` written to the millisecond")
  func alertSyncV1RoundTrips() throws {
    let kept = try registration("put-leeds")
    #expect(kept.v == 1)
    #expect(AlertRegistration.version == 1)
    let stored = try kept.stored()
    #expect(AlertRegistration(stored: stored) == kept)
    let json = try object(stored)
    #expect(
      Set(json.keys) == ["v", "fingerprint", "at", "token", "env", "units", "response"])
    #expect(json["at"] as? String == "2026-12-01T09:05:00.000Z")
    #expect(json["env"] as? String == "sandbox")
    #expect(json["units"] as? String == "c")
    #expect(
      kept.sent
        == AlertSync.Sent(fingerprint: "{\"alerts\":{}}", at: Date(epochMs: 1_796_115_900_000)))
  }

  @Test("alertSync.v1: nothing, another version or a missing response is no registration")
  func alertSyncV1NilForAnythingElse() throws {
    #expect(AlertRegistration(stored: nil) == nil)
    var json = try object(try registration("put-leeds").stored())
    json["v"] = 2
    #expect(AlertRegistration(stored: try JSONSerialization.data(withJSONObject: json)) == nil)
    json["v"] = 1
    #expect(AlertRegistration(stored: try JSONSerialization.data(withJSONObject: json)) != nil)
    json["response"] = nil
    #expect(AlertRegistration(stored: try JSONSerialization.data(withJSONObject: json)) == nil)
    #expect(AlertRegistration(stored: Data("[]".utf8)) == nil)
  }

  @Test("the server's reply to put-leeds is stored: the ID, the place, its zone and query")
  func theServersReplyDecodes() throws {
    let info = try Fixtures.deviceInfo("put-leeds")
    #expect(info.request == "PUT /api/v1/devices")
    let reply = AlertSync.syncReply(status: info.status, body: info.reply, retryAfter: nil)
    let response = try #require(storedResponse(reply))
    #expect(response.id.count == 32)
    #expect(response.place.name == "Leeds")
    #expect(response.place.timezone == "Europe/London")
    #expect(response.place.query == "place=leeds-gb")
    #expect(Target(query: response.place.query) == .city(slug: "leeds-gb"))
    #expect(response.alerts.snow == AlertPrefs(evening: true))
    #expect(response.seenAt == "2026-12-01T09:05:00.000Z")
    // As the client's JSON, `{ kind, reply }`, and back.
    let json = try JSONEncoder().encode(reply)
    #expect(try Set(object(json).keys) == ["kind", "reply"])
    #expect(try JSONDecoder().decode(AlertSync.SyncReply.self, from: json) == reply)
  }

  @Test("every devices fixture means what the client says it means")
  func everyDevicesFixtureMapsAsTheClientSays() throws {
    let syncs: [String: AlertSync.SyncReply] = [
      "delete": .forgotten,
      "put-bad-place": .placeRefused(message: "There is no page for that place."),
      "put-twice": .retry(afterSeconds: 50),
      "rate-limited": .retry(afterSeconds: 60),
    ]
    let tests: [String: AlertSync.TestOutcome] = [
      "test-sent": .sent, "test-dryrun": .dryRun, "test-limited": .limited, "test-quiet": .quiet,
      "test-gone": .notRegistered, "test-unregistered": .notRegistered, "test-down": .failed,
    ]
    let stored = ["put-device", "put-durham", "put-kathmandu", "put-leeds"]
    let names = try Fixtures.deviceNames()
    #expect(names.sorted() == (Array(syncs.keys) + Array(tests.keys) + stored).sorted())
    for name in names {
      let info = try Fixtures.deviceInfo(name)
      if info.request == "POST /api/v1/devices/test" {
        #expect(
          AlertSync.testOutcome(status: info.status, body: info.reply) == tests[name], "\(name)")
        continue
      }
      let reply = AlertSync.syncReply(
        status: info.status, body: info.reply, retryAfter: info.retryAfter)
      if let expected = syncs[name] {
        #expect(reply == expected, "\(name)")
      } else {
        let response = try #require(storedResponse(reply), "\(name)")
        #expect(stored.contains(name), "\(name)")
        #expect(Target(query: response.place.query) != nil, "\(name)")
      }
    }
    // Netlify's own 429 is a retry for a sync and a failure for a test.
    let limited = try Fixtures.deviceInfo("rate-limited")
    #expect(AlertSync.testOutcome(status: limited.status, body: limited.reply) == .failed)
    #expect(try deviceResponse("put-kathmandu").place.timezone == "Asia/Kathmandu")
    #expect(try deviceResponse("put-durham").place.name == "Durham")
    // The server names the phone's cell itself.
    #expect(try deviceResponse("put-device").place.name == "Leeds")
  }

  @Test("a test's outcome reads back as itself from the client's JSON, a string")
  func outcomesAsJSON() throws {
    for outcome in AlertSync.TestOutcome.allCases {
      let json = try JSONEncoder().encode([outcome])
      #expect(try JSONDecoder().decode([AlertSync.TestOutcome].self, from: json) == [outcome])
    }
    #expect(
      AlertSync.TestOutcome.allCases.map(\.rawValue) == [
        "sent", "dryRun", "limited", "quiet", "notRegistered", "failed",
      ])
    let replies: [AlertSync.SyncReply] = [
      .forgotten, .retry(afterSeconds: 50), .placeRefused(message: "There is no page."), .failed,
    ]
    let json = try JSONEncoder().encode(replies)
    #expect(try JSONDecoder().decode([AlertSync.SyncReply].self, from: json) == replies)
    let written = try #require(try JSONSerialization.jsonObject(with: json) as? [[String: Any]])
    #expect(
      written.map { $0["kind"] as? String } == ["forgotten", "retry", "placeRefused", "failed"])
    #expect(written[1]["afterSeconds"] as? Int == 50)
    #expect(written[2]["message"] as? String == "There is no page.")
  }

  @Test("a followed place moves only to the phone's fix in another cell, and nil means no move")
  func following() {
    let next = Target.device(lat: 53.85, lon: -1.55)
    #expect(AlertSync.following(.follows(leedsCell), fix: next) == .follows(next))
    #expect(AlertSync.following(.follows(leedsCell), fix: leedsCell) == nil)
    #expect(AlertSync.following(.chosen(leeds, name: "Leeds"), fix: next) == nil)
    #expect(AlertSync.following(.follows(leedsCell), fix: kathmandu) == nil)
    #expect(AlertSync.following(.follows(leedsCell), fix: .ip) == nil)
    #expect(AlertSync.following(nil, fix: next) == nil)
  }

  @Test("the push token is each byte as two lowercase hex digits")
  func pushTokenIsLowercaseHex() {
    #expect(PushToken.hex(Data([0x0f, 0xa0, 0xff])) == "0fa0ff")
    #expect(PushToken.hex(Data()) == "")
    let token = PushToken.hex(Data((0..<32).map { UInt8($0 * 8) }))
    #expect(token.count == 64)
    #expect(token.hasPrefix("0008101820"))
    #expect(token.allSatisfy { "0123456789abcdef".contains($0) })
    #expect(PushToken.hex(Data(repeating: 0x0f, count: 32)) == String(repeating: "0f", count: 32))
  }

  @Test("the notification place's country, for the Met Office's warnings")
  func countryOfThePlace() {
    let leedsOnScreen = OnScreen(target: leeds, name: "Leeds", country: "GB", units: .c)
    let cellOnScreen = OnScreen(target: leedsCell, name: "Leeds", country: "GB", units: .c)
    #expect(AlertSync.country(of: .chosen(leeds, name: "Leeds"), onScreen: cellOnScreen) == "GB")
    let newYork = Target.city(slug: "new-york-city-us")
    #expect(AlertSync.country(of: .chosen(newYork, name: ""), onScreen: leedsOnScreen) == "US")
    #expect(
      AlertSync.country(of: .chosen(kathmandu, name: "Kathmandu"), onScreen: leedsOnScreen)
        == "NP")
    let nowhere = Target.coords(Target.Coordinates(source: .search, lat: 60.1, lon: 24.95))
    #expect(AlertSync.country(of: .chosen(nowhere, name: ""), onScreen: leedsOnScreen) == nil)
    // The phone's cell has no country of its own: the answer on screen's, while it shows it.
    #expect(AlertSync.country(of: .follows(leedsCell), onScreen: cellOnScreen) == "GB")
    #expect(AlertSync.country(of: .follows(leedsCell), onScreen: leedsOnScreen) == nil)
    let elsewhere = OnScreen(
      target: .device(lat: 51.5, lon: -0.1), name: "London", country: "GB", units: .c)
    #expect(AlertSync.country(of: .follows(leedsCell), onScreen: elsewhere) == nil)
    #expect(AlertSync.country(of: nil, onScreen: leedsOnScreen) == nil)
  }

  @Test("the version a registration sends: \"1.0 (112)\", or none without both parts")
  func theWireVersion() {
    #expect(AppVersion.wire(AppVersion(version: "1.0", build: "112")) == "1.0 (112)")
    #expect(AppVersion.wire(nil) == "")
    #expect(AppVersion(version: "1.0", build: nil) == nil)
    #expect(AppVersion.wire(AppVersion(version: "1.0", build: nil)) == "")
  }
}
