import XCTest

/// The ads (iOS build spec, section 14, with phase 8.3's three placements: DECISIONS, "Ads in the
/// iPhone app: three placements"), with Google's demo units over the real network: the only UI
/// tests launched without `-noads 1`. The free version's band under the pager, in a space of its
/// own that stays put as its ad comes or doesn't, and the box at a page's end, below the footer's
/// links; the paid version (`-unlocked 1`) with no ad, no Report an ad and no Privacy choices; in
/// the EEA (`-umpGeography eea`), Google's consent form first, then Privacy choices in Settings
/// and its line in Your privacy; the full-screen ad as a place is chosen in the picker, which
/// closes once the ad does, with no second one within 5 minutes; and a purchase mid-session
/// (`-purchase bought`, StoreKit's stand-in) taking every ad away at once.
///
/// Google's consent tool, its form and its demo ads aren't the app's to guarantee: a test whose
/// answer from Google doesn't come in time skips, saying which, rather than fails. Which it is, a
/// Debug build's readout of the ads model says (`DebugHooks.adsReadout`, over the home screen):
/// `debug-ads`, the ads' phase, `debug-interstitial`, whether a full-screen ad is loaded, and
/// `debug-shown`, how many have shown and closed. A test skips only while the ads are still asking
/// or are withheld (UMP or Mobile Ads didn't answer, or the network didn't carry it; `notOn`), or
/// while no full-screen ad has loaded. What is the app's fails: ads that never start in the free
/// version, no band once they are on, a consent form skipped, a band or a box out of place, a space
/// that moves as its ad loads, ads started or shown in the paid version, a loaded full-screen ad
/// that doesn't show, a picker that never closes, a second full-screen ad, an ad left once the
/// purchase is made (that test never skips: `testBuyingTakesTheAdsAway`). Nothing here is audited,
/// since the ads' own elements are Google's (HomeAuditTests audit the home screen without them).
/// The screens are attached for the contact sheet (`ads-…`).
final class AdsTests: XCTestCase {
  override func setUpWithError() throws {
    // Every frame out of place is reported, not only the first; a screen that never comes
    // throws, which stops the test, and an answer from Google that never comes skips it.
    continueAfterFailure = true
  }

  /// The free version (`-unlocked 0`) outside the EEA (`-umpGeography other`, so no form): once
  /// the ads are on (`awaitTheAds`, which fails when they never start or no band comes), the band
  /// (`expectBand`) is under the pager, which ends at its top, so no page runs under the ad, and
  /// the home screen still fits; its frame stays as Google's demo ad loads or fails, its space
  /// fixed, as Google's policy asks. At the page's end, the box (`expectBox`), below the footer's
  /// links.
  @MainActor
  func testTheBandSitsUnderThePager() throws {
    let page = try HomeScreen.named("leeds-dry").opening()
    let app = try launch([
      "-resetStore", "-fixture", "leeds-dry", "-umpGeography", "other", "-unlocked", "0",
    ])
    try awaitHeading(page.heading, in: app)
    try awaitTheAds(in: app, after: "the launch")
    let band = app.find("ad-home")
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
  /// 14.2), so for the 10 seconds after the launch the ads read idle (`debug-ads`) at every
  /// reading and there is no band, and then no box, no banner and no web page of Google's;
  /// Settings has no Report an ad and no Privacy choices; and Your privacy has no ads line.
  @MainActor
  func testThePaidVersionShowsNoAds() throws {
    let page = try HomeScreen.named("leeds-dry").opening()
    let app = try launch([
      "-resetStore", "-fixture", "leeds-dry", "-umpGeography", "other", "-unlocked", "1",
    ])
    try awaitHeading(page.heading, in: app)
    // Twice a second for 10 seconds, each phase read as it changes, until a band comes.
    let band = app.find("ad-home")
    let deadline = Date().addingTimeInterval(10)
    var phases: [String] = []
    repeat {
      let phase = adsPhase(in: app) ?? "no readout"
      if phases.last != phase { phases.append(phase) }
      if band.exists { break }
      RunLoop.current.run(until: Date().addingTimeInterval(0.5))
    } while Date() < deadline
    XCTAssertEqual(
      phases, ["idle"], "debug-ads in the paid version read \(phases), not idle throughout")
    XCTAssertFalse(band.exists, "An ad band in the paid version; \(app.homeGeometry)")
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

  /// A purchase mid-session takes every ad away at once (spec 14.2.5): the free version outside
  /// the EEA, with StoreKit's stand-in selling the product (`-purchase bought`). Up to 30 seconds
  /// for the ads to come on, then 5 for the band (`awaitTheAds`' waits), noting what `debug-ads`
  /// read and whether the band came; then, whatever Google did, the purchase from Settings'
  /// upgrade page, and back on the home screen: `debug-ads` reads off within 2 seconds, there is
  /// no band, the middle page ends with no box and no upgrade row, and Settings has no Report an
  /// ad. Privacy choices never shows outside the EEA, so its going is the model's test
  /// (IsItCore's `AdsStopTests`). With the ads on before it, the band's space, kept from the
  /// moment they came on, is given back: the pager runs on at least to where the band's banner
  /// ended (to the safe area's bottom edge or the window's, which XCUITest can't tell apart); and
  /// a band that came is gone within 2 seconds. It never skips, as what it proves is the app's:
  /// when Google's answer didn't come in time, a note says which of those two wasn't checked and
  /// why (`ads-after-purchase-unchecked`), and the box and its banner too when the ads never came
  /// on, as no box is drawn then; the rest still fails if it is wrong; the ads never starting, or
  /// no readout, fails as `notOn` says.
  @MainActor
  func testBuyingTakesTheAdsAway() throws {
    let page = try HomeScreen.named("leeds-dry").opening()
    let app = try launch([
      "-resetStore", "-fixture", "leeds-dry", "-umpGeography", "other", "-purchase", "bought",
    ])
    try awaitHeading(page.heading, in: app)
    let phase = waitForAdsPhase(["on", "withheld"], in: app, timeout: 30)
    let band = app.find("ad-home")
    let came = phase == "on" && band.waitForExistence(timeout: 5)
    // What is the app's fails, as everywhere here: the ads never started, no readout, or on with
    // no band. Still asking or withheld is Google's, and only leaves two checks out (below).
    if phase != "on",
      let why = notOn(phase, "30 seconds after the launch", in: app) as? HomeScreenError
    {
      XCTFail("\(why)")
    }
    if phase == "on", !came {
      XCTFail(
        "The ads are on (debug-ads reads on) but there is no ad band 5 seconds later; "
          + app.homeGeometry)
    }
    // Where the band and its banner were, for the pager to take their space back.
    let before = came ? homeScreen(of: app) : nil

    try openSettings(app)
    let upgrade = app.buttons["upgrade"]
    guard upgrade.waitForExistence(timeout: 10) else {
      throw HomeScreenError("No upgrade row in Settings")
    }
    upgrade.tap()
    let buy = app.buttons["buy"]
    guard buy.waitForExistence(timeout: 10) else {
      throw HomeScreenError("No Buy on the upgrade page Settings' upgrade row opened")
    }
    buy.tap()
    let thanks = NSPredicate(format: "label == %@", "Thank you. Ads are off and widgets are on.")
    let outcome = XCTNSPredicateExpectation(predicate: thanks, object: app.find("upgrade-outcome"))
    guard XCTWaiter().wait(for: [outcome], timeout: 10) == .completed else {
      throw HomeScreenError("No thanks on the upgrade page 10 seconds after Buy")
    }
    app.navigationBars.buttons.element(boundBy: 0).tap()
    app.buttons["close-settings"].tap()
    guard app.sheetCloses(within: 5) else {
      throw HomeScreenError("Settings is still open 5 seconds after its Close")
    }

    XCTAssertEqual(
      waitForAdsPhase(["off"], in: app, timeout: 2), "off",
      "debug-ads doesn't read off 2 seconds after the purchase")
    XCTAssertTrue(
      gone(band, within: 2), "An ad band 2 seconds after the purchase; \(app.homeGeometry)")
    if let reach = before?.frames["ad-banner-home"]?.maxY,
      let pager = homeScreen(of: app)?.frames["pager"]
    {
      XCTAssertGreaterThanOrEqual(
        pager.maxY, reach - 0.5,
        "The pager at \(pager) doesn't take back the band's space, where its banner ended at "
          + "\(reach); \(app.homeGeometry)")
    }
    // The checks left out, and why, so a run whose ads never came says so.
    var unchecked: [String] = []
    if !came {
      let why =
        phase == "on"
        ? "no band came in the 5 seconds after the ads came on, which fails above"
        : "debug-ads read \(phase ?? "nothing") 30 seconds after the launch, not on"
      unchecked.append("The pager taking back the band's space: \(why)")
      unchecked.append("The band going within 2 seconds: \(why)")
    } else if before?.frames["ad-banner-home"] == nil {
      unchecked.append(
        "The pager taking back the band's space: the band held no banner (ad-banner-home) to "
          + "measure it by")
    }
    if phase != "on" {
      unchecked.append(
        "The box at the middle page's end, and its banner, going: debug-ads read "
          + "\(phase ?? "nothing") 30 seconds after the launch, not on, so no box was drawn")
    }
    if !unchecked.isEmpty {
      attachText(unchecked.joined(separator: "\n"), as: "ads-after-purchase-unchecked")
    }
    try scroll(page, toShow: "credits", in: app)
    for id in ["ad-page-\(page.view)", "ad-banner-page-\(page.view)", "upgrade-row"] {
      XCTAssertFalse(app.find(id).exists, "\(id) after the purchase; \(app.homeGeometry)")
    }
    attach(app, as: "ads-after-purchase")
    try openSettings(app)
    XCTAssertFalse(app.buttons["report-ad"].exists, "Report an ad after the purchase")
  }

  /// In the EEA (`-umpGeography eea`, Google's debug geography, which a Debug build asks again at
  /// each such launch, UMP forgetting its kept answer), Google's consent form comes over the home
  /// screen at launch, the ads asking until it is answered: the ads on before any form is a form
  /// the app skipped, and fails. Consent is a touch the form takes, which the ads coming on show
  /// (`tapUntilOn`). Once agreed to, Google's privacy options must be offered, so
  /// Settings shows Privacy choices, and Your privacy's line after the ads line points to it
  /// ("See Privacy choices.").
  @MainActor
  func testTheConsentFormThenPrivacyChoices() throws {
    let page = try HomeScreen.named("leeds-dry").opening()
    let app = try launch(["-resetStore", "-fixture", "leeds-dry", "-umpGeography", "eea"])
    try awaitHeading(page.heading, in: app)
    // Up to 30 seconds for the form's web view, or for the ads to stop asking without one.
    let form = app.webViews.firstMatch
    let phase = waitForAdsPhase(["on", "withheld"], in: app, timeout: 30) { form.exists }
    // Nothing turns the ads on before the form is answered: a web view then is the band's banner.
    if phase == "on" {
      throw HomeScreenError(
        "The ads came on in the EEA with no consent form first, though UMP forgets its answer at "
          + "each such launch: the app skipped the form; \(app.homeGeometry)")
    }
    guard form.exists else {
      throw notOn(phase, "30 seconds after the launch in the EEA, with no consent form", in: app)
    }
    let agree = try agreeButton(in: form)
    attach(app, as: "ads-consent-form")
    let words = agree.label
    guard tapUntilOn(agree, in: app) else {
      throw XCTSkip(
        "Google's consent form took none of a tap, a tap at its centre and a press on \(words): "
          + "the ads still read \(adsPhase(in: app) ?? "nothing") 10 seconds after each; a "
          + "touch " + (agree.exists && agree.isHittable ? "would reach it now" : "wouldn't"))
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
  /// an answer, so the next isn't one; once the ads are on there, the ad loads, which only the
  /// Debug readout shows (`debug-interstitial` reads ready), within 30 seconds or the test skips,
  /// Google having none to give. A place chosen in the picker then brings the ad over everything,
  /// the picker under it: the test closes it with Google's close button and waits for the app to
  /// count it shown (`debug-shown`), or fails, as the app had an ad and didn't show it; closed,
  /// the picker closes too, onto the place chosen. Once the next ad has loaded (30 seconds again,
  /// or the rest skips, as a choice with no ad loaded would show nothing), another place chosen,
  /// within 5 minutes of the first ad, brings none: no close button comes, the picker closes
  /// straight onto it, and the app still counts one. The stub
  /// (`-network`) answers the launch's request by IP with Leeds and each place chosen with its
  /// fixture; Google's traffic goes to Google.
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
    try awaitTheAds(in: app, after: "the second launch")
    guard waitForAFullScreenAd(in: app, timeout: 30) else {
      throw XCTSkip(
        "No full-screen ad loaded 30 seconds after the ads came on (debug-interstitial reads "
          + "none): Google had no demo ad to give")
    }
    try choose("Kathmandu", in: app)
    let firstAd = closeTheAd(in: app, untilShown: 1, timeout: 40)
    guard firstAd.shown else {
      attach(app, as: "ads-full-screen-missing")
      let counted = adsShown(in: app).map(String.init) ?? "nothing"
      if firstAd.sawAd {
        throw HomeScreenError(
          "Google's full-screen ad came and its close button was tapped, but 40 seconds on the "
            + "app counts none shown (debug-shown reads \(counted))")
      }
      let labels = app.buttons.allElementsBoundByIndex.map(\.label)
      throw HomeScreenError(
        "No full-screen ad as the place was chosen, though one was loaded (debug-interstitial "
          + "read ready): in 40 seconds no close button came and the app counts none shown "
          + "(debug-shown reads \(counted)); the buttons: \(labels)")
    }
    // The picker closes once the ad does, onto the place chosen.
    XCTAssertTrue(
      app.pickerCloses(within: 15),
      "The picker is still open 15 seconds after the full-screen ad closed")
    expectPlace("Kathmandu", in: app)

    // The next ad, loaded once the first closed, up to 30 seconds on, well within 5 minutes of
    // the first: with none loaded, a choice would bring no ad whatever the minutes since.
    guard waitForAFullScreenAd(in: app, timeout: 30) else {
      throw XCTSkip(
        "The first full-screen ad showed and closed onto the place chosen, but no next one loaded "
          + "in the 30 seconds after (debug-interstitial reads none): Google had no demo ad to "
          + "give, so that a second choice within 5 minutes brings none can't be shown")
    }
    try choose("Leeds", in: app)
    // No ad's close button on the way: the picker closes straight onto Leeds, and the app still
    // counts one ad shown.
    let close = adCloseButton(in: app)
    let deadline = Date().addingTimeInterval(10)
    while !close.exists && Date() < deadline {
      RunLoop.current.run(until: Date().addingTimeInterval(0.25))
    }
    if close.exists {
      attach(app, as: "ads-full-screen-again")
      XCTFail("A second full-screen ad, within 5 minutes of the first")
      if close.isHittable { close.tap() }
    }
    XCTAssertTrue(
      app.pickerCloses(within: 15),
      "The picker is still open 25 seconds after a place was chosen")
    expectPlace("Leeds", in: app)
    XCTAssertEqual(
      adsShown(in: app), 1, "The full-screen ads shown, once the second place was chosen")
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

  /// The ads' phase as the Debug readout says it (`debug-ads`, `DebugHooks.adsReadout`): idle,
  /// asking, withheld or on; nil when the home screen has no readout, as under a sheet.
  @MainActor
  private func adsPhase(in app: XCUIApplication) -> String? {
    let readout = app.find("debug-ads")
    return readout.exists ? readout.value as? String : nil
  }

  /// Reads the ads' phase twice a second until it is one of `phases` or `done` holds, for up to
  /// `timeout` seconds, and gives the last reading.
  @MainActor
  private func waitForAdsPhase(
    _ phases: Set<String>,
    in app: XCUIApplication,
    timeout: TimeInterval,
    orUntil done: () -> Bool = { false }
  ) -> String? {
    let deadline = Date().addingTimeInterval(timeout)
    var phase = adsPhase(in: app)
    while !(phase.map(phases.contains) ?? false) && !done() && Date() < deadline {
      RunLoop.current.run(until: Date().addingTimeInterval(0.5))
      phase = adsPhase(in: app)
    }
    return phase
  }

  /// Waits up to 30 seconds after `what`, a free launch's, for the ads to be on, then up to 5 for
  /// the band (`ad-home`), which is there once they are on and the home screen's width is known.
  /// Ads that aren't on by then skip or fail as `notOn` says; on with no band fails.
  @MainActor
  private func awaitTheAds(in app: XCUIApplication, after what: String) throws {
    let phase = waitForAdsPhase(["on", "withheld"], in: app, timeout: 30)
    guard phase == "on" else {
      throw notOn(phase, "30 seconds after \(what)", in: app)
    }
    guard app.find("ad-home").waitForExistence(timeout: 5) else {
      throw HomeScreenError(
        "The ads are on (debug-ads reads on) but there is no ad band 5 seconds later; "
          + app.homeGeometry)
    }
  }

  /// What the ads not being on at `phase`, `when`, says, as the error to throw. Still asking, or
  /// withheld (UMP says no ads may be requested, as when its update or Google's form never came),
  /// is Google's or the network's, and skips; idle in a free launch, the ads never started, and no
  /// readout at all are the app's, and fail.
  @MainActor
  private func notOn(_ phase: String?, _ when: String, in app: XCUIApplication) -> any Error {
    switch phase {
    case "asking"?:
      return XCTSkip(
        "debug-ads still reads asking \(when): UMP's update, Google's consent form or Mobile "
          + "Ads' start didn't answer in time")
    case "withheld"?:
      return XCTSkip(
        "debug-ads reads withheld \(when): UMP says no ads may be requested, its update or "
          + "Google's consent form not having come (offline, or Google didn't answer)")
    case "idle"?:
      return HomeScreenError(
        "debug-ads still reads idle \(when), in a free launch without -noads: the ads never "
          + "started")
    case nil:
      return HomeScreenError(
        "No debug-ads readout on the home screen \(when) (DebugHooks.adsReadout); "
          + app.homeGeometry)
    case .some(let other):
      return HomeScreenError("debug-ads reads \(other) \(when), which is no phase of the ads")
    }
  }

  /// Whether `element` is gone, or goes within `timeout` seconds: an element of the home screen
  /// itself, which no closed presentation leaves behind (`sheetClosed`).
  @MainActor
  private func gone(_ element: XCUIElement, within timeout: TimeInterval) -> Bool {
    let gone = NSPredicate(format: "exists == false")
    let waited = XCTNSPredicateExpectation(predicate: gone, object: element)
    return XCTWaiter().wait(for: [waited], timeout: timeout) == .completed
  }

  /// Whether a full-screen ad is loaded, waiting for a place to be chosen, within `timeout`
  /// seconds: the Debug readout `debug-interstitial` reads ready, where it reads none until then.
  @MainActor
  private func waitForAFullScreenAd(in app: XCUIApplication, timeout: TimeInterval) -> Bool {
    let ready = NSPredicate(format: "value == %@", "ready")
    let readout = app.find("debug-interstitial")
    let waited = XCTNSPredicateExpectation(predicate: ready, object: readout)
    return XCTWaiter().wait(for: [waited], timeout: timeout) == .completed
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
  /// screen, end at or above its top; it ends within the window; its banner (`ad-banner-home`)
  /// is the anchored adaptive banner's 50 to 150 points tall (GADAdSize.h), starts 8 points below
  /// the band's top, under the tint that borders the page and the ad, lies within the band, and
  /// ends above the home indicator; and VoiceOver reads the band as an advertisement. The band's
  /// own frame takes in its tint, which reaches down under the home indicator to the window's
  /// bottom edge, so its height says nothing of the banner's: on 3f91596's macOS run (the iPhone
  /// 17, a window 402 by 874) the band was 168 tall, the tint's 8, the banner's 126 and the home
  /// indicator's 34. Fails once, listing what is wrong, with where everything is
  /// (`homeGeometry`).
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
    let under = CGRect(
      x: band.minX, y: band.minY + 8, width: band.width, height: max(band.height - 8, 0))
    if let banner = screen.frames["ad-banner-home"] {
      let height = onPixels(banner.height)
      if height < 50 || height > 150 {
        wrong.append("its banner at \(banner) is \(height) tall, not a banner's 50 to 150")
      }
      if abs(banner.minY - under.minY) > 0.5 {
        wrong.append("its banner at \(banner) doesn't start under the tint's 8, at \(under.minY)")
      }
      if !lies(banner, within: under) {
        wrong.append("its banner at \(banner) isn't within it under the tint, at \(under)")
      }
      // XCUITest gives no safe area, so the banner is held clear of the home indicator by the
      // band's bottom edge, the window's, its tint reaching down under the indicator: on the
      // iPhone 17 the indicator takes the bottom 34 points, so a banner ending 20 or more above
      // that edge is clear of it, where one running on under the indicator is not.
      if banner.maxY > band.maxY - 20 {
        wrong.append(
          "its banner at \(banner) runs on to within 20 of its bottom edge at \(band.maxY), "
            + "under the home indicator")
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

  /// The full-screen ads the model says have shown and closed this launch (`debug-shown`,
  /// `DebugHooks.adsReadout`); nil when the home screen has no readout, as under a sheet.
  @MainActor
  private func adsShown(in app: XCUIApplication) -> Int? {
    let readout = app.find("debug-shown")
    return readout.exists ? (readout.value as? String).flatMap { Int($0) } : nil
  }

  /// Google's full-screen ad's close button, labelled "Close Advertisement" (GMA 13.11.0's
  /// `GADCloseButton`, in its binary's strings), not the picker's own Close, under the ad.
  @MainActor
  private func adCloseButton(in app: XCUIApplication) -> XCUIElement {
    let format = "label CONTAINS[c] %@ AND identifier != %@"
    return app.buttons.matching(NSPredicate(format: format, "close", "picker-close")).firstMatch
  }

  /// After a place is chosen with a full-screen ad on hand: taps Google's ad's close button once
  /// a tap would reach it (an ad may count down before it can be closed), attaching the screen
  /// the first time, until the model counts the ad shown, which it does only once the ad has
  /// closed (`debug-shown` reaching `count`), for up to `timeout` seconds. Whether it did, and
  /// whether a close button ever came. The screen alone can't say: on eb5dfd8's macOS run, with
  /// Google's ad over the picker (its screen recording shows it), XCUITest still found the home
  /// screen's place button, and the test took the ad for the home screen.
  @MainActor
  private func closeTheAd(
    in app: XCUIApplication, untilShown count: Int, timeout: TimeInterval
  ) -> (shown: Bool, sawAd: Bool) {
    let close = adCloseButton(in: app)
    let deadline = Date().addingTimeInterval(timeout)
    var sawAd = false
    while Date() < deadline {
      if adsShown(in: app) == count { return (true, sawAd) }
      if close.exists && close.isHittable {
        if !sawAd { attach(app, as: "ads-full-screen") }
        sawAd = true
        close.tap()
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.5))
    }
    return (adsShown(in: app) == count, sawAd)
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
    XCTAssertTrue(app.pickerClosed, "The picker is still open")
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

  /// Touches `button`, Google's consent form's, until the ads come on (the readout's `debug-ads`
  /// reads on, which only an answer the form takes brings): a tap, then a tap at the button's
  /// centre, then a press, each once a touch would reach it (within 10 seconds), then 10 seconds
  /// for the ads. Whether they came on. Not whether the button went: on two macOS runs (3f91596
  /// and eb5dfd8) it was still there after every tap, as XCUITest went on finding elements no
  /// longer on screen (the full-screen test's place button under Google's ad).
  @MainActor
  private func tapUntilOn(_ button: XCUIElement, in app: XCUIApplication) -> Bool {
    let touches: [(XCUIElement) -> Void] = [
      { $0.tap() },
      { $0.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap() },
      { $0.press(forDuration: 0.2) },
    ]
    for touch in touches {
      let deadline = Date().addingTimeInterval(10)
      while button.exists && !button.isHittable && Date() < deadline {
        RunLoop.current.run(until: Date().addingTimeInterval(0.25))
      }
      if button.exists && button.isHittable { touch(button) }
      if waitForAdsPhase(["on"], in: app, timeout: 10) == "on" { return true }
    }
    return false
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

/// Whether two frames are the same, edge by edge, to half a point either way.
private func same(_ one: CGRect, _ other: CGRect) -> Bool {
  abs(one.minX - other.minX) <= 0.5 && abs(one.maxX - other.maxX) <= 0.5
    && abs(one.minY - other.minY) <= 0.5 && abs(one.maxY - other.maxY) <= 0.5
}
