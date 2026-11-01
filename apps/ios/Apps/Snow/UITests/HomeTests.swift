import XCTest

/// The home screen (iOS build spec, sections 10.2, 16 and 17.2): each page of Now, Today
/// (Tomorrow from 6pm) and This week, reached by the switcher and by swiping, for
/// aberdeen-snow, durham-tomorrow and leeds-dry; the view it opens on either side of 6pm; the
/// middle tab turning to Tomorrow at 6pm while the app is open; a place under "Nearby:" loading
/// in place; and the Debug count of touches the system cancels seeing one, which the UI tests'
/// re-taps rest on. Every launch is on a fixture (`-fixture`, never the network), from a clean
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
  /// Today and This week; Now at 6pm, the middle tab Tomorrow. And the pages are on it
  /// (`expectFits`), which the page's words can't show: the tree holds the chosen view's page
  /// wherever the pages are.
  @MainActor
  func testDefaultViewEitherSideOf6pm() throws {
    let before = try HomeScreen.named("durham-before-6pm")
    XCTAssertEqual(before.defaultView, "today")
    let early = try launch(before)
    try tabs(before, in: early)
    expectFits(early, before.name)
    expect(try before.opening(), in: early)
    early.terminate()

    let after = try HomeScreen.named("durham-at-6pm")
    XCTAssertEqual(after.defaultView, "now")
    let late = try launch(after)
    try tabs(after, in: late)
    expectFits(late, after.name)
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
  /// top bar, a chosen one now (no "Use my exact location" chip), and the page answers for it on
  /// the same view. (The fixture's server answers every place with the same fixture.)
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
    guard button.isHittable else {
      throw HomeScreenError("No \(place) under Nearby; \(app.cancelsReport)")
    }
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
  /// opens on the view for the time of day only once). The place's element is its words' band
  /// of its line, shorter than the 44 points a tap takes (IsItUI's `WordsButton`), and the tap is
  /// on the line outside that band, so the whole line is still the button. Dundee, about 61
  /// points wide at Large, has a band: words narrower than 44 keep the whole line.
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
    guard button.isHittable else {
      throw HomeScreenError("No \(place) under Nearby; \(app.cancelsReport)")
    }
    let element = button.frame
    XCTAssertLessThan(element.height, 44, "\(place)'s element at \(element) isn't its words")
    tapOutsideItsWords(button)
    let shown = try nearby.page("week")
    try awaitHeading(shown.heading, in: app)
    expect(shown, in: app)
    expect(nearby.topBar, in: app)
    XCTAssertTrue(app.buttons[shown.label].isSelected, "The view moved from This week")
  }

  /// `debug-cancels` counts a touch the system takes from the app, and the cancels' helper
  /// (`cancelled(_:in:within:until:_:)`) sees the count rise: the positive control for the
  /// re-taps and the drags played again on a cancelled touch, whose branches otherwise run only
  /// when the simulator cancels a gesture. Each gesture goes through the helper, as every watched
  /// gesture does: a drag up from the home indicator, which the go-home gesture takes, cancelling
  /// the touch that began in the app; should the helper not see the count rise, a drag down from
  /// the top right corner, which Control Centre takes. Within each, the home button then puts
  /// away whatever the drag brought, Control Centre or the home screen, and the app is brought
  /// back to the foreground before the helper reads the count, so the test leaves nothing over
  /// the next. The helper's `gesture-cancelled` names the gesture that raised the count. Neither
  /// raising it fails: the re-tap rule rests on the count and the helper seeing the system's
  /// cancels, and this is their only proof that they can.
  @MainActor
  func testASystemGestureCountsACancelledTouch() throws {
    let app = try launch(try HomeScreen.named("aberdeen-snow"))
    let gestures: [(name: String, from: CGVector, to: CGVector)] = [
      (
        "a drag up from the home indicator", CGVector(dx: 0.5, dy: 0.995),
        CGVector(dx: 0.5, dy: 0.4)
      ),
      (
        "a drag down from the top right corner", CGVector(dx: 0.9, dy: 0),
        CGVector(dx: 0.9, dy: 0.5)
      ),
    ]
    var counts: [String] = []
    for gesture in gestures {
      let before = try XCTUnwrap(
        app.touchesCancelled, "No debug-cancels readout before \(gesture.name)")
      var back = false
      let rose = cancelled(gesture.name, in: app, within: 5) {
        app.coordinate(withNormalizedOffset: gesture.from)
          .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: gesture.to))
        XCUIDevice.shared.press(.home)
        app.activate()
        back = app.wait(for: .runningForeground, timeout: 10)
      }
      guard back else {
        throw HomeScreenError(
          "The app didn't come back to the foreground after \(gesture.name) (state "
            + "\(app.state.rawValue))")
      }
      if rose { return }
      counts.append("\(gesture.name): debug-cancels \(before) before, then \(app.cancelsReport)")
    }
    XCTFail(
      "The cancels' helper saw debug-cancels count no touch the system took from the app ("
        + counts.joined(separator: "; ")
        + "): the re-tap rule (a tap the simulator cancelled tapped once more, a cancelled drag "
        + "played again) can't be relied on, as the count may miss the simulator's cancels too")
  }

  /// Opens `name` on its fixture at its moment, and reads every page: the one it opens on, then
  /// each by its tab in turn, then back by swiping, page by page, both ways.
  @MainActor
  private func everyPage(_ name: String) throws {
    let screen = try HomeScreen.named(name)
    let app = try launch(screen)
    expect(screen.topBar, in: app)
    expectPlaceOnOneLine(app, name)
    expectFits(app, name)
    expectNoBareElements(app, name)
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

  /// At the standard text size the place pill holds the name on one line, as the website's does:
  /// 36 points tall on one line (Leeds, 90.7 by 36, on PR #34's last macOS run), and 44 once the
  /// name wrapped (Aberdeen, 119 by 44, broken inside the word, "Aberdee" over "n", and again on
  /// PR #35's first run, a fraction of a point short of its words: `OneLineWhenItFits`).
  @MainActor
  private func expectPlaceOnOneLine(_ app: XCUIApplication, _ name: String) {
    let place = app.buttons["place"]
    XCTAssertTrue(place.waitForExistence(timeout: 10), "\(name): no place pill")
    XCTAssertLessThan(
      place.frame.height, 44,
      "\(name): the place pill at \(place.frame) has wrapped onto a second line")
  }

  /// The switcher shows every page's tab, labelled as the page labels itself.
  @MainActor
  private func tabs(_ screen: HomeScreen, in app: XCUIApplication) throws {
    for page in screen.pages {
      XCTAssertTrue(app.buttons[page.label].waitForExistence(timeout: 10), "No \(page.label) tab")
    }
  }
}
