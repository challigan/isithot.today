import Foundation
import IsItLogic
import IsItModel
import IsItNotifications
import UserNotifications
import XCTest

/// The app's notifications as the host app has them (phase 8.1; iOS build spec, sections 12.1
/// to 12.4): the centre's delegate set before the launch finished, the payload handed to the
/// router as JSON, the permission read as `AlertSync` knows it, the APNs environment a Debug
/// build registers in, and (phase 8.4a, design 4.2) the version 2 keys as the app's own defaults
/// keep them (`NotificationDefaults`), each test on a defaults suite of its own. The host's
/// `WillItSnowApp.init` and app delegate run, but not its launch (`DebugHooks.launches()`), so
/// nothing here prompts or registers.
///
/// Nothing reads a singleton of the app's modules: the bundle links IsItKit's products
/// statically beside the host (project.yml), so it holds a second copy of each type, and an
/// object the app made is not an instance of the bundle's copy. The delegate is told by its
/// type's name instead.
@MainActor
final class NotificationTests: XCTestCase {
  /// Apple: the delegate must be set "before your app finishes launching", or a tap that
  /// launched the app is missed. The app delegate sets it in `willFinishLaunchingWithOptions`
  /// (the host ran without `-uitest`, so the real centre is the app's).
  func testTheCentresDelegateIsSetBeforeTheLaunchFinishes() throws {
    let delegate = try XCTUnwrap(
      UNUserNotificationCenter.current().delegate,
      "The centre has no delegate: a tap that launched the app would open nothing"
    )
    XCTAssertEqual(
      String(reflecting: type(of: delegate)), "IsItNotifications.NotificationDelegate")
  }

  /// T2 (section 12.4): a tap's payload, the server's own (`Fixtures/Payloads`), as the system
  /// gives it (`userInfo`, `aps` and all), through the delegate's JSON to the router: Durham's
  /// page on Today, as the dictionary itself routes. A `UNNotificationResponse` can't be made, so
  /// the witnesses' few lines are the banner step's and Carl's phone's.
  func testTheDelegatePassesThePayloadToTheRouter() throws {
    let userInfo = try XCTUnwrap(
      JSONSerialization.jsonObject(with: payload("durham-evening")) as? [AnyHashable: Any])
    let now = try XCTUnwrap(ApiJSON.parseDate("2026-12-16T18:05:00.000Z"))
    let zones = ["city:durham-gb": "Europe/London"]
    let json = try XCTUnwrap(NotificationDelegate.json(userInfo))
    let route = NotificationRouter.route(json: json, now: now, zones: zones)
    XCTAssertEqual(route, .place(.city(slug: "durham-gb", name: "Durham"), view: .today))
    let direct = DeepLink.route(payload: userInfo) { target in
      zones[target.key].map { PlaceTime.local(now, in: $0) }
    }
    XCTAssertEqual(route, direct)
  }

  /// A payload JSON can't hold (a date) has no JSON, and routes nowhere: the app opens as usual.
  func testAPayloadJSONCantHoldRoutesNowhere() {
    let userInfo: [AnyHashable: Any] = ["topic": "snow", "date": Date()]
    let json = NotificationDelegate.json(userInfo)
    XCTAssertNil(json)
    XCTAssertNil(NotificationRouter.route(json: json, now: Date(), zones: [:]))
  }

  /// Decision 8: `ephemeral` (App Clips only) and a status still to come are authorized, which
  /// changes nothing; as not determined, a status to come would turn the switches off and forget
  /// a record the server may still be sending to.
  func testEveryAuthorisationStatusMaps() throws {
    let expected: [(UNAuthorizationStatus, AlertSync.Permission)] = [
      (.notDetermined, .notDetermined),
      (.denied, .denied),
      (.authorized, .authorized),
      (.provisional, .provisional),
      (.ephemeral, .authorized),
    ]
    for (status, permission) in expected {
      XCTAssertEqual(
        UserNotificationsPlatform.permission(status), permission, "status \(status.rawValue)")
    }
    let toCome = try XCTUnwrap(UNAuthorizationStatus(rawValue: 99))
    XCTAssertEqual(UserNotificationsPlatform.permission(toCome), .authorized)
  }

  /// Banners and sounds, and iOS Settings' link back to the app's notification settings; no
  /// badge, no provisional authorisation (section 12.2).
  func testTheOptionsAskForBannersSoundsAndTheSettingsLink() {
    XCTAssertEqual(
      UserNotificationsPlatform.options, [.alert, .sound, .providesAppNotificationSettings])
  }

  /// Decision 20: the registration names the sandbox in a Debug build (`PUSH_ENV`), as its
  /// development profile's token is; `check-archive.sh` proves a Release archive says production.
  func testADebugBuildRegistersInTheSandbox() {
    XCTAssertEqual(
      Bundle.main.object(forInfoDictionaryKey: "IsItPushEnvironment") as? String, "sandbox")
  }

  /// Design 4.2: `alerts.v2` in the defaults, through `NotificationDefaults`: version 2, the
  /// switches, the phone's cell for where you are and no bell, read back as written, and nothing
  /// under 8.1's key.
  func testTheSettingsKeepVersion2UnderAlertsV2() throws {
    let defaults = try scratchDefaults()
    let store = NotificationDefaults(defaults: defaults)
    let settings = AlertSettings(
      prefs: AlertPrefs(evening: true, possible: true), here: KeptCell(lat: 53.8, lon: -1.55))
    store.saveSettings(settings)
    XCTAssertEqual(Keys.App.alerts, "alerts.v2")
    XCTAssertEqual(store.loadSettings(), settings)
    let json = try object(defaults.data(forKey: "alerts.v2"), "Nothing under alerts.v2")
    XCTAssertEqual(json["v"] as? Int, 2)
    let here = try XCTUnwrap(json["here"] as? [String: Double], "No cell for where you are")
    XCTAssertEqual(here, ["lat": 53.8, "lon": -1.55])
    XCTAssertEqual(json["bells"] as? [String], [])
    XCTAssertNil(defaults.object(forKey: "alerts.v1"), "Something under 8.1's key")
  }

  /// `alertSync.v2`: the registration put-here-ip's reply made (`Fixtures/Devices`, the server's
  /// own), read back as written, its reply's nulls kept as nulls; nothing once removed.
  func testTheRegistrationKeepsVersion2UnderAlertSyncV2() throws {
    let defaults = try scratchDefaults()
    let store = NotificationDefaults(defaults: defaults)
    let registration = try hereIPRegistration()
    store.saveRegistration(registration)
    XCTAssertEqual(Keys.App.alertSync, "alertSync.v2")
    XCTAssertEqual(store.loadRegistration(), registration)
    let json = try object(defaults.data(forKey: "alertSync.v2"), "Nothing under alertSync.v2")
    XCTAssertEqual(json["v"] as? Int, 2)
    let response = try XCTUnwrap(json["response"] as? [String: Any], "No reply kept")
    XCTAssertTrue(response["deviceTz"] is NSNull, "The reply's deviceTz isn't kept as null")
    let here = try XCTUnwrap(response["here"] as? [String: Any], "No where you are kept")
    XCTAssertEqual(here["name"] as? String, "Leeds")
    XCTAssertEqual(here["follows"] as? String, "ip")
    XCTAssertNil(defaults.object(forKey: "alertSync.v1"), "Something under 8.1's key")
    store.saveRegistration(nil)
    XCTAssertNil(defaults.object(forKey: "alertSync.v2"))
    XCTAssertNil(store.loadRegistration())
  }

  /// Decision 28, no migration: another version under the new keys (8.1's version 1) is nothing
  /// kept, every switch off and no registration, as is anything that doesn't read.
  func testAnotherVersionIsNothingKept() throws {
    let defaults = try scratchDefaults()
    let store = NotificationDefaults(defaults: defaults)
    let first = #"{"v":1,"prefs":{"evening":true,"morning":true,"possible":false}}"#
    defaults.set(Data(first.utf8), forKey: Keys.App.alerts)
    XCTAssertEqual(store.loadSettings(), AlertSettings())
    var json = try object(try hereIPRegistration().stored(), "The registration has no JSON")
    json["v"] = 1
    defaults.set(try JSONSerialization.data(withJSONObject: json), forKey: Keys.App.alertSync)
    XCTAssertNil(store.loadRegistration())
    defaults.set(Data("not JSON".utf8), forKey: Keys.App.alerts)
    XCTAssertEqual(store.loadSettings(), AlertSettings())
  }

  /// `-resetStore`'s `removeAll()` forgets the three keys: the switches, the registration and the
  /// card's being put away.
  func testRemoveAllForgetsTheThreeKeys() throws {
    let defaults = try scratchDefaults()
    let store = NotificationDefaults(defaults: defaults)
    store.saveSettings(AlertSettings(prefs: AlertPrefs(evening: true)))
    store.saveRegistration(try hereIPRegistration())
    store.saveCardDismissed(true)
    store.removeAll()
    for key in [Keys.App.alerts, Keys.App.alertSync, Keys.App.card] {
      XCTAssertNil(defaults.object(forKey: key), "\(key) is still kept")
    }
    XCTAssertEqual(store.loadSettings(), AlertSettings())
    XCTAssertNil(store.loadRegistration())
    XCTAssertFalse(store.loadCardDismissed())
  }

  /// A defaults suite of this test's own, removed when it ends, so no test reads or leaves the
  /// app's.
  private func scratchDefaults() throws -> UserDefaults {
    let suite = "NotificationTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite), "No defaults suite \(suite)")
    addTeardownBlock { defaults.removePersistentDomain(forName: suite) }
    return defaults
  }

  /// The registration `alertSync.v2` keeps after put-here-ip's PUT: its body's fingerprint,
  /// token, APNs and units, sent at the fixture's moment, and the server's reply.
  private func hereIPRegistration() throws -> AlertRegistration {
    let url = try XCTUnwrap(
      Bundle(for: Self.self).url(
        forResource: "put-here-ip", withExtension: "json", subdirectory: "Fixtures/Devices"),
      "No Fixtures/Devices/put-here-ip.json in the test bundle"
    )
    let fixture = try JSONDecoder().decode(DevicesFixture.self, from: Data(contentsOf: url))
    let body = fixture.note.body
    return AlertRegistration(
      fingerprint: AlertSync.fingerprint(body),
      at: try XCTUnwrap(ApiJSON.parseDate(fixture.note.now)),
      token: body.token,
      env: body.env,
      units: body.units,
      response: try JSONDecoder().decode(DeviceResponse.self, from: Data(fixture.text.utf8))
    )
  }

  /// `data` as a JSON object, failing with `message` without one.
  private func object(_ data: Data?, _ message: String) throws -> [String: Any] {
    let data = try XCTUnwrap(data, message)
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any], message)
  }

  /// A devices fixture (`Fixtures/Devices`) as far as these tests read it: its request's body
  /// and moment, and the server's reply.
  private struct DevicesFixture: Decodable {
    struct Note: Decodable {
      let body: RegistrationBody
      let now: String
    }

    let note: Note
    let text: String

    enum CodingKeys: String, CodingKey {
      case note = "_fixture"
      case text
    }
  }

  /// A payload `pnpm mobile:generate` wrote (`Fixtures/Payloads/<name>.json`), from this test
  /// bundle's own copy.
  private func payload(_ name: String) throws -> Data {
    let url = try XCTUnwrap(
      Bundle(for: Self.self).url(
        forResource: name, withExtension: "json", subdirectory: "Fixtures/Payloads"),
      "No Fixtures/Payloads/\(name).json in the test bundle"
    )
    return try Data(contentsOf: url)
  }
}
