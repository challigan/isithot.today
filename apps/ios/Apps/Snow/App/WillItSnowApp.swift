import IsItAds
import IsItLocation
import IsItServices
import IsItState
import SwiftUI

/// will it snow? (iOS build spec, section 9). `AppModel` (IsItState) holds the state and runs
/// the launch (section 9.4); this gives it the app's services, starts the launch, and tells it
/// when the app goes to the background and comes back (section 9.5). The home screen draws the
/// model (`HomeView`). On the first launch nothing is stored, so the model asks by approximate
/// IP location and the phone's own place shows with no picker. The free version's ads
/// (`AdsModel`, IsItState) run on Google's SDKs (`GoogleAds`, IsItAds), and start at the
/// launch's step 5 (`LiveHooks`) unless the purchase is owned.
@main
struct WillItSnowApp: App {
  @State private var model: AppModel
  /// The free version's ads, which the home screen, the picker and Settings read.
  @State private var ads: AdsModel
  /// Google's SDKs behind them, whose banners the home screen shows.
  @State private var google: GoogleAds
  @Environment(\.scenePhase) private var scenePhase

  /// The model with the app's services and the launch's later steps. The ads count time by the
  /// system's clock, always: a Debug build's `-clock fixed` must stop neither their retries nor
  /// the minutes between two full-screen ads. Whether this is the app's first run is read once
  /// the Debug hooks have prepared the store, so a `-resetStore` or `-fixture` launch is one.
  /// Nothing here touches Google's SDKs: only the launch does, which the unit tests' host never
  /// runs.
  @MainActor
  init() {
    let google = GoogleAds(geography: DebugHooks.umpGeography())
    let ads = AdsModel(platform: google, store: AdDefaults(), clock: SystemClock())
    var environment = Self.environment()
    environment.hooks = LiveHooks(
      ads: ads,
      firstRun: Launch.firstRun(environment.store),
      noAds: DebugHooks.noAds()
    )
    _google = State(initialValue: google)
    _ads = State(initialValue: ads)
    _model = State(initialValue: AppModel(environment: environment))
  }

  var body: some Scene {
    WindowGroup {
      HomeView(model: model, ads: ads, google: google)
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
          default:
            break
          }
        }
    }
  }

  /// The app's services (section 9.3): the API over URLSession, the system's clock, the App
  /// Group's store, which the widgets read, WidgetKit's reloads, Core Location, and the recent
  /// and saved places in the app's own defaults. Without the App Group, a Debug build keeps
  /// things in its own container; any other build keeps them in memory only, and the widgets see
  /// nothing. The launch's later steps come once the store is ready (`init()`). A Debug build's
  /// hooks may stand in for the server, the clock, the location and the purchase (`DebugHooks`);
  /// a Release build's never do.
  @MainActor
  private static func environment() -> AppEnvironment {
    let shared = SharedStore.appGroupID().flatMap {
      SharedStore.open(appGroup: $0, fallback: DebugHooks.storeFallback)
    }
    DebugHooks.prepare(store: shared)
    let store: any StoredState
    if let shared {
      store = shared
    } else {
      store = MemoryState()
    }
    let transport = DebugHooks.transport(forgetting: shared) ?? URLSessionTransport()
    let origin = DebugHooks.apiOrigin() ?? APIClient.origin() ?? APIClient.defaultOrigin
    return AppEnvironment(
      client: APIClient(origin: origin, transport: transport),
      clock: DebugHooks.clock() ?? SystemClock(),
      waits: DebugHooks.waits(),
      store: DebugHooks.store(store),
      widgets: WidgetCenterReloader(),
      location: DebugHooks.location() ?? CoreLocationService(),
      recents: RecentDefaults(),
      saved: SavedPlaceDefaults()
    )
  }
}
