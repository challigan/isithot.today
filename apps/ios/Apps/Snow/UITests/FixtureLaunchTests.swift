import XCTest

/// The app shows the fixture it is launched with (`-uitest -fixture <name>`, the Debug hooks in
/// section 9.8), and the screen is attached to the result bundle for the contact sheet.
final class FixtureLaunchTests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  @MainActor
  func testAberdeenSnow() throws {
    let app = launch(fixture: "aberdeen-snow")
    XCTAssertEqual(app.staticTexts["place"].label, "Aberdeen")
    XCTAssertEqual(app.staticTexts["answer"].label, "Yes.")
    XCTAssertEqual(app.staticTexts["verdict"].label, "It'll snow.")
    attachScreen(of: app, named: "app-aberdeen-snow")
  }

  @MainActor
  func testLeedsDry() throws {
    let app = launch(fixture: "leeds-dry")
    XCTAssertEqual(app.staticTexts["place"].label, "Leeds")
    XCTAssertEqual(app.staticTexts["answer"].label, "No.")
    XCTAssertEqual(app.staticTexts["verdict"].label, "Rain, not snow.")
    attachScreen(of: app, named: "app-leeds-dry")
  }

  /// Launches the app on `fixture` and waits for its answer.
  @MainActor
  private func launch(fixture: String) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-uitest", "-fixture", fixture]
    app.launch()
    XCTAssertTrue(app.staticTexts["answer"].waitForExistence(timeout: 15), "No answer on screen")
    return app
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
