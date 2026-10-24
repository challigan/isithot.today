import XCTest

/// The home screen's accessibility audits and its screens for the contact sheet (iOS build spec,
/// sections 16, 17.2 and phase 5's exit): spec 17.2's `AccessibilityAuditTests` for the home
/// screen; the later phases audit their own screens. Every page (Now, Today or Tomorrow, This
/// week) of aberdeen-snow, durham-tomorrow and leeds-dry, at Large (the default text size) and
/// at AX3 (an accessibility size, set through UIKit's preferred content size category), each on
/// its fixture at its own moment with the clock fixed: XCUITest's
/// `performAccessibilityAudit()` (iOS 17) for every kind of issue on each screenful of the page,
/// from its top down to the credits at its end, since an audit reads only what is on screen; and
/// each screenful attached.
///
/// The attachments are named so that the contact sheet, which tiles them in their names' order
/// (`ci/contact-sheet.mjs`), shows them fixture by fixture, Large then AX3, each page in the
/// switcher's order, top to bottom: `home-<fixture>-1-large-1-now-01`, `…-1-large-1-now-02`, …,
/// `…-1-large-2-today-01` (or `-2-tomorrow-01`), …, `…-1-large-3-this-week-01`, …, then
/// `home-<fixture>-2-ax3-1-now-01` and so on.
///
/// Every issue an audit finds fails the test, but for the exceptions in `exceptions`, each with
/// why it isn't a fault to fix in the app.
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

  /// The most screenfuls a page is audited in, top to bottom. At AX3 the longest page, the
  /// week's, has about ten under the top bar and the switcher's stacked buttons.
  static let screenfuls = 15

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
    let found = AuditLog(tabs: screen.pages.map(\.label))
    for (index, page) in screen.pages.enumerated() {
      try tap(page, in: app)
      XCTAssertEqual(app.heading.label, page.heading, "\(page.view) page at \(order)")
      let tab = page.label.lowercased().replacingOccurrences(of: " ", with: "-")
      try audit(page, as: "home-\(name)-\(order)-\(index + 1)-\(tab)", in: app, noting: found)
    }
    XCTAssertTrue(
      found.unexpected.isEmpty,
      "\(found.unexpected.count) accessibility issues on \(name) at \(order):\n"
        + found.unexpected.joined(separator: "\n"))
    for allowed in found.allowed {
      print("Allowed accessibility issue on \(name) at \(order): \(allowed)")
    }
    for (index, exception) in Self.exceptions.enumerated() where !found.used.contains(index) {
      print("Accessibility exception not needed on \(name) at \(order): \(exception.why)")
    }
  }

  /// Audits the page on screen a screenful at a time, from its top (where it is on its first
  /// showing) down to the end of the credits, its last lines, attaching each screenful as
  /// `<name>-<k>`, k from 01. Fails when the credits aren't there, or their end never comes into
  /// view.
  @MainActor
  private func audit(
    _ page: HomeScreen.Page,
    as name: String,
    in app: XCUIApplication,
    noting found: AuditLog
  ) throws {
    let shown = app.find("page-\(page.view)")
    let credits = app.find("credits")
    guard credits.exists else {
      XCTFail("\(page.view) page: no credits at its end")
      return
    }
    for screenful in 1...Self.screenfuls {
      attach(app, as: "\(name)-\(String(format: "%02d", screenful))")
      let place = "\(page.view) page, screenful \(screenful)"
      let creditsFrame = credits.frame
      try app.performAccessibilityAudit(for: .all) { issue in
        found.note(issue, on: place, credits: creditsFrame)
        return true
      }
      // The credits' end is on screen: the whole page has been audited.
      if credits.frame.maxY <= shown.frame.maxY { return }
      let before = credits.frame
      scrollDown(page, in: app)
      // The page scrolls no further: its end is under the bottom edge's inset, and on screen.
      if credits.frame == before { return }
    }
    XCTFail("\(page.view) page: its end never came into view in \(Self.screenfuls) screenfuls")
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
@MainActor
private final class AuditLog {
  /// The switcher's tabs, as the screen's pages label themselves.
  let tabs: [String]
  private(set) var unexpected: [String] = []
  private(set) var allowed: [String] = []
  /// The indexes of the exceptions that allowed an issue.
  private(set) var used: Set<Int> = []

  init(tabs: [String]) {
    self.tabs = tabs
  }

  func note(_ issue: XCUIAccessibilityAuditIssue, on page: String, credits: CGRect) {
    let element = AuditedElement(
      identifier: issue.element?.identifier ?? "",
      label: issue.element?.label ?? "",
      frame: issue.element?.frame ?? .null,
      tabs: tabs,
      credits: credits
    )
    let kind = Self.name(of: issue.auditType)
    let text =
      "\(page): \(kind): \(issue.compactDescription) (element \"\(element.identifier)\", "
      + "\"\(element.label)\"): \(issue.detailedDescription)"
    let exception = HomeAuditTests.exceptions.firstIndex {
      $0.type == issue.auditType && $0.matches(element)
    }
    if let exception {
      used.insert(exception)
      allowed.append("\(text). Allowed: \(HomeAuditTests.exceptions[exception].why)")
    } else {
      unexpected.append(text)
    }
  }

  /// The audit type's name, as Apple's documentation spells it: the kinds an audit reports on
  /// iOS. (`action` and `parentChild` are macOS's alone, and not in the iOS SDK.)
  private static func name(of type: XCUIAccessibilityAuditType) -> String {
    let names: [(XCUIAccessibilityAuditType, String)] = [
      (.contrast, "contrast"), (.elementDetection, "elementDetection"),
      (.hitRegion, "hitRegion"), (.sufficientElementDescription, "sufficientElementDescription"),
      (.dynamicType, "dynamicType"), (.textClipped, "textClipped"), (.trait, "trait"),
    ]
    let found = names.filter { type.contains($0.0) }.map(\.1)
    return found.isEmpty ? "type \(type.rawValue)" : found.joined(separator: ", ")
  }
}
