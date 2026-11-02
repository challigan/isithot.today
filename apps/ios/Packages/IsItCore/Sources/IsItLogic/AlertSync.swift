import Foundation
import IsItModel

/// The notification switches (client `AlertPrefs`): the evening before, on the day, and also
/// when snow is possible. The app keeps them in `alerts.v2`.
public struct AlertPrefs: Codable, Sendable, Equatable {
  /// "Evening before (about 6pm)": when snow is likely tomorrow.
  public var evening: Bool
  /// "On the day (about 7am)": when snow is likely today.
  public var morning: Bool
  /// "Also when snow is possible": widens the other two, so alone it switches nothing on.
  public var possible: Bool

  public init(evening: Bool = false, morning: Bool = false, possible: Bool = false) {
    self.evening = evening
    self.morning = morning
    self.possible = possible
  }
}

/// The body of `PUT /api/v1/devices`, version 2 (client `RegistrationBody`): the device's whole
/// set, which the server keeps. Where you are, the free place, as the phone's cell or for the
/// server to locate from the connection; and the saved places, none before phase 8.4b.
public struct RegistrationBody: Codable, Sendable, Equatable {
  /// The version this app sends.
  public static let version = 2

  /// The app registering: the snow app.
  public enum App: String, Codable, Sendable, CaseIterable {
    case snow
  }

  public enum Platform: String, Codable, Sendable, CaseIterable {
    case ios
  }

  /// Which APNs the token is for (client `PushEnv`): sandbox in Debug builds, production in
  /// Release builds, TestFlight's and the App Store's.
  public enum Env: String, Codable, Sendable, CaseIterable {
    case sandbox, production
  }

  /// Where you are as a registration names it (client `HereBody`): `{ "source": "ip" }` for the
  /// server to locate from the request's connection, or the phone's cell, `{ "lat", "lon",
  /// "source": "device" }`, its point alone.
  public enum Here: Codable, Sendable, Equatable {
    case ip
    case device(lat: Double, lon: Double)

    private enum CodingKeys: String, CodingKey {
      case lat, lon, source
    }

    private enum Source: String, Codable {
      case ip, device
    }

    public init(from decoder: any Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      switch try container.decode(Source.self, forKey: .source) {
      case .ip:
        self = .ip
      case .device:
        self = .device(
          lat: try container.decode(Double.self, forKey: .lat),
          lon: try container.decode(Double.self, forKey: .lon))
      }
    }

    public func encode(to encoder: any Encoder) throws {
      var container = encoder.container(keyedBy: CodingKeys.self)
      switch self {
      case .ip:
        try container.encode(Source.ip, forKey: .source)
      case .device(let lat, let lon):
        try container.encode(lat, forKey: .lat)
        try container.encode(lon, forKey: .lon)
        try container.encode(Source.device, forKey: .source)
      }
    }
  }

  /// A saved place as a registration names it (client `SavedBody`), in a form `/api/v1/today`
  /// takes too: a city page's slug, `{ "place": "durham-gb" }`, or a searched place's
  /// coordinates with what the search said about it. Phase 8.4b sends them; 8.4a's set has none.
  public enum Saved: Codable, Sendable, Equatable {
    case city(slug: String)
    case search(Target.Coordinates)

    private enum CodingKeys: String, CodingKey {
      case place
    }

    public init(from decoder: any Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      if let slug = try container.decodeIfPresent(String.self, forKey: .place) {
        self = .city(slug: slug)
      } else {
        self = .search(try Target.Coordinates(from: decoder))
      }
    }

    public func encode(to encoder: any Encoder) throws {
      switch self {
      case .city(let slug):
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(slug, forKey: .place)
      case .search(let place):
        try place.encode(to: encoder)
      }
    }
  }

  /// The switches for each topic: the snow app's only.
  public struct Alerts: Codable, Sendable, Equatable {
    public var snow: AlertPrefs

    public init(snow: AlertPrefs) {
      self.snow = snow
    }
  }

  /// `RegistrationBody.version`.
  public var v: Int
  public var app: App
  public var platform: Platform
  public var env: Env
  /// The APNs device token, in hex.
  public var token: String
  public var units: Units
  /// "1.0 (42)": the version and build.
  public var appVersion: String
  public var alerts: Alerts
  public var here: Here
  public var saved: [Saved]

  public init(
    app: App = .snow,
    platform: Platform = .ios,
    env: Env,
    token: String,
    units: Units,
    appVersion: String,
    alerts: Alerts,
    here: Here,
    saved: [Saved] = []
  ) {
    v = Self.version
    self.app = app
    self.platform = platform
    self.env = env
    self.token = token
    self.units = units
    self.appVersion = appVersion
    self.alerts = alerts
    self.here = here
    self.saved = saved
  }
}

/// Keeping the server's record of the app's notifications in step with the app (`PUT` and
/// `DELETE` on `/api/v1/devices`, version 2): where you are, and what to send for it; whether
/// anything needs sending at all; and what the server's replies mean. The port of client
/// `alerts.ts`, checked against `alerts.json`.
public enum AlertSync {
  /// The app's notification permission, as the system reports it (client `Permission`).
  public enum Permission: String, Codable, Sendable, CaseIterable {
    case authorized, provisional, denied, notDetermined
  }

  /// The app's location access, as the system reports it (client `LocationAccess`), restricted
  /// reading as denied: IsItState's `LocationAccess`, as the notifications' rules take it.
  public enum LocationAccess: String, Codable, Sendable, CaseIterable {
    case granted, denied, notDetermined
  }

  /// What to do about the server's record (client `AlertAction`).
  public enum Action: String, Codable, Sendable, CaseIterable {
    /// Send the registration (`PUT`).
    case put
    /// Delete the server's record (`DELETE`).
    case delete
    /// Nothing to send.
    case none
    /// Wait for the push token.
    case needsToken
  }

  /// A registration sent, as `alertSync.v2` keeps the last the server took, and the model the
  /// last it refused: what it said (`fingerprint`), and when it was sent.
  public struct Sent: Codable, Sendable, Equatable {
    public var fingerprint: String
    public var at: Date

    public init(fingerprint: String, at: Date) {
      self.fingerprint = fingerprint
      self.at = at
    }
  }

  /// The registration: the switches for where you are, and no saved place (client
  /// `registrationBody`). The phone's cell goes as its point alone, nothing else it carries.
  public static func body(
    token: String,
    env: RegistrationBody.Env,
    here: HerePlace,
    units: Units,
    prefs: AlertPrefs,
    appVersion: String
  ) -> RegistrationBody {
    let sent: RegistrationBody.Here =
      switch here {
      case .device(let point): .device(lat: point.lat, lon: point.lon)
      case .ip: .ip
      }
    return RegistrationBody(
      env: env,
      token: token,
      units: units,
      appVersion: appVersion,
      alerts: RegistrationBody.Alerts(snow: prefs),
      here: sent
    )
  }

  /// What a registration says (client `fingerprint`), as JSON with its keys sorted at every
  /// level (a list keeps its order), written as JavaScript's `JSON.stringify` writes it, and
  /// leaving out `appVersion`: an app update alone is no reason to register again.
  public static func fingerprint(_ body: RegistrationBody) -> String {
    let said: [String: JSONValue] = [
      "v": .number(Double(body.v)),
      "app": .string(body.app.rawValue),
      "platform": .string(body.platform.rawValue),
      "env": .string(body.env.rawValue),
      "token": .string(body.token),
      "units": .string(body.units.rawValue),
      "alerts": .object(["snow": json(body.alerts.snow)]),
      "here": json(body.here),
      "saved": .array(body.saved.map(json)),
    ]
    return JSONValue.object(said).written
  }

  /// What to do about the server's record (client `alertAction`), in order: delete it (if
  /// there is one) when no notification is switched on or the permission is denied ("also when
  /// snow is possible" only widens the other two, so alone it switches nothing on); wait for the
  /// push token; nothing while the server has refused this very registration (`refused`, a 400:
  /// it couldn't tell where you are) and the app hasn't become active since; otherwise send it
  /// when it has changed since `last` was sent, when `Constants.Alerts.heartbeatDays` have passed
  /// since, or, while where you are is approximate, when the app became active (`activeAt`)
  /// `Constants.Alerts.hereRefreshMinutes` or more after it: the server locates the connection
  /// afresh at each registration.
  public static func action(
    prefs: AlertPrefs,
    permission: Permission,
    token: String?,
    here: HerePlace,
    units: Units,
    last: Sent?,
    refused: Sent?,
    activeAt: Date,
    now: Date,
    env: RegistrationBody.Env,
    appVersion: String
  ) -> Action {
    if (!prefs.evening && !prefs.morning) || permission == .denied {
      return last == nil ? .none : .delete
    }
    guard let token, !token.isEmpty else { return .needsToken }
    let said = fingerprint(
      body(
        token: token, env: env, here: here, units: units, prefs: prefs, appVersion: appVersion))
    // Compared byte for byte, as JavaScript compares strings, where Swift's `==` would take
    // canonically equivalent text as the same.
    if let refused, same(refused.fingerprint, said), refused.at.epochMs >= activeAt.epochMs {
      return .none
    }
    guard let last, same(last.fingerprint, said) else { return .put }
    if now.epochMs - last.at.epochMs >= Constants.Alerts.heartbeatDays * dayMs { return .put }
    let refresh =
      activeAt.epochMs - last.at.epochMs >= Constants.Alerts.hereRefreshMinutes * minuteMs
    return here == .ip && refresh ? .put : .none
  }

  // MARK: - Private

  private static let minuteMs = 60 * 1000
  private static let dayMs = 24 * 60 * minuteMs

  /// Whether `a` and `b` are the same text code unit for code unit, as JavaScript's `===`.
  private static func same(_ a: String, _ b: String) -> Bool {
    a.utf8.elementsEqual(b.utf8)
  }

  private static func json(_ prefs: AlertPrefs) -> JSONValue {
    .object([
      "evening": .bool(prefs.evening),
      "morning": .bool(prefs.morning),
      "possible": .bool(prefs.possible),
    ])
  }

  private static func json(_ here: RegistrationBody.Here) -> JSONValue {
    switch here {
    case .ip:
      .object(["source": .string("ip")])
    case .device(let lat, let lon):
      .object(["lat": .number(lat), "lon": .number(lon), "source": .string("device")])
    }
  }

  private static func json(_ saved: RegistrationBody.Saved) -> JSONValue {
    switch saved {
    case .city(let slug):
      return .object(["place": .string(slug)])
    case .search(let place):
      var fields: [String: JSONValue] = [
        "lat": .number(place.lat),
        "lon": .number(place.lon),
        "source": .string(place.source.rawValue),
      ]
      if let name = place.name { fields["name"] = .string(name) }
      if let region = place.region { fields["region"] = .string(region) }
      if let country = place.country { fields["country"] = .string(country) }
      if let geonameId = place.geonameId { fields["geonameId"] = .number(Double(geonameId)) }
      if let elevation = place.elevation { fields["elevation"] = .number(elevation) }
      return .object(fields)
    }
  }
}

/// The JSON a fingerprint is made of, written as `JSON.stringify` writes it, with every
/// object's keys sorted as JavaScript's `sort` sorts them (by UTF-16 code unit), and a list's
/// items in their order.
private enum JSONValue {
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  var written: String {
    switch self {
    case .bool(let value):
      return value ? "true" : "false"
    case .number(let value):
      return JavaScriptNumber.string(value)
    case .string(let value):
      return Self.quoted(value)
    case .array(let items):
      return "[" + items.map(\.written).joined(separator: ",") + "]"
    case .object(let fields):
      let keys = fields.keys.sorted { $0.utf16.lexicographicallyPrecedes($1.utf16) }
      let members = keys.map { key in Self.quoted(key) + ":" + (fields[key]?.written ?? "null") }
      return "{" + members.joined(separator: ",") + "}"
    }
  }

  /// A string as `JSON.stringify` quotes it (ECMAScript QuoteJSONString): the quote, the
  /// backslash and the control characters escaped, short forms where there are some, and
  /// everything else as it is. A Swift string never holds the lone surrogates it would escape
  /// too.
  private static func quoted(_ text: String) -> String {
    var out = "\""
    for scalar in text.unicodeScalars {
      switch scalar {
      case "\u{08}": out += "\\b"
      case "\t": out += "\\t"
      case "\n": out += "\\n"
      case "\u{0C}": out += "\\f"
      case "\r": out += "\\r"
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case _ where scalar.value < 0x20:
        let hex = String(scalar.value, radix: 16)
        out += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
      default:
        out.unicodeScalars.append(scalar)
      }
    }
    return out + "\""
  }
}
