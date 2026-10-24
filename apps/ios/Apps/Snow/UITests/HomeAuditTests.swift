import XCTest

/// The home screen's accessibility audits and its screens for the contact sheet (iOS build spec,
/// sections 16, 17.2 and phase 5's exit): spec 17.2's `AccessibilityAuditTests` for the home
/// screen; the later phases audit their own screens. Every page (Now, Today or Tomorrow, This
/// week) of aberdeen-snow, durham-tomorrow and leeds-dry, at Large (the default text size) and
/// at AX3 (an accessibility size, set through UIKit's preferred content size category), each on
/// its fixture at its own moment with the clock fixed: XCUITest's
/// `performAccessibilityAudit()` (iOS 17) for every kind of issue on each screenful of the page,
/// from its top down to the credits at its end, since an audit can judge only what the screen
/// shows; and each screenful attached.
///
/// The attachments are named so that the contact sheet, which tiles them in their names' order
/// (`ci/contact-sheet.mjs`), shows them fixture by fixture, Large then AX3, each page in the
/// switcher's order, top to bottom: `home-<fixture>-1-large-1-now-01`, `…-1-large-1-now-02`, …,
/// `…-1-large-2-today-01` (or `-2-tomorrow-01`), …, `…-1-large-3-this-week-01`, …, then
/// `home-<fixture>-2-ax3-1-now-01` and so on.
///
/// Every issue an audit finds fails the test, but for the exceptions in `exceptions`, each with
/// why it isn't a fault to fix in the app. An element of the page is judged on a screenful that
/// shows it whole (`AuditLog`).
final class HomeAuditTests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = true
  }

  @MainActor
  func testAberdeenSnowAtLarge() throws {
    try audit("aberdeen-snow", at: .large)
  }

  @MainActor
  func testAberdeenSnowAtAX3() throws {
    try audit("aberdeen-snow", at: .ax3)
  }

  @MainActor
  func testDurhamTomorrowAtLarge() throws {
    try audit("durham-tomorrow", at: .large)
  }

  @MainActor
  func testDurhamTomorrowAtAX3() throws {
    try audit("durham-tomorrow", at: .ax3)
  }

  @MainActor
  func testLeedsDryAtLarge() throws {
    try audit("leeds-dry", at: .large)
  }

  @MainActor
  func testLeedsDryAtAX3() throws {
    try audit("leeds-dry", at: .ax3)
  }

  /// An issue the audit raises that isn't a fault to fix in the app, and why: which kind, and
  /// how to know its element.
  struct Exception {
    let type: XCUIAccessibilityAuditType
    /// Whether an issue of `type` is this exception, from its element and the screen.
    let matches: (_ element: AuditedElement) -> Bool
    let why: String
  }

  /// The issues allowed, each matched as narrowly as its element allows, with its reason: the
  /// two phase 5.4 foresaw (DECISIONS, "The iPhone app's home accessibility and its UI tests").
  /// An exception that no audit of a test needed is printed at its end, so that one the app no
  /// longer needs can go.
  static let exceptions: [Exception] = [
    Exception(
      type: .dynamicType,
      matches: { element in
        // The segmented control, or one of its segments; never the buttons that stand for it
        // at accessibility sizes, `view-now` and so on, whose labels scale.
        !element.identifier.hasPrefix("view-")
          && (element.identifier == "views" || element.tabs.contains(element.label))
      },
      why:
        "the switcher at standard text sizes is the segmented picker section 10.2 asks for, "
        + "UIKit's control, which keeps its own type size; at accessibility sizes it is a row "
        + "of buttons whose labels scale (section 16)"
    ),
    Exception(
      type: .hitRegion,
      matches: { element in
        element.credits.contains(CGPoint(x: element.frame.midX, y: element.frame.midY))
      },
      why:
        "a link inside the credits' text, the attribution beside the data as the licence asks "
        + "(section 10.2), is as tall as its line, as WCAG 2.2's target size (2.5.8) allows a "
        + "target inside a sentence"
    ),
  ]

  /// The most screenfuls a page is audited in, top to bottom: a bound on a page that never ends,
  /// not on the app. At AX3 the longest page, the week's, is about 2,930 points tall (main's
  /// first macOS run), and once the home screen fits the screen about 420 of them are on screen
  /// under the top bar and the switcher's stacked buttons, so it takes ten screenfuls or more,
  /// each scroll at most four fifths of the page on screen.
  static let screenfuls = 20

  /// Opens `name` at `size`, checks the switcher is the one for that size, and for each page in
  /// the switcher's order shows it by its tab, checks its heading, and from its top to its end
  /// attaches and audits each screenful. Fails, once, listing every issue found on any page
  /// that isn't an exception.
  @MainActor
  private func audit(_ name: String, at size: TextSize) throws {
    let screen = try HomeScreen.named(name)
    let app = try launch(screen, size: size)
    let order: String
    switch size {
    case .large: order = "1-large"
    case .ax3: order = "2-ax3"
    }
    // At an accessibility size the switcher is a row of buttons (`view-now`…), and at Large the
    // segmented control: so the size reached the app.
    XCTAssertEqual(
      app.buttons["view-now"].exists, size == .ax3,
      "The switcher isn't the one for \(order): the text size didn't reach the app")
    // The top bar under the status bar, and every page's end below the screen, at both sizes on
    // main's first macOS run.
    expectFits(app, "\(name) at \(order)")
    let found = AuditLog(tabs: screen.pages.map(\.label))
    for (index, page) in screen.pages.enumerated() {
      try tap(page, in: app)
      XCTAssertEqual(app.heading.label, page.heading, "\(page.view) page at \(order)")
      let tab = page.label.lowercased().replacingOccurrences(of: " ", with: "-")
      try audit(page, as: "home-\(name)-\(order)-\(index + 1)-\(tab)", in: app, noting: found)
    }
    XCTAssertTrue(
      found.unexpected.isEmpty,
      "\(found.unexpected.count) accessibility issues on \(name) at \(order), in the window at "
        + "\(app.frame):\n" + found.unexpected.joined(separator: "\n"))
    for allowed in found.allowed {
      print("Allowed accessibility issue on \(name) at \(order): \(allowed)")
    }
    for (index, exception) in Self.exceptions.enumerated() where !found.used.contains(index) {
      print("Accessibility exception not needed on \(name) at \(order): \(exception.why)")
    }
  }

  /// Audits the page on screen a screenful at a time, from its top (where it is on its first
  /// showing) down to the end of the credits, its last lines, attaching each screenful as
  /// `<name>-<k>`, k from 01. An element of the page that a screenful cuts at the page's edge, or
  /// shows not at all, is judged on a screenful that shows it whole (`AuditLog.settle`). Fails,
  /// with where the page and its credits were, when the credits aren't there, the app has left
  /// the foreground, an audit can't run, the page stops scrolling before its end, or its end
  /// never comes into view; for the last two, with what `stopped` finds too.
  @MainActor
  private func audit(
    _ page: HomeScreen.Page,
    as name: String,
    in app: XCUIApplication,
    noting found: AuditLog
  ) throws {
    let credits = app.find("credits")
    guard credits.exists else {
      XCTFail("\(page.view) page: no credits at its end")
      return
    }
    var seen: [Screenful] = []
    var drags: [Drag] = []
    defer { found.settle(on: seen) }
    for number in 1...Self.screenfuls {
      let place = "\(page.view) page, screenful \(number)"
      // A drag that reached a system gesture would leave the audit nothing of the app's to read.
      guard app.state == .runningForeground else {
        XCTFail("\(place): the app isn't in the foreground (state \(app.state.rawValue))")
        return
      }
      attach(app, as: "\(name)-\(String(format: "%02d", number))")
      let whole = app.find("page-\(page.view)").frame
      let screenful = Screenful(page: shown(whole, in: app), frame: whole, credits: credits.frame)
      guard !screenful.page.isEmpty else {
        XCTFail("\(place): no page-\(page.view) on screen")
        return
      }
      seen.append(screenful)
      do {
        try app.performAccessibilityAudit(for: .all) { issue in
          found.note(issue, on: place, in: screenful)
          return true
        }
      } catch {
        XCTFail(
          "\(place): the audit didn't run (\(error)); the app's state is \(app.state.rawValue), "
            + Screenful.describe(seen))
        return
      }
      // The credits' end is on screen: the whole page has been audited.
      if screenful.credits.maxY <= screenful.page.maxY { return }
      drags.append(scrollDown(page, by: step(page, from: screenful, in: app), in: app))
      if settledFrame(of: credits) == screenful.credits {
        XCTFail(
          "\(page.view) page: it scrolls no further, but its end isn't on screen; "
            + Screenful.describe(seen) + "; "
            + stopped(page, as: name, in: app, credits: credits, drags: drags))
        return
      }
    }
    XCTFail(
      "\(page.view) page: its end never came into view in \(Self.screenfuls) screenfuls; "
        + Screenful.describe(seen) + "; "
        + stopped(page, as: name, in: app, credits: credits, drags: drags))
  }

  /// What a page that stopped short of its end shows, for its failure to say, beyond where the
  /// page and its credits were on each screenful: the page's whole frame, the part off screen
  /// too, and the window's; each drag; the page's lowest elements, by which the page's content
  /// reaches below its frame or not; and where the credits went on a swipe up by XCUITest's own
  /// gesture, which tells a page at the end of its scroll range from a drag the page didn't
  /// take. Attaches the app's element tree as `<name>-tree`. On main's first macOS run, every page
  /// at AX3 stopped 1,000 to 1,600 points short of its end, and the log couldn't say why.
  @MainActor
  private func stopped(
    _ page: HomeScreen.Page,
    as name: String,
    in app: XCUIApplication,
    credits: XCUIElement,
    drags: [Drag]
  ) -> String {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = "\(name)-tree"
    tree.lifetime = .keepAlways
    add(tree)
    let shown = app.find("page-\(page.view)")
    let frame = shown.frame
    var lowest = "can't be read"
    if let root = try? shown.snapshot() {
      var leaves: [any XCUIElementSnapshot] = []
      var pending = root.children
      while let element = pending.popLast() {
        if element.children.isEmpty {
          leaves.append(element)
        } else {
          pending.append(contentsOf: element.children)
        }
      }
      lowest = leaves.sorted { $0.frame.maxY > $1.frame.maxY }.prefix(4).map { leaf in
        let named = leaf.identifier.isEmpty ? String(leaf.label.prefix(40)) : leaf.identifier
        return "\"\(named)\" at \(leaf.frame)"
      }.joined(separator: ", ")
    }
    let before = credits.frame
    shown.swipeUp()
    let after = settledFrame(of: credits)
    return "the page's whole frame \(frame), in the window at \(app.frame); the drags "
      + drags.map(\.description).joined(separator: ", ")
      + "; the page's lowest elements \(lowest); a swipe up by XCUITest then moved the credits "
      + "from \(before) to \(after)"
  }

  /// How far to scroll the page from `screenful` for the next one: so the first of the page's
  /// elements that this one doesn't show whole, cut at the bottom edge or below it, comes to the
  /// top of the part on screen, 8 points under the switcher, and the next screenful shows it
  /// whole if it is no taller than the page on screen. From a quarter to four fifths of the page
  /// on screen, so the page always moves and the drag stays on it. An element is a leaf of the
  /// page's accessibility tree, read from one snapshot (a row, a heading, a place, a line of the
  /// credits).
  @MainActor
  private func step(
    _ page: HomeScreen.Page,
    from screenful: Screenful,
    in app: XCUIApplication
  ) -> CGFloat {
    let shown = screenful.page
    let least = shown.height * 0.25
    let most = shown.height * 0.8
    guard let root = try? app.find("page-\(page.view)").snapshot() else { return most }
    var pending = root.children
    var top: CGFloat?
    while let element = pending.popLast() {
      guard element.children.isEmpty else {
        pending.append(contentsOf: element.children)
        continue
      }
      let frame = element.frame
      if !frame.isEmpty, frame.maxY > shown.maxY + 1 {
        top = min(top ?? frame.minY, frame.minY)
      }
    }
    guard let top else { return most }
    return min(max(top - shown.minY - 8, least), most)
  }
}

/// A screenful as it was audited: where the page was on screen, and where its credits were, by
/// whose moves an element's place on the page follows from one screenful to the next.
struct Screenful {
  /// The part of the page a user sees, within the window and below the switcher
  /// (`shown(_:in:)`).
  let page: CGRect
  /// The page's frame as XCUITest gave it, for a failure to say: one that moves from screenful to
  /// screenful is its content's, one that stays put its scroll view's viewport.
  let frame: CGRect
  let credits: CGRect

  /// Whether this screenful shows whole what was at `frame` on `screenful`, moved with the page
  /// by as much as the credits moved (to within a point).
  func showsWhole(_ frame: CGRect, from screenful: Screenful) -> Bool {
    guard !frame.isNull, !frame.isEmpty else { return false }
    let moved = frame.offsetBy(dx: 0, dy: credits.minY - screenful.credits.minY)
    return page.insetBy(dx: -1, dy: -1).contains(moved)
  }

  /// Where the page was and the credits were on each screenful, for a failure to say.
  static func describe(_ seen: [Screenful]) -> String {
    let page = seen.first.map { "\($0.page)" } ?? "unknown"
    let frames = seen.map { "\($0.frame)" }.joined(separator: ", ")
    let credits = seen.map { "\($0.credits)" }.joined(separator: ", ")
    return "the page on screen at \(page), the page's frame on each screenful at \(frames), the "
      + "credits on each screenful at \(credits)"
  }
}

/// What an exception knows of an issue's element: its identifier, label and frame on screen,
/// and the screen's switcher tabs and its credits, where they are on screen (`.null` without).
struct AuditedElement {
  let identifier: String
  let label: String
  let frame: CGRect
  let tabs: [String]
  let credits: CGRect
}

/// What the audits found: the issues that fail the test, and those allowed, each described with
/// its kind, its element and the page it was on; and which exceptions allowed any.
///
/// An issue is judged on the screenful that shows its element whole. The top bar and the
/// switcher are always whole on screen. An element of the page that the screenful cuts at the
/// edge of the part of the page a user sees (`Screenful.page`: within the window, below the
/// switcher), or that is off it (above, under the switcher, or below the screen), is held
/// until the page's last screenful: if another screenful showed it whole, that screenful's audit
/// judged it, and the held issue goes; if none did, it is judged as it was. The audit reads
/// elements the screen doesn't show whole, and measures their contrast against whatever the
/// screen has where they are: on PR #31's macOS run the answer and the question passed on each
/// page's first screenful, where they were whole, and failed contrast on every screenful after
/// it, scrolled off the page's top; the places nearby and the links failed it on the first
/// screenful, at the screen's bottom edge or under it.
@MainActor
private final class AuditLog {
  /// An issue whose element wasn't whole on its screenful.
  private struct Held {
    let element: AuditedElement
    let type: XCUIAccessibilityAuditType
    let text: String
    let on: Screenful
  }

  /// The identifiers of the top bar's and the switcher's elements, which don't scroll.
  private static let fixed: Set<String> = [
    "place", "settings", "approximate", "use-my-location", "views",
  ]

  /// The switcher's tabs, as the screen's pages label themselves.
  let tabs: [String]
  private(set) var unexpected: [String] = []
  private(set) var allowed: [String] = []
  /// The indexes of the exceptions that allowed an issue.
  private(set) var used: Set<Int> = []
  /// The page's issues held until its last screenful.
  private var held: [Held] = []

  init(tabs: [String]) {
    self.tabs = tabs
  }

  func note(_ issue: XCUIAccessibilityAuditIssue, on page: String, in screenful: Screenful) {
    let element = AuditedElement(
      identifier: issue.element?.identifier ?? "",
      label: issue.element?.label ?? "",
      frame: issue.element?.frame ?? .null,
      tabs: tabs,
      credits: screenful.credits
    )
    let type = issue.element?.elementType
    // The element's type and frame as well as its identifier and label, so that one with
    // neither can be told apart (DECISIONS, "The iPhone app's UI tests, after main's first macOS
    // run").
    let described =
      type.map { describeElement($0, element.identifier, element.label, element.frame) }
      ?? "no element"
    let text =
      "\(page): \(issue.auditType.names): \(issue.compactDescription) (\(described)): "
      + issue.detailedDescription
    // A segment of the switcher's segmented control: a button with a tab's label, and no
    // identifier of its own.
    let segment = type == .button && element.identifier.isEmpty && tabs.contains(element.label)
    let fixed =
      Self.fixed.contains(element.identifier) || element.identifier.hasPrefix("view-") || segment
    if fixed || element.frame.isNull || screenful.showsWhole(element.frame, from: screenful) {
      judge(element, issue.auditType, text)
    } else {
      held.append(Held(element: element, type: issue.auditType, text: text, on: screenful))
    }
  }

  /// The page's last screenful has been audited (`seen` is every one): judges each held issue
  /// whose element no screenful showed whole.
  func settle(on seen: [Screenful]) {
    for item in held
    where !seen.contains(where: { $0.showsWhole(item.element.frame, from: item.on) }) {
      judge(
        item.element, item.type,
        "\(item.text) (no screenful showed it whole; the page on screen at \(item.on.page))")
    }
    held = []
  }

  /// Notes an issue as allowed, by the first exception that matches it, or as unexpected.
  private func judge(
    _ element: AuditedElement,
    _ type: XCUIAccessibilityAuditType,
    _ text: String
  ) {
    let exception = HomeAuditTests.exceptions.firstIndex {
      $0.type == type && $0.matches(element)
    }
    if let exception {
      used.insert(exception)
      allowed.append("\(text). Allowed: \(HomeAuditTests.exceptions[exception].why)")
    } else {
      unexpected.append(text)
    }
  }
}
