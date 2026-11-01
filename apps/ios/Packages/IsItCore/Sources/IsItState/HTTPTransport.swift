import Foundation

/// A request's method: GET for the answers and the search, the others for the devices calls
/// (iOS build spec, section 8.2).
public enum HTTPMethod: String, Sendable, Equatable {
  case get = "GET"
  case put = "PUT"
  case delete = "DELETE"
  case post = "POST"
}

/// A request as the app sends it (iOS build spec, section 4).
public struct HTTPRequest: Sendable, Equatable {
  public let url: URL
  /// GET, but for the devices calls.
  public let method: HTTPMethod
  /// `Accept: application/json`, and with a body `Content-Type: application/json` too
  /// (URLSession would otherwise label it a form): the app adds no headers of its own, and the
  /// default User-Agent tells its traffic apart in the server's logs.
  public let headers: [String: String]
  /// The devices calls' JSON; nil for a GET.
  public let body: Data?
  /// How long to wait for the answer, seconds (`Constants.Client.requestTimeoutMs`).
  public let timeout: TimeInterval

  public init(
    url: URL,
    method: HTTPMethod = .get,
    headers: [String: String],
    body: Data? = nil,
    timeout: TimeInterval
  ) {
    self.url = url
    self.method = method
    self.headers = headers
    self.body = body
    self.timeout = timeout
  }
}

/// What the server sent back: its status and body, whatever the status.
public struct HTTPResponse: Sendable, Equatable {
  public let status: Int
  public let body: Data
  /// The `Retry-After` header as sent, or nil: when the devices calls take the next write.
  public let retryAfter: String?

  public init(status: Int, body: Data, retryAfter: String? = nil) {
    self.status = status
    self.body = body
    self.retryAfter = retryAfter
  }
}

/// Sends the app's requests: `URLSessionTransport` (IsItServices) in the app, with the settings
/// section 4 gives; a fixture's in Debug builds launched with `-fixture`; a fake in the tests.
public protocol HTTPTransport: Sendable {
  /// Sends `request` and gives back the server's answer, whatever its status. Throws when there
  /// is none: URLSession throws a `URLError`, which `APIClient.failure(for:)` reads.
  func get(_ request: HTTPRequest) async throws -> HTTPResponse
  /// Sends `request` with its method and body (the devices calls), and gives back the answer as
  /// `get` does. It has no default, so no transport sends a GET for a PUT by accident.
  func send(_ request: HTTPRequest) async throws -> HTTPResponse
}
