import Foundation
import IsItModel

/// The place picker's search box (iOS build spec, section 10.3): what a search asks for, and the
/// line under a result. The port of client `search.ts`, checked against `search.json`.
public enum PlaceSearch {
  /// What the search box holds (client `SearchInput`).
  public enum Input: Sendable, Equatable {
    /// Nothing to search for: the box is empty, or holds only spaces.
    case empty
    /// Too few letters: "Type at least 2 letters." (`CoreCopy.searchTooShort`).
    case tooShort
    /// A search for this text, without the spaces around it.
    case search(String)
  }

  /// What a search box holding `text` asks for (client `searchInput`): the text trimmed as
  /// JavaScript trims it, and searched for from `Constants.Search.minChars` letters, counted as
  /// JavaScript counts a string's length (UTF-16 code units), as the server counts them.
  public static func input(_ text: String) -> Input {
    let q = JavaScriptString.trimmed(text)
    let length = JavaScriptString.length(q)
    if length >= Constants.Search.minChars { return .search(q) }
    return length > 0 ? .tooShort : .empty
  }

  /// The line under a result's name (client `resultDetail`): its region and country, "England,
  /// United Kingdom". The country's name, or its code without one; what is missing or empty is
  /// left out, and an empty name is kept over the code, as `??` keeps it.
  public static func detail(_ result: SearchResult) -> String {
    [result.region, result.countryName ?? result.country]
      .compactMap { $0 }
      .filter { !$0.isEmpty }
      .joined(separator: ", ")
  }

  /// A result's line as a row shows it and a recent or saved place keeps it: `detail(_:)`, or
  /// nil when it has neither region nor country, so no row draws an empty line.
  public static func line(_ result: SearchResult) -> String? {
    let line = detail(result)
    return line.isEmpty ? nil : line
  }
}

extension PlaceSearch.Input: Decodable {
  private enum CodingKeys: String, CodingKey {
    case kind, q
  }

  private enum Kind: String, Decodable {
    case empty, tooShort, search
  }

  /// The client's JSON: `{ kind: "empty" }`, `{ kind: "tooShort" }` or `{ kind: "search", q }`.
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .kind) {
    case .empty: self = .empty
    case .tooShort: self = .tooShort
    case .search: self = .search(try container.decode(String.self, forKey: .q))
    }
  }
}
