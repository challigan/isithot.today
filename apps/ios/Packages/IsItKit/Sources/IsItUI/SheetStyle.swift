import IsItLogic
import SwiftUI

// Settings' parts (DECISIONS, "The iPhone app in the website's look", step 6): the website's
// content pages (About, Privacy, Support and Terms) as the app draws Settings and every page it
// opens, on the content surface (`PageTheme.content`, the website's `snow` palette, fixed, the
// same in both appearances), every word in Bricolage. Only single lines sit on the page's
// gradient (titles, headings, the version, buttons' words); anything that can wrap at Large sits
// on an opaque, flat card, as the audit has only ever passed such text on flat fills (DECISIONS,
// PR #33's second macOS run). Each page is a `ScrollView` and a `VStack`, never a `Form` or a
// `List`, whose cells, made only while on screen, the audit's Dynamic Type check failed on PR
// #33's three macOS runs though they grew.

/// The measures of the content pages, the website's at 402 points wide: a 20-point gutter (its
/// `.wrap`), cards with corners of 24, and rows at least 54 tall with their words 18 in.
enum SheetMetrics {
  static let gutter: CGFloat = 20
  static let cardRadius: CGFloat = 24
  /// A row's words from its card's edge, and a reading card's paragraphs.
  static let rowInset: CGFloat = 18
  /// Above and below a row's words: 15, so 17.6-point words make a 54-point row.
  static let rowPadding: CGFloat = 15
  /// A row's least height, over `HitTarget.minimum` at every size.
  static let rowHeight: CGFloat = 54
  /// A row's icon's column at Large, and the space after it.
  static let iconColumn: CGFloat = 22
  static let iconGap: CGFloat = 14
  /// Between sections, and above a page's heading.
  static let sectionGap: CGFloat = 30
}

extension View {
  /// A content sheet (Settings, or the mail fallback, a sheet of its own): the content surface
  /// for every part in it, and its system parts (the toolbar's buttons, the back chevron, scroll
  /// indicators, text selection) drawn for a dark page in ink, whatever the phone's appearance.
  /// The navigation bar's own scheme is each page's (`SheetPage`), as a bar takes it from the
  /// page on top of its stack.
  func sheetChrome() -> some View {
    environment(\.pageTheme, .content)
      .environment(\.surface, .content)
      .environment(\.colorScheme, PageTheme.content.controls)
      .tint(PageTheme.content.ink)
  }
}

/// A sheet's Close as its toolbar shows it (Settings' and the mail fallback's; the picker has
/// the website's Close pill, `SheetHeader`): the xmark, as iOS 26 draws its own close control,
/// with the word ("Close") as the button's label, which VoiceOver reads. Not the word on screen:
/// a toolbar draws a text item at the bar's own type size whatever the text size, and on PR #33's
/// macOS run the audit failed all three Closes for Dynamic Type, the only buttons it failed for
/// Dynamic Type in any sheet. An icon has no text to stay small, and Your privacy's back button,
/// a bar button too, passed.
struct CloseLabel: View {
  let title: String

  var body: some View {
    Label {
      Text(verbatim: title)
    } icon: {
      Image(systemName: "xmark")
    }
    .labelStyle(.iconOnly)
  }
}

/// Close in a content sheet's toolbar, top right, the confirming action's place, where iOS 26
/// draws a prominent glass circle: tinted with the card colour there, a plum circle with a white
/// xmark (14.20:1), since it sits under the glow's centre, the page's lightest point, where plain
/// glass would leave white at about 4.88:1. Before iOS 26, a white xmark on the bar.
struct SheetCloseButton: ToolbarContent {
  let title: String
  let identifier: String
  let action: () -> Void

  var body: some ToolbarContent {
    ToolbarItem(placement: .confirmationAction) {
      Button(action: action) {
        CloseLabel(title: title)
      }
      .modifier(CloseTint())
      .accessibilityIdentifier(identifier)
    }
  }
}

/// The card colour on iOS 26's prominent glass; ink before it, where the item is the xmark alone.
private struct CloseTint: ViewModifier {
  @SurfaceTokens private var tokens

  @ViewBuilder func body(content: Content) -> some View {
    if #available(iOS 26, *) {
      content.tint(tokens.card)
    } else {
      content.tint(tokens.ink)
    }
  }
}

/// A content page: its title (`PageTitle`), then its content, in one column 20 points in from
/// each side that scrolls over the content palette's gradient and glow (`PageBackground`), fixed
/// to the screen as the website's is. Every view of it is laid out at every text size, on screen
/// or not. The navigation bar draws no title, only its buttons: `navigationTitle` still names the
/// page to VoiceOver and to the back button's history menu, but the principal item, a clear
/// point with no element, takes the title's place, as the page's own title is the website's h1.
/// The bar's buttons take the page's dark scheme; its background is the system's (iOS 26's
/// scroll-edge effect, or before it the bar's material once content scrolls under).
struct SheetPage<Content: View>: View {
  let title: String
  let content: Content

  @SurfaceTokens private var tokens

  init(title: String, @ViewBuilder content: () -> Content) {
    self.title = title
    self.content = content()
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        PageTitle(text: title)
        content
      }
      .padding(.horizontal, SheetMetrics.gutter)
      .padding(.top, 4)
      .padding(.bottom, 32)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    // No accessibility modifier: a gradient has no element, and one would make it one
    // (Backgrounds.swift).
    .background {
      PageBackground(theme: tokens.theme)
    }
    .foregroundStyle(tokens.ink)
    .navigationTitle(Text(verbatim: title))
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      // A shape with no element and no accessibility modifier, in the title's place.
      ToolbarItem(placement: .principal) {
        Color.clear.frame(width: 1, height: 1)
      }
    }
    .toolbarColorScheme(tokens.theme.controls, for: .navigationBar)
  }
}

/// A page's title, the website's `.prose h1`: the answer's face at 35 points, growing with the
/// large title, leading and wrapping, a heading to VoiceOver, identified `page-title`, which the
/// UI tests wait for. Every letter of every title is in the answer's subset (packages/mobile
/// `titleFont.test.ts`), so none falls back to the system's font.
struct PageTitle: View {
  let text: String

  var body: some View {
    Text(verbatim: text)
      .brandFont(.title)
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityAddTraits(.isHeader)
      .accessibilityIdentifier("page-title")
      .padding(.bottom, 22)
  }
}

/// A content page's heading, the website's `.prose h2` (How it works' sections, Credits' two): a
/// line on the page, a heading to VoiceOver, 30 below what is above it or, as the page's first,
/// straight under the title.
struct PageHeading: View {
  let text: String
  var first = false

  var body: some View {
    Text(verbatim: text)
      .brandFont(.pageHeading)
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityAddTraits(.isHeader)
      .padding(.top, first ? 0 : SheetMetrics.sectionGap)
      .padding(.bottom, 10)
  }
}

/// A section of Settings: its heading, the website's `.models h2` (`heading`, flush with the
/// card, a heading to VoiceOver), then its rows on one card (`SheetCard`), a hairline between
/// each two (`SheetDivider`, which the rows place). Report an ad's section has no heading.
struct SheetSection<Rows: View>: View {
  let header: String?
  let rows: Rows

  init(header: String? = nil, @ViewBuilder rows: () -> Rows) {
    self.header = header
    self.rows = rows()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if let header {
        Text(verbatim: header)
          .brandFont(.heading)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityAddTraits(.isHeader)
      }
      SheetCard {
        rows
      }
    }
  }
}

/// A card: the column's width, opaque and flat in the card colour (`#401a4f`, ink on it 14.20:1)
/// with corners of 24, and clipped to them, so a pressed row keeps to its corners. A shape, with
/// no accessibility modifier.
struct SheetCard<Content: View>: View {
  let content: Content

  @SurfaceTokens private var tokens

  init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: SheetMetrics.cardRadius, style: .continuous)
    VStack(alignment: .leading, spacing: 0) {
      content
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(tokens.card, in: shape)
    .clipShape(shape)
  }
}

/// The hairline between two rows of a card: one pixel of ink at 22% (40% under Increase
/// Contrast), from the words' leading edge to the card's, past the icon's column in rows with
/// icons (`afterIcon`) at the sizes that show them.
struct SheetDivider: View {
  var afterIcon = false

  @SurfaceTokens private var tokens
  @Environment(\.displayScale) private var displayScale
  @Environment(\.dynamicTypeSize) private var typeSize
  @ScaledMetric(relativeTo: .body) private var iconColumn = SheetMetrics.iconColumn

  /// Spelt out, as `RowLabel`'s is.
  init(afterIcon: Bool = false) {
    self.afterIcon = afterIcon
  }

  var body: some View {
    let icon = afterIcon && !typeSize.isAccessibilitySize
    Rectangle()
      .fill(tokens.hairline)
      .frame(height: 1 / displayScale)
      .padding(.leading, SheetMetrics.rowInset + (icon ? iconColumn + SheetMetrics.iconGap : 0))
  }
}

/// What a row's end says it does: a page on Settings' stack (a chevron), a page or an email
/// outside the app (an arrow out), or neither (Google's form, phase 8).
enum RowEnd {
  case page
  case leaves
  case none

  var symbol: String? {
    switch self {
    case .page: "chevron.forward"
    case .leaves: "arrow.up.forward"
    case .none: nil
    }
  }
}

extension SettingsScreen.Icon {
  /// The SF Symbol that draws it, each from iOS 14 or earlier.
  var symbol: String {
    switch self {
    case .units: "ruler"
    case .privacyChoices: "hand.raised"
    case .yourPrivacy: "lock.shield"
    case .policy: "doc.text"
    case .reportAd: "flag"
    case .howItWorks: "info.circle"
    case .credits: "text.book.closed"
    case .terms: "doc.plaintext"
    case .contactUs: "envelope"
    case .support: "lifepreserver"
    }
  }
}

/// A row's icon, decorative: its SF Symbol in ink, sized by `.body`, in a column 22 points wide
/// at Large that grows with it, hidden from VoiceOver (an `Image` is an element). The row leaves
/// it out at accessibility sizes, where the words need the card's width.
struct RowIcon: View {
  let icon: SettingsScreen.Icon

  @ScaledMetric(relativeTo: .body) private var column = SheetMetrics.iconColumn

  init(icon: SettingsScreen.Icon) {
    self.icon = icon
  }

  var body: some View {
    Image(systemName: icon.symbol)
      .font(.body)
      .frame(width: column)
      .accessibilityHidden(true)
  }
}

/// A row's words, as a card's row draws them: its icon (none at accessibility sizes), its title
/// in `row` (17.6 Medium), wrapping, an optional detail beneath it in `note` and `soft`, then its
/// end's chevron or arrow in `affordance`, hidden from VoiceOver. Laid out by its button's style
/// (`SheetRowStyle`).
struct RowLabel: View {
  let title: String
  let detail: String?
  let icon: SettingsScreen.Icon?
  let end: RowEnd

  @SurfaceTokens private var tokens
  @Environment(\.dynamicTypeSize) private var typeSize

  /// Spelt out, since Settings and its pages make one from other files, and the private tokens
  /// could leave the memberwise initialiser private to this one.
  init(title: String, detail: String? = nil, icon: SettingsScreen.Icon? = nil, end: RowEnd) {
    self.title = title
    self.detail = detail
    self.icon = icon
    self.end = end
  }

  var body: some View {
    HStack(spacing: SheetMetrics.iconGap) {
      if let icon, !typeSize.isAccessibilitySize {
        RowIcon(icon: icon)
      }
      VStack(alignment: .leading, spacing: 3) {
        Text(verbatim: title)
          .brandFont(.row)
          .fixedSize(horizontal: false, vertical: true)
        if let detail {
          Text(verbatim: detail)
            .brandFont(.note)
            .foregroundStyle(tokens.soft)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      Spacer(minLength: 0)
      if let symbol = end.symbol {
        Image(systemName: symbol)
          .font(.footnote.weight(.semibold))
          .foregroundStyle(tokens.affordance)
          .accessibilityHidden(true)
      }
    }
    .foregroundStyle(tokens.ink)
  }
}

/// A row of a card that acts when tapped: the whole row is the button, at least 54 tall, washed
/// edge to edge while pressed (`wash`, ink on it 10.00:1), never dimmed.
struct SheetRowStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    SheetRowBody(configuration: configuration)
  }
}

private struct SheetRowBody: View {
  let configuration: ButtonStyleConfiguration

  @SurfaceTokens private var tokens

  var body: some View {
    configuration.label
      .sheetRow()
      .background {
        // A colour, with no element.
        if configuration.isPressed {
          tokens.wash
        }
      }
  }
}

extension View {
  /// Laid out as a row of a card, acting or not: 18 in at the sides and 15 above and below,
  /// leading, as wide as the card and at least `SheetMetrics.rowHeight` tall, the whole row its
  /// tap region.
  func sheetRow() -> some View {
    padding(.horizontal, SheetMetrics.rowInset)
      .padding(.vertical, SheetMetrics.rowPadding)
      .frame(maxWidth: .infinity, minHeight: SheetMetrics.rowHeight, alignment: .leading)
      .contentShape(Rectangle())
  }

  /// A paragraph on a reading card, the website's `.prose p`: `detail` (17.6 Regular, its lines
  /// 0.3 em apart), wrapping whole.
  func paragraph() -> some View {
    brandFont(.detail)
      .fixedSize(horizontal: false, vertical: true)
  }
}

/// Paragraphs on a card, where the website sets them on the page: each its own text, 14 apart,
/// 18 in from the card's sides and 16 from its top and foot. Flat under the text, since the audit
/// failed two-line text on the forecast pages' gradient at 9.6:1 to 13.7:1 drawn (DECISIONS,
/// PR #33's second macOS run), and Settings' audits allow nothing.
struct ReadingCard<Content: View>: View {
  let content: Content

  init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  var body: some View {
    SheetCard {
      VStack(alignment: .leading, spacing: 14) {
        content
      }
      .padding(.horizontal, SheetMetrics.rowInset)
      .padding(.vertical, 16)
    }
  }
}

/// A page button's words when it leaves the app: its title in `labelStrong`, then its arrow out
/// in `affordance`, trailing and hidden from VoiceOver.
struct LeavingLabel: View {
  let title: String

  @SurfaceTokens private var tokens

  init(title: String) {
    self.title = title
  }

  var body: some View {
    HStack(spacing: 12) {
      Text(verbatim: title)
        .brandFont(.labelStrong)
      Spacer(minLength: 0)
      Image(systemName: "arrow.up.forward")
        .font(.footnote.weight(.semibold))
        .foregroundStyle(tokens.affordance)
        .accessibilityHidden(true)
    }
  }
}
