import Foundation
import IsItModel

#if canImport(FoundationNetworking)
  // URLError, which Linux's Foundation keeps here.
  import FoundationNetworking
#endif

/// Why a fetch gave no answer, as the app tells the user (iOS build spec, section 4). It never
/// carries the request or its URL, so nothing that shows or logs one can give away the place.
public enum FetchError: Error, Sendable, Equatable {
  /// The server couldn't be reached: no connection, or one too weak to answer in time
  /// (`URLError.notConnectedToInternet` and its kin, `APIClient.offlineCodes`).
  case offline
  /// 429: too many requests from this network. The app treats it as being offline, and asks
  /// again `Constants.Client.retryAfterMs` later.
  case rateLimited
  /// Anything else: the server's status when it answered, with its error answer's code and
  /// message when it sent one (`ApiError`); all nil when the request failed some other way, or
  /// a 200's body wasn't an answer.
  case failed(status: Int?, code: String?, message: String?)

  /// What to tell the user: the server's own message, or `CoreCopy.unavailable` when it sent
  /// none. Offline, there is no recent forecast to show (`AppCopy.staleApp`).
  public var message: String {
    switch self {
    case .offline:
      AppCopy.staleApp
    case .rateLimited:
      CoreCopy.errorMessage(code: "rate_limited") ?? CoreCopy.unavailable
    case .failed(_, _, let message):
      message.flatMap { $0.isEmpty ? nil : $0 } ?? CoreCopy.unavailable
    }
  }
}

/// The app's one request, `GET /api/v1/today` (iOS build spec, section 4), over a transport the
/// caller gives it: URLSession in the app, a fake in the tests. It builds the query with
/// `TodayQuery`, always with the snow hours ahead, and decodes `TodayResponse`. It logs nothing.
public struct APIClient: Sendable {
  /// The topics whose hours ahead the app asks for (`ahead=snow`).
  public static let ahead: [Topic] = [.snow]
  /// The API's origin, `API_ORIGIN` in `Snow.xcconfig`.
  public static let defaultOrigin = URL(string: "https://willitsnow.today")!

  /// The `URLError` codes that mean the server couldn't be reached from here, so the app says
  /// it is offline rather than that forecasts are unavailable: no connection, or none for this
  /// app (cellular data off for it, roaming, a call on a network that can't do both), no way to
  /// the host, or no answer in time (`Constants.Client.requestTimeoutMs`), which on a phone is
  /// a weak signal far more often than a slow server.
  public static let offlineCodes: [URLError.Code] = [
    .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff,
    .callIsActive, .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed, .timedOut,
  ]

  public let origin: URL
  public let transport: any HTTPTransport

  /// `origin` is the API's, "https://willitsnow.today", or a deploy preview's in Debug builds.
  public init(origin: URL = APIClient.defaultOrigin, transport: any HTTPTransport) {
    self.origin = origin
    self.transport = transport
  }

  /// The request for the answer for `target` in `units` (none on the first launch, when the
  /// server chooses), with the snow hours ahead: `TodayQuery.build`'s query, unchanged, so it
  /// is the widgets' and the CDN's. `freshAt` asks past the caches, with that hour's
  /// `TodayQuery.fresh`. Nil only for an origin a URL can't be made from.
  public func request(for target: Target, units: Units?, freshAt: Date? = nil) -> HTTPRequest? {
    var query = TodayQuery.build(target, units: units, ahead: Self.ahead)
    if let freshAt { query = TodayQuery.fresh(query, now: freshAt) }
    var base = origin.absoluteString
    while base.hasSuffix("/") { base.removeLast() }
    // The query is ASCII, percent-encoded as URLSearchParams writes it, so it is used as it is.
    guard let url = URL(string: base + "/api/v1/today" + (query.isEmpty ? "" : "?" + query))
    else { return nil }
    return HTTPRequest(
      url: url,
      headers: ["Accept": "application/json"],
      timeout: TimeInterval(Constants.Client.requestTimeoutMs) / 1000
    )
  }

  /// The answer for `target` in `units` (see `request(for:units:freshAt:)`). Throws a
  /// `FetchError`, and only that.
  public func today(for target: Target, units: Units?, freshAt: Date? = nil) async throws
    -> TodayResponse
  {
    guard let request = request(for: target, units: units, freshAt: freshAt) else {
      throw FetchError.failed(status: nil, code: nil, message: nil)
    }
    let response: HTTPResponse
    do {
      response = try await transport.get(request)
    } catch {
      throw Self.failure(for: error)
    }
    return try Self.answer(response)
  }

  /// The answer in what the server sent: a `TodayResponse` for a 2xx whose body is one, else
  /// the `FetchError` it amounts to, with the server's error code and message when its body is
  /// an `ApiError`.
  public static func answer(_ response: HTTPResponse) throws -> TodayResponse {
    if response.status == 429 { throw FetchError.rateLimited }
    if (200..<300).contains(response.status),
      let answer = try? TodayResponse.decode(from: response.body)
    {
      return answer
    }
    let error = try? ApiError.decode(from: response.body)
    throw FetchError.failed(
      status: response.status,
      code: error?.error.code,
      message: error?.error.message
    )
  }

  /// The `FetchError` a transport's error amounts to: `offline` for the `offlineCodes`, and
  /// `failed` with nothing known for any other. A `FetchError` is itself.
  public static func failure(for error: any Error) -> FetchError {
    if let error = error as? FetchError { return error }
    if let error = error as? URLError, offlineCodes.contains(error.code) { return .offline }
    return .failed(status: nil, code: nil, message: nil)
  }
}
