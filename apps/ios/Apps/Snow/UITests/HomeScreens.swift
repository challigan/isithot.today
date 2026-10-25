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
    /// The band shown ("nosnow", "snow"…), whose palette the page is drawn in; nil without an
    /// answer, when the page draws as no snow.
    let band: String?
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
    guard let screen = try file().screens.first(where: { $0.name == name }) else {
      throw HomeScreenError("HomeScreens.json has no screen \(name)")
    }
    return screen
  }

  /// The colours `page` is drawn in: its band's palette, or no snow's for a page with no band, as
  /// the app draws it (packages/mobile `UNKNOWN_BAND_DRAWS_AS`).
  static func palette(of page: Page) throws -> HomePalette {
    let band = page.band ?? "nosnow"
    guard let palette = try file().palettes[band] else {
      throw HomeScreenError("HomeScreens.json has no palette for \(band)")
    }
    return palette
  }

  /// The file: every band's palette, and every screen.
  private struct File: Decodable {
    let palettes: [String: HomePalette]
    let screens: [HomeScreen]
  }

  /// The file, from the UI test bundle.
  private static func file() throws -> File {
    guard
      let url = Bundle(for: BundleToken.self).url(
        forResource: "HomeScreens",
        withExtension: "json"
      )
    else { throw HomeScreenError("The UI tests have no HomeScreens.json") }
    return try JSONDecoder().decode(File.self, from: Data(contentsOf: url))
  }
}

/// A band's colours as a page draws them (IsItUI's `PageBackground`, core `SNOW_PALETTES`): the
/// gradient from `g1` to `g2`, the glow of `g3` at `glow` opacity (0 to 1) at its centre, and the
/// text in `ink`, each `#rrggbb`. What the home audit's contrast failures set the screen's pixels
/// beside (`PageColours`).
struct HomePalette: Decodable {
  let g1: String
  let g2: String
  let g3: String
  let glow: Double
  let ink: String
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

  /// The top bar's controls and the switcher, which don't scroll, by identifier.
  static let homeBar = ["place", "settings", "approximate", "use-my-location", "views"]

  /// Where the home screen's parts are, from one snapshot of the app: the window, then the top
  /// bar's controls, the switcher, the pager (HomePager's horizontal scroll view) and the page on
  /// screen (`page-<view>`), each with its frame or "no <identifier>", for a failure to say where
  /// things were when a tap opened nothing or a page didn't fit.
  var homeGeometry: String {
    guard let root = try? snapshot() else { return "the screen can't be read" }
    let frames = Self.homeFrames(in: root)
    let parts = Self.homeBar + ["pager"] + frames.keys.filter { $0.hasPrefix("page-") }.sorted()
    let found = parts.map { id in frames[id].map { "\(id) at \($0)" } ?? "no \(id)" }
    return "the window at \(root.frame); " + found.joined(separator: ", ")
  }

  /// The frame of the first element with each of the top bar's and switcher's identifiers, the
  /// pager's, and each page's in the tree, under `root`.
  static func homeFrames(in root: any XCUIElementSnapshot) -> [String: CGRect] {
    var frames: [String: CGRect] = [:]
    var pending = [root]
    while let element = pending.popLast() {
      let id = element.identifier
      if frames[id] == nil, homeBar.contains(id) || id == "pager" || id.hasPrefix("page-") {
        frames[id] = element.frame
      }
      pending.append(contentsOf: element.children)
    }
    return frames
  }

  /// The part of the screen a page shows through: the window below the switcher. A page's
  /// scroll view shows nothing above it, whatever frame XCUITest gives the scroll view.
  var pageWindow: CGRect {
    let window = frame
    let top = min(max(find("views").frame.maxY, window.minY), window.maxY)
    return CGRect(x: window.minX, y: top, width: window.width, height: window.maxY - top)
  }
}

/// A drag that scrolled a page: where it started and ended on screen, and whether it was putting
/// the page back where an audit had moved it from (`HomeAuditTests.restore`).
struct Drag: CustomStringConvertible {
  let from: CGPoint
  let to: CGPoint
  var restoring = false

  var description: String {
    "(\(from.x), \(from.y)) to (\(to.x), \(to.y))" + (restoring ? " putting the page back" : "")
  }
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

  /// Where `page`, the page on screen (`page-<view>`), is on screen: the part of its frame a user
  /// can see, within the window and below the switcher (`shown(_:in:)`).
  @MainActor
  func onScreen(_ page: HomeScreen.Page, in app: XCUIApplication) -> CGRect {
    shown(app.find("page-\(page.view)").frame, in: app)
  }

  /// The part of a page's `frame` a user can see: within the window, and below the switcher
  /// (`pageWindow`). Not the frame within the window alone: on main's first macOS run, once a
  /// page had scrolled, the audit judged the answer and the verdict whole on screen when they
  /// were under the switcher, so the frame XCUITest gave the page's scroll view most likely moved
  /// with its content, taking in the top bar and the switcher above it. The page's elements were
  /// then judged where a user can't see them, and each scroll brought the next element up under
  /// the top bar. Should the frame be the scroll view's fixed viewport, below the switcher, this
  /// changes nothing.
  @MainActor
  func shown(_ frame: CGRect, in app: XCUIApplication) -> CGRect {
    frame.intersection(app.pageWindow)
  }

  /// Scrolls `page`, the page on screen, down by `distance` points: a drag up the page by that
  /// much, from no lower than 90% of the way down the part of it on screen and 80 points above
  /// the screen's bottom edge (the home indicator's), held still before it lifts so the page
  /// doesn't fling on. The drag is in the page's left margin, 10 points in (the pages have 20 of
  /// padding), where no button, link or row is, so the page's scroll view always takes it.
  /// (Phase 5.4's drag, from 90% of the page's frame down its middle, never moved a page past
  /// its first scroll on PR #31's macOS run, and at AX3 the audit after it found no app to
  /// audit.) Gives the drag, for a failure to say.
  @MainActor
  @discardableResult
  func scrollDown(
    _ page: HomeScreen.Page,
    by distance: CGFloat,
    in app: XCUIApplication
  ) -> Drag {
    let shown = onScreen(page, in: app)
    let screen = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let x = shown.minX + 10
    let start = min(shown.minY + shown.height * 0.1 + distance, app.frame.maxY - 80)
    let from = screen.withOffset(CGVector(dx: x, dy: start))
    let to = screen.withOffset(CGVector(dx: x, dy: start - distance))
    from.press(forDuration: 0.01, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.3)
    return Drag(from: CGPoint(x: x, y: start), to: CGPoint(x: x, y: start - distance))
  }

  /// Checks the home screen fits the screen, as it is at launch, before any page has scrolled:
  /// the top bar's place button and gear, and the switcher, each lie within the window; the
  /// pager (HomePager's horizontal scroll view, which never scrolls vertically) runs from under
  /// the switcher to no lower than the window's bottom edge; and the page on screen starts under
  /// the switcher, within the window. On main's first macOS run the home screen didn't fit: each
  /// of the pager's pages was the height of the screen's safe area, so the home screen was taller
  /// than the screen by the top bar and the switcher, and the window centred it. The place button
  /// and the gear were under the status bar, where taps never reached them, and the pager, every
  /// page with it, ran past the screen's bottom edge, the page's end never on screen.
  ///
  /// Only the page's top is checked against its frame, which may be its content's (the page's
  /// scroll view's, `shown(_:in:)`): from its top, a frame that is the content's runs below the
  /// screen however well the page fits. A page's end is HomeAuditTests' to check, its credits
  /// coming into view.
  ///
  /// It doesn't prove the place button and the gear are below the status bar, whose frame
  /// XCUITest doesn't give. On the iPhone 17, a home screen about 50 to 70 points too tall would
  /// put their centres, where a tap lands, under the status bar, with them and the pager still
  /// within the window (should the pager end at the safe area's bottom edge, 34 points above the
  /// window's). PickerTests' and SettingsTests' taps on them are the real guard, and their
  /// failures give the same geometry (`homeGeometry`).
  @MainActor
  func expectFits(
    _ app: XCUIApplication,
    _ what: String,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    let root: any XCUIElementSnapshot
    do {
      root = try app.snapshot()
    } catch {
      XCTFail("\(what): the screen can't be read: \(error)", file: file, line: line)
      return
    }
    let window = root.frame
    let frames = XCUIApplication.homeFrames(in: root)
    let doesntFit = "so the home screen doesn't fit the screen; \(app.homeGeometry)"
    for id in ["place", "settings", "views"] {
      guard let frame = frames[id] else {
        XCTFail("\(what): no \(id) on screen; \(app.homeGeometry)", file: file, line: line)
        continue
      }
      XCTAssertTrue(
        window.insetBy(dx: -0.5, dy: -0.5).contains(frame),
        "\(what): \(id) at \(frame) isn't within the window at \(window), \(doesntFit)",
        file: file, line: line)
    }
    guard let views = frames["views"] else { return }
    // Half a point either way, as a frame read on a 3x screen may round.
    let under = views.maxY - 0.5
    if let pager = frames["pager"] {
      XCTAssertTrue(
        pager.minY >= under && pager.maxY <= window.maxY + 0.5,
        "\(what): the pager at \(pager) isn't between the switcher's bottom edge at "
          + "\(views.maxY) and the window's at \(window.maxY), \(doesntFit)",
        file: file, line: line)
    } else {
      XCTFail("\(what): no pager on screen; \(app.homeGeometry)", file: file, line: line)
    }
    let pages = frames.keys.filter { $0.hasPrefix("page-") }.sorted()
    XCTAssertFalse(pages.isEmpty, "\(what): no page on screen", file: file, line: line)
    for id in pages {
      guard let page = frames[id] else { continue }
      XCTAssertTrue(
        page.minY >= under && page.minY < window.maxY,
        "\(what): \(id) at \(page) doesn't start between the switcher's bottom edge at "
          + "\(views.maxY) and the window's at \(window.maxY), \(doesntFit)",
        file: file, line: line)
    }
  }

  /// Checks the app has no bare element: a leaf of the accessibility tree of type `other` with
  /// neither an identifier nor a label, under no element with a label (a row's bar or dots are
  /// under their row's). On PR #33's two macOS runs one such, the window's size, failed the
  /// audit's `sufficientElementDescription` on every screenful of every page: the page's
  /// background, made an element by its own accessibility modifiers (Backgrounds.swift). Read from
  /// one snapshot, outside the audit, and failing with each one's place from its window, every
  /// element on the way with its index among its parent's children, and the app's element tree
  /// attached (`<what>-bare-tree`, `what` as a slug), so a run says where any is at once.
  @MainActor
  func expectNoBareElements(
    _ app: XCUIApplication,
    _ what: String,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    let root: any XCUIElementSnapshot
    do {
      root = try app.snapshot()
    } catch {
      XCTFail("\(what): the screen can't be read: \(error)", file: file, line: line)
      return
    }
    let bare = bareElements(under: root)
    guard !bare.isEmpty else { return }
    attachText(app.debugDescription, as: "\(slug(what))-bare-tree")
    XCTFail(
      "\(what): \(bare.count) elements with neither an identifier nor a label, under none with a "
        + "label:\n" + bare.joined(separator: "\n"), file: file, line: line)
  }

  /// `expectNoBareElements`' finding: each bare leaf under `root`'s windows, as its path.
  @MainActor
  func bareElements(under root: any XCUIElementSnapshot) -> [String] {
    func named(_ node: any XCUIElementSnapshot, _ index: Int, of count: Int) -> String {
      "\(node.elementType.name) \"\(node.identifier)\" at \(node.frame), #\(index + 1) of \(count)"
    }
    var bare: [String] = []
    var pending: [(node: any XCUIElementSnapshot, path: [String], labelled: Bool)] =
      root.children.enumerated().map { index, window in
        (window, [named(window, index, of: root.children.count)], !window.label.isEmpty)
      }
    while let (node, path, labelled) = pending.popLast() {
      if node.children.isEmpty {
        if node.elementType == .other, node.identifier.isEmpty, node.label.isEmpty, !labelled {
          bare.append(path.joined(separator: " > "))
        }
        continue
      }
      for (index, child) in node.children.enumerated() {
        pending.append(
          (
            child, path + [named(child, index, of: node.children.count)],
            labelled || !child.label.isEmpty
          ))
      }
    }
    return bare
  }

  /// `element`'s frame once it has stopped moving: read until two readings a quarter of a second
  /// apart agree, for up to three seconds, so a page pulled past its end has sprung back.
  @MainActor
  func settledFrame(of element: XCUIElement) -> CGRect {
    var last = element.frame
    for _ in 0..<12 {
      RunLoop.current.run(until: Date().addingTimeInterval(0.25))
      let now = element.frame
      if now == last { return now }
      last = now
    }
    return last
  }

  /// Taps `button`, a `WordsButton` (IsItUI), above its words: halfway between the top of its
  /// element, the words' band, and the top of the 44-point line it is centred in, which a tap
  /// takes. A button whose element is the whole line or more is tapped halfway up its top half.
  /// Waits up to 10 seconds for it, as a tap on it would.
  @MainActor
  func tapOutsideItsWords(_ button: XCUIElement) {
    XCTAssertTrue(button.waitForExistence(timeout: 10), "No \(button) to tap")
    button.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
      .withOffset(CGVector(dx: 0, dy: -aboveTheWords(button.frame.height)))
      .tap()
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
  /// tiles attachments in their names' order; and gives the screenshot, whose pixels a contrast
  /// failure reads (`PixelRange`).
  @MainActor
  @discardableResult
  func attach(_ app: XCUIApplication, as name: String) -> XCUIScreenshot {
    let shot = app.screenshot()
    let attachment = XCTAttachment(
      data: shot.pngRepresentation, uniformTypeIdentifier: "public.png")
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
    return shot
  }
}

/// How far above its centre `tapOutsideItsWords` taps a button whose element is `height` tall:
/// halfway from the element's top to the top of the 44-point line, or for an element as tall or
/// taller, halfway up its top half.
func aboveTheWords(_ height: CGFloat) -> CGFloat {
  let half = height / 2
  return half < 22 ? (half + 22) / 2 : half / 2
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
