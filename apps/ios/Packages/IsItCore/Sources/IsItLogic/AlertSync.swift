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
/// server to locate from the connection; the saved places with a bell on (phase 8.4b), at most
/// `Constants.Alerts.savedPlacesMax`, in saved order; and the phone's own zone with them. What a
/// PUT sends is its `json`, byte for byte the client's.
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
  /// coordinates with what the search said about it (phase 8.4b).
  public enum Saved: Codable, Sendable, Equatable {
    case city(slug: String)
    case search(Target.Coordinates)

    /// A saved place's target as the registration names it (client `savedBody`), as the today
    /// query names it: a city by its slug alone; coordinates as a searched place's point, with
    /// the words the search gave that aren't empty and a `geonameId` that isn't 0 (`elevation`
    /// whenever there is one, 0 too). Nil for approximate IP location, which is never saved.
    public init?(_ target: Target) {
      switch target {
      case .ip:
        return nil
      case .city(let slug, _):
        self = .city(slug: slug)
      case .coords(let place):
        let said = { (text: String?) in text?.isEmpty == false ? text : nil }
        self = .search(
          Target.Coordinates(
            source: .search, lat: place.lat, lon: place.lon, name: said(place.name),
            region: said(place.region), country: said(place.country),
            geonameId: place.geonameId == 0 ? nil : place.geonameId, elevation: place.elevation))
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
  /// The phone's own zone, as iOS names it ("Europe/London"), only with a saved place: the server
  /// sends a saved place's notifications silently during the phone's night (phase 8.4b).
  public var deviceTz: String?
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
    deviceTz: String? = nil,
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
    self.deviceTz = deviceTz
    self.alerts = alerts
    self.here = here
    self.saved = saved
  }
}

/// Keeping the server's record of the app's notifications in step with the app (`PUT` and
/// `DELETE` on `/api/v1/devices`, version 2): where you are, and what to send for it; the saved
/// places' bells, which the one-off purchase unlocks (phase 8.4b), and which of them are sent;
/// whether anything needs sending at all; and what the server's replies mean. The port of client
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

  /// The registration, the device's whole set (client `registrationBody`): the switches, which
  /// are one set for every place; where you are, the phone's cell as its point alone, nothing
  /// else it carries; and the saved places with a bell on (`savedForBody`, none by default), in
  /// that order, each as `RegistrationBody.Saved(_:)` names it, with the phone's own zone
  /// (`deviceTz`, as iOS names it, `TimeZone.current.identifier`) only while there is one, and
  /// never empty. Approximate IP location among `saved` is left out: it is never saved.
  public static func body(
    token: String,
    env: RegistrationBody.Env,
    here: HerePlace,
    units: Units,
    prefs: AlertPrefs,
    appVersion: String,
    saved: [Target] = [],
    deviceTz: String? = nil
  ) -> RegistrationBody {
    let sent: RegistrationBody.Here =
      switch here {
      case .device(let point): .device(lat: point.lat, lon: point.lon)
      case .ip: .ip
      }
    let places = saved.compactMap(RegistrationBody.Saved.init)
    let zone = places.isEmpty || deviceTz?.isEmpty != false ? nil : deviceTz
    return RegistrationBody(
      env: env,
      token: token,
      units: units,
      appVersion: appVersion,
      deviceTz: zone,
      alerts: RegistrationBody.Alerts(snow: prefs),
      here: sent,
      saved: places
    )
  }

  /// What a registration says (client `fingerprint`), as JSON with its keys sorted at every
  /// level (a list keeps its order), written as JavaScript's `JSON.stringify` writes it, and
  /// leaving out `appVersion`: an app update alone is no reason to register again.
  public static func fingerprint(_ body: RegistrationBody) -> String {
    said(body, appVersion: false).sortedWritten
  }

  /// What to do about the server's record (client `alertAction`), in order: delete it (if
  /// there is one, or may be) when nothing can be sent (`active`), whatever bells are on; wait for
  /// the push token; nothing while the server has refused this very registration (`refused`, a
  /// 400: it couldn't tell where you are) and the app hasn't become active since; otherwise send
  /// it when it has changed since `last` was sent (a switch, the units, where you are, a saved
  /// place with a bell on, or the phone's zone while one is sent), when
  /// `Constants.Alerts.heartbeatDays` have passed since, or, while where you are is approximate,
  /// when the app became active (`activeAt`) `Constants.Alerts.hereRefreshMinutes` or more after
  /// it: the server locates the connection afresh at each registration. `saved` and `deviceTz`
  /// are `body`'s, as `savedForBody` gives them: a refund sends none, so the set changes and the
  /// server deletes the saved places. `unconfirmed` is a set sent since `last` that the server
  /// may hold though no reply to it was kept: a 429 for the places new to the set comes after the
  /// server stored where you are and the first three, a 503 after it stored the rest, and a reply
  /// lost may follow a set stored; with nothing to send it is deleted as `last` would be.
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
    appVersion: String,
    saved: [Target] = [],
    deviceTz: String? = nil,
    unconfirmed: Bool = false
  ) -> Action {
    guard active(prefs: prefs, permission: permission) else {
      return last != nil || unconfirmed ? .delete : .none
    }
    guard let token, !token.isEmpty else { return .needsToken }
    let said = fingerprint(
      body(
        token: token, env: env, here: here, units: units, prefs: prefs, appVersion: appVersion,
        saved: saved, deviceTz: deviceTz))
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

  /// Whether anything can be sent (client `alertsActive`): the evening or the morning switched
  /// on ("also when snow is possible" only widens the other two, so alone it switches nothing
  /// on), and the permission not denied. The switches are one set for every place, where you are
  /// and each saved place alike, so without them the set is deleted however many bells are on
  /// (`action`), and every bell shows off (`bellState`'s `active`), kept for when a switch comes
  /// back.
  public static func active(prefs: AlertPrefs, permission: Permission) -> Bool {
    (prefs.evening || prefs.morning) && permission != .denied
  }

  /// Whether the saved places' bells are the phone's to send (client `ownsSaved`): the purchase,
  /// once StoreKit has said (`unlocked`); until then (nil, at launch), whether the last
  /// registration the server took had saved places, so a launch never deletes them and adds them
  /// again while the kept purchase and StoreKit disagree for a moment (decision 15).
  public static func ownsSaved(unlocked: Bool?, last: DeviceResponse?) -> Bool {
    unlocked ?? (last.map { !$0.saved.isEmpty } ?? false)
  }

  /// The saved places a registration sends (client `savedForBody`): none unless `owns`
  /// (`ownsSaved`); else the targets of those with a bell on (`bells`, by `Target.key`), in
  /// saved order, each place once, at most `Constants.Alerts.savedPlacesMax`. A place the server
  /// would refuse the whole set for (the phone's own point, a point not on Earth, a city whose
  /// slug is blank, none of which can be saved) is left out. Keys are compared byte for byte, as
  /// JavaScript compares strings.
  public static func savedForBody(_ saved: [SavedPlace], bells: [String], owns: Bool) -> [Target] {
    guard owns else { return [] }
    let on = Set(bells.map { Array($0.utf8) })
    var sent: Set<[UInt8]> = []
    var targets: [Target] = []
    for place in saved {
      if targets.count >= Constants.Alerts.savedPlacesMax { break }
      let key = Array(place.target.key.utf8)
      guard sendable(place.target), on.contains(key), !sent.contains(key) else { continue }
      sent.insert(key)
      targets.append(place.target)
    }
    return targets
  }

  // MARK: - Private

  private static let minuteMs = 60 * 1000
  private static let dayMs = 24 * 60 * minuteMs

  /// Whether `a` and `b` are the same text code unit for code unit, as JavaScript's `===`.
  private static func same(_ a: String, _ b: String) -> Bool {
    a.utf8.elementsEqual(b.utf8)
  }

  /// A saved place as the server takes it in `saved` (client `sendable`): a city whose slug isn't
  /// blank, as JavaScript's `trim` sees it, or a searched point on Earth.
  private static func sendable(_ target: Target) -> Bool {
    switch target {
    case .ip: false
    case .city(let slug, _): !JavaScriptString.trimmed(slug).isEmpty
    case .coords(let place):
      place.source == .search && KeptCell(lat: place.lat, lon: place.lon).onEarth
    }
  }

  /// What `body` says, its members in the client's order (`registrationBody`'s object), with
  /// `appVersion` or without it, as the fingerprint leaves it out.
  fileprivate static func said(_ body: RegistrationBody, appVersion: Bool) -> JSONValue {
    var members: [(String, JSONValue)] = [
      ("v", .number(Double(body.v))),
      ("app", .string(body.app.rawValue)),
      ("platform", .string(body.platform.rawValue)),
      ("env", .string(body.env.rawValue)),
      ("token", .string(body.token)),
      ("units", .string(body.units.rawValue)),
    ]
    if appVersion { members.append(("appVersion", .string(body.appVersion))) }
    if let deviceTz = body.deviceTz { members.append(("deviceTz", .string(deviceTz))) }
    members += [
      ("alerts", .object([("snow", json(body.alerts.snow))])),
      ("here", json(body.here)),
      ("saved", .array(body.saved.map(json))),
    ]
    return .object(members)
  }

  private static func json(_ prefs: AlertPrefs) -> JSONValue {
    .object([
      ("evening", .bool(prefs.evening)),
      ("morning", .bool(prefs.morning)),
      ("possible", .bool(prefs.possible)),
    ])
  }

  private static func json(_ here: RegistrationBody.Here) -> JSONValue {
    switch here {
    case .ip:
      .object([("source", .string("ip"))])
    case .device(let lat, let lon):
      .object([("lat", .number(lat)), ("lon", .number(lon)), ("source", .string("device"))])
    }
  }

  /// A saved place in the client's order (`savedBody`): the point and its source, then each word
  /// and number it has.
  private static func json(_ saved: RegistrationBody.Saved) -> JSONValue {
    switch saved {
    case .city(let slug):
      return .object([("place", .string(slug))])
    case .search(let place):
      var members: [(String, JSONValue)] = [
        ("lat", .number(place.lat)),
        ("lon", .number(place.lon)),
        ("source", .string(place.source.rawValue)),
      ]
      if let name = place.name { members.append(("name", .string(name))) }
      if let region = place.region { members.append(("region", .string(region))) }
      if let country = place.country { members.append(("country", .string(country))) }
      if let geonameId = place.geonameId {
        members.append(("geonameId", .number(Double(geonameId))))
      }
      if let elevation = place.elevation { members.append(("elevation", .number(elevation))) }
      return .object(members)
    }
  }
}

extension RegistrationBody {
  /// The body as the client sends it, `JSON.stringify(registrationBody(…))` byte for byte: the
  /// keys in the client's order, `deviceTz` after `appVersion` and only while there is one, a "/"
  /// as it is (`JSONEncoder` writes "\/" unless told not to), numbers as JavaScript writes them.
  /// What a PUT sends.
  public var json: Data {
    Data(AlertSync.said(self, appVersion: true).written.utf8)
  }
}

/// The JSON a registration is made of, written as `JSON.stringify` writes it: as it is for the
/// body (`written`), or with every object's keys sorted as JavaScript's `sort` sorts them (by
/// UTF-16 code unit) for its fingerprint (`sortedWritten`); a list's items in their order.
private enum JSONValue {
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  /// An object's members, in the order the client's object has them.
  case object([(String, JSONValue)])

  /// Each object's members in their order.
  var written: String { text(sorted: false) }

  /// Each object's members by key, as the fingerprint writes them.
  var sortedWritten: String { text(sorted: true) }

  private func text(sorted: Bool) -> String {
    switch self {
    case .bool(let value):
      return value ? "true" : "false"
    case .number(let value):
      return JavaScriptNumber.string(value)
    case .string(let value):
      return Self.quoted(value)
    case .array(let items):
      return "[" + items.map { $0.text(sorted: sorted) }.joined(separator: ",") + "]"
    case .object(let members):
      let ordered =
        sorted ? members.sorted { $0.0.utf16.lexicographicallyPrecedes($1.0.utf16) } : members
      let written = ordered.map { key, value in
        Self.quoted(key) + ":" + value.text(sorted: sorted)
      }
      return "{" + written.joined(separator: ",") + "}"
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
