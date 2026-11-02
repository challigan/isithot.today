import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

/// Durham's zone, by its key, as a registration for Durham gives it.
private let durhamZone = ["city:durham-gb": "Europe/London"]

/// Durham's page, named as the notification names it.
private let durham = Target.city(slug: "durham-gb", name: "Durham")

/// A notification's tap to where the app opens (section 12.3), from the payloads the server's
/// own `alertPush()` makes.
@Suite("Notification taps, from the payload's JSON")
struct NotificationRouterTests {
  /// 6:05pm in London on 16 December 2026, durham-tomorrow's moment: the evening before.
  let evening = Date(epochMs: 1_797_444_300_000)

  @Test("the evening's payload opens Durham on its day, until that day has passed there")
  func routesTheServersPayload() throws {
    let json = try Fixtures.payload("durham-evening")
    #expect(try Fixtures.info("durham-tomorrow").now == "2026-12-16T18:05:00.000Z")
    #expect(
      NotificationRouter.route(json: json, now: evening, zones: durhamZone)
        == .place(durham, view: .today))
    // 9am on the 18th: the 17th has passed in Durham, so the place's view for the time of day.
    let after = Date(epochMs: 1_797_584_400_000)
    #expect(
      NotificationRouter.route(json: json, now: after, zones: durhamZone)
        == .place(durham, view: nil))
  }

  @Test("a payload with its aps, as the system hands it over, routes as its fields do")
  func aPayloadWithApsRoutesAsItsFields() throws {
    let payload = try #require(
      try JSONSerialization.jsonObject(with: Fixtures.payload("durham-evening")) as? [String: Any])
    #expect(payload["aps"] != nil)
    var bare = payload
    bare["aps"] = nil
    let withAps = try JSONSerialization.data(withJSONObject: payload)
    let without = try JSONSerialization.data(withJSONObject: bare)
    let route = NotificationRouter.route(json: withAps, now: evening, zones: durhamZone)
    #expect(route == .place(durham, view: .today))
    #expect(NotificationRouter.route(json: without, now: evening, zones: durhamZone) == route)
  }

  @Test("a place with no zone known is taken as current")
  func noZoneIsTakenAsCurrent() throws {
    let json = try Fixtures.payload("durham-evening")
    // Noon on 20 December, three days after the payload's day.
    let later = Date(epochMs: 1_797_768_000_000)
    #expect(
      NotificationRouter.route(json: json, now: later, zones: [:]) == .place(durham, view: .today))
    #expect(
      NotificationRouter.route(json: json, now: later, zones: ["city:leeds-gb": "Europe/London"])
        == .place(durham, view: .today))
    #expect(
      NotificationRouter.route(json: json, now: later, zones: durhamZone)
        == .place(durham, view: nil))
  }

  @Test("an old payload opens on the place's view for the time of day")
  func anOldPayloadOpensOnTheDefault() throws {
    let json = try Fixtures.payload("durham-old")
    #expect(
      NotificationRouter.route(json: json, now: evening, zones: durhamZone)
        == .place(durham, view: nil))
  }

  @Test(
    "no route for no JSON, JSON that isn't an object, or a payload the rule refuses",
    arguments: ["[]", "not json", "", "\"snow\"", "{}"])
  func nothingForNoJSON(_ text: String) throws {
    #expect(NotificationRouter.route(json: Data(text.utf8), now: evening, zones: durhamZone) == nil)
    #expect(NotificationRouter.route(json: nil, now: evening, zones: durhamZone) == nil)
    let malformed = try Fixtures.payload("malformed")
    #expect(NotificationRouter.route(json: malformed, now: evening, zones: durhamZone) == nil)
    #expect(NotificationRouter.route(json: malformed, now: evening, zones: [:]) == nil)
  }
}
