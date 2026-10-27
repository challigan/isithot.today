import IsItModel
import IsItState
import SwiftUI
import UIKit

/// A slot's banner on screen: the banner `GoogleAds` keeps for `slot`, centred in a plain view
/// that takes the space it is given (IsItUI's `AdBand` at the bottom of the home screen, its
/// `AdBox` at a page's end). The banner keeps its own size, its intrinsic content size, which for
/// a page end's inline banner is the ad's (GADAdSize.h), so the centring follows the ad that
/// comes. Nothing happens when the view is updated: the home screen is drawn again every minute,
/// and a banner loads only when `AdsModel` asks. To the UI tests the banner is `ad-banner-home`
/// or `ad-banner-page-<view>`.
public struct BannerSlot: UIViewRepresentable {
  let ads: GoogleAds
  let slot: AdSlot

  public init(ads: GoogleAds, slot: AdSlot) {
    self.ads = ads
    self.slot = slot
  }

  public func makeUIView(context: Context) -> UIView {
    let container = UIView()
    let banner = ads.bannerView(for: slot)
    banner.accessibilityIdentifier = Self.identifier(slot)
    banner.translatesAutoresizingMaskIntoConstraints = false
    // The one banner moves here from wherever it was drawn before.
    container.addSubview(banner)
    NSLayoutConstraint.activate([
      banner.centerXAnchor.constraint(equalTo: container.centerXAnchor),
      banner.centerYAnchor.constraint(equalTo: container.centerYAnchor),
    ])
    return container
  }

  public func updateUIView(_ uiView: UIView, context: Context) {}

  /// The banner's accessibility identifier.
  static func identifier(_ slot: AdSlot) -> String {
    switch slot {
    case .home: "ad-banner-home"
    case .pageEnd(let view): "ad-banner-page-\(view.rawValue)"
    }
  }
}
