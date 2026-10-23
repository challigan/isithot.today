import Foundation
import IsItModel
import UIKit

/// Every test and debug hook in the app (iOS build spec, section 9.8), here and nowhere else.
/// A Release build compiles none of them: there each one is a stub that does nothing and names
/// no launch argument, and the fixtures aren't in its bundle (`EXCLUDED_SOURCE_FILE_NAMES`).
@MainActor
enum DebugHooks {
  /// An answer to show at launch, as if it had just been fetched.
  struct LaunchAnswer {
    let key: String
    let savedAt: Date
    let response: TodayResponse
  }

  #if DEBUG
    /// When the App Group can't open, keep the last answer in the app's own container (V1), so a
    /// Debug build signed without the entitlement still works on its own.
    static let storeFallback = true

    /// The launch arguments that change how the app runs: `-uitest` turns animations off.
    static func prepare(arguments: [String] = ProcessInfo.processInfo.arguments) {
      if arguments.contains("-uitest") {
        UIView.setAnimationsEnabled(false)
      }
    }

    /// `-fixture <name>`: a fixture `pnpm mobile:generate` wrote (packages/mobile), from the copy
    /// only Debug builds bundle, saved as fetched at its own moment. Its key names the fixture,
    /// since no place's key is worked out yet. A name with no fixture stops the app, so a UI test
    /// can't pass on the wrong screen.
    static func launchAnswer(
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> LaunchAnswer? {
      guard let flag = arguments.firstIndex(of: "-fixture"), arguments.indices.contains(flag + 1)
      else { return nil }
      let name = arguments[flag + 1]
      guard
        let url = Bundle.main.url(
          forResource: name,
          withExtension: "json",
          subdirectory: "Fixtures"
        ),
        let data = try? Data(contentsOf: url)
      else { fatalError("-fixture: the app has no Fixtures/\(name).json") }
      do {
        let response = try TodayResponse.decode(from: data)
        return LaunchAnswer(key: "fixture:\(name)", savedAt: response.updatedAt, response: response)
      } catch {
        fatalError("-fixture: \(name).json doesn't decode: \(error)")
      }
    }
  #else
    static let storeFallback = false

    static func prepare() {}

    static func launchAnswer() -> LaunchAnswer? { nil }
  #endif
}
