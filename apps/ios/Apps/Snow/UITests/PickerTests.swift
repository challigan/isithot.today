import XCTest

/// The place picker (iOS build spec, sections 10.3 and 17.2), over the app's own client and
/// store with only the network stubbed (`-network`, DebugHooks.swift): `ip-first-launch`
/// answers the launch's request for approximate IP location (Leeds, 12:05pm on 1 December 2026,
/// where the app's clock starts); each fixture named after it answers its own place
/// (`leeds-dry` for `place=leeds-gb`, `kathmandu-0545` for the point 27.7, 85.3); and the
/// picker's searches are answered by the search fixtures (`search-leeds`, `search-kathmandu`,
/// `search-none`), any other with an error. `-location` stands in for Core Location, so the
/// system's prompt never shows. Every launch starts from a clean store (`-resetStore`, the
/// recent places too) unless a test relaunches on purpose.
final class PickerTests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  /// One letter is too few; a place nowhere is no places found.
  @MainActor
  func testTooShortAndNoResults() throws {
    let app = launch(["-resetStore", "-network", "ip-first-launch"])
    let field = openPicker(in: app)
    field.typeText("X")
    let status = app.staticTexts["search-status"]
    XCTAssertTrue(status.waitForExistence(timeout: 10), "No line for too few letters")
    XCTAssertEqual(status.label, "Type at least 2 letters.")
    field.typeText("yzzy")
    wait(for: status, label: "No places found.")
    XCTAssertFalse(app.buttons["result-0"].exists, "A result for a place nowhere")
    attachScreen(of: app, named: "picker-no-results")
  }

  /// A result with a city page: "Leeds", with "England, United Kingdom" beneath; chosen, the
  /// sheet closes and Leeds loads, no longer on approximate location.
  @MainActor
  func testChoosingACityResult() throws {
    let app = launch(["-resetStore", "-network", "ip-first-launch,leeds-dry"])
    let field = openPicker(in: app)
    field.typeText("Leeds")
    let result = app.buttons["result-0"]
    XCTAssertTrue(result.waitForExistence(timeout: 10), "No results for Leeds")
    XCTAssertTrue(result.label.hasPrefix("Leeds"), result.label)
    XCTAssertTrue(result.label.contains("England, United Kingdom"), result.label)
    XCTAssertFalse(app.buttons["result-1"].exists, "More than search-leeds's one result")
    attachScreen(of: app, named: "picker-results")
    result.tap()
    waitUntilGone(searchField(in: app), "The picker is still open")
    wait(for: heading(in: app), label: "Leeds. Will it snow today? No.")
    XCTAssertEqual(app.buttons["place"].label, "Place: Leeds. Change place.")
    XCTAssertFalse(app.buttons["use-my-location"].exists, "Still on approximate location")
  }

  /// A result with no city page is its point on the grid, asked for with what the search said.
  @MainActor
  func testChoosingAPointResult() throws {
    // Kathmandu's answer's own moment: the launch's answer, for Leeds, is a day old by then.
    let app = launch([
      "-resetStore", "-network", "ip-first-launch,kathmandu-0545", "-now",
      "2026-12-02T11:50:00.000Z",
    ])
    let field = openPicker(in: app)
    field.typeText("Kathmandu")
    let result = app.buttons["result-0"]
    XCTAssertTrue(result.waitForExistence(timeout: 10), "No results for Kathmandu")
    XCTAssertTrue(result.label.contains("Bagmati Province, Nepal"), result.label)
    result.tap()
    wait(for: app.buttons["place"], label: "Place: Kathmandu. Change place.")
    XCTAssertTrue(heading(in: app).label.hasPrefix("Kathmandu. Will it snow "))
    XCTAssertTrue(app.staticTexts["verdict"].waitForExistence(timeout: 10), "No answer")
  }

  /// A chosen place is a recent place, kept across launches, chosen again from there, and
  /// swiped away.
  @MainActor
  func testRecentPlaces() throws {
    let first = launch(["-resetStore", "-network", "ip-first-launch,leeds-dry"])
    var field = openPicker(in: first)
    // Nothing chosen yet: no recent places.
    XCTAssertFalse(first.staticTexts["recent-heading"].exists, "Recent places on a clean store")
    field.typeText("Leeds")
    XCTAssertTrue(first.buttons["result-0"].waitForExistence(timeout: 10), "No results")
    first.buttons["result-0"].tap()
    wait(for: first.buttons["place"], label: "Place: Leeds. Change place.")
    first.terminate()

    // Kept: opened again, Leeds is there under Recent.
    let app = launch(["-network", "ip-first-launch,leeds-dry"])
    field = openPicker(in: app)
    let recent = app.staticTexts["recent-heading"]
    XCTAssertTrue(recent.waitForExistence(timeout: 10), "No recent places after a relaunch")
    XCTAssertEqual(recent.label, "Recent")
    let leeds = app.buttons["recent-city:leeds-gb"]
    XCTAssertTrue(leeds.exists, "Leeds isn't a recent place")
    XCTAssertEqual(leeds.label, "Leeds")
    attachScreen(of: app, named: "picker-recent")

    // Typing hides them, and shows the box's clear button, 44 points square (the system's
    // search, whose clear button was about 20, is gone: PlacePickerView's `SearchBox`).
    field.typeText("Le")
    waitUntilGone(recent, "Recent places while typing")
    let clear = app.buttons["clear-search"]
    XCTAssertTrue(clear.waitForExistence(timeout: 5), "No clear button with text typed")
    XCTAssertEqual(clear.label, "Clear search")
    XCTAssertGreaterThanOrEqual(clear.frame.width, 44, "The clear button at \(clear.frame)")
    XCTAssertGreaterThanOrEqual(clear.frame.height, 44, "The clear button at \(clear.frame)")
    field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 2))
    XCTAssertTrue(leeds.waitForExistence(timeout: 10), "No recent places once cleared")
    waitUntilGone(clear, "The clear button with nothing typed")

    // The clear button clears the box, and leaves it ready to type in.
    field.typeText("Le")
    waitUntilGone(recent, "Recent places while typing")
    XCTAssertTrue(clear.waitForExistence(timeout: 5), "No clear button with text typed")
    clear.tap()
    XCTAssertTrue(leeds.waitForExistence(timeout: 10), "No recent places once cleared")
    waitUntilGone(clear, "The clear button after clearing")
    XCTAssertTrue(app.keyboards.firstMatch.exists, "The keyboard went with the text")

    // Swiped away.
    leeds.swipeLeft()
    let delete = app.buttons["Delete"]
    XCTAssertTrue(delete.waitForExistence(timeout: 5), "No swipe to delete")
    delete.tap()
    waitUntilGone(leeds, "Leeds is still a recent place")
    XCTAssertFalse(recent.exists, "Recent, over no recent places")
  }

  /// With location access off, "Use my location" says so, with Open Settings, and the search
  /// still works. Opened from the approximate line's "Use my location", the picker starts there:
  /// tapped on its line above its words, outside its element (IsItUI's `WordsButton`), as the
  /// whole 44-point line is the button.
  @MainActor
  func testUseMyLocationDenied() throws {
    let app = launch(["-resetStore", "-network", "ip-first-launch", "-location", "denied"])
    tapOutsideItsWords(app.buttons["use-my-location"])
    let detail = app.staticTexts["location-detail"]
    XCTAssertTrue(detail.waitForExistence(timeout: 10), "No line for location access off")
    XCTAssertEqual(detail.label, "Location access is off. Search for a place instead.")
    XCTAssertEqual(app.buttons["open-settings"].label, "Open Settings")
    // The picker's own row says the same.
    app.buttons["picker-use-my-location"].tap()
    wait(for: detail, label: "Location access is off. Search for a place instead.")
    XCTAssertTrue(searchField(in: app).exists, "The picker closed")
    attachScreen(of: app, named: "picker-location-denied")
    // Close: still on approximate location.
    app.buttons["picker-close"].tap()
    XCTAssertTrue(app.buttons["use-my-location"].waitForExistence(timeout: 10))
  }

  /// Open Settings, with location access off, asks for the app's own page in Settings
  /// (`UIApplication.openSettingsURLString`), read from the Debug recorder (`-openURLs record`,
  /// as SettingsTests reads Settings' rows) instead of leaving the app; the picker stays open.
  @MainActor
  func testOpenSettingsOpensTheAppsPage() throws {
    let app = launch([
      "-resetStore", "-network", "ip-first-launch", "-location", "denied", "-openURLs", "record",
    ])
    _ = openPicker(in: app, focusing: false)
    let opened = app.staticTexts["debug-opened"]
    XCTAssertTrue(opened.waitForExistence(timeout: 10), "No Debug recorder on the picker")
    // The URL is the line's value; its label says what it holds.
    XCTAssertEqual(opened.value as? String, "none")
    XCTAssertEqual(opened.label, "Last link opened")
    app.buttons["picker-use-my-location"].tap()
    let open = app.buttons["open-settings"]
    XCTAssertTrue(open.waitForExistence(timeout: 10), "No Open Settings")
    open.tap()
    let settingsPage = NSPredicate(format: "value BEGINSWITH %@", "app-settings:")
    wait(for: [expectation(for: settingsPage, evaluatedWith: opened)], timeout: 10)
    XCTAssertTrue(searchField(in: app).exists, "The picker closed")
  }

  /// With a fix, the sheet closes and the phone's place loads, rounded to the grid.
  @MainActor
  func testUseMyLocation() throws {
    let app = launch([
      "-resetStore", "-network", "ip-first-launch,kathmandu-0545", "-now",
      "2026-12-02T11:50:00.000Z", "-location", "27.7172,85.324",
    ])
    _ = openPicker(in: app)
    app.buttons["picker-use-my-location"].tap()
    wait(for: app.buttons["place"], label: "Place: Kathmandu. Change place.")
    XCTAssertFalse(app.buttons["use-my-location"].exists, "Still on approximate location")
    XCTAssertTrue(app.staticTexts["verdict"].waitForExistence(timeout: 10), "No answer")
  }

  /// The picker passes the accessibility audit (section 16): with a recent place, and with
  /// location access off, its line and Open Settings. The keyboard is down for it: the picker
  /// is opened again without focusing the search field.
  @MainActor
  func testPickerAccessibilityAudit() throws {
    let app = launch([
      "-resetStore", "-network", "ip-first-launch,leeds-dry", "-location", "denied",
    ])
    let field = openPicker(in: app)
    field.typeText("Leeds")
    XCTAssertTrue(app.buttons["result-0"].waitForExistence(timeout: 10), "No results")
    app.buttons["result-0"].tap()
    wait(for: app.buttons["place"], label: "Place: Leeds. Change place.")
    _ = openPicker(in: app, focusing: false)
    XCTAssertTrue(app.buttons["recent-city:leeds-gb"].waitForExistence(timeout: 10))
    app.buttons["picker-use-my-location"].tap()
    XCTAssertTrue(app.buttons["open-settings"].waitForExistence(timeout: 10), "No Open Settings")
    attachScreen(of: app, named: "picker-audit")
    try auditAccessibility(of: app, on: "the picker, with a recent place and location access off")
  }

  /// The search's results pass the audit too, with the keyboard down: a drag on the list puts it
  /// away, as the picker's list asks (`scrollDismissesKeyboard(.immediately)`, PlacePickerView;
  /// on PR #33's macOS run, without it, the keyboard stayed up), and the results stay, with
  /// "Leeds" still in the search box.
  @MainActor
  func testResultsAccessibilityAudit() throws {
    let app = launch(["-resetStore", "-network", "ip-first-launch"])
    let field = openPicker(in: app)
    field.typeText("Leeds")
    let result = app.buttons["result-0"]
    XCTAssertTrue(result.waitForExistence(timeout: 10), "No results for Leeds")
    result.swipeDown()
    waitUntilGone(app.keyboards.firstMatch, "The keyboard is still up")
    XCTAssertTrue(result.exists, "The results went with the keyboard")
    attachScreen(of: app, named: "picker-results-audit")
    try auditAccessibility(of: app, on: "the picker's results")
  }

  // MARK: - Helpers

  /// Launches the app with `-uitest` and `arguments`, and waits for the heading.
  @MainActor
  private func launch(_ arguments: [String]) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-uitest"] + arguments
    app.launch()
    XCTAssertTrue(heading(in: app).waitForExistence(timeout: 15), "No heading on screen")
    return app
  }

  /// Opens the picker with the place button, and gives its search field, focused unless not
  /// `focusing`, with no clear button while it is empty. With no picker, the failure says where
  /// the top bar was: on main's first macOS run the place button was under the status bar, where
  /// the tap never reached it.
  @MainActor
  private func openPicker(in app: XCUIApplication, focusing: Bool = true) -> XCUIElement {
    app.buttons["place"].tap()
    let field = searchField(in: app)
    XCTAssertTrue(
      field.waitForExistence(timeout: 10),
      "No picker after tapping the place button; \(app.homeGeometry)")
    XCTAssertEqual(field.placeholderValue, "Town or city")
    XCTAssertFalse(app.buttons["clear-search"].exists, "A clear button with nothing typed")
    XCTAssertTrue(app.buttons["picker-use-my-location"].exists, "No Use my location")
    if focusing { field.tap() }
    return field
  }

  /// The picker's search box (`place-search`), whatever type XCUITest gives it: a text field
  /// marked as a search field, the app's own since the system's search went.
  @MainActor
  private func searchField(in app: XCUIApplication) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: "place-search").firstMatch
  }

  /// The question and the answer: one heading element, whatever type XCUITest gives it.
  @MainActor
  private func heading(in app: XCUIApplication) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: "heading").firstMatch
  }

  /// Waits until `element` reads `label`.
  @MainActor
  private func wait(for element: XCUIElement, label: String) {
    let reads = NSPredicate(format: "label == %@", label)
    wait(for: [expectation(for: reads, evaluatedWith: element)], timeout: 15)
  }

  /// Waits until `element` is gone.
  @MainActor
  private func waitUntilGone(_ element: XCUIElement, _ message: String) {
    let gone = NSPredicate(format: "exists == false")
    let result = XCTWaiter().wait(
      for: [XCTNSPredicateExpectation(predicate: gone, object: element)], timeout: 10)
    XCTAssertEqual(result, .completed, message)
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
