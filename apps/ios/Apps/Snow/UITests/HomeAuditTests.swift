import XCTest

/// The home screen's accessibility audits and its screens for the contact sheet (iOS build spec,
/// sections 16, 17.2 and phase 5's exit): spec 17.2's `AccessibilityAuditTests` for the home
/// screen; the later phases audit their own screens. Every page (Now, Today or Tomorrow, This
/// week) of aberdeen-snow, durham-tomorrow and leeds-dry, at Large (the default text size) and
/// at AX3 (an accessibility size, set through UIKit's preferred content size category), each on
/// its fixture at its own moment with the clock fixed: XCUITest's
/// `performAccessibilityAudit()` (iOS 17) for every kind of issue, and the screen attached.
///
/// The attachments are named so that the contact sheet, which tiles them in their names' order
/// (`ci/contact-sheet.mjs`), shows them fixture by fixture, Large then AX3, each in the
/// switcher's order: `home-<fixture>-1-large-1-now`, `…-1-large-2-today` (or `-2-tomorrow`),
/// `…-1-large-3-this-week`, then `home-<fixture>-2-ax3-1-now` and so on.
///
/// Every issue an audit finds fails the test, but for the exceptions in `exceptions`, each with
/// why it isn't one. There are none: an issue is fixed in the app, or, when it is the audit's
/// mistake, added there with its reason.
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

  /// An issue the audit raises that isn't one, and why: which kind, and how to know it.
  struct Exception {
    let type: XCUIAccessibilityAuditType
    /// Whether `issue` is this exception, from its description and its element's identifier.
    let matches: (_ description: String, _ identifier: String) -> Bool
    let why: String
  }

  /// The issues allowed, each with its reason. None so far.
  static let exceptions: [Exception] = []

  /// Opens `name` at `size`, and for each page in the switcher's order shows it by its tab,
  /// checks its heading, attaches it for the contact sheet and audits it. Fails, once, listing
  /// every issue found on any page that isn't an exception.
  @MainActor
  private func audit(_ name: String, at size: TextSize) throws {
    let screen = try HomeScreen.named(name)
    let app = try launch(screen, size: size)
    let order: String
    switch size {
    case .large: order = "1-large"
    case .ax3: order = "2-ax3"
    }
    let found = AuditLog()
    for (index, page) in screen.pages.enumerated() {
      try tap(page, in: app)
      XCTAssertEqual(app.heading.label, page.heading, "\(page.view) page at \(order)")
      let tab = page.label.lowercased().replacingOccurrences(of: " ", with: "-")
      attach(app, as: "home-\(name)-\(order)-\(index + 1)-\(tab)")
      try app.performAccessibilityAudit(for: .all) { issue in
        found.note(issue, on: "\(page.view) page")
        return true
      }
    }
    XCTAssertTrue(
      found.unexpected.isEmpty,
      "\(found.unexpected.count) accessibility issues on \(name) at \(order):\n"
        + found.unexpected.joined(separator: "\n"))
    for allowed in found.allowed {
      print("Allowed accessibility issue on \(name) at \(order): \(allowed)")
    }
  }
}

/// What the audits found: the issues that fail the test, and those allowed, each described with
/// its kind, its element and the page it was on.
@MainActor
private final class AuditLog {
  private(set) var unexpected: [String] = []
  private(set) var allowed: [String] = []

  func note(_ issue: XCUIAccessibilityAuditIssue, on page: String) {
    let identifier = issue.element?.identifier ?? ""
    let label = issue.element?.label ?? ""
    let kind = Self.name(of: issue.auditType)
    let text =
      "\(page): \(kind): \(issue.compactDescription) (element \"\(identifier)\", "
      + "\"\(label)\"): \(issue.detailedDescription)"
    let exception = HomeAuditTests.exceptions.first {
      $0.type == issue.auditType && $0.matches(issue.compactDescription, identifier)
    }
    if let exception {
      allowed.append("\(text). Allowed: \(exception.why)")
    } else {
      unexpected.append(text)
    }
  }

  /// The audit type's name, as Apple's documentation spells it.
  private static func name(of type: XCUIAccessibilityAuditType) -> String {
    let names: [(XCUIAccessibilityAuditType, String)] = [
      (.contrast, "contrast"), (.elementDetection, "elementDetection"),
      (.hitRegion, "hitRegion"), (.sufficientElementDescription, "sufficientElementDescription"),
      (.dynamicType, "dynamicType"), (.textClipped, "textClipped"), (.trait, "trait"),
      (.action, "action"), (.parentChild, "parentChild"),
    ]
    let found = names.filter { type.contains($0.0) }.map(\.1)
    return found.isEmpty ? "type \(type.rawValue)" : found.joined(separator: ", ")
  }
}
