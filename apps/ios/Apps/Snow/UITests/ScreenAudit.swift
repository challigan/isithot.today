import UIKit
import XCTest

/// Section 16's accessibility audit of the screen on show, as the picker's and Settings' UI tests
/// run it: XCUITest's `performAccessibilityAudit(for:)` (iOS 17), every kind of issue, in the two
/// calls `AuditKinds.passes`. Each issue is noted with its kind, its element (type, identifier,
/// label and frame on screen) and Apple's description, and a contrast issue with the screen's
/// pixels inside its element (`PixelRange`); then the test fails once, listing them all, so one
/// run shows every issue on the screen rather than stopping at the first (these tests stop at
/// their first failure). Every issue is the app's to fix, but for those `exceptions` allow, each
/// standing only while its control passes (`ScreenException`). (The toolbars' Close buttons,
/// which failed Dynamic Type as text on PR #33's first macOS run, are icons now; Your privacy's
/// back button, a bar button too, passed.) Should a system control the app can't change fail,
/// its exception would match it as one of `app.navigationBars`' or the search bar's by its
/// place, with the run's evidence, not by an identifier it may not have.
///
/// The screen as audited and the app's element tree are attached first, as
/// `audit-<screen>` and `audit-<screen>-tree`: on PR #33's second macOS run each failing sheet's
/// test stopped at its audit, before it attached its screen, so nothing showed what the audit
/// had read. The issues allowed and the exceptions no issue needed are attached as
/// `audit-<screen>-allowed`, and the failure lists them too.
extension XCTestCase {
  @MainActor
  func auditAccessibility(
    of app: XCUIApplication,
    on screen: String,
    allowing exceptions: [ScreenException] = [],
    file: StaticString = #filePath,
    line: UInt = #line
  ) throws {
    let found = AuditIssues()
    // The screen as the first call audits it, for a contrast issue's pixels.
    let shot = app.screenshot()
    let window = app.frame
    let name = "audit-" + slug(screen)
    attachPNG(shot, as: name)
    attachText(app.debugDescription, as: "\(name)-tree")
    // An exception's control on screen before the audit, which can't tell one it didn't read.
    let shown = Set(exceptions.map(\.control).filter { app.staticTexts[$0].exists })
    for kinds in AuditKinds.passes {
      try app.performAccessibilityAudit(for: kinds) { issue in
        found.note(issue, shot: shot, window: window)
        // Noted, so the audit doesn't fail on it alone: the assertion below fails once for all.
        return true
      }
    }
    let judged = found.judged(by: exceptions, controlsShown: shown)
    if !exceptions.isEmpty {
      let unneeded = exceptions.filter { !judged.used.contains($0.why) }
      attachText(
        (judged.allowed.map { "Allowed: \($0)" } + unneeded.map { "Not needed: \($0.why)" })
          .joined(separator: "\n"), as: "\(name)-allowed")
    }
    XCTAssertTrue(
      judged.unexpected.isEmpty,
      "\(judged.unexpected.count) accessibility issues on \(screen), in the window at "
        + "\(app.frame):\n"
        + (judged.unexpected + judged.allowed.map { "Allowed: \($0)" })
        .joined(separator: "\n"),
      file: file, line: line)
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

/// An issue a sheet's audit allows, matched as narrowly as its element can be: an issue of
/// `type` whose short description says `says`, on a static text labelled one of `labels`. It
/// stands only while `control`, a static text of the same view and style, is on screen as the
/// audit begins and the audit raises no issue of `type` on it: should the texts stop doing what
/// the exception says they do, the control fails too, and the exception no longer applies.
struct ScreenException {
  let type: XCUIAccessibilityAuditType
  let says: String
  let labels: Set<String>
  let control: String
  let why: String
}

/// The audit's kinds, in the two calls the UI tests make for each screen, which together are all
/// of them: first every kind that reads the screen as it is, then the Dynamic Type and clipped-text
/// checks, which lay the app out at other text sizes and then put the size back. A page scrolled
/// further than it can scroll at the size checked comes back clamped to that size's end, short of
/// where it was: on PR #33's macOS run every home page scrolled past it went back between
/// screenfuls, and the contrast measured after that check was of a page the screenful's frames no
/// longer described (DECISIONS, "The iPhone app's UI tests, after PR #33's macOS run").
enum AuditKinds {
  /// The checks that change the text size.
  static let resizing: XCUIAccessibilityAuditType = [.dynamicType, .textClipped]
  /// The others: contrast, element detection, hit regions, descriptions and traits. Named one by
  /// one, not `.all` less `resizing`: `.all` is every bit set, so that would ask for macOS's own
  /// kinds (`action`, `parentChild`) and bits no kind has, a set Apple neither documents nor
  /// shows, where these are the kinds the iOS SDK defines, all seven of them with `resizing`'s
  /// (`names` lists the same seven). A kind a later SDK adds is to be added here.
  static let inPlace: XCUIAccessibilityAuditType = [
    .contrast, .elementDetection, .hitRegion, .sufficientElementDescription, .trait,
  ]
  /// The calls, in order.
  static let passes = [inPlace, resizing]
}

/// The issues one screen's audits found, each described, with what an exception reads of it.
@MainActor
private final class AuditIssues {
  struct Noted {
    let type: XCUIAccessibilityAuditType
    let elementType: XCUIElement.ElementType?
    let label: String
    let compact: String
    let text: String
  }

  private(set) var noted: [Noted] = []

  /// Each issue's description, in the order found.
  var lines: [String] { noted.map(\.text) }

  func note(_ issue: XCUIAccessibilityAuditIssue, shot: XCUIScreenshot, window: CGRect) {
    var text =
      "\(issue.auditType.names): \(issue.compactDescription) (\(describeElement(issue.element))): "
      + issue.detailedDescription
    if issue.auditType == .contrast, let element = issue.element {
      let pixels = PixelRange(shot, in: element.frame, window: window)
      text += "; the screen's pixels there: " + (pixels.map(\.description) ?? "can't be read")
    }
    noted.append(
      Noted(
        type: issue.auditType, elementType: issue.element?.elementType,
        label: issue.element?.label ?? "", compact: issue.compactDescription, text: text))
  }

  /// The issues `exceptions` don't allow, those they do (each with why), and the reasons of the
  /// exceptions that allowed any; `controlsShown`, the controls on screen as the audit began.
  func judged(
    by exceptions: [ScreenException],
    controlsShown: Set<String>
  ) -> (unexpected: [String], allowed: [String], used: [String]) {
    var unexpected: [String] = []
    var allowed: [String] = []
    var used: [String] = []
    for issue in noted {
      let candidate = exceptions.first { exception in
        exception.type == issue.type && issue.elementType == .staticText
          && exception.labels.contains(issue.label) && issue.compact.contains(exception.says)
      }
      guard let exception = candidate else {
        unexpected.append(issue.text)
        continue
      }
      // The control must have been read, and passed.
      if !controlsShown.contains(exception.control) {
        unexpected.append(
          "\(issue.text) (not allowed: \"\(exception.control)\" wasn't on screen to be read)")
      } else if noted.contains(where: { $0.type == exception.type && $0.label == exception.control }
      ) {
        unexpected.append(
          "\(issue.text) (not allowed: \"\(exception.control)\" failed \(exception.type.names) too)"
        )
      } else {
        allowed.append("\(issue.text). Allowed: \(exception.why)")
        if !used.contains(exception.why) { used.append(exception.why) }
      }
    }
    return (unexpected, allowed, used)
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
struct RGB: Equatable, CustomStringConvertible {
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
  /// SwiftUI mixes a gradient's stops and lays a colour over another at an opacity.
  func mixed(with other: RGB, by amount: Double) -> RGB {
    let t = min(max(amount, 0), 1)
    func mix(_ a: UInt8, _ b: UInt8) -> UInt8 {
      UInt8((Double(a) * (1 - t) + Double(b) * t).rounded())
    }
    return RGB(
      red: mix(red, other.red), green: mix(green, other.green), blue: mix(blue, other.blue))
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

  /// Inside `frame`, in points on screen, of `shot`, a screenshot of the window at `window`; nil
  /// when the frame is off the screenshot or it can't be read.
  init?(_ shot: XCUIScreenshot, in frame: CGRect, window: CGRect) {
    guard let pixels = ScreenPixels(shot, in: frame, window: window) else { return nil }
    self.init(rgba: pixels.rgba)
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
