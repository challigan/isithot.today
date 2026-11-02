import Foundation
import IsItLogic
import IsItModel
import IsItNotifications
import UserNotifications
import XCTest

/// The app's notifications as the host app has them (phase 8.1; iOS build spec, sections 12.1
/// to 12.4): the centre's delegate set before the launch finished, the payload handed to the
/// router as JSON, the permission read as `AlertSync` knows it, and the APNs environment a Debug
/// build registers in. The host's `WillItSnowApp.init` and app delegate run, but not its launch
/// (`DebugHooks.launches()`), so nothing here prompts or registers.
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
