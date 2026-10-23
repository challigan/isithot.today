import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

extension VectorPort {
  /// `widget.json`: client `widgetEntries`, ported as `WidgetPlanner.entries`, for section 6.5's
  /// clocks across the fixtures, locked, stale and with no answer, and without hours ahead or
  /// snow's tomorrow (`in.without`). Each entry's `day` is named by its path in the fixture, so it
  /// is read back from there and compared whole; every other field is compared as it is.
  static let widget = VectorPort { file in
    let answers = FixtureAnswers()

    struct Plan: Decodable, Sendable, CustomStringConvertible {
      let fixture: String?
      let without: [String]?
      let fetchedAt: Int
      let now: Int
      let unlocked: Bool
      let placeName: String?

      var description: String {
        let answer = fixture.map { name in
          without.map { "\(name) without \($0.joined(separator: ", "))" } ?? name
        }
        return "\(answer ?? "no answer") at \(now), fetched \(fetchedAt), "
          + (unlocked ? "unlocked" : "locked") + (placeName.map { ", named \($0)" } ?? "")
      }
    }
    struct Now: Decodable, Sendable {
      let answer: String
      let verdict: String
      let band: SnowBand
    }
    struct Day: Decodable, Sendable {
      let date: String
      let label: String
      let band: SnowBand
      let bandLabel: String
      let amount: Double
      let snowy: Int?
      let total: Int?
    }
    struct Entry: Decodable, Sendable {
      let date: Int
      let state: WidgetEntry.State
      let placeName: String
      let slot: MiddleDay.Slot
      let day: String?
      let now: Now?
      let week: [Day]
      let palette: SnowBand
    }
    /// A moment in epoch milliseconds, or "never".
    enum Reload: Decodable, Sendable, Equatable {
      case never
      case after(Int)

      init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let at = try? container.decode(Int.self) {
          self = .after(at)
        } else if try container.decode(String.self) == "never" {
          self = .never
        } else {
          throw DecodingError.dataCorruptedError(
            in: container, debugDescription: "Not a reload: a moment or never")
        }
      }
    }
    struct Planned: Decodable, Sendable {
      let entries: [Entry]
      let reloadAt: Reload
    }

    try file.forEachCase("widgetEntries", input: Plan.self, output: Planned.self) { item in
      let input = item.input
      let label = "widget.json case \(item.index): widgetEntries(\(input))"
      let res = try input.fixture.map { try answers($0, without: input.without ?? []) }
      let plan = WidgetPlanner.entries(
        res,
        fetchedAt: Date(epochMs: input.fetchedAt),
        now: Date(epochMs: input.now),
        unlocked: input.unlocked,
        placeName: input.placeName
      )
      let reloadAt: Reload =
        switch plan.reloadAt {
        case .never: .never
        case .after(let date): .after(date.epochMs)
        }
      #expect(reloadAt == item.output.reloadAt, "\(label): reloadAt")
      #expect(
        plan.entries.count == item.output.entries.count,
        "\(label): \(plan.entries.count) entries, expected \(item.output.entries.count)")
      for (index, (entry, expected)) in zip(plan.entries, item.output.entries).enumerated() {
        let at = "\(label): entry \(index)"
        let day = try input.fixture.flatMap {
          try Fixtures.object(ApiSnowDay.self, at: expected.day, in: $0)
        }
        let now = expected.now.map {
          WidgetEntry.Now(answer: $0.answer, verdict: $0.verdict, band: $0.band)
        }
        let week = expected.week.map {
          WidgetDay(
            date: $0.date, label: $0.label, band: $0.band, bandLabel: $0.bandLabel,
            amount: $0.amount, snowy: $0.snowy, total: $0.total)
        }
        #expect(entry.date.epochMs == expected.date, "\(at): date")
        #expect(entry.state == expected.state, "\(at): state")
        #expect(entry.placeName == expected.placeName, "\(at): placeName")
        #expect(entry.slot == expected.slot, "\(at): slot")
        #expect(expected.day == nil || day != nil, "\(at): \(expected.day ?? "") in no answer")
        #expect(entry.day == day, "\(at): day, \(expected.day ?? "nil")")
        #expect(entry.now == now, "\(at): now")
        #expect(entry.week == week, "\(at): week")
        #expect(entry.palette == expected.palette, "\(at): palette")
        // The reference's text, code unit for code unit.
        #expect(
          sameText(entry.placeName, expected.placeName) && sameText(entry.day as Any, day as Any)
            && sameText(entry.now as Any, now as Any) && sameText(entry.week, week),
          "\(at): text")
      }
    }
  }
}
