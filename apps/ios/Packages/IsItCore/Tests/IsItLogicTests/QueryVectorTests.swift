import Foundation
import IsItModel
import IsItTestSupport
import Testing

extension VectorPort {
  /// query.json: client `todayQuery` is `TodayQuery.build`, `freshQuery` is `TodayQuery.fresh`
  /// and `searchQuery` is `TodayQuery.search`, each compared byte for byte.
  static let query = VectorPort { file in
    try file.compare("todayQuery", input: TodayInput.self, output: String.self) {
      TodayQuery.build($0.target, units: $0.units, ahead: $0.ahead)
    }
    try file.compare("freshQuery", input: FreshInput.self, output: String.self) {
      TodayQuery.fresh($0.query, now: Date(timeIntervalSince1970: $0.now / 1000))
    }
    try file.compare("searchQuery", input: SearchQueryInput.self, output: String.self) {
      TodayQuery.search($0.q)
    }
  }
}

/// A `todayQuery` case's input. A case with `windUnits`, which the apps never send, would fail:
/// the reference's query would have it, and the port's not.
private struct TodayInput: Decodable, Sendable {
  let target: Target
  let units: Units?
  let ahead: [Topic]
}

/// A `freshQuery` case's input, `now` in epoch milliseconds.
private struct FreshInput: Decodable, Sendable {
  let query: String
  let now: Double
}

/// A `searchQuery` case's input: what was typed.
private struct SearchQueryInput: Decodable, Sendable {
  let q: String
}
