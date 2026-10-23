import XCTest

/// The answer kept with no connection, and when it can no longer be shown (iOS build spec,
/// sections 4, 9.5 and 17.2): the saved answer an hour on, with the hour picked for then and the
/// offline line; past its last hour (`usableUntil`), no recent forecast on Now, the middle page
/// and the week; nothing saved and no connection; and a failed request over the answer, which
/// keeps it, says forecasts are unavailable, and offers Retry. The first launch saves an answer
/// from a fixture (`-fixture`); the next has the app's own URLSession transport over a stubbed
/// network (`-network off`, no connection, or `-network unavailable`, the server's 503), so
/// nothing reaches the real one. What each page should say is `HomeScreens.json`'s, from
/// page.json, so nothing here types a page's words.
final class OfflineTests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = true
  }

  /// Saved at 9:05am, opened again at 10:30am with no connection: Now and Today show the 10am
  /// hour's answer (Now's verdict is that hour's, not 9am's), and every page's footer says since
  /// when.
  @MainActor
  func testOfflineAnHourOnShowsThatHour() throws {
    let saved = try HomeScreen.named("aberdeen-snow")
    let later = try HomeScreen.named("aberdeen-snow-hour-ahead-offline")
    XCTAssertNotEqual(
      try later.page("now").verdict, try saved.page("now").verdict,
      "The hour ahead's Now is the saved hour's: this test would prove nothing")
    try save(saved)
    let app = try launchApp(["-network", "off", "-now", later.now, "-clock", "fixed"])
    try awaitHeading(try later.opening().heading, in: app)
    try awaitNotice(in: app)
    try everyPage(later, in: app)
  }

  /// Opened with no connection half a minute before the saved answer's last hour ends, with the
  /// clock running: the answer shows, with the offline line; at `usableUntil`, Now, the middle
  /// page and the week each say there is no recent forecast, never the old hour, and the
  /// offline line goes with the forecast.
  @MainActor
  func testPastItsLastHourNoRecentForecastOnEveryPage() throws {
    let saved = try HomeScreen.named("aberdeen-snow")
    let last = try HomeScreen.named("aberdeen-snow-last-seconds-offline")
    let past = try HomeScreen.named("aberdeen-snow-past-offline")
    try save(saved)
    let app = try launchApp(["-network", "off", "-now", last.now, "-clock", "run"])
    let opening = try last.opening()
    try awaitHeading(opening.heading, in: app)
    try awaitNotice(in: app)
    expect(opening, in: app)
    // The tick at `usableUntil` on the model's clock, 30 seconds after the launch's moment.
    let gone = try past.page(last.defaultView)
    try awaitHeading(gone.heading, in: app, timeout: 75)
    expect(gone, in: app)
    for page in past.pages {
      try tap(page, in: app)
      expect(page, in: app)
    }
  }

  /// Nothing saved and no connection: no recent forecast on every page, with Retry, and the top
  /// bar still finding the place.
  @MainActor
  func testOfflineWithNothingSaved() throws {
    let nothing = try HomeScreen.named("nothing-offline")
    let app = try launchApp(["-resetStore", "-network", "off", "-clock", "fixed"])
    try awaitHeading(try nothing.opening().heading, in: app)
    try everyPage(nothing, in: app)
  }

  /// The saved answer opened again a quarter of an hour on (too old to keep without asking),
  /// when the server can't give forecasts: the answer stays on every page, the footer says
  /// forecasts are unavailable, with Retry under it; Retry asks again, and the page stays as it
  /// is when that fails too.
  @MainActor
  func testAFailureOverTheAnswerKeepsItWithRetry() throws {
    let saved = try HomeScreen.named("aberdeen-snow")
    let failed = try HomeScreen.named("aberdeen-snow-unavailable")
    try save(saved)
    let app = try launchApp(["-network", "unavailable", "-now", failed.now, "-clock", "fixed"])
    let opening = try failed.opening()
    try awaitHeading(opening.heading, in: app)
    guard app.buttons["retry"].waitForExistence(timeout: 20) else {
      throw HomeScreenError("No Retry after the failed request")
    }
    try everyPage(failed, in: app)
    try tap(opening, in: app)
    app.buttons["retry"].tap()
    XCTAssertTrue(app.buttons["retry"].waitForExistence(timeout: 20), "Retry went")
    expect(opening, in: app)
  }

  /// Launches on `screen`'s fixture at its moment, from a clean store, so the app saves its
  /// answer for the place (approximate IP location), then quits.
  @MainActor
  private func save(_ screen: HomeScreen) throws {
    let app = try launch(screen)
    expect(try screen.opening(), in: app)
    app.terminate()
  }

  /// Waits for the footer's line, which comes once the request has failed: the painted answer's
  /// heading is on screen before it.
  @MainActor
  private func awaitNotice(in app: XCUIApplication) throws {
    guard app.find("notice").waitForExistence(timeout: 20) else {
      throw HomeScreenError("No offline line after the request failed")
    }
  }

  /// Checks the top bar, then each page by its tab.
  @MainActor
  private func everyPage(_ screen: HomeScreen, in app: XCUIApplication) throws {
    expect(screen.topBar, in: app)
    expect(try screen.opening(), in: app)
    for page in screen.pages {
      try tap(page, in: app)
      expect(page, in: app)
    }
  }
}
