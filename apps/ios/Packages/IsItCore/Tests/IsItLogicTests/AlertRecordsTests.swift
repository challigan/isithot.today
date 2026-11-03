import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

/// The JSON object `data` holds.
private func object(_ data: Data) throws -> [String: Any] {
  try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
}

/// The server's record a reply stored, or nil for any other reply.
func storedResponse(_ reply: AlertSync.SyncReply) -> DeviceResponse? {
  guard case .stored(let response) = reply else { return nil }
  return response
}

/// The set the devices fixture `name` (a 200) holds.
func deviceResponse(_ name: String) throws -> DeviceResponse {
  let info = try Fixtures.deviceInfo(name)
  return try #require(
    storedResponse(AlertSync.syncReply(status: info.status, body: info.reply, retryAfter: nil)),
    "\(name)")
}

/// The registration the devices fixture `name` (a version 2 PUT's 200) answered, sent in
/// `units`, as `alertSync.v2` keeps it.
func registration(_ name: String, units: Units = .c) throws -> AlertRegistration {
  let info = try Fixtures.deviceInfo(name)
  return AlertRegistration(
    fingerprint: "{\"alerts\":{}}", at: try #require(ApiJSON.parseDate(info.now)),
    token: String(repeating: "0f", count: 32), env: .sandbox, units: units,
    response: try deviceResponse(name))
}

/// What the app keeps for its notifications (`alerts.v2` and `alertSync.v2`), what the server's
/// replies mean, and the small rules beside them: the token's hex, the version a registration
/// sends.
@Suite("Notification records and replies")
struct AlertRecordsTests {
  @Test(
    "alerts.v2 reads back as itself: the switches, the phone's last cell, the bells",
    arguments: [
      AlertSettings(prefs: AlertPrefs(evening: true, possible: true)),
      AlertSettings(prefs: AlertPrefs(morning: true), here: KeptCell(lat: 53.8, lon: -1.55)),
      AlertSettings(
        prefs: AlertPrefs(evening: true), here: KeptCell(lat: -33.85, lon: 151.2),
        bells: ["city:durham-gb", "search:27.7,85.3"]),
    ])
  func alertsV2RoundTrips(_ settings: AlertSettings) throws {
    #expect(settings.v == 2)
    #expect(AlertSettings.version == 2)
    let stored = try settings.stored()
    #expect(AlertSettings(stored: stored) == settings)
    let json = try object(stored)
    #expect(json["v"] as? Int == 2)
    #expect((json["bells"] as? [String]) == settings.bells)
    if let here = settings.here {
      #expect(Set(json.keys) == ["v", "prefs", "here", "bells"])
      let kept = try #require(json["here"] as? [String: Any])
      #expect(Set(kept.keys) == ["lat", "lon"])
      #expect(kept["lat"] as? Double == here.lat)
      #expect(kept["lon"] as? Double == here.lon)
    } else {
      // Nothing kept while approximate: the key is left out.
      #expect(Set(json.keys) == ["v", "prefs", "bells"])
    }
  }

  @Test("alerts.v2 with nothing on keeps nothing, and the switches on are evening or morning")
  func alertsV2Off() throws {
    let off = AlertSettings()
    #expect(off.prefs == AlertPrefs())
    #expect(off.here == nil)
    #expect(off.bells.isEmpty)
    #expect(!off.anyOn)
    #expect(!AlertSettings(prefs: AlertPrefs(possible: true)).anyOn)
    #expect(AlertSettings(prefs: AlertPrefs(evening: true)).anyOn)
    #expect(AlertSettings(prefs: AlertPrefs(morning: true)).anyOn)
  }

  @Test(
    "alerts.v2: a here that isn't a cell on Earth is dropped, and the rest kept",
    arguments: [
      #""here":null"#, #""here":"Leeds""#, #""here":{"lat":53.8}"#,
      #""here":{"lat":"53.8","lon":-1.55}"#, #""here":{"lat":91,"lon":0}"#,
      #""here":{"lat":0,"lon":-181}"#, #""here":[53.8,-1.55]"#,
    ])
  func alertsV2DropsABadCell(_ here: String) {
    let text =
      #"{"v":2,"prefs":{"evening":true,"morning":false,"possible":false},"# + here
      + #","bells":["city:durham-gb"]}"#
    #expect(
      AlertSettings(stored: Data(text.utf8))
        == AlertSettings(prefs: AlertPrefs(evening: true), bells: ["city:durham-gb"]))
  }

  @Test("alerts.v2: a bell that isn't text is dropped, and no list is none")
  func alertsV2DropsABadBell() {
    let prefs = #""prefs":{"evening":false,"morning":true,"possible":true}"#
    let cell = #""here":{"lat":53.8,"lon":-1.55}"#
    func read(_ bells: String) -> AlertSettings {
      AlertSettings(stored: Data((#"{"v":2,"# + prefs + "," + cell + bells + "}").utf8))
    }
    let kept = AlertSettings(
      prefs: AlertPrefs(morning: true, possible: true), here: KeptCell(lat: 53.8, lon: -1.55))
    #expect(read("") == kept)
    #expect(read(#","bells":null"#) == kept)
    #expect(read(#","bells":"city:durham-gb""#) == kept)
    #expect(read(#","bells":{"0":"city:durham-gb"}"#) == kept)
    var bells = kept
    bells.bells = ["city:durham-gb", "search:27.7,85.3"]
    #expect(read(#","bells":["city:durham-gb",7,null,{},"search:27.7,85.3",true]"#) == bells)
  }

  @Test(
    "alerts.v2: nothing, another version, 8.1's alerts.v1 or switches unread are all off, none kept",
    arguments: [
      nil, "{}", "[]", #""x""#, "<html>",
      // 8.1's alerts.v1, as its builds wrote it: never read, so an updated 8.1 install starts off.
      #"{"v":1,"prefs":{"evening":true,"morning":false,"possible":false},"#
        + #""place":{"follows":true,"target":{"kind":"coords","source":"device","lat":53.8,"#
        + #""lon":-1.55}}}"#,
      #"{"v":3,"prefs":{"evening":true,"morning":false,"possible":false},"bells":[]}"#,
      #"{"prefs":{"evening":true,"morning":false,"possible":false},"bells":[]}"#,
      #"{"v":"2","prefs":{"evening":true,"morning":false,"possible":false},"bells":[]}"#,
      #"{"v":2,"bells":[],"here":{"lat":53.8,"lon":-1.55}}"#,
      #"{"v":2,"prefs":{"evening":true},"here":{"lat":53.8,"lon":-1.55}}"#,
      #"{"v":2,"prefs":{"evening":1,"morning":false,"possible":false}}"#,
      #"{"v":2,"prefs":null,"here":{"lat":53.8,"lon":-1.55}}"#,
    ])
  func alertsV2DefaultsForAnythingElse(_ text: String?) {
    let settings = AlertSettings(stored: text.map { Data($0.utf8) })
    #expect(settings == AlertSettings())
    #expect(settings.prefs == AlertPrefs(evening: false, morning: false, possible: false))
    #expect(settings.here == nil)
    #expect(settings.bells.isEmpty)
  }

  @Test("alertSync.v2 reads back as itself, `at` written to the millisecond, nulls kept")
  func alertSyncV2RoundTrips() throws {
    for name in ["put-here-ip", "put-here-device", "put-here-refresh"] {
      let kept = try registration(name)
      #expect(kept.v == 2)
      let stored = try kept.stored()
      #expect(AlertRegistration(stored: stored) == kept, "\(name)")
      let json = try object(stored)
      #expect(
        Set(json.keys) == ["v", "fingerprint", "at", "token", "env", "units", "response"])
      #expect(json["v"] as? Int == 2)
      #expect(json["env"] as? String == "sandbox")
      #expect(json["units"] as? String == "c")
      // The answer as the server gave it, its nulls written as nulls.
      let response = try #require(json["response"] as? [String: Any])
      #expect(response["deviceTz"] is NSNull, "\(name)")
      #expect((response["saved"] as? [Any])?.isEmpty == true)
      #expect((response["refused"] as? [Any])?.isEmpty == true)
    }
    #expect(AlertRegistration.version == 2)
    let kept = try registration("put-here-ip")
    #expect(try object(try kept.stored())["at"] as? String == "2026-12-01T12:05:00.000Z")
    #expect(
      kept.sent
        == AlertSync.Sent(fingerprint: "{\"alerts\":{}}", at: Date(epochMs: 1_796_126_700_000)))
    // A set with no free place keeps its null, and a place with no country its own.
    let nowhere = DeviceResponse(
      id: kept.response.id, here: nil,
      saved: [
        DeviceResponse.Saved(
          pid: "0f1e2d3c4b5a", name: "Kathmandu", timezone: "Asia/Kathmandu",
          query: "lat=27.7&lon=85.3&name=Kathmandu&country=NP&source=search", country: nil)
      ],
      refused: [DeviceResponse.Refused(index: 1, code: "not_found")],
      alerts: kept.response.alerts, seenAt: kept.response.seenAt)
    var other = kept
    other.response = nowhere
    let stored = try other.stored()
    #expect(AlertRegistration(stored: stored) == other)
    let response = try #require(try object(stored)["response"] as? [String: Any])
    #expect(response["here"] is NSNull)
    let saved = try #require((response["saved"] as? [[String: Any]])?.first)
    #expect(saved["country"] is NSNull)
  }

  @Test("alertSync.v2: nothing, another version, 8.1's answer or no response is no registration")
  func alertSyncV2NilForAnythingElse() throws {
    #expect(AlertRegistration(stored: nil) == nil)
    var json = try object(try registration("put-here-ip").stored())
    json["v"] = 1
    #expect(AlertRegistration(stored: try JSONSerialization.data(withJSONObject: json)) == nil)
    json["v"] = 2
    #expect(AlertRegistration(stored: try JSONSerialization.data(withJSONObject: json)) != nil)
    // 8.1's answer, one place, as alertSync.v1 kept it.
    json["response"] = try JSONSerialization.jsonObject(
      with: Data(try Fixtures.deviceInfo("put-leeds").text.utf8))
    #expect(AlertRegistration(stored: try JSONSerialization.data(withJSONObject: json)) == nil)
    json["response"] = nil
    #expect(AlertRegistration(stored: try JSONSerialization.data(withJSONObject: json)) == nil)
    #expect(AlertRegistration(stored: Data("[]".utf8)) == nil)
  }

  @Test("the server's answer to put-here-ip is stored: the ID, where you are and what it follows")
  func theServersReplyDecodes() throws {
    let info = try Fixtures.deviceInfo("put-here-ip")
    #expect(info.request == "PUT /api/v1/devices")
    let reply = AlertSync.syncReply(status: info.status, body: info.reply, retryAfter: nil)
    let response = try #require(storedResponse(reply))
    #expect(response.id == "b8465956ef925aabc7c87a9e561f462d")
    #expect(response.deviceTz == nil)
    let here = try #require(response.here)
    #expect(here.name == "Leeds")
    #expect(here.timezone == "Europe/London")
    #expect(here.query == "lat=53.8&lon=-1.55&source=device")
    #expect(here.country == "GB")
    #expect(here.follows == .ip)
    #expect(Target(query: here.query) == .device(lat: 53.8, lon: -1.55))
    #expect(response.saved.isEmpty)
    #expect(response.refused.isEmpty)
    #expect(response.alerts.snow == AlertPrefs(evening: true))
    #expect(response.seenAt == "2026-12-01T12:05:00.000Z")
    // As the client's JSON, `{ kind, reply }`, and back.
    let json = try JSONEncoder().encode(reply)
    #expect(try Set(object(json).keys) == ["kind", "reply"])
    #expect(try JSONDecoder().decode(AlertSync.SyncReply.self, from: json) == reply)
    // The phone's location, and the connection again an hour later, now in Newcastle.
    #expect(try deviceResponse("put-here-device").here?.follows == .device)
    #expect(try deviceResponse("put-here-device").here?.name == "Leeds")
    let moved = try #require(try deviceResponse("put-here-refresh").here)
    #expect(moved.name == "Newcastle")
    #expect(moved.query == "lat=55&lon=-1.6&source=device")
    #expect(moved.follows == .ip)
  }

  @Test("every devices fixture means what the client says it means")
  func everyDevicesFixtureMapsAsTheClientSays() throws {
    let syncs: [String: AlertSync.SyncReply] = [
      // 8.1's answer to its version 1 body, which this app never sends, and couldn't read.
      "put-leeds": .failed,
      "put-twice": .retry(afterSeconds: 50),
      "delete": .forgotten,
      "rate-limited": .retry(afterSeconds: 60),
      // 8.4's sets.
      "put-here-ip": .stored(try deviceResponse("put-here-ip")),
      "put-here-device": .stored(try deviceResponse("put-here-device")),
      "put-here-refresh": .stored(try deviceResponse("put-here-refresh")),
      "put-unlocated": .placeRefused(
        message: "We couldn't tell where you are from your internet connection. Try again "
          + "later, or use your location."),
      // 8.4b's: saved places' bells, a gone city page, and the cap on new places.
      "put-here-ip-durham": .stored(try deviceResponse("put-here-ip-durham")),
      "put-here-ip-kathmandu": .stored(try deviceResponse("put-here-ip-kathmandu")),
      "put-here-ip-durham-kathmandu": .stored(try deviceResponse("put-here-ip-durham-kathmandu")),
      "put-refused": .stored(try deviceResponse("put-refused")),
      "put-capped": .retry(afterSeconds: 60),
    ]
    let tests: [String: AlertSync.TestOutcome] = [
      "test-sent": .sent(count: 1), "test-sent-two": .sent(count: 2), "test-dryrun": .dryRun,
      "test-limited": .limited,
      "test-quiet": .quiet, "test-gone": .notRegistered, "test-unregistered": .notRegistered,
      "test-down": .failed,
    ]
    let names = try Fixtures.deviceNames()
    #expect(names.sorted() == (Array(syncs.keys) + Array(tests.keys)).sorted())
    for name in names {
      let info = try Fixtures.deviceInfo(name)
      if info.request == "POST /api/v1/devices/test" {
        #expect(
          AlertSync.testOutcome(status: info.status, body: info.reply) == tests[name], "\(name)")
        continue
      }
      let reply = AlertSync.syncReply(
        status: info.status, body: info.reply, retryAfter: info.retryAfter)
      #expect(reply == syncs[name], "\(name)")
    }
    // Netlify's own 429 is a retry for a sync and a failure for a test.
    let limited = try Fixtures.deviceInfo("rate-limited")
    #expect(AlertSync.testOutcome(status: limited.status, body: limited.reply) == .failed)
    // Each set the app keeps is the server's reply, whole: written back, it reads the same.
    for name in [
      "put-here-ip", "put-here-device", "put-here-refresh", "put-here-ip-durham",
      "put-here-ip-kathmandu", "put-here-ip-durham-kathmandu", "put-refused",
    ] {
      let response = try deviceResponse(name)
      let written = try JSONEncoder().encode(response)
      #expect(try JSONDecoder().decode(DeviceResponse.self, from: written) == response)
      let sorted = { (data: Data) throws -> Data in
        try JSONSerialization.data(
          withJSONObject: try JSONSerialization.jsonObject(with: data), options: [.sortedKeys])
      }
      #expect(try sorted(written) == sorted(Data(try Fixtures.deviceInfo(name).text.utf8)))
    }
  }

  @Test("a test's outcome and a sync's reply read back as themselves from the client's JSON")
  func outcomesAsJSON() throws {
    let outcomes: [AlertSync.TestOutcome] = [
      .sent(count: 1), .sent(count: 2), .dryRun, .limited, .quiet, .notRegistered, .failed,
    ]
    let json = try JSONEncoder().encode(outcomes)
    #expect(try JSONDecoder().decode([AlertSync.TestOutcome].self, from: json) == outcomes)
    let written = try #require(try JSONSerialization.jsonObject(with: json) as? [[String: Any]])
    #expect(
      written.map { $0["kind"] as? String } == [
        "sent", "sent", "dryRun", "limited", "quiet", "notRegistered", "failed",
      ])
    #expect(written.map { $0["count"] as? Int } == [1, 2, nil, nil, nil, nil, nil])
    let replies: [AlertSync.SyncReply] = [
      .forgotten, .retry(afterSeconds: 50), .placeRefused(message: "There is no page."), .failed,
    ]
    let sync = try JSONEncoder().encode(replies)
    #expect(try JSONDecoder().decode([AlertSync.SyncReply].self, from: sync) == replies)
    let synced = try #require(try JSONSerialization.jsonObject(with: sync) as? [[String: Any]])
    #expect(
      synced.map { $0["kind"] as? String } == ["forgotten", "retry", "placeRefused", "failed"])
    #expect(synced[1]["afterSeconds"] as? Int == 50)
    #expect(synced[2]["message"] as? String == "There is no page.")
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

  @Test("the version a registration sends: \"1.0 (112)\", or none without both parts")
  func theWireVersion() {
    #expect(AppVersion.wire(AppVersion(version: "1.0", build: "112")) == "1.0 (112)")
    #expect(AppVersion.wire(nil) == "")
    #expect(AppVersion(version: "1.0", build: nil) == nil)
    #expect(AppVersion.wire(AppVersion(version: "1.0", build: nil)) == "")
  }
}
