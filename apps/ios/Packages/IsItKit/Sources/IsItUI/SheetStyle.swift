import IsItLogic
import SwiftUI
import UIKit

/// The sheets' own colours (the place picker, Settings with its pages, and the mail fallback),
/// where the system's fall short of WCAG AA's 4.5:1 for text under 18 points in the light
/// appearance (section 16): IsItLogic's `SheetColours`, which a Linux test holds to it. The
/// sheets otherwise draw in the system's colours, and follow its appearance.
enum SheetStyle {
  /// Secondary text: a section's header and footer, a result's region and country, the
  /// search's and the location's lines. In the dark appearance, the system's secondary label,
  /// which passes; in the light, `SheetColours.secondaryLight`, where the system's gives 3.28:1
  /// on a grouped list's background.
  static let secondary = Color(
    uiColor: UIColor { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor.secondaryLabel.resolvedColor(with: traits)
        : UIColor(rgb: SheetColours.secondaryLight)
    })

  /// The tint of the sheets' buttons, links and toolbar items: the system's blue as Increase
  /// Contrast draws it, light and dark, where the default gives 3.59:1 on a grouped list's light
  /// background and 3.82:1 on a sheet's dark rows.
  static let accent = Color(
    uiColor: UIColor { traits in
      UIColor(
        rgb: traits.userInterfaceStyle == .dark
          ? SheetColours.accentDark : SheetColours.accentLight)
    })

  /// The fill of a prominent button, whose label is white: the light appearance's tint in both,
  /// 7.56:1 under white. No blue reads at 4.5:1 both under white and on a dark row, and the
  /// dark tint gives white 2.83:1.
  static let filled = Color(uiColor: UIColor(rgb: SheetColours.accentLight))
}

/// A sheet's Close as its toolbar shows it (the picker's, Settings' and the mail fallback's): the
/// xmark, as iOS 26 draws its own close control, with the word ("Close") as the button's label,
/// which VoiceOver reads. Not the word on screen: a toolbar draws a text item at the bar's own
/// type size whatever the text size, and on PR #33's macOS run the audit failed all three Closes
/// for Dynamic Type, the only buttons it failed for Dynamic Type in any sheet. An icon has no
/// text to stay small, and Your privacy's back button, a bar button too, passed.
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

extension UIColor {
  /// A 0xRRGGBB colour in sRGB, opaque.
  fileprivate convenience init(rgb: UInt32) {
    self.init(
      red: CGFloat((rgb >> 16) & 0xff) / 255,
      green: CGFloat((rgb >> 8) & 0xff) / 255,
      blue: CGFloat(rgb & 0xff) / 255,
      alpha: 1
    )
  }
}

/// The measures of the sheets' grouped pages (`SheetPage(.grouped)`), as iOS 26 draws an inset
/// grouped list, read off Settings' screen on PR #33's third macOS run, a `Form` then: cards 16
/// points in from the screen's sides with corners of about 26, rows 52 points tall at Large with
/// their text 16 points in, and a hairline between rows inset as far.
enum SheetMetrics {
  /// How far a grouped page's cards are from the screen's sides, and a row's content from its
  /// card's.
  static let inset: CGFloat = 16
  /// A row's least height: more than a tap needs (`HitTarget.minimum`), at every text size.
  static let rowHeight: CGFloat = 52
  /// Above and below a row's content: the units row, its control 48 points tall, is 78.
  static let rowPadding: CGFloat = 15
  static let cornerRadius: CGFloat = 26
}

/// How a page of a sheet looks: paragraphs on the system's background (How it works, Your
/// privacy, a notice), or sections of rows on cards over the grouped background, as an inset
/// grouped list draws them (Settings, Credits and licences).
enum SheetPageStyle {
  case plain
  case grouped
}

/// A page of a sheet, Settings' or one on its stack: its content in one column that scrolls,
/// every view of it laid out at every text size, on screen or not. Not a `Form` or a `List`,
/// whose cells are made only while on screen: the audit's Dynamic Type check failed a `Form`'s
/// text as "unsupported" or "partially unsupported" on PR #33's three macOS runs (Settings'
/// "About" header on all three, its "Report an ad" row on the third, Your privacy's last row
/// while it was one), though the recordings show it growing at every size it was on screen, and
/// passed rows of the same `Form` that left the screen at the same sizes; a scroll view's text,
/// on screen or not, has passed on every run (How it works, Your privacy since the third, the
/// home pages).
struct SheetPage<Content: View>: View {
  let style: SheetPageStyle
  let spacing: CGFloat
  let content: Content

  init(
    _ style: SheetPageStyle = .plain,
    spacing: CGFloat = 16,
    @ViewBuilder content: () -> Content
  ) {
    self.style = style
    self.spacing = spacing
    self.content = content()
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: spacing) {
        content
      }
      .padding(.horizontal, style == .grouped ? SheetMetrics.inset : 20)
      .padding(.vertical, 16)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background {
      // No accessibility modifier: a colour has no element to hide.
      if style == .grouped {
        Color(uiColor: .systemGroupedBackground)
          .ignoresSafeArea()
      }
    }
  }
}

/// A section of a grouped page: its header, a heading to VoiceOver; its rows on one card, with a
/// hairline between each two (`SheetDivider`, which the rows place); and its footer. The header
/// and footer are `SheetStyle.secondary`, which meets 4.5:1 on the grouped background, in a
/// list's text styles.
struct SheetSection<Rows: View>: View {
  let header: String?
  let footer: String?
  let rows: Rows

  init(header: String? = nil, footer: String? = nil, @ViewBuilder rows: () -> Rows) {
    self.header = header
    self.footer = footer
    self.rows = rows()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let header {
        Text(verbatim: header)
          .font(.headline)
          .foregroundStyle(SheetStyle.secondary)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityAddTraits(.isHeader)
          .padding(.horizontal, SheetMetrics.inset)
      }
      VStack(alignment: .leading, spacing: 0) {
        rows
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        Color(uiColor: .secondarySystemGroupedBackground),
        in: RoundedRectangle(cornerRadius: SheetMetrics.cornerRadius, style: .continuous)
      )
      // A pressed row's highlight keeps to the card's corners.
      .clipShape(RoundedRectangle(cornerRadius: SheetMetrics.cornerRadius, style: .continuous))
      if let footer {
        Text(verbatim: footer)
          .font(.footnote)
          .foregroundStyle(SheetStyle.secondary)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, SheetMetrics.inset)
      }
    }
  }
}

/// The hairline between two rows of a card, inset as a list's separator is.
struct SheetDivider: View {
  var body: some View {
    Divider()
      .padding(.horizontal, SheetMetrics.inset)
  }
}

extension View {
  /// Laid out as a row of a card: `SheetMetrics.inset` in at the sides and `rowPadding` above and
  /// below, leading, as wide as the card and at least `SheetMetrics.rowHeight` tall.
  func sheetRow() -> some View {
    padding(.horizontal, SheetMetrics.inset)
      .padding(.vertical, SheetMetrics.rowPadding)
      .frame(maxWidth: .infinity, minHeight: SheetMetrics.rowHeight, alignment: .leading)
  }
}

/// A row of a card that acts when tapped: the whole row takes the tap and shows it pressed, as a
/// list's row does. Its words are its label's: a page on the sheet's stack in the primary colour
/// (`PageRowLabel`), a page or an email outside the app in the tint (`LeavingRow`).
struct SheetRowStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .sheetRow()
      .contentShape(Rectangle())
      .background {
        if configuration.isPressed {
          Color(uiColor: .systemGray4)
        }
      }
  }
}

/// A row's label for a page on the sheet's own stack: its content in the primary colour, and the
/// chevron a list draws for one, which VoiceOver doesn't read.
struct PageRowLabel<Content: View>: View {
  let content: Content

  init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  var body: some View {
    HStack(spacing: 8) {
      content
      Spacer(minLength: 0)
      Image(systemName: "chevron.forward")
        .font(.footnote.weight(.semibold))
        .foregroundStyle(.tertiary)
        .accessibilityHidden(true)
    }
    .foregroundStyle(Color.primary)
  }
}
