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
      guard let name = fixtureName(arguments) else { return nil }
      do {
        let response = try TodayResponse.decode(from: fixtureData(name))
        return LaunchAnswer(key: "fixture:\(name)", savedAt: response.updatedAt, response: response)
      } catch {
        fatalError("-fixture: \(name).json doesn't decode: \(error)")
      }
    }

    /// With `-fixture <name>`, the moment the fixture is for (`_fixture.now`), which the home
    /// screen shows it at, so a fixture launched on any day shows the state it was made for (the
    /// hour picked, Tomorrow from 6pm, no recent forecast). Nil without, for the system clock.
    static let launchMoment: Date? = fixtureMoment(ProcessInfo.processInfo.arguments)

    static func fixtureMoment(_ arguments: [String]) -> Date? {
      guard let name = fixtureName(arguments) else { return nil }
      guard
        let fixture = try? JSONDecoder().decode(FixtureNote.self, from: fixtureData(name)),
        let moment = ApiJSON.parseDate(fixture.note.now)
      else { fatalError("-fixture: \(name).json has no moment") }
      return moment
    }

    /// The fixture `-fixture` names, if any.
    private static func fixtureName(_ arguments: [String]) -> String? {
      guard let flag = arguments.firstIndex(of: "-fixture"), arguments.indices.contains(flag + 1)
      else { return nil }
      return arguments[flag + 1]
    }

    /// The fixture's file, from the copy only Debug builds bundle. A name with no fixture stops
    /// the app.
    private static func fixtureData(_ name: String) -> Data {
      guard
        let url = Bundle.main.url(
          forResource: name,
          withExtension: "json",
          subdirectory: "Fixtures"
        ),
        let data = try? Data(contentsOf: url)
      else { fatalError("-fixture: the app has no Fixtures/\(name).json") }
      return data
    }
  #else
    static let storeFallback = false

    static func prepare() {}

    static func launchAnswer() -> LaunchAnswer? { nil }

    static let launchMoment: Date? = nil
  #endif
}

#if DEBUG
  /// What a fixture says about itself (`_fixture`), as far as the hooks read it: its moment.
  private struct FixtureNote: Decodable {
    struct Note: Decodable {
      /// ISO 8601 UTC.
      let now: String
    }

    let note: Note

    enum CodingKeys: String, CodingKey {
      case note = "_fixture"
    }
  }
#endif
