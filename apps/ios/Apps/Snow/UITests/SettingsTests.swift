import XCTest

/// Settings (iOS build spec, sections 10.4, 10.6, 10.7 and 17.2): the units switch and the
/// refetch in the new units; every row opening what it says, read from the Debug recorder
/// (`-openURLs record`, DebugHooks.swift), which shows the URL Settings would have opened instead
/// of leaving the app, and the units each request asked in; Report an ad's and Contact us's
/// fallback with no mail app (`-openURLs nomail`); Your privacy's lines; the version line; and
/// no word naming another app, website or weather type. Each screen is audited for
/// accessibility and attached for the contact sheet. Every launch starts from a clean store.
/// Each page is known by its title on the page (`page-title`, `page(titled:in:)`), the website's
/// h1, since the navigation bar draws none (IsItUI's `SheetPage`).
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
    // The control is two buttons in a group (`UnitsSegments`, the website's cm | in pill),
    // each marked selected as a segment is, so its labels grow with the text size.
    let units = app.find("units")
    XCTAssertTrue(units.waitForExistence(timeout: 5), "No snow units control")
    // The first launch asked by IP with no units, and kept the server's choice.
    XCTAssertTrue(units.buttons["cm"].isSelected, "cm isn't chosen")
    XCTAssertFalse(units.buttons["in"].isSelected, "in is chosen as well")
    // Each a tap's size, though the pill hugs its words, to the pixel (`onPixels`).
    for choice in ["cm", "in"] {
      let frame = units.buttons[choice].frame
      XCTAssertGreaterThanOrEqual(onPixels(frame.width), 44, "\(choice) at \(frame)")
      XCTAssertGreaterThanOrEqual(onPixels(frame.height), 44, "\(choice) at \(frame)")
    }
    // The recorder's lines say what they hold, and hold it as their values.
    XCTAssertEqual(recorded(app.staticTexts["debug-units"]), "none")
    XCTAssertEqual(app.staticTexts["debug-units"].label, "Units last asked for")
    XCTAssertEqual(opened(app).label, "Last link opened")
    XCTAssertTrue(
      app.staticTexts["Temperatures follow: cm with °C, inches with °F."].exists, "No footnote")
    // Each row is a whole row's button, at least 54 tall (`SheetRowStyle`).
    let row = app.buttons["your-privacy"]
    XCTAssertGreaterThanOrEqual(row.frame.height, 44, "Your privacy's row at \(row.frame)")
    units.buttons["in"].tap()
    waitFor(app.staticTexts["debug-units"], value: "f")
    XCTAssertTrue(units.buttons["in"].isSelected, "in isn't chosen")
    XCTAssertFalse(units.buttons["cm"].isSelected, "cm is still chosen")
    try auditAccessibility(of: app, on: "Settings", surface: .content)
    attachScreen(of: app, named: "app-settings")
    app.terminate()

    // units.v1 holds the choice: the next launch asks in inches, and Settings shows them.
    let again = launch(["-network", "ip-first-launch", "-openURLs", "record"])
    openSettings(again)
    let kept = again.find("units")
    XCTAssertTrue(kept.waitForExistence(timeout: 5), "No snow units control")
    XCTAssertTrue(kept.buttons["in"].isSelected, "in isn't kept")
    XCTAssertEqual(
      recorded(again.staticTexts["debug-units"]), "f", "The launch didn't ask in inches")
  }

  /// Each row opens what it says: willitsnow.today's own pages in Safari, the emails to the
  /// support address, and the pages on Settings' own stack.
  ///
  /// The emails come last, after the pages' audits. The Debug recorder's lines sit below the
  /// sheet's content and wrap to show the whole URL, so the height they take is the content's:
  /// Report an ad's email is 201 characters with no space, about 6 lines at Large and taller
  /// than the window at AX5, where the audit's text-size checks lay the sheet out. Audited with
  /// it recorded, How it works, Credits and licences and the licence would be squeezed under
  /// it; with Support's address recorded, the two lines, each its label then what it holds, take
  /// about half the window at AX5.
  @MainActor
  func testRowsOpenWhatTheySay() throws {
    let app = launch(["-resetStore", "-fixture", "leeds-dry", "-openURLs", "record"])
    openSettings(app)
    assertSnowOnly(app)

    tap("privacy-policy", in: app)
    waitFor(opened(app), value: "https://willitsnow.today/privacy")
    tap("terms", in: app)
    waitFor(opened(app), value: "https://willitsnow.today/terms")
    tap("support", in: app)
    waitFor(opened(app), value: "https://willitsnow.today/support")

    let version = app.staticTexts["version"]
    reveal(version, in: app)
    XCTAssertNotNil(
      version.label.range(of: #"^Version 1\.0 \(\d+\)$"#, options: .regularExpression),
      version.label)

    // How it works, with the judging's numbers and the rounded location.
    tap("how-it-works", in: app)
    page(titled: "How it works", in: app)
    XCTAssertTrue(text("When 60% or more of them do, the answer is yes", in: app).exists)
    XCTAssertTrue(text("rounded to about 5 km before it leaves your phone", in: app).exists)
    XCTAssertFalse(text("one service", in: app).exists, "The four sites' paragraph is in the app")
    assertSnowOnly(app)
    try auditAccessibility(of: app, on: "How it works", surface: .content)
    attachScreen(of: app, named: "app-how-it-works")
    back(in: app)

    // Credits and licences, and a notice in full.
    tap("credits", in: app)
    page(titled: "Credits and licences", in: app)
    XCTAssertTrue(text("Place names: GeoNames, licensed under CC BY 4.0", in: app).exists)
    XCTAssertTrue(text("Contains Met Office data", in: app).exists)
    assertSnowOnly(app)
    try auditAccessibility(of: app, on: "Credits and licences", surface: .content)
    attachScreen(of: app, named: "app-credits")
    tap("notice-BricolageGrotesque-OFL", in: app)
    let notice = app.staticTexts["notice-text"]
    XCTAssertTrue(notice.waitForExistence(timeout: 5), "No notice text")
    XCTAssertTrue(notice.label.contains("SIL OPEN FONT LICENSE Version 1.1"))
    // A licence in full is a screen of its own, audited too.
    try auditAccessibility(of: app, on: "the typeface's licence", surface: .content)
    attachScreen(of: app, named: "app-notice")
    back(in: app)
    tap("notice-Google-Mobile-Ads-LICENSE", in: app)
    XCTAssertTrue(app.staticTexts["notice-text"].waitForExistence(timeout: 5), "No notice text")
    XCTAssertTrue(app.staticTexts["notice-text"].label.contains("Apache License"))
    back(in: app)
    back(in: app)

    // The emails, with no audit after them (above).
    tap("contact-us", in: app)
    waitFor(opened(app), value: "mailto:support@willitsnow.today")
    tap("report-ad", in: app)
    let report = opened(app)
    let mail = NSPredicate(format: "value BEGINSWITH %@", "mailto:support@willitsnow.today?")
    wait(for: [expectation(for: mail, evaluatedWith: report)], timeout: 5)
    // Section 10.7's subject and body, encoded: the version, the time on the phone, the place.
    let email = recorded(report)
    XCTAssertTrue(
      email.hasPrefix(
        "mailto:support@willitsnow.today?subject=Report%20an%20ad%20(willitsnow.today%201.0)"
          + "&body=Time%3A%20"),
      email)
    XCTAssertTrue(
      email.hasSuffix("%0APlace%3A%20Leeds%0AWhat%20was%20wrong%20with%20the%20ad%3A%0A"),
      email)
    XCTAssertTrue(app.buttons["close-settings"].waitForExistence(timeout: 5))
  }

  /// With no mail app, Report an ad says where to write instead, and copies the address.
  @MainActor
  func testReportAnAdWithoutAMailApp() throws {
    let app = launch(["-resetStore", "-fixture", "leeds-dry", "-openURLs", "nomail"])
    openSettings(app)
    tap("report-ad", in: app)
    page(titled: "Report an ad", in: app)
    XCTAssertEqual(
      app.staticTexts["fallback-body"].label,
      "Email support@willitsnow.today with a screenshot of the ad and the time you saw it.")
    XCTAssertFalse(app.staticTexts["copy-confirmation"].exists)
    app.buttons["copy-address"].tap()
    let copied = app.staticTexts["copy-confirmation"]
    XCTAssertTrue(copied.waitForExistence(timeout: 5), "No confirmation")
    XCTAssertEqual(copied.label, "Address copied.")
    try auditAccessibility(of: app, on: "Report an ad's fallback", surface: .content)
    attachScreen(of: app, named: "app-report-ad-fallback")
    app.buttons["close-fallback"].tap()

    // Contact us falls back the same way.
    tap("contact-us", in: app)
    page(titled: "Contact us", in: app)
    XCTAssertEqual(
      app.staticTexts["fallback-body"].label,
      "Email support@willitsnow.today. Tell us what happened, and the version number at the end "
        + "of Settings.")
    try auditAccessibility(of: app, on: "Contact us's fallback", surface: .content)
    attachScreen(of: app, named: "app-contact-us-fallback")
  }

  /// Your privacy: the plain lines, in the free version with the ads line, no notifications
  /// data while none is kept, and the full policy in Safari.
  @MainActor
  func testYourPrivacy() throws {
    let app = launch(["-resetStore", "-fixture", "leeds-dry", "-openURLs", "record"])
    openSettings(app)
    tap("your-privacy", in: app)
    page(titled: "Your privacy", in: app)
    let lines = [
      "To get the forecast, the app sends the place (a town, or your location rounded to about "
        + "5 km) and your units to our server. Until you choose a place, our server estimates a "
        + "rough one from your internet connection. Place names you search for go to Open-Meteo, "
        + "our forecast provider, to find matching places. The app keeps your place, units, "
        + "recent and saved places and the last forecast on your iPhone.",
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
    try auditAccessibility(of: app, on: "Your privacy", surface: .content)
    attachScreen(of: app, named: "app-your-privacy")
    let policy = app.buttons["full-policy"]
    XCTAssertGreaterThanOrEqual(policy.frame.height, 44, "The full policy's row at \(policy.frame)")
    tap("full-policy", in: app)
    waitFor(opened(app), value: "https://willitsnow.today/privacy")
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

  /// Taps the gear, and waits for the sheet, with its Close and its title. With no sheet, the
  /// failure says where the top bar was: on main's first macOS run the gear was under the status
  /// bar, where the tap never reached it.
  @MainActor
  private func openSettings(_ app: XCUIApplication) {
    app.buttons["settings"].tap()
    XCTAssertTrue(
      app.buttons["close-settings"].waitForExistence(timeout: 5),
      "No Settings after tapping the gear; \(app.homeGeometry)")
    page(titled: "Settings", in: app)
  }

  /// Waits for the page titled `title`: Settings, a page on its stack or the mail fallback, each
  /// known by its title on the page (`page-title`), not by the navigation bar's, which draws no
  /// title. With none, the failure lists the titles on screen.
  @MainActor
  private func page(
    titled title: String, in app: XCUIApplication, file: StaticString = #filePath,
    line: UInt = #line
  ) {
    let titled = NSPredicate(format: "identifier == 'page-title' AND label == %@", title)
    if app.staticTexts.matching(titled).firstMatch.waitForExistence(timeout: 5) { return }
    let shown = app.staticTexts.matching(identifier: "page-title").allElementsBoundByIndex
      .map(\.label)
    XCTFail("No page titled \"\(title)\"; the titles on screen: \(shown)", file: file, line: line)
  }

  /// The recorder's line whose value is the last URL the app would have opened.
  @MainActor
  private func opened(_ app: XCUIApplication) -> XCUIElement {
    app.staticTexts["debug-opened"]
  }

  /// What a recorder's line holds, its value (its label says what it is).
  @MainActor
  private func recorded(_ line: XCUIElement) -> String {
    line.value as? String ?? ""
  }

  /// A text on screen whose own label contains `words` (`matching`, not `containing`, which
  /// finds elements with such a descendant: a text has none).
  @MainActor
  private func text(_ words: String, in app: XCUIApplication) -> XCUIElement {
    app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", words)).firstMatch
  }

  /// Scrolls until a tap on `element` lands on it (`reachable`), up then down.
  @MainActor
  private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
    var swipes = 0
    while !reachable(element, in: app) && swipes < 6 {
      app.swipeUp()
      swipes += 1
    }
    while !reachable(element, in: app) && swipes < 12 {
      app.swipeDown()
      swipes += 1
    }
    let recorder = app.staticTexts["debug-opened"]
    XCTAssertTrue(
      reachable(element, in: app),
      "Can't reach \(element), at \(element.exists ? "\(element.frame)" : "nowhere"), with the "
        + "Debug recorder's lines at \(recorder.exists ? "\(recorder.frame)" : "nowhere")")
  }

  /// Whether a tap on `element` would land on it: it is there and hittable, it has stopped moving
  /// (a tap on a list still moving only stops it), and it lies whole above the Debug recorder's
  /// lines when they show. `isHittable` is XCUITest's accessibility hit test, which finds an
  /// element under a view with no element of its own: on PR #33's macOS run, Support, Settings'
  /// last row, was hittable at the sheet's foot under the recorder's bar, which then took the tap,
  /// so the row never opened (the recorder now sits under the sheet's content, DebugHooks.swift).
  @MainActor
  private func reachable(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
    guard element.exists, element.isHittable else { return false }
    let frame = settledFrame(of: element)
    let recorder = app.staticTexts["debug-opened"]
    return !recorder.exists || frame.maxY <= recorder.frame.minY
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

  /// Waits until `element`, a recorder's line, holds `value`.
  @MainActor
  private func waitFor(_ element: XCUIElement, value: String) {
    let holds = NSPredicate(format: "exists == true AND value == %@", value)
    let expectation = XCTNSPredicateExpectation(predicate: holds, object: element)
    let done = XCTWaiter.wait(for: [expectation], timeout: 10)
    let held = element.exists ? recorded(element) : "nothing"
    XCTAssertEqual(done, .completed, "\(element) never held \(value); it holds \"\(held)\"")
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
