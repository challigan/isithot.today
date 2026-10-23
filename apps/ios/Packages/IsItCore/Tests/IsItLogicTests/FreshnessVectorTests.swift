import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

/// Holds as the vectors write them (client `Holds`): moments in epoch milliseconds, and a
/// reason left out when there is no hold for it.
struct VectorHolds: Codable, Sendable, Equatable, CustomStringConvertible {
  struct Hold: Codable, Sendable, Equatable {
    let until: Int
    let at: Int
  }

  let day: Hold?
  let hour: Hold?

  init(_ holds: Freshness.Holds) {
    day = holds.day.map { Hold(until: $0.until.epochMs, at: $0.at.epochMs) }
    hour = holds.hour.map { Hold(until: $0.until.epochMs, at: $0.at.epochMs) }
  }

  var holds: Freshness.Holds {
    func hold(_ hold: Hold?) -> Freshness.Hold? {
      hold.map { Freshness.Hold(until: Date(epochMs: $0.until), at: Date(epochMs: $0.at)) }
    }
    return Freshness.Holds(day: hold(day), hour: hold(hour))
  }

  var description: String {
    let held = [("day", day), ("hour", hour)].compactMap { name, hold in
      hold.map { "\(name): until \($0.until), at \($0.at)" }
    }
    return "{\(held.joined(separator: "; "))}"
  }
}

extension VectorPort {
  /// `freshness.json`: client `hourUntil`, `dayUntil`, `usableUntil`, `hold`, `outOfDate` and
  /// `nextRefreshAt`, ported as `Freshness`, with clocks slow and fast, either side of each
  /// boundary, and holds kept from before; and for the fallbacks, answers without rain, snow,
  /// their Nows, the hours ahead or the hot Now (`in.without`).
  static let freshness = VectorPort { file in
    let answers = FixtureAnswers()
    try file.compare("hourUntil", input: FixtureOnly.self, output: Int?.self) {
      Freshness.hourUntil(try answers($0))?.epochMs
    }
    try file.compare("dayUntil", input: FixtureOnly.self, output: Int?.self) {
      Freshness.dayUntil(try answers($0))?.epochMs
    }
    try file.compare("usableUntil", input: FixtureOnly.self, output: Int.self) {
      Freshness.usableUntil(try answers($0)).epochMs
    }

    struct WithHolds: Decodable, Sendable, FixtureCase {
      let fixture: String
      let without: [String]?
      let holds: VectorHolds
      let now: Int

      var description: String { "\(answerDescription) at \(now), holds \(holds)" }
    }
    try file.compare("hold", input: WithHolds.self, output: VectorHolds.self) {
      VectorHolds(
        Freshness.hold($0.holds.holds, try answers($0), at: Date(epochMs: $0.now)))
    }
    try file.compare("outOfDate", input: WithHolds.self, output: String?.self) {
      Freshness.outOfDate(
        try answers($0),
        at: Date(epochMs: $0.now),
        holds: $0.holds.holds
      )?.rawValue
    }

    struct Refresh: Decodable, Sendable, FixtureCase {
      let fixture: String
      let without: [String]?
      let now: Int
      let jitterMs: Int

      var description: String { "\(answerDescription) at \(now), jitter \(jitterMs) ms" }
    }
    try file.compare("nextRefreshAt", input: Refresh.self, output: Int.self) {
      Freshness.nextRefreshAt(
        try answers($0),
        after: Date(epochMs: $0.now),
        jitterMs: $0.jitterMs
      ).epochMs
    }
  }
}
