import IsItModel
import SwiftUI

extension Font {
  /// A face of the website's Bricolage Grotesque at `size` points, growing with Dynamic Type as
  /// `style` does. Never add `.fontWeight` or `.bold()` to one: pick the face.
  static func brand(_ face: BrandFont, _ size: CGFloat, relativeTo style: Font.TextStyle) -> Font {
    .custom(face.rawValue, size: size, relativeTo: style)
  }
}

/// The app's one type scale (DECISIONS, "The iPhone app in the website's look"): each role the
/// website's face and size (px at 402 wide = pt at Large), the text style it grows with, below
/// Large as well as above, and its tracking and line spacing in ems. Never caption2, which
/// doesn't shrink below Large and failed the audit's Dynamic Type check on PR #33. A role's text
/// is drawn at whole points, so its size and style must come to different sizes at Medium and
/// Large: 14.4 with subheadline came to 14 at both, and the audit failed both texts in it that
/// it judged as elements of their own, the picker's Close and a notice's project page, as
/// "partially unsupported" (DECISIONS, "After #34's second full run"). `small` is still that
/// size: the week's bands, inside each row's one element, and the limited line, not yet
/// audited.
enum TextRole: CaseIterable {
  /// The answer word: 0.30 of the page's width, 96 to 208 (`answerSize(pageWidth:)`), one line.
  case answer
  /// "Checking…", and the error and not-available words.
  case answerState
  /// Settings' page titles.
  case title
  case verdict
  /// A grid's values, and those of a model that disagrees (`valueOut`).
  case value
  case valueOut
  /// How it works' and Credits' headings.
  case pageHeading
  case question
  /// The week's amounts.
  case amount
  /// The detail, and Settings' paragraphs.
  case detail
  /// Settings' row titles.
  case row
  /// "Search for a place".
  case sheetTitle
  /// The search box (UIKit's, through `UIFontMetrics`).
  case field
  /// Section headings: the hours', the week's, Saved, Recent, Settings' sections.
  case heading
  /// The place, the agreement heading, the picker's rows and Close, Retry, the links' sentence.
  case label
  /// A week's day, "Use my location", the links, the units, page buttons, a notice's project
  /// page.
  case labelStrong
  /// Nearby; the picker's status, location and saved lines.
  case line
  /// The limited line, a week's band.
  case small
  /// Updated, notices, rows' details, the units footnote, the version.
  case note
  case tab
  /// The note chip, the strip's scale, a grid's names, the credits.
  case caption

  /// Its face, at the regular legibility weight.
  var face: BrandFont {
    switch self {
    case .answer, .answerState, .title: .answer
    case .verdict, .value, .pageHeading, .amount, .sheetTitle, .heading, .labelStrong, .tab:
      .textSemiBold
    case .row: .textMedium
    case .valueOut, .question, .detail, .field, .label, .line, .small, .note, .caption:
      .textRegular
    }
  }

  /// Its size at Large, in points: the website's at 402 wide.
  var size: CGFloat {
    switch self {
    case .answer: 120.6
    case .answerState: 28
    case .title: 35
    case .verdict: 24
    case .value, .valueOut, .pageHeading: 21.6
    case .question, .amount: 18.4
    case .detail, .row, .sheetTitle, .field: 17.6
    case .heading, .label, .labelStrong: 16
    case .line: 15.2
    case .small: 14.4
    case .note: 13.6
    case .tab, .caption: 12.8
    }
  }

  /// The text style it grows with: the nearest by its default size (largeTitle 34, title 28,
  /// title2 22, body 17, callout 16, subheadline 15, footnote 13).
  var style: Font.TextStyle {
    switch self {
    case .answer, .title: .largeTitle
    case .answerState: .title
    case .verdict, .value, .valueOut, .pageHeading: .title2
    case .question, .amount, .detail, .row, .sheetTitle, .field: .body
    case .heading, .label, .labelStrong: .callout
    case .line, .small: .subheadline
    case .note, .tab, .caption: .footnote
    }
  }

  /// Its letter spacing in ems, CSS's `letter-spacing` (after every character, as `.tracking`).
  var tracking: CGFloat {
    switch self {
    case .answer: -0.055
    case .answerState, .verdict: -0.02
    case .title: -0.01
    default: 0
    }
  }

  /// Space between its lines beyond the face's own 1.2 em, in ems: the website's 1.5 on the
  /// detail.
  var lineSpacing: CGFloat {
    self == .detail ? 0.3 : 0
  }

  /// Whether its figures are tabular, so they line up: the grids' values and the week's amounts.
  var tabular: Bool {
    switch self {
    case .value, .valueOut, .amount: true
    default: false
    }
  }

  /// The answer word's size at Large on a page `pageWidth` wide: the website's 30vw, from 96 to
  /// 208 (120.6 on a 402-point iPhone).
  static func answerSize(pageWidth: CGFloat) -> CGFloat {
    min(max(0.30 * pageWidth, 96), 208)
  }
}

extension BrandFont {
  /// The next face up, for Bold Text: Regular to Medium, Medium to SemiBold. SemiBold and the
  /// answer's face are as bold as the app's faces go.
  var bolder: BrandFont {
    switch self {
    case .textRegular: .textMedium
    case .textMedium: .textSemiBold
    case .textSemiBold, .answer: self
    }
  }
}

extension View {
  /// Sets `role`'s face, size, tracking and line spacing, all growing with Dynamic Type as its
  /// text style does, and steps the face up under Bold Text, which a custom font doesn't follow
  /// on its own. `size` replaces the role's (the answer's, from the page's width); `lineSpacing`,
  /// in ems, its spacing (the links' sentence and Nearby, at the website's 1.6).
  func brandFont(_ role: TextRole, size: CGFloat? = nil, lineSpacing: CGFloat? = nil) -> some View {
    modifier(BrandFontModifier(role: role, size: size ?? role.size, lineSpacing: lineSpacing))
  }
}

/// `brandFont(_:)`: the font, and the tracking and line spacing in points, from a `ScaledMetric`
/// of the size, so they grow with the text.
private struct BrandFontModifier: ViewModifier {
  let role: TextRole
  let size: CGFloat
  let lineSpacing: CGFloat

  @ScaledMetric private var scaled: CGFloat
  @Environment(\.legibilityWeight) private var legibilityWeight

  init(role: TextRole, size: CGFloat, lineSpacing: CGFloat?) {
    self.role = role
    self.size = size
    self.lineSpacing = lineSpacing ?? role.lineSpacing
    _scaled = ScaledMetric(wrappedValue: size, relativeTo: role.style)
  }

  func body(content: Content) -> some View {
    let face = legibilityWeight == .bold ? role.face.bolder : role.face
    let font = Font.brand(face, size, relativeTo: role.style)
    content
      .font(role.tabular ? font.monospacedDigit() : font)
      .tracking(role.tracking * scaled)
      .lineSpacing(lineSpacing * scaled)
  }
}
