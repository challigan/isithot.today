import Foundation
import IsItModel
import IsItServices
import IsItWidgetUI
import XCTest

/// V1 (iOS build spec, section 26): the App Group's defaults and container work in this build,
/// signed as CI signs it for the simulator. The tests run inside the app, with its entitlements,
/// and read back through the widget's own store code (section 11.4).
final class AppGroupTests: XCTestCase {
  private let group = "group.today.willitsnow.app"

  override func tearDownWithError() throws {
    try SharedStore.open(appGroup: group, fallback: false)?.removeToday()
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

  func testTheWidgetReadsTheAnswerTheAppSaved() throws {
    let response = try TestFixtures.response("aberdeen-snow")
    let savedAt = response.updatedAt
    let store = try XCTUnwrap(SharedStore.open(appGroup: group, fallback: false))
    try store.saveToday(response, key: "city:aberdeen-gb", savedAt: savedAt)

    let saved = try XCTUnwrap(store.loadToday())
    XCTAssertEqual(saved.v, Keys.storeVersion)
    XCTAssertEqual(saved.key, "city:aberdeen-gb")
    XCTAssertEqual(saved.savedAt, savedAt)
    XCTAssertEqual(saved.response, response)

    // The widget's provider opens the group itself, as the extension does.
    let provider = SavedAnswerProvider(store: {
      SharedStore.open(appGroup: self.group, fallback: false)
    })
    let entry = provider.entry(at: savedAt)
    XCTAssertEqual(entry.date, savedAt)
    XCTAssertEqual(entry.answer?.place, "Aberdeen")
    XCTAssertEqual(entry.answer?.answer, "Yes.")
    XCTAssertEqual(entry.answer?.label, "Snow")
  }

  func testTheWidgetShowsEachHourAheadAndNothingOnceTheHoursRunOut() throws {
    let response = try TestFixtures.response("aberdeen-snow")
    let store = try XCTUnwrap(SharedStore.open(appGroup: group, fallback: false))
    try store.saveToday(response, key: "city:aberdeen-gb", savedAt: response.updatedAt)

    let entries = SavedAnswerProvider(store: { store }).entries(from: response.updatedAt)
    // Now, the six hours ahead (10am to 3pm), then 3:05pm, six hours after the forecast.
    let ahead = try XCTUnwrap(response.snow?.ahead).map(\.time)
    XCTAssertEqual(entries.count, 8)
    XCTAssertEqual(Array(entries.map(\.date).dropLast()), [response.updatedAt] + ahead)
    XCTAssertEqual(entries.last?.date, response.updatedAt.addingTimeInterval(6 * 3600))
    XCTAssertTrue(entries.dropLast().allSatisfy { $0.answer?.place == "Aberdeen" })
    XCTAssertNil(entries.last?.answer)
    let past = try XCTUnwrap(entries.last?.date)
    XCTAssertNil(SavedAnswerProvider(store: { store }).entry(at: past).answer)
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

    store.defaults.removeObject(forKey: Keys.AppGroup.unlock)
    XCTAssertFalse(store.loadUnlocked())
    let unlock = StoredUnlock(unlocked: true, checkedAt: Date(), productID: "unlock")
    store.defaults.set(try unlock.stored(), forKey: Keys.AppGroup.unlock)
    XCTAssertTrue(store.loadUnlocked())
  }

  func testAnAnswerFromAnotherStoreVersionIsIgnored() throws {
    let response = try TestFixtures.response("leeds-dry")
    let store = try XCTUnwrap(SharedStore.open(appGroup: group, fallback: false))
    try store.saveToday(response, key: "city:leeds-gb", savedAt: response.updatedAt)
    XCTAssertNotNil(store.loadToday())

    var file = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: store.todayURL)) as? [String: Any]
    )
    file["v"] = Keys.storeVersion + 1
    try JSONSerialization.data(withJSONObject: file).write(to: store.todayURL)

    XCTAssertNil(store.loadToday())
    XCTAssertNil(SavedAnswerProvider(store: { store }).entry(at: Date()).answer)
  }

  func testNothingSavedIsNoAnswer() throws {
    let store = try XCTUnwrap(SharedStore.open(appGroup: group, fallback: false))
    try store.removeToday()
    XCTAssertNil(store.loadToday())
    XCTAssertNil(SavedAnswerProvider(store: { store }).entry(at: Date()).answer)
  }
}
