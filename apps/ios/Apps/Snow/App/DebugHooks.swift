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
    /// `-uitest` turns animations off; `-resetStore` forgets the place, the units, the saved
    /// answer and the recent places, for a first launch (not the purchase, which only StoreKit's
    /// code writes).
    static func prepare(
      store: SharedStore?,
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) {
      if arguments.contains("-uitest") {
        UIView.setAnimationsEnabled(false)
      }
      if arguments.contains("-resetStore") {
        RecentDefaults().removeAll()
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
    /// - `-fixture <name>` answers every request for an answer with that fixture, as if fetched
    ///   now, after forgetting the saved answer, so the launch fetches the fixture rather than
    ///   painting what an earlier launch saved; the fixture is then saved, for the widget, as any
    ///   answer is. The picker's searches are answered as `-network` answers them (`SearchStub`).
    /// - `-network <name>[,<name>…]` leaves the app's own transport, URLSession and section 4's
    ///   settings in place and stubs the network beneath them (`URLProtocolStub`): it answers
    ///   the request for approximate IP location with the first fixture, a request for another
    ///   fixture's own place with that fixture, the picker's search for a search fixture's text
    ///   with that search fixture (`Fixtures/Search`), and any other request with an error.
    ///   Nothing is forgotten, so a launch paints and reuses what was saved, as it does for real.
    ///   `-network off` has no connection at all; `-network unavailable` answers every request
    ///   as the server does when the forecasts can't be had (503 `upstream_unavailable`).
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
        return FixtureTransport(body: data, searches: SearchStub())
      }
      guard value(after: "-network", in: arguments) != nil else { return nil }
      // Read now, on the main thread, so a bad name stops the launch rather than a request.
      _ = URLProtocolStub.server
      let configuration = URLSessionTransport.configuration()
      configuration.protocolClasses = [URLProtocolStub.self]
      return URLSessionTransport(session: URLSession(configuration: configuration))
    }

    /// The model's clock: from `-now <iso>` when given, else from the moment of the fixture
    /// `-fixture` names, or the first `-network` names (`_fixture.now`), so a fixture launched
    /// on any day shows the state it was made for (the hour picked, Tomorrow from 6pm at the
    /// place, no recent forecast). `-clock run`, the default, runs on from there; `-clock fixed`
    /// stays at that moment (from the launch's own without either), so a UI test reads the
    /// screen its moment shows and nothing falls due meanwhile (`FixedClock`): no quiet
    /// refresh, no retry. The picker's pause after typing is timed apart, by `waits()`, so it
    /// still searches. Nil, for the system's clock, without any of them.
    static func clock(arguments: [String] = ProcessInfo.processInfo.arguments) -> (any AppClock)? {
      let mode = value(after: "-clock", in: arguments)
      if let mode, mode != "fixed", mode != "run" {
        fatalError("-clock: \(mode) isn't fixed or run")
      }
      let start: Date?
      if let text = value(after: "-now", in: arguments) {
        guard let moment = ApiJSON.parseDate(text) else {
          fatalError("-now: \(text) isn't an ISO 8601 moment")
        }
        start = moment
      } else {
        let network = value(after: "-network", in: arguments).flatMap {
          StubServer.modes.contains($0) ? nil : StubServer.fixtureNames($0).first
        }
        start = (value(after: "-fixture", in: arguments) ?? network).map { fixtureMoment($0) }
      }
      if mode == "fixed" { return FixedClock(at: start ?? Date()) }
      return start.map { SystemClock(startingAt: $0) }
    }

    /// The clock for short waits, which count time passing and show no moment
    /// (`AppEnvironment.waits`: the picker's pause after typing). Under `-clock fixed`, whose
    /// clock never runs work due later, the system's, so a picker test at a fixed moment still
    /// searches; nil, for the model's clock, otherwise.
    static func waits(arguments: [String] = ProcessInfo.processInfo.arguments) -> (any AppClock)? {
      value(after: "-clock", in: arguments) == "fixed" ? SystemClock() : nil
    }

    /// The phone's location without Core Location, so a UI test never sees the system's prompt
    /// (`-location <lat>,<lon>|denied|unavailable`): permission given and a fix at those
    /// coordinates; permission off; or permission given and no fix. A value that is none of
    /// these stops the app. Nil, for Core Location, without it.
    static func location(
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> (any LocationService)? {
      guard let text = value(after: "-location", in: arguments) else { return nil }
      switch text {
      case "denied":
        return FixedLocation(permission: .denied, answer: .denied)
      case "unavailable":
        return FixedLocation(permission: .granted, answer: .unavailable)
      default:
        let parts = text.split(separator: ",").compactMap { Double(String($0)) }
        guard parts.count == 2, abs(parts[0]) <= 90, abs(parts[1]) <= 180 else {
          fatalError("-location: \(text) isn't <lat>,<lon>, denied or unavailable")
        }
        return FixedLocation(
          permission: .granted,
          answer: .located(latitude: parts[0], longitude: parts[1])
        )
      }
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

    /// Whether the glyphs keep still, their flakes never drifting (section 10.2): in a test
    /// launched at a set moment (`-now`), whose screens are compared as they are, and under
    /// `-uitest`, which turns animations off.
    static func stillMotion(arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool {
      arguments.contains("-now") || arguments.contains("-uitest")
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

    /// Every search fixture (`Fixtures/Search`), by its query ("q=Leeds"), each checked to
    /// decode; none without the folder, when every search is answered 404.
    fileprivate nonisolated static func searchAnswers() -> [String: Data] {
      let folder = Bundle.main.url(forResource: "Fixtures", withExtension: nil)?
        .appendingPathComponent("Search", isDirectory: true)
      let urls = folder.flatMap {
        try? FileManager.default.contentsOfDirectory(at: $0, includingPropertiesForKeys: nil)
      }
      var answers: [String: Data] = [:]
      for url in (urls ?? []) where url.pathExtension == "json" {
        guard let data = try? Data(contentsOf: url),
          let note = try? JSONDecoder().decode(FixtureNote.self, from: data),
          (try? SearchResponse.decode(from: data)) != nil
        else { fatalError("Fixtures/Search/\(url.lastPathComponent) doesn't decode") }
        answers[note.note.query] = data
      }
      return answers
    }

    /// The query a fixture was asked with (`_fixture.query`).
    fileprivate nonisolated static func fixtureQuery(_ name: String) -> String {
      guard let fixture = try? JSONDecoder().decode(FixtureNote.self, from: fixtureData(name))
      else { fatalError("\(name).json has no query") }
      return fixture.note.query
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

    static func waits() -> (any AppClock)? { nil }

    static func apiOrigin() -> URL? { nil }

    static func stillMotion() -> Bool { false }

    nonisolated static func launches() -> Bool { true }

    static func location() -> (any LocationService)? { nil }
  #endif
}

#if DEBUG
  /// `-fixture`'s server: every request for an answer answered with the same fixture, with
  /// status 200, and the picker's searches as `-network` answers them. The units each request
  /// asked in are noted for the recorder (`DebugRecorder`).
  private struct FixtureTransport: HTTPTransport {
    let body: Data
    let searches: SearchStub

    func get(_ request: HTTPRequest) async throws -> HTTPResponse {
      DebugRecorder.requested(request.url)
      if let found = searches.reply(to: request.url) {
        return HTTPResponse(status: found.status, body: found.body)
      }
      return HTTPResponse(status: 200, body: body)
    }
  }

  /// The picker's searches, under `-fixture` and `-network` alike: `GET /api/v1/search` with a
  /// search fixture's query gets that fixture (`Fixtures/Search`), and any other search a 404
  /// with no body.
  private struct SearchStub {
    /// The search fixtures, by their queries.
    let answers = DebugHooks.searchAnswers()

    /// The reply to `url` when it is a search; nil for any other request.
    func reply(to url: URL) -> (status: Int, body: Data)? {
      guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
        components.path == "/api/v1/search"
      else { return nil }
      guard let found = answers[components.percentEncodedQuery ?? ""] else {
        return (404, Data())
      }
      return (200, found)
    }
  }

  /// `-network`'s server, as `URLProtocolStub` answers.
  private struct StubServer {
    enum Reply {
      case failure(URLError.Code)
      case answer(status: Int, body: Data)
    }

    /// What `-network` names: no connection, the server failing, or its fixtures.
    enum Mode {
      case off
      case unavailable
      /// The fixture it answers the request for approximate IP location with, and the others,
      /// each for its own place (`place(_:)`).
      case fixtures(ip: Data, places: [String: Data])
    }

    /// The names `-network` takes that aren't a fixture's.
    static let modes: Set<String> = ["off", "unavailable"]

    let mode: Mode
    /// The picker's searches.
    let searches = SearchStub()

    /// The server `-network` names in `arguments`, or nil without it.
    init?(arguments: [String]) {
      guard let name = DebugHooks.value(after: "-network", in: arguments) else { return nil }
      switch name {
      case "off": mode = .off
      case "unavailable": mode = .unavailable
      default:
        let names = Self.fixtureNames(name)
        guard let first = names.first else { fatalError("-network: \(name) names no fixture") }
        var places: [String: Data] = [:]
        for other in names.dropFirst() {
          guard let target = Target(query: DebugHooks.fixtureQuery(other)) else {
            fatalError("-network: \(other).json asks for no place")
          }
          places[Self.place(target)] = DebugHooks.answerData(other)
        }
        mode = .fixtures(ip: DebugHooks.answerData(first), places: places)
      }
    }

    /// The fixtures `-network <name>[,<name>…]` names, in order: the first for approximate IP
    /// location.
    static func fixtureNames(_ value: String) -> [String] {
      value.split(separator: ",").map(String.init)
    }

    /// A place as the stub tells places apart: a city by its slug, coordinates by their point
    /// on the grid, whoever's they are (a device's fix is answered as a search for the same
    /// point would be, as the server's forecast is the same).
    static func place(_ target: Target) -> String {
      switch target {
      case .ip: "ip"
      case .city(let slug, _): "city:\(slug)"
      case .coords(let point): "point:\(point.lat),\(point.lon)"
      }
    }

    /// No connection for `-network off`. For `-network unavailable`, every request answered as
    /// the server answers when the forecasts can't be had: 503, with its `upstream_unavailable`
    /// error and core's message for it. Otherwise, for `GET /api/v1/today` with `ahead=snow`:
    /// the first fixture for approximate IP location (`units` once they are known, or `t` past
    /// the caches, but no place), and another fixture for its own place; for `GET
    /// /api/v1/search`, the search fixture asked with the same query. A 404 for another path or
    /// search, and a 400 for any other request, both with no body, so a request for the wrong
    /// place shows the error, never an answer.
    func reply(to request: URLRequest) -> Reply {
      let fixture: Data
      let places: [String: Data]
      switch mode {
      case .off:
        return .failure(.notConnectedToInternet)
      case .unavailable:
        let code = "upstream_unavailable"
        let error = ApiError(code: code, message: CoreCopy.errorMessage(code: code) ?? "")
        return .answer(status: 503, body: (try? JSONEncoder().encode(error)) ?? Data())
      case .fixtures(let ip, let others):
        fixture = ip
        places = others
      }
      guard request.httpMethod == "GET", let url = request.url,
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
      else { return .answer(status: 404, body: Data()) }
      if let found = searches.reply(to: url) {
        return .answer(status: found.status, body: found.body)
      }
      let query = components.percentEncodedQuery ?? ""
      guard components.path == "/api/v1/today" else { return .answer(status: 404, body: Data()) }
      let items = components.queryItems ?? []
      let names = Set(items.map(\.name))
      let ahead = items.first { $0.name == "ahead" }?.value
      guard ahead == "snow" else { return .answer(status: 400, body: Data()) }
      if names.isSubset(of: ["ahead", "units", "t"]) {
        return .answer(status: 200, body: fixture)
      }
      guard let target = Target(query: query), let answer = places[Self.place(target)] else {
        return .answer(status: 400, body: Data())
      }
      return .answer(status: 200, body: answer)
    }
  }

  /// `-location`'s stand-in for Core Location: permission as given, never a prompt, and the
  /// same fix each time.
  private struct FixedLocation: LocationService {
    let permission: LocationAccess
    let answer: LocationFix

    func access() async -> LocationAccess { permission }

    func requestAccess() async -> LocationAccess { permission }

    func fix() async -> LocationFix { answer }
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

  /// What a fixture says about itself (`_fixture`), as far as the hooks read it: its query and
  /// its moment.
  private struct FixtureNote: Decodable {
    struct Note: Decodable {
      /// What the app asked, without the "?".
      let query: String
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
  ///
  /// Below it, not over it: the lines were a bottom `safeAreaInset` on a translucent bar, which
  /// insets a list's content but not its frame, so a sheet's last rows ran under the bar. On PR
  /// #33's macOS run a tap on Support, Settings' last row, landed on the bar, the full policy's
  /// row in Your privacy sat 1 point under it, and the audit found text under it short of
  /// contrast. Opaque, and in a text style that changes at every text size (subheadline,
  /// 12 to 15 points from the smallest to Large): `caption2` keeps 11 points from the smallest
  /// size to Large, which the audit's Dynamic Type check failed on both lines.
  @MainActor
  private struct URLRecorder: ViewModifier {
    let mode: DebugHooks.OpenURLs

    func body(content: Content) -> some View {
      let recorder = DebugRecorder.shared
      VStack(spacing: 0) {
        content
          .environment(
            \.openURL,
            OpenURLAction { url in
              recorder.opened = url.absoluteString
              return mode == .nomail && url.scheme == "mailto" ? .discarded : .handled
            }
          )
        VStack(alignment: .leading, spacing: 2) {
          Text(verbatim: recorder.opened)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("debug-opened")
          Text(verbatim: recorder.units)
            .accessibilityIdentifier("debug-units")
        }
        .font(.subheadline)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
        .background(.background)
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
