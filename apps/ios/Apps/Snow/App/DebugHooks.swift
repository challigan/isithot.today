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
    /// - `-fixture <name>` answers every request with that fixture, as if fetched now, after
    ///   forgetting the saved answer, so the launch fetches the fixture rather than painting what
    ///   an earlier launch saved; the fixture is then saved, for the widget, as any answer is.
    /// - `-network <name>[,<name>…]` leaves the app's own transport, URLSession and section 4's
    ///   settings in place and stubs the network beneath them (`URLProtocolStub`): it answers
    ///   the request for approximate IP location with the first fixture, a request for another
    ///   fixture's own place with that fixture, the picker's search for a search fixture's text
    ///   with that search fixture (`Fixtures/Search`), and any other request with an error.
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
    /// `-fixture` names, or the first `-network` names (`_fixture.now`), running on from there,
    /// so a fixture launched on any day shows the state it was made for (the hour picked,
    /// Tomorrow from 6pm at the place, no recent forecast). Nil, for the system's clock, without
    /// either.
    static func clock(arguments: [String] = ProcessInfo.processInfo.arguments) -> (any AppClock)? {
      if let text = value(after: "-now", in: arguments) {
        guard let start = ApiJSON.parseDate(text) else {
          fatalError("-now: \(text) isn't an ISO 8601 moment")
        }
        return SystemClock(startingAt: start)
      }
      let network = value(after: "-network", in: arguments).flatMap { $0 == "off" ? nil : $0 }
        .flatMap { $0.split(separator: ",").first.map(String.init) }
      guard let name = value(after: "-fixture", in: arguments) ?? network else { return nil }
      return SystemClock(startingAt: fixtureMoment(name))
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

    static func apiOrigin() -> URL? { nil }

    nonisolated static func launches() -> Bool { true }

    static func location() -> (any LocationService)? { nil }
  #endif
}

#if DEBUG
  /// `-fixture`'s server: every request answered with the same fixture, with status 200.
  private struct FixtureTransport: HTTPTransport {
    let body: Data

    func get(_ request: HTTPRequest) async throws -> HTTPResponse {
      HTTPResponse(status: 200, body: body)
    }
  }

  /// `-network`'s server, as `URLProtocolStub` answers.
  private struct StubServer {
    enum Reply {
      case failure(URLError.Code)
      case answer(status: Int, body: Data)
    }

    /// The fixture it answers the request for approximate IP location with; nil for `-network
    /// off`.
    let fixture: Data?
    /// The other fixtures, each for its own place (`place(_:)`).
    let places: [String: Data]
    /// The search fixtures, by their queries.
    let searches: [String: Data]

    /// The server `-network` names in `arguments`, or nil without it.
    init?(arguments: [String]) {
      guard let mode = DebugHooks.value(after: "-network", in: arguments) else { return nil }
      guard mode != "off" else {
        fixture = nil
        places = [:]
        searches = [:]
        return
      }
      let names = mode.split(separator: ",").map(String.init)
      fixture = DebugHooks.answerData(names[0])
      var places: [String: Data] = [:]
      for name in names.dropFirst() {
        guard let target = Target(query: DebugHooks.fixtureQuery(name)) else {
          fatalError("-network: \(name).json asks for no place")
        }
        places[Self.place(target)] = DebugHooks.answerData(name)
      }
      self.places = places
      searches = DebugHooks.searchAnswers()
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

    /// No connection for `-network off`. Otherwise, for `GET /api/v1/today` with `ahead=snow`:
    /// the first fixture for approximate IP location (`units` once they are known, or `t` past
    /// the caches, but no place), and another fixture for its own place; for `GET
    /// /api/v1/search`, the search fixture asked with the same query. A 404 for another path or
    /// search, and a 400 for any other request, both with no body, so a request for the wrong
    /// place shows the error, never an answer.
    func reply(to request: URLRequest) -> Reply {
      guard let fixture else { return .failure(.notConnectedToInternet) }
      guard request.httpMethod == "GET", let url = request.url,
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
      else { return .answer(status: 404, body: Data()) }
      let query = components.percentEncodedQuery ?? ""
      if components.path == "/api/v1/search" {
        guard let found = searches[query] else { return .answer(status: 404, body: Data()) }
        return .answer(status: 200, body: found)
      }
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
#endif
