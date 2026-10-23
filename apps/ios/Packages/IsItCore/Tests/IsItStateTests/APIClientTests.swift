import Foundation
import IsItModel
import IsItState
import IsItTestSupport
import Testing

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

@Suite("The API client's request")
struct APIClientRequestTests {
  let client = APIClient(transport: FakeTransport([.failure(.unknown)]))

  @Test("the first launch asks by IP location, with no units, for the snow hours ahead")
  func firstLaunch() throws {
    let request = try #require(client.request(for: .ip, units: nil))
    #expect(request.url.absoluteString == "https://willitsnow.today/api/v1/today?ahead=snow")
    #expect(request.headers == ["Accept": "application/json"])
    #expect(request.timeout == 12)
  }

  @Test("by IP location once the units are known, a city page's place, and a searched place")
  func places() throws {
    let today = "https://willitsnow.today/api/v1/today?"
    #expect(
      try #require(client.request(for: .ip, units: .c)).url.absoluteString
        == today + "units=c&ahead=snow")
    #expect(
      try #require(client.request(for: .city(slug: "leeds-gb", name: "Leeds"), units: .c))
        .url.absoluteString == today + "place=leeds-gb&units=c&ahead=snow")
    let searched = Target.coords(
      .init(
        source: .search,
        lat: 46.45,
        lon: 7.15,
        name: "Château-d’Œx",
        region: "Vaud",
        country: "CH",
        geonameId: 2_661_112,
        elevation: 958
      ))
    #expect(
      try #require(client.request(for: searched, units: .f)).url.absoluteString
        == today
        + "lat=46.45&lon=7.15&name=Ch%C3%A2teau-d%E2%80%99%C5%92x&region=Vaud&country=CH"
        + "&geonameId=2661112&elevation=958&source=search&units=f&ahead=snow")
    #expect(
      try #require(client.request(for: .device(lat: 53.81, lon: -1.549), units: .c))
        .url.absoluteString == today + "lat=53.8&lon=-1.55&source=device&units=c&ahead=snow")
  }

  @Test("is the query vectors' for the snow hours ahead, byte for byte, for every target")
  func vectors() throws {
    let cases = try Vectors.cases(
      "query",
      fn: "todayQuery",
      input: TodayCase.self,
      output: String.self
    ).filter { $0.input.ahead == [.snow] }
    #expect(cases.count >= 20)
    for item in cases {
      let request = try #require(client.request(for: item.input.target, units: item.input.units))
      let expected = "https://willitsnow.today/api/v1/today?" + item.output
      #expect(
        request.url.absoluteString.utf8.elementsEqual(expected.utf8),
        "query.json case \(item.index): \(request.url.absoluteString) is not \(expected)")
    }
  }

  @Test("past the caches, with the hour's t after the query")
  func fresh() throws {
    // 10:00:00.0004 UTC on 2 December 2026, hour 498,946.
    let now = Date(timeIntervalSince1970: 498_946.0 * 3_600 + 0.000_4)
    let request = try #require(
      client.request(for: .city(slug: "aberdeen-gb"), units: .c, freshAt: now))
    #expect(
      request.url.absoluteString
        == "https://willitsnow.today/api/v1/today?place=aberdeen-gb&units=c&ahead=snow&t=498946")
  }

  @Test("from another origin, with or without a slash at its end")
  func origins() throws {
    for origin in ["https://deploy-preview-27--willitsnow.netlify.app", "http://localhost:4321/"] {
      let other = APIClient(origin: try #require(URL(string: origin)), transport: client.transport)
      let base = origin.hasSuffix("/") ? String(origin.dropLast()) : origin
      #expect(
        try #require(other.request(for: .ip, units: .c)).url.absoluteString
          == base + "/api/v1/today?units=c&ahead=snow")
    }
  }
}

@Suite("The API client's answers and errors")
struct APIClientAnswerTests {
  let leeds = Target.city(slug: "leeds-gb")

  func ask(_ replies: [FakeTransport.Reply]) async -> Result<TodayResponse, FetchError> {
    let client = APIClient(transport: FakeTransport(replies))
    do {
      return .success(try await client.today(for: leeds, units: .c))
    } catch let error as FetchError {
      return .failure(error)
    } catch {
      Issue.record("threw \(error), not a FetchError")
      return .failure(.failed(status: nil, code: nil, message: nil))
    }
  }

  @Test("a 200 is decoded as the answer")
  func answer() async throws {
    let result = await ask([try FakeTransport.fixture("leeds-dry")])
    #expect(try result.get() == fixture("leeds-dry"))
  }

  @Test("an error answer gives its status, and the server's code and message")
  func serverError() async throws {
    let unavailable = await ask([try FakeTransport.error(503, code: "upstream_unavailable")])
    let failure = FetchError.failed(
      status: 503,
      code: "upstream_unavailable",
      message: CoreCopy.unavailable
    )
    #expect(unavailable == .failure(failure))
    #expect(failure.message == CoreCopy.unavailable)
    let gone = await ask([try FakeTransport.error(404, code: "not_found")])
    #expect(
      gone
        == .failure(
          .failed(status: 404, code: "not_found", message: "There is no page for that place.")))
  }

  @Test("429 is rate limited, whatever its body")
  func rateLimited() async throws {
    #expect(
      await ask([try FakeTransport.error(429, code: "rate_limited")]) == .failure(.rateLimited))
    let bare = FakeTransport.Reply.answer(HTTPResponse(status: 429, body: Data()))
    #expect(await ask([bare]) == .failure(.rateLimited))
    #expect(FetchError.rateLimited.message == "Too many requests. Try again in a minute.")
  }

  @Test("a body that isn't an answer or an error answer fails with its status only")
  func unreadable() async throws {
    let page = FakeTransport.Reply.answer(
      HTTPResponse(status: 502, body: Data("<html>Bad gateway</html>".utf8)))
    #expect(await ask([page]) == .failure(.failed(status: 502, code: nil, message: nil)))
    let garbled = FakeTransport.Reply.answer(HTTPResponse(status: 200, body: Data("{".utf8)))
    #expect(await ask([garbled]) == .failure(.failed(status: 200, code: nil, message: nil)))
    #expect(FetchError.failed(status: 200, code: nil, message: nil).message == CoreCopy.unavailable)
    #expect(FetchError.failed(status: 500, code: "x", message: "").message == CoreCopy.unavailable)
  }

  @Test("an error answer sent with a 200 is still an error")
  func errorWithOK() async throws {
    let body = try JSONEncoder().encode(ApiError(code: "bad_location", message: "Latitude."))
    let reply = FakeTransport.Reply.answer(HTTPResponse(status: 200, body: body))
    #expect(
      await ask([reply])
        == .failure(.failed(status: 200, code: "bad_location", message: "Latitude.")))
  }

  @Test("no connection, or none in time, is offline", arguments: APIClient.offlineCodes)
  func offline(code: URLError.Code) async {
    #expect(await ask([.failure(code)]) == .failure(.offline))
  }

  @Test("other transport errors fail with nothing known")
  func otherErrors() async {
    for code: URLError.Code in [.badServerResponse, .secureConnectionFailed, .cancelled, .badURL] {
      #expect(
        await ask([.failure(code)]) == .failure(.failed(status: nil, code: nil, message: nil)))
    }
    struct Odd: Error {}
    #expect(APIClient.failure(for: Odd()) == .failed(status: nil, code: nil, message: nil))
    #expect(APIClient.failure(for: FetchError.rateLimited) == .rateLimited)
  }

  @Test("an error never carries the place it was asking about")
  func noPlaceInErrors() {
    let url = URL(string: "https://willitsnow.today/api/v1/today?lat=53.8&lon=-1.55&source=device")
    let error = URLError(
      .notConnectedToInternet, userInfo: [NSURLErrorFailingURLErrorKey: url as Any])
    let failure = APIClient.failure(for: error)
    #expect(failure == .offline)
    #expect(!String(describing: failure).contains("53.8"))
    #expect(!String(reflecting: failure).contains("lat="))
  }

  @Test("offline, the message is that there is no recent forecast")
  func offlineMessage() {
    #expect(FetchError.offline.message == AppCopy.staleApp)
  }
}

/// A `todayQuery` case's input (query.json).
private struct TodayCase: Decodable, Sendable {
  let target: Target
  let units: Units?
  let ahead: [Topic]
}
