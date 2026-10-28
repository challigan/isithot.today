import IsItLogic
import IsItModel
import IsItState

/// The launch's later steps in the app (iOS build spec, section 9.4). Step 2 starts the purchase
/// (`PurchaseModel`): StoreKit's updates listener and the entitlement check, whose answer step 5
/// waits for. Step 5 then starts the free version's ads (`AdsModel`), which AppModel asks for
/// only when the purchase isn't owned, and which returns at once: alert sync and a pending route
/// never wait on Google's consent form. A purchase made while the app runs stops them for good
/// (`stopAds()`). Phase 7.1 fills steps 2 and 5's check and the upgrade route; the steps phase
/// 8.1 fills do nothing yet, as `NoHooks`' do.
struct LiveHooks: AppHooks {
  let ads: AdsModel
  /// The purchase, whose listener and check start at step 2.
  let purchases: PurchaseModel
  /// Whether this is the app's first run (`Launch.firstRun`), which shows no full-screen ad.
  let firstRun: Bool
  /// A Debug build's `-noads 1`: the ads never start (`DebugHooks.noAds()`).
  let noAds: Bool

  /// Starts `Transaction.updates` and the entitlement check, and returns at once. On the main
  /// actor, where the model is; `entitlement()` starts them itself if this hasn't yet.
  func startEntitlementCheck() {
    Task { @MainActor in purchases.start() }
  }

  /// Once the check has finished: whether the purchase is owned now.
  func entitlement() async -> Bool? {
    await purchases.launchEntitlement()
  }

  /// Consent, then Mobile Ads, then the banners and the full-screen ad, left running.
  func startAds() async {
    guard !noAds else { return }
    await ads.start(firstRun: firstRun)
  }

  /// The purchase became owned: no more ads this launch.
  func stopAds() async {
    await ads.stop()
  }

  /// Phase 8.1 syncs the notifications.
  func syncAlerts(target: Target, units: Units?) async {}

  /// `willitsnow://upgrade` (a locked widget, phase 7.2) opens the upgrade sheet; the rest is
  /// phase 8.1's.
  func handle(_ route: DeepLink.Route) async {
    if case .upgrade = route { await purchases.requestSheet() }
  }
}
