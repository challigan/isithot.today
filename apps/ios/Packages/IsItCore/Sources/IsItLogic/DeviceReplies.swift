import Foundation
import IsItModel

/// `PUT /api/v1/devices`'s 200 answer (client `DeviceReply`, server `DeviceResponse`): the
/// registration's ID, its place as the server named it, the switches it holds, and when it last
/// heard from the phone. Only these fields are read; the server may send more.
public struct DeviceResponse: Codable, Sendable, Equatable {
  /// The registration's place: its name ("Leeds", or "Your location" for the phone's cell when
  /// the server knows no other), its IANA time zone, and its today query ("place=leeds-gb").
  public struct Place: Codable, Sendable, Equatable {
    public let name: String
    public let timezone: String
    public let query: String

    public init(name: String, timezone: String, query: String) {
      self.name = name
      self.timezone = timezone
      self.query = query
    }
  }

  /// 32 lowercase hex digits, made from the token: Your privacy shows the first 8.
  public let id: String
  public let place: Place
  public let alerts: RegistrationBody.Alerts
  /// The server's own text, kept as it is.
  public let seenAt: String

  public init(id: String, place: Place, alerts: RegistrationBody.Alerts, seenAt: String) {
    self.id = id
    self.place = place
    self.alerts = alerts
    self.seenAt = seenAt
  }
}

/// The body of `DELETE /api/v1/devices` and `POST /api/v1/devices/test`: the app, and the token
/// that names the server's record.
public struct DeviceIdentity: Codable, Sendable, Equatable {
  public let app: RegistrationBody.App
  public let token: String

  public init(app: RegistrationBody.App = .snow, token: String) {
    self.app = app
    self.token = token
  }
}

/// `alertSync.v1` (spec 9.6): the registration the server holds, as the last PUT it answered
/// made it: what it said (`fingerprint`), when it was sent, with which token, APNs and units (the
/// answer has none, so they are what was sent), and the answer. `token` only names that record,
/// for a DELETE or a test; it is never sent as a new registration's. Nothing stored, another
/// version, or anything unreadable is no registration.
public struct AlertRegistration: Codable, Sendable, Equatable {
  /// The version this app writes and reads.
  public static let version = 1

  public var v: Int
  public var fingerprint: String
  public var at: Date
  public var token: String
  public var env: RegistrationBody.Env
  public var units: Units
  public var response: DeviceResponse

  public init(
    fingerprint: String,
    at: Date,
    token: String,
    env: RegistrationBody.Env,
    units: Units,
    response: DeviceResponse
  ) {
    v = Self.version
    self.fingerprint = fingerprint
    self.at = at
    self.token = token
    self.env = env
    self.units = units
    self.response = response
  }

  /// The registration last sent, as `AlertSync.action` compares it.
  public var sent: AlertSync.Sent {
    AlertSync.Sent(fingerprint: fingerprint, at: at)
  }

  /// The registration as `alertSync.v1` keeps it (`ApiJSON.encoder()`, `at` to the millisecond).
  public func stored() throws -> Data {
    try ApiJSON.encoder().encode(self)
  }

  /// What `alertSync.v1` holds, or nil for nothing, another version, or anything unreadable.
  public init?(stored data: Data?) {
    guard let data, let registration = try? ApiJSON.decoder().decode(Self.self, from: data),
      registration.v == Self.version
    else { return nil }
    self = registration
  }
}

extension AlertSync {
  /// What a reply to `PUT` or `DELETE /api/v1/devices` means to the app (client `SyncReply`):
  /// the record stored, the record forgotten, a retry after so many seconds, a place the server
  /// refused in its own words, or a failure.
  public enum SyncReply: Sendable, Equatable {
    case stored(DeviceResponse)
    case forgotten
    case retry(afterSeconds: Int)
    case placeRefused(message: String)
    case failed
  }

  /// What `POST /api/v1/devices/test`'s reply means to the app (client `TestOutcome`).
  public enum TestOutcome: String, Codable, Sendable, CaseIterable {
    /// Sent to Apple.
    case sent
    /// Taken, but the server isn't sending notifications yet.
    case dryRun
    /// The hourly limit of test notifications.
    case limited
    /// Nothing is sent at night at the place.
    case quiet
    /// The server has no record for the token.
    case notRegistered
    case failed
  }

  /// A devices reply (client `syncReply`), from its status, its body's bytes (empty for none)
  /// and its `Retry-After` header: 200 with a `DeviceResponse` whose ID is 32 lowercase hex
  /// digits is `stored` (any other 200 `failed`); 204 `forgotten`; 429 `retry`, after
  /// `Retry-After`'s whole seconds when it is 1 to 999999 written as digits, else
  /// `Constants.Client.retryAfterMs`; 400 whose error code is `bad_location` with a message that
  /// isn't empty, `placeRefused` with it; anything else `failed`. A body that isn't JSON fits no
  /// shape.
  public static func syncReply(status: Int, body: Data, retryAfter: String?) -> SyncReply {
    switch status {
    case 200:
      guard let reply = decoded(DeviceResponse.self, body), isRecordID(reply.id) else {
        return .failed
      }
      return .stored(reply)
    case 204:
      return .forgotten
    case 429:
      return .retry(afterSeconds: retrySeconds(retryAfter))
    case 400:
      guard same(decoded(ErrorCode.self, body)?.error.code, "bad_location"),
        let message = decoded(ErrorMessage.self, body)?.error.message, !message.isEmpty
      else { return .failed }
      return .placeRefused(message: message)
    default:
      return .failed
    }
  }

  /// A test's reply (client `testOutcome`), from its status and its body's bytes: 202 whose
  /// `sent` is true `sent`; 202 whose `sent` is false and `dryRun` true `dryRun`; 429 with code
  /// `test_limited` `limited` (Netlify's own 429, `rate_limited`, is `failed`); 409
  /// `quiet_hours` `quiet`; 404 `not_registered` `notRegistered`; anything else `failed`.
  public static func testOutcome(status: Int, body: Data) -> TestOutcome {
    if status == 202 {
      let sent = decoded(SentField.self, body)?.sent
      if sent == true { return .sent }
      return sent == false && decoded(DryRunField.self, body)?.dryRun == true ? .dryRun : .failed
    }
    let refusals: [Int: (code: String, outcome: TestOutcome)] = [
      429: ("test_limited", .limited),
      409: ("quiet_hours", .quiet),
      404: ("not_registered", .notRegistered),
    ]
    guard let refusal = refusals[status],
      same(decoded(ErrorCode.self, body)?.error.code, refusal.code)
    else { return .failed }
    return refusal.outcome
  }

  // MARK: - Private

  /// Each field the client reads on its own, as its own small type: a field of another type
  /// leaves the others readable. `JSONDecoder` refuses a number where a boolean is due, and a
  /// string where a number is, as the client's `typeof` checks do.
  private struct SentField: Decodable {
    let sent: Bool
  }

  private struct DryRunField: Decodable {
    let dryRun: Bool
  }

  private struct ErrorCode: Decodable {
    struct Fields: Decodable {
      let code: String
    }

    let error: Fields
  }

  private struct ErrorMessage: Decodable {
    struct Fields: Decodable {
      let message: String
    }

    let error: Fields
  }

  /// `body` as `T`, or nil for a body that isn't one: not JSON, or another shape.
  private static func decoded<T: Decodable>(_ type: T.Type, _ body: Data) -> T? {
    try? JSONDecoder().decode(type, from: body)
  }

  /// Compared byte for byte, as JavaScript compares strings.
  private static func same(_ text: String?, _ expected: String) -> Bool {
    text?.utf8.elementsEqual(expected.utf8) == true
  }

  /// `/^[0-9a-f]{32}$/`: the server's ID for a record.
  private static func isRecordID(_ id: String) -> Bool {
    id.utf8.count == 32 && id.utf8.allSatisfy { isDigit($0) || (0x61...0x66).contains($0) }
  }

  /// `Retry-After`'s whole seconds, 1 to 999999 written as one to six ASCII digits; else the
  /// clients' minute, `Constants.Client.retryAfterMs`.
  private static func retrySeconds(_ retryAfter: String?) -> Int {
    let digits = Array((retryAfter ?? "").utf8)
    guard (1...6).contains(digits.count), digits.allSatisfy(isDigit),
      let seconds = Int(String(decoding: digits, as: UTF8.self)), seconds >= 1
    else { return Constants.Client.retryAfterMs / 1000 }
    return seconds
  }

  private static func isDigit(_ byte: UInt8) -> Bool {
    (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(byte)
  }
}

extension AlertSync.SyncReply: Codable {
  private enum CodingKeys: String, CodingKey {
    case kind, reply, afterSeconds, message
  }

  private enum Kind: String, Codable {
    case stored, forgotten, retry, placeRefused, failed
  }

  /// The client's JSON: `{ kind: "stored", reply }`, `{ kind: "forgotten" }`, `{ kind: "retry",
  /// afterSeconds }`, `{ kind: "placeRefused", message }` or `{ kind: "failed" }`.
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .kind) {
    case .stored:
      self = .stored(try container.decode(DeviceResponse.self, forKey: .reply))
    case .forgotten:
      self = .forgotten
    case .retry:
      self = .retry(afterSeconds: try container.decode(Int.self, forKey: .afterSeconds))
    case .placeRefused:
      self = .placeRefused(message: try container.decode(String.self, forKey: .message))
    case .failed:
      self = .failed
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .stored(let reply):
      try container.encode(Kind.stored, forKey: .kind)
      try container.encode(reply, forKey: .reply)
    case .forgotten:
      try container.encode(Kind.forgotten, forKey: .kind)
    case .retry(let seconds):
      try container.encode(Kind.retry, forKey: .kind)
      try container.encode(seconds, forKey: .afterSeconds)
    case .placeRefused(let message):
      try container.encode(Kind.placeRefused, forKey: .kind)
      try container.encode(message, forKey: .message)
    case .failed:
      try container.encode(Kind.failed, forKey: .kind)
    }
  }
}

/// The device token as the server takes it (`token`).
public enum PushToken {
  /// Each byte of `token` as two lowercase hex digits, through a table rather than
  /// `String(format:)`, which Linux and iOS don't write alike.
  public static func hex(_ token: Data) -> String {
    var out = String.UnicodeScalarView()
    for byte in token {
      out.append(digits[Int(byte >> 4)])
      out.append(digits[Int(byte & 0x0f)])
    }
    return String(out)
  }

  private static let digits = Array("0123456789abcdef".unicodeScalars)
}
