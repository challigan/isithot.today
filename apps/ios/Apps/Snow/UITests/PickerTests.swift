import UIKit
import XCTest

/// The place picker (iOS build spec, sections 10.3 and 17.2), over the app's own client and
/// store with only the network stubbed (`-network`, DebugHooks.swift): `ip-first-launch`
/// answers the launch's request for approximate IP location (Leeds, 12:05pm on 1 December 2026,
/// where the app's clock starts); each fixture named after it answers its own place
/// (`leeds-dry` for `place=leeds-gb`, `kathmandu-0545` for the point 27.7, 85.3); and the
/// picker's searches are answered by the search fixtures (`search-leeds`, `search-kathmandu`,
/// `search-none`), any other with an error. `-location` stands in for Core Location, so the
/// system's prompt never shows. Every launch starts from a clean store (`-resetStore`, the
/// recent and saved places too) unless a test relaunches on purpose. The picker is a page of rows
/// in the website's look (IsItUI's PlacePickerView): a place's star saves or removes it, and a
/// row's press-and-hold menu holds the same and Delete, since the rows aren't a `List` to swipe.
/// Every saved place has a bell beside its star (phase 8.4b, design 2.2): locked without the
/// one-off purchase, whose page it opens over the picker, and with it, its notifications on or
/// off; the line under the saved places says what a star and a bell do (`saved-line`, design
/// 2.3). `-saved` launches with saved places, after `-resetStore`.
final class PickerTests: XCTestCase {
  /// How many pickers the app's readout had counted (`debug-pickers`) before `openPicker` last
  /// tapped the place button, for `pickerCloses(in:after:within:)`.
  private var pickersBefore = 0

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
    wait(for: "search-status", .staticText, in: app, label: "No places found.")
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
    choose(result, "result-0", in: app)
    XCTAssertTrue(
      pickerCloses(in: app, after: pickersBefore, within: 10),
      "The picker is still open; \(app.pickerReport); \(app.cancelsReport)")
    waitForHeading("Leeds. Will it snow today? No.", in: app)
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
    choose(result, "result-0", in: app)
    wait(for: "place", .button, in: app, label: "Place: Kathmandu. Change place.")
    XCTAssertTrue(heading(in: app).label.hasPrefix("Kathmandu. Will it snow "))
    XCTAssertTrue(app.staticTexts["verdict"].waitForExistence(timeout: 10), "No answer")
  }

  /// A chosen place is a recent place, kept across launches with its line, chosen again from
  /// there, and deleted from its press-and-hold menu.
  @MainActor
  func testRecentPlaces() throws {
    let first = launch(["-resetStore", "-network", "ip-first-launch,leeds-dry"])
    var field = openPicker(in: first)
    // Nothing chosen yet: no recent places.
    XCTAssertFalse(first.staticTexts["recent-heading"].exists, "Recent places on a clean store")
    field.typeText("Leeds")
    XCTAssertTrue(first.buttons["result-0"].waitForExistence(timeout: 10), "No results")
    choose(first.buttons["result-0"], "result-0", in: first)
    wait(for: "place", .button, in: first, label: "Place: Leeds. Change place.")
    first.terminate()

    // Kept: opened again, Leeds is there under Recent.
    let app = launch(["-network", "ip-first-launch,leeds-dry"])
    field = openPicker(in: app)
    let recent = app.staticTexts["recent-heading"]
    XCTAssertTrue(recent.waitForExistence(timeout: 10), "No recent places after a relaunch")
    XCTAssertEqual(recent.label, "Recent")
    let leeds = app.buttons["recent-city:leeds-gb"]
    XCTAssertTrue(leeds.exists, "Leeds isn't a recent place")
    // With the line beneath its name, kept from its search result.
    XCTAssertEqual(leeds.label, "Leeds, England, United Kingdom")
    attachScreen(of: app, named: "picker-recent")

    // Typing hides them, and shows the box's clear button, 44 points square (the system's
    // search, whose clear button was about 20, is gone: PlacePickerView's `SearchBox`).
    field.typeText("Le")
    waitUntilGone("recent-heading", .staticText, in: app, "Recent places while typing")
    let clear = app.buttons["clear-search"]
    XCTAssertTrue(clear.waitForExistence(timeout: 5), "No clear button with text typed")
    XCTAssertEqual(clear.label, "Clear search")
    // To the pixel, as a frame laid out at exactly 44 can read back a hair under (`onPixels`).
    XCTAssertGreaterThanOrEqual(
      onPixels(clear.frame.width), 44, "The clear button at \(clear.frame)")
    XCTAssertGreaterThanOrEqual(
      onPixels(clear.frame.height), 44, "The clear button at \(clear.frame)")
    field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 2))
    XCTAssertTrue(leeds.waitForExistence(timeout: 10), "No recent places once cleared")
    waitUntilGone("clear-search", .button, in: app, "The clear button with nothing typed")

    // The clear button clears the box, and leaves it ready to type in.
    field.typeText("Le")
    waitUntilGone("recent-heading", .staticText, in: app, "Recent places while typing")
    XCTAssertTrue(clear.waitForExistence(timeout: 5), "No clear button with text typed")
    clearTheSearch(in: app)
    XCTAssertTrue(
      leeds.waitForExistence(timeout: 10), "No recent places once cleared; \(app.cancelsReport)")
    waitUntilGone("clear-search", .button, in: app, "The clear button after clearing")
    XCTAssertTrue(app.keyboards.firstMatch.exists, "The keyboard went with the text")

    // Deleted: press and hold, then Delete in its menu.
    leeds.press(forDuration: 1.2)
    let delete = menuItem("Delete", in: app)
    XCTAssertTrue(
      delete.waitForExistence(timeout: 5), "No Delete on press and hold; \(app.cancelsReport)")
    watchedTap(
      "Delete", in: app, until: { gone("recent-city:leeds-gb", in: app) }, { delete.tap() })
    waitUntilGone("recent-city:leeds-gb", .button, in: app, "Leeds is still a recent place")
    XCTAssertFalse(recent.exists, "Recent, over no recent places")
  }

  /// A result's star saves it in place: the sheet stays open on the same results and nothing is
  /// chosen. The place is then under Saved, not Recent, kept across launches, and chosen from
  /// there, staying under Saved. Before it, with nothing saved in the free version, the line
  /// under Saved says how to save a place and that a saved place can have notifications with the
  /// purchase (design 2.3).
  @MainActor
  func testSavingAResult() throws {
    let first = launch(["-resetStore", "-network", "ip-first-launch,leeds-dry"])
    let field = openPicker(in: first)
    wait(for: "saved-line", .staticText, in: first, label: Copy.noneSavedFree)
    field.typeText("Leeds")
    let star = first.buttons["star-result-0"]
    XCTAssertTrue(star.waitForExistence(timeout: 10), "No star beside Leeds")
    XCTAssertEqual(star.label, "Save Leeds")
    XCTAssertNotEqual(
      first.buttons["result-0"].value as? String, "Saved", "Leeds reads as saved already")
    tapStar("star-result-0", in: first, until: "Remove Leeds from saved places")
    wait(for: "star-result-0", .button, in: first, label: "Remove Leeds from saved places")
    XCTAssertEqual(first.buttons["result-0"].value as? String, "Saved")
    XCTAssertTrue(searchField(in: first).exists, "The star closed the picker")
    clearTheSearch(in: first)
    let saved = first.buttons["saved-city:leeds-gb"]
    XCTAssertTrue(
      saved.waitForExistence(timeout: 10), "Leeds isn't under Saved; \(first.cancelsReport)")
    XCTAssertEqual(saved.label, "Leeds, England, United Kingdom")
    XCTAssertEqual(first.staticTexts["saved-heading"].label, "Saved")
    XCTAssertFalse(first.buttons["recent-city:leeds-gb"].exists, "Leeds is under Recent too")
    // The star chose nothing: still on approximate location.
    closeThePicker(first)
    XCTAssertTrue(
      first.buttons["use-my-location"].waitForExistence(timeout: 10),
      "No longer on approximate location; \(first.cancelsReport)")
    first.terminate()

    // Kept: opened again, Leeds is still saved; chosen, the sheet closes and Leeds loads.
    let app = launch(["-network", "ip-first-launch,leeds-dry"])
    _ = openPicker(in: app, focusing: false)
    let kept = app.buttons["saved-city:leeds-gb"]
    XCTAssertTrue(kept.waitForExistence(timeout: 10), "Leeds isn't saved after a relaunch")
    choose(kept, "saved-city:leeds-gb", in: app)
    XCTAssertTrue(
      pickerCloses(in: app, after: pickersBefore, within: 10),
      "The picker is still open; \(app.pickerReport); \(app.cancelsReport)")
    waitForHeading("Leeds. Will it snow today? No.", in: app)
    XCTAssertEqual(app.buttons["place"].label, "Place: Leeds. Change place.")
    // Still under Saved, and not under Recent.
    _ = openPicker(in: app, focusing: false)
    XCTAssertTrue(kept.waitForExistence(timeout: 10), "Leeds is no longer saved")
    XCTAssertFalse(app.buttons["recent-city:leeds-gb"].exists, "A saved place joined Recent")
    XCTAssertFalse(app.staticTexts["recent-heading"].exists, "Recent, with nothing to show")
  }

  /// A recent place's star moves it to Saved, and the saved place's star brings it back to the
  /// top of Recent; saved again, its press-and-hold menu removes it too. The line under Saved
  /// follows, in the free version: how to save a place with none saved, and with Leeds saved,
  /// that its bell needs the purchase (design 2.3).
  @MainActor
  func testSavingARecentAndRemovingIt() throws {
    let app = launch(["-resetStore", "-network", "ip-first-launch,leeds-dry"])
    let field = openPicker(in: app)
    field.typeText("Leeds")
    XCTAssertTrue(app.buttons["result-0"].waitForExistence(timeout: 10), "No results")
    choose(app.buttons["result-0"], "result-0", in: app)
    wait(for: "place", .button, in: app, label: "Place: Leeds. Change place.")

    _ = openPicker(in: app, focusing: false)
    wait(for: "saved-line", .staticText, in: app, label: Copy.noneSavedFree)
    let recentStar = app.buttons["star-recent-city:leeds-gb"]
    XCTAssertEqual(recentStar.label, "Save Leeds")
    watchedTap(
      "star-recent-city:leeds-gb", in: app, until: { found("saved-city:leeds-gb", in: app) },
      { recentStar.tap() })
    let saved = app.buttons["saved-city:leeds-gb"]
    XCTAssertTrue(
      saved.waitForExistence(timeout: 10), "Leeds didn't move to Saved; \(app.cancelsReport)")
    waitUntilGone("recent-heading", .staticText, in: app, "Recent, with its only place saved")
    wait(for: "saved-line", .staticText, in: app, label: Copy.bellHintLocked)

    // Removed by its star: back under Recent, the line for none saved under Saved again.
    let savedStar = app.buttons["star-saved-city:leeds-gb"]
    XCTAssertEqual(savedStar.label, "Remove Leeds from saved places")
    watchedTap(
      "star-saved-city:leeds-gb", in: app, until: { found("recent-city:leeds-gb", in: app) },
      { savedStar.tap() })
    let recent = app.buttons["recent-city:leeds-gb"]
    XCTAssertTrue(
      recent.waitForExistence(timeout: 10), "Leeds isn't back under Recent; \(app.cancelsReport)")
    wait(for: "saved-line", .staticText, in: app, label: Copy.noneSavedFree)
    XCTAssertFalse(saved.exists, "Leeds is still saved")

    // Saved again, then removed from its press-and-hold menu.
    watchedTap(
      "star-recent-city:leeds-gb", in: app, until: { found("saved-city:leeds-gb", in: app) },
      { recentStar.tap() })
    XCTAssertTrue(
      saved.waitForExistence(timeout: 10),
      "Leeds didn't move to Saved again; \(app.cancelsReport)")
    saved.press(forDuration: 1.2)
    let remove = menuItem("Remove Leeds from saved places", in: app)
    XCTAssertTrue(
      remove.waitForExistence(timeout: 5), "No Remove on press and hold; \(app.cancelsReport)")
    watchedTap("Remove", in: app, until: { gone("saved-city:leeds-gb", in: app) }, { remove.tap() })
    waitUntilGone("saved-city:leeds-gb", .button, in: app, "Leeds is still saved")
    XCTAssertTrue(
      recent.waitForExistence(timeout: 10), "Leeds isn't back under Recent; \(app.cancelsReport)")
  }

  /// A saved place's bell, from the purchase to notifications off for the app (phase 8.4b; design
  /// 2.2 and 2.3, decisions 6 to 11). In the free version, with the purchase for sale (`-purchase
  /// bought`): Kathmandu, searched for and starred, has a bell beside its star, locked, which its
  /// label says ("…, with the one-off purchase"; the lock drawn on it is hidden from VoiceOver,
  /// and so from XCUITest). Its tap opens the purchase's page over the picker, not over the home
  /// screen; bought there and closed, the bell has turned on by itself, the stand-in allowing
  /// notifications at the prompt and "Evening before" turned on with it, as every switch was off
  /// (`put-here-ip-kathmandu`), and the picker is still on the results. Under Saved, its row's
  /// bell is on and there is no line under the saved places; turned off, the line says what a
  /// bell does; unsaved, the line says how to save a place, and that its bell gets notifications.
  /// Then a launch that owns the purchase (`-unlocked 1`) with Kathmandu saved and notifications
  /// off for the app in iOS Settings (`-notifications denied`): the bell shows off, and its tap
  /// says notifications are off for the app, with Open Settings, which asks for the app's
  /// notification settings (read from the Debug recorder, `-openURLs record`).
  @MainActor
  func testTheBellJourney() throws {
    let app = launch([
      "-resetStore", "-network", "ip-first-launch", "-location", "denied", "-purchase", "bought",
    ])
    let field = openPicker(in: app)
    field.typeText("Kathmandu")
    let star = app.buttons["star-result-0"]
    XCTAssertTrue(star.waitForExistence(timeout: 10), "No star beside Kathmandu")
    tapStar("star-result-0", in: app, until: "Remove Kathmandu from saved places")
    wait(for: "bell-result-0", .button, in: app, label: Copy.bellLocked("Kathmandu"))
    attachScreen(of: app, named: "picker-bell-locked")
    // Locked: the purchase's page, over the picker.
    let locked = app.buttons["bell-result-0"]
    watchedTap(
      "bell-result-0", in: app, until: { app.showsPage(titled: Copy.upgradeTitle) },
      { locked.tap() })
    let buy = app.buttons["buy"]
    XCTAssertTrue(
      buy.waitForExistence(timeout: 10),
      "No Buy on the purchase's page over the picker; \(app.cancelsReport)")
    watchedTap("buy", in: app, until: { ElementRead(app, "upgrade-outcome").found }, { buy.tap() })
    wait(for: "upgrade-outcome", .any, in: app, label: Copy.thanks)
    let close = app.buttons["close-upgrade"]
    watchedTap(
      "close-upgrade", in: app, until: { app.lacksPage(titled: Copy.upgradeTitle) },
      { close.tap() })
    // Bought and closed: the bell it opened from is on, and the picker still on the results.
    wait(for: "bell-result-0", .button, in: app, label: Copy.bellOff("Kathmandu"))
    XCTAssertTrue(searchField(in: app).exists, "The purchase closed the picker")

    clearTheSearch(in: app)
    let id = "saved-search:27.7,85.3"
    XCTAssertTrue(
      app.buttons[id].waitForExistence(timeout: 10),
      "Kathmandu isn't under Saved; \(app.cancelsReport)")
    wait(for: "bell-" + id, .button, in: app, label: Copy.bellOff("Kathmandu"))
    waitUntilGone("saved-line", .staticText, in: app, "The line under Saved, with a bell on")
    tapBell("bell-" + id, in: app, until: Copy.bellOn("Kathmandu"))
    wait(for: "bell-" + id, .button, in: app, label: Copy.bellOn("Kathmandu"))
    wait(for: "saved-line", .staticText, in: app, label: Copy.bellHint)
    let savedStar = app.buttons["star-" + id]
    watchedTap("star-" + id, in: app, until: { gone(id, in: app) }, { savedStar.tap() })
    waitUntilGone(id, .button, in: app, "Kathmandu is still saved")
    wait(for: "saved-line", .staticText, in: app, label: Copy.noneSavedPaid)
    app.terminate()

    let denied = launch([
      "-resetStore", "-network", "ip-first-launch", "-location", "denied", "-unlocked", "1",
      "-saved", Self.kathmandu, "-notifications", "denied", "-openURLs", "record",
    ])
    _ = openPicker(in: denied, focusing: false)
    XCTAssertTrue(
      denied.buttons[id].waitForExistence(timeout: 10), "Kathmandu isn't saved (-saved)")
    wait(for: "bell-" + id, .button, in: denied, label: Copy.bellOn("Kathmandu"))
    let bell = denied.buttons["bell-" + id]
    watchedTap(
      "bell-" + id, in: denied, until: { found("bell-denied", in: denied) }, { bell.tap() })
    wait(for: "bell-denied", .staticText, in: denied, label: Copy.notifyDenied)
    wait(for: "bell-open-settings", .button, in: denied, label: Copy.openSettings)
    wait(for: "bell-" + id, .button, in: denied, label: Copy.bellOn("Kathmandu"))
    attachScreen(of: denied, named: "picker-bell-denied")
    let open = denied.buttons["bell-open-settings"]
    watchedTap(
      "bell-open-settings", in: denied, until: { notificationSettingsAsked(in: denied) },
      { open.tap() })
    let asked = readElement(
      "debug-opened", .staticText, in: denied, within: 10,
      "to hold the app's notification settings"
    ) { $0.one && $0.value == UIApplication.openNotificationSettingsURLString }
    if let failure = asked {
      XCTFail(
        "debug-opened never held \(UIApplication.openNotificationSettingsURLString): \(failure)")
    }
  }

  /// With location access off, "Use my location" says so, with Open Settings, and the search
  /// still works. Opened from the top bar's "Use my exact location" chip, the picker starts there:
  /// tapped on its line above the chip, outside its element (IsItUI's `PillButton`, drawn 34
  /// tall), as the whole 44-point line is the button.
  @MainActor
  func testUseMyLocationDenied() throws {
    let app = launch(["-resetStore", "-network", "ip-first-launch", "-location", "denied"])
    let chip = app.buttons["use-my-location"]
    watchedTap(
      "use-my-location", in: app, until: { found("location-detail", in: app) },
      { tapOutsideItsWords(chip) })
    let detail = app.staticTexts["location-detail"]
    XCTAssertTrue(
      detail.waitForExistence(timeout: 10),
      "No line for location access off; \(app.cancelsReport)")
    XCTAssertEqual(detail.label, "Location access is off. Search for a place instead.")
    XCTAssertEqual(app.buttons["open-settings"].label, "Open Settings")
    // The picker's own row says the same. Not watched: what it brings is on screen already.
    app.buttons["picker-use-my-location"].tap()
    wait(
      for: "location-detail", .staticText, in: app,
      label: "Location access is off. Search for a place instead.")
    XCTAssertTrue(searchField(in: app).exists, "The picker closed")
    attachScreen(of: app, named: "picker-location-denied")
    // Close: still on approximate location.
    closeThePicker(app)
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
    askForTheLocation(in: app)
    let open = app.buttons["open-settings"]
    XCTAssertTrue(open.waitForExistence(timeout: 10), "No Open Settings; \(app.cancelsReport)")
    watchedTap("open-settings", in: app, until: { settingsAsked(in: app) }, { open.tap() })
    let settingsPage = readElement(
      "debug-opened", .staticText, in: app, within: 10, "to hold the app's settings"
    ) { asksForSettings($0) }
    if let failure = settingsPage {
      XCTFail("debug-opened never held a URL starting \"app-settings:\": \(failure)")
    }
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
    let row = app.buttons["picker-use-my-location"]
    watchedTap("picker-use-my-location", in: app, until: { pickerLeft(app) }, { row.tap() })
    wait(for: "place", .button, in: app, label: "Place: Kathmandu. Change place.")
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
    choose(app.buttons["result-0"], "result-0", in: app)
    wait(for: "place", .button, in: app, label: "Place: Leeds. Change place.")
    _ = openPicker(in: app, focusing: false)
    XCTAssertTrue(app.buttons["recent-city:leeds-gb"].waitForExistence(timeout: 10))
    askForTheLocation(in: app)
    XCTAssertTrue(
      app.buttons["open-settings"].waitForExistence(timeout: 10),
      "No Open Settings; \(app.cancelsReport)")
    attachScreen(of: app, named: "picker-audit")
    try auditAccessibility(
      of: app, on: "the picker, with a recent place and location access off",
      surface: try HomeScreen.named("picker-leeds").picker())
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
    expectTheKeyboard(in: app, "before the drag on the results")
    result.swipeDown()
    waitUntilGone(nil, .keyboard, in: app, "The keyboard is still up")
    XCTAssertTrue(result.exists, "The results went with the keyboard")
    attachScreen(of: app, named: "picker-results-audit")
    try auditAccessibility(
      of: app, on: "the picker's results",
      surface: try HomeScreen.named("picker-first-launch").picker())
  }

  /// The picker passes the audit with saved and recent places, at Large and at AX3: Kathmandu
  /// saved from a search, its bell locked beside its star (phase 8.4b), Leeds a recent place,
  /// location access off, and the keyboard down. At AX3 a saved row's bell and star are on their
  /// own line under its name (design 2.2).
  @MainActor
  func testSavedPlacesAccessibilityAudit() throws {
    try auditSavedPlaces(at: .large, named: "picker-saved")
  }

  /// At AX3, then one launch at AX5 (`checkTheBellRowAtAX5`).
  @MainActor
  func testSavedPlacesAccessibilityAuditAtAX3() throws {
    try auditSavedPlaces(at: .ax3, named: "picker-saved-ax3")
    try checkTheBellRowAtAX5()
  }

  /// On a dark band (`aberdeen-snow`, the snow band, light ink on deep purple), the picker
  /// wears the page's colours: audited at Large with a place saved from a search.
  @MainActor
  func testPickerOnADarkBand() throws {
    let app = launch(["-resetStore", "-fixture", "aberdeen-snow"])
    let field = openPicker(in: app)
    field.typeText("Leeds")
    let star = app.buttons["star-result-0"]
    XCTAssertTrue(star.waitForExistence(timeout: 10), "No star beside Leeds")
    tapStar("star-result-0", in: app, until: "Remove Leeds from saved places")
    wait(for: "star-result-0", .button, in: app, label: "Remove Leeds from saved places")
    clearTheSearch(in: app)
    XCTAssertTrue(
      app.buttons["saved-city:leeds-gb"].waitForExistence(timeout: 10),
      "Leeds isn't under Saved; \(app.cancelsReport)")
    putTheKeyboardAway(app)
    attachScreen(of: app, named: "picker-dark")
    try auditAccessibility(
      of: app, on: "the picker on a dark band, with a saved place",
      surface: try HomeScreen.named("aberdeen-snow").picker())
  }

  // MARK: - Helpers

  /// The search screen's words for the bells and the line under Saved (phase 8.4b), as
  /// packages/mobile's `APP_COPY` words them (AppCopy.swift), and the purchase's page's: typed
  /// here, as the other suites type theirs, since the UI tests link none of the app's modules.
  private enum Copy {
    static let noneSavedFree =
      "Tap the star beside a place to save it. Saved places can have notifications with the "
      + "one-off purchase."
    static let noneSavedPaid =
      "Tap the star beside a place to save it, then tap its bell to get notifications."
    static let bellHintLocked =
      "Tap a place's bell to get notifications for it, with the one-off purchase."
    static let bellHint = "Tap a place's bell to get notifications for it."
    static let notifyDenied = "Notifications are off for this app in Settings."
    static let openSettings = "Open Settings"
    static let upgradeTitle = "No ads, widgets and more"
    static let thanks =
      "Thank you. Ads are off, widgets are on and you can turn on notifications for saved places."

    /// A bell's label as it shows: locked, off (a tap turns it on), and on (a tap turns it off).
    static func bellLocked(_ place: String) -> String {
      "Turn on notifications for \(place), with the one-off purchase"
    }

    static func bellOn(_ place: String) -> String { "Turn on notifications for \(place)" }
    static func bellOff(_ place: String) -> String { "Turn off notifications for \(place)" }
  }

  /// Kathmandu as `search-kathmandu`'s result has it, for `-saved`: the query the picker's star
  /// saves, so its set is `put-here-ip-kathmandu`'s.
  private static let kathmandu =
    "lat=27.7&lon=85.3&source=search&name=Kathmandu&region=Bagmati%20Province&country=NP"
    + "&geonameId=1283240&elevation=50"

  /// Rovaniemi, a searched place with a long name, for `-saved`.
  private static let rovaniemi = "lat=66.5&lon=25.73&source=search&name=Rovaniemi&country=FI"

  /// AX5, the largest accessibility text size, which `TextSize` has no case for.
  private static let ax5 = [
    "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
  ]

  /// One launch at AX5 with Rovaniemi saved, its bell locked: the row's bell and star on their
  /// own line under the name (design 2.2), so "Rovaniemi" isn't cut mid-word. Attached as
  /// `picker-saved-ax5` for the contact sheet, then the audit's clipped-text check alone, run as
  /// every audit's calls are (`runAudit`, again once on the same screen should it not finish in
  /// time); its other kinds are the AX3 audit's. Fails listing each issue.
  @MainActor
  private func checkTheBellRowAtAX5() throws {
    let app = launch(
      [
        "-resetStore", "-network", "ip-first-launch", "-location", "denied", "-saved",
        Self.rovaniemi,
      ] + Self.ax5)
    _ = openPicker(in: app, focusing: false)
    let id = "saved-search:66.5,25.73"
    XCTAssertTrue(
      app.buttons[id].waitForExistence(timeout: 10), "Rovaniemi isn't saved (-saved)")
    wait(for: "bell-" + id, .button, in: app, label: Copy.bellLocked("Rovaniemi"))
    attachScreen(of: app, named: "picker-saved-ax5")
    let times = AuditTimes()
    defer { attachText(times.text, as: "audit-the-picker-at-ax5-times") }
    let audited = ScreenLayout(app)
    let issues = try runAudit(
      of: app, for: .textClipped, at: "the picker at AX5", timing: times,
      onTimeout: .runAgain {
        guard app.state == .runningForeground else {
          return "the app isn't in the foreground (state \(app.state.rawValue))"
        }
        return ScreenLayout.change(from: audited, to: ScreenLayout(app))
      })
    let found = issues.map {
      "\($0.auditType.names): \($0.compactDescription) (\(describeElement($0.element))): "
        + $0.detailedDescription
    }
    XCTAssertTrue(
      found.isEmpty,
      "\(found.count) clipped-text issues on the picker at AX5:\n"
        + found.joined(separator: "\n"))
  }

  /// Saves Kathmandu from a search and chooses Leeds, a recent place, at `size`, with location
  /// access off and its line and Open Settings showing, then audits the picker with the
  /// keyboard down, attaching its screen as `name`.
  @MainActor
  private func auditSavedPlaces(at size: TextSize, named name: String) throws {
    let app = launch(
      ["-resetStore", "-network", "ip-first-launch,leeds-dry", "-location", "denied"]
        + size.arguments)
    var field = openPicker(in: app)
    field.typeText("Leeds")
    XCTAssertTrue(app.buttons["result-0"].waitForExistence(timeout: 10), "No results")
    choose(app.buttons["result-0"], "result-0", in: app)
    wait(for: "place", .button, in: app, label: "Place: Leeds. Change place.")
    field = openPicker(in: app)
    field.typeText("Kathmandu")
    let star = app.buttons["star-result-0"]
    XCTAssertTrue(star.waitForExistence(timeout: 10), "No star beside Kathmandu")
    tapStar("star-result-0", in: app, until: "Remove Kathmandu from saved places")
    wait(for: "star-result-0", .button, in: app, label: "Remove Kathmandu from saved places")
    clearTheSearch(in: app)
    let saved = app.buttons["saved-search:27.7,85.3"]
    XCTAssertTrue(
      saved.waitForExistence(timeout: 10), "Kathmandu isn't under Saved; \(app.cancelsReport)")
    XCTAssertEqual(saved.label, "Kathmandu, Bagmati Province, Nepal")
    XCTAssertTrue(app.buttons["recent-city:leeds-gb"].exists, "Leeds isn't under Recent")
    askForTheLocation(in: app)
    XCTAssertTrue(
      app.buttons["open-settings"].waitForExistence(timeout: 10),
      "No Open Settings; \(app.cancelsReport)")
    putTheKeyboardAway(app)
    attachScreen(of: app, named: name)
    let at = size == .ax3 ? "AX3" : "Large"
    try auditAccessibility(
      of: app, on: "the picker, with saved and recent places, at \(at)",
      surface: try HomeScreen.named("picker-leeds").picker())
  }

  /// Puts the keyboard away with a drag on the rows, as they ask
  /// (`scrollDismissesKeyboard(.immediately)`): on "Use my location", the first row, which the
  /// keyboard never covers, at any text size.
  @MainActor
  private func putTheKeyboardAway(_ app: XCUIApplication) {
    let row = app.buttons["picker-use-my-location"]
    expectTheKeyboard(in: app, "before the drag on the rows")
    row.swipeDown()
    waitUntilGone(nil, .keyboard, in: app, "The keyboard is still up")
    XCTAssertTrue(row.exists, "The rows went with the keyboard")
  }

  /// An item of a row's press-and-hold menu, by its words: a button with that label that isn't a
  /// place's star, whose label a menu item may share ("Remove Leeds from saved places").
  @MainActor
  private func menuItem(_ label: String, in app: XCUIApplication) -> XCUIElement {
    let format = "label == %@ AND NOT (identifier BEGINSWITH %@)"
    return app.buttons.matching(NSPredicate(format: format, label, "star-")).firstMatch
  }

  /// Launches the app with `-uitest`, `-noads 1` (no consent form or ad, as `launchApp`) and
  /// `arguments`, and waits for the heading, from snapshots (`readHeading`, as `launchApp` does).
  @MainActor
  private func launch(_ arguments: [String]) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-uitest", "-noads", "1"] + arguments
    app.launch()
    if let failure = readHeading(in: app, within: 15, "to come after the launch", until: \.found) {
      XCTFail("No heading on screen: \(failure)")
    }
    return app
  }

  /// Opens the picker with the place button, and gives its search field, focused unless not
  /// `focusing`, with no clear button while it is empty. Notes the pickers the app's readout had
  /// counted (`pickersBefore`), and waits for it to read a new one open (`pickerOpens`), so a
  /// closed picker's search box that XCUITest still finds is never taken for this one's. A tap
  /// whose touch the system cancelled (`watchedTap`) and that opened no picker is tapped once
  /// more, and so is a tap on the search box that brought no keyboard; a tap the app completed
  /// never is. With no picker, the failure says where the top bar was (on main's first macOS run
  /// the place button was under the status bar, where the tap never reached it) and
  /// `debug-cancels`.
  @MainActor
  private func openPicker(in app: XCUIApplication, focusing: Bool = true) -> XCUIElement {
    pickersBefore = app.pickersShown ?? 0
    let before = pickersBefore
    let place = app.buttons["place"]
    let field = searchField(in: app)
    // Whether the readout reads this tap's picker open; nil when it can't be read, as under the
    // picker it may not be (`pickerOpens`).
    let open = { app.pickerState.map { $0 == "open" && (app.pickersShown ?? 0) > before } }
    // The search box ends the wait only while the readout can't be read: an earlier picker's may
    // still be in XCUITest's tree. Only the readout, read and not open, has the tap played again.
    let shown = { open() ?? field.exists }
    watchedTap(
      "the place button", in: app, until: shown, again: { open() == false }, { place.tap() })
    let opened = pickerOpens(in: app, after: pickersBefore, within: 10)
    XCTAssertNotEqual(
      opened, false,
      "No picker after tapping the place button; \(app.pickerReport); \(app.cancelsReport); "
        + app.homeGeometry)
    XCTAssertTrue(
      field.waitForExistence(timeout: 10),
      "No picker after tapping the place button; \(app.cancelsReport); \(app.homeGeometry)")
    XCTAssertEqual(field.placeholderValue, "Town or city")
    XCTAssertFalse(app.buttons["clear-search"].exists, "A clear button with nothing typed")
    XCTAssertTrue(app.buttons["picker-use-my-location"].exists, "No Use my location")
    if focusing {
      watchedTap(
        "place-search", in: app, until: { found(nil, .keyboard, in: app) }, { field.tap() })
    }
    return field
  }

  /// Chooses the place `element`, the row identified `id` (a result, or a recent or saved
  /// place), watched (`watchedTap`) until the picker is no longer open (`pickerLeft`).
  @MainActor
  private func choose(_ element: XCUIElement, _ id: String, in app: XCUIApplication) {
    watchedTap(id, in: app, until: { pickerLeft(app) }, { element.tap() })
  }

  /// Taps the star identified `id`, watched (`watchedTap`) until it reads `label`, the other of
  /// "Save Leeds" and "Remove Leeds from saved places".
  @MainActor
  private func tapStar(_ id: String, in app: XCUIApplication, until label: String) {
    let star = app.buttons[id]
    let turned = { () -> Bool in
      let read = ElementRead(app, id, .button)
      return read.one && read.label == label
    }
    watchedTap(id, in: app, until: turned) { star.tap() }
  }

  /// Taps the bell identified `id`, watched (`watchedTap`) until it reads `label`, what its tap
  /// does next: "Turn on notifications for Kathmandu" once off, "Turn off …" once on.
  @MainActor
  private func tapBell(_ id: String, in app: XCUIApplication, until label: String) {
    let bell = app.buttons[id]
    let turned = { () -> Bool in
      let read = ElementRead(app, id, .button)
      return read.one && read.label == label
    }
    watchedTap(id, in: app, until: turned) { bell.tap() }
  }

  /// Taps the search box's clear button, watched (`watchedTap`) until it has gone, as it goes
  /// with the text it clears.
  @MainActor
  private func clearTheSearch(in app: XCUIApplication) {
    let clear = app.buttons["clear-search"]
    watchedTap("clear-search", in: app, until: { gone("clear-search", in: app) }, { clear.tap() })
  }

  /// Taps the picker's Close, watched (`watchedTap`) until the picker is no longer open.
  @MainActor
  private func closeThePicker(_ app: XCUIApplication) {
    let close = app.buttons["picker-close"]
    watchedTap("picker-close", in: app, until: { pickerLeft(app) }, { close.tap() })
  }

  /// Taps the picker's "Use my location", with location access off, watched (`watchedTap`) until
  /// it says so with Open Settings: before the tap, it hasn't been asked.
  @MainActor
  private func askForTheLocation(in app: XCUIApplication) {
    let row = app.buttons["picker-use-my-location"]
    watchedTap(
      "picker-use-my-location", in: app, until: { found("open-settings", in: app) }, { row.tap() })
  }

  /// Whether the picker's readout reads it closing or closed: a place chosen, or Close, done.
  /// False while the readout can't be read, as under the picker it may not be (`pickerOpens`),
  /// where `debug-cancels` can't be read either, so nothing is played again.
  @MainActor
  private func pickerLeft(_ app: XCUIApplication) -> Bool {
    app.pickerState.map { $0 != "open" } ?? false
  }

  /// Whether one read of the app (`ElementRead`) finds an element identified `id` (with `id`
  /// nil, of `type`: the keyboard).
  @MainActor
  private func found(
    _ id: String?, _ type: XCUIElement.ElementType = .any, in app: XCUIApplication
  ) -> Bool {
    ElementRead(app, id, type).found
  }

  /// Whether one read of an app it could read finds no element identified `id`.
  @MainActor
  private func gone(_ id: String, in app: XCUIApplication) -> Bool {
    ElementRead(app, id).gone
  }

  /// Whether a read of the Debug recorder's line finds it holding the app's own page in iOS
  /// Settings (`UIApplication.openSettingsURLString`), as Open Settings asks for it.
  private func asksForSettings(_ read: ElementRead) -> Bool {
    read.one && read.value?.hasPrefix("app-settings:") == true
  }

  /// Whether one read of the app finds the recorder's line holding the app's settings page.
  @MainActor
  private func settingsAsked(in app: XCUIApplication) -> Bool {
    asksForSettings(ElementRead(app, "debug-opened", .staticText))
  }

  /// Whether one read of the app finds the recorder's line holding the app's notification
  /// settings (`UIApplication.openNotificationSettingsURLString`), as a bell's Open Settings asks
  /// for them: never the app's settings page alone, which the location's Open Settings asks for.
  @MainActor
  private func notificationSettingsAsked(in app: XCUIApplication) -> Bool {
    let read = ElementRead(app, "debug-opened", .staticText)
    return read.one && read.value == UIApplication.openNotificationSettingsURLString
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

  /// Waits up to 15 seconds for the screen to show the heading reading `label`, as a user sees it
  /// (`readHeading`, as `awaitHeading` does: snapshots, judged as they are read, the deadline
  /// strict); fails, stopping the test, with what the last read found. Not
  /// `wait(for:_:in:label:)`, which reads an element by identifier alone, not where it is on
  /// screen; nor a predicate on the heading in a waiter, whose one query a busy simulator can
  /// stretch past the deadline (docs/DECISIONS.md, "What main's offline run showed").
  @MainActor
  private func waitForHeading(_ label: String, in app: XCUIApplication) {
    let read = readHeading(in: app, within: 15, "to read \"\(label)\"") { $0.shows(label) }
    if let failure = read {
      XCTFail("The heading never read \"\(label)\" on screen: \(failure)")
    }
  }

  /// Waits up to 15 seconds until the element identified `id` reads `label`: of a `type`, the
  /// only one; of any type (the purchase's line, whatever type XCUITest gives it), the first, as
  /// UpgradeTests reads it. Read from snapshots (`readElement`, by `readUntil`'s rules, as the
  /// heading is); fails, stopping the test, with what the last read found, never a fresh read.
  /// Not a predicate in a waiter, whose evaluation a busy simulator can stretch past the
  /// deadline, a verdict then made on no read (docs/DECISIONS.md, "What PR #46's first macOS run
  /// showed").
  @MainActor
  private func wait(
    for id: String,
    _ type: XCUIElement.ElementType,
    in app: XCUIApplication,
    label: String
  ) {
    let read = readElement(id, type, in: app, within: 15, "to read \"\(label)\"") {
      (type == .any ? $0.found : $0.one) && $0.label == label
    }
    if let failure = read {
      XCTFail("\(id) never read \"\(label)\": \(failure)")
    }
  }

  /// Waits up to 10 seconds until no element identified `id` of `type` is left (with `id` nil,
  /// none of `type`: the keyboard), as a read of the app that ended in time finds none
  /// (`readElement`; an app that couldn't be read is never one without it); fails, stopping the
  /// test, with `message` and what the last read found.
  @MainActor
  private func waitUntilGone(
    _ id: String?,
    _ type: XCUIElement.ElementType,
    in app: XCUIApplication,
    _ message: String
  ) {
    if let still = readElement(id, type, in: app, within: 10, "to go", until: { $0.gone }) {
      XCTFail("\(message): \(still)")
    }
  }

  /// Checks the keyboard is up `when`, from one snapshot (`ElementRead`), before a drag that
  /// should put it away: the control for the wait for it to go (`waitUntilGone`), which a read
  /// that couldn't see the keyboard would pass whatever the drag did. Text has been typed, so the
  /// keyboard is up; one read, no wait.
  @MainActor
  private func expectTheKeyboard(in app: XCUIApplication, _ when: String) {
    let read = ElementRead(app, nil, .keyboard)
    XCTAssertTrue(read.found, "No keyboard \(when), so its going would prove nothing: \(read)")
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
