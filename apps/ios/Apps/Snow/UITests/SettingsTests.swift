import XCTest

/// Settings (iOS build spec, sections 10.4, 10.6, 10.7 and 17.2): the units switch and the
/// refetch in the new units; every row opening what it says, read from the Debug recorder
/// (`-openURLs record`, DebugHooks.swift), which shows the URL Settings would have opened instead
/// of leaving the app, and the units each request asked in; Report an ad's and Contact us's
/// fallback with no mail app (`-openURLs nomail`); Your privacy's lines; the version line; and
/// no word naming another app, website or weather type. Each screen is audited for
/// accessibility and attached for the contact sheet. Every launch starts from a clean store.
final class SettingsTests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  /// Changing the units keeps them, asks the server again in them, and they stay chosen at the
  /// next launch. `-network` runs the app's own client and transport over the stubbed network,
  /// so the request is the app's: the recorder shows the units the last one asked in.
  @MainActor
  func testUnitsChangeAsksInTheNewUnits() throws {
    let app = launch(["-resetStore", "-network", "ip-first-launch", "-openURLs", "record"])
    openSettings(app)
    // The control is two buttons in a group (`UnitsSegments`), each marked selected as a
    // segment is, so its labels grow with the text size.
    let units = app.find("units")
    XCTAssertTrue(units.waitForExistence(timeout: 5), "No snow units control")
    // The first launch asked by IP with no units, and kept the server's choice.
    XCTAssertTrue(units.buttons["cm"].isSelected, "cm isn't chosen")
    XCTAssertFalse(units.buttons["in"].isSelected, "in is chosen as well")
    XCTAssertEqual(app.staticTexts["debug-units"].label, "none")
    XCTAssertTrue(
      app.staticTexts["Temperatures follow: cm with °C, inches with °F."].exists, "No footnote")
    units.buttons["in"].tap()
    waitFor(app.staticTexts["debug-units"], label: "f")
    XCTAssertTrue(units.buttons["in"].isSelected, "in isn't chosen")
    XCTAssertFalse(units.buttons["cm"].isSelected, "cm is still chosen")
    try auditAccessibility(of: app, on: "Settings")
    attachScreen(of: app, named: "app-settings")
    app.terminate()

    // units.v1 holds the choice: the next launch asks in inches, and Settings shows them.
    let again = launch(["-network", "ip-first-launch", "-openURLs", "record"])
    openSettings(again)
    let kept = again.find("units")
    XCTAssertTrue(kept.waitForExistence(timeout: 5), "No snow units control")
    XCTAssertTrue(kept.buttons["in"].isSelected, "in isn't kept")
    XCTAssertEqual(again.staticTexts["debug-units"].label, "f", "The launch didn't ask in inches")
  }

  /// Each row opens what it says: willitsnow.today's own pages in Safari, the emails to the
  /// support address, and the pages on Settings' own stack.
  @MainActor
  func testRowsOpenWhatTheySay() throws {
    let app = launch(["-resetStore", "-fixture", "leeds-dry", "-openURLs", "record"])
    openSettings(app)
    assertSnowOnly(app)

    tap("privacy-policy", in: app)
    waitFor(opened(app), label: "https://willitsnow.today/privacy")
    tap("terms", in: app)
    waitFor(opened(app), label: "https://willitsnow.today/terms")
    tap("support", in: app)
    waitFor(opened(app), label: "https://willitsnow.today/support")
    tap("contact-us", in: app)
    waitFor(opened(app), label: "mailto:support@willitsnow.today")
    tap("report-ad", in: app)
    let report = opened(app)
    let mail = NSPredicate(format: "label BEGINSWITH %@", "mailto:support@willitsnow.today?")
    wait(for: [expectation(for: mail, evaluatedWith: report)], timeout: 5)
    // Section 10.7's subject and body, encoded: the version, the time on the phone, the place.
    XCTAssertTrue(
      report.label.hasPrefix(
        "mailto:support@willitsnow.today?subject=Report%20an%20ad%20(willitsnow.today%201.0)"
          + "&body=Time%3A%20"),
      report.label)
    XCTAssertTrue(
      report.label.hasSuffix("%0APlace%3A%20Leeds%0AWhat%20was%20wrong%20with%20the%20ad%3A%0A"),
      report.label)

    let version = app.staticTexts["version"]
    reveal(version, in: app)
    XCTAssertNotNil(
      version.label.range(of: #"^Version 1\.0 \(\d+\)$"#, options: .regularExpression),
      version.label)

    // How it works, with the judging's numbers and the rounded location.
    tap("how-it-works", in: app)
    XCTAssertTrue(app.navigationBars["How it works"].waitForExistence(timeout: 5))
    XCTAssertTrue(text("When 60% or more of them do, the answer is yes", in: app).exists)
    XCTAssertTrue(text("rounded to about 5 km before it leaves your phone", in: app).exists)
    XCTAssertFalse(text("one service", in: app).exists, "The four sites' paragraph is in the app")
    assertSnowOnly(app)
    try auditAccessibility(of: app, on: "How it works")
    attachScreen(of: app, named: "app-how-it-works")
    back(in: app)

    // Credits and licences, and a notice in full.
    tap("credits", in: app)
    XCTAssertTrue(app.navigationBars["Credits and licences"].waitForExistence(timeout: 5))
    XCTAssertTrue(text("Place names: GeoNames, licensed under CC BY 4.0", in: app).exists)
    XCTAssertTrue(text("Contains Met Office data", in: app).exists)
    assertSnowOnly(app)
    try auditAccessibility(of: app, on: "Credits and licences")
    attachScreen(of: app, named: "app-credits")
    tap("notice-BricolageGrotesque-OFL", in: app)
    let notice = app.staticTexts["notice-text"]
    XCTAssertTrue(notice.waitForExistence(timeout: 5), "No notice text")
    XCTAssertTrue(notice.label.contains("SIL OPEN FONT LICENSE Version 1.1"))
    // A licence in full is a screen of its own, audited too.
    try auditAccessibility(of: app, on: "the typeface's licence")
    attachScreen(of: app, named: "app-notice")
    back(in: app)
    tap("notice-GoogleMobileAds-LICENSE", in: app)
    XCTAssertTrue(app.staticTexts["notice-text"].waitForExistence(timeout: 5), "No notice text")
    XCTAssertTrue(app.staticTexts["notice-text"].label.contains("Apache License"))
    back(in: app)
    back(in: app)
    XCTAssertTrue(app.buttons["close-settings"].waitForExistence(timeout: 5))
  }

  /// With no mail app, Report an ad says where to write instead, and copies the address.
  @MainActor
  func testReportAnAdWithoutAMailApp() throws {
    let app = launch(["-resetStore", "-fixture", "leeds-dry", "-openURLs", "nomail"])
    openSettings(app)
    tap("report-ad", in: app)
    XCTAssertTrue(app.navigationBars["Report an ad"].waitForExistence(timeout: 5), "No fallback")
    XCTAssertEqual(
      app.staticTexts["fallback-body"].label,
      "Email support@willitsnow.today with a screenshot of the ad and the time you saw it.")
    XCTAssertFalse(app.staticTexts["copied"].exists)
    app.buttons["copy-address"].tap()
    let copied = app.staticTexts["copied"]
    XCTAssertTrue(copied.waitForExistence(timeout: 5), "No confirmation")
    XCTAssertEqual(copied.label, "Copied.")
    try auditAccessibility(of: app, on: "Report an ad's fallback")
    attachScreen(of: app, named: "app-report-ad-fallback")
    app.buttons["close-fallback"].tap()

    // Contact us falls back the same way.
    tap("contact-us", in: app)
    XCTAssertTrue(app.navigationBars["Contact us"].waitForExistence(timeout: 5), "No fallback")
    XCTAssertEqual(
      app.staticTexts["fallback-body"].label,
      "Email support@willitsnow.today. Tell us what happened, and the version number at the end "
        + "of Settings.")
    try auditAccessibility(of: app, on: "Contact us's fallback")
    attachScreen(of: app, named: "app-contact-us-fallback")
  }

  /// Your privacy: the plain lines, in the free version with the ads line, no notifications
  /// data while none is kept, and the full policy in Safari.
  @MainActor
  func testYourPrivacy() throws {
    let app = launch(["-resetStore", "-fixture", "leeds-dry", "-openURLs", "record"])
    openSettings(app)
    tap("your-privacy", in: app)
    XCTAssertTrue(app.navigationBars["Your privacy"].waitForExistence(timeout: 5))
    let lines = [
      "To get the forecast, the app sends the place (a town, or your location rounded to about "
        + "5 km) and your units to our server. Until you choose a place, our server estimates a "
        + "rough one from your internet connection. Place names you search for go to Open-Meteo, "
        + "our forecast provider, to find matching places. The app keeps your place, units, "
        + "recent places and the last forecast on your iPhone.",
      "Only while notifications are on, we keep your device's notification token, an ID made "
        + "from it, the place, its time zone, your units and which notifications you chose, "
        + "with a few details such as the app's version and when it last checked in. We delete "
        + "them when you turn notifications off in the app, when Apple tells us the app is no "
        + "longer installed, or about 90 days after you last open it. If you turn notifications "
        + "off in your iPhone's Settings instead, we delete them the next time you open the app. "
        + "For a few days after each notification and each test, and after some forecast checks "
        + "that found nothing to send, we also keep a note of it, even once the rest is deleted. "
        + "It holds no token or place.",
      "In the free version, Google shows the ads and may collect device and usage data.",
      "Apple handles purchases. We never see your payment details.",
      "There are no accounts.",
    ]
    for (index, line) in lines.enumerated() {
      let element = app.staticTexts["privacy-line-\(index)"]
      reveal(element, in: app)
      XCTAssertEqual(element.label, line)
    }
    XCTAssertFalse(app.staticTexts["privacy-line-\(lines.count)"].exists, "A line too many")
    // No ads form to point to yet, and nothing kept for notifications.
    XCTAssertFalse(text("See Privacy choices.", in: app).exists)
    XCTAssertFalse(text("What we keep for notifications", in: app).exists)
    XCTAssertFalse(app.buttons["delete-my-data"].exists)
    assertSnowOnly(app)
    try auditAccessibility(of: app, on: "Your privacy")
    attachScreen(of: app, named: "app-your-privacy")
    tap("full-policy", in: app)
    waitFor(opened(app), label: "https://willitsnow.today/privacy")
  }

  // MARK: - Helpers

  /// Launches the app with `-uitest` and `arguments`, and waits for the answer's verdict.
  @MainActor
  private func launch(_ arguments: [String]) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-uitest"] + arguments
    app.launch()
    XCTAssertTrue(app.staticTexts["verdict"].waitForExistence(timeout: 15), "No answer on screen")
    return app
  }

  /// Taps the gear, and waits for the sheet.
  @MainActor
  private func openSettings(_ app: XCUIApplication) {
    app.buttons["settings"].tap()
    XCTAssertTrue(app.buttons["close-settings"].waitForExistence(timeout: 5), "No Settings")
  }

  /// The recorder's line: the last URL the app would have opened.
  @MainActor
  private func opened(_ app: XCUIApplication) -> XCUIElement {
    app.staticTexts["debug-opened"]
  }

  /// A text on screen whose own label contains `words` (`matching`, not `containing`, which
  /// finds elements with such a descendant: a text has none).
  @MainActor
  private func text(_ words: String, in app: XCUIApplication) -> XCUIElement {
    app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", words)).firstMatch
  }

  /// Scrolls until `element` can be tapped, up then down.
  @MainActor
  private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
    var swipes = 0
    while !(element.exists && element.isHittable) && swipes < 6 {
      app.swipeUp()
      swipes += 1
    }
    while !(element.exists && element.isHittable) && swipes < 12 {
      app.swipeDown()
      swipes += 1
    }
    XCTAssertTrue(element.exists && element.isHittable, "Can't reach \(element)")
  }

  /// Taps the row or button identified `id`, scrolling to it first.
  @MainActor
  private func tap(_ id: String, in app: XCUIApplication) {
    let element = app.buttons[id]
    reveal(element, in: app)
    element.tap()
  }

  /// Goes back one page on Settings' stack.
  @MainActor
  private func back(in app: XCUIApplication) {
    app.navigationBars.buttons.element(boundBy: 0).tap()
  }

  /// Waits until `element` reads `label`.
  @MainActor
  private func waitFor(_ element: XCUIElement, label: String) {
    let reads = NSPredicate(format: "exists == true AND label == %@", label)
    let expectation = XCTNSPredicateExpectation(predicate: reads, object: element)
    let done = XCTWaiter.wait(for: [expectation], timeout: 10)
    XCTAssertEqual(done, .completed, "\(element) never read \(label)")
  }

  /// No text or button Settings shows names another weather type, website or app (section
  /// 10.8). Only what can be tapped counts: the home screen under the sheet, whose answer may
  /// well say "Rain, not snow.", is the server's, and is covered.
  @MainActor
  private func assertSnowOnly(_ app: XCUIApplication) {
    let other =
      #"(?i)\b(websites?|isithot|isitwet|isitwindy|hot|wet|wind|windy|rain|rainy|rainfall|android)\b"#
    let shown = (app.staticTexts.allElementsBoundByIndex + app.buttons.allElementsBoundByIndex)
      .filter { $0.isHittable }
    XCTAssertFalse(shown.isEmpty, "Nothing on screen")
    for element in shown {
      XCTAssertNil(element.label.range(of: other, options: .regularExpression), element.label)
    }
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
