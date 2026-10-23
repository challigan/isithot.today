import GoogleMobileAds

/// Google's ad and consent SDKs (iOS build spec, section 14): the app links them, and its widgets
/// never do. Phase 8 brings `AdsService` (consent, then the SDK, then the banner) and
/// `BannerView`. Until then nothing here runs: the app only builds against the pinned SDKs and
/// links them, which is V11's first question.
public enum AdsSDK {
  /// The Google Mobile Ads version, as the SDK reports it.
  public static var mobileAdsVersion: String {
    string(for: MobileAds.shared.versionNumber)
  }
}
