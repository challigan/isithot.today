import XCTest

/// The home screen's accessibility audits and its screens for the contact sheet (iOS build spec,
/// sections 16, 17.2 and phase 5's exit): spec 17.2's `AccessibilityAuditTests` for the home
/// screen; the later phases audit their own screens. Every page (Now, Today or Tomorrow, This
/// week) of aberdeen-snow, durham-tomorrow and leeds-dry, at Large (the default text size) and
/// at AX3 (an accessibility size, set through UIKit's preferred content size category), each on
/// its fixture at its own moment with the clock fixed: XCUITest's
/// `performAccessibilityAudit(for:)` (iOS 17) for every kind of issue on each screenful of the
/// page, from its top down to the credits at its end, since an audit can judge only what the
/// screen shows; and each screenful attached. Each screenful is audited in three calls
/// (`AuditKinds.passes`): the kinds that read the screen as it is, contrast and then the other
/// four, then the Dynamic Type and clipped-text checks, which lay the app out at other text sizes
/// and leave a page scrolled past its end at the size checked short of where it was, so the page
/// is put back before the next scroll (`restore`).
///
/// The attachments are named so that the contact sheet, which tiles them in their names' order
/// (`ci/contact-sheet.mjs`), shows them fixture by fixture, Large then AX3, each page in the
/// switcher's order, top to bottom: `home-<fixture>-1-large-1-now-01`, `…-1-large-1-now-02`, …,
/// `…-1-large-2-today-01` (or `-2-tomorrow-01`), …, `…-1-large-3-this-week-01`, …, then
/// `home-<fixture>-2-ax3-1-now-01` and so on.
///
/// Every issue an audit finds fails the test, but for the exceptions in `exceptions`, each with
/// why it isn't a fault to fix in the app. An element of the page is judged on a screenful that
/// shows it whole (`AuditLog`). Each call goes through `runAudit` (ScreenAudit.swift): timed, the
/// times attached at the test's end as `home-<fixture>-<order>-audit-times`, and run again once,
/// on the screenful as attached, should it not finish in time.
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
  /// credits' links, which phase 5.4 foresaw (DECISIONS, "The iPhone app's home accessibility and
  /// its UI tests"), and contrast on any text element whose screenful's pixels prove it is text
  /// in the page's own colours at 4.5:1 or more, proven again on each issue, as on every audited
  /// screen (`MeasuredContrast`, `DrawnText`; DECISIONS, "Contrast by measured pixels, after
  /// #34's first full run"), which took over PR #33's exception for the details and the places
  /// nearby alone. The switcher's Dynamic Type exception, phase 5.4's other, went with the
  /// segmented picker it allowed: the website's tabs that replace it scale (DECISIONS, "The
  /// iPhone app in the website's look"). The issues allowed and the exceptions no audit of a test
  /// needed are attached at its end (`home-<fixture>-<size>-allowed`) and listed in its failure,
  /// so that one the app no longer needs can go.
  static let exceptions: [Exception] = [
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
    Exception(type: .contrast, matches: MeasuredContrast.allows, why: MeasuredContrast.why),
  ]

  /// The most screenfuls a page is audited in, top to bottom: a bound on a page that never ends,
  /// not on the app. At AX3 the longest page, the week's, is about 3,030 points tall (PR #33's
  /// macOS run), with 448.67 of them on screen under the top bar and the switcher's stacked
  /// buttons, so it takes nine screenfuls or so, each scroll at most four fifths of the page on
  /// screen, less the few points a drag spends before the page moves.
  static let screenfuls = 20

  /// The most drags that put a page back where an audit moved it from, for one screenful: from a
  /// page's top to the end of the longest, at four fifths of the page on screen a drag, with one
  /// to spare.
  static let restoringDrags = 12

  /// How far short of where it was a page put back may stay: what a drag spends before the page
  /// moves (13 to 20 points on PR #33's macOS run), so a shorter drag would hardly move it. Short
  /// is safe: the next scroll is worked out from where the page is.
  static let restoringSlack: CGFloat = 24

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
    // At an accessibility size the switcher's tabs wrap onto a second line, and at Large they
    // share the track's one: so the size reached the app.
    XCTAssertEqual(
      switcherWraps(app), size == .ax3,
      "The switcher isn't the one for \(order): the text size didn't reach the app")
    // The top bar under the status bar, and every page's end below the screen, at both sizes on
    // main's first macOS run.
    expectFits(app, "\(name) at \(order)")
    // The window-sized element with no label, on every screenful of PR #33's two macOS runs.
    expectNoBareElements(app, "\(name) at \(order)")
    // Every page's colours, from brandColours.ts, once checked against TypeScript's samples.
    let surfaces = try SurfaceFile.bundled()
    let found = AuditLog()
    let times = AuditTimes()
    // Every call's time, however the test ends (ci/xcresult-summary.mjs `timings` lists them).
    defer { attachText(times.text, as: "home-\(name)-\(order)-audit-times") }
    for (index, page) in screen.pages.enumerated() {
      try tap(page, in: app)
      XCTAssertEqual(app.heading.label, page.heading, "\(page.view) page at \(order)")
      let tab = page.label.lowercased().replacingOccurrences(of: " ", with: "-")
      let colours = try surfaces.colours(.page(band: page.band), window: app.frame)
      try audit(
        page, as: "home-\(name)-\(order)-\(index + 1)-\(tab)", in: app, at: size,
        colours: colours, noting: found, timing: times)
    }
    // What the exceptions allowed and which no issue needed, for the log and the result bundle:
    // `print` reaches neither, so PR #33's runs couldn't say whether the credits' fired. Then the
    // slowest audit call, and any that didn't finish in time.
    let unneeded = Self.exceptions.indices.filter { !found.used.contains($0) }.map {
      "Not needed: \(Self.exceptions[$0].why)"
    }
    let report = found.allowed.map { "Allowed: \($0)" } + unneeded + times.report
    attachText(report.joined(separator: "\n"), as: "home-\(name)-\(order)-allowed")
    XCTAssertTrue(
      found.unexpected.isEmpty,
      "\(found.unexpected.count) accessibility issues on \(name) at \(order), in the window at "
        + "\(app.frame):\n" + (found.unexpected + report).joined(separator: "\n"))
  }

  /// Audits the page on screen a screenful at a time, from its top (where it is on its first
  /// showing) down to the end of the credits, its last lines, attaching each screenful as
  /// `<name>-<k>`, k from 01. Each screenful is audited in three calls (`AuditKinds.passes`), and
  /// each issue's element is noted where it was on the screenful as attached: an audit that moved
  /// the page moved it with the credits. An element of the page that a screenful cuts at the
  /// page's edge, or shows not at all, is judged on a screenful that shows it whole
  /// (`AuditLog.settle`). Before the next scroll the page is put back where the screenful had it,
  /// should an audit have moved it (`restore`). A call that doesn't finish in time runs again
  /// once, only on the screenful as attached (`runAudit`, `unsettled`). Fails, with where the page
  /// and its credits were, when the credits aren't there, the app has left the foreground, an
  /// audit can't run or doesn't finish in time twice, a call but the resizing one moves the page,
  /// the page stops scrolling before its end, or its end never comes into view; for the last two,
  /// with what `stopped` finds too.
  @MainActor
  private func audit(
    _ page: HomeScreen.Page,
    as name: String,
    in app: XCUIApplication,
    at size: TextSize,
    colours: SurfaceColours,
    noting found: AuditLog,
    timing times: AuditTimes
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
      let shot = attach(app, as: "\(name)-\(String(format: "%02d", number))")
      if number == 1 {
        // The tree on every page, not only one that stops: on PR #33's second macOS run none
        // stopped, and nothing showed what held the window-sized element with no label.
        attachText(app.debugDescription, as: "\(name)-tree")
      }
      let whole = app.find("page-\(page.view)").frame
      let screenful = Screenful(page: shown(whole, in: app), frame: whole, credits: credits.frame)
      guard !screenful.page.isEmpty else {
        XCTFail("\(place): no page-\(page.view) on screen")
        return
      }
      seen.append(screenful)
      // A contrast issue's pixels, from the screenful as attached.
      let pixels = { (frame: CGRect) in ScreenPixels(shot, in: frame, window: colours.window) }
      for kinds in AuditKinds.passes {
        let issues: [XCUIAccessibilityAuditIssue]
        do {
          issues = try runAudit(of: app, for: kinds, at: place, timing: times) {
            // Run again only on the screenful as attached: the resizing call's page put back
            // first, as before a scroll.
            if kinds == AuditKinds.resizing {
              drags += restore(page, to: screenful, in: app, credits: credits)
            }
            return unsettled(app, at: size, credits: credits, as: screenful)
          }
        } catch {
          XCTFail(
            "\(error); the app's state is \(app.state.rawValue), " + Screenful.describe(seen))
          return
        }
        // Where the credits are once the call is done: how far it moved the page, by which each
        // issue's element is noted where it was on the screenful.
        let end = settledFrame(of: credits)
        let moved = end.minY - screenful.credits.minY
        for issue in issues {
          found.note(
            issue, on: place, in: screenful, moved: abs(moved) < 1 ? 0 : moved, pixels: pixels,
            colours: colours)
        }
        guard abs(moved) >= 1 else { continue }
        let says =
          "\(place): the audit of \(kinds.names) moved the page \(moved) points, the credits from "
          + "\(screenful.credits) to \(end)"
        if kinds == AuditKinds.resizing {
          // Expected of a page scrolled past its end at a smaller text size; put back below.
          print("\(says); it is put back before the next scroll")
        } else {
          // Nothing but the text size should move a page: its issues were read where it was.
          XCTFail("\(says), which only the Dynamic Type and clipped-text checks were known to do")
        }
      }
      // The credits' end is on screen: the whole page has been audited.
      if screenful.credits.maxY <= screenful.page.maxY { return }
      drags += restore(page, to: screenful, in: app, credits: credits)
      let before = settledFrame(of: credits)
      drags.append(scrollDown(page, by: step(page, from: screenful, in: app), in: app))
      let after = settledFrame(of: credits)
      // Restore leaves the page at most restoringSlack short of the screenful, and the step moves
      // it at least a quarter of the page on screen less a drag's slack: a page that moves ends
      // well past the screenful.
      if after.minY > screenful.credits.minY - 1 {
        XCTFail(
          "\(page.view) page: it scrolls no further, but its end isn't on screen; put back to "
            + "\(before), the drag left the credits at \(after); " + Screenful.describe(seen) + "; "
            + stopped(page, as: name, in: app, credits: credits, drags: drags))
        return
      }
    }
    XCTFail(
      "\(page.view) page: its end never came into view in \(Self.screenfuls) screenfuls; "
        + Screenful.describe(seen) + "; "
        + stopped(page, as: name, in: app, credits: credits, drags: drags))
  }

  /// Puts the page back where `screenful` had it, after an audit moved it back up: scrolls down,
  /// at most four fifths of the page on screen a drag, until the credits are within
  /// `restoringSlack` points short of where they were, or a drag moves the page no more. Never
  /// past it: a drag moves the page by less than its length, as the scroll view spends its first
  /// points before the page moves, and the next scroll is worked out from where the page then is
  /// (`step`), so no part of the page goes unaudited. The Dynamic Type check does move it: it
  /// lays the app out at a smaller text size, where the page is shorter, and the scroll view keeps
  /// that size's end once the size is put back. On PR #33's macOS run every AX3 page went back to
  /// it, 250 to 357 points down, before each drag, so none was audited more than one drag past
  /// it and each failed "scrolls no further"; and the issues of the Large pages' second
  /// screenfuls were read 67 to 97 points short of the screenful attached. Gives the drags.
  @MainActor
  private func restore(
    _ page: HomeScreen.Page,
    to screenful: Screenful,
    in app: XCUIApplication,
    credits: XCUIElement
  ) -> [Drag] {
    var drags: [Drag] = []
    var now = settledFrame(of: credits)
    while drags.count < Self.restoringDrags {
      let short = now.minY - screenful.credits.minY
      guard short > Self.restoringSlack else { break }
      var drag = scrollDown(page, by: min(short, screenful.page.height * 0.8), in: app)
      drag.restoring = true
      drags.append(drag)
      let next = settledFrame(of: credits)
      if abs(next.minY - now.minY) < 1 { break }
      now = next
    }
    return drags
  }

  /// Why the screen isn't `screenful` as attached, for an audit call that didn't finish in time
  /// to run again on it (`runAudit`), or nil when it is: the app in the foreground; the switcher
  /// the one for `size`, so the text size is the test's (a Dynamic Type check cut short could
  /// leave another); and the credits within a point of where the screenful had them.
  @MainActor
  private func unsettled(
    _ app: XCUIApplication,
    at size: TextSize,
    credits: XCUIElement,
    as screenful: Screenful
  ) -> String? {
    guard app.state == .runningForeground else {
      return "the app isn't in the foreground (state \(app.state.rawValue))"
    }
    guard switcherWraps(app) == (size == .ax3) else {
      return "the switcher isn't the one for the test's text size"
    }
    let now = settledFrame(of: credits)
    guard abs(now.minY - screenful.credits.minY) < 1 else {
      return "the page isn't where the screenful had it, the credits at \(now)"
    }
    return nil
  }

  /// Whether the switcher's tabs wrap, as they do at accessibility sizes: This week's tab starts
  /// at or below the bottom of Now's (half a point either way, as a frame read on a 3x screen may
  /// round). At standard sizes the three share the track's one line. The tabs are buttons with
  /// the same identifiers at every size, so their places, not their being there, tell the two
  /// apart.
  @MainActor
  private func switcherWraps(_ app: XCUIApplication) -> Bool {
    let now = app.buttons["view-now"]
    let week = app.buttons["view-week"]
    guard now.exists, week.exists else { return false }
    return week.frame.minY >= now.frame.maxY - 0.5
  }

  /// What a page that stopped short of its end shows, for its failure to say, beyond where the
  /// page and its credits were on each screenful: the page's whole frame, the part off screen
  /// too, and the window's; each drag; the page's lowest elements, by which the page's content
  /// reaches below its frame or not; and where the credits went on a swipe up by XCUITest's own
  /// gesture, which tells a page at the end of its scroll range from a drag the page didn't
  /// take. Attaches the app's element tree as `<name>-tree-stopped` (`<name>-tree` is the
  /// page's first screenful's). On main's first macOS run, every page at AX3 stopped 1,000 to
  /// 1,600 points short of its end, and the log couldn't say why.
  @MainActor
  private func stopped(
    _ page: HomeScreen.Page,
    as name: String,
    in app: XCUIApplication,
    credits: XCUIElement,
    drags: [Drag]
  ) -> String {
    attachText(app.debugDescription, as: "\(name)-tree-stopped")
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
///
/// An issue's element is read once the audit call is done (`runAudit`), so it is noted where it
/// was on the screenful, moved back by as much as the audit moved the credits: on PR #33's macOS
/// run, when one call held every kind, the Dynamic Type check had moved the page back before any
/// issue was read, and elements under the switcher when the screenful was attached were judged
/// whole where the move had brought them.
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

  private(set) var unexpected: [String] = []
  private(set) var allowed: [String] = []
  /// The indexes of the exceptions that allowed an issue.
  private(set) var used: Set<Int> = []
  /// The page's issues held until its last screenful.
  private var held: [Held] = []

  /// Notes `issue`, found on `screenful` by an audit after which the page's content was `moved`
  /// points lower than on the screenful (the credits' move): an element of the page is noted
  /// where it was on the screenful, the top bar's and the switcher's where they are. A contrast
  /// issue says what `pixels` reads of the screenful as attached inside its element, beside the
  /// page's `colours` there, and what text that shows drawn (`DrawnText`).
  func note(
    _ issue: XCUIAccessibilityAuditIssue,
    on page: String,
    in screenful: Screenful,
    moved: CGFloat,
    pixels: (CGRect) -> ScreenPixels?,
    colours: SurfaceColours
  ) {
    let identifier = issue.element?.identifier ?? ""
    let label = issue.element?.label ?? ""
    let read = issue.element?.frame ?? .null
    let type = issue.element?.elementType
    let fixed = Self.fixed.contains(identifier) || identifier.hasPrefix("view-")
    let frame = fixed || read.isNull || moved == 0 ? read : read.offsetBy(dx: 0, dy: -moved)
    var element = AuditedElement(
      type: type, identifier: identifier, label: label, frame: frame,
      credits: screenful.credits)
    // The element's type and frame as well as its identifier and label, so that one with
    // neither can be told apart (DECISIONS, "The iPhone app's UI tests, after main's first macOS
    // run"); and where it was once the audit was done, when the audit had moved it.
    var described =
      type.map { describeElement($0, identifier, label, frame) } ?? "no element"
    if frame != read { described += ", at \(read) once the audit had moved the page" }
    var text =
      "\(page): \(issue.auditType.names): \(issue.compactDescription) (\(described)): "
      + issue.detailedDescription
    if issue.auditType == .contrast, !frame.isNull {
      let read = pixels(frame)
      let drawn = DrawnText(
        pixels(DrawnText.reading(frame)), in: frame, on: colours,
        withMarks: MeasuredContrast.drawsMarks(type))
      element.drawn = drawn
      let range = read.flatMap { PixelRange(rgba: $0.rgba) }
      text +=
        "; the screenful's pixels there: \(range.map(\.description) ?? "can't be read"); "
        + colours.expected(in: frame) + "; " + drawn.description
    }
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
