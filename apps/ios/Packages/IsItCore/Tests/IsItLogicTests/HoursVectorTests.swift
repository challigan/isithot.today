import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

extension VectorPort {
  /// `hours.json`: client `pickHour` and `middleDay`, ported as `HourPicker.pick` and
  /// `MiddleDay`, at each minute boundary of a fixture's hours, with clocks behind its first
  /// hour and past its last, and through the evening, and without hours ahead or snow
  /// (`in.without`); and client `updatedLine`, ported as
  /// `UpdatedLine.text`. Where the reference returns one of the answer's own objects, the vector
  /// names its path in the fixture, so each is read back from there and compared whole.
  static let hours = VectorPort { file in
    let answers = FixtureAnswers()

    struct Picked: Decodable, Sendable {
      let start: Int?
      let end: Int
      let now: String?
      let today: String?
      let week: String?
      let source: PickedHour.Source
    }
    try file.forEachCase("pickHour", input: FixtureAt.self, output: Picked?.self) { item in
      let name = item.input.fixture
      let label = "hours.json case \(item.index): pickHour(\(item.input))"
      let res = try answers(item.input)
      let picked = HourPicker.pick(res, at: Date(epochMs: item.input.now))
      guard let expected = item.output else {
        #expect(picked == nil, "\(label)")
        return
      }
      guard let picked else {
        Issue.record("\(label): nil, expected \(expected)")
        return
      }
      let now = try Fixtures.object(ApiSnowNow.self, at: expected.now, in: name)
      let today = try Fixtures.object(ApiSnowDay.self, at: expected.today, in: name)
      let week = try Fixtures.object(ApiSnowWeek.self, at: expected.week, in: name)
      #expect(picked.start?.epochMs == expected.start, "\(label): start")
      #expect(picked.end.epochMs == expected.end, "\(label): end")
      #expect(picked.source == expected.source, "\(label): source")
      #expect(picked.now == now, "\(label): now, \(expected.now ?? "nil")")
      #expect(picked.today == today, "\(label): today, \(expected.today ?? "nil")")
      #expect(picked.week == week, "\(label): week, \(expected.week ?? "nil")")
      #expect(
        sameText(picked.now as Any, now as Any) && sameText(picked.today as Any, today as Any)
          && sameText(picked.week as Any, week as Any),
        "\(label): text")
      // An hour ahead's objects are its own: the path's index is the hour picked.
      for path in [expected.now, expected.today, expected.week].compactMap({ $0 }) {
        let parts = path.split(separator: ".")
        if parts.count > 2, parts[1] == "ahead", let index = Int(parts[2]) {
          let ahead = res.snow?.ahead ?? []
          let start = ahead.indices.contains(index) ? ahead[index].time : nil
          #expect(picked.start == start, "\(label): \(path) is the hour picked")
        } else {
          #expect(picked.source == .response, "\(label): \(path) is the answer's own")
        }
      }
    }

    struct Middle: Decodable, Sendable {
      let slot: MiddleDay.Slot
      let day: String?
    }
    try file.forEachCase("middleDay", input: FixtureAt.self, output: Middle.self) { item in
      let name = item.input.fixture
      let label = "hours.json case \(item.index): middleDay(\(item.input))"
      let res = try answers(item.input)
      let now = Date(epochMs: item.input.now)
      // As in the vectors, the hour picked is pickHour's for the same answer and moment.
      let picked = try #require(HourPicker.pick(res, at: now), "\(label): no hour picked")
      let middle = MiddleDay(res, picked: picked, at: now)
      let day = try Fixtures.object(ApiSnowDay.self, at: item.output.day, in: name)
      #expect(middle.slot == item.output.slot, "\(label): slot")
      #expect(middle.day == day, "\(label): day, \(item.output.day ?? "nil")")
      #expect(sameText(middle.day as Any, day as Any), "\(label): day's text")
      #expect(
        middle.label == MiddleDay.label(.today, tomorrow: item.output.slot == .tomorrow),
        "\(label): label")
    }

    struct Updated: Decodable, Sendable, CustomStringConvertible {
      let updated: ApiUpdated
      let today: String

      var description: String { "\(updated.date) \(updated.clock), today \(today)" }
    }
    try file.compare("updatedLine", input: Updated.self, output: String.self) {
      UpdatedLine.text($0.updated, today: $0.today)
    }
  }
}
