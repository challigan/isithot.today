import Foundation
import IsItModel

/// `PUT /api/v1/devices`'s 200 answer to a version 2 body (client `DeviceReply`, server
/// `DeviceResponseV2`): the set as the server stored it, which "Your privacy" shows. Its fields
/// and only those are read, each on its own; the server may send more. 8.1's answer, which names
/// one place, doesn't read.
public struct DeviceResponse: Sendable, Equatable {
  /// How the server follows where you are (client `HereReply.follows`): the phone's location, or
  /// the connection.
  public enum Follows: String, Codable, Sendable, CaseIterable {
    case device, ip
  }

  /// Where you are as the server stored it (client `HereReply`): its name ("Leeds", or core's
  /// "Your location" for a point with no town near), its IANA time zone, its today query
  /// ("lat=53.8&lon=-1.55&source=device"), its country, and what it follows.
  public struct Here: Sendable, Equatable {
    public let name: String
    public let timezone: String
    public let query: String
    /// ISO 3166-1 alpha-2, or nil without one.
    public let country: String?
    public let follows: Follows

    public init(name: String, timezone: String, query: String, country: String?, follows: Follows) {
      self.name = name
      self.timezone = timezone
      self.query = query
      self.country = country
      self.follows = follows
    }
  }

  /// A saved place as the server stored it (client `SavedReply`), by its pid, 12 lowercase hex
  /// digits (phase 8.4b).
  public struct Saved: Sendable, Equatable {
    public let pid: String
    public let name: String
    public let timezone: String
    public let query: String
    /// ISO 3166-1 alpha-2, or nil without one.
    public let country: String?

    public init(pid: String, name: String, timezone: String, query: String, country: String?) {
      self.pid = pid
      self.name = name
      self.timezone = timezone
      self.query = query
      self.country = country
    }
  }

  /// A saved place of the body the server dropped: its index there, and why.
  public struct Refused: Codable, Sendable, Equatable {
    public let index: Int
    public let code: String

    public init(index: Int, code: String) {
      self.index = index
      self.code = code
    }
  }

  /// 32 lowercase hex digits, made from the token: Your privacy shows the first 8.
  public let id: String
  /// The phone's zone while a saved place keeps it, else nil.
  public let deviceTz: String?
  /// Where you are, or nil when the server has no free place (it couldn't locate one).
  public let here: Here?
  /// The saved places, in the body's order.
  public let saved: [Saved]
  /// The body's saved places the server dropped.
  public let refused: [Refused]
  public let alerts: RegistrationBody.Alerts
  /// The server's own text, kept as it is.
  public let seenAt: String

  public init(
    id: String,
    deviceTz: String? = nil,
    here: Here?,
    saved: [Saved] = [],
    refused: [Refused] = [],
    alerts: RegistrationBody.Alerts,
    seenAt: String
  ) {
    self.id = id
    self.deviceTz = deviceTz
    self.here = here
    self.saved = saved
    self.refused = refused
    self.alerts = alerts
    self.seenAt = seenAt
  }
}

extension DeviceResponse: Codable {
  private enum CodingKeys: String, CodingKey {
    case id, deviceTz, here, saved, refused, alerts, seenAt
  }

  /// As the client reads it (client `deviceReply`): an ID of 32 lowercase hex digits; `deviceTz`
  /// and `here` present, each null or itself; `saved` a list whose every item reads; `refused`
  /// left out or such a list; the three switches, each a boolean; `seenAt` text. Anything else
  /// doesn't read. `JSONDecoder` refuses a number where a boolean or text is due, and the reverse,
  /// as the client's `typeof` checks do.
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = try container.decode(String.self, forKey: .id)
    guard Self.isHex(id, count: 32) else {
      throw DecodingError.dataCorruptedError(
        forKey: .id, in: container, debugDescription: "Not a record's ID")
    }
    deviceTz = try container.decodePresent(String.self, forKey: .deviceTz)
    here = try container.decodePresent(Here.self, forKey: .here)
    saved = try container.decode([Saved].self, forKey: .saved)
    // Left out, none; present, a list (null isn't one).
    refused =
      container.contains(.refused) ? try container.decode([Refused].self, forKey: .refused) : []
    alerts = try container.decode(RegistrationBody.Alerts.self, forKey: .alerts)
    seenAt = try container.decode(String.self, forKey: .seenAt)
  }

  /// As the server wrote it, a null as a null, so what `alertSync.v2` keeps reads back.
  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(id, forKey: .id)
    try container.encode(deviceTz, forKey: .deviceTz)
    try container.encode(here, forKey: .here)
    try container.encode(saved, forKey: .saved)
    try container.encode(refused, forKey: .refused)
    try container.encode(alerts, forKey: .alerts)
    try container.encode(seenAt, forKey: .seenAt)
  }

  /// `/^[0-9a-f]{count}$/`.
  static func isHex(_ text: String, count: Int) -> Bool {
    text.utf8.count == count
      && text.utf8.allSatisfy {
        (UInt8(ascii: "0")...UInt8(ascii: "9")).contains($0)
          || (UInt8(ascii: "a")...UInt8(ascii: "f")).contains($0)
      }
  }
}

extension DeviceResponse.Here: Codable {
  private enum CodingKeys: String, CodingKey {
    case name, timezone, query, country, follows
  }

  /// The place's three texts, its country present (null or text), and what it follows; the
  /// server's other fields are not read.
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    name = try container.decode(String.self, forKey: .name)
    timezone = try container.decode(String.self, forKey: .timezone)
    query = try container.decode(String.self, forKey: .query)
    country = try container.decodePresent(String.self, forKey: .country)
    follows = try container.decode(DeviceResponse.Follows.self, forKey: .follows)
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(name, forKey: .name)
    try container.encode(timezone, forKey: .timezone)
    try container.encode(query, forKey: .query)
    try container.encode(country, forKey: .country)
    try container.encode(follows, forKey: .follows)
  }
}

extension DeviceResponse.Saved: Codable {
  private enum CodingKeys: String, CodingKey {
    case pid, name, timezone, query, country
  }

  /// Its pid (`/^[0-9a-f]{12}$/`), its three texts and its country present (null or text).
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    pid = try container.decode(String.self, forKey: .pid)
    guard DeviceResponse.isHex(pid, count: 12) else {
      throw DecodingError.dataCorruptedError(
        forKey: .pid, in: container, debugDescription: "Not a place's pid")
    }
    name = try container.decode(String.self, forKey: .name)
    timezone = try container.decode(String.self, forKey: .timezone)
    query = try container.decode(String.self, forKey: .query)
    country = try container.decodePresent(String.self, forKey: .country)
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(pid, forKey: .pid)
    try container.encode(name, forKey: .name)
    try container.encode(timezone, forKey: .timezone)
    try container.encode(query, forKey: .query)
    try container.encode(country, forKey: .country)
  }
}

extension DeviceResponse.Refused {
  private enum CodingKeys: String, CodingKey {
    case index, code
  }

  /// A whole index of 0 or more (`Number.isInteger`, which `JSONDecoder` matches for `Int`), and
  /// its code.
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    index = try container.decode(Int.self, forKey: .index)
    guard index >= 0 else {
      throw DecodingError.dataCorruptedError(
        forKey: .index, in: container, debugDescription: "Not an index")
    }
    code = try container.decode(String.self, forKey: .code)
  }
}

extension KeyedDecodingContainer {
  /// A field that must be there, as null (nil) or as `type`: missing, it doesn't read, as the
  /// client's `x !== null && typeof x !== 'string'` refuses `undefined`.
  fileprivate func decodePresent<Value: Decodable>(_ type: Value.Type, forKey key: Key) throws
    -> Value?
  {
    try decodeNil(forKey: key) ? nil : decode(type, forKey: key)
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

/// `alertSync.v2` (design 4.2): the set the server holds, as the last PUT it answered made it:
/// what it said (`fingerprint`), when it was sent, with which token, APNs and units (the answer
/// has none, so they are what was sent), and the answer. `token` only names that record, for a
/// DELETE or a test; it is never sent as a new registration's. Nothing stored, another version
/// (8.1's `alertSync.v1` is never read), or anything unreadable is no registration.
public struct AlertRegistration: Codable, Sendable, Equatable {
  /// The version this app writes and reads.
  public static let version = 2

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

  /// The registration as `alertSync.v2` keeps it (`ApiJSON.encoder()`, `at` to the millisecond).
  public func stored() throws -> Data {
    try ApiJSON.encoder().encode(self)
  }

  /// What `alertSync.v2` holds, or nil for nothing, another version, or anything unreadable.
  public init?(stored data: Data?) {
    guard let data, let registration = try? ApiJSON.decoder().decode(Self.self, from: data),
      registration.v == Self.version
    else { return nil }
    self = registration
  }
}

extension AlertSync {
  /// What a reply to `PUT` or `DELETE /api/v1/devices` means to the app (client `SyncReply`):
  /// the set stored, the set forgotten, a retry after so many seconds, a set the server refused
  /// in its own words (it couldn't tell where you are), or a failure.
  public enum SyncReply: Sendable, Equatable {
    case stored(DeviceResponse)
    case forgotten
    case retry(afterSeconds: Int)
    case placeRefused(message: String)
    case failed
  }

  /// What `POST /api/v1/devices/test`'s reply means to the app (client `TestOutcome`).
  public enum TestOutcome: Sendable, Equatable {
    /// Sent to Apple: `count` tests, 1 or 2 (one for where you are, one for a saved place).
    case sent(count: Int)
    /// Taken, but the server isn't sending notifications yet.
    case dryRun
    /// The hourly limit of test notifications.
    case limited
    /// Nothing is sent at night.
    case quiet
    /// The server has no record for the token.
    case notRegistered
    case failed
  }

  /// A devices reply (client `syncReply`), from its status, its body's bytes (empty for none)
  /// and its `Retry-After` header: 200 with a `DeviceResponse` is `stored` (any other 200,
  /// 8.1's answer included, `failed`); 204 `forgotten`; 429 `retry`, after `Retry-After`'s whole
  /// seconds when it is 1 to 999999 written as digits, else `Constants.Client.retryAfterMs` (the
  /// one-write-a-minute rule, and the cap on places new to the set); 400 whose error code is
  /// `bad_location` with a message that isn't empty, `placeRefused` with it (the server couldn't
  /// tell where you are, and has forgotten the set); anything else `failed`. A body that isn't
  /// JSON fits no shape.
  public static func syncReply(status: Int, body: Data, retryAfter: String?) -> SyncReply {
    switch status {
    case 200:
      guard let reply = decoded(DeviceResponse.self, body) else { return .failed }
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
  /// `sent` is true `sent`, with its `count` when that is a whole number 1 or more, else 1 (the
  /// server says `count` only above one); 202 whose `sent` is false and `dryRun` true `dryRun`;
  /// 429 with code `test_limited` `limited` (Netlify's own 429, `rate_limited`, is `failed`);
  /// 409 `quiet_hours` `quiet`; 404 `not_registered` `notRegistered`; anything else `failed`.
  public static func testOutcome(status: Int, body: Data) -> TestOutcome {
    if status == 202 {
      let sent = decoded(SentField.self, body)?.sent
      if sent == true {
        let count = decoded(CountField.self, body)?.count
        return .sent(count: count.map { $0 >= 1 ? $0 : 1 } ?? 1)
      }
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

  /// Each place's zone in the server's answer, by the place's `Target.key`, where you are first
  /// (client `replyZones`): what a notification's tap opens its day by. A query that names no
  /// place is left out, and the first zone is kept for one key.
  public static func replyZones(_ reply: DeviceResponse) -> [String: String] {
    var zones: [String: String] = [:]
    let places =
      [reply.here.map { ($0.query, $0.timezone) }].compactMap { $0 }
      + reply.saved.map { ($0.query, $0.timezone) }
    for (query, zone) in places {
      guard let target = Target(query: query), target != .ip, zones[target.key] == nil else {
        continue
      }
      zones[target.key] = zone
    }
    return zones
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

  /// A whole number: `JSONDecoder` reads `2` and `2.0` as `Int`, and not `1.5`, `"2"`, `true`
  /// or null, as `Number.isInteger` judges them.
  private struct CountField: Decodable {
    let count: Int
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

extension AlertSync.TestOutcome: Codable {
  private enum CodingKeys: String, CodingKey {
    case kind, count
  }

  private enum Kind: String, Codable {
    case sent, dryRun, limited, quiet, notRegistered, failed
  }

  /// The client's JSON: `{ kind: "sent", count }`, or `{ kind }` for the others.
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .kind) {
    case .sent: self = .sent(count: try container.decode(Int.self, forKey: .count))
    case .dryRun: self = .dryRun
    case .limited: self = .limited
    case .quiet: self = .quiet
    case .notRegistered: self = .notRegistered
    case .failed: self = .failed
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .sent(let count):
      try container.encode(Kind.sent, forKey: .kind)
      try container.encode(count, forKey: .count)
    case .dryRun: try container.encode(Kind.dryRun, forKey: .kind)
    case .limited: try container.encode(Kind.limited, forKey: .kind)
    case .quiet: try container.encode(Kind.quiet, forKey: .kind)
    case .notRegistered: try container.encode(Kind.notRegistered, forKey: .kind)
    case .failed: try container.encode(Kind.failed, forKey: .kind)
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
