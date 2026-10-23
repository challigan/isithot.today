import Foundation

/// Where an answer is for (client `Target`): approximate IP location, a city page's place, or
/// coordinates, the device's or a searched place's. The app keeps the chosen one in its App Group
/// (`place.v1`) for its widgets, as the client's JSON, so this shape is stored: only ever add
/// optional fields. Checked against `target.json`.
public enum Target: Sendable, Hashable {
  /// Approximate IP location: the server works out where from the request.
  case ip
  /// A city page's place, by its slug ("leeds-gb"), with its name when known.
  case city(slug: String, name: String? = nil)
  /// Coordinates on the forecast grid: the device's, or a searched place's.
  case coords(Coordinates)

  /// A target's coordinates, and what a search said about the place.
  public struct Coordinates: Codable, Sendable, Hashable {
    /// Whose coordinates: the device's, or a searched place's.
    public enum Source: String, Codable, Sendable, CaseIterable {
      case device, search
    }

    public var source: Source
    public var lat: Double
    public var lon: Double
    public var name: String?
    public var region: String?
    /// ISO 3166-1 alpha-2.
    public var country: String?
    public var geonameId: Int?
    /// A searched place's height in metres, when the search knew it. Whole metres from a search;
    /// a query can carry a fraction, which is kept as the reference keeps it.
    public var elevation: Double?

    public init(
      source: Source,
      lat: Double,
      lon: Double,
      name: String? = nil,
      region: String? = nil,
      country: String? = nil,
      geonameId: Int? = nil,
      elevation: Double? = nil
    ) {
      self.source = source
      self.lat = lat
      self.lon = lon
      self.name = name
      self.region = region
      self.country = country
      self.geonameId = geonameId
      self.elevation = elevation
    }
  }
}

extension Target {
  /// One key per place (client `targetKey`), for whether a saved answer or a recent place is for
  /// the same one: "ip", "city:leeds-gb", "device:53.8,-1.55".
  public var key: String {
    switch self {
    case .ip:
      "ip"
    case .city(let slug, _):
      "city:\(slug)"
    case .coords(let place):
      "\(place.source.rawValue):\(JavaScriptNumber.string(place.lat)),"
        + JavaScriptNumber.string(place.lon)
    }
  }

  /// The device's location, rounded to the forecast grid before it goes anywhere (client
  /// `deviceTarget`).
  public static func device(lat: Double, lon: Double) -> Target {
    .coords(
      Coordinates(
        source: .device,
        lat: GridRounding.round(lat, step: Constants.Grid.forecast),
        lon: GridRounding.round(lon, step: Constants.Grid.forecast)
      ))
  }

  /// A search result's place (client `searchTarget`): its city page's, when it has one, else its
  /// coordinates on the forecast grid, with what the search said about it.
  public init(search result: SearchResult) {
    if let slug = result.slug, !slug.isEmpty {
      self = .city(slug: slug, name: result.name)
      return
    }
    self = .coords(
      Coordinates(
        source: .search,
        lat: GridRounding.round(result.lat, step: Constants.Grid.forecast),
        lon: GridRounding.round(result.lon, step: Constants.Grid.forecast),
        name: result.name,
        region: result.region,
        country: result.country,
        geonameId: result.geonameId,
        elevation: result.elevation.map(Double.init)
      ))
  }

  /// The place a today query asks about (client `targetFromQuery`: `TodayQuery.build`'s place
  /// part, read back), read as the server reads it: coordinates when the query has any, else a
  /// city, else approximate IP location. Nil when the coordinates or the city are malformed. A
  /// notification carries its place this way.
  public init?(query: String) {
    let params = URLSearchParams(query)
    if params.has("lat") || params.has("lon") {
      guard let lat = Self.number(params.get("lat"), whole: 3, fraction: true),
        let lon = Self.number(params.get("lon"), whole: 3, fraction: true),
        lat.magnitude <= 90, lon.magnitude <= 180
      else { return nil }
      // Compared byte for byte, as JavaScript compares strings.
      let searched = params.get("source")?.utf8.elementsEqual("search".utf8) == true
      var place = Coordinates(source: searched ? .search : .device, lat: lat, lon: lon)
      if let name = params.get("name"), !name.isEmpty { place.name = name }
      if let region = params.get("region"), !region.isEmpty { place.region = region }
      if let country = params.get("country"), !country.isEmpty { place.country = country }
      let geonameId = Self.number(params.get("geonameId"), whole: 10, signed: false)
      if let geonameId, geonameId != 0 { place.geonameId = Int(geonameId) }
      place.elevation = Self.number(params.get("elevation"), whole: 4, fraction: true)
      self = .coords(place)
    } else if params.has("place") {
      guard let slug = params.get("place"), !slug.isEmpty else { return nil }
      self = .city(slug: slug)
    } else {
      self = .ip
    }
  }

  /// `value` as a number when it passes the server's check on it, nil otherwise: an optional
  /// "-" (when `signed`), one to `whole` ASCII digits, and, when `fraction` allows one, a point
  /// and at least one digit; the whole value, nothing more (`/^-?\d{1,3}(\.\d+)?$/`, say).
  private static func number(
    _ value: String?,
    whole: Int,
    signed: Bool = true,
    fraction: Bool = false
  ) -> Double? {
    guard let value else { return nil }
    let bytes = Array(value.utf8)
    let isDigit = { (byte: UInt8) in (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(byte) }
    var index = 0
    if signed, bytes.first == UInt8(ascii: "-") { index += 1 }
    let wholeStart = index
    while index < bytes.count, isDigit(bytes[index]) { index += 1 }
    guard (1...whole).contains(index - wholeStart) else { return nil }
    if index < bytes.count {
      guard fraction, bytes[index] == UInt8(ascii: ".") else { return nil }
      index += 1
      let fractionStart = index
      while index < bytes.count, isDigit(bytes[index]) { index += 1 }
      guard index > fractionStart, index == bytes.count else { return nil }
    }
    // Swift reads a decimal to the nearest double, as JavaScript's Number does.
    return Double(value)
  }
}

extension Target: Codable {
  private enum CodingKeys: String, CodingKey {
    case kind, slug, name
  }

  private enum Kind: String, Codable {
    case ip, city, coords
  }

  /// The client's JSON: `{ kind: "ip" }`, `{ kind: "city", slug, name? }`, or `{ kind: "coords",
  /// source, lat, lon, name?, region?, country?, geonameId?, elevation? }`. A field that is null
  /// reads as one that is absent, as every rule treats them.
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .kind) {
    case .ip:
      self = .ip
    case .city:
      self = .city(
        slug: try container.decode(String.self, forKey: .slug),
        name: try container.decodeIfPresent(String.self, forKey: .name)
      )
    case .coords:
      self = .coords(try Coordinates(from: decoder))
    }
  }

  /// Leaves out what is nil, as the client's JSON does what is undefined.
  public func encode(to encoder: any Encoder) throws {
    switch self {
    case .ip:
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode(Kind.ip, forKey: .kind)
    case .city(let slug, let name):
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode(Kind.city, forKey: .kind)
      try container.encode(slug, forKey: .slug)
      try container.encodeIfPresent(name, forKey: .name)
    case .coords(let place):
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode(Kind.coords, forKey: .kind)
      try place.encode(to: encoder)
    }
  }
}

extension Target {
  /// The target as `place.v1` keeps it for the app's widgets and App Intent (iOS build spec,
  /// section 9.6): its JSON, or nil for approximate IP location, which is kept as no value.
  public func stored() throws -> Data? {
    if case .ip = self { return nil }
    return try JSONEncoder().encode(self)
  }

  /// The target `place.v1` keeps: approximate IP location when it holds nothing, or nothing that
  /// reads as a target, as the website reads its own.
  public init(stored data: Data?) {
    self = data.flatMap { try? JSONDecoder().decode(Target.self, from: $0) } ?? .ip
  }
}
