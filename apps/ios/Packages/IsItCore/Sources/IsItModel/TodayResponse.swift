import Foundation

/// The answer from `GET /api/v1/today` (core `TodayResponse`), as far as the snow app reads it.
/// The hot, rain and wind blocks aren't decoded, and fields the app doesn't know are ignored.
public struct TodayResponse: Codable, Sendable, Equatable {
  public let location: ApiLocation
  public let units: Units
  /// When the forecast behind the answer was fetched.
  public let updatedAt: Date
  /// `updatedAt` at the place, for the "Updated" line.
  @Lenient public var updated: ApiUpdated?
  /// Credits, shown as they are (a licence requirement).
  public let attribution: [String]
  /// True when upstream failed and this is a cached answer under 6 hours old.
  public let stale: Bool?
  /// The nearest city pages.
  @Lenient public var nearby: [NearbyCity]?
  /// The links out to the big forecast sites for the place, for the footer.
  @Lenient public var links: [OutboundLink]?
  @Lenient public var snow: ApiSnow?
}

/// Where the answer is for (core `ApiLocation`).
public struct ApiLocation: Codable, Sendable, Equatable {
  public let name: String
  public let region: String?
  /// ISO 3166-1 alpha-2.
  public let country: String?
  public let lat: Double
  public let lon: Double
  /// The place's IANA time zone, which every local date and hour in the answer is in.
  public let timezone: String
  public let source: LocationSource
  /// The city page's slug, for a place in the city list.
  public let slug: String?
  public let geonameId: Int?
  /// The place's height, whole metres, when known.
  public let elevation: Int?
}

/// When the forecast was fetched, at the place (core `ApiUpdated`).
public struct ApiUpdated: Codable, Sendable, Equatable {
  /// The place's local date then (YYYY-MM-DD).
  public let date: String
  /// "3:05pm GMT"
  public let clock: String
}

/// A city page near the place.
public struct NearbyCity: Codable, Sendable, Equatable {
  public let slug: String
  public let name: String
}

/// "BBC Weather" and its page for the place: a link only, never fetched.
public struct OutboundLink: Codable, Sendable, Equatable {
  public let name: String
  public let url: URL
}

extension TodayResponse {
  /// Decodes the body of `/api/v1/today` as the server sends it.
  public static func decode(from data: Data) throws -> TodayResponse {
    try ApiJSON.decoder().decode(TodayResponse.self, from: data)
  }
}
