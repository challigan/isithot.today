import XCTest

/// The purchase (iOS build spec, sections 10.2 item 6, 10.4, 10.5 and 13): the home row at the
/// end of the middle page, the upgrade sheet it opens, Buy and each thing it comes to, Settings'
/// upgrade card and the page it pushes on Settings' own stack, Restore purchase and its results,
/// `willitsnow://upgrade`, the product StoreKit has none of, and the paid version. Every launch is
/// leeds-dry's at its moment, from a clean store, with the clock fixed (HomeScreens.swift's
/// `launch`), under StoreKit's stand-in, as `-uitest` puts every UI test (DebugHooks.swift):
/// XCUITest can't buy against Snow.storekit on the runner's simulator, and the confirmation sheet
/// is the system's, so `-purchase` and `-restore` say what Buy and Restore purchase come to, and
/// `-unlocked` whether the purchase is owned. That proves what is the app's: the rows, the page,
/// the outcomes, the restore results, the link and the audits. StoreKit's side is the StoreKit
/// plan's (`WillItSnowStoreKitTests`), and the real purchase TestFlight's.
///
/// The sheet is audited as Settings' pages are (`auditAccessibility`, on the content surface) and
/// attached for the contact sheet: `app-upgrade` is the purchase's screenshot for App Review
/// until phase 7.3's. The home row's screenfuls are audited only by the home pages' own audit
/// (HomeAuditTests), never by the sheets', which runs a timed-out call again on the same still
/// screen. Nothing the sheet shows names another app, website or weather type.
final class UpgradeTests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  /// With the product for sale (`-purchase bought`): the home row, with StoreKit's price, above
  /// the middle page's footer and within the page's width; the sheet it opens, audited, with what
  /// the purchase is, Family Sharing, Buy with the price and Restore purchase; Buy, then the
  /// thanks and no Buy, audited again; and once the sheet is closed, no home row, and Settings'
  /// card the thanks and Restore purchase, with no upgrade row and no Report an ad.
  @MainActor
  func testTheRowThePageAndBuying() throws {
    let app = try launch(["-purchase", "bought"])
    let row = try homeRow(in: app)
    XCTAssertEqual(row.label, Copy.row)
    try scroll(try middle(), toShow: "upgrade-row", in: app)
    let frame = row.frame
    let footer = app.find("updated")
    XCTAssertTrue(footer.exists, "No Updated line on the middle page")
    XCTAssertLessThanOrEqual(
      frame.maxY, footer.frame.minY + 0.5,
      "The row at \(frame) isn't above the footer's Updated line at \(footer.frame)")
    let shown = app.find("page-today").frame
    XCTAssertTrue(
      frame.minX >= shown.minX - 0.5 && frame.maxX <= shown.maxX + 0.5,
      "The row at \(frame) runs on outside the page at \(shown)")
    row.tap()
    try page(titled: Copy.title, in: app)
    XCTAssertEqual(app.find("upgrade-body").label, Copy.body)
    XCTAssertEqual(app.find("family-sharing").label, Copy.familySharing)
    XCTAssertEqual(app.buttons["buy"].label, Copy.buy)
    XCTAssertEqual(app.buttons["sheet-restore"].label, Copy.restore)
    assertSnowOnly(app)
    try auditAccessibility(of: app, on: "the upgrade sheet", surface: .content)
    attach(app, as: "app-upgrade")

    try buy(in: app)
    try waitFor(app.find("upgrade-outcome"), label: Copy.thanks)
    XCTAssertTrue(gone(app.buttons["buy"]), "Buy is still there once the purchase is owned")
    try auditAccessibility(of: app, on: "the upgrade sheet, bought", surface: .content)
    attach(app, as: "app-upgrade-thanks")
    try close("close-upgrade", in: app)
    XCTAssertTrue(gone(app.find("upgrade-row")), "The home row is still there once bought")
    try openSettings(app)
    try expectThePaidCard(in: app)
    XCTAssertFalse(app.buttons["report-ad"].exists, "Report an ad once bought")
  }

  /// Ask to Buy (`-purchase pending`): "Waiting for approval.", and Buy stays, as a parent's no
  /// sends nothing, so it is the only way to ask again; still the free version.
  @MainActor
  func testAskToBuy() throws {
    let app = try launch(["-purchase", "pending"])
    try openTheSheet(app)
    try buy(in: app)
    try waitFor(app.find("upgrade-outcome"), label: Copy.pending)
    try expectBuyToTap(in: app, "while the purchase waits for approval")
    try close("close-upgrade", in: app)
    try expectTheFreeVersion(app)
  }

  /// A purchase that failed (`-purchase failed`, no connection in the system's words): the line
  /// says what went wrong, neither the thanks nor Ask to Buy's line, and Buy stays.
  @MainActor
  func testAFailedPurchase() throws {
    let app = try launch(["-purchase", "failed"])
    try openTheSheet(app)
    try buy(in: app)
    try expectAFailure(in: app)
  }

  /// A purchase StoreKit couldn't verify (`-purchase unverified`): no unlock, its words for the
  /// failed check, and Buy stays; still the free version.
  @MainActor
  func testAnUnverifiedPurchase() throws {
    let app = try launch(["-purchase", "unverified"])
    try openTheSheet(app)
    try buy(in: app)
    try expectAFailure(in: app)
    try close("close-upgrade", in: app)
    try expectTheFreeVersion(app)
  }

  /// A purchase cancelled in StoreKit's sheet (`-purchase cancelled`): nothing to say, and Buy
  /// stays. No line comes in the 3 seconds after Buy, where the stand-in answers at once.
  @MainActor
  func testACancelledPurchase() throws {
    let app = try launch(["-purchase", "cancelled"])
    try openTheSheet(app)
    try buy(in: app)
    XCTAssertFalse(
      app.find("upgrade-outcome").waitForExistence(timeout: 3), "A line after a cancelled Buy")
    try expectBuyToTap(in: app, "after a cancelled purchase")
  }

  /// Settings' upgrade row, with StoreKit's price, pushes the page on Settings' own stack, never a
  /// sheet over a sheet; bought there, the thanks replaces the row once back.
  @MainActor
  func testSettingsBuysOnItsOwnStack() throws {
    let app = try launch(["-purchase", "bought"])
    try openSettings(app)
    let upgrade = app.buttons["upgrade"]
    try waitFor(upgrade, label: Copy.settingsRow)
    upgrade.tap()
    try page(titled: Copy.title, in: app)
    XCTAssertFalse(app.buttons["close-upgrade"].exists, "The page is a sheet over Settings")
    try buy(in: app)
    try waitFor(app.find("upgrade-outcome"), label: Copy.thanks)
    back(in: app)
    try page(titled: "Settings", in: app)
    try expectThePaidCard(in: app)
  }

  /// Restore purchase finding it (`-restore found`): "Purchase restored." as its result, the
  /// thanks in place of the upgrade row, no Report an ad, and Your privacy without the ads line.
  @MainActor
  func testRestoreFindsThePurchase() throws {
    let app = try launch(["-restore", "found"])
    try openSettings(app)
    let restore = app.buttons["restore"]
    tapRow("restore", in: app)
    XCTAssertEqual(result(of: restore), Copy.restored)
    try expectThePaidCard(in: app)
    XCTAssertFalse(app.buttons["report-ad"].exists, "Report an ad once restored")
    tapRow("your-privacy", in: app)
    try page(titled: "Your privacy", in: app)
    let lines = privacyLines(in: app)
    XCTAssertEqual(lines.count, 4, "Your privacy's lines once restored: \(lines)")
    XCTAssertFalse(lines.contains { $0.contains("Google") }, "An ads line once restored: \(lines)")
  }

  /// Restore purchase finding nothing (`-restore none`): its result says so, and the upgrade row
  /// stays.
  @MainActor
  func testRestoreFindsNothing() throws {
    let app = try launch(["-restore", "none"])
    try openSettings(app)
    tapRow("restore", in: app)
    XCTAssertEqual(result(of: app.buttons["restore"]), Copy.nothingToRestore)
    XCTAssertTrue(app.buttons["upgrade"].exists, "No upgrade row after nothing was restored")
  }

  /// Restore purchase failing (`-restore failed`): its result says what went wrong, neither of
  /// the lines above.
  @MainActor
  func testRestoreFails() throws {
    let app = try launch(["-restore", "failed"])
    try openSettings(app)
    tapRow("restore", in: app)
    let said = result(of: app.buttons["restore"])
    XCTAssertFalse(said.isEmpty, "No result after a restore that failed")
    XCTAssertNotEqual(said, Copy.restored)
    XCTAssertNotEqual(said, Copy.nothingToRestore)
  }

  /// `willitsnow://upgrade` (a locked widget's link, phase 7.2) opens the upgrade sheet; in the
  /// paid version (`-unlocked 1`) the sheet shows the thanks and no Buy.
  @MainActor
  func testTheLinkOpensTheSheet() throws {
    let free = try launch(["-purchase", "bought"])
    try openTheLink(in: free)
    XCTAssertTrue(free.buttons["buy"].waitForExistence(timeout: 10), "No Buy on the link's sheet")
    free.terminate()

    let paid = try launch(["-unlocked", "1"])
    try openTheLink(in: paid)
    try waitFor(paid.find("upgrade-outcome"), label: Copy.thanks)
    XCTAssertFalse(paid.buttons["buy"].exists, "Buy in the paid version")
  }

  /// No product from StoreKit (no `-purchase`: offline, say, or none for sale yet): no home row,
  /// as it names a price; Settings' card still has the upgrade row, without a price, then Restore
  /// purchase; the page it pushes says the purchase isn't available, with Restore purchase and no
  /// Buy, audited; and the link's sheet says the same.
  @MainActor
  func testNoProductNoPrice() throws {
    let app = try launch([])
    XCTAssertFalse(
      app.find("upgrade-row").waitForExistence(timeout: 3), "A home row with no product")
    try openSettings(app)
    let upgrade = app.buttons["upgrade"]
    try waitFor(upgrade, label: Copy.title)
    XCTAssertFalse(upgrade.label.contains("£"), "A price with no product: \(upgrade.label)")
    let restore = app.buttons["restore"]
    XCTAssertTrue(restore.exists, "No Restore purchase with no product")
    XCTAssertLessThanOrEqual(
      upgrade.frame.maxY, restore.frame.minY + 0.5,
      "Restore purchase at \(restore.frame) isn't below the upgrade row at \(upgrade.frame)")
    upgrade.tap()
    try page(titled: Copy.title, in: app)
    try expectNothingToSell(in: app)
    assertSnowOnly(app)
    try auditAccessibility(of: app, on: "the upgrade page with no product", surface: .content)
    attach(app, as: "app-upgrade-unavailable")
    back(in: app)
    try close("close-settings", in: app)
    try openTheLink(in: app)
    try expectNothingToSell(in: app)
  }

  /// The paid version (`-unlocked 1`): no home row, and Settings' card the thanks and Restore
  /// purchase.
  @MainActor
  func testThePaidVersion() throws {
    let app = try launch(["-unlocked", "1"])
    XCTAssertFalse(
      app.find("upgrade-row").waitForExistence(timeout: 3), "A home row in the paid version")
    try openSettings(app)
    try expectThePaidCard(in: app)
  }

  // MARK: - Helpers

  /// What the rows, the page and the results say, as packages/mobile's `APP_COPY` words them
  /// (AppCopy.swift), with the stand-in's price (`Constants.Purchase.displayPrice`): typed here,
  /// as SettingsTests types Settings', since the UI tests link none of the app's modules.
  private enum Copy {
    static let row = "No ads, plus widgets for your home and lock screen · £1.99"
    static let title = "Remove ads and add widgets"
    static let settingsRow = "Remove ads and add widgets · £1.99"
    static let body =
      "A one-off purchase. No ads in the app, and widgets for your home screen and lock screen. "
      + "Notifications and everything else stay free."
    static let familySharing = "Shared with your family through Family Sharing."
    static let buy = "Buy for £1.99"
    static let restore = "Restore purchase"
    static let thanks = "Thank you. Ads are off and widgets are on."
    static let pending = "Waiting for approval."
    static let restored = "Purchase restored."
    static let nothingToRestore = "No purchase found for this Apple Account."
    static let unavailable = "The purchase isn't available right now. Try again later."
  }

  /// Launches leeds-dry at its moment from a clean store, the clock fixed (HomeScreens.swift's
  /// `launch`), with `arguments` for StoreKit's stand-in; waits for the page it opens on, the
  /// middle one.
  @MainActor
  private func launch(_ arguments: [String]) throws -> XCUIApplication {
    try launch(try HomeScreen.named("leeds-dry"), extra: arguments)
  }

  /// leeds-dry's middle page, the one with the home row.
  private func middle() throws -> HomeScreen.Page {
    try HomeScreen.named("leeds-dry").page("today")
  }

  /// The home row, which comes once the stand-in has given the price: up to 10 seconds for it.
  @MainActor
  private func homeRow(in app: XCUIApplication) throws -> XCUIElement {
    let row = app.find("upgrade-row")
    guard row.waitForExistence(timeout: 10) else {
      throw HomeScreenError("No upgrade row on the middle page; \(app.homeGeometry)")
    }
    return row
  }

  /// Opens the upgrade sheet from the home row, scrolled whole onto the screen first.
  @MainActor
  private func openTheSheet(_ app: XCUIApplication) throws {
    let row = try homeRow(in: app)
    try scroll(try middle(), toShow: "upgrade-row", in: app)
    row.tap()
    try page(titled: Copy.title, in: app)
  }

  /// Opens `willitsnow://upgrade` in the app, as a locked widget will, and waits for the sheet.
  @MainActor
  private func openTheLink(in app: XCUIApplication) throws {
    app.open(try XCTUnwrap(URL(string: "willitsnow://upgrade")))
    XCTAssertTrue(
      app.buttons["close-upgrade"].waitForExistence(timeout: 10), "No upgrade sheet for the link")
    try page(titled: Copy.title, in: app)
  }

  /// Taps Buy, once it is there.
  @MainActor
  private func buy(in app: XCUIApplication) throws {
    let buy = app.buttons["buy"]
    guard buy.waitForExistence(timeout: 10) else {
      throw HomeScreenError("No Buy on the upgrade page")
    }
    XCTAssertEqual(buy.label, Copy.buy)
    buy.tap()
  }

  /// Checks the page says what went wrong with Buy: a line, neither the thanks nor Ask to Buy's,
  /// and Buy there to tap again.
  @MainActor
  private func expectAFailure(in app: XCUIApplication) throws {
    let outcome = app.find("upgrade-outcome")
    XCTAssertTrue(outcome.waitForExistence(timeout: 10), "No line after a Buy that failed")
    XCTAssertFalse(outcome.label.isEmpty, "An empty line after a Buy that failed")
    XCTAssertNotEqual(outcome.label, Copy.thanks)
    XCTAssertNotEqual(outcome.label, Copy.pending)
    try expectBuyToTap(in: app, "after a purchase that failed")
  }

  /// Checks Buy can be tapped again, `after` saying when: enabled and reading its price, as an
  /// attempt left under way greys it out with its spinner (`.disabled(busy)`). Up to 5 seconds,
  /// so an attempt that never came back fails.
  @MainActor
  private func expectBuyToTap(in app: XCUIApplication, _ after: String) throws {
    let buy = app.buttons["buy"]
    let ready = NSPredicate(format: "exists == true AND enabled == true AND label == %@", Copy.buy)
    let waited = XCTNSPredicateExpectation(predicate: ready, object: buy)
    guard XCTWaiter().wait(for: [waited], timeout: 5) == .completed else {
      let shown =
        buy.exists ? "\"\(buy.label)\", \(buy.isEnabled ? "enabled" : "not enabled")" : "none"
      throw HomeScreenError("No Buy to tap \(after); Buy: \(shown)")
    }
  }

  /// Checks the page says the purchase isn't available, with Restore purchase and no Buy.
  @MainActor
  private func expectNothingToSell(in app: XCUIApplication) throws {
    try waitFor(app.find("upgrade-unavailable"), label: Copy.unavailable)
    XCTAssertEqual(app.buttons["sheet-restore"].label, Copy.restore)
    XCTAssertFalse(app.buttons["buy"].exists, "Buy with no product")
  }

  /// Checks Settings' upgrade card is the paid version's: the thanks, then Restore purchase, and
  /// no upgrade row.
  @MainActor
  private func expectThePaidCard(in app: XCUIApplication) throws {
    try waitFor(app.find("thanks"), label: Copy.thanks)
    XCTAssertEqual(app.buttons["restore"].label, Copy.restore)
    XCTAssertTrue(gone(app.buttons["upgrade"]), "The upgrade row in the paid version")
  }

  /// Checks Settings is still the free version's, from the home screen: the upgrade row and
  /// Report an ad.
  @MainActor
  private func expectTheFreeVersion(_ app: XCUIApplication) throws {
    try openSettings(app)
    XCTAssertTrue(app.buttons["upgrade"].exists, "No upgrade row in the free version")
    XCTAssertTrue(app.buttons["report-ad"].exists, "No Report an ad in the free version")
  }

  /// Taps the gear, and waits for Settings, by its Close and its title.
  @MainActor
  private func openSettings(_ app: XCUIApplication) throws {
    app.buttons["settings"].tap()
    guard app.buttons["close-settings"].waitForExistence(timeout: 5) else {
      throw HomeScreenError("No Settings after tapping the gear; \(app.homeGeometry)")
    }
    try page(titled: "Settings", in: app)
  }

  /// Taps the Close identified `id`, Settings' or the upgrade sheet's, and waits for the home
  /// screen (`sheetCloses`).
  @MainActor
  private func close(_ id: String, in app: XCUIApplication) throws {
    app.buttons[id].tap()
    guard app.sheetCloses(within: 5) else {
      throw HomeScreenError("The sheet is still open 5 seconds after \(id)")
    }
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

  /// Taps Settings' row `id`, swiping up to it first while a tap wouldn't reach it.
  @MainActor
  private func tapRow(_ id: String, in app: XCUIApplication) {
    let row = app.buttons[id]
    var swipes = 0
    while !(row.exists && row.isHittable) && swipes < 6 {
      app.swipeUp()
      swipes += 1
    }
    row.tap()
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

  /// Restore purchase's result, its row's value (`RestoreRow`): the first that isn't empty within
  /// 10 seconds, or "" when none comes.
  @MainActor
  private func result(of row: XCUIElement) -> String {
    let deadline = Date().addingTimeInterval(10)
    repeat {
      if row.exists, let value = row.value as? String, !value.isEmpty { return value }
      RunLoop.current.run(until: Date().addingTimeInterval(0.25))
    } while Date() < deadline
    return ""
  }

  /// Whether `element` is gone, or goes within 5 seconds: one the screen took away, still in its
  /// presentation (Buy once bought) or on the home screen (the row, once the sheet over it has
  /// closed: `sheetCloses`).
  @MainActor
  private func gone(_ element: XCUIElement) -> Bool {
    let gone = NSPredicate(format: "exists == false")
    let waited = XCTNSPredicateExpectation(predicate: gone, object: element)
    return XCTWaiter().wait(for: [waited], timeout: 5) == .completed
  }

  /// Your privacy's lines, in order (`privacy-line-<n>`), up to 10, more than it ever has.
  @MainActor
  private func privacyLines(in app: XCUIApplication) -> [String] {
    var lines: [String] = []
    for index in 0..<10 {
      let line = app.staticTexts["privacy-line-\(index)"]
      guard line.exists else { break }
      lines.append(line.label)
    }
    return lines
  }
}
