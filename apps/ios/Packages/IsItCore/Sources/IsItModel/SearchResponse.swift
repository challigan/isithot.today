import Foundation

/// The answer from `GET /api/v1/search` (core `SearchResponse`): the places found, best first.
public struct SearchResponse: Codable, Sendable, Equatable {
  public let results: [SearchResult]
}

/// A place the search found (core `SearchResult`). `Target(search:)` makes the place to ask for.
public struct SearchResult: Codable, Sendable, Equatable {
  /// "Leeds"
  public let name: String
  /// "England", when known.
  public let region: String?
  /// ISO 3166-1 alpha-2, when known.
  public let country: String?
  /// "United Kingdom", when known.
  public let countryName: String?
  public let lat: Double
  public let lon: Double
  /// The city page's slug, for a place in the city list.
  public let slug: String?
  public let geonameId: Int?
  /// The place's height, whole metres, when known: the forecast is then for that height.
  public let elevation: Int?
}

extension SearchResponse {
  /// Decodes the body of `/api/v1/search` as the server sends it.
  public static func decode(from data: Data) throws -> SearchResponse {
    try ApiJSON.decoder().decode(SearchResponse.self, from: data)
  }
}
