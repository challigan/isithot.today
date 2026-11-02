import XCTest

/// The app shows the fixture it is launched with (`-uitest -fixture <name>`, the Debug hooks in
/// section 9.8), at the fixture's own moment, on the view for the time of day (Today, or Now from
/// 6pm, section 10.2): the place in the top bar, the question and answer as one heading with the
/// place, as VoiceOver reads it (section 16), and the verdict; the switcher's tabs, the middle one
/// "Tomorrow" from 6pm; and a place nearby loading in place. Only the page on screen is in the
/// accessibility tree, so the heading and the verdict are that page's. Every launch starts from
/// a clean store (`-resetStore`), so no test depends on another: the place a test leaves in the
/// App Group (Dundee, after `testNearbyLoadsInPlace`) would otherwise name the next one's
/// heading. The screen is attached to the result bundle for the contact sheet, once the page's
/// colours have settled on its band (`awaitColours`), which each launch and tap names.
final class FixtureLaunchTests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  @MainActor
  func testAberdeenSnow() throws {
    let app = launch(fixture: "aberdeen-snow", band: "snow")
    XCTAssertEqual(app.buttons["place"].label, "Place: Aberdeen. Change place.")
    XCTAssertEqual(heading(in: app).label, "Aberdeen. Will it snow today? Yes.")
    XCTAssertEqual(app.staticTexts["verdict"].label, "It'll snow.")
    attachScreen(of: app, named: "app-aberdeen-snow")
  }

  @MainActor
  func testLeedsDry() throws {
    let app = launch(fixture: "leeds-dry", band: "nosnow")
    XCTAssertEqual(app.buttons["place"].label, "Place: Leeds. Change place.")
    XCTAssertEqual(heading(in: app).label, "Leeds. Will it snow today? No.")
    XCTAssertEqual(app.staticTexts["verdict"].label, "Rain, not snow.")
    attachScreen(of: app, named: "app-leeds-dry")
  }

  /// From 6pm at the place, the app opens on Now, and the middle page, its tab reading Tomorrow,
  /// answers for tomorrow.
  @MainActor
  func testDurhamTomorrow() throws {
    let app = launch(fixture: "durham-tomorrow", band: "nosnow")
    XCTAssertEqual(app.buttons["place"].label, "Place: Durham. Change place.")
    XCTAssertEqual(heading(in: app).label, "Durham. Is it snowing right now? No.")
    XCTAssertFalse(app.buttons["Today"].exists, "The middle tab reads Today after 6pm")
    show("Tomorrow", in: app, heading: "Durham. Will it snow tomorrow? Yes.", band: "snow")
    XCTAssertEqual(app.staticTexts["verdict"].label, "It'll snow.")
    attachScreen(of: app, named: "app-durham-tomorrow")
  }

  /// Past the last hour it can be shown, the answer is never shown as current, on any page. There
  /// is no verdict, so the launch waits for the footer's Updated line, which only an answer
  /// brings: the loading state's heading is there before it. It is after 6pm in Durham, so the
  /// app opens on Now.
  @MainActor
  func testOldForecast() throws {
    let app = launch(fixture: "old-forecast", band: nil, waitingFor: "updated")
    XCTAssertEqual(
      heading(in: app).label,
      "Durham. Is it snowing right now? No recent forecast. Connect to the internet to refresh.")
    show(
      "Tomorrow", in: app,
      heading:
        "Durham. Will it snow tomorrow? No recent forecast. Connect to the internet to refresh.",
      band: nil)
    XCTAssertFalse(app.staticTexts["verdict"].exists, "An old answer's verdict is on screen")
    attachScreen(of: app, named: "app-old-forecast")
  }

  /// The switcher's tabs and the pager agree: a tap on a tab shows its page, a swipe moves to the
  /// next and back, and the screens of Now and This week go to the contact sheet.
  @MainActor
  func testSwitcherAndSwipe() throws {
    let app = launch(fixture: "aberdeen-snow", band: "snow")
    XCTAssertTrue(app.buttons["Now"].exists, "No Now tab")
    XCTAssertTrue(app.buttons["Today"].exists, "No Today tab")
    XCTAssertTrue(app.buttons["This week"].exists, "No This week tab")
    show("Now", in: app, heading: "Aberdeen. Is it snowing right now? No.", band: "nosnow")
    XCTAssertTrue(app.staticTexts["hours-heading"].exists, "No next hours on Now")
    attachScreen(of: app, named: "app-aberdeen-snow-now")
    show("This week", in: app, heading: "Aberdeen. Will it snow this week? Yes.", band: "heavysnow")
    attachScreen(of: app, named: "app-aberdeen-snow-week")
    app.swipeRight()
    waitForHeading("Aberdeen. Will it snow today? Yes.", in: app, after: "a swipe right")
    XCTAssertTrue(app.buttons["Today"].isSelected, "The Today tab isn't selected after a swipe")
    app.swipeRight()
    waitForHeading("Aberdeen. Is it snowing right now? No.", in: app, after: "a swipe right")
    XCTAssertTrue(app.buttons["Now"].isSelected, "The Now tab isn't selected after a swipe")
  }

  /// A place under "Nearby:" loads in place, with no navigation: it becomes the place in the top
  /// bar and the heading. (The fixture's server answers every place with the same fixture.)
  @MainActor
  func testNearbyLoadsInPlace() throws {
    let app = launch(fixture: "aberdeen-snow", band: "snow")
    let dundee = app.buttons["Dundee"]
    var swipes = 0
    while !dundee.isHittable && swipes < 8 {
      app.swipeUp()
      swipes += 1
    }
    XCTAssertTrue(dundee.isHittable, "No Dundee under Nearby; \(app.cancelsReport)")
    dundee.tap()
    waitForHeading("Dundee. Will it snow today? Yes.", in: app, after: "a tap on Dundee")
    XCTAssertEqual(app.buttons["place"].label, "Place: Dundee. Change place.")
    XCTAssertEqual(app.staticTexts["verdict"].label, "It'll snow.")
  }

  /// Launches the app on `fixture`, from a clean store (`-resetStore` forgets the place, the
  /// units and the saved answer before `-fixture` is read), with no consent form or ad
  /// (`-noads 1`, as `launchApp`), and waits for its heading, for `element`, a text only an
  /// answer shows (the verdict, by default), and for the colours to settle on `band`, the band
  /// of the page it opens on (nil without an answer): the loading page is drawn as no snow, so
  /// an answer in another band fades in.
  @MainActor
  private func launch(
    fixture: String,
    band: String?,
    waitingFor element: String = "verdict"
  ) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-uitest", "-noads", "1", "-resetStore", "-fixture", fixture]
    app.launch()
    if let failure = readHeading(in: app, within: 15, "to come after the launch", until: \.found) {
      XCTFail("No heading on screen: \(failure)")
    }
    XCTAssertTrue(app.staticTexts[element].waitForExistence(timeout: 15), "No answer on screen")
    waitForColours(band, in: app, after: "the launch")
    return app
  }

  /// The question and the answer: one heading element, whatever type XCUITest gives it.
  @MainActor
  private func heading(in app: XCUIApplication) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: "heading").firstMatch
  }

  /// Taps the switcher's tab labelled `tab`, and waits for its page's heading and for the
  /// colours to settle on `band`, its page's band, as `tap(_:in:)` does. A tap whose touch the
  /// system cancelled (`cancelled(_:in:within:until:_:)`, read for up to 2 seconds or until the
  /// heading comes) and whose heading hasn't come is tapped once more, as `tap(_:in:)` does: the
  /// app never had it as a tap. A tap the app completed is never tapped again.
  @MainActor
  private func show(
    _ tab: String,
    in app: XCUIApplication,
    heading label: String,
    band: String?
  ) {
    let button = app.buttons[tab]
    XCTAssertTrue(button.waitForExistence(timeout: 15), "No \(tab) tab")
    let arrived = { HeadingRead(app).shows(label) }
    // When the tap the app had began, which the colours' wait is measured from, as in
    // `tap(_:in:)`.
    var tapped = Date()
    let tapTab = {
      tapped = Date()
      button.tap()
    }
    if cancelled("tap on \(tab)", in: app, within: 2, until: arrived, tapTab), !arrived() {
      _ = cancelled("second tap on \(tab)", in: app, tapTab)
    }
    waitForHeading(label, in: app, after: "a tap on \(tab)")
    waitForColours(band, in: app, after: "the tap on \(tab)", began: tapped)
    XCTAssertTrue(button.isSelected, "The \(tab) tab isn't selected")
  }

  /// Waits for the page on screen's heading to read `label` after `what`, a tap or a swipe, as a
  /// user sees it (`readHeading`, as `awaitHeading` does). When it doesn't within 15 seconds,
  /// fails, stopping the test, with what the last read found and what `debug-cancels` reads, so
  /// a gesture the simulator cancelled names itself.
  @MainActor
  private func waitForHeading(_ label: String, in app: XCUIApplication, after what: String) {
    let read = readHeading(in: app, within: 15, "to read \"\(label)\"") { $0.shows(label) }
    guard let failure = read else { return }
    XCTFail(
      "The heading never read \"\(label)\" on screen after \(what): \(failure); "
        + app.cancelsReport)
  }

  /// Waits for the home screen's colours to settle on `band` after `what` (`awaitColours`), which
  /// began at `began` when that is known, and fails, stopping the test, with what the last read
  /// found when they don't.
  @MainActor
  private func waitForColours(
    _ band: String?, in app: XCUIApplication, after what: String, began: Date? = nil
  ) {
    do {
      try awaitColours(band, in: app, after: what, began: began)
    } catch {
      XCTFail("\(error)")
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
