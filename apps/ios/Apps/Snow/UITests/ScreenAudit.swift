import XCTest

/// Section 16's accessibility audit of the screen on show, as the picker's and Settings' UI tests
/// run it: XCUITest's `performAccessibilityAudit(for: .all)` (iOS 17), every kind of issue. Each
/// issue is noted with its kind, its element (type, identifier, label and frame on screen) and
/// Apple's description; then the test fails once, listing them all, so one run shows every issue
/// on the screen rather than stopping at the first (these tests stop at their first failure).
/// There are no exceptions: an issue is fixed in the app.
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
    "\(found.lines.count) accessibility issues on \(screen), in the window at \(app.frame):\n"
      + found.lines.joined(separator: "\n"),
    file: file, line: line)
}

/// The issues one audit found, each described.
@MainActor
private final class AuditIssues {
  private(set) var lines: [String] = []

  func note(_ issue: XCUIAccessibilityAuditIssue) {
    lines.append(
      "\(issue.auditType.names): \(issue.compactDescription) (\(describeElement(issue.element))): "
        + issue.detailedDescription)
  }
}

/// An audited element as a failure names it: its type, identifier and label, and its frame on
/// screen, by which an element with neither identifier nor label can still be told apart (on
/// main's first macOS run, one such element failed every screenful of every home page, and the
/// log couldn't say what it was).
@MainActor
func describeElement(_ element: XCUIElement?) -> String {
  guard let element else { return "no element" }
  return describeElement(element.elementType, element.identifier, element.label, element.frame)
}

/// An element as a failure names it, from what was read of it.
func describeElement(
  _ type: XCUIElement.ElementType,
  _ identifier: String,
  _ label: String,
  _ frame: CGRect
) -> String {
  "element \(type.name) \"\(identifier)\", \"\(label)\" at \(frame)"
}

extension XCUIAccessibilityAuditType {
  /// The kinds of issue in the type, as Apple's documentation spells them: those an audit
  /// reports on iOS. (`action` and `parentChild` are macOS's alone, and not in the iOS SDK.)
  var names: String {
    let names: [(XCUIAccessibilityAuditType, String)] = [
      (.contrast, "contrast"), (.elementDetection, "elementDetection"),
      (.hitRegion, "hitRegion"), (.sufficientElementDescription, "sufficientElementDescription"),
      (.dynamicType, "dynamicType"), (.textClipped, "textClipped"), (.trait, "trait"),
    ]
    let found = names.filter { contains($0.0) }.map(\.1)
    return found.isEmpty ? "type \(rawValue)" : found.joined(separator: ", ")
  }
}

extension XCUIElement.ElementType {
  /// The type's name, as XCUITest spells it, for the kinds the app's screens have; any other by
  /// its raw value.
  var name: String {
    let names: [(XCUIElement.ElementType, String)] = [
      (.other, "other"), (.application, "application"), (.group, "group"), (.window, "window"),
      (.sheet, "sheet"), (.alert, "alert"), (.button, "button"), (.staticText, "staticText"),
      (.link, "link"), (.image, "image"), (.scrollView, "scrollView"), (.table, "table"),
      (.cell, "cell"), (.collectionView, "collectionView"), (.searchField, "searchField"),
      (.textField, "textField"), (.segmentedControl, "segmentedControl"),
      (.navigationBar, "navigationBar"), (.keyboard, "keyboard"),
      (.activityIndicator, "activityIndicator"), (.progressIndicator, "progressIndicator"),
    ]
    return names.first { $0.0 == self }?.1 ?? "type \(rawValue)"
  }
}
