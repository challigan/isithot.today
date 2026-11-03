import UIKit
import XCTest

/// Notifications in the app (iOS build spec, sections 10.2 item 5, 10.6 and 12; phase 8.4a's
/// design, 2.1 to 2.8, and phase 8.4b's, 2.2 to 2.8): Settings → Notifications turned on at
/// approximate location, where you are then the town the server located from the connection; its
/// switches, "Where you are", "Saved places" both ways, the test and each result it can come to,
/// two tests with a saved place's bell on among them; a change that couldn't be saved; a
/// permission refused at the switch, and one turned off in iOS Settings before the next launch;
/// the "Where you are" page and its "Use my location"; a saved place's bell turned on from the
/// search screen "Saved places" opens; what Your privacy shows as kept while registered, a saved
/// place and the iPhone's time zone among it, and "Turn off notifications and delete my data"; the
/// Today card where you are, turned on and put away, and none on a chosen city's page; a
/// notification's route; and the link to Settings → Notifications. Each launch is `-uitest`, with
/// the ads off (`-noads 1`), the clock fixed at its fixture's moment and the Debug recorder on
/// (`-openURLs record`, DebugHooks.swift), from a clean store unless a test relaunches on
/// purpose; the place chosen, when one is, is Leeds (`leeds`); the saved places, when there are
/// any, are `-saved`'s.
///
/// Nothing here meets a system alert: the notifications' stand-in, every UI test's under
/// `-uitest`, asks the real centre nothing (`-notifications` says what the permission is, or what
/// asking comes to), and `-location` stands in for Core Location: in every launch here, location
/// access never asked until something asks for it, which only "Use my location" does, and then
/// allowed, with a fix at 53.8, -1.55 (`-location ask:`), so where you are is approximate until
/// that tap, whatever the simulator's own location settings say. NotificationPermissionTests
/// meets the real prompt. The server's devices calls are the stub's (`-devices`), answered from
/// the fixtures the server's own code wrote, each a whole set (`put-here-ip`, Leeds located from
/// the connection; `put-here-device`, the phone's cell at 53.8, -1.55, also Leeds;
/// `put-here-ip-durham`, Leeds and Durham with its bell on), so no request leaves the phone. Each
/// step waits for
/// what the app shows, never a sleep: a switch's value (`isOn`), a line's words, the test row's
/// result, the kept block; and the picker by the app's own readout (`pickerOpens`), not by
/// XCUITest's tree, which lags the screen. Every tap whose result can be read is watched, as
/// every UI test's is (`watchedTap`): played once more only when the system cancelled the touch
/// and the tap brought nothing. A failure after a gesture names `debug-cancels`
/// (`cancelsReport`). Every tap is on an element whole on screen (`reveal`), as the
/// Notifications section moves every Settings row below the units down. Settings is audited at
/// its top, as every sheet is (SettingsTests, and Your privacy since PR #40's run), and the pages
/// on its stack at theirs, each audited screen attached for the contact sheet; the card's audits
/// are HomeAuditTests'. Scrolled at all, iOS 26's scroll-edge effect fades the page from the
/// sheet's top to about 125 points below it, and the page keeps what has scrolled under the bar,
/// or off the sheet, in the tree, where the contrast check reads it against whatever is there:
/// audited with the Notifications heading just under the bar, the units' footnote, "in" and the
/// heading itself failed it (PR #43's first macOS run). So each Settings audit first checks that
/// Settings is still where it opened (`expectSettingsAtItsTop`).
final class NotificationsTests: XCTestCase {
  /// Leeds, a city's page: its fixture, kept as the place to launch on.
  private static let leeds = ["-fixture", "leeds-dry", "-place", "place=leeds-gb"]

  /// leeds-dry's page at approximate location: its fixture, with no place chosen, so the screen
  /// shows where you are (the card's only screen), which the fixture's answer names Leeds.
  private static let whereYouAre = ["-fixture", "leeds-dry"]

  /// Core Location's stand-in in every launch (`-location ask:`): access never asked until "Use
  /// my location" asks, which the stand-in allows, then the phone at 53.8, -1.55, the cell the
  /// stub's `put-here-device` registered.
  private static let notAsked = ["-location", "ask:53.8,-1.55"]

  /// The app the test launched last (`launch`), whose `debug-cancels` a wait's failure names, as
  /// each wait follows a gesture.
  private var launched: XCUIApplication?

  /// Where Settings' title lay when `openSettings` last opened it, at its top
  /// (`noteSettingsTop`).
  private var settingsTop: CGFloat?

  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  /// At approximate location, the first launch's, with location never asked, the switches show
  /// and turning one on works, with no place to choose (8.1's gate has gone): under them the line
  /// that says what is kept, and "Where you are", which says it is approximate, with no town
  /// while nothing is on. Turned on, it asks for no location (the stand-in would allow it, and
  /// the row would then say "Your location"), and the row names the town the server located from
  /// the connection, Leeds (`put-here-ip`). "Saved places", without the purchase, says what it
  /// takes and pushes the purchase's page on Settings' own stack (phase 8.4b, decision 13). Your
  /// privacy then shows where you are among what is kept. Settings is audited off, as the first
  /// launch shows it; on is `testTurningOnRegistersAndYourPrivacyShowsIt`'s audit.
  @MainActor
  func testTurningOnAtApproximateLocation() throws {
    let app = launch(["-fixture", "ip-first-launch", "-notifications", "allow"])
    try openSettings(app)
    try waitFor("notify-here-kept", in: app, label: Copy.hereKept)
    try waitForHere(in: app, note: Copy.approximate)
    try expectSettingsAtItsTop(in: app)
    try auditAccessibility(
      of: app, on: "Settings, notifications off at approximate location", surface: .content)
    attach(app, as: "app-notifications-off")
    try turnOnTheEvening(in: app)
    try waitForHere(in: app, note: Copy.approximate, town: "Leeds")
    try waitFor("notify-here-kept", in: app, label: Copy.hereKept)
    try waitFor("notify-saved", in: app, value: Copy.savedLocked)
    try tap("notify-saved", in: app) { app.showsPage(titled: Copy.upgradeTitle) }
    try page(titled: Copy.upgradeTitle, in: app)
    back(in: app) { app.lacksPage(titled: Copy.upgradeTitle) }
    try page(titled: "Settings", in: app)

    try openYourPrivacy(in: app)
    try waitFor("kept-heading", in: app, label: Copy.kept)
    try waitFor("kept-line-1", in: app, label: Copy.keptHere)
  }

  /// Turned on, the evening switch registers: "Also when snow is possible" comes, where you are
  /// is Leeds, located from the connection (never the city on screen, though here they agree),
  /// and the test is sent. Your privacy then shows first what the server keeps; "Turn off
  /// notifications and delete my data" says it is done and the kept block goes, and back on
  /// Settings the switch is off, with no test. Turned on again, where you are is Leeds once
  /// more, in the UK, so the Met Office's warnings show (only while a notification is on, by the
  /// country the server answered with) and open in Safari.
  @MainActor
  func testTurningOnRegistersAndYourPrivacyShowsIt() throws {
    let app = launch(Self.leeds + ["-notifications", "allow"])
    try openSettings(app)
    try turnOnTheEvening(in: app)
    XCTAssertTrue(
      app.find("notify-possible").waitForExistence(timeout: 10),
      "No possible switch; \(app.cancelsReport)")
    try waitForHere(in: app, note: Copy.approximate, town: "Leeds")
    // Audited before the test is sent: on PR #43's run the footer under the test row began at
    // 791, 3 points above the content's foot at Settings' top, and since phase 8.4a the kept line
    // above "Where you are" pushes both further down, so the test row's tap scrolls first
    // (`reveal`), and a scrolled Settings is never audited (`expectSettingsAtItsTop`).
    try expectSettingsAtItsTop(in: app)
    try auditAccessibility(of: app, on: "Settings, notifications on", surface: .content)
    attach(app, as: "app-notifications-on")
    try tap("notify-test", in: app) { holds("notify-test", Copy.testSent, in: app) }
    try waitFor("notify-test", in: app, value: Copy.testSent)

    try openYourPrivacy(in: app)
    try waitFor("kept-heading", in: app, label: Copy.kept)
    let id = app.find("kept-line-0").label
    XCTAssertNotNil(id.range(of: #"^ID [0-9a-f]{8}$"#, options: .regularExpression), id)
    XCTAssertEqual(app.find("kept-line-1").label, Copy.keptHere)
    XCTAssertEqual(app.find("kept-line-2").label, Copy.keptUnits)
    XCTAssertEqual(app.find("kept-line-3").label, Copy.evening)
    XCTAssertFalse(app.find("kept-line-4").exists, "A kept line too many")
    // At its top, where the kept block is, every line on screen below the bar.
    try auditAccessibility(of: app, on: "Your privacy, registered", surface: .content)
    attach(app, as: "app-your-privacy-registered")
    try tap("delete-my-data", in: app) { says("delete-status", Copy.deleteDone, in: app) }
    try waitFor("delete-status", in: app, label: Copy.deleteDone)
    if let still = gone("kept-line-0", in: app) {
      XCTFail("The kept block is still there once deleted: \(still)")
    }
    back(in: app) { app.lacksPage(titled: "Your privacy") }
    try page(titled: "Settings", in: app)
    try expectSwitch(app.find("notify-evening"), on: false)
    if let still = gone("notify-test", in: app) {
      XCTFail("The test is still there with every switch off: \(still)")
    }

    // Last, once every audit is done: the recorder's lines at the sheet's foot wrap the whole
    // URL, which at the audits' largest text sizes would squeeze the screen above them
    // (SettingsTests). The warnings row needs a notification on, and the server's answer.
    try turnOnTheEvening(in: app)
    try waitForHere(in: app, note: Copy.approximate, town: "Leeds")
    try tap("notify-warnings", in: app) {
      holds("debug-opened", Copy.metOfficeWarnings, .staticText, in: app)
    }
    try waitFor("debug-opened", .staticText, in: app, value: Copy.metOfficeWarnings)
  }

  /// Notifications refused at the prompt: the switch stays off, the notice says they are off for
  /// the app, and Open Settings opens the app's notification settings in iOS Settings.
  @MainActor
  func testARefusedPermissionSaysSo() throws {
    let app = launch(Self.leeds + ["-notifications", "deny"])
    try openSettings(app)
    let evening = app.find("notify-evening")
    try expectSwitch(evening, on: false)
    try tap("notify-evening", in: app) { says("notify-notice", Copy.notifyDenied, in: app) }
    try waitFor("notify-notice", in: app, label: Copy.notifyDenied)
    try expectSwitch(evening, on: false)
    try expectSettingsAtItsTop(in: app)
    try auditAccessibility(of: app, on: "Settings, notifications denied", surface: .content)
    attach(app, as: "app-notifications-denied")
    let notificationSettings = UIApplication.openNotificationSettingsURLString
    try tap("notify-open-settings", in: app) {
      holds("debug-opened", notificationSettings, .staticText, in: app)
    }
    try waitFor("debug-opened", .staticText, in: app, value: notificationSettings)
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
    try waitFor("notify-notice", in: again, label: Copy.notifyDenied)
    try expectSwitch(again.find("notify-evening"), on: false)
    try openYourPrivacy(in: again)
    XCTAssertTrue(again.find("privacy-line-0").waitForExistence(timeout: 10), "No privacy lines")
    // The DELETE answered 204, so nothing is kept.
    if let still = gone("kept-heading", in: again) {
      XCTFail("Still kept once denied: \(still)")
    }
  }

  /// Each answer to "Send a test notification", in turn, in its own words: one too many this
  /// hour, quiet hours (on the iPhone's clock since phase 8.4b, decision 25), the server not
  /// sending yet, and a record the server no longer has, which says the test failed and registers
  /// afresh.
  @MainActor
  func testEveryTestResult() throws {
    let app = launch(
      Self.leeds + ["-notifications", "authorized", "-devices", "limited,quiet,dryrun,gone"])
    try openSettings(app)
    try turnOnTheEvening(in: app)
    // Each result unlike the one before, so the row holding it is what this tap brought.
    for result in [Copy.testLimited, Copy.testQuiet, Copy.testDryRun, Copy.testFailed] {
      try tap("notify-test", in: app) { holds("notify-test", result, in: app) }
      try waitFor("notify-test", in: app, value: result)
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
    try waitFor("notify-status", in: app, label: Copy.notSaved)
    try expectSwitch(app.find("notify-evening"), on: true)
  }

  /// The "Where you are" page, with location never asked: turned on, where you are is Leeds,
  /// approximate; its page says how where you are is found, shows it as Settings' row does, and
  /// offers "Use my location", which asks for location only at its tap (the stand-in allows it)
  /// and takes one fix, at 53.8, -1.55. Where you are then follows the phone: the page goes back
  /// to Settings by itself, whose row says "Your location", with the town the server named for
  /// that cell, Leeds (`put-here-device`). Location access off, and a tap that finds no fix, are
  /// NotificationSettingsTests' and NotificationsModelTests' (on Linux).
  @MainActor
  func testWhereYouAre() throws {
    let app = launch(Self.leeds + ["-notifications", "authorized"])
    try openSettings(app)
    try turnOnTheEvening(in: app)
    try waitForHere(in: app, note: Copy.approximate, town: "Leeds")
    try tap("notify-here", in: app) { app.showsPage(titled: Copy.hereTitle) }
    try page(titled: Copy.hereTitle, in: app)
    try waitFor("notify-place-about", in: app, label: Copy.hereAbout)
    try waitForHere("notify-place-here", in: app, note: Copy.approximate, town: "Leeds")
    try waitFor("notify-place-my-location", in: app, label: Copy.myLocation)
    // At its top: it is short.
    try auditAccessibility(of: app, on: "Where you are", surface: .content)
    attach(app, as: "app-notification-place")
    // Watched until "Use my location" goes, which only a tap the app had brings: the page drops
    // it once the fix is in, before the server names the town, then goes back by itself. A tap
    // the system cancelled leaves it there, and so, dimmed, does one still finding the phone.
    try tap("notify-place-my-location", in: app) {
      ElementRead(app, "notify-place-my-location").gone
    }
    try waitForHere(in: app, note: Copy.yourLocation, town: "Leeds")
    // Asked once the row has changed, as Settings may keep it in the tree under the page: the
    // page went back by itself, rather than the row changing behind it.
    if let still = gone("notify-place-about", in: app) {
      XCTFail("The Where you are page is still there once it follows the phone: \(still)")
    }
    try page(titled: "Settings", in: app)
  }

  /// Saved places with the one-off purchase (phase 8.4b; design 2.2 to 2.4 and 2.8, decisions 11,
  /// 13, 16 and 25): Durham saved (`-saved place=durham-gb`), the purchase owned (`-unlocked 1`),
  /// every switch off. "Saved places" says "Off" and opens the search screen, Settings closing
  /// first, where Durham's bell is off under the line that says what a bell does. Its tap turns
  /// Durham's notifications on, and "Evening before" with them, which is for where you are too,
  /// as every switch was off (`put-here-ip-durham`); the line goes, and the search screen is
  /// audited with the bell on, at Large. Back in Settings the evening is on and "Saved places"
  /// says "1 on"; the test sends two, where you are's and Durham's (`-devices sent2`,
  /// `test-sent-two`); Your privacy lists Durham in its zone and the iPhone's time zone, kept only
  /// with a saved place; and "Turn off notifications and delete my data" takes them all, the bell
  /// with them, so "Saved places" says "Off" again.
  @MainActor
  func testSavedPlacesPaid() throws {
    let app = launch(
      Self.leeds + ["-unlocked", "1", "-saved", "place=durham-gb", "-devices", "sent2"])
    try openSettings(app)
    try waitFor("notify-saved", in: app, value: Copy.savedOff)
    let shown = app.pickersShown ?? 0
    // Watched until Settings has gone, as the row closes it before the picker opens over the
    // home screen (`HomeView.present`), or the picker is open: neither while Settings is there.
    try tap("notify-saved", in: app) {
      app.lacksPage(titled: "Settings") || self.pickerOpen(in: app, after: shown) == true
    }
    try expectThePicker(in: app, after: shown, "after tapping Saved places")
    let bell = "bell-saved-city:durham-gb"
    try waitFor(bell, .button, in: app, label: Copy.bellOn)
    try waitFor("saved-line", in: app, label: Copy.bellHint)
    let durham = app.buttons[bell]
    // Watched until the bell says a tap now turns it off, which only this tap brings.
    watchedTap(bell, in: app, until: { says(bell, Copy.bellOff, in: app) }, { durham.tap() })
    try waitFor(bell, .button, in: app, label: Copy.bellOff)
    if let still = gone("saved-line", in: app) {
      XCTFail("The line under the saved places, with a bell on: \(still)")
    }
    attach(app, as: "app-picker-bell-on")
    try auditAccessibility(
      of: app, on: "the picker, with a saved place's bell on",
      surface: try HomeScreen.named("leeds-dry").picker())
    try closeThePicker(in: app, after: shown)

    try openSettings(app)
    try expectSwitch(app.find("notify-evening"), on: true)
    try waitFor("notify-saved", in: app, value: Copy.savedOne)
    try tap("notify-test", in: app) { holds("notify-test", Copy.testSentTwo, in: app) }
    try waitFor("notify-test", in: app, value: Copy.testSentTwo)

    try openYourPrivacy(in: app)
    try waitFor("kept-line-2", in: app, label: Copy.keptDurham)
    XCTAssertEqual(app.find("kept-line-1").label, Copy.keptHere)
    XCTAssertEqual(app.find("kept-line-3").label, Copy.keptDeviceZone)
    XCTAssertEqual(app.find("kept-line-4").label, Copy.keptUnits)
    XCTAssertEqual(app.find("kept-line-5").label, Copy.evening)
    XCTAssertFalse(app.find("kept-line-6").exists, "A kept line too many")
    try tap("delete-my-data", in: app) { says("delete-status", Copy.deleteDone, in: app) }
    try waitFor("delete-status", in: app, label: Copy.deleteDone)
    if let still = gone("kept-line-0", in: app) {
      XCTFail("The kept block is still there once deleted: \(still)")
    }
    back(in: app) { app.lacksPage(titled: "Your privacy") }
    try page(titled: "Settings", in: app)
    try expectSwitch(app.find("notify-evening"), on: false)
    try waitFor("notify-saved", in: app, value: Copy.savedOff)
  }

  /// The Today card where you are: leeds-dry's middle page at approximate location, no place
  /// chosen. It offers the evening notification for where you are, with the line that says what
  /// is kept; "Turn on" turns it on, and the card says it is done, with no buttons, naming the
  /// town the server located from the connection, Leeds (`put-here-ip`); Settings has the switch
  /// on.
  @MainActor
  func testTheCardTurnsOn() throws {
    let app = launch(Self.whereYouAre + ["-alertCard", "shown", "-notifications", "allow"])
    try showTheCard(in: app, on: "leeds-dry")
    try waitFor("card-line", in: app, label: Copy.cardOffer)
    try waitFor("card-kept", in: app, label: Copy.hereKept)
    let turnOn = app.find("card-turn-on")
    // Watched until Turn on goes, as it does once the permission is allowed: the card says it is
    // done, and names Leeds only once the server has answered.
    watchedTap(
      "card-turn-on", in: app, until: { ElementRead(app, "card-turn-on").gone },
      { turnOn.tap() })
    try waitFor("card-line", in: app, label: Copy.cardOnNearLeeds)
    if let still = gone("card-turn-on", in: app) {
      XCTFail("Turn on is still there once on: \(still)")
    }
    attach(app, as: "app-card-on")
    try openSettings(app)
    try expectSwitch(app.find("notify-evening"), on: true)
  }

  /// The card shows only where you are, and "Not now" puts it away for good. Leeds's page with
  /// Leeds chosen (`-place`) shows none, though the launch would show it (`-alertCard shown`);
  /// the same page at approximate location offers it; "Not now" puts it away, so the next launch
  /// shows none. Each launch shows the card as the first does (`-alertCard shown`), else the
  /// stand-in's store would hide it whatever was kept (`CardHidden`).
  @MainActor
  func testTheCardOnlyWhereYouAre() throws {
    let city = launch(Self.leeds + ["-alertCard", "shown"])
    try expectNoCard(in: city, on: "leeds-dry", "on Leeds's page with Leeds chosen")
    city.terminate()

    let launching = Self.whereYouAre + ["-alertCard", "shown"]
    let app = launch(launching)
    try showTheCard(in: app, on: "leeds-dry")
    try waitFor("card-line", in: app, label: Copy.cardOffer)
    attach(app, as: "app-card-offer")
    let notNow = app.find("card-not-now")
    watchedTap(
      "card-not-now", in: app, until: { ElementRead(app, "notification-card").gone },
      { notNow.tap() })
    if let still = gone("notification-card", in: app) {
      XCTFail("The card is still there after Not now: \(still); \(app.cancelsReport)")
    }
    app.terminate()

    let again = launch(launching, reset: false)
    try expectNoCard(in: again, on: "leeds-dry", "after Not now")
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
    try openThePicker(in: app, after: shown)
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

  /// What Settings → Notifications, the "Where you are" page, the search screen's bells and
  /// line, Your privacy and the card say, as packages/mobile's `APP_COPY` and core word them
  /// (AppCopy.swift, CoreCopy.swift), with the towns and zones the devices fixtures name, and the
  /// Met Office's page (`Constants.Outbound`): typed here, as SettingsTests types Settings', since
  /// the UI tests link none of the app's modules.
  private enum Copy {
    static let hereKept =
      "Uses your location if you share it, otherwise a rough place from your internet "
      + "connection, which we keep while notifications are on."
    static let approximate = "Approximate, from your internet connection"
    static let yourLocation = "Your location"
    static let hereTitle = "Where you are"
    static let hereAbout =
      "Notifications for where you are use your location if you share it with the app, "
      + "otherwise a rough place from your internet connection. It's updated when you open the "
      + "app, at most once an hour, and kept only while notifications are on."
    static let myLocation = "Use my location"
    static let notifyDenied = "Notifications are off for this app in Settings."
    static let testSent = "Sent. It should arrive in a few seconds."
    static let testLimited = "You can send 3 test notifications an hour. Try again later."
    static let testSentTwo = "Sent 2 test notifications. They should arrive in a few seconds."
    static let testQuiet = "Nothing is sent from 9pm to 7am. Try again after 7am."
    static let testDryRun = "Our server isn't sending notifications yet, so nothing was sent."
    static let testFailed = "Couldn't send a test notification. Try again later."
    static let notSaved =
      "Couldn't save your notification choices. The app will try again when you next open it."
    static let kept = "What we keep for notifications"
    static let keptHere = "Where you are: Leeds, Europe/London"
    static let keptDurham = "Durham, Europe/London"
    static let keptDeviceZone = "Your iPhone's time zone: Europe/London"
    static let keptUnits = "Snow units: cm"
    static let evening = "Evening before (about 6pm)"
    static let deleteDone =
      "Notifications are off. We've deleted your notification token, places, units and choices."
    static let savedLocked = "With the one-off purchase"
    static let savedOff = "Off"
    static let savedOne = "1 on"
    static let upgradeTitle = "No ads, widgets and more"
    static let bellOn = "Turn on notifications for Durham"
    static let bellOff = "Turn off notifications for Durham"
    static let bellHint = "Tap a place's bell to get notifications for it."
    static let cardOffer = "Get a notification the evening before snow is likely where you are."
    static let cardOnNearLeeds =
      "Done. You'll get a notification the evening before snow is likely near Leeds. You can "
      + "change this in Settings."
    static let metOfficeWarnings =
      "https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings"
  }

  /// Launches the app with `-uitest`, `-noads 1`, the clock fixed (`-clock fixed`, at the
  /// fixture's moment), the recorder (`-openURLs record`) and location never asked (`notAsked`),
  /// from a clean store unless not `reset` (a relaunch, which keeps what the first launch kept,
  /// so `-place` is left out), and `extra`; waits for the answer's verdict.
  @MainActor
  private func launch(_ extra: [String], reset: Bool = true) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments =
      ["-uitest", "-noads", "1", "-clock", "fixed", "-openURLs", "record"] + Self.notAsked
      + (reset ? ["-resetStore"] : []) + extra
    app.launch()
    launched = app
    XCTAssertTrue(app.staticTexts["verdict"].waitForExistence(timeout: 15), "No answer on screen")
    return app
  }

  /// Taps the gear, and waits for Settings, by its Close and its title, with its Notifications. A
  /// tap whose touch the system cancelled (`watchedTap`) and that opened no Settings is tapped
  /// once more; a tap the app completed never is (SettingsTests' `openSettings`).
  @MainActor
  private func openSettings(_ app: XCUIApplication) throws {
    let gear = app.buttons["settings"]
    let close = app.buttons["close-settings"]
    // Opened, and not opened, as the home screen shows it (`sheetClosed`), not by Close, which
    // XCUITest may go on finding once an earlier Settings has closed.
    watchedTap("the gear", in: app, until: { !app.sheetClosed }, { gear.tap() })
    guard close.waitForExistence(timeout: 5) else {
      throw HomeScreenError(
        "No Settings after tapping the gear; \(app.cancelsReport); \(app.homeGeometry)")
    }
    try page(titled: "Settings", in: app)
    guard app.find("notifications-heading").waitForExistence(timeout: 5) else {
      throw HomeScreenError("No Notifications in Settings")
    }
    noteSettingsTop(in: app)
  }

  /// Opens Your privacy from Settings' row, and waits for its title on the page.
  @MainActor
  private func openYourPrivacy(in app: XCUIApplication) throws {
    try tap("your-privacy", in: app) { app.showsPage(titled: "Your privacy") }
    try page(titled: "Your privacy", in: app)
  }

  /// Turns the evening notification on, from off, in Settings, and waits for the switch to say
  /// so.
  @MainActor
  private func turnOnTheEvening(in app: XCUIApplication) throws {
    let evening = app.find("notify-evening")
    try expectSwitch(evening, on: false)
    try tap("notify-evening", in: app) { holds("notify-evening", "1", in: app) }
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
    throw HomeScreenError(
      "No page titled \"\(title)\"; the titles on screen: \(shown); \(app.cancelsReport)")
  }

  /// Goes back one page on Settings' stack, watched (`watchedTap`) until `done`, the page left
  /// gone: never the page under it, which may be in the tree all along.
  @MainActor
  private func back(in app: XCUIApplication, until done: () -> Bool) {
    let button = app.navigationBars.buttons.element(boundBy: 0)
    watchedTap("Back", in: app, until: done) { button.tap() }
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
        throw HomeScreenError(
          "\(element) never turned \(on ? "on" : "off"); its value: \(value); \(cancels)")
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.25))
    }
  }

  /// Waits up to 10 seconds for the element identified `id` to read `label`, from snapshots
  /// (`readElement`, by `readUntil`'s rules): of any type, the first in the tree, as `app.find`
  /// took it; of a `type`, the only one. Throws, stopping the test, with what the last read found,
  /// never a fresh read, and the touches cancelled: not a predicate in an `XCTWaiter`, whose one
  /// evaluation a busy simulator can stretch past the deadline, a verdict then made on no read
  /// (docs/DECISIONS.md, "What PR #46's first macOS run showed").
  @MainActor
  private func waitFor(
    _ id: String,
    _ type: XCUIElement.ElementType = .any,
    in app: XCUIApplication,
    label: String
  ) throws {
    let read = readElement(id, type, in: app, within: 10, "to read \"\(label)\"") {
      (type == .any ? $0.found : $0.one) && $0.label == label
    }
    if let failure = read {
      throw HomeScreenError("\(id) never read \"\(label)\": \(failure); \(cancels)")
    }
  }

  /// Waits up to 10 seconds for the value of the element identified `id` to be `value`: the
  /// place row's place, the test row's result, the recorder's last link (`debug-opened`, a text).
  /// Read as `waitFor(_:_:in:label:)` reads; throws with what the last read found.
  @MainActor
  private func waitFor(
    _ id: String,
    _ type: XCUIElement.ElementType = .any,
    in app: XCUIApplication,
    value: String
  ) throws {
    let read = readElement(id, type, in: app, within: 10, "to hold \"\(value)\"") {
      (type == .any ? $0.found : $0.one) && $0.value == value
    }
    if let failure = read {
      throw HomeScreenError("\(id) never held \"\(value)\": \(failure); \(cancels)")
    }
  }

  /// Waits up to 10 seconds for "Where you are" (`notify-here` in Settings, `notify-place-here`
  /// on its page) to say how where you are was found, `note`, in its label, and, given a `town`,
  /// to hold it as its value: the row's note is in its label, and its town, when it has one, is
  /// its value. Read as `waitFor(_:_:in:label:)` reads; throws with what the last read found.
  @MainActor
  private func waitForHere(
    _ id: String = "notify-here",
    in app: XCUIApplication,
    note: String,
    town: String? = nil
  ) throws {
    let says = town.map { "\"\(note)\" and \"\($0)\"" } ?? "\"\(note)\""
    let read = readElement(id, in: app, within: 10, "to say \(says)") { read in
      read.found && read.label.contains(note) && (town.map { read.value == $0 } ?? true)
    }
    if let failure = read {
      throw HomeScreenError("\(id) never said \(says): \(failure); \(cancels)")
    }
  }

  /// The launched app's `debug-cancels` (`cancelsReport`), for a wait's failure: a gesture the
  /// simulator cancelled then names itself.
  @MainActor
  private var cancels: String {
    launched?.cancelsReport ?? "debug-cancels reads nothing"
  }

  /// Nil when the element identified `id` is gone, or goes within 10 seconds, as a read of the
  /// app that ended in time finds none (`readElement`; an app that couldn't be read is never one
  /// without it); otherwise what the last read found, for the caller's failure. Each test asks
  /// only once it has read what took its place (a line's new words, a switch's value), as
  /// XCUITest's tree can lag the screen.
  @MainActor
  private func gone(_ id: String, in app: XCUIApplication) -> String? {
    readElement(id, in: app, within: 10, "to go") { $0.gone }
  }

  /// Taps the element identified `id` on Settings or a page on its stack, whatever type XCUITest
  /// gives it, once it lies whole on screen (`reveal`): a switch at its centre, which its whole
  /// row takes (`SheetSwitchStyle`). Watched (`watchedTap`) until `done`, what the tap brings,
  /// never met before it: a tap whose touch the system cancelled and that brought nothing is
  /// played once more, as Report an ad's should have been on main's run on 1d643d3.
  @MainActor
  private func tap(_ id: String, in app: XCUIApplication, until done: () -> Bool) throws {
    let element = app.find(id)
    try reveal(element, in: app)
    watchedTap(id, in: app, until: done) { element.tap() }
  }

  /// Whether one read of the app (`ElementRead`) finds the element identified `id` holding
  /// `value`, as `waitFor(_:_:in:value:)` judges it (of any type, the first; of a `type`, the
  /// only one): a switch turned on ("1"), a row's result, the recorder's line.
  @MainActor
  private func holds(
    _ id: String,
    _ value: String,
    _ type: XCUIElement.ElementType = .any,
    in app: XCUIApplication
  ) -> Bool {
    let read = ElementRead(app, id, type)
    return (type == .any ? read.found : read.one) && read.value == value
  }

  /// Whether one read of the app finds the first element identified `id` reading `label`, as
  /// `waitFor(_:_:in:label:)` judges it: a line's new words.
  @MainActor
  private func says(_ id: String, _ label: String, in app: XCUIApplication) -> Bool {
    let read = ElementRead(app, id)
    return read.found && read.label == label
  }

  /// Whether the readout reads a picker open that came after it counted `shown` (`pickerOpens`);
  /// nil when it can't be read, as under the picker it may not be.
  @MainActor
  private func pickerOpen(in app: XCUIApplication, after shown: Int) -> Bool? {
    app.pickerState.map { $0 == "open" && (app.pickersShown ?? 0) > shown }
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
        "\(element) at \(element.frame) never came whole on screen, within \(shown(in: app)); "
          + app.cancelsReport)
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

  /// Settings' title on its page (`page-title`), which scrolls with it.
  @MainActor
  private func settingsTitle(in app: XCUIApplication) -> XCUIElement {
    let titled = NSPredicate(format: "identifier == 'page-title' AND label == 'Settings'")
    return app.staticTexts.matching(titled).firstMatch
  }

  /// Notes where Settings' title lies once it has stopped moving, Settings having just opened at
  /// its top, for `expectSettingsAtItsTop`.
  @MainActor
  private func noteSettingsTop(in app: XCUIApplication) {
    settingsTop = settledFrame(of: settingsTitle(in: app)).minY
  }

  /// Throws unless Settings is at its top, its title within half a point of where it lay when
  /// Settings opened (`noteSettingsTop`), saying where it is. Settings is audited only there: a
  /// tap on a row not whole on screen (`reveal`) scrolls it, and scrolled, iOS 26's scroll-edge
  /// effect fades the page under the bar and the tree keeps what has gone under the bar or off
  /// the sheet, which the contrast check then reads against other pixels (PR #43's first macOS
  /// run). It never drags: at the top, a drag down can pull the sheet down to close.
  @MainActor
  private func expectSettingsAtItsTop(in app: XCUIApplication) throws {
    guard let top = settingsTop else {
      throw HomeScreenError("Settings' top was never noted: open it with openSettings")
    }
    let now = settledFrame(of: settingsTitle(in: app)).minY
    guard abs(now - top) <= 0.5 else {
      throw HomeScreenError(
        "Settings isn't at its top for its audit: its title is at \(now), where it opened at "
          + "\(top); \(app.cancelsReport)")
    }
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

  /// Shows the middle page of `screen`, as `showTheCard` does, and throws, saying `when`, unless
  /// it has no card once its footer is there (`updated`, the end of the page's content, read with
  /// the rest of the answer): a snapshot read that finds none in an app it could read (`gone`).
  @MainActor
  private func expectNoCard(
    in app: XCUIApplication, on screen: String, _ when: String
  ) throws {
    let middle = try HomeScreen.named(screen).page("today")
    if app.heading.label != middle.heading { try tap(middle, in: app) }
    guard app.find("updated").waitForExistence(timeout: 10) else {
      throw HomeScreenError("No footer on the \(middle.view) page \(when)")
    }
    if let card = gone("notification-card", in: app) {
      throw HomeScreenError("A card \(when): \(card); \(cancels)")
    }
  }

  /// Waits for the picker a tap opened, after the readout counted `shown` (`pickerOpens`), and
  /// its search box; throws, saying `what` was tapped, without it.
  @MainActor
  private func expectThePicker(in app: XCUIApplication, after shown: Int, _ what: String) throws {
    guard pickerOpens(in: app, after: shown, within: 10) != false else {
      throw HomeScreenError("No picker \(what); \(app.pickerReport); \(app.cancelsReport)")
    }
    guard app.find("place-search").waitForExistence(timeout: 10) else {
      throw HomeScreenError("No picker \(what); \(app.cancelsReport); \(app.homeGeometry)")
    }
  }

  /// Taps the place button and waits for the picker it opens, after the readout counted `shown`
  /// (`expectThePicker`). A tap whose touch the system cancelled (`watchedTap`) and that opened
  /// no picker is tapped once more; a tap the app completed never is (PickerTests' `openPicker`).
  @MainActor
  private func openThePicker(in app: XCUIApplication, after shown: Int) throws {
    let place = app.buttons["place"]
    let field = app.find("place-search")
    // The search box ends the wait only while the readout can't be read: an earlier picker's may
    // still be in XCUITest's tree. Only the readout, read and not open, has the tap played again.
    watchedTap(
      "the place button", in: app,
      until: { pickerOpen(in: app, after: shown) ?? field.exists },
      again: { self.pickerOpen(in: app, after: shown) == false }, { place.tap() })
    try expectThePicker(in: app, after: shown, "after tapping the place button")
  }

  /// Closes the picker opened after the readout counted `shown`, watched (`watchedTap`) until
  /// the readout no longer reads it open, and waits for the readout to say it has closed
  /// (`pickerCloses`). Under the picker the readout, and `debug-cancels` with it, may not be
  /// read, and then nothing is played again.
  @MainActor
  private func closeThePicker(in app: XCUIApplication, after shown: Int) throws {
    let close = app.buttons["picker-close"]
    watchedTap(
      "picker-close", in: app, until: { app.pickerState.map { $0 != "open" } ?? false },
      { close.tap() })
    guard pickerCloses(in: app, after: shown, within: 10) else {
      throw HomeScreenError("The picker is still open; \(app.pickerReport); \(app.cancelsReport)")
    }
  }
}
