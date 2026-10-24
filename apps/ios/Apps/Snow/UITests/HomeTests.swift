import XCTest

/// The home screen (iOS build spec, sections 10.2, 16 and 17.2): each page of Now, Today
/// (Tomorrow from 6pm) and This week, reached by the switcher and by swiping, for
/// aberdeen-snow, durham-tomorrow and leeds-dry; the view it opens on either side of 6pm; the
/// middle tab turning to Tomorrow at 6pm while the app is open; and a place under "Nearby:"
/// loading in place. Every launch is on a fixture (`-fixture`, never the network), from a clean
/// store, with the model's clock at the screen's moment and fixed there (`-clock fixed`), except
/// where it must run. What each page should say is `HomeScreens.json`'s, generated from page.json,
/// so nothing here types a page's words: each check compares what VoiceOver hears, the heading
/// (the question and the answer, with the place), the verdict and every row's label, exactly.
final class HomeTests: XCTestCase {
  override func setUpWithError() throws {
    // Every difference on a page is reported, not only the first; a screen that never comes
    // throws, which stops the test.
    continueAfterFailure = true
  }

  @MainActor
  func testAberdeenSnow() throws {
    try everyPage("aberdeen-snow")
  }

  /// After 6pm at the place: the app opens on Now, and the middle tab reads Tomorrow.
  @MainActor
  func testDurhamTomorrow() throws {
    try everyPage("durham-tomorrow")
  }

  @MainActor
  func testLeedsDry() throws {
    try everyPage("leeds-dry")
  }

  /// The view the app opens on (`defaultView`): Today at 5:59pm at the place, its tabs Now,
  /// Today and This week; Now at 6pm, the middle tab Tomorrow.
  @MainActor
  func testDefaultViewEitherSideOf6pm() throws {
    let before = try HomeScreen.named("durham-before-6pm")
    XCTAssertEqual(before.defaultView, "today")
    let early = try launch(before)
    try tabs(before, in: early)
    expect(try before.opening(), in: early)
    early.terminate()

    let after = try HomeScreen.named("durham-at-6pm")
    XCTAssertEqual(after.defaultView, "now")
    let late = try launch(after)
    try tabs(after, in: late)
    expect(try after.opening(), in: late)
    try tap(try after.page("today"), in: late)
    expect(try after.page("today"), in: late)
  }

  /// Open on Today at 5:58pm with the clock running (`-clock run`): at 6pm the middle tab turns
  /// to Tomorrow and its page to tomorrow's answer, where it is, with no request (the fixture's
  /// server would answer the same anyway) and without moving to Now. The clock starts two
  /// minutes before 6pm, so that a slow launch on the runner can't pass 6pm before the test has
  /// read Today; the wait for it allows for the rest.
  @MainActor
  func testTheMiddleTabTurnsToTomorrowAt6pm() throws {
    let start = try HomeScreen.named("durham-flip-start")
    let six = try HomeScreen.named("durham-at-6pm")
    let app = try launch(start, clock: "run")
    let today = try start.page("today")
    XCTAssertEqual(start.defaultView, "today")
    expect(today, in: app)
    XCTAssertTrue(app.buttons[today.label].isSelected, "The app didn't open on the middle tab")

    // The tick at 6pm on the model's clock, two minutes after the launch's moment.
    let tomorrow = try six.page("today")
    try awaitHeading(tomorrow.heading, in: app, timeout: 180)
    expect(tomorrow, in: app)
    let tab = app.buttons[tomorrow.label]
    XCTAssertTrue(tab.exists, "No \(tomorrow.label) tab after 6pm")
    XCTAssertTrue(tab.isSelected, "The view moved at 6pm")
    XCTAssertFalse(app.buttons[today.label].exists, "The \(today.label) tab is still there")
    try tap(try six.page("now"), in: app)
    expect(try six.page("now"), in: app)
  }

  /// A place under "Nearby:" loads in place, with no navigation: it becomes the place on the
  /// top bar, a chosen one now (no approximate line), and the page answers for it on the same
  /// view. (The fixture's server answers every place with the same fixture.)
  @MainActor
  func testNearbyLoadsInPlace() throws {
    let aberdeen = try HomeScreen.named("aberdeen-snow")
    let nearby = try HomeScreen.named("aberdeen-snow-nearby")
    let place = try XCTUnwrap(nearby.placeName)
    let app = try launch(aberdeen)
    expect(aberdeen.topBar, in: app)
    let button = app.buttons[place]
    var swipes = 0
    while !button.isHittable && swipes < 10 {
      app.find("page-\(aberdeen.defaultView)").swipeUp()
      swipes += 1
    }
    guard button.isHittable else { throw HomeScreenError("No \(place) under Nearby") }
    button.tap()
    let shown = try nearby.page(aberdeen.defaultView)
    try awaitHeading(shown.heading, in: app)
    expect(shown, in: app)
    expect(nearby.topBar, in: app)
    try tap(try nearby.page("now"), in: app)
    expect(try nearby.page("now"), in: app)
  }

  /// A place under "Nearby:" chosen on This week, not the view the app opened on, answers there:
  /// the view stays where the user put it while the new place loads (as on the website, the app
  /// opens on the view for the time of day only once).
  @MainActor
  func testNearbyLoadsInPlaceOnThisWeek() throws {
    let aberdeen = try HomeScreen.named("aberdeen-snow")
    let nearby = try HomeScreen.named("aberdeen-snow-nearby")
    let place = try XCTUnwrap(nearby.placeName)
    let week = try aberdeen.page("week")
    XCTAssertNotEqual(aberdeen.defaultView, week.view, "The app opens on This week")
    let app = try launch(aberdeen)
    try tap(week, in: app)
    let button = app.buttons[place]
    var swipes = 0
    while !button.isHittable && swipes < 10 {
      app.find("page-week").swipeUp()
      swipes += 1
    }
    guard button.isHittable else { throw HomeScreenError("No \(place) under Nearby") }
    button.tap()
    let shown = try nearby.page("week")
    try awaitHeading(shown.heading, in: app)
    expect(shown, in: app)
    expect(nearby.topBar, in: app)
    XCTAssertTrue(app.buttons[shown.label].isSelected, "The view moved from This week")
  }

  /// Opens `name` on its fixture at its moment, and reads every page: the one it opens on, then
  /// each by its tab in turn, then back by swiping, page by page, both ways.
  @MainActor
  private func everyPage(_ name: String) throws {
    let screen = try HomeScreen.named(name)
    let app = try launch(screen)
    expect(screen.topBar, in: app)
    expectFits(app, name)
    try tabs(screen, in: app)
    let opening = try screen.opening()
    expect(opening, in: app)
    XCTAssertTrue(app.buttons[opening.label].isSelected, "The app didn't open on \(opening.label)")
    // By the switcher.
    for page in screen.pages {
      try tap(page, in: app)
      expect(page, in: app)
    }
    // By swiping: from This week back to Now, then on to This week again.
    let pages = screen.pages
    for index in stride(from: pages.count - 1, to: 0, by: -1) {
      try swipe(from: pages[index], to: pages[index - 1], in: app, left: false)
      expect(pages[index - 1], in: app)
    }
    for index in 0..<(pages.count - 1) {
      try swipe(from: pages[index], to: pages[index + 1], in: app, left: true)
      expect(pages[index + 1], in: app)
    }
  }

  /// The switcher shows every page's tab, labelled as the page labels itself.
  @MainActor
  private func tabs(_ screen: HomeScreen, in app: XCUIApplication) throws {
    for page in screen.pages {
      XCTAssertTrue(app.buttons[page.label].waitForExistence(timeout: 10), "No \(page.label) tab")
    }
  }
}
