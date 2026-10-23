import SwiftUI

/// will it snow? (iOS build spec, section 9). The skeleton: it shows the answer a Debug build is
/// launched with (`-fixture`) and saves it in the App Group, where the widget reads it. Phase 5
/// brings the fetch and the home screen.
@main
struct WillItSnowApp: App {
  @State private var model = AppModel()

  var body: some Scene {
    WindowGroup {
      HomeView(model: model)
    }
  }
}
