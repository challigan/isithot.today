import XCTest

/// The ads (iOS build spec, section 14, with phase 8.3's three placements: DECISIONS, "Ads in the
/// iPhone app: three placements"), with Google's demo units over the real network: the only UI
/// tests launched without `-noads 1`. The free version's band under the pager, in a space of its
/// own that stays put as its ad comes or doesn't, and the box at a page's end, below the footer's
/// links; the paid version (`-unlocked 1`) with no ad, no Report an ad and no Privacy choices; in
/// the EEA (`-umpGeography eea`), Google's consent form first, then Privacy choices in Settings
/// and its line in Your privacy; and the full-screen ad as a place is chosen in the picker, which
/// closes once the ad does, with no second one within 5 minutes.
///
/// Google's consent tool, its form and its demo ads aren't the app's to guarantee: a test whose
/// answer from Google doesn't come in time skips, saying which, rather than fails. What is the
/// app's fails: a band or a box out of place, a space that moves as its ad loads, an ad in the
/// paid version, a picker that never closes, a second full-screen ad. Nothing here is audited,
/// since the ads' own elements are Google's (HomeAuditTests audit the home screen without them).
/// The screens are attached for the contact sheet (`ads-…`).
final class AdsTests: XCTestCase {
  override func setUpWithError() throws {
    // Every frame out of place is reported, not only the first; a screen that never comes
    // throws, which stops the test, and an answer from Google that never comes skips it.
    continueAfterFailure = true
  }

  /// The free version (`-unlocked 0`) outside the EEA (`-umpGeography other`, so no form): once
  /// the ads start, the band (`expectBand`) is under the pager, which ends at its top, so no page
  /// runs under the ad, and the home screen still fits; its frame stays as Google's demo ad loads
  /// or fails, its space fixed, as Google's policy asks. At the page's end, the box
  /// (`expectBox`), below the footer's links.
  @MainActor
  func testTheBandSitsUnderThePager() throws {
    let page = try HomeScreen.named("leeds-dry").opening()
    let app = try launch([
      "-resetStore", "-fixture", "leeds-dry", "-umpGeography", "other", "-unlocked", "0",
    ])
    try awaitHeading(page.heading, in: app)
    let band = app.find("ad-home")
    guard band.waitForExistence(timeout: 30) else {
      throw XCTSkip(
        "No ad band 30 seconds after the launch: Google's consent tool or Mobile Ads didn't "
          + "answer in time, so the ads never started")
    }
    let space = settledFrame(of: band)
    expectBand(in: app, below: page)
    expectFits(app, "leeds-dry with the ads")
    expectNoBareElements(app, "leeds-dry with the ads")
    // Google's demo ad, for the contact sheet: up to 15 seconds for its page in the band. Come
    // or not, the band's space is what it was.
    _ = band.webViews.firstMatch.waitForExistence(timeout: 15)
    let after = settledFrame(of: band)
    XCTAssertTrue(
      same(after, space),
      "The band moved from \(space) to \(after) as its ad loaded or failed: its space isn't fixed")
    attach(app, as: "ads-home-band")

    try scroll(page, toShow: "ad-page-\(page.view)", in: app)
    expectBox(in: app, on: page)
    attach(app, as: "ads-page-end")
  }

  /// The paid version (`-unlocked 1`): neither Google's consent tool nor Mobile Ads starts (spec
  /// 14.2), so 10 seconds on there is no band, no box, no banner and no web page of Google's;
  /// Settings has no Report an ad and no Privacy choices; and Your privacy has no ads line.
  @MainActor
  func testThePaidVersionShowsNoAds() throws {
    let page = try HomeScreen.named("leeds-dry").opening()
    let app = try launch([
      "-resetStore", "-fixture", "leeds-dry", "-umpGeography", "other", "-unlocked", "1",
    ])
    try awaitHeading(page.heading, in: app)
    XCTAssertFalse(
      app.find("ad-home").waitForExistence(timeout: 10),
      "An ad band in the paid version; \(app.homeGeometry)")
    for id in ["ad-banner-home", "ad-page-\(page.view)", "ad-banner-page-\(page.view)"] {
      XCTAssertFalse(app.find(id).exists, "\(id) in the paid version; \(app.homeGeometry)")
    }
    XCTAssertEqual(
      app.webViews.count, 0, "A web page, Google's consent form or an ad, in the paid version")
    try openSettings(app)
    XCTAssertFalse(app.buttons["report-ad"].exists, "Report an ad in the paid version")
    XCTAssertFalse(app.buttons["privacy-choices"].exists, "Privacy choices in the paid version")
    try openYourPrivacy(app)
    // The free version's five lines (SettingsTests) but the ads line, the only one naming Google.
    let lines = privacyLines(in: app)
    XCTAssertEqual(lines.count, 4, "Your privacy's lines in the paid version: \(lines)")
    XCTAssertFalse(
      lines.contains { $0.contains("Google") }, "An ads line in the paid version: \(lines)")
  }

  /// In the EEA (`-umpGeography eea`, Google's debug geography, which a Debug build asks again at
  /// each such launch), Google's consent form comes over the home screen at launch. Once agreed
  /// to, Google's privacy options must be offered, so Settings shows Privacy choices, and Your
  /// privacy's line after the ads line points to it ("See Privacy choices.").
  @MainActor
  func testTheConsentFormThenPrivacyChoices() throws {
    let page = try HomeScreen.named("leeds-dry").opening()
    let app = try launch(["-resetStore", "-fixture", "leeds-dry", "-umpGeography", "eea"])
    try awaitHeading(page.heading, in: app)
    let form = app.webViews.firstMatch
    guard form.waitForExistence(timeout: 30) else {
      throw XCTSkip(
        "No consent form 30 seconds after the launch in the EEA: Google's consent tool didn't "
          + "answer in time")
    }
    let agree = try agreeButton(in: form)
    attach(app, as: "ads-consent-form")
    let words = agree.label
    agree.tap()
    // Its button, not the web view: the band's banner, which the answer starts, is one too.
    guard gone(agree, within: 10) else {
      throw XCTSkip("Google's consent form was still open 10 seconds after \(words)")
    }
    try openSettings(app)
    XCTAssertTrue(
      app.buttons["privacy-choices"].waitForExistence(timeout: 10),
      "No Privacy choices in Settings once the consent form was agreed to")
    attach(app, as: "ads-privacy-choices")
    try openYourPrivacy(app)
    let lines = privacyLines(in: app)
    XCTAssertEqual(
      lines.count > 3 ? lines[3] : nil, "See Privacy choices.",
      "Your privacy's lines with Privacy choices in Settings: \(lines)")
  }

  /// The full-screen ad as a place is chosen. Never in the app's first run: a first launch saves
  /// an answer, so the next isn't one; once the ads have started there, the ad has 15 seconds to
  /// load, which nothing on screen shows. A place chosen in the picker then brings the ad over
  /// everything, the picker under it; closed, the picker closes too, onto the place chosen.
  /// Another place chosen as long after, within 5 minutes of the ad, brings none, though the next
  /// has had as long to load: the picker closes straight onto it. The stub (`-network`) answers
  /// the launch's request by IP with Leeds and each place chosen with its fixture; Google's
  /// traffic goes to Google.
  @MainActor
  func testAFullScreenAdWhenAPlaceIsChosen() throws {
    let network = [
      "-network", "ip-first-launch,leeds-dry,kathmandu-0545", "-umpGeography", "other",
    ]
    let first = try launch(["-resetStore"] + network)
    XCTAssertTrue(first.staticTexts["verdict"].waitForExistence(timeout: 15), "No answer saved")
    first.terminate()

    // Kathmandu's answer's own moment, as PickerTests choose it: the launch's, for Leeds, is a
    // day old by then.
    let app = try launch(network + ["-now", "2026-12-02T11:50:00.000Z"])
    guard app.find("ad-home").waitForExistence(timeout: 30) else {
      throw XCTSkip(
        "No ad band 30 seconds after the second launch: Google's consent tool or Mobile Ads "
          + "didn't answer in time, so the ads never started")
    }
    RunLoop.current.run(until: Date().addingTimeInterval(15))
    try choose("Kathmandu", in: app)
    switch afterChoosing(in: app) {
    case .picker:
      throw HomeScreenError("The picker is still open 10 seconds after a place was chosen")
    case .home:
      expectPlace("Kathmandu", in: app)
      throw XCTSkip(
        "No full-screen ad as the place was chosen: Google's demo ad hadn't loaded 15 seconds "
          + "after the ads started")
    case .ad:
      attach(app, as: "ads-full-screen")
      try closeTheAd(in: app)
    }
    // The picker closes once the ad does, onto the place chosen.
    guard app.buttons["place"].waitForExistence(timeout: 15) else {
      throw HomeScreenError(
        "No home screen 15 seconds after the full-screen ad closed; the picker is "
          + (app.find("place-search").exists ? "still open" : "closed"))
    }
    expectPlace("Kathmandu", in: app)

    // As long again, for the next ad to load: well within 5 minutes of the first.
    RunLoop.current.run(until: Date().addingTimeInterval(15))
    try choose("Leeds", in: app)
    switch afterChoosing(in: app) {
    case .picker:
      throw HomeScreenError("The picker is still open 10 seconds after a place was chosen")
    case .ad:
      attach(app, as: "ads-full-screen-again")
      XCTFail("A second full-screen ad, within 5 minutes of the first")
    case .home:
      expectPlace("Leeds", in: app)
    }
  }

  // MARK: - Helpers

  /// Launches the app with `-uitest` and `arguments`, the ads and all: no `-noads 1`, unlike
  /// every other UI test's launch (`launchApp`). Waits for the heading.
  @MainActor
  private func launch(_ arguments: [String]) throws -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-uitest"] + arguments
    app.launch()
    guard app.heading.waitForExistence(timeout: 20) else {
      throw HomeScreenError("No heading on screen after launching with \(arguments)")
    }
    return app
  }

  /// The window and the home screen's frames, the ads' included (`homeFrames`), from one
  /// snapshot; nil, with a failure, when the app can't be read.
  @MainActor
  private func homeScreen(of app: XCUIApplication) -> (window: CGRect, frames: [String: CGRect])? {
    do {
      let root = try app.snapshot()
      return (root.frame, XCUIApplication.homeFrames(in: root))
    } catch {
      XCTFail("The screen can't be read: \(error)")
      return nil
    }
  }

  /// Checks the band, from one snapshot: it spans the window; the pager and `page`, the page on
  /// screen, end at or above its top; it ends within the window; it is 58 to 158 points tall, the
  /// anchored adaptive banner's 50 to 150 (GADAdSize.h) and the 8 points of tint above it, the
  /// border between the page and the ad; its banner (`ad-banner-home`) lies under the tint; and
  /// VoiceOver reads it as an advertisement. Fails once, listing what is wrong, with where
  /// everything is (`homeGeometry`).
  @MainActor
  private func expectBand(in app: XCUIApplication, below page: HomeScreen.Page) {
    guard let screen = homeScreen(of: app) else { return }
    guard let band = screen.frames["ad-home"] else {
      XCTFail("No ad band to check; \(app.homeGeometry)")
      return
    }
    let window = screen.window
    var wrong: [String] = []
    if abs(band.minX - window.minX) > 0.5 || abs(band.width - window.width) > 0.5 {
      wrong.append("it doesn't span the window at \(window)")
    }
    for id in ["pager", "page-\(page.view)"] {
      guard let frame = screen.frames[id] else {
        wrong.append("there is no \(id)")
        continue
      }
      if frame.maxY > band.minY + 0.5 {
        wrong.append("\(id) at \(frame) runs on below its top, under the ad")
      }
    }
    if band.maxY > window.maxY + 0.5 {
      wrong.append("it runs on below the window's bottom edge at \(window.maxY)")
    }
    let height = onPixels(band.height)
    if height < 58 || height > 158 {
      wrong.append("it is \(height) tall, not a banner's 50 to 150 and the tint's 8")
    }
    let under = CGRect(
      x: band.minX, y: band.minY + 8, width: band.width, height: max(band.height - 8, 0))
    if let banner = screen.frames["ad-banner-home"] {
      if !lies(banner, within: under) {
        wrong.append("its banner at \(banner) isn't within it under the tint, at \(under)")
      }
    } else {
      wrong.append("it holds no banner (ad-banner-home)")
    }
    let label = app.find("ad-home").label
    if label != "Advertisement" {
      wrong.append("VoiceOver reads it as \"\(label)\", not \"Advertisement\"")
    }
    XCTAssertTrue(
      wrong.isEmpty,
      "The band at \(band): " + wrong.joined(separator: "; ") + "; \(app.homeGeometry)")
  }

  /// Checks the box at the end of `page`, the page on screen, whole on screen, from one snapshot:
  /// below the footer's links (the credits, the page's last lines, whose links are its last); at
  /// least 250 tall and within the page's width, the website's ad box; its banner
  /// (`ad-banner-page-<view>`) within it, and 40 points or more below the links, the website's
  /// space above its box; and read by VoiceOver as an advertisement. Fails once, listing what is
  /// wrong.
  @MainActor
  private func expectBox(in app: XCUIApplication, on page: HomeScreen.Page) {
    let id = "ad-page-\(page.view)"
    guard let screen = homeScreen(of: app) else { return }
    guard let box = screen.frames[id], let shown = screen.frames["page-\(page.view)"] else {
      XCTFail("No \(id) or no page-\(page.view) to check; \(app.homeGeometry)")
      return
    }
    let credits = app.find("credits")
    guard credits.exists else {
      XCTFail("No credits at the end of the \(page.view) page")
      return
    }
    let links = credits.frame
    var wrong: [String] = []
    if box.minY < links.maxY - 0.5 {
      wrong.append("it isn't below the footer's links, the credits at \(links)")
    }
    let height = onPixels(box.height)
    if height < 250 {
      wrong.append("it is \(height) tall, not the website's 250 at least")
    }
    if box.minX < shown.minX - 0.5 || box.maxX > shown.maxX + 0.5 {
      wrong.append("it runs on outside the page at \(shown)")
    }
    let bannerID = "ad-banner-page-\(page.view)"
    if let banner = screen.frames[bannerID] {
      if !lies(banner, within: box) {
        wrong.append("its banner at \(banner) isn't within it")
      }
      if banner.minY < links.maxY + 40 - 0.5 {
        wrong.append("its banner at \(banner) is less than 40 points below the links at \(links)")
      }
    } else {
      wrong.append("it holds no banner (\(bannerID))")
    }
    let label = app.find(id).label
    if label != "Advertisement" {
      wrong.append("VoiceOver reads it as \"\(label)\", not \"Advertisement\"")
    }
    XCTAssertTrue(
      wrong.isEmpty,
      "The box at \(box): " + wrong.joined(separator: "; ") + "; \(app.homeGeometry)")
  }

  /// Scrolls `page`, the page on screen, until the element `id` lies whole on screen: drags of
  /// four fifths of the page on screen (`scrollDown`, whose drag then starts on the page, above
  /// the band), up to 12, more than the longest page's end at Large takes; throws when it never
  /// does.
  @MainActor
  private func scroll(
    _ page: HomeScreen.Page,
    toShow id: String,
    in app: XCUIApplication
  ) throws {
    let element = app.find(id)
    guard element.exists else {
      throw HomeScreenError("No \(id) on the \(page.view) page; \(app.homeGeometry)")
    }
    var drags: [Drag] = []
    while true {
      let frame = settledFrame(of: element)
      let shown = onScreen(page, in: app)
      if lies(frame, within: shown) { return }
      guard drags.count < 12 else {
        throw HomeScreenError(
          "\(id) at \(frame) never came whole on screen, within \(shown), after the drags "
            + "\(drags); \(app.homeGeometry)")
      }
      drags.append(scrollDown(page, by: shown.height * 0.8, in: app))
    }
  }

  /// Opens the picker with the place button, searches for `name` and chooses the first result,
  /// which the search fixtures give (`search-leeds`, `search-kathmandu`).
  @MainActor
  private func choose(_ name: String, in app: XCUIApplication) throws {
    app.buttons["place"].tap()
    let field = app.find("place-search")
    guard field.waitForExistence(timeout: 10) else {
      throw HomeScreenError("No picker after tapping the place button; \(app.homeGeometry)")
    }
    field.tap()
    field.typeText(name)
    let result = app.buttons["result-0"]
    guard result.waitForExistence(timeout: 10) else {
      throw HomeScreenError("No results for \(name)")
    }
    result.tap()
  }

  /// Where the screen went once a place was chosen in the picker.
  private enum Outcome {
    /// Something over everything: the full-screen ad.
    case ad
    /// The picker closed, onto the home screen.
    case home
    /// The picker, still open.
    case picker
  }

  /// Where the screen goes in the 10 seconds after a place is chosen in the picker: the home
  /// screen, once its place button is back and the picker's search field gone (HomeView takes the
  /// home screen out of the tree while a sheet is open, so the button comes back only once the
  /// picker has closed); something over everything for a second on end, the place button still
  /// out and the search field gone or covered, which is the full-screen ad (a second, so a frame
  /// between the picker and the home screen isn't taken for one); or neither, the picker.
  @MainActor
  private func afterChoosing(in app: XCUIApplication) -> Outcome {
    let field = app.find("place-search")
    let place = app.buttons["place"]
    let deadline = Date().addingTimeInterval(10)
    var covered: Date?
    while Date() < deadline {
      let home = place.exists
      let picker = field.exists && field.isHittable
      if home && !field.exists { return .home }
      if !home && !picker {
        let since = covered ?? Date()
        if Date().timeIntervalSince(since) >= 1 { return .ad }
        covered = since
      } else {
        covered = nil
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.25))
    }
    return covered == nil ? .picker : .ad
  }

  /// Closes the full-screen ad with its close button, a button whose label says Close (not the
  /// picker's own, under the ad), once a tap would reach it, within 10 seconds (an ad may count
  /// down before it can be closed); skips, listing the buttons, when there is none.
  @MainActor
  private func closeTheAd(in app: XCUIApplication) throws {
    let format = "label CONTAINS[c] %@ AND identifier != %@"
    let close = app.buttons.matching(NSPredicate(format: format, "close", "picker-close"))
      .firstMatch
    let deadline = Date().addingTimeInterval(10)
    while !(close.exists && close.isHittable) && Date() < deadline {
      RunLoop.current.run(until: Date().addingTimeInterval(0.5))
    }
    guard close.exists && close.isHittable else {
      let labels = app.buttons.allElementsBoundByIndex.map(\.label)
      throw XCTSkip(
        "Google's full-screen ad has no button whose label says Close that a tap would reach; "
          + "the buttons: \(labels)")
    }
    close.tap()
  }

  /// Checks the home screen shows `name`, the place chosen: the place button names it, within 15
  /// seconds, as the place loads; the picker is closed; and the top bar is no longer on
  /// approximate location.
  @MainActor
  private func expectPlace(_ name: String, in app: XCUIApplication) {
    let place = app.buttons["place"]
    let reads = NSPredicate(format: "label == %@", "Place: \(name). Change place.")
    let waited = XCTNSPredicateExpectation(predicate: reads, object: place)
    let shown = XCTWaiter().wait(for: [waited], timeout: 15) == .completed
    XCTAssertTrue(
      shown, "The place button reads \"\(place.exists ? place.label : "nothing")\", not \(name)")
    XCTAssertFalse(app.find("place-search").exists, "The picker is still open")
    XCTAssertFalse(app.buttons["use-my-location"].exists, "Still on approximate location")
  }

  /// The consent form's button that agrees, by its words: "Consent", Google's, or "Accept",
  /// within 15 seconds, as the form's page loads after its web view is there; skips, listing the
  /// form's buttons, when it has neither.
  @MainActor
  private func agreeButton(in form: XCUIElement) throws -> XCUIElement {
    let deadline = Date().addingTimeInterval(15)
    repeat {
      for words in ["Consent", "Accept"] {
        let says = NSPredicate(format: "label ==[c] %@", words)
        let button = form.buttons.matching(says).firstMatch
        if button.exists { return button }
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.5))
    } while Date() < deadline
    let labels = form.buttons.allElementsBoundByIndex.map(\.label)
    throw XCTSkip(
      "Google's consent form has no button labelled Consent or Accept; its buttons: \(labels)")
  }

  /// Whether `element` is gone within `timeout` seconds.
  @MainActor
  private func gone(_ element: XCUIElement, within timeout: TimeInterval) -> Bool {
    let gone = NSPredicate(format: "exists == false")
    let waited = XCTNSPredicateExpectation(predicate: gone, object: element)
    return XCTWaiter().wait(for: [waited], timeout: timeout) == .completed
  }

  /// Taps the gear, and waits for Settings (its Close).
  @MainActor
  private func openSettings(_ app: XCUIApplication) throws {
    app.buttons["settings"].tap()
    guard app.buttons["close-settings"].waitForExistence(timeout: 5) else {
      throw HomeScreenError("No Settings after tapping the gear; \(app.homeGeometry)")
    }
  }

  /// Taps Settings' Your privacy, and waits for its title on the page (`page-title`).
  @MainActor
  private func openYourPrivacy(_ app: XCUIApplication) throws {
    app.buttons["your-privacy"].tap()
    let titled = NSPredicate(format: "identifier == 'page-title' AND label == %@", "Your privacy")
    guard app.staticTexts.matching(titled).firstMatch.waitForExistence(timeout: 5) else {
      throw HomeScreenError("No Your privacy after tapping its row")
    }
  }

  /// Your privacy's lines, in order (`privacy-line-<n>`), up to 10, more than it ever has: every
  /// one, whether on screen or not, as the page is a scroll view's stack, all of it in the tree.
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

/// Whether `inner` lies within `outer`, edge by edge, to half a point either way, as a frame read
/// on a 3x screen may round.
private func lies(_ inner: CGRect, within outer: CGRect) -> Bool {
  inner.minX >= outer.minX - 0.5 && inner.maxX <= outer.maxX + 0.5
    && inner.minY >= outer.minY - 0.5 && inner.maxY <= outer.maxY + 0.5
}

/// Whether two frames are the same, edge by edge, to half a point either way.
private func same(_ one: CGRect, _ other: CGRect) -> Bool {
  abs(one.minX - other.minX) <= 0.5 && abs(one.maxX - other.maxX) <= 0.5
    && abs(one.minY - other.minY) <= 0.5 && abs(one.maxY - other.maxY) <= 0.5
}
