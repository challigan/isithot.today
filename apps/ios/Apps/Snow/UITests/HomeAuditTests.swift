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
/// is put back before the next scroll (`restore`). The upgrade row (spec 10.2, item 6), which
/// StoreKit's stand-in brings only with a product for sale, is audited the same way, on
/// leeds-dry's middle page launched with one (`-purchase bought`), at Large and at AX3, where its
/// words wrap; no other launch here has the row.
///
/// The attachments are named so that the contact sheet, which tiles them in their names' order
/// (`ci/contact-sheet.mjs`), shows them fixture by fixture, Large then AX3, each page in the
/// switcher's order, top to bottom: `home-<fixture>-1-large-1-now-01`, `…-1-large-1-now-02`, …,
/// `…-1-large-2-today-01` (or `-2-tomorrow-01`), …, `…-1-large-3-this-week-01`, …, then
/// `home-<fixture>-2-ax3-1-now-01` and so on; the row's after leeds-dry's own, as
/// `home-leeds-dry-upgrade-1-large-2-today-01` and so on.
///
/// Every issue an audit finds fails the test, but for the exceptions in `exceptions`, each with
/// why it isn't a fault to fix in the app. An element of the page is judged on a screenful that
/// shows it whole (`AuditLog`). Each call goes through `runAudit` (ScreenAudit.swift): timed, the
/// times attached at the test's end as `home-<fixture>-<order>-audit-times`, each with where the
/// credits were. One that doesn't finish in time isn't run again on the same screen: the page is
/// moved a few points, showing whole the same elements, and audited again in all three calls, up
/// to `reaudits` times, each a few points from every place a call stopped (`auditAgain`).
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

  @MainActor
  func testLeedsDryWithTheUpgradeRowAtLarge() throws {
    try auditTheUpgradeRow(at: .large)
  }

  @MainActor
  func testLeedsDryWithTheUpgradeRowAtAX3() throws {
    try auditTheUpgradeRow(at: .ax3)
  }

  /// leeds-dry's middle page, the one page with the upgrade row, launched with a product for sale
  /// (`-purchase bought`, StoreKit's stand-in), so the row sits above its footer; attached as
  /// `home-leeds-dry-upgrade-…`. The row comes once the stand-in has answered, which the audit
  /// waits for.
  @MainActor
  private func auditTheUpgradeRow(at size: TextSize) throws {
    try audit(
      "leeds-dry", at: size, extra: ["-purchase", "bought"], pages: ["today"],
      as: "leeds-dry-upgrade", showing: "upgrade-row")
  }

  /// An issue the audit raises that isn't a fault to fix in the app, and why: which kind, and
  /// how to know its element.
  struct Exception {
    let type: XCUIAccessibilityAuditType
    /// Whether an issue of `type` is this exception, from its element and the screen.
    let matches: (_ element: AuditedElement) -> Bool
    let why: String
  }

  /// The calls that stopped on each of `auditAgain`'s tries, in order, as the test's failure says
  /// them, each with its place (how far the page was moved), kinds, time and where the credits
  /// were.
  struct ReauditStops: Error, CustomStringConvertible {
    let stops: [AuditFailure]

    var description: String {
      "a call stopped on \(stops.count == 1 ? "its one try" : "each of its \(stops.count) tries"): "
        + stops.map(\.description).joined(separator: "; then ")
    }
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

  /// Opens `name` at `size`, launched with `extra` arguments too, checks the switcher is the one
  /// for that size, and for each page in the switcher's order, or only those whose views are in
  /// `pages` ("now", "today", "week") when given, shows it by its tab, checks its heading, and
  /// from its top to its end attaches and audits each screenful. The attachments are named for
  /// `label`, `name` without one. With `showing`, the identifier of an element of the page the
  /// launch opens on that comes a moment later (the upgrade row, once StoreKit's stand-in has
  /// answered), the test waits up to 10 seconds for it before it reads anything, and stops
  /// without it rather than audit a page without what it is for. Fails, once, listing every issue
  /// found on any page that isn't an exception.
  @MainActor
  private func audit(
    _ name: String,
    at size: TextSize,
    extra: [String] = [],
    pages: Set<String>? = nil,
    as label: String? = nil,
    showing: String? = nil
  ) throws {
    let screen = try HomeScreen.named(name)
    if let pages, let missing = pages.subtracting(screen.pages.map(\.view)).sorted().first {
      throw HomeScreenError("\(name) has no \(missing) page to audit")
    }
    let label = label ?? name
    let app = try launch(screen, size: size, extra: extra)
    let order: String
    switch size {
    case .large: order = "1-large"
    case .ax3: order = "2-ax3"
    }
    // What the launch brings a moment later, before the checks and audits read the screen.
    if let showing, !app.find(showing).waitForExistence(timeout: 10) {
      throw HomeScreenError(
        "\(label) at \(order): no \(showing) 10 seconds after launching with \(extra); "
          + app.homeGeometry)
    }
    // At an accessibility size the switcher's tabs wrap onto a second line, and at Large they
    // share the track's one: so the size reached the app.
    XCTAssertEqual(
      switcherWraps(app), size == .ax3,
      "The switcher isn't the one for \(order): the text size didn't reach the app")
    // The top bar under the status bar, and every page's end below the screen, at both sizes on
    // main's first macOS run.
    expectFits(app, "\(label) at \(order)")
    // The window-sized element with no label, on every screenful of PR #33's two macOS runs.
    expectNoBareElements(app, "\(label) at \(order)")
    // Every page's colours, from brandColours.ts, once checked against TypeScript's samples.
    let surfaces = try SurfaceFile.bundled()
    let found = AuditLog()
    let times = AuditTimes()
    // Every call's time, however the test ends (ci/xcresult-summary.mjs `timings` lists them).
    defer { attachText(times.text, as: "home-\(label)-\(order)-audit-times") }
    // Numbered by the switcher's order whichever are audited, so a page's attachments are named
    // alike in every test.
    for (index, page) in screen.pages.enumerated() where pages?.contains(page.view) ?? true {
      try tap(page, in: app)
      XCTAssertEqual(app.heading.label, page.heading, "\(page.view) page at \(order)")
      let tab = page.label.lowercased().replacingOccurrences(of: " ", with: "-")
      let colours = try surfaces.colours(.page(band: page.band), window: app.frame)
      try audit(
        page, as: "home-\(label)-\(order)-\(index + 1)-\(tab)", in: app, at: size,
        colours: colours, noting: found, timing: times)
    }
    // What the exceptions allowed and which no issue needed, for the log and the result bundle:
    // `print` reaches neither, so PR #33's runs couldn't say whether the credits' fired. Then the
    // slowest audit call, and any that didn't finish in time.
    let unneeded = Self.exceptions.indices.filter { !found.used.contains($0) }.map {
      "Not needed: \(Self.exceptions[$0].why)"
    }
    let report = found.allowed.map { "Allowed: \($0)" } + unneeded + times.report
    attachText(report.joined(separator: "\n"), as: "home-\(label)-\(order)-allowed")
    XCTAssertTrue(
      found.unexpected.isEmpty,
      "\(found.unexpected.count) accessibility issues on \(label) at \(order), in the window at "
        + "\(app.frame):\n" + (found.unexpected + report).joined(separator: "\n"))
  }

  /// Audits the page on screen a screenful at a time, from its top (where it is on its first
  /// showing) down to the end of the credits, its last lines, attaching each screenful as
  /// `<name>-<k>`, k from 01. Each screenful is audited in three calls (`AuditKinds.passes`), and
  /// each issue's element is noted where it was on the screenful as attached: an audit that moved
  /// the page moved it with the credits. An element of the page that a screenful cuts at the
  /// page's edge, or shows not at all, is judged on a screenful that shows it whole
  /// (`AuditLog.settle`). Before the next scroll the page is put back where the screenful had it,
  /// should an audit have moved it (`restore`). A call that doesn't finish in time isn't run again
  /// on the same screen: the screenful's other calls aren't made, and the page is moved a few
  /// points, showing whole what the screenful showed whole, and audited again in all three calls
  /// as a screenful of its own, `<name>-<k>-moved`, what the stopped screenful's calls done found
  /// dropped so that none is counted twice, and again, a few points from every place a call
  /// stopped, should one stop there too, up to `reaudits` times (`-moved-2`, `-moved-3`;
  /// `auditAgain`); the next scroll starts from the one whose calls all finished. Fails, with
  /// where the page and its credits were, when the credits aren't there, the app has left the
  /// foreground, an audit can't run, a call doesn't finish in time on every moved screenful or
  /// the page can't be moved so, a call but the resizing one moves the page, the page stops
  /// scrolling before its end, or its end never comes into view; for the last two, with what
  /// `stopped` finds too.
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
    let run = PageRun(
      page: page, app: app, size: size, colours: colours, credits: credits, found: found,
      times: times)
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
      let label = "\(name)-\(String(format: "%02d", number))"
      // The tree on every page, not only one that stops: on PR #33's second macOS run none
      // stopped, and nothing showed what held the window-sized element with no label.
      guard
        case (let attached, let shot)? = attachScreenful(
          as: label, at: place, with: run, tree: number == 1 ? "\(name)-tree" : nil)
      else { return }
      seen.append(attached)
      var screenful = attached
      // What was noted before this screenful's calls: should one stop, `auditAgain` drops what
      // those done found, which the moved screenful's calls find again.
      let noted = found.mark
      do {
        try auditCalls(on: attached, shot: shot, at: place, with: run)
      } catch let failure as AuditFailure where isAuditTimeout(failure.first) {
        guard
          let moved = auditAgain(
            after: failure, on: attached, as: label, at: place, with: run, noted: noted,
            seen: &seen, drags: &drags)
        else { return }
        screenful = moved
      } catch {
        XCTFail("\(error); the app's state is \(app.state.rawValue), " + Screenful.describe(seen))
        return
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

  /// Attaches the screen as `label`, and, given `tree`, the app's element tree so named; gives
  /// the screenful, where the page and its credits are, and the screenshot, whose pixels a
  /// contrast issue's proof reads. Nil, having failed the test, with no page on screen.
  @MainActor
  private func attachScreenful(
    as label: String,
    at place: String,
    with run: PageRun,
    tree: String?
  ) -> (Screenful, XCUIScreenshot)? {
    let shot = attach(run.app, as: label)
    if let tree { attachText(run.app.debugDescription, as: tree) }
    let whole = run.app.find("page-\(run.page.view)").frame
    let screenful = Screenful(
      page: shown(whole, in: run.app), frame: whole, credits: run.credits.frame)
    guard !screenful.page.isEmpty else {
      XCTFail("\(place): no page-\(run.page.view) on screen")
      return nil
    }
    return (screenful, shot)
  }

  /// Audits `screenful`, attached as `shot`, in the three calls (`AuditKinds.passes`), each
  /// through `runAudit`, and notes each issue where its element was on the screenful
  /// (`AuditLog.note`), a contrast issue with the screenshot's pixels. Fails when a call but the
  /// resizing one moves the page. Throws a call's failure (`AuditFailure`) as it comes: one that
  /// didn't finish in time isn't run again on this screen (`OnAuditTimeout.handBack`), the
  /// screenful's later calls aren't made, and the issues of those done stay noted, for
  /// `auditAgain` to drop once it audits the screenful again a few points away.
  @MainActor
  private func auditCalls(
    on screenful: Screenful,
    shot: XCUIScreenshot,
    at place: String,
    with run: PageRun
  ) throws {
    // A contrast issue's pixels, from the screenful as attached.
    let pixels = { (frame: CGRect) in ScreenPixels(shot, in: frame, window: run.colours.window) }
    // Where the credits were, for the times: a position on the page, to the third of a point, that
    // runs can be told apart by (DECISIONS, "After #34's fourth full run").
    let at = "\(place) (credits \(String(format: "%.2f", Double(screenful.credits.minY))))"
    for kinds in AuditKinds.passes {
      let issues = try runAudit(
        of: run.app, for: kinds, at: at, timing: run.times, onTimeout: .handBack)
      // Where the credits are once the call is done: how far it moved the page, by which each
      // issue's element is noted where it was on the screenful.
      let end = settledFrame(of: run.credits)
      let moved = end.minY - screenful.credits.minY
      for issue in issues {
        run.found.note(
          issue, on: place, in: screenful, moved: abs(moved) < 1 ? 0 : moved, pixels: pixels,
          colours: run.colours)
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
  }

  /// After a call on `screenful` (attached as `label`) didn't finish in time (`failure`), the
  /// screenful's other calls not made: attaches the app's element tree as `<label>-tree`, what
  /// was on screen as the call stopped; then, up to `reaudits` times, puts the page back should a
  /// call have moved it (`restore`), checks the app is as the test had it (`unsettled`), moves the
  /// page a few points, showing whole exactly the elements the screenful showed whole, and away
  /// from every place a call on them has stopped (`moveAFewPoints`), and attaches the screen as
  /// `<label>-moved` (then `-moved-2`, `-moved-3`) and audits it in all three calls, a screenful
  /// of its own in `seen`, so every kind runs on the same content and the proof reads the pixels
  /// audited. Before those calls it drops what was noted since `noted`, what the stopped
  /// screenful's calls done found (`AuditLog.drop`), and any a stopped try's found, which the next
  /// calls find again on the same whole elements: so none is counted twice, as `runAudit` drops a
  /// sheet's first attempt's. Gives the moved screenful whose calls all finished, for the next
  /// scroll to start from; nil, having failed the test with each attempt's move, time and where
  /// the credits were, when the page can't be moved so (the issues noted then kept), a call on a
  /// moved screenful fails otherwise, or one stops on every try.
  ///
  /// Not the same call again on the same screen: on PR #34's run on c74aa22 the contrast call on
  /// leeds-dry's week page at AX3, fourth screenful, stopped for XCTest's 15 seconds twice, run
  /// again on the same still screen, as it had on fdb3182's fifth. Nor one move: on PR #37's last
  /// run, PR #38's two and PR #39's, the contrast call on the same page's sixth screenful stopped
  /// with the credits at 649.7, 650.07, 650.7 and 656.4 points down the screen, and finished at
  /// 638.7, 643.4 and 653.4; PR #38's second run's one move, 6.3 points from 656.4, landed at
  /// 650.07, within half a point of two other runs' stops. The stall follows the exact screen, to
  /// about a point, in bands no run has mapped: so each try aims as far as it may from every place
  /// a call stopped (DECISIONS, "After #34's fourth full run").
  @MainActor
  private func auditAgain(
    after failure: AuditFailure,
    on screenful: Screenful,
    as label: String,
    at place: String,
    with run: PageRun,
    noted: AuditLog.Mark,
    seen: inout [Screenful],
    drags: inout [Drag]
  ) -> Screenful? {
    var failure = failure
    failure.at = "with the credits at \(screenful.credits)"
    attachText(run.app.debugDescription, as: "\(label)-tree")
    // Where a call stopped, as moves of the content from the screenful: the screenful's own first.
    var stalled: [CGFloat] = [0]
    var stops: [AuditFailure] = []
    for attempt in 1...Self.reaudits {
      drags += restore(run.page, to: screenful, in: run.app, credits: run.credits)
      let distance: CGFloat
      do {
        if let why = unsettled(run.app, at: run.size) { throw HomeScreenError(why) }
        distance = try moveAFewPoints(
          run.page, from: screenful, awayFrom: stalled, in: run.app, credits: run.credits,
          drags: &drags)
      } catch {
        failure.notRunAgain = "its screenful wasn't audited again a few points away: \(error)"
        if !stops.isEmpty { failure.elsewhere = ReauditStops(stops: stops) }
        XCTFail("\(failure); " + Screenful.describe(seen))
        return nil
      }
      let again =
        "\(place), scrolled \(pointsText(abs(distance))) points \(distance > 0 ? "down" : "up")"
      let suffix = attempt == 1 ? "-moved" : "-moved-\(attempt)"
      guard
        case (let moved, let shot)? = attachScreenful(
          as: label + suffix, at: again, with: run, tree: nil)
      else { return nil }
      seen.append(moved)
      run.found.drop(since: noted)
      do {
        try auditCalls(on: moved, shot: shot, at: again, with: run)
        return moved
      } catch var second as AuditFailure where isAuditTimeout(second.first) {
        second.at = "with the credits at \(moved.credits)"
        stops.append(second)
        stalled.append(distance)
      } catch {
        if var second = error as? AuditFailure {
          second.at = "with the credits at \(moved.credits)"
          failure.elsewhere = second
        } else {
          failure.elsewhere = error
        }
        XCTFail(
          "\(failure); the app's state is \(run.app.state.rawValue), " + Screenful.describe(seen))
        return nil
      }
    }
    failure.elsewhere = ReauditStops(stops: stops)
    XCTFail(
      "\(failure); the app's state is \(run.app.state.rawValue), " + Screenful.describe(seen))
    return nil
  }

  /// How many times `auditAgain` audits a stopped screenful's content again, each a few points
  /// from every place a call on it stopped: three, at worst 45 seconds more of stopped calls.
  static let reaudits = 3

  /// How far a move `moveAFewPoints` lands from every place a call stopped, at least: as far as a
  /// move must go from the screenful (`nudge`), and more than the 0.4 to 0.6 points by which PR
  /// #38's second run's move missed the other runs' stops.
  static let clearOfStalls: CGFloat = 3

  /// Moves the page a few points from where `screenful` had it, so that it shows whole exactly
  /// the elements the screenful showed whole (`Screenful.showsWhole`), and at least
  /// `clearOfStalls` points from each move in `stalled`, where a call on them stopped (the
  /// screenful's own, 0, among them); gives how far its content moved up the screen (down,
  /// should it be negative). From one snapshot of the page, how far it may move each way
  /// (`PageRoom`) gives the bands of moves to aim for (`PageRoom.windows`, `nudge`), less those too
  /// near a stall (`PageRoom.aims`), each with its aim: the point of it farthest from every stall,
  /// a point inside its ends, so the first try aims about 11 points from the screenful; the band
  /// whose aim is farthest from them first, the way with the wider band first on a tie (up on a
  /// tie of those). Each drag aims there, longer by what a drag spends before the page moves:
  /// reckoned at first as `deadTravel`, then as the last drag's, measured from where the credits
  /// went; at most `nudgingDrags` drags a band. The page's place is read from the credits once it
  /// has settled (`settledFrame`), and once it is in any band left, a second snapshot must show
  /// whole the same elements, by type, identifier, label and place on the page
  /// (`PageElements.change`). Throws, with what each band came to, when none gets there.
  @MainActor
  func moveAFewPoints(
    _ page: HomeScreen.Page,
    from screenful: Screenful,
    awayFrom stalled: [CGFloat] = [0],
    in app: XCUIApplication,
    credits: XCUIElement,
    drags: inout [Drag]
  ) throws -> CGFloat {
    let element = app.find("page-\(page.view)")
    guard let first = try? element.snapshot(), let before = PageElements(first) else {
      throw HomeScreenError("the page's elements can't be read")
    }
    let room = PageRoom(before.frames(on: screenful), page: screenful.page)
    let windows = room.windows(least: Self.nudge.least, most: Self.nudge.most, margin: 1)
    guard !windows.isEmpty else {
      throw HomeScreenError("no room to move it \(pointsText(Self.nudge.least)) points: \(room)")
    }
    let aims = PageRoom.aims(windows, awayFrom: stalled, clear: Self.clearOfStalls, inset: 1)
    guard !aims.isEmpty else {
      throw HomeScreenError(
        "no move of \(PageRoom.describe(windows)) (room \(room)) is \(pointsText(Self.clearOfStalls))"
          + " points from every place a call stopped, \(PageRoom.describe(moves: stalled))")
    }
    let allowed = { (at: CGFloat) in aims.contains { $0.band.contains(at) } }
    var dead = Self.deadTravel
    var tried: [String] = []
    for (band, aim) in aims {
      var at = screenful.credits.minY - settledFrame(of: credits).minY
      var count = 0
      while !allowed(at), count < Self.nudgingDrags {
        count += 1
        let want = aim - at
        let length = dead + abs(want)
        drags.append(scrollDown(page, by: want < 0 ? -length : length, in: app))
        let now = screenful.credits.minY - settledFrame(of: credits).minY
        let went = want < 0 ? at - now : now - at
        dead = went >= 0.5 ? max(length - went, 0) : length
        at = now
      }
      let way =
        "\(PageRoom.describe(band)), aiming at \(pointsText(aim)) (room \(room), stopped at "
        + "\(PageRoom.describe(moves: stalled)))"
      guard allowed(at) else {
        tried.append("\(way): \(count) drags left it at \(pointsText(at))")
        continue
      }
      guard let second = try? element.snapshot(), let after = PageElements(second) else {
        throw HomeScreenError("the page's elements can't be read once moved")
      }
      let moved = Screenful(page: screenful.page, frame: screenful.frame, credits: after.credits)
      if let change = PageElements.change(from: before, on: screenful, to: after, on: moved) {
        tried.append("\(way): moved \(pointsText(at)), \(change)")
        continue
      }
      return at
    }
    throw HomeScreenError(
      "it couldn't be moved a few points showing whole what it did: "
        + tried.joined(separator: "; "))
  }

  /// The moves `moveAFewPoints` aims for, each way: at least 3 points (9 pixels), so the screen
  /// differs by more than a frame's rounding, and at most 12, a few points still, the band 9
  /// points wide, wider than the 7 by which a drag's dead travel varies (`deadTravel`).
  static let nudge: (least: CGFloat, most: CGFloat) = (3, 12)

  /// What a drag is reckoned to spend before the page moves until one is measured: the middle of
  /// the 13 to 20 points of PR #33's macOS run (`restoringSlack`).
  static let deadTravel: CGFloat = 16.5

  /// The most drags `moveAFewPoints` makes each way.
  static let nudgingDrags = 3

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

  /// Why the app isn't as the test had it, for a screenful to be audited again after a call
  /// didn't finish in time (`auditAgain`), or nil when it is: the app in the foreground, and the
  /// switcher the one for `size`, so the text size is the test's (a Dynamic Type check cut short
  /// could leave another).
  @MainActor
  private func unsettled(_ app: XCUIApplication, at size: TextSize) -> String? {
    guard app.state == .runningForeground else {
      return "the app isn't in the foreground (state \(app.state.rawValue))"
    }
    guard switcherWraps(app) == (size == .ax3) else {
      return "the switcher isn't the one for the test's text size"
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

/// What auditing one page has at hand: the page, the app at its text size, the page's colours,
/// its credits, and where the test notes issues and times.
@MainActor
private struct PageRun {
  let page: HomeScreen.Page
  let app: XCUIApplication
  let size: TextSize
  let colours: SurfaceColours
  let credits: XCUIElement
  let found: AuditLog
  let times: AuditTimes
}

/// Points as the failures and places give them: "7.5".
func pointsText(_ points: CGFloat) -> String {
  String(format: "%.1f", Double(points))
}

/// A page's elements as one snapshot has them, every one under the page's own in the tree's
/// order (rows, their texts, the credits and the content's own container among them), and where
/// its credits were: by which `HomeAuditTests.moveAFewPoints` finds how far the page may move
/// (`PageRoom`) and checks a moved screenful shows whole the same elements.
struct PageElements {
  let elements: [ScreenLayout.Element]
  let credits: CGRect

  init(elements: [ScreenLayout.Element], credits: CGRect) {
    self.elements = elements
    self.credits = credits
  }

  /// Under `root`, the page's snapshot; nil without the credits.
  @MainActor
  init?(_ root: any XCUIElementSnapshot) {
    var found: [ScreenLayout.Element] = []
    var pending = Array(root.children.reversed())
    while let node = pending.popLast() {
      found.append(
        ScreenLayout.Element(
          type: node.elementType, identifier: node.identifier, label: node.label,
          frame: node.frame))
      pending.append(contentsOf: node.children.reversed())
    }
    guard let credits = found.first(where: { $0.identifier == "credits" })?.frame else {
      return nil
    }
    self.init(elements: found, credits: credits)
  }

  /// The screenful as the snapshot had the page: `screenful`'s part of the page on screen, the
  /// credits where the snapshot had them.
  private func taken(on screenful: Screenful) -> Screenful {
    Screenful(page: screenful.page, frame: screenful.frame, credits: credits)
  }

  /// Each element's frame where `screenful` had the page: moved as the credits moved.
  func frames(on screenful: Screenful) -> [CGRect] {
    let moved = screenful.credits.minY - credits.minY
    return elements.map { $0.frame.isNull ? $0.frame : $0.frame.offsetBy(dx: 0, dy: moved) }
  }

  /// The elements `screenful` shows whole (`Screenful.showsWhole`), the page moved as the credits
  /// moved, in the tree's order, each with its place on the page: its top less the credits'.
  func whole(on screenful: Screenful) -> [(element: ScreenLayout.Element, place: CGFloat)] {
    let snapshot = taken(on: screenful)
    return elements.filter { screenful.showsWhole($0.frame, from: snapshot) }.map {
      ($0, $0.frame.minY - credits.minY)
    }
  }

  /// How the elements `after` shows whole on `moved` differ from those `before` showed whole on
  /// `screenful`, or nil when they are the same: each of the same type, identifier and label as
  /// one of the others, within a point of its place on the page. Says the first one the screenful
  /// showed whole that `moved` doesn't, or else the first `moved` shows whole that the screenful
  /// didn't.
  static func change(
    from before: PageElements,
    on screenful: Screenful,
    to after: PageElements,
    on moved: Screenful
  ) -> String? {
    typealias Whole = (element: ScreenLayout.Element, place: CGFloat)
    func same(_ a: Whole, _ b: Whole) -> Bool {
      a.element.type == b.element.type && a.element.identifier == b.element.identifier
        && a.element.label == b.element.label && abs(a.place - b.place) < 1
    }
    func named(_ item: Whole) -> String {
      let e = item.element
      return describeElement(e.type, e.identifier, e.label, e.frame)
    }
    var now = after.whole(on: moved)
    var lost: Whole?
    for item in before.whole(on: screenful) {
      if let index = now.firstIndex(where: { same(item, $0) }) {
        now.remove(at: index)
      } else if lost == nil {
        lost = item
      }
    }
    if let lost { return "it doesn't show whole the \(named(lost)), which the screenful did" }
    if let more = now.first {
      return "it shows whole the \(named(more)) too, which the screenful didn't"
    }
    return nil
  }
}

/// How far a page may move from a screenful and still show whole exactly the elements of the
/// page the screenful showed whole (`Screenful.showsWhole`'s rule, to within a point): `up`, the
/// most its content may move up the screen (the page scrolled down), and `down`, the most it may
/// move down. Each stops short of the first move that would cut an element the screenful showed
/// whole or show whole one it didn't, and of the page's ends, past which it can't scroll (and a
/// drag down at its top would pull at its refresh). On PR #34's run on c74aa22 the week page's
/// fourth screenful at AX3 had 9.5 points of room up, to its first whole element ("Rain", 8.5
/// under the page's top edge), and 32.3 down, to its last ("Want the full picture? See the
/// forecast on", 31.3 above the window's bottom edge).
struct PageRoom: Equatable, CustomStringConvertible {
  let up: CGFloat
  let down: CGFloat

  init(up: CGFloat, down: CGFloat) {
    self.up = up
    self.down = down
  }

  /// Of `frames`, every element of the page's where the screenful had it, on the part of the page
  /// on screen `page` (`Screenful.page`).
  init(_ frames: [CGRect], page: CGRect) {
    let window = page.insetBy(dx: -1, dy: -1)
    var up = CGFloat.infinity
    var down = CGFloat.infinity
    var content = CGRect.null
    for frame in frames where !frame.isNull && !frame.isEmpty {
      content = content.union(frame)
      // Whole once the content has moved up by m, from `least` to `most`, where it fits across.
      guard frame.minX >= window.minX, frame.maxX <= window.maxX else { continue }
      let least = frame.maxY - window.maxY
      let most = frame.minY - window.minY
      guard least <= most else { continue }
      if least > 0 {
        up = min(up, least)
      } else if most < 0 {
        down = min(down, -most)
      } else {
        up = min(up, most)
        down = min(down, -least)
      }
    }
    if !content.isNull {
      up = min(up, max(content.maxY - page.maxY, 0))
      down = min(down, max(page.minY - content.minY, 0))
    }
    self.init(up: up, down: down)
  }

  /// The moves to aim for, signed (the content up the screen positive): from `least` to `most`
  /// points each way, and `margin` short of its room; the way with the wider band first, up on a
  /// tie; none a way with less room than `least` and `margin`.
  func windows(least: CGFloat, most: CGFloat, margin: CGFloat) -> [ClosedRange<CGFloat>] {
    let upMost = min(most, up - margin)
    let downMost = min(most, down - margin)
    var found: [ClosedRange<CGFloat>] = []
    if upMost >= least { found.append(least...upMost) }
    if downMost >= least {
      let window = (-downMost)...(-least)
      if downMost > upMost { found.insert(window, at: 0) } else { found.append(window) }
    }
    return found
  }

  /// `windows`' bands of moves less `clear` points either side of each move in `stalled` (a move
  /// `clear` from one is kept), each with the move to aim for: the point of the band farthest from
  /// every stalled move, held `inset` inside the band's ends (its middle, should it be narrower
  /// than twice that). The band whose aim is farthest from them first; `windows`' order on a tie
  /// (the way with the wider band first, up on a tie). With only the screenful's own stall, 0, a
  /// band of 3 to 12 points is aimed at 11.
  static func aims(
    _ windows: [ClosedRange<CGFloat>],
    awayFrom stalled: [CGFloat],
    clear: CGFloat,
    inset: CGFloat
  ) -> [(band: ClosedRange<CGFloat>, aim: CGFloat)] {
    let stops = stalled.sorted()
    // The distance from `move` to the nearest stall.
    let clearance = { (move: CGFloat) in stops.map { abs(move - $0) }.min() ?? .infinity }
    var found: [(band: ClosedRange<CGFloat>, aim: CGFloat, clearance: CGFloat)] = []
    for window in windows {
      var bands = [window]
      for stop in stops {
        bands = bands.flatMap { band -> [ClosedRange<CGFloat>] in
          var left: [ClosedRange<CGFloat>] = []
          if band.lowerBound <= stop - clear {
            left.append(band.lowerBound...min(band.upperBound, stop - clear))
          }
          if band.upperBound >= stop + clear {
            left.append(max(band.lowerBound, stop + clear)...band.upperBound)
          }
          return left
        }
      }
      for band in bands {
        // The farthest point from every stall: an end of the band, or midway between two stalls.
        let middles = zip(stops, stops.dropFirst()).map { ($0 + $1) / 2 }
        let candidates = [band.lowerBound, band.upperBound] + middles.filter(band.contains)
        let far = candidates.max { clearance($0) < clearance($1) } ?? band.lowerBound
        let aim =
          band.upperBound - band.lowerBound < 2 * inset
          ? (band.lowerBound + band.upperBound) / 2
          : min(max(far, band.lowerBound + inset), band.upperBound - inset)
        found.append((band, aim, clearance(aim)))
      }
    }
    // Stable: `windows`' order stays on a tie.
    let ranked = found.enumerated().sorted {
      $0.element.clearance != $1.element.clearance
        ? $0.element.clearance > $1.element.clearance : $0.offset < $1.offset
    }
    return ranked.map { ($0.element.band, $0.element.aim) }
  }

  /// A band of moves as a failure says it: "the content 3.0 to 12.0 points down".
  static func describe(_ window: ClosedRange<CGFloat>) -> String {
    let way = window.lowerBound < 0 ? "down" : "up"
    let ends = [abs(window.lowerBound), abs(window.upperBound)].sorted()
    return "the content \(pointsText(ends[0])) to \(pointsText(ends[1])) points \(way)"
  }

  /// Bands of moves as a failure says them: each `describe`d, "or" between them.
  static func describe(_ windows: [ClosedRange<CGFloat>]) -> String {
    windows.map { describe($0) }.joined(separator: " or ")
  }

  /// Moves as a failure says them, each signed, the content up the screen positive: "0.0, 10.5".
  static func describe(moves: [CGFloat]) -> String {
    moves.map { pointsText($0) }.joined(separator: ", ")
  }

  var description: String {
    "\(pointsText(up)) points up, \(pointsText(down)) down"
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
    "app-name", "place", "settings", "approximate", "use-my-location", "views",
  ]

  private(set) var unexpected: [String] = []
  private(set) var allowed: [String] = []
  /// The indexes of the exceptions that allowed an issue.
  private(set) var used: Set<Int> = []
  /// The page's issues held until its last screenful.
  private var held: [Held] = []

  /// How much had been noted at a moment of a page's audit, for `drop(since:)`.
  struct Mark {
    let unexpected: Int
    let allowed: Int
    let held: Int
    let used: Set<Int>
  }

  var mark: Mark {
    Mark(unexpected: unexpected.count, allowed: allowed.count, held: held.count, used: used)
  }

  /// Drops every issue noted since `mark`, judged or held, and the exceptions' use by them: those
  /// of a screenful whose call stopped, whose content is audited again in all three calls a few
  /// points away (`HomeAuditTests.auditAgain`), so that none is counted twice.
  func drop(since mark: Mark) {
    unexpected = Array(unexpected.prefix(mark.unexpected))
    allowed = Array(allowed.prefix(mark.allowed))
    held = Array(held.prefix(mark.held))
    used = mark.used
  }

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
