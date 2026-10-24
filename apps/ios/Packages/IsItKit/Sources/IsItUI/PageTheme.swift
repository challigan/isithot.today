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
}

/// The website's page background (`global.css`): a linear gradient from `g1` to `g2` at 168°
/// (down, a little to the right), and over it a radial glow of `g3` centred at (88%, 6%), from
/// the palette's `glow` opacity to clear at 52% of the distance to the farthest corner. Full
/// bleed, decorative, and left alone by Smart Invert. Out of the accessibility tree, hidden last:
/// with `accessibilityIgnoresInvertColors()` after `accessibilityHidden(true)`, the hidden
/// modifier had nothing to hide (a gradient has no element), and the one after it made the
/// background an element of its own, the window's size with no label, which the audit failed on
/// every screenful of every page on PR #33's macOS run (`sufficientElementDescription`, an
/// `other` element at (0, 0, 402, 874)).
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
    .accessibilityIgnoresInvertColors()
    .accessibilityHidden(true)
  }
}
