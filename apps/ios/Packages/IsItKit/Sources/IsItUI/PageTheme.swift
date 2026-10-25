import IsItLogic
import IsItModel
import SwiftUI

/// A surface's colours (iOS build spec, section 10.1; DECISIONS, "The iPhone app in the website's
/// look"), from a core palette: the gradient from `g1` to `g2`, the glow of `g3` at `glow`
/// opacity, the text in `ink`, and `pill`, the controls' colour (a page's chips, the sheet's
/// background, the selected tab's words). A page takes its band's (`init(_:)`); the app's own
/// pages take `content`, fixed.
public struct PageTheme: Hashable {
  public var g1: Color
  public var g2: Color
  public var g3: Color
  /// The glow's opacity at its centre, 0 to 1.
  public var glow: Double
  public var ink: Color
  public var pill: Color
  /// A card's fill, opaque: only the content surface draws cards (`BrandColours.contentCard`),
  /// and every other theme has its `pill` here.
  public var card: Color
  /// The page is dark under light ink (IsItLogic's `Palette.inkIsLight`): the system's controls
  /// on it (the status bar, the keyboard, glass buttons, the spinner) take the dark colour
  /// scheme, so their own text keeps its contrast on the page whatever the phone's appearance
  /// (section 16).
  public var dark: Bool

  public init(
    g1: Color, g2: Color, g3: Color, glow: Double, ink: Color, pill: Color, card: Color? = nil,
    dark: Bool = false
  ) {
    self.g1 = g1
    self.g2 = g2
    self.g3 = g3
    self.glow = glow
    self.ink = ink
    self.pill = pill
    self.card = card ?? pill
    self.dark = dark
  }

  /// A band's palette as a surface's colours, dark for light ink, so that the system's controls
  /// on it keep their contrast.
  public init(_ palette: IsItModel.Palette) {
    self.init(palette, card: nil)
  }

  private init(_ palette: IsItModel.Palette, card: UInt32?) {
    self.init(
      g1: Color(rgb: palette.g1),
      g2: Color(rgb: palette.g2),
      g3: Color(rgb: palette.g3),
      glow: palette.glow,
      ink: Color(rgb: palette.ink),
      pill: Color(rgb: palette.pill),
      card: card.map { Color(rgb: $0) },
      dark: palette.inkIsLight
    )
  }

  /// The app's own pages' colours (Settings and every page it opens): the website's content
  /// pages' palette (`Palettes.content`), the same in both appearances, with its plum cards.
  public static let content = PageTheme(Palettes.content, card: BrandColours.contentCard)

  /// The colour scheme the system's controls on the page take.
  var controls: ColorScheme { dark ? .dark : .light }
}

extension Color {
  /// A colour from 0xRRGGBB in sRGB, as the generated palettes write them. IsItUI's own, as it
  /// doesn't link SnowKit, whose `Color(rgb:)` the app and the widget use.
  init(rgb: UInt32) {
    self.init(
      .sRGB,
      red: Double((rgb >> 16) & 0xff) / 255,
      green: Double((rgb >> 8) & 0xff) / 255,
      blue: Double(rgb & 0xff) / 255
    )
  }
}

/// Which of the app's three surfaces a view is drawn on (DECISIONS, "The iPhone app in the
/// website's look"), which decides the fills its parts take: a page of the home screen, in the
/// band on screen; the sheet, the place picker, in the band it opened over; or content,
/// Settings and its pages, in `PageTheme.content`. Nothing follows Dark Mode.
public enum Surface: Hashable {
  case page
  case sheet
  case content
}

private struct SurfaceKey: EnvironmentKey {
  static let defaultValue = Surface.page
}

private struct PageThemeKey: EnvironmentKey {
  static let defaultValue = PageTheme.content
}

extension EnvironmentValues {
  /// The surface the view is on.
  public var surface: Surface {
    get { self[SurfaceKey.self] }
    set { self[SurfaceKey.self] = newValue }
  }

  /// The colours of the surface the view is on: the app's own pages' unless one sets them.
  public var pageTheme: PageTheme {
    get { self[PageThemeKey.self] }
    set { self[PageThemeKey.self] = newValue }
  }
}

/// A surface's tokens (DECISIONS, "The iPhone app in the website's look"): each a share of its
/// theme's ink or pill (IsItModel's `BrandShares`, which packages/mobile measures on every band),
/// as the phone's accessibility settings change them. Under Increase Contrast, soft text,
/// affordances and the search box's edge are full ink, and hairlines and borders heavier. A chip
/// is opaque whatever the settings (`BrandShares.chip` is 1).
struct BrandTokens {
  let theme: PageTheme
  let surface: Surface
  let increasedContrast: Bool
  let reduceTransparency: Bool

  /// Every word, icon, star, caret, spinner and tick.
  var ink: Color { theme.ink }
  /// A page's chips: the place, the gear, notes and notices, the tab track, Retry. Opaque, as
  /// Apple's contrast check failed the website's 85% over the gradient (PR #34's macOS runs);
  /// Reduce Transparency would still make it so should the share go below 1 again.
  var chip: Color {
    reduceTransparency ? theme.pill : theme.pill.opacity(BrandShares.chip)
  }
  /// The selected tab, the units thumb and the primary button: an ink fill, words in `pill`.
  var selected: Color { theme.ink }
  var selectedWords: Color { theme.pill }
  /// Secondary text on a flat fill (the sheet, a card), never on a page's gradient.
  var soft: Color { increasedContrast ? theme.ink : theme.ink.opacity(BrandShares.soft) }
  /// Over what is beneath: the sheet's Close, pressed rows, the units track.
  var wash: Color { theme.ink.opacity(BrandShares.wash) }
  /// The search box's fill and its edge.
  var field: Color { theme.ink.opacity(BrandShares.field) }
  var fieldBorder: Color {
    increasedContrast ? theme.ink : theme.ink.opacity(BrandShares.fieldBorder)
  }
  /// The edge of a page's Retry and of the sheet's Close.
  var border: Color {
    theme.ink.opacity(increasedContrast ? BrandShares.increasedLine : BrandShares.border)
  }
  /// A rule: above a page's credits, between a card's rows.
  var hairline: Color {
    theme.ink.opacity(increasedContrast ? BrandShares.increasedLine : BrandShares.hairline)
  }
  /// A card, opaque: the content surface's plum.
  var card: Color { theme.card }
  /// Chevrons and arrows on a card, hidden from VoiceOver.
  var affordance: Color {
    increasedContrast ? theme.ink : theme.ink.opacity(BrandShares.affordance)
  }
  /// What a secondary button is filled with on this surface: a chip on a page, the wash on the
  /// sheet, a card on content.
  var secondaryFill: Color {
    switch surface {
    case .page: chip
    case .sheet: wash
    case .content: card
    }
  }
}

/// The tokens of the surface a view is on, from the environment: `@SurfaceTokens private var
/// tokens`, then `tokens.chip`.
@propertyWrapper
struct SurfaceTokens: DynamicProperty {
  @Environment(\.pageTheme) private var theme
  @Environment(\.surface) private var surface
  @Environment(\.colorSchemeContrast) private var contrast
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

  var wrappedValue: BrandTokens {
    BrandTokens(
      theme: theme,
      surface: surface,
      increasedContrast: contrast == .increased,
      reduceTransparency: reduceTransparency
    )
  }
}

/// The smallest a control is tapped by, in points, as Apple's guidelines and the accessibility
/// audit's hit regions ask: the pills, and the footer's links and places.
enum HitTarget {
  static let minimum: CGFloat = 44
  /// The shortest a `WordsButton`'s accessibility element is, however short its words, for words
  /// `minimum` wide or more. The audit's hit-region check failed the picker's clear button, 19.67
  /// by 19 (PR #33's second macOS run), and every element it passed had a side of 44 or more, the
  /// shortest on record "Copy address", 123.9 by 32.97 (its first): 34 is clear of what it failed,
  /// by what it passed. Words narrower than 44 (York and Perth at Large) keep the whole 44-point
  /// line, which passed the check on both runs, and their contrast is left to `HomeAuditTests`'
  /// `DrawnText` exception.
  static let shortestElement: CGFloat = 34
}

/// A button drawn as its words, as the website draws its links: a tap anywhere on the
/// `HitTarget.minimum` line they are centred in acts, and its accessibility element (VoiceOver's
/// outline, and what the audit measures) is the band of that line the words take, no shorter
/// than `HitTarget.shortestElement` (`ContentShapeKinds.accessibility`, iOS 17), or the whole line
/// for words narrower than `HitTarget.minimum`. As one element with the whole line, mostly the
/// page's gradient, "Use my location" and the places nearby failed the audit's contrast on
/// PR #33's two macOS runs, drawn at 5.3:1 to 14.6:1 in every pixel of it (DECISIONS, "The
/// iPhone app's UI tests, after PR #33's second macOS run").
struct WordsButton<Label: View>: View {
  let action: () -> Void
  let label: Label
  /// The words' size as laid out, which grows with the text size.
  @State private var words: CGSize = .zero

  init(action: @escaping () -> Void, @ViewBuilder label: () -> Label) {
    self.action = action
    self.label = label()
  }

  var body: some View {
    Button(action: action) {
      label
        .onGeometryChange(for: CGSize.self) { proxy in
          proxy.size
        } action: { size in
          words = size
        }
        .frame(minHeight: HitTarget.minimum)
        .contentShape(.interaction, Rectangle())
    }
    .contentShape(.accessibility, WordsBand(height: band))
  }

  /// 0, the whole line, for words narrower than `HitTarget.minimum`: every element the hit-region
  /// check passed had a side of 44 or more (York 34 by 44, "Copy address" 123.9 by 32.97), and the
  /// one it failed had neither (the clear button, 19.67 by 19).
  private var band: CGFloat {
    words.width < HitTarget.minimum ? 0 : max(words.height, HitTarget.shortestElement)
  }
}

/// The band `height` tall across the middle of a rect, as the words sit in their taller line;
/// the whole rect when it is no taller.
struct WordsBand: Shape {
  var height: CGFloat

  func path(in rect: CGRect) -> Path {
    guard height > 0, height < rect.height else { return Path(rect) }
    return Path(rect.insetBy(dx: 0, dy: (rect.height - height) / 2))
  }
}
