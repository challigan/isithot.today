import SwiftUI

/// A forecast page's colours (iOS build spec, section 10.1), from its band's palette: the
/// gradient from `g1` to `g2`, the glow of `g3` at `glow` opacity, and the text in `ink`. The app
/// makes it from IsItModel's `Palette` with SnowKit's `Color(rgb:)`.
public struct PageTheme: Hashable {
  public var g1: Color
  public var g2: Color
  public var g3: Color
  /// The glow's opacity at its centre, 0 to 1.
  public var glow: Double
  public var ink: Color
  /// The page is dark under light ink (IsItLogic's `Palette.inkIsLight`): the system's controls
  /// on it (the switcher's segmented control, Retry) take the dark colour scheme, so their own
  /// text keeps its contrast on the page whatever the phone's appearance (section 16).
  public var dark: Bool

  public init(g1: Color, g2: Color, g3: Color, glow: Double, ink: Color, dark: Bool = false) {
    self.g1 = g1
    self.g2 = g2
    self.g3 = g3
    self.glow = glow
    self.ink = ink
    self.dark = dark
  }

  /// The colour scheme the system's controls on the page take.
  var controls: ColorScheme { dark ? .dark : .light }
}

/// The smallest a control is tapped by, in points, as Apple's guidelines and the accessibility
/// audit's hit regions ask: the footer's links and places, and "Use my location".
enum HitTarget {
  static let minimum: CGFloat = 44
  /// The shortest a `WordsButton`'s accessibility element is, however short its words. The
  /// audit's hit-region check failed elements 18 to 19.67 points tall (the picker's clear button
  /// on PR #33's second macOS run) and passed "Copy address" at 32.97 (its first): 34 is clear of
  /// what it fails, by what it passed.
  static let shortestElement: CGFloat = 34
}

/// A button drawn as its words, as the website draws its links: a tap anywhere on the
/// `HitTarget.minimum` line they are centred in acts, and its accessibility element (VoiceOver's
/// outline, and what the audit measures) is the band of that line the words take, no shorter
/// than `HitTarget.shortestElement` (`ContentShapeKinds.accessibility`, iOS 17). As one element
/// with the whole line, mostly the page's gradient, "Use my location" and the places nearby
/// failed the audit's contrast on PR #33's two macOS runs, drawn at 5.3:1 to 14.6:1 in every
/// pixel of it (DECISIONS, "The iPhone app's UI tests, after PR #33's second macOS run").
struct WordsButton<Label: View>: View {
  let action: () -> Void
  let label: Label
  /// The words' height as laid out, which grows with the text size.
  @State private var words: CGFloat = 0

  init(action: @escaping () -> Void, @ViewBuilder label: () -> Label) {
    self.action = action
    self.label = label()
  }

  var body: some View {
    Button(action: action) {
      label
        .onGeometryChange(for: CGFloat.self) { proxy in
          proxy.size.height
        } action: { height in
          words = height
        }
        .frame(minHeight: HitTarget.minimum)
        .contentShape(.interaction, Rectangle())
    }
    .contentShape(.accessibility, WordsBand(height: max(words, HitTarget.shortestElement)))
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

/// The website's page background (`global.css`): a linear gradient from `g1` to `g2` at 168°
/// (down, a little to the right), and over it a radial glow of `g3` centred at (88%, 6%), from
/// the palette's `glow` opacity to clear at 52% of the distance to the farthest corner. Full
/// bleed and decorative, with no accessibility modifier, and it must keep none: a gradient has
/// no accessibility element, and an accessibility modifier on a view without one makes it one.
/// On PR #33's two macOS runs `.accessibilityHidden(true)` here, before and then after
/// `.accessibilityIgnoresInvertColors()`, was the window-sized `other` element with no label that
/// the audit failed on every screenful of every page (`sufficientElementDescription`), as the
/// same modifier made an element of each hour bar and row of agreement dots it hid (DECISIONS,
/// "The iPhone app's UI tests, after PR #33's second macOS run"). Smart Invert inverts it with the
/// text on it, as Safari inverts the website: exempt, it kept its colours under ink Smart Invert
/// had inverted, pale on pale or dark on dark (about 1:1 to 3.7:1, modelled).
struct PageBackground: View {
  let theme: PageTheme

  var body: some View {
    GeometryReader { proxy in
      let size = proxy.size
      let centre = CGPoint(x: size.width * 0.88, y: size.height * 0.06)
      // The farthest corner from the centre, as CSS's `circle` sizes a radial gradient.
      let across = max(centre.x, size.width - centre.x)
      let down = max(centre.y, size.height - centre.y)
      let farthest = (across * across + down * down).squareRoot()
      ZStack {
        LinearGradient(
          colors: [theme.g1, theme.g2],
          startPoint: UnitPoint(x: 0.4, y: 0),
          endPoint: UnitPoint(x: 0.6, y: 1)
        )
        RadialGradient(
          colors: [theme.g3.opacity(theme.glow), theme.g3.opacity(0)],
          center: UnitPoint(x: 0.88, y: 0.06),
          startRadius: 0,
          endRadius: max(farthest * 0.52, 1)
        )
      }
    }
    .ignoresSafeArea()
  }
}
