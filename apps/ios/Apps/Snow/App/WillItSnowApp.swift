import IsItAds
import IsItLocation
import IsItLogic
import IsItModel
import IsItPurchases
import IsItServices
import IsItState
import SwiftUI

/// will it snow? (iOS build spec, section 9). `AppModel` (IsItState) holds the state and runs
/// the launch (section 9.4); this gives it the app's services, starts the launch, and tells it
/// when the app goes to the background and comes back (section 9.5). The home screen draws the
/// model (`HomeView`). On the first launch nothing is stored, so the model asks by approximate
/// IP location and the phone's own place shows with no picker. The free version's ads
/// (`AdsModel`, IsItState) run on Google's SDKs (`GoogleAds`, IsItAds), and start at the
/// launch's step 5 (`LiveHooks`) unless the purchase is owned. The purchase (`PurchaseModel`,
/// IsItState) runs on StoreKit 2 (`StoreKitPurchases`, IsItPurchases): started at the launch's
/// step 2, asked again each time the app becomes active, and telling the model each change. A
/// willitsnow:// link (`DeepLink`) goes to the model, which follows it once the launch has
/// finished: `willitsnow://upgrade` opens the upgrade sheet.
@main
struct WillItSnowApp: App {
  @State private var model: AppModel
  /// The free version's ads, which the home screen, the picker and Settings read.
  @State private var ads: AdsModel
  /// Google's SDKs behind them, whose banners the home screen shows.
  @State private var google: GoogleAds
  /// The purchase, which the home screen, Settings and the upgrade sheet read.
  @State private var purchases: PurchaseModel
  @Environment(\.scenePhase) private var scenePhase

  /// The model with the app's services and the launch's later steps. The ads count time by the
  /// system's clock, always: a Debug build's `-clock fixed` must stop neither their retries nor
  /// the minutes between two full-screen ads. Whether this is the app's first run is read once
  /// the Debug hooks have prepared the store, so a `-resetStore` or `-fixture` launch is one.
  /// The purchase answers from `unlock.v1` until step 2 asks StoreKit, or a Debug build's
  /// stand-in for it, and tells the model each change it keeps. Nothing here touches Google's
  /// SDKs or StoreKit: only the launch does, which the unit tests' host never runs.
  @MainActor
  init() {
    let google = GoogleAds(geography: DebugHooks.umpGeography())
    let ads = AdsModel(platform: google, store: AdDefaults(), clock: SystemClock())
    let (services, unlock) = Self.environment()
    var environment = services
    let purchases = PurchaseModel(
      platform: DebugHooks.purchases() ?? StoreKitPurchases(),
      store: unlock,
      widgets: WidgetCenterReloader(),
      clock: SystemClock(),
      productID: Constants.Purchase.productID
    )
    environment.hooks = LiveHooks(
      ads: ads,
      purchases: purchases,
      firstRun: Launch.firstRun(environment.store),
      noAds: DebugHooks.noAds()
    )
    let model = AppModel(environment: environment)
    purchases.changed = { [weak model] owned in await model?.purchaseChanged(owned: owned) }
    _google = State(initialValue: google)
    _ads = State(initialValue: ads)
    _purchases = State(initialValue: purchases)
    _model = State(initialValue: model)
  }

  var body: some Scene {
    WindowGroup {
      HomeView(model: model, ads: ads, google: google, purchases: purchases)
        .task {
          guard DebugHooks.launches() else { return }
          await model.launch()
        }
        .onChange(of: scenePhase) { _, phase in
          switch phase {
          case .background:
            model.didEnterBackground()
          case .active:
            Task { await model.willEnterForeground() }
            // The product, and an update still ahead of the entitlements, asked again; nothing
            // until step 2 has started the purchase, so a test host never asks StoreKit.
            Task { await purchases.becameActive() }
          default:
            break
          }
        }
        // Before the launch has finished, the model keeps the route for its step 7.
        .onOpenURL { url in
          guard let route = DeepLink.parse(url) else { return }
          Task { await model.open(route) }
        }
    }
  }

  /// The app's services (section 9.3): the API over URLSession, the system's clock, the App
  /// Group's store, which the widgets read, WidgetKit's reloads, Core Location, and the recent
  /// and saved places in the app's own defaults; and, apart, `unlock.v1`, which only the purchase
  /// writes (`UnlockStore`). Without the App Group, a Debug build keeps things in its own
  /// container; any other build keeps them in memory only, and the widgets see nothing. The
  /// launch's later steps come once the store is ready (`init()`). A Debug build's hooks may
  /// stand in for the server, the clock, the location and the purchase (`DebugHooks`); a Release
  /// build's never do.
  @MainActor
  private static func environment() -> (AppEnvironment, any UnlockStore) {
    let shared = SharedStore.appGroupID().flatMap {
      SharedStore.open(appGroup: $0, fallback: DebugHooks.storeFallback)
    }
    DebugHooks.prepare(store: shared)
    let store: any StoredState
    let unlock: any UnlockStore
    if let shared {
      store = shared
      unlock = shared
    } else {
      store = MemoryState()
      unlock = MemoryUnlockStore()
    }
    let transport = DebugHooks.transport(forgetting: shared) ?? URLSessionTransport()
    let origin = DebugHooks.apiOrigin() ?? APIClient.origin() ?? APIClient.defaultOrigin
    let environment = AppEnvironment(
      client: APIClient(origin: origin, transport: transport),
      clock: DebugHooks.clock() ?? SystemClock(),
      waits: DebugHooks.waits(),
      store: DebugHooks.store(store),
      widgets: WidgetCenterReloader(),
      location: DebugHooks.location() ?? CoreLocationService(),
      recents: RecentDefaults(),
      saved: SavedPlaceDefaults()
    )
    return (environment, DebugHooks.unlockStore() ?? unlock)
  }
}
