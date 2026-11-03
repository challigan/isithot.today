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
  /// the purchase brings, a line each (no ads, widgets, notifications for saved places; phase
  /// 8.4b, design 2.10), what the purchase is, Family Sharing, Buy with the price and Restore
  /// purchase; Buy, then the thanks and no Buy, audited again; and once the sheet is closed, no
  /// home row, and Settings' card the thanks and Restore purchase, with no upgrade row and no
  /// Report an ad.
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
    watchedTap("upgrade-row", in: app, until: { app.showsPage(titled: Copy.title) }, { row.tap() })
    try page(titled: Copy.title, in: app)
    for (index, benefit) in Copy.benefits.enumerated() {
      XCTAssertEqual(app.find("upgrade-benefit-\(index + 1)").label, benefit)
    }
    XCTAssertFalse(app.find("upgrade-benefit-4").exists, "A benefit line too many")
    XCTAssertEqual(app.find("upgrade-body").label, Copy.body)
    XCTAssertEqual(app.find("family-sharing").label, Copy.familySharing)
    XCTAssertEqual(app.buttons["buy"].label, Copy.buy)
    XCTAssertEqual(app.buttons["sheet-restore"].label, Copy.restore)
    assertSnowOnly(app)
    try auditAccessibility(of: app, on: "the upgrade sheet", surface: .content)
    attach(app, as: "app-upgrade")

    try buy(in: app)
    try waitFor("upgrade-outcome", in: app, label: Copy.thanks)
    if let still = gone("buy", .button, in: app) {
      XCTFail("Buy is still there once the purchase is owned: \(still)")
    }
    try auditAccessibility(of: app, on: "the upgrade sheet, bought", surface: .content)
    attach(app, as: "app-upgrade-thanks")
    try close("close-upgrade", in: app)
    if let still = gone("upgrade-row", in: app) {
      XCTFail("The home row is still there once bought: \(still)")
    }
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
    try waitFor("upgrade-outcome", in: app, label: Copy.pending)
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
    try buy(in: app, answered: false)
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
    try waitFor("upgrade", .button, in: app, label: Copy.settingsRow)
    tapRow("upgrade", in: app) { app.showsPage(titled: Copy.title) }
    try page(titled: Copy.title, in: app)
    XCTAssertFalse(app.buttons["close-upgrade"].exists, "The page is a sheet over Settings")
    try buy(in: app)
    try waitFor("upgrade-outcome", in: app, label: Copy.thanks)
    back(from: Copy.title, in: app)
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
    tapRow("restore", in: app) { restored(in: app) }
    XCTAssertEqual(result(of: restore), Copy.restored)
    try expectThePaidCard(in: app)
    XCTAssertFalse(app.buttons["report-ad"].exists, "Report an ad once restored")
    tapRow("your-privacy", in: app) { app.showsPage(titled: "Your privacy") }
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
    tapRow("restore", in: app) { restored(in: app) }
    XCTAssertEqual(result(of: app.buttons["restore"]), Copy.nothingToRestore)
    XCTAssertTrue(app.buttons["upgrade"].exists, "No upgrade row after nothing was restored")
  }

  /// Restore purchase failing (`-restore failed`): its result says what went wrong, neither of
  /// the lines above.
  @MainActor
  func testRestoreFails() throws {
    let app = try launch(["-restore", "failed"])
    try openSettings(app)
    tapRow("restore", in: app) { restored(in: app) }
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
    try waitFor("upgrade-outcome", in: paid, label: Copy.thanks)
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
    try waitFor("upgrade", .button, in: app, label: Copy.title)
    XCTAssertFalse(upgrade.label.contains("£"), "A price with no product: \(upgrade.label)")
    let restore = app.buttons["restore"]
    XCTAssertTrue(restore.exists, "No Restore purchase with no product")
    XCTAssertLessThanOrEqual(
      upgrade.frame.maxY, restore.frame.minY + 0.5,
      "Restore purchase at \(restore.frame) isn't below the upgrade row at \(upgrade.frame)")
    tapRow("upgrade", in: app) { app.showsPage(titled: Copy.title) }
    try page(titled: Copy.title, in: app)
    try expectNothingToSell(in: app)
    assertSnowOnly(app)
    try auditAccessibility(of: app, on: "the upgrade page with no product", surface: .content)
    attach(app, as: "app-upgrade-unavailable")
    back(from: Copy.title, in: app)
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
  /// as SettingsTests types Settings', since the UI tests link none of the app's modules. Phase
  /// 8.4b's words (Carl's option (a)): the title is also the purchase's display name in App Store
  /// Connect, and the benefits come before the body.
  private enum Copy {
    static let row = "No ads, widgets and notifications for saved places · £1.99"
    static let title = "No ads, widgets and more"
    static let settingsRow = "No ads, widgets and more · £1.99"
    static let benefits = [
      "No ads in the app", "Widgets for your home screen and lock screen",
      "Notifications for your saved places",
    ]
    static let body =
      "A one-off purchase. Notifications for where you are, and everything else, stay free."
    static let familySharing = "Shared with your family through Family Sharing."
    static let buy = "Buy for £1.99"
    static let restore = "Restore purchase"
    static let thanks =
      "Thank you. Ads are off, widgets are on and you can turn on notifications for saved places."
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
    watchedTap("upgrade-row", in: app, until: { app.showsPage(titled: Copy.title) }, { row.tap() })
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

  /// Taps Buy, once it is there; watched (`watchedTap`) until the page's line says what the
  /// purchase came to, unless the purchase is one that brings no line (`answered` false: a
  /// purchase cancelled in StoreKit's sheet), whose tap brings nothing to read, so isn't.
  @MainActor
  private func buy(in app: XCUIApplication, answered: Bool = true) throws {
    let buy = app.buttons["buy"]
    guard buy.waitForExistence(timeout: 10) else {
      throw HomeScreenError("No Buy on the upgrade page")
    }
    XCTAssertEqual(buy.label, Copy.buy)
    guard answered else {
      buy.tap()
      return
    }
    watchedTap("buy", in: app, until: { ElementRead(app, "upgrade-outcome").found }, { buy.tap() })
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

  /// Checks Buy can be tapped again, `after` saying when: the one `buy` button, enabled and
  /// reading its price, as an attempt left under way greys it out with its spinner
  /// (`.disabled(busy)`). Up to 5 seconds, so an attempt that never came back fails, read from
  /// snapshots (`readElement`, as `waitFor` reads); the failure is the last read's.
  @MainActor
  private func expectBuyToTap(in app: XCUIApplication, _ after: String) throws {
    let read = readElement("buy", .button, in: app, within: 5, "to take a tap") {
      $0.one && $0.enabled && $0.label == Copy.buy
    }
    if let failure = read {
      throw HomeScreenError("No Buy to tap \(after): \(failure)")
    }
  }

  /// Checks the page says the purchase isn't available, with Restore purchase and no Buy.
  @MainActor
  private func expectNothingToSell(in app: XCUIApplication) throws {
    try waitFor("upgrade-unavailable", in: app, label: Copy.unavailable)
    XCTAssertEqual(app.buttons["sheet-restore"].label, Copy.restore)
    XCTAssertFalse(app.buttons["buy"].exists, "Buy with no product")
  }

  /// Checks Settings' upgrade card is the paid version's: the thanks, then Restore purchase, and
  /// no upgrade row.
  @MainActor
  private func expectThePaidCard(in app: XCUIApplication) throws {
    try waitFor("thanks", in: app, label: Copy.thanks)
    XCTAssertEqual(app.buttons["restore"].label, Copy.restore)
    if let still = gone("upgrade", .button, in: app) {
      XCTFail("The upgrade row in the paid version: \(still)")
    }
  }

  /// Checks Settings is still the free version's, from the home screen: the upgrade row and
  /// Report an ad.
  @MainActor
  private func expectTheFreeVersion(_ app: XCUIApplication) throws {
    try openSettings(app)
    XCTAssertTrue(app.buttons["upgrade"].exists, "No upgrade row in the free version")
    XCTAssertTrue(app.buttons["report-ad"].exists, "No Report an ad in the free version")
  }

  /// Taps the gear, and waits for Settings, by its Close and its title. A tap whose touch the
  /// system cancelled (`watchedTap`) and that opened no Settings is tapped once more; a tap the
  /// app completed never is.
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
  }

  /// Taps the Close identified `id`, Settings' or the upgrade sheet's, watched (`watchedTap`)
  /// until the home screen is back (`sheetClosed`), and waits for it (`sheetCloses`).
  @MainActor
  private func close(_ id: String, in app: XCUIApplication) throws {
    let button = app.buttons[id]
    watchedTap(id, in: app, until: { app.sheetClosed }, { button.tap() })
    guard app.sheetCloses(within: 5) else {
      throw HomeScreenError(
        "The sheet is still open 5 seconds after \(id); \(app.cancelsReport)")
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
    throw HomeScreenError(
      "No page titled \"\(title)\"; the titles on screen: \(shown); \(app.cancelsReport)")
  }

  /// Goes back one page on Settings' stack, from the page titled `title`, watched (`watchedTap`)
  /// until that page has gone (`lacksPage`).
  @MainActor
  private func back(from title: String, in app: XCUIApplication) {
    let button = app.navigationBars.buttons.element(boundBy: 0)
    watchedTap("Back", in: app, until: { app.lacksPage(titled: title) }, { button.tap() })
  }

  /// Taps Settings' row `id`, swiping up to it first while a tap wouldn't reach it; watched
  /// (`watchedTap`), so a tap whose touch the system cancelled and that brought nothing, as `done`
  /// reads it, is played once more.
  @MainActor
  private func tapRow(_ id: String, in app: XCUIApplication, until done: () -> Bool) {
    let row = app.buttons[id]
    var swipes = 0
    while !(row.exists && row.isHittable) && swipes < 6 {
      app.swipeUp()
      swipes += 1
    }
    watchedTap(id, in: app, until: done) { row.tap() }
  }

  /// Whether one read of the app (`ElementRead`) finds Restore purchase's row holding a result,
  /// its value, which is empty until a restore has answered (`result(of:)`).
  @MainActor
  private func restored(in app: XCUIApplication) -> Bool {
    let read = ElementRead(app, "restore", .button)
    return read.one && !(read.value ?? "").isEmpty
  }

  /// Waits up to 10 seconds for the element identified `id` to read `label`, from snapshots
  /// (`readElement`, by `readUntil`'s rules): of any type, the first in the tree, as `app.find`
  /// took it; of a `type` (Settings' upgrade row, a button), the only one, as `app.buttons[id]`
  /// had to be for XCUITest to read its label. Throws, stopping the test, with what the last read
  /// found, the read the verdict was made on, never a fresh one. Not a predicate in an
  /// `XCTWaiter`: on PR #46's run 41394508297, waiting here for the thanks, which was on screen
  /// before the wait began, its one evaluation was cut off at the deadline, and the failure's own
  /// fresh read found the thanks (docs/DECISIONS.md, "What PR #46's first macOS run showed").
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
      throw HomeScreenError("\(id) never read \"\(label)\": \(failure)")
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

  /// Nil when the element identified `id` (of `type`, any unless given) is gone, or goes within
  /// 5 seconds, as a read of the app that ended in time finds none (`readElement`; an app that
  /// couldn't be read is never one without it): one the screen took away, still in its
  /// presentation (Buy once bought) or on the home screen (the row, once the sheet over it has
  /// closed: `sheetCloses`). Otherwise what the last read found, for the caller's failure.
  @MainActor
  private func gone(
    _ id: String,
    _ type: XCUIElement.ElementType = .any,
    in app: XCUIApplication
  ) -> String? {
    readElement(id, type, in: app, within: 5, "to go") { $0.gone }
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
