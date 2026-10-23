import Foundation
import IsItModel
import IsItServices
import IsItState
import UIKit

/// Every test and debug hook in the app (iOS build spec, section 9.8), here and nowhere else.
/// A Release build compiles none of them: there each one is a stub that does nothing and names
/// no launch argument, and the fixtures aren't in its bundle (`EXCLUDED_SOURCE_FILE_NAMES`).
@MainActor
enum DebugHooks {
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

    /// `-fixture <name>`: the server answers every request with a fixture `pnpm mobile:generate`
    /// wrote (packages/mobile), from the copy only Debug builds bundle, as if fetched now. The
    /// saved answer is forgotten first, so the launch fetches the fixture rather than painting
    /// what an earlier launch saved; the fixture is then saved, for the widget, as any answer
    /// is. A name with no fixture, or one that doesn't decode, stops the app, so a UI test can't
    /// pass on the wrong screen.
    static func transport(
      forgetting store: SharedStore?,
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> (any HTTPTransport)? {
      guard let name = value(after: "-fixture", in: arguments) else { return nil }
      let data = fixtureData(name)
      do {
        _ = try TodayResponse.decode(from: data)
      } catch {
        fatalError("-fixture: \(name).json doesn't decode: \(error)")
      }
      try? store?.removeToday()
      return FixtureTransport(body: data)
    }

    /// With `-fixture <name>`, the moment the fixture is for (`_fixture.now`), which the home
    /// screen shows it at, so a fixture launched on any day shows the state it was made for (the
    /// hour picked, Tomorrow from 6pm, no recent forecast). Nil without, for the system clock.
    static let launchMoment: Date? = fixtureMoment(ProcessInfo.processInfo.arguments)

    static func fixtureMoment(_ arguments: [String]) -> Date? {
      guard let name = value(after: "-fixture", in: arguments) else { return nil }
      guard
        let fixture = try? JSONDecoder().decode(FixtureNote.self, from: fixtureData(name)),
        let moment = ApiJSON.parseDate(fixture.note.now)
      else { fatalError("-fixture: \(name).json has no moment") }
      return moment
    }

    /// `-apiOrigin <url>`: a deploy preview's API instead of willitsnow.today's (section 4).
    static func apiOrigin(arguments: [String] = ProcessInfo.processInfo.arguments) -> URL? {
      value(after: "-apiOrigin", in: arguments).flatMap { URL(string: $0) }
    }

    /// Whether the app launches (`AppModel.launch()`): not while it only hosts the unit tests,
    /// which own the App Group meanwhile (the hosted tests run in the app's process, with
    /// XCTest's configuration in its environment), unless it was launched on a fixture.
    nonisolated static func launches(
      arguments: [String] = ProcessInfo.processInfo.arguments,
      environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Bool {
      environment["XCTestConfigurationFilePath"] == nil || arguments.contains("-fixture")
    }

    /// The argument after `flag`, if there is one.
    private static func value(after flag: String, in arguments: [String]) -> String? {
      guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1)
      else { return nil }
      return arguments[index + 1]
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

    static func transport(forgetting store: SharedStore?) -> (any HTTPTransport)? { nil }

    static let launchMoment: Date? = nil

    static func apiOrigin() -> URL? { nil }

    nonisolated static func launches() -> Bool { true }
  #endif
}

#if DEBUG
  /// A server that answers every request with the same fixture, with status 200.
  private struct FixtureTransport: HTTPTransport {
    let body: Data

    func get(_ request: HTTPRequest) async throws -> HTTPResponse {
      HTTPResponse(status: 200, body: body)
    }
  }

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
