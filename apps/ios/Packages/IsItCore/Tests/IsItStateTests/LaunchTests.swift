import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItTestSupport
import Testing

/// aberdeen-snow, saved as fetched at `savedAt` (its own moment, 9:05am on 2 December 2026, by
/// default) for its place.
func savedAberdeen(at savedAt: Date? = nil) throws -> SavedToday {
  let response = try fixture("aberdeen-snow")
  return SavedToday(
    key: "city:aberdeen-gb", savedAt: savedAt ?? response.updatedAt, response: response)
}

/// A fixture's answer with its JSON changed by `edit` first.
func edited(_ name: String, _ edit: (inout [String: Any]) -> Void) throws -> TodayResponse {
  var json = try #require(JSONSerialization.jsonObject(with: Fixtures.data(name)) as? [String: Any])
  edit(&json)
  return try TodayResponse.decode(from: JSONSerialization.data(withJSONObject: json))
}

let aberdeen = Target.city(slug: "aberdeen-gb", name: "Aberdeen")

@Suite("Whether the saved answer paints at once")
struct PaintTests {
  @Test("for its place, while it has an hour to show, up to the end of its last")
  func paints() throws {
    let saved = try savedAberdeen()
    let until = Freshness.usableUntil(saved.response)
    #expect(Launch.paints(saved, target: aberdeen, units: .c, at: saved.savedAt))
    #expect(Launch.paints(saved, target: .city(slug: "aberdeen-gb"), units: nil, at: saved.savedAt))
    #expect(Launch.paints(saved, target: aberdeen, units: .c, at: until.addingTimeInterval(-0.001)))
    #expect(!Launch.paints(saved, target: aberdeen, units: .c, at: until))
  }

  @Test("not for another place, nor a key that is only canonically the same")
  func otherPlaces() throws {
    let saved = try savedAberdeen()
    #expect(!Launch.paints(saved, target: .city(slug: "leeds-gb"), units: .c, at: saved.savedAt))
    #expect(!Launch.paints(saved, target: .ip, units: .c, at: saved.savedAt))
    let composed = SavedToday(
      key: "city:caf\u{E9}", savedAt: saved.savedAt, response: saved.response)
    let decomposed = Target.city(slug: "cafe\u{301}")
    #expect(composed.key == decomposed.key)  // Swift's == takes them as the same
    #expect(!Launch.paints(composed, target: decomposed, units: .c, at: saved.savedAt))
  }

  @Test("not in other units than those asked for")
  func otherUnits() throws {
    let saved = try savedAberdeen()
    #expect(!Launch.paints(saved, target: aberdeen, units: .f, at: saved.savedAt))
  }

  @Test("not when its forecast is older than the server's stale limit")
  func oldForecast() throws {
    let response = try fixture("old-forecast")
    let saved = SavedToday(key: "city:durham-gb", savedAt: response.updatedAt, response: response)
    let durham = Target.city(slug: "durham-gb")
    #expect(Launch.paints(saved, target: durham, units: .c, at: response.updatedAt))
    #expect(!Launch.paints(saved, target: durham, units: .c, at: try fixtureNow("old-forecast")))
  }
}

@Suite("Whether the saved answer is kept without asking again")
struct ReuseTests {
  @Test("under 10 minutes after it was fetched, and not from 10 minutes on")
  func tenMinutes() throws {
    let saved = try savedAberdeen()
    let at = { (ms: Int) in Date(epochMs: saved.savedAt.epochMs + ms) }
    #expect(Launch.reuses(saved, at: at(0)))
    #expect(Launch.reuses(saved, at: at(599_999)))
    #expect(!Launch.reuses(saved, at: at(600_000)))
  }

  @Test("not when fetched after now, the clock having moved back")
  func clockBack() throws {
    let saved = try savedAberdeen()
    #expect(!Launch.reuses(saved, at: saved.savedAt.addingTimeInterval(-0.001)))
  }

  @Test("not once out of date, however recent")
  func outOfDate() throws {
    // Saved at 9:58, and opened at 10:01, past the hour today's answer holds for.
    let saved = try savedAberdeen(at: try fixtureNow("aberdeen-snow").addingTimeInterval(53 * 60))
    #expect(!Launch.reuses(saved, at: saved.savedAt.addingTimeInterval(3 * 60)))
    #expect(Launch.reuses(saved, at: saved.savedAt.addingTimeInterval(60)))
  }
}

@Suite("The launch's plan")
struct LaunchPlanTests {
  @Test("nothing saved: the loading state, and a fetch")
  func nothingSaved() {
    #expect(
      Launch.plan(nil, target: .ip, units: nil, at: Date()) == .init(paint: nil, fetch: .plain))
  }

  @Test("saved for the place a minute ago: painted, and not fetched")
  func reused() throws {
    let saved = try savedAberdeen()
    let plan = Launch.plan(saved, target: aberdeen, units: .c, at: later(saved.savedAt, minutes: 1))
    #expect(plan == .init(paint: saved, fetch: nil))
  }

  @Test("saved for the place a quarter of an hour ago: painted, then fetched")
  func refreshed() throws {
    let saved = try savedAberdeen()
    let plan = Launch.plan(
      saved, target: aberdeen, units: .c, at: later(saved.savedAt, minutes: 15))
    #expect(plan == .init(paint: saved, fetch: .plain))
  }

  @Test("saved for the place, but out of date: painted, then fetched past the caches")
  func outOfDate() throws {
    let saved = try savedAberdeen()
    let plan = Launch.plan(
      saved, target: aberdeen, units: .c, at: later(saved.savedAt, minutes: 56))
    #expect(plan == .init(paint: saved, fetch: .fresh))
  }

  @Test("saved for another place: the loading state, and a plain fetch")
  func otherPlace() throws {
    let saved = try savedAberdeen()
    let plan = Launch.plan(saved, target: .ip, units: .c, at: later(saved.savedAt, minutes: 56))
    #expect(plan == .init(paint: nil, fetch: .plain))
  }
}

/// The app's first run (phase 8.3), which shows no full-screen ad: no answer kept from an earlier
/// launch.
@Suite("Whether this is the app's first run")
struct FirstRunTests {
  @Test("nothing kept, or only a place and units: a first run; an answer kept: not")
  func firstRun() throws {
    #expect(Launch.firstRun(FakeState()))
    #expect(Launch.firstRun(FakeState(.init(place: aberdeen, units: .c))))
    let saved = try savedAberdeen()
    #expect(!Launch.firstRun(FakeState(.init(place: aberdeen, units: .c, today: saved))))
  }
}
