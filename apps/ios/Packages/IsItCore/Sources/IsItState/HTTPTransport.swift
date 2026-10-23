import Foundation

/// A GET as the app sends it (iOS build spec, section 4).
public struct HTTPRequest: Sendable, Equatable {
  public let url: URL
  /// `Accept: application/json` only: the app adds no headers of its own, and the default
  /// User-Agent tells its traffic apart in the server's logs.
  public let headers: [String: String]
  /// How long to wait for the answer, seconds (`Constants.Client.requestTimeoutMs`).
  public let timeout: TimeInterval

  public init(url: URL, headers: [String: String], timeout: TimeInterval) {
    self.url = url
    self.headers = headers
    self.timeout = timeout
  }
}

/// What the server sent back: its status and body, whatever the status.
public struct HTTPResponse: Sendable, Equatable {
  public let status: Int
  public let body: Data

  public init(status: Int, body: Data) {
    self.status = status
    self.body = body
  }
}

/// Sends the app's requests: `URLSessionTransport` (IsItServices) in the app, with the settings
/// section 4 gives; a fixture's in Debug builds launched with `-fixture`; a fake in the tests.
public protocol HTTPTransport: Sendable {
  /// Sends `request` and gives back the server's answer, whatever its status. Throws when there
  /// is none: URLSession throws a `URLError`, which `APIClient.failure(for:)` reads.
  func get(_ request: HTTPRequest) async throws -> HTTPResponse
}
