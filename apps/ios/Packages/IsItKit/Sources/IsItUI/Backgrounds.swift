import IsItModel
import SwiftUI

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
///
/// Under Increase Contrast it draws no glow, the page's lightest point under light ink: on the
/// content palette ink on the page is then 7.32:1 or more, where the glow's centre gives 4.88
/// (DECISIONS, "The iPhone app in the website's look"). It draws the content surface's pages as
/// well as the home screen's.
struct PageBackground: View {
  let theme: PageTheme

  @Environment(\.colorSchemeContrast) private var contrast

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
        if contrast != .increased {
          RadialGradient(
            colors: [theme.g3.opacity(theme.glow), theme.g3.opacity(0)],
            center: UnitPoint(x: 0.88, y: 0.06),
            startRadius: 0,
            endRadius: max(farthest * 0.52, 1)
          )
        }
      }
    }
    .ignoresSafeArea()
  }
}

/// The place picker's background, the website's `.sheet`: a linear gradient at 168° from `pill`
/// to `pill` with `BrandShares.sheetEnd` (15%) of `g2` mixed in, with no glow, so every row sits
/// within a few levels of `pill` on a light band (6 to 8 of 255 at the foot) and on exactly
/// `pill` on a dark one, whose `g2` is its `pill`. Drawn as `g2` fading in over the pill, which
/// is the same mix at every point. Full bleed and decorative, with no accessibility modifier, as
/// `PageBackground`: one on a view without an element makes it one, and Smart Invert inverts it
/// with its text.
struct SheetBackground: View {
  let theme: PageTheme

  var body: some View {
    ZStack {
      theme.pill
      LinearGradient(
        colors: [theme.g2.opacity(0), theme.g2.opacity(BrandShares.sheetEnd)],
        startPoint: UnitPoint(x: 0.4, y: 0),
        endPoint: UnitPoint(x: 0.6, y: 1)
      )
    }
    .ignoresSafeArea()
  }
}
