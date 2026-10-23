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
      TodayQuery.fresh($0.query, now: Date(epochMs: $0.now))
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
  let now: Int
}

/// A `searchQuery` case's input: what was typed.
private struct SearchQueryInput: Decodable, Sendable {
  let q: String
}

/// What the vectors don't reach: a moment between two milliseconds, as the system clock gives
/// one, where the TypeScript only ever has whole milliseconds.
@Suite("A fresh query's hour")
struct FreshQueryTests {
  /// 10:00 UTC on 2 December 2026, hour 498,946 since 1970, in seconds.
  static let ten = 498_946.0 * 3_600

  @Test("is the hour of the moment's nearest millisecond, the hour the clock rules read")
  func nearestMillisecond() {
    // 0.4 ms before ten is ten to the nearest millisecond, which `epochMs`, and so `Freshness`,
    // reads as the hour begun: the fresh query then asks for that hour, not the one before.
    let justBefore = Date(timeIntervalSince1970: Self.ten - 0.000_4)
    #expect(justBefore.epochMs == 1_796_205_600_000)
    #expect(
      TodayQuery.fresh("place=leeds-gb&units=c", now: justBefore)
        == "place=leeds-gb&units=c&t=498946")
    // 0.6 ms before is still the hour before.
    let before = Date(timeIntervalSince1970: Self.ten - 0.000_6)
    #expect(before.epochMs == 1_796_205_599_999)
    #expect(TodayQuery.fresh("", now: before) == "t=498945")
  }
}
