import SwiftUI

/// The home row (spec 10.2, item 6): at the end of the middle page in the free version, once
/// StoreKit has a price, "No ads, plus widgets for your home and lock screen · £1.99" beside
/// sparkles VoiceOver doesn't read, opening the upgrade sheet. A wide pill, its words in ink on
/// the page's opaque chip fill, as Retry's are (the page surface's `ink` and `chip`), so it wraps
/// safely at every text size. Never beside or over an ad: it sits above the footer, and the ad
/// box is after the footer's links. The words are IsItLogic's (`UpgradePage.homeRow`), and the
/// price in them StoreKit's.
public struct UpgradeRow: View {
  let title: String
  let action: () -> Void

  public init(title: String, action: @escaping () -> Void) {
    self.title = title
    self.action = action
  }

  public var body: some View {
    PillButton(.wide, .secondary, action: action) {
      HStack(spacing: 12) {
        Image(systemName: "sparkles")
          .font(.callout)
          .accessibilityHidden(true)
        Text(verbatim: title)
          .brandFont(.labelStrong)
          .fixedSize(horizontal: false, vertical: true)
        Spacer(minLength: 0)
      }
    }
    .accessibilityIdentifier("upgrade-row")
    .padding(.top, 28)
    .padding(.bottom, 8)
  }
}
