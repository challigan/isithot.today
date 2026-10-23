import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

/// The footer's line for an answer at a moment: `UpdatedLine.text` with the place's date then
/// (the vectors check the rule itself, in `hours.json`).
@Suite("The Updated line at a moment")
struct UpdatedLineTests {
  @Test("on the day it was fetched, then yesterday's, at the place")
  func atMoment() throws {
    let answers = FixtureAnswers()
    let aberdeen = try answers("aberdeen-snow")
    #expect(UpdatedLine.text(for: aberdeen, at: aberdeen.updatedAt) == "9:05am GMT")
    let midnight = try #require(Freshness.dayUntil(aberdeen))
    #expect(
      UpdatedLine.text(for: aberdeen, at: midnight.addingTimeInterval(-60)) == "9:05am GMT")
    #expect(UpdatedLine.text(for: aberdeen, at: midnight) == "yesterday, 9:05am GMT")
    // Kathmandu's midnight is 18:15 UTC.
    let kathmandu = try answers("kathmandu-0545")
    let updated = try #require(kathmandu.updated)
    let late = try #require(Freshness.dayUntil(kathmandu))
    #expect(UpdatedLine.text(for: kathmandu, at: late) == "yesterday, \(updated.clock)")
  }

  @Test("an answer without the Updated parts has no line")
  func withoutUpdated() throws {
    var json = try #require(
      JSONSerialization.jsonObject(with: Fixtures.data("leeds-dry")) as? [String: Any])
    json["updated"] = nil
    let response = try TodayResponse.decode(from: JSONSerialization.data(withJSONObject: json))
    #expect(UpdatedLine.text(for: response, at: response.updatedAt) == nil)
  }
}
