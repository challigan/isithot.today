import UIKit
import XCTest

/// Notifications in the app (iOS build spec, sections 10.2 item 5, 10.6 and 12): Settings →
/// Notifications' gate at approximate location; its switches, the place, the test and each result
/// it can come to; a change that couldn't be saved; a permission refused at the switch, and one
/// turned off in iOS Settings before the next launch; the notification place's page; what Your
/// privacy shows as kept while registered, and "Turn off notifications and delete my data"; the
/// Today card, turned on and put away; a notification's route; and the link to Settings →
/// Notifications. Each launch is `-uitest`, with the ads off (`-noads 1`), the clock fixed at its
/// fixture's moment and the Debug recorder on (`-openURLs record`, DebugHooks.swift), from a clean
/// store unless a test relaunches on purpose; the place chosen is Leeds (`leeds`).
///
/// Nothing here meets a system alert: the notifications' stand-in, every UI test's under
/// `-uitest`, asks the real centre nothing (`-notifications` says what the permission is, or what
/// asking comes to), and `-location` stands in for Core Location. NotificationPermissionTests
/// meets the real prompt. The server's devices calls are the stub's (`-devices`), answered from
/// the fixtures the server's own code wrote, so no request leaves the phone. Each step waits for
/// what the app shows, never a sleep: a switch's value (`isOn`), a line's words, the test row's
/// result, the kept block; and the picker by the app's own readout (`pickerOpens`), not by
/// XCUITest's tree, which lags the screen. Every tap is on an element whole on screen (`reveal`),
/// as the Notifications card moves every Settings row below the units down. Settings is audited
/// with the Notifications heading scrolled to just under the bar, so every text on screen starts
/// below it, and the pages on its stack at their tops, each audited screen attached for the
/// contact sheet; the card's audits are HomeAuditTests'.
final class NotificationsTests: XCTestCase {
  /// Leeds, a city's page: its fixture, kept as the place to launch on.
  private static let leeds = ["-fixture", "leeds-dry", "-place", "place=leeds-gb"]

  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  /// At approximate location there is no place for notifications: the line that says so, "Use my
  /// location" and "Search", and no switch. Search closes Settings and opens the picker.
  @MainActor
  func testTheGateAtApproximateLocation() throws {
    let app = launch(["-fixture", "ip-first-launch"])
    try openSettings(app)
    try waitFor(app.find("notify-notice"), label: Copy.needsPlace)
    XCTAssertTrue(app.find("notify-use-my-location").exists, "No Use my location")
    XCTAssertTrue(app.find("notify-search").exists, "No Search")
    XCTAssertFalse(app.find("notify-evening").exists, "A switch at approximate location")
    try showNotifications(in: app)
    try auditAccessibility(
      of: app, on: "Settings, notifications at approximate location", surface: .content)
    attach(app, as: "app-notifications-gate")
    let shown = app.pickersShown ?? 0
    try tap("notify-search", in: app)
    // The picker opens only once Settings has gone (HomeView's `present(_:)`), so a new picker
    // on the readout says both.
    try expectThePicker(in: app, after: shown, "after Settings' Search")
  }

  /// Turned on, the evening switch registers: "Also when snow is possible" comes, the place is
  /// Leeds, and the test is sent. Your privacy then shows first what the server keeps; "Turn off
  /// notifications and delete my data" says it is done and the kept block goes, and back on
  /// Settings the switch is off, with no test. For a UK place, the Met Office's warnings open in
  /// Safari.
  @MainActor
  func testTurningOnRegistersAndYourPrivacyShowsIt() throws {
    let app = launch(Self.leeds + ["-notifications", "allow"])
    try openSettings(app)
    try turnOnTheEvening(in: app)
    XCTAssertTrue(app.find("notify-possible").waitForExistence(timeout: 10), "No possible switch")
    try waitFor(app.find("notify-place"), value: "Leeds")
    try tap("notify-test", in: app)
    try waitFor(app.find("notify-test"), value: Copy.testSent)
    try showNotifications(in: app)
    try auditAccessibility(of: app, on: "Settings, notifications on", surface: .content)
    attach(app, as: "app-notifications-on")

    try openYourPrivacy(in: app)
    try waitFor(app.find("kept-heading"), label: Copy.kept)
    let id = app.find("kept-line-0").label
    XCTAssertNotNil(id.range(of: #"^ID [0-9a-f]{8}$"#, options: .regularExpression), id)
    XCTAssertEqual(app.find("kept-line-1").label, Copy.keptPlace)
    XCTAssertEqual(app.find("kept-line-2").label, Copy.keptUnits)
    XCTAssertEqual(app.find("kept-line-3").label, Copy.evening)
    XCTAssertFalse(app.find("kept-line-4").exists, "A kept line too many")
    // At its top, where the kept block is, every line on screen below the bar.
    try auditAccessibility(of: app, on: "Your privacy, registered", surface: .content)
    attach(app, as: "app-your-privacy-registered")
    try tap("delete-my-data", in: app)
    try waitFor(app.find("delete-status"), label: Copy.deleteDone)
    XCTAssertTrue(gone(app.find("kept-line-0")), "The kept block is still there once deleted")
    back(in: app)
    try page(titled: "Settings", in: app)
    try expectSwitch(app.find("notify-evening"), on: false)
    XCTAssertTrue(gone(app.find("notify-test")), "The test is still there with every switch off")

    // Last, once every audit is done: the recorder's lines at the sheet's foot wrap the whole
    // URL, which at the audits' largest text sizes would squeeze the screen above them
    // (SettingsTests).
    try tap("notify-warnings", in: app)
    try waitFor(opened(app), value: Copy.metOfficeWarnings)
  }

  /// Notifications refused at the prompt: the switch stays off, the notice says they are off for
  /// the app, and Open Settings opens the app's notification settings in iOS Settings.
  @MainActor
  func testARefusedPermissionSaysSo() throws {
    let app = launch(Self.leeds + ["-notifications", "deny"])
    try openSettings(app)
    let evening = app.find("notify-evening")
    try expectSwitch(evening, on: false)
    try tap("notify-evening", in: app)
    try waitFor(app.find("notify-notice"), label: Copy.notifyDenied)
    try expectSwitch(evening, on: false)
    try showNotifications(in: app)
    try auditAccessibility(of: app, on: "Settings, notifications denied", surface: .content)
    attach(app, as: "app-notifications-denied")
    try tap("notify-open-settings", in: app)
    try waitFor(opened(app), value: UIApplication.openNotificationSettingsURLString)
  }

  /// Notifications turned off in iOS Settings while the app was away: at the next launch the
  /// switches are off, the notice says so, and the server's record is deleted, so Your privacy
  /// keeps nothing for them.
  @MainActor
  func testDeniedLaterDeletesAtTheNextLaunch() throws {
    let app = launch(Self.leeds + ["-notifications", "authorized"])
    try openSettings(app)
    try turnOnTheEvening(in: app)
    try openYourPrivacy(in: app)
    XCTAssertTrue(app.find("kept-line-0").waitForExistence(timeout: 10), "Nothing kept")
    app.terminate()

    // What the first launch kept, Leeds and the registration, with the permission now denied.
    let again = launch(["-fixture", "leeds-dry", "-notifications", "denied"], reset: false)
    try openSettings(again)
    try waitFor(again.find("notify-notice"), label: Copy.notifyDenied)
    try expectSwitch(again.find("notify-evening"), on: false)
    try openYourPrivacy(in: again)
    XCTAssertTrue(again.find("privacy-line-0").waitForExistence(timeout: 10), "No privacy lines")
    // The DELETE answered 204, so nothing is kept.
    XCTAssertTrue(gone(again.find("kept-heading")), "Still kept once denied")
  }

  /// Each answer to "Send a test notification", in turn, in its own words: one too many this
  /// hour, quiet hours at the place, the server not sending yet, and a record the server no
  /// longer has, which says the test failed and registers afresh.
  @MainActor
  func testEveryTestResult() throws {
    let app = launch(
      Self.leeds + ["-notifications", "authorized", "-devices", "limited,quiet,dryrun,gone"])
    try openSettings(app)
    try turnOnTheEvening(in: app)
    for result in [Copy.testLimited, Copy.testQuiet, Copy.testDryRun, Copy.testFailed] {
      try tap("notify-test", in: app)
      try waitFor(app.find("notify-test"), value: result)
    }
    try openYourPrivacy(in: app)
    XCTAssertTrue(app.find("kept-line-0").waitForExistence(timeout: 10), "Not registered afresh")
  }

  /// A change with no connection: the switch stays on, and the status line says it wasn't saved,
  /// and when the app will try again.
  @MainActor
  func testAChangeOfflineIsNotSaved() throws {
    let app = launch(Self.leeds + ["-notifications", "authorized", "-devices", "offline"])
    try openSettings(app)
    try turnOnTheEvening(in: app)
    try waitFor(app.find("notify-status"), label: Copy.notSaved)
    try expectSwitch(app.find("notify-evening"), on: true)
  }

  /// The notification place's page: the place on screen, in use, and "Use my location", which,
  /// tapped, follows the phone once it has a fix and goes back to Settings. With location access
  /// off, the page says so, and its Open Settings opens the app's page in iOS Settings.
  @MainActor
  func testThePlaceChoice() throws {
    let app = launch(Self.leeds + ["-notifications", "authorized", "-location", "53.8,-1.55"])
    try openSettings(app)
    try tap("notify-place", in: app)
    try page(titled: Copy.placeTitle, in: app)
    let onScreen = app.find("notify-place-on-screen")
    XCTAssertTrue(onScreen.waitForExistence(timeout: 5), "No place on screen to choose")
    XCTAssertTrue(onScreen.label.hasPrefix(Copy.onScreen), onScreen.label)
    XCTAssertTrue(onScreen.isSelected, "The place on screen isn't the one in use")
    let mine = app.find("notify-place-my-location")
    XCTAssertTrue(mine.label.hasPrefix(Copy.myLocation), mine.label)
    XCTAssertTrue(mine.label.contains(Copy.follows), mine.label)
    XCTAssertFalse(mine.isSelected, "The phone's location is in use already")
    // At its top: it is short.
    try auditAccessibility(of: app, on: "Notification place", surface: .content)
    attach(app, as: "app-notification-place")
    try tap("notify-place-my-location", in: app)
    let place = app.find("notify-place")
    try waitFor(place, value: Copy.yourLocation)
    // Back on Settings: its place row takes a tap again.
    try reveal(place, in: app)
    XCTAssertTrue(place.label.contains(Copy.follows), place.label)
    app.terminate()

    let denied = launch(Self.leeds + ["-notifications", "authorized", "-location", "denied"])
    try openSettings(denied)
    try tap("notify-place", in: denied)
    try page(titled: Copy.placeTitle, in: denied)
    try tap("notify-place-my-location", in: denied)
    try waitFor(denied.find("notify-place-problem"), label: Copy.locationDenied)
    try tap("notify-place-open-settings", in: denied)
    try waitFor(opened(denied), value: UIApplication.openSettingsURLString)
  }

  /// The Today card for Leeds: "Turn on" turns the evening notification on for the place on
  /// screen, and the card says it is done, with no buttons; Settings has the switch on.
  @MainActor
  func testTheCardTurnsOn() throws {
    let app = launch(Self.leeds + ["-alertCard", "shown", "-notifications", "allow"])
    try showTheCard(in: app, on: "leeds-dry")
    try waitFor(app.find("card-line"), label: Copy.cardChosen)
    app.find("card-turn-on").tap()
    try waitFor(app.find("card-line"), label: Copy.cardOn)
    XCTAssertTrue(gone(app.find("card-turn-on")), "Turn on is still there once on")
    attach(app, as: "app-card-on")
    try openSettings(app)
    try expectSwitch(app.find("notify-evening"), on: true)
  }

  /// The card at approximate location: "Use my location" and "Search", which opens the picker;
  /// "Not now" puts it away for good, so the next launch shows none. That launch shows the card
  /// as this one does (`-alertCard shown`), else the stand-in's store would hide it whatever was
  /// kept (`CardHidden`).
  @MainActor
  func testTheCardAtApproximateLocation() throws {
    let launching = ["-fixture", "ip-first-launch", "-alertCard", "shown"]
    let app = launch(launching)
    try showTheCard(in: app, on: "picker-first-launch")
    try waitFor(app.find("card-line"), label: Copy.cardApprox)
    XCTAssertTrue(app.find("card-use-my-location").exists, "No Use my location on the card")
    attach(app, as: "app-card-approximate")
    let shown = app.pickersShown ?? 0
    app.find("card-search").tap()
    try expectThePicker(in: app, after: shown, "after the card's Search")
    try closeThePicker(in: app, after: shown)
    try showTheCard(in: app, on: "picker-first-launch")
    app.find("card-not-now").tap()
    XCTAssertTrue(gone(app.find("notification-card")), "The card is still there after Not now")
    app.terminate()

    let again = launch(launching, reset: false)
    let middle = try HomeScreen.named("picker-first-launch").page("today")
    if again.heading.label != middle.heading { try tap(middle, in: again) }
    XCTAssertTrue(again.find("updated").waitForExistence(timeout: 10), "No footer on the page")
    XCTAssertFalse(again.find("notification-card").exists, "The card is back after Not now")
  }

  /// A tapped notification that launched the app (`-route`, the server's own payload) opens its
  /// place on its view: Durham on Tomorrow at 6:05pm, where the launch alone opens on Now, chosen
  /// as the picker chooses a place, so it is first under Recent. Every request is answered with
  /// durham-tomorrow, whose place is Durham (`-fixture`), so the place button names Durham with
  /// or without the route: Recent, which only the route's choice fills on a clean store, is what
  /// tells. A payload that routes nowhere leaves Leeds as it was; and
  /// `willitsnow://settings/notifications` opens Settings at Notifications.
  @MainActor
  func testRoutesOpenTheirPlace() throws {
    let screen = try HomeScreen.named("durham-tomorrow")
    XCTAssertEqual(try screen.opening().view, "now", "durham-tomorrow's launch opens on Now")
    let middle = try screen.page("today")
    let app = launch(["-fixture", "durham-tomorrow", "-route", "durham-evening"])
    try awaitHeading(middle.heading, in: app)
    XCTAssertTrue(app.buttons[middle.label].isSelected, "The \(middle.label) tab isn't selected")
    let shown = app.pickersShown ?? 0
    app.buttons["place"].tap()
    try expectThePicker(in: app, after: shown, "after tapping the place button")
    let recent = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "recent-"))
      .firstMatch
    XCTAssertTrue(recent.waitForExistence(timeout: 10), "Nothing under Recent")
    XCTAssertEqual(recent.identifier, "recent-city:durham-gb")
    try closeThePicker(in: app, after: shown)
    attach(app, as: "app-route-durham")
    app.terminate()

    let leeds = launch(Self.leeds + ["-route", "malformed"])
    try awaitHeading(try HomeScreen.named("leeds-dry").opening().heading, in: leeds)
    XCTAssertEqual(leeds.buttons["place"].label, "Place: Leeds. Change place.")
    leeds.open(try XCTUnwrap(URL(string: "willitsnow://settings/notifications")))
    XCTAssertTrue(
      leeds.buttons["close-settings"].waitForExistence(timeout: 10), "No Settings for the link")
    XCTAssertTrue(
      leeds.find("notifications-heading").waitForExistence(timeout: 5), "No Notifications")
  }

  // MARK: - Helpers

  /// What Settings → Notifications, the place page, Your privacy and the card say, as
  /// packages/mobile's `APP_COPY` and core word them (AppCopy.swift, CoreCopy.swift), and the
  /// Met Office's page (`Constants.Outbound`): typed here, as SettingsTests types Settings', since
  /// the UI tests link none of the app's modules.
  private enum Copy {
    static let needsPlace =
      "Choose a place for notifications: use your location or search for a town."
    static let notifyDenied = "Notifications are off for this app in Settings."
    static let testSent = "Sent. It should arrive in a few seconds."
    static let testLimited = "You can send 3 test notifications an hour. Try again later."
    static let testQuiet =
      "Nothing is sent from 9pm to 7am at the place. Try again after 7am there."
    static let testDryRun = "Our server isn't sending notifications yet, so nothing was sent."
    static let testFailed = "Couldn't send a test notification. Try again later."
    static let notSaved =
      "Couldn't save your notification choices. The app will try again when you next open it."
    static let placeTitle = "Notification place"
    static let onScreen = "Use the place on screen: Leeds"
    static let myLocation = "Use my location"
    static let follows = "Follows your location each time you open the app."
    static let yourLocation = "Your location"
    static let locationDenied = "Location access is off for this app in Settings."
    static let kept = "What we keep for notifications"
    static let keptPlace = "Leeds, Europe/London"
    static let keptUnits = "Snow units: cm"
    static let evening = "Evening before (about 6pm)"
    static let deleteDone =
      "Notifications are off. We've deleted your notification token, place, units and choices."
    static let cardChosen = "Get a notification the evening before snow is likely here."
    static let cardOn =
      "Done. You'll get a notification the evening before snow is likely here. You can change "
      + "this in Settings."
    static let cardApprox =
      "Choose a place for notifications: use your location or search for a town."
    static let metOfficeWarnings =
      "https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings"
  }

  /// Launches the app with `-uitest`, `-noads 1`, the clock fixed (`-clock fixed`, at the
  /// fixture's moment) and the recorder (`-openURLs record`), from a clean store unless not
  /// `reset` (a relaunch, which keeps what the first launch kept, so `-place` is left out), and
  /// `extra`; waits for the answer's verdict.
  @MainActor
  private func launch(_ extra: [String], reset: Bool = true) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments =
      ["-uitest", "-noads", "1", "-clock", "fixed", "-openURLs", "record"]
      + (reset ? ["-resetStore"] : []) + extra
    app.launch()
    XCTAssertTrue(app.staticTexts["verdict"].waitForExistence(timeout: 15), "No answer on screen")
    return app
  }

  /// Taps the gear, and waits for Settings, by its Close and its title, with its Notifications.
  @MainActor
  private func openSettings(_ app: XCUIApplication) throws {
    app.buttons["settings"].tap()
    guard app.buttons["close-settings"].waitForExistence(timeout: 5) else {
      throw HomeScreenError("No Settings after tapping the gear; \(app.homeGeometry)")
    }
    try page(titled: "Settings", in: app)
    guard app.find("notifications-heading").waitForExistence(timeout: 5) else {
      throw HomeScreenError("No Notifications in Settings")
    }
  }

  /// Opens Your privacy from Settings' row, and waits for its title on the page.
  @MainActor
  private func openYourPrivacy(in app: XCUIApplication) throws {
    try tap("your-privacy", in: app)
    try page(titled: "Your privacy", in: app)
  }

  /// Turns the evening notification on, from off, in Settings, and waits for the switch to say
  /// so.
  @MainActor
  private func turnOnTheEvening(in app: XCUIApplication) throws {
    let evening = app.find("notify-evening")
    try expectSwitch(evening, on: false)
    try tap("notify-evening", in: app)
    try expectSwitch(evening, on: true)
  }

  /// Waits for the page titled `title`, known by its title on the page (`page-title`), as the
  /// navigation bar draws none; throws, listing the titles on screen, without it.
  @MainActor
  private func page(titled title: String, in app: XCUIApplication) throws {
    let titled = NSPredicate(format: "identifier == 'page-title' AND label == %@", title)
    if app.staticTexts.matching(titled).firstMatch.waitForExistence(timeout: 5) { return }
    let shown = app.staticTexts.matching(identifier: "page-title").allElementsBoundByIndex
      .map(\.label)
    throw HomeScreenError("No page titled \"\(title)\"; the titles on screen: \(shown)")
  }

  /// Goes back one page on Settings' stack.
  @MainActor
  private func back(in app: XCUIApplication) {
    app.navigationBars.buttons.element(boundBy: 0).tap()
  }

  /// Whether a switch is on, from its value: "1" on and "0" off, as XCUITest gives a switch's;
  /// nil for anything else, which a failure then shows. XCUITest's type and value for a Toggle in
  /// the app's own style are the first macOS run's to show: another encoding is a fix here alone.
  @MainActor
  private func isOn(_ element: XCUIElement) -> Bool? {
    switch element.value as? String {
    case "1": true
    case "0": false
    default: nil
    }
  }

  /// Waits up to 10 seconds for the switch `element` to be `on` (`isOn`), read four times a
  /// second; throws, saying what it read, when it isn't.
  @MainActor
  private func expectSwitch(_ element: XCUIElement, on: Bool) throws {
    let deadline = Date().addingTimeInterval(10)
    while isOn(element) != on {
      guard Date() < deadline else {
        let value = element.exists ? "\(element.value ?? "no value")" : "nothing, not being there"
        throw HomeScreenError("\(element) never turned \(on ? "on" : "off"); its value: \(value)")
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.25))
    }
  }

  /// Waits up to 10 seconds for `element` to read `label`; throws, saying what it reads, when it
  /// doesn't.
  @MainActor
  private func waitFor(_ element: XCUIElement, label: String) throws {
    let reads = NSPredicate(format: "exists == true AND label == %@", label)
    let waited = XCTNSPredicateExpectation(predicate: reads, object: element)
    guard XCTWaiter().wait(for: [waited], timeout: 10) == .completed else {
      let shown = element.exists ? "\"\(element.label)\"" : "nothing, not being there"
      throw HomeScreenError("\(element) never read \"\(label)\"; it reads \(shown)")
    }
  }

  /// Waits up to 10 seconds for `element`'s value to be `value`: the place row's place, the
  /// test row's result, the recorder's last link; throws, saying what it holds, when it isn't.
  @MainActor
  private func waitFor(_ element: XCUIElement, value: String) throws {
    let holds = NSPredicate(format: "exists == true AND value == %@", value)
    let waited = XCTNSPredicateExpectation(predicate: holds, object: element)
    guard XCTWaiter().wait(for: [waited], timeout: 10) == .completed else {
      let held = element.exists ? "\"\(element.value as? String ?? "")\"" : "nothing"
      throw HomeScreenError("\(element) never held \"\(value)\"; it holds \(held)")
    }
  }

  /// Whether `element` is gone, or goes within 10 seconds. Each test asks only once it has read
  /// what took its place (a line's new words, a switch's value), as XCUITest's tree can lag the
  /// screen.
  @MainActor
  private func gone(_ element: XCUIElement) -> Bool {
    element.waitForNonExistence(timeout: 10)
  }

  /// The recorder's line whose value is the last URL the app would have opened.
  @MainActor
  private func opened(_ app: XCUIApplication) -> XCUIElement {
    app.staticTexts["debug-opened"]
  }

  /// Taps the element identified `id` on Settings or a page on its stack, whatever type XCUITest
  /// gives it, once it lies whole on screen (`reveal`): a switch at its centre, which its whole
  /// row takes (`SheetSwitchStyle`).
  @MainActor
  private func tap(_ id: String, in app: XCUIApplication) throws {
    let element = app.find(id)
    try reveal(element, in: app)
    element.tap()
  }

  /// Scrolls Settings, or the page on its stack, until `element` lies whole on screen
  /// (`whole`): each time a drag that would bring its middle to the middle of the part of the
  /// sheet the page shows through, up to 8; throws, with where it was, when it never does.
  @MainActor
  private func reveal(_ element: XCUIElement, in app: XCUIApplication) throws {
    guard element.waitForExistence(timeout: 10) else {
      throw HomeScreenError("No \(element) on the page")
    }
    for _ in 0..<8 {
      if whole(element, in: app) { return }
      drag(by: settledFrame(of: element).midY - shown(in: app).midY, in: app)
    }
    guard whole(element, in: app) else {
      throw HomeScreenError(
        "\(element) at \(element.frame) never came whole on screen, within \(shown(in: app))")
    }
  }

  /// Whether a tap on `element` lands on it, whole on screen: it is there and hittable, it has
  /// stopped moving, and it lies within the part of the sheet the page shows through (`shown`),
  /// below the navigation bar and above the Debug recorder's lines, which `isHittable`, the
  /// accessibility hit test, doesn't see (SettingsTests' `reachable`).
  @MainActor
  private func whole(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
    guard element.exists, element.isHittable else { return false }
    let frame = settledFrame(of: element)
    let area = shown(in: app)
    return frame.minY >= area.minY - 0.5 && frame.maxY <= area.maxY + 0.5
  }

  /// The part of the window Settings' page shows through: below its navigation bar (or Close,
  /// without one) and above the Debug recorder's lines at the sheet's foot.
  @MainActor
  private func shown(in app: XCUIApplication) -> CGRect {
    let window = app.frame
    let bar = app.navigationBars.firstMatch
    let top = bar.exists ? bar.frame.maxY : app.buttons["close-settings"].frame.maxY
    let recorder = app.staticTexts["debug-opened"]
    let bottom = recorder.exists ? min(recorder.frame.minY, window.maxY) : window.maxY
    return CGRect(x: window.minX, y: top, width: window.width, height: max(bottom - top, 0))
  }

  /// Drags Settings' page up by about `distance` points (down for a negative one), 8 points in
  /// from the window's left edge, where no row is, held still before it lifts so the page doesn't
  /// fling on: 16 points longer, the most a drag spends before the page moves (13 to 20 on PR
  /// #33's macOS run), and never longer than the part of the sheet the page shows through.
  @MainActor
  private func drag(by distance: CGFloat, in app: XCUIApplication) {
    let area = shown(in: app)
    let room = max(area.height - 80, 0)
    let length = min(max(distance + (distance < 0 ? -16 : 16), -room), room)
    let start = length > 0 ? area.maxY - 40 : area.minY + 40
    let screen = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let x = area.minX + 8
    screen.withOffset(CGVector(dx: x, dy: start)).press(
      forDuration: 0.01, thenDragTo: screen.withOffset(CGVector(dx: x, dy: start - length)),
      withVelocity: .slow, thenHoldForDuration: 0.3)
  }

  /// Scrolls Settings until the Notifications heading lies just under the navigation bar, its
  /// top within 24 points of the bar's foot, so the section fills the screen below it and every
  /// text on screen starts below the bar, as the audit's proof needs (`DrawnText`); throws, with
  /// where the heading was after each drag, when it never does.
  @MainActor
  private func showNotifications(in app: XCUIApplication) throws {
    let heading = app.find("notifications-heading")
    var seen: [CGFloat] = []
    for _ in 0..<6 {
      let below = settledFrame(of: heading).minY - shown(in: app).minY
      if (0...24).contains(below) { return }
      seen.append(below)
      drag(by: below - 12, in: app)
    }
    throw HomeScreenError(
      "The Notifications heading never came to just under the bar: it was \(seen) points below it")
  }

  /// Shows the middle page of `screen`, a HomeScreens.json screen on the launch's fixture, the
  /// page with the card, by its tab unless it is on screen already, and scrolls it until the card
  /// lies whole on screen.
  @MainActor
  private func showTheCard(in app: XCUIApplication, on screen: String) throws {
    let middle = try HomeScreen.named(screen).page("today")
    if app.heading.label != middle.heading { try tap(middle, in: app) }
    try scroll(middle, toShow: "notification-card", in: app)
  }

  /// Waits for the picker a tap opened, after the readout counted `shown` (`pickerOpens`), and
  /// its search box; throws, saying `what` was tapped, without it.
  @MainActor
  private func expectThePicker(in app: XCUIApplication, after shown: Int, _ what: String) throws {
    guard pickerOpens(in: app, after: shown, within: 10) != false else {
      throw HomeScreenError("No picker \(what); \(app.pickerReport)")
    }
    guard app.find("place-search").waitForExistence(timeout: 10) else {
      throw HomeScreenError("No picker \(what); \(app.homeGeometry)")
    }
  }

  /// Closes the picker opened after the readout counted `shown`, and waits for the readout to say
  /// it has closed (`pickerCloses`).
  @MainActor
  private func closeThePicker(in app: XCUIApplication, after shown: Int) throws {
    app.buttons["picker-close"].tap()
    guard pickerCloses(in: app, after: shown, within: 10) else {
      throw HomeScreenError("The picker is still open; \(app.pickerReport)")
    }
  }
}
