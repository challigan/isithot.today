import Foundation
import IsItLogic
import IsItModel
import IsItServices
import IsItState
import XCTest

/// V1 (iOS build spec, section 26): the App Group's defaults and container work in this build,
/// signed as CI signs it for the simulator. The tests run inside the app, with its entitlements,
/// and read back through the widget's own code (section 11.2): its timeline over the real group,
/// opened as the extension opens it, with StoreKit holding nothing and a server that never
/// answers, so a plan that asked says so in its source. Each test puts back the place, the units
/// and `unlock.v1` as it found them, and forgets the saved answer.
final class AppGroupTests: XCTestCase {
  private let group = "group.today.willitsnow.app"
  private let keys = [Keys.AppGroup.place, Keys.AppGroup.units, Keys.AppGroup.unlock]
  private var before: [Any?] = []

  override func setUpWithError() throws {
    let defaults = SharedStore.open(appGroup: group, fallback: false)?.defaults
    before = keys.map { defaults?.object(forKey: $0) }
  }

  override func tearDownWithError() throws {
    guard let store = SharedStore.open(appGroup: group, fallback: false) else { return }
    for (key, value) in zip(keys, before) {
      if let value {
        store.defaults.set(value, forKey: key)
      } else {
        store.defaults.removeObject(forKey: key)
      }
    }
    try store.removeToday()
  }

  func testTheAppNamesItsAppGroup() {
    XCTAssertEqual(SharedStore.appGroupID(), group)
  }

  func testTheAppGroupOpens() throws {
    let container = try XCTUnwrap(
      FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
      "No App Group container: the build lacks the App Group entitlement"
    )
    let store = try XCTUnwrap(SharedStore.open(appGroup: group, fallback: false))
    XCTAssertEqual(store.location, .appGroup)
    XCTAssertTrue(
      store.todayURL.standardizedFileURL.path.hasPrefix(container.standardizedFileURL.path),
      "\(store.todayURL.path) is outside \(container.path)"
    )
    XCTAssertEqual(store.todayURL.lastPathComponent, Keys.AppGroup.today)
    XCTAssertEqual(store.todayURL.deletingLastPathComponent().lastPathComponent, "Caches")
  }

  func testTheGroupDefaultsRoundTrip() throws {
    let store = try XCTUnwrap(SharedStore.open(appGroup: group, fallback: false))
    let key = "test.roundTrip"
    store.defaults.set("written by the app", forKey: key)
    defer { store.defaults.removeObject(forKey: key) }
    // A defaults object of its own, as the widget's process has.
    XCTAssertEqual(UserDefaults(suiteName: group)?.string(forKey: key), "written by the app")
  }

  func testTheWidgetReadsTheAnswerTheAppSaved() async throws {
    let response = try TestFixtures.response("aberdeen-snow")
    let savedAt = response.updatedAt
    let store = try saveAsTheApp(response, for: .city(slug: "aberdeen-gb", name: "Aberdeen"))

    let saved = try XCTUnwrap(store.loadToday())
    XCTAssertEqual(saved.v, Keys.storeVersion)
    XCTAssertEqual(saved.key, "city:aberdeen-gb")
    XCTAssertEqual(saved.savedAt, savedAt)
    XCTAssertEqual(saved.response, response)

    // Five minutes on, the widget plans from what the app saved, with no request.
    let plan = try await timeline().plan(at: savedAt.addingTimeInterval(5 * 60))
    XCTAssertEqual(plan.source, .reused)
    XCTAssertEqual(plan.unlock, .flag)
    let face = try XCTUnwrap(plan.entries.first?.face)
    XCTAssertEqual(face.state, .ok)
    XCTAssertEqual(face.place, "Aberdeen")
    XCTAssertEqual(face.answer, "Yes.")
    XCTAssertEqual(face.detail, "Snow · 3cm")
  }

  func testTheWidgetShowsEachHourAheadThenStale() async throws {
    let response = try TestFixtures.response("aberdeen-snow")
    _ = try saveAsTheApp(response, for: .city(slug: "aberdeen-gb", name: "Aberdeen"))

    let plan = try await timeline().plan(at: response.updatedAt)
    XCTAssertEqual(plan.source, .reused)
    // Now, the six hours ahead (10am to 3pm), then 3:05pm, six hours after the forecast, when
    // the answer is too old to show.
    let ahead = try XCTUnwrap(response.snow?.ahead).map(\.time)
    XCTAssertEqual(plan.entries.count, 8)
    XCTAssertEqual(Array(plan.entries.map(\.date).dropLast()), [response.updatedAt] + ahead)
    XCTAssertEqual(plan.entries.last?.date, response.updatedAt.addingTimeInterval(6 * 3600))
    XCTAssertTrue(
      plan.entries.dropLast().allSatisfy { $0.face.state == .ok && $0.face.place == "Aberdeen" })
    XCTAssertEqual(plan.entries.last?.face.state, .stale)
  }

  func testTheWidgetIsLockedUntilTheAppSaysOtherwise() async throws {
    let response = try TestFixtures.response("aberdeen-snow")
    let store = try saveAsTheApp(response, for: .city(slug: "aberdeen-gb", name: "Aberdeen"))
    let now = response.updatedAt

    // Locked by the app: never reloaded but by the app, when it writes `unlock.v1` again.
    store.saveUnlock(
      StoredUnlock(unlocked: false, checkedAt: now, productID: Constants.Purchase.productID))
    let locked = try await timeline().plan(at: now)
    XCTAssertEqual(locked.entries.map(\.face.state), [.locked])
    XCTAssertEqual(locked.entries.first?.face.message, AppCopy.widgetLocked)
    XCTAssertEqual(locked.reload, .never)
    XCTAssertEqual(locked.source, .locked)
    XCTAssertEqual(locked.storeKit, .answered(0))

    // No `unlock.v1` yet, as before the app has checked: locked, and looked at again in an hour.
    store.defaults.removeObject(forKey: Keys.AppGroup.unlock)
    let unchecked = try await timeline().plan(at: now)
    XCTAssertEqual(unchecked.entries.map(\.face.state), [.locked])
    let retry = TimeInterval(Constants.Widget.retryMinutes * 60)
    XCTAssertEqual(unchecked.reload, .after(now.addingTimeInterval(retry)))
    XCTAssertEqual(unchecked.source, .locked)
  }

  func testTheStoreKeepsThePlaceTheUnitsAndReadsTheUnlock() throws {
    let store = try XCTUnwrap(SharedStore.open(appGroup: group, fallback: false))
    let keys = [Keys.AppGroup.place, Keys.AppGroup.units, Keys.AppGroup.unlock]
    let before = keys.map { store.defaults.object(forKey: $0) }
    defer {
      for (key, value) in zip(keys, before) {
        if let value {
          store.defaults.set(value, forKey: key)
        } else {
          store.defaults.removeObject(forKey: key)
        }
      }
    }

    store.savePlace(.city(slug: "leeds-gb", name: "Leeds"))
    XCTAssertEqual(store.loadPlace(), .city(slug: "leeds-gb", name: "Leeds"))
    store.savePlace(.ip)
    XCTAssertNil(store.defaults.object(forKey: Keys.AppGroup.place))
    XCTAssertEqual(store.loadPlace(), .ip)

    store.saveUnits(.f)
    XCTAssertEqual(store.defaults.string(forKey: Keys.AppGroup.units), "f")
    XCTAssertEqual(store.loadUnits(), .f)

    // `unlock.v1`, through the writer only PurchaseModel calls, and back through both readers:
    // the purchase's own (`loadUnlock()`) and the model's and the widget's (`loadUnlocked()`).
    store.defaults.removeObject(forKey: Keys.AppGroup.unlock)
    XCTAssertNil(store.loadUnlock())
    XCTAssertFalse(store.loadUnlocked())
    // A whole second, as `unlock.v1` keeps its date as the server writes dates.
    let checkedAt = Date(timeIntervalSince1970: Date().timeIntervalSince1970.rounded(.down))
    let unlock = StoredUnlock(
      unlocked: true, checkedAt: checkedAt, productID: Constants.Purchase.productID)
    store.saveUnlock(unlock)
    XCTAssertEqual(store.loadUnlock(), unlock)
    XCTAssertTrue(store.loadUnlocked())
    XCTAssertEqual(StoredUnlock(stored: store.defaults.data(forKey: Keys.AppGroup.unlock)), unlock)
    // Written again when StoreKit says it isn't owned (a refund), so the widget locks.
    store.saveUnlock(
      StoredUnlock(unlocked: false, checkedAt: checkedAt, productID: Constants.Purchase.productID))
    XCTAssertEqual(store.loadUnlock()?.unlocked, false)
    XCTAssertFalse(store.loadUnlocked())
  }

  func testAnAnswerFromAnotherStoreVersionIsIgnored() throws {
    let response = try TestFixtures.response("leeds-dry")
    let store = try saveAsTheApp(response, for: .city(slug: "leeds-gb", name: "Leeds"))
    XCTAssertNotNil(store.loadToday())
    // Read while it is this version's: the widget's snapshot shows it.
    XCTAssertEqual(try timeline().saved(at: response.updatedAt).source, .saved)

    var file = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: store.todayURL)) as? [String: Any]
    )
    file["v"] = Keys.storeVersion + 1
    try JSONSerialization.data(withJSONObject: file).write(to: store.todayURL)

    XCTAssertNil(store.loadToday())
    try expectStale(try timeline().saved(at: response.updatedAt))
  }

  func testNothingSavedIsNoAnswer() throws {
    let response = try TestFixtures.response("leeds-dry")
    let store = try saveAsTheApp(response, for: .city(slug: "leeds-gb", name: "Leeds"))
    try store.removeToday()
    XCTAssertNil(store.loadToday())
    try expectStale(try timeline().saved(at: response.updatedAt))
  }

  // MARK: - Private

  /// Saves `response` as the app does, for `place` at its `updatedAt`, with `place` chosen, the
  /// answer's units, and `unlock.v1` saying unlocked; the store it saved to.
  private func saveAsTheApp(_ response: TodayResponse, for place: Target) throws -> SharedStore {
    let store = try XCTUnwrap(SharedStore.open(appGroup: group, fallback: false))
    store.savePlace(place)
    store.saveUnits(response.units)
    store.saveUnlock(
      StoredUnlock(
        unlocked: true, checkedAt: response.updatedAt, productID: Constants.Purchase.productID))
    try store.saveToday(response, key: place.key, savedAt: response.updatedAt)
    return store
  }

  /// The widget's timeline over the real group, opened as the extension opens it, asking a closed
  /// port (any request fails at once), with StoreKit holding nothing and a gate of its own.
  private func timeline() throws -> WidgetTimeline {
    let store = try XCTUnwrap(SharedStore.open(appGroup: group, fallback: false))
    let closed = try XCTUnwrap(URL(string: "http://127.0.0.1:9"))
    return WidgetTimeline(
      store: store,
      client: APIClient(origin: closed, transport: URLSessionTransport()),
      entitlements: NoEntitlements(),
      gate: FetchGate()
    )
  }

  /// Checks `plan` is what the widget shows with no answer to show: one stale entry, its message.
  private func expectStale(_ plan: WidgetTimeline.Plan) throws {
    XCTAssertEqual(plan.source, WidgetTimeline.Source.none)
    XCTAssertEqual(plan.entries.map(\.face.state), [.stale])
    XCTAssertEqual(try XCTUnwrap(plan.entries.first).face.message, AppCopy.widgetStale)
  }
}

/// StoreKit as the widget reads it, holding nothing: the unlock is `unlock.v1`'s alone.
private struct NoEntitlements: EntitlementReader {
  func entitlements() async -> [PurchaseFact] { [] }
}
