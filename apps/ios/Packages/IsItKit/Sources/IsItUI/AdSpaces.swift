import IsItModel
import SwiftUI

/// The free version's box at the end of a page (DECISIONS, "Ads in the iPhone app: three
/// placements"), the website's `.ad-slot` (global.css): 40 points under the footer, 250 points
/// tall at the least, with 12-point corners, in the ad tint, and `content`, the page's banner
/// (IsItAds' `BannerSlot`, at most 250 tall), given the box's whole space, centred and clipped.
/// The box is there whether or not an ad comes, as Google asks a banner's space to be, so a banner
/// that loads late never lands where the page's words were, and 40 points keep it apart from the
/// footer's links. One accessibility container, "Advertisement" as on the website, holding the
/// ad's own elements; `id` is the UI tests' handle on it.
public struct AdBox<Content: View>: View {
  let id: String
  let content: Content

  @Environment(\.pageTheme) private var theme

  public init(id: String, @ViewBuilder content: () -> Content) {
    self.id = id
    self.content = content()
  }

  public var body: some View {
    let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
    // The box sizes itself, and its content takes what it is given: in the page's scroll view,
    // which offers any height, the content alone would be offered none.
    Color.clear
      .frame(maxWidth: .infinity, minHeight: 250)
      .overlay { content }
      .background(adTint(theme), in: shape)
      .clipShape(shape)
      .accessibilityElement(children: .contain)
      .accessibilityLabel(Text(verbatim: AppCopy.advertisement))
      .accessibilityIdentifier(id)
      .padding(.top, 40)
  }
}

/// The free version's band at the bottom of the home screen, under the pager (DECISIONS, "Ads in
/// the iPhone app: three placements"): `content`, the home banner (IsItAds' `BannerSlot`),
/// `height` tall and the screen's width, under 8 points of the ad tint, the separation that takes
/// no tap which Google asks for between a banner and the content beside it. The tint reaches down
/// under the home indicator; the band itself ends above it. The app keeps its space at the
/// banner's adaptive height from the moment the ads are on, whether or not an ad comes, as Google
/// asks, and puts it beside the pager rather than over the pages, so the pages end at its top and
/// nothing scrolls under the ad. One accessibility container, "Advertisement", holding the ad's
/// own elements; `id` is the UI tests' handle on it.
public struct AdBand<Content: View>: View {
  let height: Double
  let id: String
  let content: Content

  @Environment(\.pageTheme) private var theme

  public init(height: Double, id: String, @ViewBuilder content: () -> Content) {
    self.height = height
    self.id = id
    self.content = content()
  }

  public var body: some View {
    content
      .frame(maxWidth: .infinity)
      .frame(height: CGFloat(height))
      .clipped()
      .padding(.top, 8)
      .background {
        adTint(theme)
          .ignoresSafeArea(edges: .bottom)
      }
      .accessibilityElement(children: .contain)
      .accessibilityLabel(Text(verbatim: AppCopy.advertisement))
      .accessibilityIdentifier(id)
  }
}

/// The ad tint, the website's `.ad-slot` background: the page's ink at 8% over the page
/// (`color-mix(in srgb, var(--ink) 8%, transparent)`).
private func adTint(_ theme: PageTheme) -> Color {
  theme.ink.opacity(0.08)
}
