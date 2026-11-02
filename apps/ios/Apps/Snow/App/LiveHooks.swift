import IsItLogic
import IsItModel
import IsItState

/// The launch's later steps in the app (iOS build spec, section 9.4). Step 2 starts the purchase
/// (`PurchaseModel`): StoreKit's updates listener and the entitlement check, whose answer step 5
/// waits for. Step 5 then starts the free version's ads (`AdsModel`), which AppModel asks for
/// only when the purchase isn't owned, and which returns at once: alert sync and a pending route
/// never wait on Google's consent form. A purchase made while the app runs stops them for good
/// (`stopAds()`). Phase 7.1 fills steps 2 and 5's check and the upgrade route. Phase 8.1 fills
/// step 6, the notifications (`NotificationsModel`), whose sync also follows a place chosen in
/// the picker and a change of units, and returns at once too; and the route to Settings →
/// Notifications.
struct LiveHooks: AppHooks {
  let ads: AdsModel
  /// The purchase, whose listener and check start at step 2.
  let purchases: PurchaseModel
  /// The notifications, which start at step 6.
  let notifications: NotificationsModel
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

  /// The place on screen and its units, to the notifications, which start at the first and sync
  /// in a task: this returns at once.
  func syncAlerts(target: Target, units: Units?) async {
    await notifications.screenChanged(target: target, units: units)
  }

  /// `willitsnow://upgrade` (a locked widget, phase 7.2) opens the upgrade sheet;
  /// `willitsnow://settings/notifications` and iOS Settings' link open Settings. A widget's view
  /// and a notification's place are AppModel's own, on screen already.
  func handle(_ route: DeepLink.Route) async {
    switch route {
    case .upgrade:
      await purchases.requestSheet()
    case .settings(.notifications):
      await notifications.requestSettings()
    case .view, .place:
      break
    }
  }
}
