import Foundation

/// The API's answer when it can't answer (core `ApiError`):
/// `{ "error": { "code": "not_found", "message": "There is no page for that place." } }`. The
/// app shows `message`, worded by the server; `code` is one of core's `ErrorCode`s, kept as text
/// so that a code the app doesn't know yet still reads.
public struct ApiError: Codable, Sendable, Equatable {
  public struct Detail: Codable, Sendable, Equatable {
    /// "bad_location", "not_found", "rate_limited" or "upstream_unavailable".
    public let code: String
    /// What to tell the user.
    public let message: String

    public init(code: String, message: String) {
      self.code = code
      self.message = message
    }
  }

  public let error: Detail

  public init(code: String, message: String) {
    error = Detail(code: code, message: message)
  }

  /// Decodes an error answer's body as the server sends it.
  public static func decode(from data: Data) throws -> ApiError {
    try ApiJSON.decoder().decode(ApiError.self, from: data)
  }
}
