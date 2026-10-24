import XCTest

/// Section 16's accessibility audit of the screen on show, as the picker's and Settings' UI tests
/// run it: XCUITest's `performAccessibilityAudit(for: .all)` (iOS 17), every kind of issue. Each
/// issue is noted with its kind, its element's identifier and label, and Apple's description;
/// then the test fails once, listing them all, so one run shows every issue on the screen rather
/// than stopping at the first (these tests stop at their first failure). There are no
/// exceptions: an issue is fixed in the app.
@MainActor
func auditAccessibility(
  of app: XCUIApplication, on screen: String, file: StaticString = #filePath, line: UInt = #line
) throws {
  let found = AuditIssues()
  try app.performAccessibilityAudit(for: .all) { issue in
    found.note(issue)
    // Noted, so the audit doesn't fail on it alone: the assertion below fails once for all.
    return true
  }
  XCTAssertTrue(
    found.lines.isEmpty,
    "\(found.lines.count) accessibility issues on \(screen):\n"
      + found.lines.joined(separator: "\n"),
    file: file, line: line)
}

/// The issues one audit found, each described.
@MainActor
private final class AuditIssues {
  private(set) var lines: [String] = []

  func note(_ issue: XCUIAccessibilityAuditIssue) {
    let identifier = issue.element?.identifier ?? ""
    let label = issue.element?.label ?? ""
    lines.append(
      "type \(issue.auditType.rawValue): \(issue.compactDescription) (element \"\(identifier)\", "
        + "\"\(label)\"): \(issue.detailedDescription)")
  }
}
