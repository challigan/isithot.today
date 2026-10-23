import IsItServices
import IsItState
import SwiftUI

/// will it snow? (iOS build spec, section 9). `AppModel` (IsItState) holds the state and runs
/// the launch (section 9.4); this gives it the app's services, starts the launch, and tells it
/// when the app goes to the background and comes back (section 9.5).
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

  /// The app's services (section 9.3): the API over URLSession, the App Group's store, which
  /// the widgets read, and WidgetKit's reloads. Without the App Group, a Debug build keeps
  /// things in its own container; any other build keeps them in memory only, and the widgets
  /// see nothing. The later phases' steps do nothing yet (`NoHooks`).
  @MainActor
  private static func environment() -> AppEnvironment {
    DebugHooks.prepare()
    let shared = SharedStore.appGroupID().flatMap {
      SharedStore.open(appGroup: $0, fallback: DebugHooks.storeFallback)
    }
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
      store: store,
      widgets: WidgetCenterReloader()
    )
  }
}
