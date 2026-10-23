import Foundation
import IsItModel
import IsItServices
import IsItState
import Observation
import SwiftUI
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

    /// The launch arguments that change how the app starts, before the model reads `store`:
    /// `-uitest` turns animations off; `-resetStore` forgets the place, the units and the saved
    /// answer, for a first launch (not the purchase, which only StoreKit's code writes).
    static func prepare(
      store: SharedStore?,
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) {
      if arguments.contains("-uitest") {
        UIView.setAnimationsEnabled(false)
      }
      if arguments.contains("-resetStore"), let store {
        store.savePlace(.ip)
        store.defaults.removeObject(forKey: Keys.AppGroup.units)
        do {
          try store.removeToday()
        } catch {
          fatalError("-resetStore: the saved answer can't be removed: \(error)")
        }
      }
    }

    /// The server the app asks instead of willitsnow.today's, from the fixtures `pnpm
    /// mobile:generate` wrote (packages/mobile), which only Debug builds bundle:
    ///
    /// - `-fixture <name>` answers every request with that fixture, as if fetched now, after
    ///   forgetting the saved answer, so the launch fetches the fixture rather than painting what
    ///   an earlier launch saved; the fixture is then saved, for the widget, as any answer is.
    /// - `-network <name>` leaves the app's own transport, URLSession and section 4's settings
    ///   in place and stubs the network beneath them (`URLProtocolStub`): it answers the request
    ///   for approximate IP location with that fixture, and any other request with an error.
    ///   Nothing is forgotten, so a launch paints and reuses what was saved, as it does for real.
    ///   `-network off` has no connection at all.
    ///
    /// A name with no fixture, or one that doesn't decode, stops the app, so a UI test can't pass
    /// on the wrong screen. Nil, for willitsnow.today, without either.
    static func transport(
      forgetting store: SharedStore?,
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> (any HTTPTransport)? {
      if let name = value(after: "-fixture", in: arguments) {
        let data = answerData(name)
        try? store?.removeToday()
        return FixtureTransport(body: data)
      }
      guard value(after: "-network", in: arguments) != nil else { return nil }
      // Read now, on the main thread, so a bad name stops the launch rather than a request.
      _ = URLProtocolStub.server
      let configuration = URLSessionTransport.configuration()
      configuration.protocolClasses = [URLProtocolStub.self]
      return URLSessionTransport(session: URLSession(configuration: configuration))
    }

    /// The model's clock: from `-now <iso>` when given, else from the moment of the fixture
    /// `-fixture` or `-network` names (`_fixture.now`), running on from there, so a fixture
    /// launched on any day shows the state it was made for (the hour picked, Tomorrow from 6pm
    /// at the place, no recent forecast). Nil, for the system's clock, without either.
    static func clock(arguments: [String] = ProcessInfo.processInfo.arguments) -> (any AppClock)? {
      if let text = value(after: "-now", in: arguments) {
        guard let start = ApiJSON.parseDate(text) else {
          fatalError("-now: \(text) isn't an ISO 8601 moment")
        }
        return SystemClock(startingAt: start)
      }
      let network = value(after: "-network", in: arguments).flatMap { $0 == "off" ? nil : $0 }
      guard let name = value(after: "-fixture", in: arguments) ?? network else { return nil }
      return SystemClock(startingAt: fixtureMoment(name))
    }

    /// `-apiOrigin <url>`: a deploy preview's API instead of willitsnow.today's (section 4).
    static func apiOrigin(arguments: [String] = ProcessInfo.processInfo.arguments) -> URL? {
      value(after: "-apiOrigin", in: arguments).flatMap { URL(string: $0) }
    }

    /// What `-openURLs` asks for: Settings records each web page and email it would open, on
    /// screen (`debugRecorder()`), instead of leaving the app; with `nomail` it also refuses
    /// every email, as a phone with no mail app does, so the fallback sheet shows.
    enum OpenURLs: String {
      case record
      case nomail
    }

    /// `-openURLs record|nomail`, for SettingsTests; nil without it, when links open as they do
    /// for real. Any other value stops the app, so a test can't pass on the wrong screen.
    nonisolated static func openURLs(
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> OpenURLs? {
      guard let mode = value(after: "-openURLs", in: arguments) else { return nil }
      guard let known = OpenURLs(rawValue: mode) else {
        fatalError("-openURLs: \(mode) is neither record nor nomail")
      }
      return known
    }

    /// Whether the app launches (`AppModel.launch()`): not while it only hosts the unit tests,
    /// which own the App Group meanwhile (the hosted tests run in the app's process, with
    /// XCTest's configuration in its environment), unless it was launched on a stubbed server.
    nonisolated static func launches(
      arguments: [String] = ProcessInfo.processInfo.arguments,
      environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Bool {
      environment["XCTestConfigurationFilePath"] == nil || arguments.contains("-fixture")
        || arguments.contains("-network")
    }

    /// The argument after `flag`, if there is one.
    fileprivate nonisolated static func value(after flag: String, in arguments: [String])
      -> String?
    {
      guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1)
      else { return nil }
      return arguments[index + 1]
    }

    /// The fixture's answer, as the server sent it, checked to decode.
    fileprivate nonisolated static func answerData(_ name: String) -> Data {
      let data = fixtureData(name)
      do {
        _ = try TodayResponse.decode(from: data)
      } catch {
        fatalError("\(name).json doesn't decode: \(error)")
      }
      return data
    }

    /// The moment the fixture was made for (`_fixture.now`).
    private static func fixtureMoment(_ name: String) -> Date {
      guard
        let fixture = try? JSONDecoder().decode(FixtureNote.self, from: fixtureData(name)),
        let moment = ApiJSON.parseDate(fixture.note.now)
      else { fatalError("\(name).json has no moment") }
      return moment
    }

    /// The fixture's file, from the copy only Debug builds bundle. A name with no fixture stops
    /// the app.
    private nonisolated static func fixtureData(_ name: String) -> Data {
      guard
        let url = Bundle.main.url(
          forResource: name,
          withExtension: "json",
          subdirectory: "Fixtures"
        ),
        let data = try? Data(contentsOf: url)
      else { fatalError("The app has no Fixtures/\(name).json") }
      return data
    }
  #else
    static let storeFallback = false

    static func prepare(store: SharedStore?) {}

    static func transport(forgetting store: SharedStore?) -> (any HTTPTransport)? { nil }

    static func clock() -> (any AppClock)? { nil }

    static func apiOrigin() -> URL? { nil }

    nonisolated static func launches() -> Bool { true }
  #endif
}

#if DEBUG
  /// `-fixture`'s server: every request answered with the same fixture, with status 200. The
  /// units each asked in are noted for the recorder (`DebugRecorder`).
  private struct FixtureTransport: HTTPTransport {
    let body: Data

    func get(_ request: HTTPRequest) async throws -> HTTPResponse {
      DebugRecorder.requested(request.url)
      return HTTPResponse(status: 200, body: body)
    }
  }

  /// `-network`'s server, as `URLProtocolStub` answers.
  private struct StubServer {
    enum Reply {
      case failure(URLError.Code)
      case answer(status: Int, body: Data)
    }

    /// The fixture it answers with; nil for `-network off`.
    let fixture: Data?

    /// The server `-network` names in `arguments`, or nil without it.
    init?(arguments: [String]) {
      guard let mode = DebugHooks.value(after: "-network", in: arguments) else { return nil }
      fixture = mode == "off" ? nil : DebugHooks.answerData(mode)
    }

    /// No connection for `-network off`. Otherwise the fixture for the app's request for
    /// approximate IP location (`GET /api/v1/today` with `ahead=snow`, and `units` once they are
    /// known or `t` past the caches, but no place); a 404 for another path, and a 400 for any
    /// other request, both with no body, so a request for the wrong place shows the error,
    /// never an answer.
    func reply(to request: URLRequest) -> Reply {
      guard let fixture else { return .failure(.notConnectedToInternet) }
      guard request.httpMethod == "GET", let url = request.url,
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
        components.path == "/api/v1/today"
      else { return .answer(status: 404, body: Data()) }
      let items = components.queryItems ?? []
      let names = Set(items.map(\.name))
      let ahead = items.first { $0.name == "ahead" }?.value
      guard ahead == "snow", names.isSubset(of: ["ahead", "units", "t"]) else {
        return .answer(status: 400, body: Data())
      }
      return .answer(status: 200, body: fixture)
    }
  }

  /// Section 9.8's URLProtocol stub: under `-network`, the network beneath the app's own
  /// URLSession transport, answering as `StubServer` says.
  private final class URLProtocolStub: URLProtocol {
    /// Read once, from the launch arguments.
    static let server = StubServer(arguments: ProcessInfo.processInfo.arguments)

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
      guard let client else { return }
      if let url = request.url { DebugRecorder.requested(url) }
      switch Self.server?.reply(to: request) ?? .failure(.notConnectedToInternet) {
      case .failure(let code):
        client.urlProtocol(self, didFailWithError: URLError(code))
      case .answer(let status, let body):
        guard
          let url = request.url,
          let response = HTTPURLResponse(
            url: url,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
          )
        else {
          client.urlProtocol(self, didFailWithError: URLError(.badURL))
          return
        }
        client.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client.urlProtocol(self, didLoad: body)
        client.urlProtocolDidFinishLoading(self)
      }
    }

    override func stopLoading() {}
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

  /// What `-openURLs` shows (`debugRecorder()`): the last web page or email the app would have
  /// opened, and the units the last request to the server asked in, so a UI test reads both on
  /// screen. Only the units of a request, never its place.
  @MainActor
  @Observable
  final class DebugRecorder {
    static let shared = DebugRecorder()

    /// The last URL `openURL` was given, as text; "none" before the first.
    var opened = none
    /// The `units` the last request asked in: "c", "f", or "none" without, or before the first.
    var units = none

    /// What a line says with nothing to show, so that it is on screen from the start.
    private nonisolated static let none = "none"

    /// Notes the units `url`, a request to the server, asks in; from any thread.
    nonisolated static func requested(_ url: URL) {
      let units =
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
        .first { $0.name == "units" }?.value ?? none
      Task { @MainActor in shared.units = units }
    }
  }

  /// Under `-openURLs`: every URL the view opens is recorded instead of opened, a mail URL
  /// refused too under `nomail`, and the recorder's two lines show below the content.
  @MainActor
  private struct URLRecorder: ViewModifier {
    let mode: DebugHooks.OpenURLs

    func body(content: Content) -> some View {
      let recorder = DebugRecorder.shared
      content
        .environment(
          \.openURL,
          OpenURLAction { url in
            recorder.opened = url.absoluteString
            return mode == .nomail && url.scheme == "mailto" ? .discarded : .handled
          }
        )
        .safeAreaInset(edge: .bottom) {
          VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: recorder.opened)
              .accessibilityIdentifier("debug-opened")
            Text(verbatim: recorder.units)
              .accessibilityIdentifier("debug-units")
          }
          .font(.caption2)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 16)
          .padding(.vertical, 4)
          .background(.bar)
        }
    }
  }
#endif

extension View {
  #if DEBUG
    /// Under `-openURLs`, the URL recorder (`DebugHooks.openURLs`); otherwise the view as it is.
    @MainActor
    @ViewBuilder
    func debugRecorder() -> some View {
      if let mode = DebugHooks.openURLs() {
        modifier(URLRecorder(mode: mode))
      } else {
        self
      }
    }
  #else
    /// A Release build records nothing: the view as it is.
    func debugRecorder() -> some View { self }
  #endif
}
