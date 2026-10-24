import XCTest

/// What each home screen the UI tests open shows, as the TypeScript reference words it:
/// `Generated/HomeScreens.json`, which `pnpm mobile:generate` writes from page.json (packages/mobile
/// `homePage` and `homeTopBar`, the references IsItLogic's `HomePage` and `HomeTopBar` are held
/// to on Linux). So no UI test types what a page says: each reads the question, the answer, the
/// verdict and every row's label from here, and compares what VoiceOver would hear.
struct HomeScreen: Decodable {
  struct TopBar: Decodable {
    let place: String
    let placeLabel: String
    let approximate: String?
    let useMyLocation: String?
    let settings: String
  }

  struct Page: Decodable {
    let view: String
    let state: String
    let tomorrow: Bool
    /// The view's tab: "Now", "Today" or "Tomorrow", "This week".
    let label: String
    let question: String
    let answer: String
    /// The question and the answer, one heading with the place, as VoiceOver reads it.
    let heading: String
    let verdict: String?
    let detail: String?
    let day: Day?
    let hours: Hours?
    let week: Week?
    let retry: String?
    let footer: Footer?
  }

  struct Day: Decodable {
    let heading: String
    let summary: String
    let limited: String?
    let lines: [Line]
  }

  struct Line: Decodable {
    let text: String
    let name: String
    let value: String
  }

  struct Hours: Decodable {
    let heading: String
    let rows: [Row]
  }

  struct Week: Decodable {
    let rows: [Row]
  }

  /// A row of Now or the week: what VoiceOver reads for it.
  struct Row: Decodable {
    let spoken: String
  }

  struct Footer: Decodable {
    let updated: String?
    let notice: String?
  }

  let name: String
  let fixture: String?
  /// ISO 8601 UTC, as `-now` takes it.
  let now: String
  let phase: String
  let placeName: String?
  /// The view the app opens on at `now`: "today", or "now" from 6pm.
  let defaultView: String
  let topBar: TopBar
  /// Now, the middle view and This week, in the switcher's order.
  let pages: [Page]

  /// The page for `view` ("now", "today" or "week").
  func page(_ view: String) throws -> Page {
    guard let page = pages.first(where: { $0.view == view }) else {
      throw HomeScreenError("\(name) has no \(view) page")
    }
    return page
  }

  /// The page the app opens on.
  func opening() throws -> Page {
    try page(defaultView)
  }

  /// The screen named `name` in `HomeScreens.json`.
  static func named(_ name: String) throws -> HomeScreen {
    guard let screen = try all().first(where: { $0.name == name }) else {
      throw HomeScreenError("HomeScreens.json has no screen \(name)")
    }
    return screen
  }

  /// Every screen, from the UI test bundle.
  private static func all() throws -> [HomeScreen] {
    struct File: Decodable {
      let screens: [HomeScreen]
    }
    guard
      let url = Bundle(for: BundleToken.self).url(
        forResource: "HomeScreens",
        withExtension: "json"
      )
    else { throw HomeScreenError("The UI tests have no HomeScreens.json") }
    return try JSONDecoder().decode(File.self, from: Data(contentsOf: url)).screens
  }
}

/// A screen that never appeared, or a file that isn't there: the test stops, with why.
struct HomeScreenError: Error, CustomStringConvertible {
  let description: String

  init(_ description: String) {
    self.description = description
  }
}

private final class BundleToken {}

/// The text sizes the screens are read and audited at: Large, the default, and AX3, an
/// accessibility size, given to the app as UIKit's preferred content size category, whose raw
/// values abbreviate the sizes: AX1 to AX5 are `…AccessibilityM`, `L`, `XL`, `XXL` and `XXXL`, so
/// AX3, `UIContentSizeCategory.accessibilityExtraLarge`, is `…AccessibilityXL`.
enum TextSize: String {
  case large = "UICTContentSizeCategoryL"
  case ax3 = "UICTContentSizeCategoryAccessibilityXL"

  /// The launch arguments that set it, through the arguments' defaults domain.
  var arguments: [String] { ["-UIPreferredContentSizeCategoryName", rawValue] }
}

extension XCUIApplication {
  /// The element with `identifier`, whatever type XCUITest gives it.
  func find(_ identifier: String) -> XCUIElement {
    descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  /// The question and the answer: one heading element.
  var heading: XCUIElement { find("heading") }
}

extension XCTestCase {
  /// Launches the app with `-uitest` and `arguments`, and waits for the heading.
  @MainActor
  func launchApp(_ arguments: [String]) throws -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-uitest"] + arguments
    app.launch()
    guard app.heading.waitForExistence(timeout: 20) else {
      throw HomeScreenError("No heading on screen after launching with \(arguments)")
    }
    return app
  }

  /// Launches the app on `screen`'s fixture at its moment, from a clean store (`-resetStore`),
  /// the clock fixed there unless `clock` is "run", at `size`; and waits for the page it opens
  /// on.
  @MainActor
  func launch(
    _ screen: HomeScreen,
    clock: String = "fixed",
    size: TextSize = .large
  ) throws -> XCUIApplication {
    guard let fixture = screen.fixture else {
      throw HomeScreenError("\(screen.name) has no fixture to launch on")
    }
    let app = try launchApp(
      ["-resetStore", "-fixture", fixture, "-now", screen.now, "-clock", clock] + size.arguments)
    try awaitHeading(try screen.opening().heading, in: app)
    return app
  }

  /// Waits up to `timeout` seconds for the heading to read `label`; throws, stopping the test,
  /// when it doesn't.
  @MainActor
  func awaitHeading(
    _ label: String,
    in app: XCUIApplication,
    timeout: TimeInterval = 20
  ) throws {
    let heading = app.heading
    let reads = NSPredicate(format: "label == %@", label)
    let waited = XCTNSPredicateExpectation(predicate: reads, object: heading)
    guard XCTWaiter().wait(for: [waited], timeout: timeout) == .completed else {
      let shown = heading.exists ? heading.label : "no heading"
      throw HomeScreenError("The heading never read \"\(label)\"; it reads \"\(shown)\"")
    }
  }

  /// Taps `page`'s tab in the switcher (a segment, or at accessibility sizes a button, either
  /// labelled as the tab reads), waits for its heading, and checks the tab is the one selected.
  @MainActor
  func tap(_ page: HomeScreen.Page, in app: XCUIApplication) throws {
    let tab = app.buttons[page.label]
    guard tab.waitForExistence(timeout: 10) else {
      throw HomeScreenError("No \(page.label) tab")
    }
    tab.tap()
    try awaitHeading(page.heading, in: app)
    XCTAssertTrue(tab.isSelected, "The \(page.label) tab isn't selected")
  }

  /// Scrolls `page`, the page on screen (`page-<view>`), down by four fifths of its height, so
  /// each screenful shows the last fifth of the one before: a slow drag that holds still before
  /// it lifts, so the page doesn't fling on past what the next screenful shows.
  @MainActor
  func scrollDown(_ page: HomeScreen.Page, in app: XCUIApplication) {
    let shown = app.find("page-\(page.view)")
    let from = shown.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9))
    let to = shown.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1))
    from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.3)
  }

  /// Swipes the pages from `from` (the page on screen) towards `to`, the page beside it, and
  /// waits for its heading.
  @MainActor
  func swipe(
    from: HomeScreen.Page,
    to page: HomeScreen.Page,
    in app: XCUIApplication,
    left: Bool
  ) throws {
    let shown = app.find("page-\(from.view)")
    guard shown.exists else { throw HomeScreenError("No page-\(from.view) on screen") }
    if left { shown.swipeLeft() } else { shown.swipeRight() }
    try awaitHeading(page.heading, in: app)
    XCTAssertTrue(app.buttons[page.label].isSelected, "The \(page.label) tab isn't selected")
  }

  /// Checks that the page on screen says what `page` says: the heading (the question and the
  /// answer, with the place), the verdict and the detail; the middle page's agreement, strip,
  /// model list and limited line; Now's next hours and the week's days, each row as VoiceOver
  /// reads it; the footer's Updated and offline, unavailable or stale line; and Retry. What
  /// `page` hasn't is checked not to be there. Read from one snapshot of the screen
  /// (`ShownScreen`), so the many checks don't each ask the app.
  @MainActor
  func expect(
    _ page: HomeScreen.Page,
    in app: XCUIApplication,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    guard let shown = ShownScreen(app, file: file, line: line) else { return }
    let at = "\(page.view) page"
    shown.check("heading", reads: page.heading, "\(at): heading", file, line)
    XCTAssertTrue(
      page.heading.hasSuffix("\(page.question) \(page.answer)"),
      "\(at): the heading doesn't end with the question and the answer",
      file: file, line: line)
    let texts: [(String, String?)] = [
      ("verdict", page.verdict), ("detail", page.detail),
      ("agreement", page.day?.heading), ("strip", page.day?.summary),
      ("limited", page.day?.limited), ("hours-heading", page.hours?.heading),
      ("updated", page.footer?.updated), ("notice", page.footer?.notice),
      ("retry", page.retry),
    ]
    for (identifier, expected) in texts {
      shown.check(identifier, reads: expected, "\(at): \(identifier)", file, line)
    }
    let lines = page.day?.lines ?? []
    for (index, model) in lines.enumerated() {
      let id = "model-\(index)"
      shown.check(id, reads: model.name, "\(at): model \(index)", file, line)
      if let row = shown.first(id) {
        XCTAssertEqual(
          row.value as? String, model.value, "\(at): model \(index)'s amount",
          file: file, line: line)
      }
    }
    shown.check("model-\(lines.count)", reads: nil, "\(at): one model more", file, line)
    for (prefix, rows) in [("hour", page.hours?.rows ?? []), ("day", page.week?.rows ?? [])] {
      for (index, row) in rows.enumerated() {
        shown.check(
          "\(prefix)-\(index)", reads: row.spoken, "\(at): \(prefix) \(index)", file, line)
      }
      shown.check("\(prefix)-\(rows.count)", reads: nil, "\(at): one \(prefix) more", file, line)
    }
  }

  /// Checks the top bar: the place button's label, the approximate line or the notice in its
  /// place, "Use my location", and the Settings button's label.
  @MainActor
  func expect(
    _ topBar: HomeScreen.TopBar,
    in app: XCUIApplication,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    guard let shown = ShownScreen(app, file: file, line: line) else { return }
    shown.check("place", reads: topBar.placeLabel, "the place button", file, line)
    shown.check("approximate", reads: topBar.approximate, "the approximate line", file, line)
    shown.check("use-my-location", reads: topBar.useMyLocation, "Use my location", file, line)
    shown.check("settings", reads: topBar.settings, "the Settings button", file, line)
  }

  /// Attaches the screen to the result bundle as a PNG, kept, named for the contact sheet, which
  /// tiles attachments in their names' order.
  @MainActor
  func attach(_ app: XCUIApplication, as name: String) {
    let png = app.screenshot().pngRepresentation
    let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}

/// The screen as the accessibility tree has it at one moment: every element with an identifier,
/// from one snapshot of the app (only the page on screen is in the tree).
@MainActor
struct ShownScreen {
  private let elements: [String: [any XCUIElementSnapshot]]

  /// The screen now; nil, with a failure, when the app can't be read.
  init?(_ app: XCUIApplication, file: StaticString, line: UInt) {
    let root: any XCUIElementSnapshot
    do {
      root = try app.snapshot()
    } catch {
      XCTFail("The screen can't be read: \(error)", file: file, line: line)
      return nil
    }
    var found: [String: [any XCUIElementSnapshot]] = [:]
    var pending = [root]
    while let element = pending.popLast() {
      if !element.identifier.isEmpty { found[element.identifier, default: []].append(element) }
      pending.append(contentsOf: element.children)
    }
    elements = found
  }

  /// The element with `identifier`, if it is on screen.
  func first(_ identifier: String) -> (any XCUIElementSnapshot)? {
    elements[identifier]?.first
  }

  /// Checks the element with `identifier` is there once and reads `expected`, or isn't there
  /// when `expected` is nil.
  func check(
    _ identifier: String,
    reads expected: String?,
    _ what: String,
    _ file: StaticString,
    _ line: UInt
  ) {
    let matches = elements[identifier] ?? []
    guard let expected else {
      XCTAssertTrue(
        matches.isEmpty, "\(what): on screen, and shouldn't be: \(matches.map(\.label))",
        file: file, line: line)
      return
    }
    XCTAssertEqual(
      matches.count, 1, "\(what): on screen \(matches.count) times", file: file, line: line)
    if let element = matches.first {
      XCTAssertEqual(element.label, expected, what, file: file, line: line)
    }
  }
}
