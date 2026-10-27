import IsItLogic
import IsItModel
import IsItState

/// The launch's later steps in the app (iOS build spec, section 9.4). Step 5 starts the free
/// version's ads (`AdsModel`), which AppModel asks for only when the purchase isn't owned, and
/// which returns at once: alert sync and a pending route never wait on Google's consent form. The
/// steps phases 7 and 8.1 fill do nothing yet, as `NoHooks`' do.
struct LiveHooks: AppHooks {
  let ads: AdsModel
  /// Whether this is the app's first run (`Launch.firstRun`), which shows no full-screen ad.
  let firstRun: Bool
  /// A Debug build's `-noads 1`: the ads never start (`DebugHooks.noAds()`).
  let noAds: Bool

  /// Phase 7 starts StoreKit here.
  func startEntitlementCheck() {}

  /// Phase 7 answers from StoreKit; until then `unlock.v1` stands.
  func entitlement() async -> Bool? { nil }

  /// Consent, then Mobile Ads, then the banners and the full-screen ad, left running.
  func startAds() async {
    guard !noAds else { return }
    await ads.start(firstRun: firstRun)
  }

  /// Phase 8.1 syncs the notifications.
  func syncAlerts(target: Target, units: Units?) async {}

  /// Phases 6 and 8.1 route.
  func handle(_ route: DeepLink.Route) async {}
}
