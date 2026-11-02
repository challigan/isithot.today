import Foundation
import IsItModel

/// One of the three notification switches (Settings → Notifications, section 12.1): the evening
/// before, on the day, and also when snow is possible (client `AlertSwitch`).
public enum AlertSwitch: String, Codable, Sendable, CaseIterable {
  case evening, morning, possible
}

/// Where you are, the free notification's place (client `HerePlace`): the phone's own 0.05°
/// cell, or approximate, the town the server finds from the connection of the registration
/// itself. Never a place chosen on screen, so its own type. As the client's JSON: `{ "kind":
/// "device", "target": … }` or `{ "kind": "ip" }`.
public enum HerePlace: Sendable, Equatable {
  /// The phone's own cell, a device point on the forecast grid (`Target.device(lat:lon:)`).
  case device(Target.Coordinates)
  /// Approximate: the server locates the registration's connection.
  case ip

  /// The place as a target: the phone's point, or approximate IP location.
  public var target: Target {
    switch self {
    case .device(let point): .coords(point)
    case .ip: .ip
    }
  }

  /// The cell `alerts.v2` keeps for it: the phone's, and nothing while approximate.
  public var cell: KeptCell? {
    switch self {
    case .device(let point): KeptCell(lat: point.lat, lon: point.lon)
    case .ip: nil
    }
  }
}

extension HerePlace: Codable {
  private enum CodingKeys: String, CodingKey {
    case kind, target
  }

  private enum Kind: String, Codable {
    case device, ip
  }

  /// The client's JSON. A device place's target is coordinates; anything else doesn't read.
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .kind) {
    case .ip:
      self = .ip
    case .device:
      guard case .coords(let point) = try container.decode(Target.self, forKey: .target) else {
        throw DecodingError.dataCorruptedError(
          forKey: .target, in: container, debugDescription: "Where you are is a point")
      }
      self = .device(point)
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .device(let point):
      try container.encode(Kind.device, forKey: .kind)
      try container.encode(Target.coords(point), forKey: .target)
    case .ip:
      try container.encode(Kind.ip, forKey: .kind)
    }
  }
}

/// A cell as `alerts.v2` keeps it (client `KeptCell`): the phone's last, while location access is
/// allowed.
public struct KeptCell: Codable, Sendable, Equatable {
  public var lat: Double
  public var lon: Double

  public init(lat: Double, lon: Double) {
    self.lat = lat
    self.lon = lon
  }

  /// A point on Earth (core `isValidLatLon`): finite, the latitude within ±90° and the
  /// longitude within ±180°.
  var onEarth: Bool {
    lat.isFinite && lon.isFinite && lat.magnitude <= 90 && lon.magnitude <= 180
  }
}

/// `alerts.v2` (design 4.2): the switches, the phone's last cell for where you are, and the saved
/// places' bells (phase 8.4b; none before), as the app keeps them, `{ "v": 2, "prefs", "here"?,
/// "bells" }`. Read leniently: a `here` that isn't a cell on Earth, and a bell that isn't text,
/// are dropped, and the rest kept. Nothing stored, another version (8.1's `alerts.v1` is never
/// read), or switches that don't read are every switch off and nothing kept.
public struct AlertSettings: Sendable, Equatable {
  /// The version this app writes and reads.
  public static let version = 2

  public var v: Int
  public var prefs: AlertPrefs
  /// The phone's last cell, only while location access is allowed (`HerePlace.cell`).
  public var here: KeptCell?
  /// The saved places with notifications on, by `Target.key`, in saved order (phase 8.4b).
  public var bells: [String]

  public init(prefs: AlertPrefs = AlertPrefs(), here: KeptCell? = nil, bells: [String] = []) {
    v = Self.version
    self.prefs = prefs
    self.here = here
    self.bells = bells
  }

  /// A notification is switched on: evening or morning ("also when snow is possible" alone
  /// switches nothing on).
  public var anyOn: Bool { prefs.evening || prefs.morning }

  /// The settings as `alerts.v2` keeps them (`ApiJSON.encoder()`), `here` left out while none.
  public func stored() throws -> Data {
    try ApiJSON.encoder().encode(self)
  }

  /// What `alerts.v2` holds, read leniently, or every switch off and nothing kept.
  public init(stored data: Data?) {
    guard let data, let settings = try? ApiJSON.decoder().decode(Self.self, from: data),
      settings.v == Self.version
    else {
      self.init()
      return
    }
    self = settings
  }
}

extension AlertSettings: Codable {
  private enum CodingKeys: String, CodingKey {
    case v, prefs, here, bells
  }

  /// A list's item, or nil for one that isn't text.
  private struct Bell: Decodable {
    let key: String?

    init(from decoder: any Decoder) throws {
      key = try? decoder.singleValueContainer().decode(String.self)
    }
  }

  /// The version and the switches strictly, the rest leniently: a `here` that isn't a cell on
  /// Earth is none, and a bell that isn't text is dropped, as is a list of bells that isn't one.
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    v = try container.decode(Int.self, forKey: .v)
    prefs = try container.decode(AlertPrefs.self, forKey: .prefs)
    let cell = (try? container.decodeIfPresent(KeptCell.self, forKey: .here)) ?? nil
    here = cell?.onEarth == true ? cell : nil
    let bells = (try? container.decodeIfPresent([Bell].self, forKey: .bells)) ?? nil
    self.bells = bells?.compactMap(\.key) ?? []
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(v, forKey: .v)
    try container.encode(prefs, forKey: .prefs)
    try container.encodeIfPresent(here, forKey: .here)
    try container.encode(bells, forKey: .bells)
  }
}

extension AlertSync {
  /// Where you are (client `herePlace`), from the phone's location access, this launch's fix and
  /// the cell kept from an earlier one: the phone's cell while access is allowed and there is a
  /// fix, else the kept cell; otherwise approximate. A fix that isn't the phone's own (a device
  /// point), or a point that isn't on Earth, is no fix. The cell is on the grid and carries
  /// nothing else, so nothing finer leaves the phone.
  public static func here(access: LocationAccess, fix: Target?, kept: KeptCell?) -> HerePlace {
    guard access == .granted else { return .ip }
    var found: KeptCell?
    if case .coords(let point)? = fix, point.source == .device {
      found = KeptCell(lat: point.lat, lon: point.lon)
    }
    guard let cell = [found, kept].lazy.compactMap({ $0 }).first(where: \.onEarth),
      case .coords(let point) = Target.device(lat: cell.lat, lon: cell.lon)
    else { return .ip }
    return .device(point)
  }

  /// How Settings tells where you are (client `HereKind`): the phone's location, approximate,
  /// or not found.
  public enum HereKind: String, Codable, Sendable, CaseIterable {
    case device, ip, unknown
  }

  /// How where you are was found, for Settings' row (client `hereKind`): the phone's location
  /// while its cell is what is sent (`here`); otherwise approximate, unless the server couldn't
  /// tell where the connection is: its last answer had no free place, or it refused the
  /// registration (a 400, `refused`), after which no answer is kept.
  public static func hereKind(here: HerePlace, reply: DeviceResponse?, refused: Bool) -> HereKind {
    if case .device = here { return .device }
    return refused || (reply != nil && reply?.here == nil) ? .unknown : .ip
  }

  /// The town the server named where you are, for Settings' row and the card (client
  /// `hereName`): its last answer's, when that answer is about the kind of place sent now
  /// (`here`); nil before an answer, for one about the other kind, and for a name the server
  /// couldn't give (core's "Your location", or none), which is never shown as a town.
  public static func hereName(here: HerePlace, reply: DeviceResponse?) -> String? {
    guard let found = reply?.here else { return nil }
    switch (found.follows, here) {
    case (.device, .device), (.ip, .ip): break
    default: return nil
    }
    // Compared byte for byte, as JavaScript compares strings.
    let unnamed = found.name.isEmpty || found.name.utf8.elementsEqual(CoreCopy.yourLocation.utf8)
    return unnamed ? nil : found.name
  }

  /// The switches once `which` is set to `on` (client `setAlert`). "Also when snow is possible"
  /// only widens the other two: it can't be turned on while both are off, and turning the second
  /// of them off turns it off too, so what the app keeps is what the server holds.
  public static func setting(_ prefs: AlertPrefs, _ which: AlertSwitch, on: Bool) -> AlertPrefs {
    var next = prefs
    if which == .possible, on, !next.evening, !next.morning { return next }
    switch which {
    case .evening: next.evening = on
    case .morning: next.morning = on
    case .possible: next.possible = on
    }
    if !next.evening, !next.morning { next.possible = false }
    return next
  }
}
