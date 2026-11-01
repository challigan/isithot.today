import Foundation
import IsItLogic
import IsItModel
import IsItServices
import IsItState
import IsItWidgetUI
import WidgetKit
import XCTest

/// What the widget's provider gives WidgetKit (iOS build spec, section 11.2), which no test can
/// get from the provider itself: `TimelineProviderContext` has no public initialiser, so nothing
/// can call `getTimeline`. So these test its two halves: what a plan becomes
/// (`ForecastProvider.timeline(_:)`, the entries in order and the reload), and the look the entry
/// view makes of WidgetKit's environment (`WidgetLook(family:mode:showsBackground:interactive:)`),
/// for every family and mode. The plans are `WidgetTimeline`'s own, over a store of this file's.
final class WidgetProviderTests: XCTestCase {
  private let aberdeen = Target.city(slug: "aberdeen-gb", name: "Aberdeen")

  /// A locked plan is one locked entry, which WidgetKit never reloads: the app reloads every
  /// timeline when the purchase changes.
  func testALockedPlanNeverReloads() async throws {
    let response = try TestFixtures.response("aberdeen-snow")
    let store = MemoryStore(
      place: aberdeen, units: response.units, unlock: unlock(false, at: response.updatedAt),
      today: SavedToday(key: aberdeen.key, savedAt: response.updatedAt, response: response))
    let plan = try await timeline(over: store).plan(at: response.updatedAt)
    XCTAssertEqual(plan.source, .locked)

    let given = ForecastProvider.timeline(plan)
    XCTAssertEqual(given.entries.map(\.face.state), [.locked])
    XCTAssertEqual(given.policy, .never)
  }

  /// An answer saved five minutes before is reused, with no request: WidgetKit is given the plan's
  /// entries in order, each dated and faced as planned, and asked to reload when the planner says,
  /// four hours after the answer was fetched.
  func testAnAnswersPlanReloadsWhenItsPlannerSays() async throws {
    let response = try TestFixtures.response("aberdeen-snow")
    let savedAt = response.updatedAt
    let store = MemoryStore(
      place: aberdeen, units: response.units, unlock: unlock(true, at: savedAt),
      today: SavedToday(key: aberdeen.key, savedAt: savedAt, response: response))
    let plan = try await timeline(over: store).plan(at: savedAt.addingTimeInterval(5 * 60))
    XCTAssertEqual(plan.source, .reused)
    let reloadAt = savedAt.addingTimeInterval(TimeInterval(Constants.Widget.refreshHours * 3600))
    XCTAssertEqual(plan.reload, .after(reloadAt))

    let given = ForecastProvider.timeline(plan)
    XCTAssertEqual(given.entries.count, plan.entries.count)
    XCTAssertEqual(given.entries.map(\.date), plan.entries.map(\.date))
    XCTAssertEqual(given.entries.map(\.face), plan.entries.map(\.face))
    XCTAssertEqual(given.entries.first?.face.place, "Aberdeen")
    XCTAssertEqual(given.policy, .after(reloadAt))
  }

  /// The look for each family the widget offers, and for one it doesn't (`systemLarge`), which
  /// draws as small, in each rendering mode: full colour only in `fullColor`, and the rest as
  /// WidgetKit says.
  func testEveryFamilyAndModeHasItsLook() {
    let families: [(WidgetFamily, WidgetLook.Family)] = [
      (.systemSmall, .small),
      (.systemMedium, .medium),
      (.accessoryCircular, .circular),
      (.accessoryRectangular, .rectangular),
      (.accessoryInline, .inline),
      (.systemLarge, .small),
    ]
    let modes: [(WidgetRenderingMode, Bool)] = [
      (.fullColor, true),
      (.accented, false),
      (.vibrant, false),
    ]
    for (family, drawn) in families {
      for (mode, fullColour) in modes {
        for showsBackground in [true, false] {
          XCTAssertEqual(
            WidgetLook(
              family: family, mode: mode, showsBackground: showsBackground, interactive: true),
            WidgetLook(
              family: drawn, fullColour: fullColour, showsBackground: showsBackground,
              interactive: true),
            "\(family) in \(mode)"
          )
        }
      }
    }
    XCTAssertFalse(
      WidgetLook(
        family: .systemMedium, mode: .fullColor, showsBackground: true, interactive: false
      ).interactive)
  }

  // MARK: - Private

  /// `unlock.v1` as the app writes it.
  private func unlock(_ unlocked: Bool, at checkedAt: Date) -> StoredUnlock {
    StoredUnlock(unlocked: unlocked, checkedAt: checkedAt, productID: Constants.Purchase.productID)
  }

  /// The widget's timeline over `store`, asking a closed port (any request fails at once, so a
  /// plan that asked says so in its source), with StoreKit holding nothing and a gate of its own.
  private func timeline(over store: MemoryStore) throws -> WidgetTimeline {
    let closed = try XCTUnwrap(URL(string: "http://127.0.0.1:9"))
    return WidgetTimeline(
      store: store,
      client: APIClient(origin: closed, transport: URLSessionTransport()),
      entitlements: NoEntitlements(),
      gate: FetchGate()
    )
  }
}

/// The App Group as the widget reads it, in memory: what a test puts there. A plan that reuses
/// the saved answer, or is locked, never saves one.
private struct MemoryStore: WidgetStore {
  let place: Target
  let units: Units?
  let unlock: StoredUnlock?
  let today: SavedToday?

  func loadPlace() -> Target { place }
  func loadUnits() -> Units? { units }
  func loadUnlock() -> StoredUnlock? { unlock }
  func loadToday() -> SavedToday? { today }

  func saveToday(_ saved: SavedToday) throws {
    XCTFail("The widget saved an answer it had no need to ask for")
  }
}

/// StoreKit as the widget reads it, holding nothing: the unlock is `unlock.v1`'s alone.
private struct NoEntitlements: EntitlementReader {
  func entitlements() async -> [PurchaseFact] { [] }
}
