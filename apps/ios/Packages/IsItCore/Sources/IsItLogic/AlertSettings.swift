import Foundation
import IsItModel

/// One of the three notification switches (Settings → Notifications, section 12.1): the evening
/// before, on the day, and also when snow is possible (client `AlertSwitch`).
public enum AlertSwitch: String, Codable, Sendable, CaseIterable {
  case evening, morning, possible
}

/// Where the notifications are for (client `AlertPlace`): a place chosen and fixed, which never
/// follows browsing, so checking a holiday town never moves them; or the phone's location, the
/// 0.05° cell it was last in, followed each time the app is opened. Never approximate IP
/// location. As the client's JSON: `{ "follows": false, "target": …, "name": "Leeds" }` or
/// `{ "follows": true, "target": … }`.
public enum AlertPlace: Sendable, Equatable {
  /// A place chosen and fixed, under its name as the app showed it ("Leeds"), or "" when it had
  /// none.
  case chosen(Target, name: String)
  /// The phone's location: the cell it was last in.
  case follows(Target)

  /// The place to register.
  public var target: Target {
    switch self {
    case .chosen(let target, _), .follows(let target): target
    }
  }
}

extension AlertPlace: Codable {
  private enum CodingKeys: String, CodingKey {
    case follows, target, name
  }

  /// The client's JSON. A place for approximate IP location doesn't read, as none is ever kept.
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let target = try container.decode(Target.self, forKey: .target)
    guard AlertSync.placeAllowed(target) else {
      throw DecodingError.dataCorruptedError(
        forKey: .target, in: container, debugDescription: "Not a notification place: \(target)")
    }
    if try container.decode(Bool.self, forKey: .follows) {
      self = .follows(target)
    } else {
      self = .chosen(target, name: try container.decode(String.self, forKey: .name))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .chosen(let target, let name):
      try container.encode(false, forKey: .follows)
      try container.encode(target, forKey: .target)
      try container.encode(name, forKey: .name)
    case .follows(let target):
      try container.encode(true, forKey: .follows)
      try container.encode(target, forKey: .target)
    }
  }
}

/// `alerts.v1` (spec 9.6): the switches and the place, as the app keeps them. Nothing stored,
/// another version, or anything unreadable is every switch off and no place.
public struct AlertSettings: Codable, Sendable, Equatable {
  /// The version this app writes and reads.
  public static let version = 1

  public var v: Int
  public var prefs: AlertPrefs
  /// Nil until a switch is first turned on.
  public var place: AlertPlace?

  public init(prefs: AlertPrefs = AlertPrefs(), place: AlertPlace? = nil) {
    v = Self.version
    self.prefs = prefs
    self.place = place
  }

  /// A notification is switched on: evening or morning ("also when snow is possible" alone
  /// switches nothing on).
  public var anyOn: Bool { prefs.evening || prefs.morning }

  /// The settings as `alerts.v1` keeps them (`ApiJSON.encoder()`).
  public func stored() throws -> Data {
    try ApiJSON.encoder().encode(self)
  }

  /// What `alerts.v1` holds, or every switch off and no place.
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

/// The place on screen as the notifications' presenters and model take it: AppModel's `target`
/// and `placeName`, the answer's `location.country`, and the units every request asks in (nil
/// before the first answer chose them).
public struct OnScreen: Sendable, Equatable {
  public let target: Target
  public let name: String?
  /// ISO 3166-1 alpha-2, as the answer gives it.
  public let country: String?
  public let units: Units?

  public init(target: Target, name: String?, country: String?, units: Units?) {
    self.target = target
    self.name = name
    self.country = country
    self.units = units
  }
}

extension AlertSync {
  /// The notification place when notifications are first turned on (client `firstAlertPlace`):
  /// the place on screen, chosen and fixed, under `name` ("" without one); the phone's
  /// location, followed, when the screen shows the phone's own place; none for approximate IP
  /// location, which is never a notification place.
  public static func firstPlace(onScreen: Target, name: String?) -> AlertPlace? {
    switch onScreen {
    case .ip:
      return nil
    case .coords(let place) where place.source == .device:
      return .follows(onScreen)
    case .city, .coords:
      return .chosen(onScreen, name: name ?? "")
    }
  }

  /// A place that follows the phone, moved to `fix` when `fix` is the phone's place in another
  /// cell (client `followLocation`); nil when nothing changes: a place chosen and fixed, a fix
  /// that isn't the phone's, or the same cell.
  public static func following(_ place: AlertPlace?, fix: Target) -> AlertPlace? {
    guard case .follows(let target)? = place, case .coords(let point) = fix,
      point.source == .device, fix.key != target.key
    else { return nil }
    return .follows(fix)
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

  /// The notification place's country, for the Met Office's warnings under Settings →
  /// Notifications: a city page's from its slug, the part after its last "-" in capitals
  /// ("leeds-gb" is GB, as every city's slug ends); a searched place's own; the phone's cell's,
  /// the answer on screen's while the screen shows that cell. Nil otherwise, and for none.
  public static func country(of place: AlertPlace?, onScreen: OnScreen) -> String? {
    guard let target = place?.target else { return nil }
    let country: String?
    switch target {
    case .ip:
      country = nil
    case .city(let slug, _):
      country = slug.lastIndex(of: "-").map { slug[slug.index(after: $0)...].uppercased() }
    case .coords(let point) where point.source == .search:
      country = point.country
    case .coords:
      country = onScreen.target.key == target.key ? onScreen.country : nil
    }
    return country?.isEmpty == false ? country : nil
  }
}
