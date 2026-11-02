import Foundation
import IsItLogic
import IsItModel

/// The notifications' calls (iOS build spec, section 8.2): the registration, forgetting it, and
/// the test notification, each answered as the client rules read the server's reply
/// (`AlertSync.syncReply`, `AlertSync.testOutcome`). No answer at all is a failure: nothing is
/// thrown, and nothing is logged, so neither the token nor the place goes anywhere else.
extension APIClient {
  /// `PUT /api/v1/devices` with `body` (section 8.2).
  public func registerDevice(_ body: RegistrationBody) async -> AlertSync.SyncReply {
    guard let response = await send(.put, path: Self.devicesPath, body) else { return .failed }
    return AlertSync.syncReply(
      status: response.status, body: response.body, retryAfter: response.retryAfter)
  }

  /// `DELETE /api/v1/devices` with `{ app, token }`.
  public func forgetDevice(token: String) async -> AlertSync.SyncReply {
    let identity = DeviceIdentity(token: token)
    guard let response = await send(.delete, path: Self.devicesPath, identity) else {
      return .failed
    }
    return AlertSync.syncReply(
      status: response.status, body: response.body, retryAfter: response.retryAfter)
  }

  /// `POST /api/v1/devices/test` with `{ app, token }`.
  public func testDevice(token: String) async -> AlertSync.TestOutcome {
    let identity = DeviceIdentity(token: token)
    guard let response = await send(.post, path: Self.devicesPath + "/test", identity) else {
      return .failed
    }
    return AlertSync.testOutcome(status: response.status, body: response.body)
  }

  /// The request for a devices call: the origin and `path`, `method`, `Accept` and
  /// `Content-Type: application/json`, the JSON `body`, and `Constants.Client.requestTimeoutMs`.
  /// Nil only for an origin a URL can't be made from.
  public func deviceRequest(_ method: HTTPMethod, path: String, body: Data) -> HTTPRequest? {
    var base = origin.absoluteString
    while base.hasSuffix("/") { base.removeLast() }
    guard let url = URL(string: base + path) else { return nil }
    return HTTPRequest(
      url: url,
      method: method,
      headers: ["Accept": "application/json", "Content-Type": "application/json"],
      body: body,
      timeout: TimeInterval(Constants.Client.requestTimeoutMs) / 1000
    )
  }

  // MARK: - Private

  private static let devicesPath = "/api/v1/devices"

  /// Sends `body` as JSON, its keys sorted, so the same call is always the same bytes; nil when
  /// it couldn't be made or no answer came.
  private func send(_ method: HTTPMethod, path: String, _ body: some Encodable) async
    -> HTTPResponse?
  {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    guard let json = try? encoder.encode(body),
      let request = deviceRequest(method, path: path, body: json)
    else { return nil }
    return try? await transport.send(request)
  }
}
