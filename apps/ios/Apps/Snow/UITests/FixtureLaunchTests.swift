import XCTest

/// The app shows the fixture it is launched with (`-uitest -fixture <name>`, the Debug hooks in
/// section 9.8), at the fixture's own moment, on the Today page: the place in the top bar, the
/// question and answer as one heading with the place, as VoiceOver reads it (section 16), and the
/// verdict. The screen is attached to the result bundle for the contact sheet.
final class FixtureLaunchTests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  @MainActor
  func testAberdeenSnow() throws {
    let app = launch(fixture: "aberdeen-snow")
    XCTAssertEqual(app.buttons["place"].label, "Place: Aberdeen. Change place.")
    XCTAssertEqual(heading(in: app).label, "Aberdeen. Will it snow today? Yes.")
    XCTAssertEqual(app.staticTexts["verdict"].label, "It'll snow.")
    attachScreen(of: app, named: "app-aberdeen-snow")
  }

  @MainActor
  func testLeedsDry() throws {
    let app = launch(fixture: "leeds-dry")
    XCTAssertEqual(app.buttons["place"].label, "Place: Leeds. Change place.")
    XCTAssertEqual(heading(in: app).label, "Leeds. Will it snow today? No.")
    XCTAssertEqual(app.staticTexts["verdict"].label, "Rain, not snow.")
    attachScreen(of: app, named: "app-leeds-dry")
  }

  /// From 6pm at the place, the middle page answers for tomorrow.
  @MainActor
  func testDurhamTomorrow() throws {
    let app = launch(fixture: "durham-tomorrow")
    XCTAssertEqual(app.buttons["place"].label, "Place: Durham. Change place.")
    XCTAssertEqual(heading(in: app).label, "Durham. Will it snow tomorrow? Yes.")
    XCTAssertEqual(app.staticTexts["verdict"].label, "It'll snow.")
    attachScreen(of: app, named: "app-durham-tomorrow")
  }

  /// Past the last hour it can be shown, the answer is never shown as current.
  @MainActor
  func testOldForecast() throws {
    let app = launch(fixture: "old-forecast", waitingFor: nil)
    XCTAssertEqual(
      heading(in: app).label,
      "Durham. Will it snow tomorrow? No recent forecast. Connect to the internet to refresh.")
    XCTAssertFalse(app.staticTexts["verdict"].exists, "An old answer's verdict is on screen")
    attachScreen(of: app, named: "app-old-forecast")
  }

  /// Launches the app on `fixture` and waits for its heading and, unless `waitingFor` is nil,
  /// the element only an answer shows (the verdict).
  @MainActor
  private func launch(fixture: String, waitingFor element: String? = "verdict") -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-uitest", "-fixture", fixture]
    app.launch()
    XCTAssertTrue(heading(in: app).waitForExistence(timeout: 15), "No heading on screen")
    if let element {
      XCTAssertTrue(app.staticTexts[element].waitForExistence(timeout: 15), "No answer on screen")
    }
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
