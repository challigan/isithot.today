import Foundation
import IsItModel
import IsItState

/// The app's requests over URLSession, with the settings in iOS build spec section 4: never the
/// local URL cache, since the app keeps its own saved answer (`reloadIgnoringLocalCacheData`,
/// and no cache to write to either); a 12 s timeout; the request's own headers only, which are
/// `Accept: application/json`, and for the devices calls' JSON bodies `Content-Type:
/// application/json` too; and the default User-Agent. The answer's `Retry-After` header goes
/// back with it, for the devices calls' one write a minute.
public struct URLSessionTransport: HTTPTransport {
  private let session: URLSession

  public init(session: URLSession = URLSessionTransport.session()) {
    self.session = session
  }

  /// A session with section 4's settings.
  public static func session() -> URLSession {
    URLSession(configuration: configuration())
  }

  /// Section 4's settings, as a new configuration each time; a Debug build's `-network` hook
  /// adds its stub to them, so its requests go out as Release's do.
  public static func configuration() -> URLSessionConfiguration {
    let configuration = URLSessionConfiguration.default
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.urlCache = nil
    configuration.timeoutIntervalForRequest =
      TimeInterval(Constants.Client.requestTimeoutMs) / 1000
    return configuration
  }

  public func get(_ request: HTTPRequest) async throws -> HTTPResponse {
    try await perform(request, method: .get)
  }

  /// The devices calls: the request's own method, and its body.
  public func send(_ request: HTTPRequest) async throws -> HTTPResponse {
    try await perform(request, method: request.method)
  }

  /// Sends `request` as `method`, with its body if it has one.
  private func perform(_ request: HTTPRequest, method: HTTPMethod) async throws -> HTTPResponse {
    var urlRequest = URLRequest(
      url: request.url,
      cachePolicy: .reloadIgnoringLocalCacheData,
      timeoutInterval: request.timeout
    )
    urlRequest.httpMethod = method.rawValue
    urlRequest.httpBody = request.body
    for (name, value) in request.headers {
      urlRequest.setValue(value, forHTTPHeaderField: name)
    }
    let (data, response) = try await session.data(for: urlRequest)
    guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    return HTTPResponse(
      status: http.statusCode,
      body: data,
      retryAfter: http.value(forHTTPHeaderField: "Retry-After")
    )
  }
}

extension APIClient {
  /// The API's origin the bundle's Info.plist names (`IsItAPIOrigin`, from `API_ORIGIN` in
  /// `Snow.xcconfig`), or nil when it names none that is a URL.
  public static func origin(in bundle: Bundle = .main) -> URL? {
    guard let text = bundle.object(forInfoDictionaryKey: "IsItAPIOrigin") as? String,
      let url = URL(string: text), url.scheme != nil, url.host != nil
    else { return nil }
    return url
  }
}
