import Foundation
import IsItModel

/// The notification switches (client `AlertPrefs`): the evening before, on the day, and also
/// when snow is possible. The app keeps them in `alerts.v1`.
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

/// The body of `PUT /api/v1/devices` (client `RegistrationBody`, iOS build spec section 8.2).
public struct RegistrationBody: Codable, Sendable, Equatable {
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

  /// The registration's place, in a form `/api/v1/today` takes too (client
  /// `RegistrationPlace`): a city page's slug, `{ "place": "durham-gb" }`, or coordinates, a
  /// searched place's with what the search said about it, the device's with only `lat`, `lon`
  /// and `source`.
  public enum Place: Codable, Sendable, Equatable {
    case city(slug: String)
    case coords(Target.Coordinates)

    /// The place as the today query names it (`TodayQuery.build`), with the same fields: nil
    /// for approximate IP location, which is never registered.
    public init?(_ target: Target) {
      switch target {
      case .ip:
        return nil
      case .city(let slug, _):
        self = .city(slug: slug)
      case .coords(let place) where place.source == .device:
        self = .coords(Target.Coordinates(source: .device, lat: place.lat, lon: place.lon))
      case .coords(let place):
        var searched = Target.Coordinates(source: .search, lat: place.lat, lon: place.lon)
        // As the query: an empty name, region or country and a zero geonameId are left out.
        if let name = place.name, !name.isEmpty { searched.name = name }
        if let region = place.region, !region.isEmpty { searched.region = region }
        if let country = place.country, !country.isEmpty { searched.country = country }
        if let geonameId = place.geonameId, geonameId != 0 { searched.geonameId = geonameId }
        searched.elevation = place.elevation
        self = .coords(searched)
      }
    }

    private enum CodingKeys: String, CodingKey {
      case place
    }

    public init(from decoder: any Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      if let slug = try container.decodeIfPresent(String.self, forKey: .place) {
        self = .city(slug: slug)
      } else {
        self = .coords(try Target.Coordinates(from: decoder))
      }
    }

    public func encode(to encoder: any Encoder) throws {
      switch self {
      case .city(let slug):
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(slug, forKey: .place)
      case .coords(let place):
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

  public var app: App
  public var platform: Platform
  public var env: Env
  /// The APNs device token, in hex.
  public var token: String
  public var place: Place
  public var units: Units
  public var alerts: Alerts
  /// "1.0 (42)": the version and build.
  public var appVersion: String

  public init(
    app: App = .snow,
    platform: Platform = .ios,
    env: Env,
    token: String,
    place: Place,
    units: Units,
    alerts: Alerts,
    appVersion: String
  ) {
    self.app = app
    self.platform = platform
    self.env = env
    self.token = token
    self.place = place
    self.units = units
    self.alerts = alerts
    self.appVersion = appVersion
  }
}

/// Keeping the server's record of the app's notifications in step with the app (`PUT` and
/// `DELETE` on `/api/v1/devices`): what to send, and whether anything needs sending at all. The
/// port of client `alerts.ts`, checked against `alerts.json`.
public enum AlertSync {
  /// The app's notification permission, as the system reports it (client `Permission`).
  public enum Permission: String, Codable, Sendable, CaseIterable {
    case authorized, provisional, denied, notDetermined
  }

  /// What to do about the server's record (client `AlertAction`).
  public enum Action: String, Codable, Sendable, CaseIterable {
    /// Send the registration (`PUT`).
    case put
    /// Delete the server's record (`DELETE`).
    case delete
    /// Nothing to send.
    case none
    /// Ask for a place: notifications are never for approximate IP location.
    case needsPlace
    /// Wait for the push token.
    case needsToken
  }

  /// The registration last sent, as `alertSync.v1` keeps it: what it said (`fingerprint`), and
  /// when it was sent.
  public struct Sent: Codable, Sendable, Equatable {
    public var fingerprint: String
    public var at: Date

    public init(fingerprint: String, at: Date) {
      self.fingerprint = fingerprint
      self.at = at
    }
  }

  /// Whether notifications can be for `target` (client `alertPlaceAllowed`): a place someone
  /// chose, never the approximate IP one, nor none.
  public static func placeAllowed(_ target: Target?) -> Bool {
    switch target {
    case nil, .ip: false
    case .city, .coords: true
    }
  }

  /// The registration for these settings (client `registrationBody`). Nil for approximate IP
  /// location, which is never registered (`placeAllowed`).
  public static func body(
    token: String,
    env: RegistrationBody.Env,
    place: Target,
    units: Units,
    prefs: AlertPrefs,
    appVersion: String
  ) -> RegistrationBody? {
    guard let place = RegistrationBody.Place(place) else { return nil }
    return RegistrationBody(
      env: env,
      token: token,
      place: place,
      units: units,
      alerts: RegistrationBody.Alerts(snow: prefs),
      appVersion: appVersion
    )
  }

  /// What a registration says (client `fingerprint`), as JSON with its keys sorted at every
  /// level, written as JavaScript's `JSON.stringify` writes it, and leaving out `appVersion`:
  /// an app update alone is no reason to register again.
  public static func fingerprint(_ body: RegistrationBody) -> String {
    let said: [String: JSONValue] = [
      "app": .string(body.app.rawValue),
      "platform": .string(body.platform.rawValue),
      "env": .string(body.env.rawValue),
      "token": .string(body.token),
      "place": json(body.place),
      "units": .string(body.units.rawValue),
      "alerts": .object(["snow": json(body.alerts.snow)]),
    ]
    return JSONValue.object(said).written
  }

  /// What to do about the server's record (client `alertAction`), in order: delete it (if
  /// there is one) when no notification is switched on or the permission is denied ("also when
  /// snow is possible" only widens the other two, so alone it switches nothing on); ask for a
  /// place when there is none chosen; wait for the push token; otherwise send it again when it
  /// has changed, or when `Constants.Alerts.heartbeatDays` have passed since it was last sent.
  public static func action(
    prefs: AlertPrefs,
    permission: Permission,
    token: String?,
    place: Target?,
    units: Units,
    last: Sent?,
    now: Date,
    env: RegistrationBody.Env,
    appVersion: String
  ) -> Action {
    if (!prefs.evening && !prefs.morning) || permission == .denied {
      return last == nil ? .none : .delete
    }
    guard let place, placeAllowed(place) else { return .needsPlace }
    guard let token, !token.isEmpty else { return .needsToken }
    guard
      let registration = body(
        token: token,
        env: env,
        place: place,
        units: units,
        prefs: prefs,
        appVersion: appVersion
      )
    else { return .needsPlace }
    // Compared byte for byte, as JavaScript compares strings, where Swift's `==` would take
    // canonically equivalent text as the same.
    guard let last, fingerprint(registration).utf8.elementsEqual(last.fingerprint.utf8) else {
      return .put
    }
    let heartbeat = Constants.Alerts.heartbeatDays * dayMs
    return now.epochMs - last.at.epochMs >= heartbeat ? .put : .none
  }

  // MARK: - Private

  private static let dayMs = 24 * 60 * 60 * 1000

  private static func json(_ place: RegistrationBody.Place) -> JSONValue {
    switch place {
    case .city(let slug):
      return .object(["place": .string(slug)])
    case .coords(let place):
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

  private static func json(_ prefs: AlertPrefs) -> JSONValue {
    .object([
      "evening": .bool(prefs.evening),
      "morning": .bool(prefs.morning),
      "possible": .bool(prefs.possible),
    ])
  }
}

/// The JSON a fingerprint is made of, written as `JSON.stringify` writes it, with every
/// object's keys sorted as JavaScript's `sort` sorts them (by UTF-16 code unit).
private enum JSONValue {
  case bool(Bool)
  case number(Double)
  case string(String)
  case object([String: JSONValue])

  var written: String {
    switch self {
    case .bool(let value):
      return value ? "true" : "false"
    case .number(let value):
      return JavaScript.string(value)
    case .string(let value):
      return Self.quoted(value)
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
