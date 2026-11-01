import Foundation
import IsItLogic
import IsItModel
import IsItState
import Testing

/// UMP's answers the ads tests start from.
extension AdsConsent {
  /// No ads yet, and no privacy options form: a first launch before UMP has answered.
  static let unknown = AdsConsent(canRequestAds: false, privacyOptionsRequired: false)
  /// Ads, and no privacy options form: outside the EEA and the UK.
  static let outside = AdsConsent(canRequestAds: true, privacyOptionsRequired: false)
  /// No ads until the consent form is answered, and the privacy options form to answer it: in
  /// the EEA, before the user has.
  static let required = AdsConsent(canRequestAds: false, privacyOptionsRequired: true)
  /// Ads, with the privacy options form to change the answer: in the EEA, once answered.
  static let consented = AdsConsent(canRequestAds: true, privacyOptionsRequired: true)
}

/// Google's SDKs as the tests have them answer, noting each call in order. UMP's kept answer is
/// `consent`, which the update tells the model as soon as it is asked for, as UMP's own does; the
/// update and each form replace it with what the test set for them, or keep it (a failure, or no
/// form to show). The calls in `holding` wait until the test releases them.
@MainActor
final class FakeAdsPlatform: AdsPlatform {
  /// The calls a test can hold.
  enum Held: Hashable {
    case update
    /// The consent form, on screen until the test releases it.
    case form
    /// Mobile Ads' start.
    case startAds
    /// The privacy options form, on screen until the test releases it.
    case privacyOptions
    case loadInterstitial
    case presentInterstitial
  }

  var consent: AdsConsent
  /// What UMP says after the update, after the consent form, and after the privacy options form;
  /// nil keeps what it said before.
  var afterUpdate: AdsConsent?
  var afterForm: AdsConsent?
  var afterPrivacyOptions: AdsConsent?
  /// Whether a full-screen ad loads, and whether one loaded shows.
  var interstitialLoads = true
  var interstitialPresents = true
  /// The home banner's height at any width.
  var bannerHeight = 61.0
  var banners: ((AdSlot, BannerEvent) -> Void)?
  /// The calls made, in order.
  private(set) var calls: [String] = []
  private let gates: [Held: Gate]

  init(consent: AdsConsent, holding: Set<Held> = []) {
    self.consent = consent
    gates = Dictionary(uniqueKeysWithValues: holding.map { ($0, Gate()) })
  }

  /// The banner calls only: heights asked for and loads, as "bannerHeight 390" and
  /// "banner home 390" or "banner today 358".
  var bannerCalls: [String] { calls.filter { $0.hasPrefix("banner") } }
  /// The full-screen ad's calls only.
  var interstitialCalls: [String] { calls.filter { $0.hasSuffix("Interstitial") } }

  /// Lets a held call through, and every later one.
  func release(_ held: Held) {
    gates[held]?.open()
  }

  /// Gives the model `slot`'s banner news, as the SDK's delegate would.
  func tell(_ slot: AdSlot, _ event: BannerEvent) {
    banners?(slot, event)
  }

  func updateConsent(requested: (AdsConsent) -> Void) async -> AdsConsent {
    calls.append("updateConsent")
    requested(consent)
    await gates[.update]?.wait()
    if let afterUpdate { consent = afterUpdate }
    return consent
  }

  func presentConsentFormIfRequired() async -> AdsConsent {
    calls.append("presentConsentForm")
    await gates[.form]?.wait()
    if let afterForm { consent = afterForm }
    return consent
  }

  func presentPrivacyOptions() async -> AdsConsent {
    calls.append("presentPrivacyOptions")
    await gates[.privacyOptions]?.wait()
    if let afterPrivacyOptions { consent = afterPrivacyOptions }
    return consent
  }

  func startAds() async {
    calls.append("startAds")
    await gates[.startAds]?.wait()
  }

  func homeBannerHeight(width: Double) -> Double {
    calls.append("bannerHeight \(points(width))")
    return bannerHeight
  }

  func loadBanner(_ slot: AdSlot, width: Double) {
    switch slot {
    case .home: calls.append("banner home \(points(width))")
    case .pageEnd(let view): calls.append("banner \(view.rawValue) \(points(width))")
    }
  }

  func loadInterstitial() async -> Bool {
    calls.append("loadInterstitial")
    await gates[.loadInterstitial]?.wait()
    return interstitialLoads
  }

  func presentInterstitial() async -> Bool {
    calls.append("presentInterstitial")
    await gates[.presentInterstitial]?.wait()
    return interstitialPresents
  }

  func stop() {
    calls.append("stop")
  }

  /// A width as the calls note it: whole points without a fraction.
  private func points(_ width: Double) -> String {
    width == width.rounded() ? String(Int(width)) : String(width)
  }
}

/// An ads model with a fake SDK, the last full-screen ad kept in memory, and a clock the test
/// moves, starting at `moment`.
@MainActor
struct AdsHarness {
  /// 9:05am on 2 December 2026.
  nonisolated static let moment = Date(epochMs: 1_796_202_300_000)

  let platform: FakeAdsPlatform
  let store: MemoryAdsStore
  let clock: TestClock
  let model: AdsModel

  init(
    consent: AdsConsent = .outside,
    holding: Set<FakeAdsPlatform.Held> = [],
    lastShown: Date? = nil
  ) {
    platform = FakeAdsPlatform(consent: consent, holding: holding)
    store = MemoryAdsStore(lastShown)
    clock = TestClock(Self.moment)
    model = AdsModel(platform: platform, store: store, clock: clock)
  }

  /// Starts the ads, and once they are on, lets what they load come; whether they came on.
  func on(firstRun: Bool = false) async -> Bool {
    model.start(firstRun: firstRun)
    let on = await yieldUntil { model.phase == .on }
    await settle()
    return on
  }

  /// The user chooses a place; how many times the model has called back, so far.
  func choose() -> Locked<Int> {
    let done = Locked(0)
    model.placeChosen { done.change { $0 += 1 } }
    return done
  }
}

/// Lets the other tasks run for a while, so that a test can see nothing more happens.
@MainActor
func settle() async {
  for _ in 0..<1_000 { await Task.yield() }
}
