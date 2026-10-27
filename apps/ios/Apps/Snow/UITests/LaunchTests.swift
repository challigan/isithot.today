import XCTest

/// The launch as it runs for real (iOS build spec, sections 9.4 and 9.5), without the fixture
/// hook: the app's own API client, URLSession transport and App Group store, with only the
/// network beneath them stubbed (`-network`, the URLProtocol stub in DebugHooks.swift). The stub
/// answers the request for approximate IP location with `ip-first-launch` (Leeds, at 12:05pm on
/// 1 December 2026, where the app's clock starts), and any other request with an error, so an
/// answer on screen means the app asked for the right place. `-network off` has no connection.
final class LaunchTests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  /// With nothing stored, the app asks by approximate IP location, so the first launch shows
  /// the phone's own place with no picker, and says the place is approximate.
  @MainActor
  func testFirstLaunchShowsTheApproximatePlace() throws {
    let app = launch(["-resetStore", "-network", "ip-first-launch"])
    XCTAssertTrue(app.staticTexts["verdict"].waitForExistence(timeout: 15), "No answer on screen")
    XCTAssertEqual(app.buttons["place"].label, "Place: Leeds. Change place.")
    XCTAssertEqual(heading(in: app).label, "Leeds. Will it snow today? No.")
    XCTAssertEqual(app.staticTexts["verdict"].label, "Rain, not snow.")
    XCTAssertTrue(app.buttons["use-my-location"].exists, "No \"Use my exact location\" chip")
    XCTAssertEqual(app.staticTexts["updated"].label, "Updated 12:05pm GMT")
    XCTAssertFalse(app.staticTexts["notice"].exists, "An offline or stale line while online")
    attachScreen(of: app, named: "app-first-launch")
  }

  /// Opened again a quarter of an hour later with no connection, the app paints the answer it
  /// saved, keeps it after the fetch fails, and the footer says since when.
  @MainActor
  func testOfflineRelaunchKeepsTheSavedAnswer() throws {
    let first = launch(["-resetStore", "-network", "ip-first-launch"])
    XCTAssertTrue(first.staticTexts["verdict"].waitForExistence(timeout: 15), "No answer saved")
    first.terminate()

    // ip-first-launch's moment plus 15 minutes: too old to keep without asking (10 minutes),
    // and still its own hour.
    let app = launch(["-network", "off", "-now", "2026-12-01T12:20:00.000Z"])
    let notice = app.staticTexts["notice"]
    XCTAssertTrue(notice.waitForExistence(timeout: 15), "No offline line")
    XCTAssertEqual(notice.label, "You're offline. Showing the forecast from 12:05pm GMT.")
    XCTAssertEqual(heading(in: app).label, "Leeds. Will it snow today? No.")
    XCTAssertEqual(app.staticTexts["verdict"].label, "Rain, not snow.")
    XCTAssertFalse(app.buttons["retry"].exists, "Retry over an answer")
    attachScreen(of: app, named: "app-offline-saved")
  }

  /// With nothing saved and no connection, there is no recent forecast to show, and Retry.
  @MainActor
  func testOfflineWithNothingSaved() throws {
    let app = launch(["-resetStore", "-network", "off"])
    XCTAssertTrue(app.buttons["retry"].waitForExistence(timeout: 15), "No Retry")
    XCTAssertEqual(
      heading(in: app).label,
      "Will it snow today? No recent forecast. Connect to the internet to refresh.")
    XCTAssertEqual(app.buttons["place"].label, "Finding you…, change place.")
    XCTAssertFalse(app.staticTexts["verdict"].exists, "A verdict with no answer")
    attachScreen(of: app, named: "app-offline-nothing")
  }

  /// Launches the app with `-uitest`, `-noads 1` (no consent form or ad, as `launchApp`) and
  /// `arguments`, and waits for the heading. The stub is beneath the app's own transport only:
  /// Google's SDKs would reach the real network, under `-network off` too.
  @MainActor
  private func launch(_ arguments: [String]) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-uitest", "-noads", "1"] + arguments
    app.launch()
    XCTAssertTrue(heading(in: app).waitForExistence(timeout: 15), "No heading on screen")
    return app
  }

  /// The question and the answer: one heading element, whatever type XCUITest gives it.
  @MainActor
  private func heading(in app: XCUIApplication) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: "heading").firstMatch
  }

  @MainActor
  private func attachScreen(of app: XCUIApplication, named name: String) {
    // PNG, as the contact sheet reads it.
    let png = app.screenshot().pngRepresentation
    let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
