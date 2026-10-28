import Foundation
import GoogleMobileAds
import IsItState
import UIKit
import UserMessagingPlatform

/// The app's three ad units, from its Info.plist, which Snow.xcconfig fills by `ADS_UNITS`:
/// Google's demo units in every build but the release candidate's. Never typed in Swift: the
/// archive check fails a release candidate that holds Google's demo publisher anywhere.
public struct AdUnits: Equatable, Sendable {
  /// The home banner's, `IsItBannerUnitID`.
  public let homeBanner: String
  /// The page ends' banners', `IsItPageBannerUnitID`.
  public let pageBanner: String
  /// The full-screen ad's, `IsItInterstitialUnitID`.
  public let interstitial: String

  /// The units the app's Info.plist names; for a key it doesn't have, an empty unit, which no
  /// load answers.
  public static var fromInfoPlist: AdUnits {
    let bundle = Bundle.main
    return AdUnits(
      homeBanner: bundle.object(forInfoDictionaryKey: "IsItBannerUnitID") as? String ?? "",
      pageBanner: bundle.object(forInfoDictionaryKey: "IsItPageBannerUnitID") as? String ?? "",
      interstitial: bundle.object(forInfoDictionaryKey: "IsItInterstitialUnitID") as? String ?? ""
    )
  }
}

/// Where UMP takes the phone to be, for a Debug build's `-umpGeography`: the EEA, where its
/// consent form is required, or a region with no regulation in force. Simulators always take it
/// (UMPDebugSettings.h); a Release build never gives one.
public enum ConsentGeography: Sendable {
  case eea
  case other
}

/// Google's two SDKs behind `AdsPlatform` (IsItState), which `AdsModel` drives: UMP's consent and
/// its forms, Mobile Ads' start, a banner for each slot and the full-screen ad. On the main actor,
/// as both SDKs ask. Nothing touches either SDK until the model asks, so the unit tests' host,
/// which builds the app and never launches it, never starts them.
///
/// UMP's update is its completion-handler form, so `canRequestAds` can be read the moment it is
/// asked for; its forms are shown over whatever is on top (`TopViewController`) as they are ready.
/// A failed call shows nothing, and the answer after it is the one UMP kept. A banner's news comes
/// through its delegate to `banners`. A full-screen ad shows once and is dropped. Once the
/// purchase is owned, `stop()` drops the banners and the full-screen ad on hand.
@MainActor
public final class GoogleAds: NSObject, AdsPlatform, BannerViewDelegate,
  FullScreenContentDelegate
{
  public var banners: ((AdSlot, BannerEvent) -> Void)?

  private let units: AdUnits
  private let geography: ConsentGeography?
  /// Each slot's banner, made the first time it is asked for, and kept.
  private var bannerViews: [AdSlot: BannerView] = [:]
  /// The width each slot's banner was last sized for.
  private var sizedWidths: [AdSlot: Double] = [:]
  /// The full-screen ad loaded and not yet shown.
  private var interstitial: InterstitialAd?
  /// The full-screen ad on screen, held until it closes.
  private var showing: InterstitialAd?
  /// What `presentInterstitial()` waits on: resumed when the ad on screen closes, or fails to
  /// show.
  private var closing: CheckedContinuation<Bool, Never>?

  /// Google's SDKs with the app's ad units; under a Debug build's `-umpGeography`, UMP in that
  /// `geography`, and nil for where the phone is.
  public init(units: AdUnits = .fromInfoPlist, geography: ConsentGeography? = nil) {
    self.units = units
    self.geography = geography
    super.init()
  }

  // MARK: - Consent

  /// UMP's answer as it stands: once this launch's update is asked for, what it kept from an
  /// earlier launch; before then, that no ads may be requested (UMPConsentInformation.h).
  private var consent: AdsConsent {
    let info = ConsentInformation.shared
    return AdsConsent(
      canRequestAds: info.canRequestAds,
      privacyOptionsRequired: info.privacyOptionsRequirementStatus == .required
    )
  }

  /// UMP's update, which every launch asks for before any form. `requested` hears the answer UMP
  /// kept from an earlier launch the moment the update is asked for, as Google's own sample reads
  /// it, so Mobile Ads can start alongside the update; the answer after it is returned, or the
  /// kept one when it fails (offline). With a debug geography UMP first forgets what it kept, so
  /// each such launch asks again.
  public func updateConsent(requested: (AdsConsent) -> Void) async -> AdsConsent {
    let parameters = RequestParameters()
    if let geography {
      let debug = DebugSettings()
      debug.geography = geography == .eea ? .EEA : .other
      parameters.debugSettings = debug
      ConsentInformation.shared.reset()
    }
    await withCheckedContinuation { (updated: CheckedContinuation<Void, Never>) in
      ConsentInformation.shared.requestConsentInfoUpdate(with: parameters) { _ in
        updated.resume()
      }
      requested(consent)
    }
    return consent
  }

  /// UMP's consent form, when its answer says one is required, over whatever is on top once the
  /// form has loaded; the answer once the form closes, or at once when none is needed. The form is
  /// downloaded first and the screen to show it over found after (where
  /// `loadAndPresentIfRequired` takes it before the download): a sheet opened or closed meanwhile
  /// would leave UMP a controller it can't show from, and the launch no consent and no ads.
  public func presentConsentFormIfRequired() async -> AdsConsent {
    guard ConsentInformation.shared.consentStatus == .required, let form = await loadForm() else {
      return consent
    }
    try? await form.present(from: TopViewController.find())
    return consent
  }

  /// UMP's consent form, downloaded; nil when it can't be (offline, or none set up in AdMob).
  private func loadForm() async -> ConsentForm? {
    await withCheckedContinuation { loaded in
      ConsentForm.load { form, _ in loaded.resume(returning: form) }
    }
  }

  /// UMP's privacy options form, Settings' "Privacy choices", over whatever is on top (Settings'
  /// own sheet); the answer once it closes.
  public func presentPrivacyOptions() async -> AdsConsent {
    try? await ConsentForm.presentPrivacyOptionsForm(from: TopViewController.find())
    return consent
  }

  // MARK: - Mobile Ads

  /// Mobile Ads' start, with every ad rated G at most (spec 14.2). Neither of the requests'
  /// tags for children or for the under-aged is set.
  public func startAds() async {
    MobileAds.shared.requestConfiguration.maxAdContentRating = .general
    _ = await MobileAds.shared.start()
  }

  // MARK: - The banners

  /// The home banner's height at `width`: a large anchored adaptive banner's, 50 to 150 points,
  /// the same for a width on a phone whatever ad comes (GADAdSize.h).
  public func homeBannerHeight(width: Double) -> Double {
    Double(cgSize(for: largePortraitAnchoredAdaptiveBanner(width: CGFloat(width))).height)
  }

  /// Loads `slot`'s banner at `width`, sized again first if the width is new, with whatever is on
  /// top to show what a tap on the ad opens.
  public func loadBanner(_ slot: AdSlot, width: Double) {
    let banner = bannerView(for: slot)
    if sizedWidths[slot] != width {
      banner.adSize = Self.size(of: slot, width: width)
      sizedWidths[slot] = width
    }
    banner.rootViewController = TopViewController.find()
    banner.load(Request())
  }

  /// `slot`'s banner, made the first time it is asked for, by the model's load or by
  /// `BannerSlot`, whichever comes first, and kept: the home screen drawn again never makes
  /// another. Until its first load it has Google's standard banner size, which the load replaces
  /// with the slot's adaptive one.
  public func bannerView(for slot: AdSlot) -> BannerView {
    if let made = bannerViews[slot] { return made }
    let banner = BannerView(adSize: AdSizeBanner)
    banner.adUnitID = slot == .home ? units.homeBanner : units.pageBanner
    banner.delegate = self
    bannerViews[slot] = banner
    return banner
  }

  /// A slot's adaptive size at `width`: the home banner's large anchored one; a page end's inline
  /// one, 250 tall at most, the least height of the ad box it sits in (IsItUI's `AdBox`).
  private static func size(of slot: AdSlot, width: Double) -> AdSize {
    switch slot {
    case .home: largePortraitAnchoredAdaptiveBanner(width: CGFloat(width))
    case .pageEnd: inlineAdaptiveBanner(width: CGFloat(width), maxHeight: 250)
    }
  }

  /// A banner's ad arrived.
  public func bannerViewDidReceiveAd(_ bannerView: BannerView) {
    if let slot = slot(of: bannerView) { banners?(slot, .loaded) }
  }

  /// A banner's load failed: no fill, or no connection.
  public func bannerView(_ bannerView: BannerView, didFailToReceiveAdWithError error: any Error) {
    if let slot = slot(of: bannerView) { banners?(slot, .failed) }
  }

  /// The slot whose banner `banner` is.
  private func slot(of banner: BannerView) -> AdSlot? {
    bannerViews.first { $0.value === banner }?.key
  }

  // MARK: - The full-screen ad

  /// Loads a full-screen ad, in place of any on hand; whether one loaded.
  public func loadInterstitial() async -> Bool {
    interstitial = nil
    do {
      let ad = try await InterstitialAd.load(with: units.interstitial, request: Request())
      ad.fullScreenContentDelegate = self
      interstitial = ad
      return true
    } catch {
      return false
    }
  }

  /// Shows the loaded full-screen ad over whatever is on top, once, and returns when it closes
  /// (true); at once (false) when none is loaded or Google says it can't show from there.
  public func presentInterstitial() async -> Bool {
    guard let ad = interstitial else { return false }
    interstitial = nil
    let top = TopViewController.find()
    do {
      try ad.canPresent(from: top)
    } catch {
      return false
    }
    showing = ad
    return await withCheckedContinuation { continuation in
      closing = continuation
      ad.present(from: top)
    }
  }

  /// The full-screen ad closed.
  public func adDidDismissFullScreenContent(_ ad: any FullScreenPresentingAd) {
    closed(shown: true)
  }

  /// The full-screen ad couldn't show.
  public func ad(
    _ ad: any FullScreenPresentingAd,
    didFailToPresentFullScreenContentWithError error: any Error
  ) {
    closed(shown: false)
  }

  /// The full-screen ad on screen closed, or never showed: `presentInterstitial()` returns.
  private func closed(shown: Bool) {
    showing = nil
    closing?.resume(returning: shown)
    closing = nil
  }

  // MARK: - The purchase

  /// The purchase is owned: the banners and the full-screen ad on hand go, so nothing more is
  /// requested (Google's SDK itself can't be stopped). Each banner is taken off the screen, its
  /// delegates let go, and none is kept. A full-screen ad being shown (`showing`) is left to
  /// close, and `presentInterstitial()` returns when it does.
  public func stop() {
    for banner in bannerViews.values {
      banner.delegate = nil
      banner.adSizeDelegate = nil
      banner.removeFromSuperview()
    }
    bannerViews.removeAll()
    sizedWidths.removeAll()
    interstitial = nil
  }
}
