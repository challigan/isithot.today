import GoogleMobileAds

/// Google's ad and consent SDKs (iOS build spec, section 14): the app links them, and its widgets
/// never do. `GoogleAds` is the two SDKs behind the free version's ads (`AdsModel`, IsItState),
/// and `BannerSlot` hosts its banners on screen; this says which Mobile Ads the app was built
/// with.
public enum AdsSDK {
  /// The Google Mobile Ads version, as the SDK reports it.
  public static var mobileAdsVersion: String {
    string(for: MobileAds.shared.versionNumber)
  }
}
