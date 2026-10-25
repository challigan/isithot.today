import UIKit
import XCTest

/// Section 16's accessibility audit of the screen on show, as the picker's and Settings' UI tests
/// run it: XCUITest's `performAccessibilityAudit(for:)` (iOS 17), every kind of issue, in the three
/// calls `AuditKinds.passes`, each through `runAudit`, which times it and runs it again once
/// should it not finish in time. Each issue is noted with its kind, its element (type,
/// identifier, label and frame on screen) and Apple's description, and a contrast issue with the
/// screen's pixels inside its element (`PixelRange`, `DrawnText`); then the test fails once,
/// listing them all, so one run shows every issue on the screen rather than stopping at the first
/// (these tests stop at their first failure).
///
/// One issue is allowed, as on the home screen: contrast on a text element whose pixels prove it
/// is text drawn in `surface`'s own colours at 4.5:1 or more (`MeasuredContrast`; DECISIONS,
/// "Contrast by measured pixels, after #34's first full run"), the picker's in the band of the
/// page it opened over and Settings' in the content palette. Nothing else is: every other issue
/// is the app's to fix. (The toolbars' Close buttons, which failed Dynamic Type as text on PR
/// #33's first macOS run, are icons now; Your privacy's back button, a bar button too, passed.)
/// Should a system control the app can't change fail, an exception would match it as one of
/// `app.navigationBars`' or the search bar's by its place, with the run's evidence, not by an
/// identifier it may not have.
///
/// The screen as audited and the app's element tree are attached first, as
/// `audit-<screen>` and `audit-<screen>-tree`: on PR #33's second macOS run each failing sheet's
/// test stopped at its audit, before it attached its screen, so nothing showed what the audit
/// had read. Each call's time is attached as `audit-<screen>-times`, however the audit ends, and
/// the issues allowed as `audit-<screen>-allowed`, which the failure lists too, so that a proof
/// that allows too much shows in every run.
extension XCTestCase {
  @MainActor
  func auditAccessibility(
    of app: XCUIApplication,
    on screen: String,
    surface: ScreenSurface,
    file: StaticString = #filePath,
    line: UInt = #line
  ) throws {
    let found = AuditIssues(
      surface: try SurfaceFile.bundled().colours(surface, window: app.frame))
    let times = AuditTimes()
    // The screen as the first call audits it, for a contrast issue's pixels.
    let shot = app.screenshot()
    let name = "audit-" + slug(screen)
    attachPNG(shot, as: name)
    attachText(app.debugDescription, as: "\(name)-tree")
    defer { attachText(times.text, as: "\(name)-times") }
    // Where the screen's elements are as audited, so a call is run again only on this screen.
    let audited = ScreenLayout(app)
    for kinds in AuditKinds.passes {
      let issues = try runAudit(of: app, for: kinds, at: screen, timing: times) {
        guard app.state == .runningForeground else {
          return "the app isn't in the foreground (state \(app.state.rawValue))"
        }
        return ScreenLayout.change(from: audited, to: ScreenLayout(app))
      }
      for issue in issues {
        found.note(issue, shot: shot)
      }
    }
    let allowed = found.allowed.map { "Allowed: \($0)" }
    attachText(
      allowed.isEmpty ? "Nothing allowed on \(surface)" : allowed.joined(separator: "\n"),
      as: "\(name)-allowed")
    XCTAssertTrue(
      found.unexpected.isEmpty,
      "\(found.unexpected.count) accessibility issues on \(screen), on \(surface), in the window "
        + "at \(app.frame):\n" + (found.unexpected + allowed).joined(separator: "\n"),
      file: file, line: line)
  }

  /// Runs one audit call of `kinds` on the screen as it is, and gives the issues it found, in the
  /// order found, for the caller to read once the call is done: the handler only keeps each, so
  /// what the tests read of an issue (its element's properties, the credits' frame, a screenshot's
  /// pixels) is read outside the call, and outside XCTest's deadline for it. Each call's time,
  /// and its issues' count, go into `times`.
  ///
  /// A call that didn't finish in time (XCTest's "Audit failed to complete in time", -56,
  /// `isAuditTimeout`) runs once more, with the same kinds, 2 seconds later, only once `settled`
  /// finds the screen the one the call was to audit (nil; or why it isn't): the first attempt's
  /// issues are dropped, so none is counted twice. On PR #33's third macOS run the first call on
  /// the Now page's sixth screenful at AX3, the costliest screenful of the suite, then of all five
  /// kinds that read the screen as it is, ran some 17 seconds where about 7 were expected, with
  /// the app still on screen, and timed out; two other calls of that test ran about 2.5 times as
  /// long as expected and finished (those five kinds are two calls now, `AuditKinds`; DECISIONS,
  /// "The iPhone app's UI tests, after PR #33's third macOS run"). Any other error, a second
  /// failure, or a screen that isn't the one to audit throws (`AuditFailure`), with each attempt's
  /// error and time: every kind runs on every screen the test attaches, or the test fails.
  @MainActor
  func runAudit(
    of app: XCUIApplication,
    for kinds: XCUIAccessibilityAuditType,
    at place: String,
    timing times: AuditTimes,
    settled: () -> String?
  ) throws -> [XCUIAccessibilityAuditIssue] {
    let first = timedAudit(of: app, for: kinds)
    guard let error = first.error else {
      times.add(AuditTime(place, kinds, first.seconds, issues: first.issues.count))
      return first.issues
    }
    var failure = AuditFailure(place: place, kinds: kinds, first: error, after: first.seconds)
    guard isAuditTimeout(error) else {
      times.add(AuditTime(place, kinds, first.seconds, note: "failed: \(brief(error))"))
      throw failure
    }
    let timedOut = "timed out (-56) after \(secondsText(first.seconds)) s"
    RunLoop.current.run(until: Date().addingTimeInterval(2))
    if let why = settled() {
      failure.notRunAgain = why
      times.add(AuditTime(place, kinds, first.seconds, note: "\(timedOut); not run again: \(why)"))
      throw failure
    }
    let second = timedAudit(of: app, for: kinds)
    guard let again = second.error else {
      let note = "\(timedOut); ran again"
      times.add(AuditTime(place, kinds, second.seconds, issues: second.issues.count, note: note))
      return second.issues
    }
    failure.second = (again, second.seconds)
    let how =
      isAuditTimeout(again)
      ? "timed out (-56) after \(secondsText(second.seconds)) s" : "failed: \(brief(again))"
    times.add(AuditTime(place, kinds, second.seconds, note: "\(timedOut); ran again, \(how)"))
    throw failure
  }

  /// One audit call, timed, its issues kept as they come.
  @MainActor
  private func timedAudit(
    of app: XCUIApplication,
    for kinds: XCUIAccessibilityAuditType
  ) -> (issues: [XCUIAccessibilityAuditIssue], error: Error?, seconds: Double) {
    var issues: [XCUIAccessibilityAuditIssue] = []
    let start = ContinuousClock.now
    do {
      try app.performAccessibilityAudit(for: kinds) { issue in
        issues.append(issue)
        // Kept, so the audit doesn't fail on it alone: the caller fails once for all.
        return true
      }
    } catch {
      return (issues, error, seconds(since: start))
    }
    return (issues, nil, seconds(since: start))
  }

  /// Attaches `shot` to the result bundle as a PNG, kept, named `name`.
  @MainActor
  func attachPNG(_ shot: XCUIScreenshot, as name: String) {
    let attachment = XCTAttachment(
      data: shot.pngRepresentation, uniformTypeIdentifier: "public.png")
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  /// Attaches `text` to the result bundle, kept, named `name`.
  @MainActor
  func attachText(_ text: String, as name: String) {
    let attachment = XCTAttachment(string: text)
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}

/// A screen's name as an attachment's: lower case, each run of other characters a hyphen
/// ("the picker's results" is `the-picker-s-results`).
func slug(_ name: String) -> String {
  var out = ""
  for character in name.lowercased() {
    if character.isLetter || character.isNumber {
      out.append(character)
    } else if !out.isEmpty, out.last != "-" {
      out.append("-")
    }
  }
  return out.hasSuffix("-") ? String(out.dropLast()) : out
}

/// The audit's kinds, in the three calls the UI tests make for each screen, which together are
/// all of them: first the kinds that read the screen as it is, contrast and then the other four,
/// then the Dynamic Type and clipped-text checks, which lay the app out at other text sizes and
/// then put the size back. A page scrolled further than it can scroll at the size checked comes
/// back clamped to that size's end, short of where it was: on PR #33's macOS run every home page
/// scrolled past it went back between screenfuls, and the contrast measured after that check was
/// of a page the screenful's frames no longer described (DECISIONS, "The iPhone app's UI tests,
/// after PR #33's macOS run"). Contrast is first, so the screen it measures is the one in the
/// screenshot taken before the calls, whose pixels its issues are noted with. Two calls where the
/// screen is read as it is, not one: on PR #33's third macOS run the one call of those five kinds
/// took up to 10.8 seconds where it finished, against XCTest's deadline of about 17, and timed out
/// once, on the home's costliest screenful (DECISIONS, "The iPhone app's UI tests, after PR #33's
/// third macOS run"); each call has a deadline of its own.
enum AuditKinds {
  /// The checks that change the text size.
  static let resizing: XCUIAccessibilityAuditType = [.dynamicType, .textClipped]
  /// Contrast, measured on the screen as it is.
  static let contrast: XCUIAccessibilityAuditType = [.contrast]
  /// The other kinds that read the screen as it is: element detection, hit regions, descriptions
  /// and traits. These and `contrast` are named one by one, not `.all` less `resizing`: `.all` is
  /// every bit set, so that would ask for macOS's own kinds (`action`, `parentChild`) and bits no
  /// kind has, a set Apple neither documents nor shows, where these are the kinds the iOS SDK
  /// defines, all seven of them with `resizing`'s (`names` lists the same seven). A kind a later
  /// SDK adds is to be added here.
  static let described: XCUIAccessibilityAuditType = [
    .elementDetection, .hitRegion, .sufficientElementDescription, .trait,
  ]
  /// The calls, in order.
  static let passes = [contrast, described, resizing]
}

/// The issues one screen's audits found, each described: those that fail the test, and those
/// `MeasuredContrast` allows, contrast on text its screenshot's pixels prove at 4.5:1 or more on
/// `surface`.
@MainActor
private final class AuditIssues {
  let surface: SurfaceColours
  private(set) var unexpected: [String] = []
  private(set) var allowed: [String] = []

  init(surface: SurfaceColours) {
    self.surface = surface
  }

  func note(_ issue: XCUIAccessibilityAuditIssue, shot: XCUIScreenshot) {
    var text =
      "\(issue.auditType.names): \(issue.compactDescription) (\(describeElement(issue.element))): "
      + issue.detailedDescription
    guard issue.auditType == .contrast, let element = issue.element else {
      unexpected.append(text)
      return
    }
    let frame = element.frame
    var audited = AuditedElement(
      type: element.elementType, identifier: element.identifier, label: element.label,
      frame: frame, credits: .null)
    let pixels = ScreenPixels(shot, in: frame, window: surface.window)
    let drawn = DrawnText(
      ScreenPixels(shot, in: DrawnText.reading(frame), window: surface.window), in: frame,
      on: surface, withMarks: MeasuredContrast.drawsMarks(audited.type))
    audited.drawn = drawn
    let range = pixels.flatMap { PixelRange(rgba: $0.rgba) }
    text +=
      "; the screen's pixels there: \(range.map(\.description) ?? "can't be read"); "
      + surface.expected(in: frame) + "; " + drawn.description
    if MeasuredContrast.allows(audited) {
      allowed.append("\(text). Allowed: \(MeasuredContrast.why)")
    } else {
      unexpected.append(text)
    }
  }
}

/// What an exception knows of an issue's element: its type, identifier, label and frame on
/// screen, the screen's credits, where they are on screen (`.null` without, as on every sheet),
/// and for a contrast issue, what the screenshot shows drawn in its frame (`DrawnText`).
struct AuditedElement {
  let type: XCUIElement.ElementType?
  let identifier: String
  let label: String
  let frame: CGRect
  let credits: CGRect
  var drawn: DrawnText?
}

/// Whether `error` is XCTest's "Audit failed to complete in time": code -56 in its accessibility
/// audit's domain, which Apple doesn't document, nor how long the deadline is.
func isAuditTimeout(_ error: Error) -> Bool {
  let error = error as NSError
  return error.domain == "com.apple.xcode.xctest.accessibilityAudit" && error.code == -56
}

/// An error on one line, for a line of `AuditTimes`: its domain and code and its description.
func brief(_ error: Error) -> String {
  let error = error as NSError
  return "\(error.domain) \(error.code): \(error.localizedDescription)"
    .replacingOccurrences(of: "\t", with: " ").replacingOccurrences(of: "\n", with: " ")
}

/// The seconds since `start`.
func seconds(since start: ContinuousClock.Instant) -> Double {
  let elapsed = start.duration(to: .now).components
  return Double(elapsed.seconds) + Double(elapsed.attoseconds) / 1e18
}

/// Seconds as the times and failures give them: "17.2".
func secondsText(_ seconds: Double) -> String {
  String(format: "%.1f", seconds)
}

/// An audit call that failed (`runAudit`), as the test's failure says it: where, which kinds,
/// each attempt's error and time, and, for one that didn't finish in time and wasn't run again,
/// why not.
struct AuditFailure: Error, CustomStringConvertible, LocalizedError {
  let place: String
  let kinds: XCUIAccessibilityAuditType
  let first: Error
  let after: Double
  /// Why a call that didn't finish in time wasn't run again: the screen wasn't the one to audit.
  var notRunAgain: String?
  /// The second attempt's error and time.
  var second: (error: Error, after: Double)?

  init(place: String, kinds: XCUIAccessibilityAuditType, first: Error, after: Double) {
    self.place = place
    self.kinds = kinds
    self.first = first
    self.after = after
  }

  var description: String {
    let audit = "\(place): the audit of \(kinds.names)"
    let firstTime = "after \(secondsText(after)) s"
    guard isAuditTimeout(first) else { return "\(audit) didn't run (\(first)) \(firstTime)" }
    if let notRunAgain {
      return "\(audit) didn't finish in time (\(first)) \(firstTime), and wasn't run again: "
        + notRunAgain
    }
    guard let second else { return "\(audit) didn't finish in time (\(first)) \(firstTime)" }
    let secondTime = "after \(secondsText(second.after)) s"
    if isAuditTimeout(second.error) {
      return "\(audit) didn't finish in time twice: \(first) \(firstTime), then, run again on "
        + "the same screen once it had settled, \(second.error) \(secondTime)"
    }
    return "\(audit) didn't finish in time (\(first)) \(firstTime), then, run again on the "
      + "same screen once it had settled, didn't run (\(second.error)) \(secondTime)"
  }

  /// What XCTest reports of a test that throws it.
  var errorDescription: String? { description }
}

/// One audit call as `runAudit` timed it: where, which kinds, its seconds (the last attempt's),
/// how many issues it found, and what else befell it ("timed out (-56) after 17.2 s; ran again").
struct AuditTime {
  let place: String
  let kinds: XCUIAccessibilityAuditType
  let seconds: Double
  let issues: Int
  let note: String

  init(
    _ place: String,
    _ kinds: XCUIAccessibilityAuditType,
    _ seconds: Double,
    issues: Int = 0,
    note: String = ""
  ) {
    self.place = place
    self.kinds = kinds
    self.seconds = seconds
    self.issues = issues
    self.note = note
  }

  /// The attachment's columns, which ci/xcresult-summary.mjs `timings` reads.
  static let header = "seconds\tplace\tkinds\tissues\tnote"

  /// A line of the attachment, its fields tab-separated in `header`'s order.
  var line: String {
    [secondsText(seconds), place, kinds.names, "\(issues)", note].joined(separator: "\t")
  }

  /// For a test's report: "now page, screenful 6, contrast, …: 7.1 s, 0 issues".
  var summary: String {
    "\(place), \(kinds.names): \(secondsText(seconds)) s, \(issues) issue\(issues == 1 ? "" : "s")"
      + (note.isEmpty ? "" : "; \(note)")
  }
}

/// A test's or a screen's audit calls, timed (`runAudit`), attached as text a line a call
/// (`AuditTime.line`): `print` reaches neither the log nor the result bundle, so CI lists the
/// slowest calls and every one that timed out from the attachments (ci/xcresult-summary.mjs
/// `timings`), and a timeout's time says roughly how long XCTest's deadline is.
@MainActor
final class AuditTimes {
  private(set) var calls: [AuditTime] = []

  func add(_ time: AuditTime) {
    calls.append(time)
  }

  /// The attachment: the columns, then a line a call.
  var text: String {
    ([AuditTime.header] + calls.map(\.line)).joined(separator: "\n")
  }

  /// For a test's report: its slowest call, then each other that didn't go as a call should.
  var report: [String] {
    guard let slowest = calls.indices.max(by: { calls[$0].seconds < calls[$1].seconds }) else {
      return []
    }
    let others = calls.indices.filter { $0 != slowest && !calls[$0].note.isEmpty }
    return ["Slowest audit call: \(calls[slowest].summary)"]
      + others.map { "Audit call: \(calls[$0].summary)" }
  }
}

/// The screen's elements as one snapshot of the app has them, but those of type `other` (the
/// containers, and scroll bars that come and go), each by its type, identifier, label and frame:
/// by which an audit call that didn't finish in time runs again only on the screen it was to
/// audit (`runAudit`).
struct ScreenLayout {
  struct Element {
    let type: XCUIElement.ElementType
    let identifier: String
    let label: String
    let frame: CGRect
  }

  let elements: [Element]

  /// Of the app now; nil when it can't be read.
  @MainActor
  init?(_ app: XCUIApplication) {
    guard let root = try? app.snapshot() else { return nil }
    self.init(root)
  }

  /// Of `root`'s tree, in its order.
  @MainActor
  init(_ root: any XCUIElementSnapshot) {
    var found: [Element] = []
    var pending = [root]
    while let node = pending.popLast() {
      if node.elementType != .other {
        found.append(
          Element(
            type: node.elementType, identifier: node.identifier, label: node.label,
            frame: node.frame))
      }
      pending.append(contentsOf: node.children.reversed())
    }
    elements = found
  }

  /// How the screen `now` differs from the screen `audited`, or nil when each element is there,
  /// of the same type and identifier, within a point of where it was (labels may change: a
  /// line that says the time).
  static func change(from audited: ScreenLayout?, to now: ScreenLayout?) -> String? {
    guard let audited, let now else { return "the screen's elements can't be read" }
    guard now.elements.count == audited.elements.count else {
      return "the screen has \(now.elements.count) elements, where it had "
        + "\(audited.elements.count) as audited"
    }
    for (before, after) in zip(audited.elements, now.elements) {
      let (a, b) = (before.frame, after.frame)
      let near =
        abs(a.minX - b.minX) < 1 && abs(a.minY - b.minY) < 1 && abs(a.width - b.width) < 1
        && abs(a.height - b.height) < 1
      if before.type != after.type || before.identifier != after.identifier || !near {
        return "the screen's " + describeElement(after.type, after.identifier, after.label, b)
          + " was " + describeElement(before.type, before.identifier, before.label, a)
          + " as audited"
      }
    }
    return nil
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

/// An sRGB colour, a screenshot's pixel or a palette's `#rrggbb`, with WCAG 2's luminance and
/// contrast, as scripts/palette-contrast.mjs and packages/mobile `exportPalettes.ts` work them out.
/// Hashable, so the contrast proof works a surface's colours out once for each background colour
/// (`DrawnText`).
struct RGB: Hashable, CustomStringConvertible {
  let red: UInt8
  let green: UInt8
  let blue: UInt8

  init(red: UInt8, green: UInt8, blue: UInt8) {
    self.red = red
    self.green = green
    self.blue = blue
  }

  /// `#rrggbb`; nil for anything else.
  init?(hex: String) {
    guard hex.count == 7, hex.hasPrefix("#"), let value = UInt32(hex.dropFirst(), radix: 16)
    else { return nil }
    self.init(
      red: UInt8((value >> 16) & 0xff), green: UInt8((value >> 8) & 0xff),
      blue: UInt8(value & 0xff))
  }

  var description: String {
    "#"
      + [red, green, blue].map { channel in
        let digits = String(channel, radix: 16)
        return channel < 16 ? "0" + digits : digits
      }.joined()
  }

  /// Each 8-bit channel's linear value, WCAG 2's formula.
  private static let linear: [Double] = (0...255).map { channel in
    let value = Double(channel) / 255
    return value <= 0.03928 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
  }

  /// WCAG 2's relative luminance, 0 to 1.
  var luminance: Double {
    0.2126 * Self.linear[Int(red)] + 0.7152 * Self.linear[Int(green)] + 0.0722
      * Self.linear[Int(blue)]
  }

  /// WCAG 2's contrast ratio with `other`, 1 to 21.
  func contrast(with other: RGB) -> Double {
    let (a, b) = (luminance, other.luminance)
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)
  }

  /// Whether each channel is within `levels` of `other`'s.
  func within(_ levels: Int, of other: RGB) -> Bool {
    abs(Int(red) - Int(other.red)) <= levels && abs(Int(green) - Int(other.green)) <= levels
      && abs(Int(blue) - Int(other.blue)) <= levels
  }

  /// This colour taken `amount` (0 to 1) of the way to `other`, channel by channel in sRGB, as
  /// SwiftUI mixes a gradient's stops and lays a colour over another at an opacity: worked out as
  /// packages/mobile brandColours.ts `mix` does, `a + (b - a) × t` rounded, so the two round each
  /// half level the same way (`SurfaceFile.mismatches`).
  func mixed(with other: RGB, by amount: Double) -> RGB {
    let t = min(max(amount, 0), 1)
    func mix(_ a: UInt8, _ b: UInt8) -> UInt8 {
      UInt8((Double(a) + (Double(b) - Double(a)) * t).rounded())
    }
    return RGB(
      red: mix(red, other.red), green: mix(green, other.green), blue: mix(blue, other.blue))
  }

  /// Whether this colour lies on the line from `a` to `b`, to within `levels` a channel of its
  /// nearest point: a blend of the two, as anti-aliasing draws where they meet.
  func between(_ a: RGB, _ b: RGB, within levels: Int) -> Bool {
    let from = [Double(a.red), Double(a.green), Double(a.blue)]
    let step = [Double(b.red) - from[0], Double(b.green) - from[1], Double(b.blue) - from[2]]
    let mine = [Double(red), Double(green), Double(blue)]
    let length = step.reduce(0) { $0 + $1 * $1 }
    let along = (0..<3).reduce(0) { $0 + (mine[$1] - from[$1]) * step[$1] }
    let t = length == 0 ? 0 : min(max(along / length, 0), 1)
    return (0..<3).allSatisfy { abs(mine[$0] - (from[$0] + step[$0] * t)) <= Double(levels) }
  }
}

/// A contrast ratio as a failure says it: "4.52:1".
func ratio(_ value: Double) -> String {
  let hundredths = Int((value * 100).rounded())
  let cents = hundredths % 100
  return "\(hundredths / 100).\(cents < 10 ? "0" : "")\(cents):1"
}

/// A screenshot's pixels inside a frame on screen, read once: 8-bit red, green, blue and alpha,
/// four bytes each (the alpha unread: a screenshot is opaque), row by row, `width` by `height`,
/// the first pixel's top-left corner at `origin` on screen, `scale` pixels to the point.
struct ScreenPixels {
  let rgba: [UInt8]
  let width: Int
  let height: Int
  let origin: CGPoint
  let scale: CGFloat

  init(rgba: [UInt8], width: Int, height: Int, origin: CGPoint, scale: CGFloat) {
    self.rgba = rgba
    self.width = width
    self.height = height
    self.origin = origin
    self.scale = scale
  }

  /// The pixel `x` across and `y` down.
  func pixel(_ x: Int, _ y: Int) -> RGB {
    let index = (y * width + x) * 4
    return RGB(red: rgba[index], green: rgba[index + 1], blue: rgba[index + 2])
  }

  /// The point on screen at the centre of the pixel `x` across and `y` down.
  func point(_ x: Int, _ y: Int) -> CGPoint {
    CGPoint(x: origin.x + (CGFloat(x) + 0.5) / scale, y: origin.y + (CGFloat(y) + 0.5) / scale)
  }

  /// Inside `frame`, in points on screen, of `shot`, a screenshot of the window at `window`; nil
  /// when the frame is off the screenshot or it can't be read.
  init?(_ shot: XCUIScreenshot, in frame: CGRect, window: CGRect) {
    guard let image = shot.image.cgImage, window.width > 0, !frame.isNull else { return nil }
    let scale = CGFloat(image.width) / window.width
    let wanted = CGRect(
      x: (frame.minX - window.minX) * scale, y: (frame.minY - window.minY) * scale,
      width: frame.width * scale, height: frame.height * scale
    ).integral
    let pixels = wanted.intersection(CGRect(x: 0, y: 0, width: image.width, height: image.height))
    guard !pixels.isNull, !pixels.isEmpty, let crop = image.cropping(to: pixels),
      let space = CGColorSpace(name: CGColorSpace.sRGB)
    else { return nil }
    let (width, height) = (crop.width, crop.height)
    var bytes = [UInt8](repeating: 0, count: width * height * 4)
    let drawn = bytes.withUnsafeMutableBytes { buffer -> Bool in
      guard
        let context = CGContext(
          data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
          bytesPerRow: width * 4, space: space,
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
      else { return false }
      context.draw(crop, in: CGRect(x: 0, y: 0, width: width, height: height))
      return true
    }
    guard drawn else { return nil }
    self.init(
      rgba: bytes, width: width, height: height,
      origin: CGPoint(x: window.minX + pixels.minX / scale, y: window.minY + pixels.minY / scale),
      scale: scale)
  }
}

/// What a screenshot shows inside an element's frame: its darkest and lightest pixels, by WCAG
/// luminance, and the contrast between them. Text drawn whole in its colour on a plain or gently
/// graded background has its stroke's colour at one end and the background's at the other, so a
/// contrast failure on an element whose pixels give 4.5:1 or more was measured on something the
/// screenshot doesn't show; one whose pixels give less shows the colours drawn. For the log, since
/// the screenshots and the xcresult can't be read off the runner by agents (on PR #33's first
/// macOS run the home's text buttons and five two-line details failed contrast with colours that
/// pass at 5.42:1 or more; on its second, the pixels gave 6.15:1 to 14.61:1).
struct PixelRange: CustomStringConvertible {
  let darkest: RGB
  let lightest: RGB

  var contrast: Double { darkest.contrast(with: lightest) }

  var description: String {
    "darkest \(darkest), lightest \(lightest), \(ratio(contrast)) between them"
  }

  /// Of pixels given as 8-bit red, green, blue and alpha, four bytes each (the alpha unread: a
  /// screenshot is opaque); nil for none.
  init?(rgba: [UInt8]) {
    var darkest: (RGB, Double)?
    var lightest: (RGB, Double)?
    var index = 0
    while index + 3 < rgba.count {
      let pixel = RGB(red: rgba[index], green: rgba[index + 1], blue: rgba[index + 2])
      let luminance = pixel.luminance
      if darkest.map({ luminance < $0.1 }) ?? true { darkest = (pixel, luminance) }
      if lightest.map({ luminance > $0.1 }) ?? true { lightest = (pixel, luminance) }
      index += 4
    }
    guard let darkest, let lightest else { return nil }
    self.darkest = darkest.0
    self.lightest = lightest.0
  }
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
