import IsItLocation
import IsItServices
import IsItState
import SwiftUI

/// will it snow? (iOS build spec, section 9). `AppModel` (IsItState) holds the state and runs
/// the launch (section 9.4); this gives it the app's services, starts the launch, and tells it
/// when the app goes to the background and comes back (section 9.5). The home screen draws the
/// model (`HomeView`). On the first launch nothing is stored, so the model asks by approximate
/// IP location and the phone's own place shows with no picker.
@main
struct WillItSnowApp: App {
  @State private var model = AppModel(environment: WillItSnowApp.environment())
  @Environment(\.scenePhase) private var scenePhase

  var body: some Scene {
    WindowGroup {
      HomeView(model: model)
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
  /// places in the app's own defaults. Without the App Group, a Debug build keeps things in its
  /// own container; any other build keeps them in memory only, and the widgets see nothing. The
  /// later phases' steps do nothing yet (`NoHooks`). A Debug build's hooks may stand in for the
  /// server, the clock and the location (`DebugHooks`); a Release build's never do.
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
      store: store,
      widgets: WidgetCenterReloader(),
      location: DebugHooks.location() ?? CoreLocationService(),
      recents: RecentDefaults()
    )
  }
}
