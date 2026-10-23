import Foundation
import IsItModel
import IsItTestSupport
import Testing

/// `today.v1.json`'s JSON as a tree, to change before reading it back.
private func fileTree(_ saved: SavedToday) throws -> [String: Any] {
  try #require(JSONSerialization.jsonObject(with: saved.encoded()) as? [String: Any])
}

@Suite("The saved answer's file, today.v1.json")
struct SavedTodayTests {
  @Test("every fixture reads back as it was saved", arguments: try Fixtures.names())
  func roundTrip(name: String) throws {
    let response = try TodayResponse.decode(from: Fixtures.data(name))
    let saved = SavedToday(key: "city:leeds-gb", savedAt: response.updatedAt, response: response)
    #expect(saved.v == Keys.storeVersion)
    #expect(SavedToday(data: try saved.encoded()) == saved)
  }

  @Test("is { v, savedAt, key, response }, its time as the server writes times")
  func shape() throws {
    let response = try TodayResponse.decode(from: Fixtures.data("aberdeen-snow"))
    let savedAt = try #require(ApiJSON.parseDate("2026-12-02T09:20:01.234Z"))
    let tree = try fileTree(SavedToday(key: "ip", savedAt: savedAt, response: response))
    #expect(Set(tree.keys) == ["v", "savedAt", "key", "response"])
    #expect(tree["v"] as? Int == 1)
    #expect(tree["savedAt"] as? String == "2026-12-02T09:20:01.234Z")
    #expect(tree["key"] as? String == "ip")
  }

  @Test("keeps the time saved to the millisecond, so it reads back equal")
  func milliseconds() throws {
    let response = try TodayResponse.decode(from: Fixtures.data("leeds-dry"))
    for fraction in [0.0, 0.000_4, 0.000_6, 0.123_4, 0.999_6] {
      let moment = Date(timeIntervalSince1970: 1_796_205_600 + fraction)
      let saved = SavedToday(key: "ip", savedAt: moment, response: response)
      #expect(saved.savedAt.epochMs == moment.epochMs)
      #expect(saved.savedAt == Date(epochMs: moment.epochMs))
      #expect(SavedToday(data: try saved.encoded())?.savedAt == saved.savedAt)
    }
  }

  @Test("another store version's file is ignored, whatever else it holds")
  func otherVersions() throws {
    let response = try TodayResponse.decode(from: Fixtures.data("leeds-dry"))
    let saved = SavedToday(key: "ip", savedAt: response.updatedAt, response: response)
    let versions: [Any] = [Keys.storeVersion + 1, 0, "1", NSNull()]
    for version in versions {
      var tree = try fileTree(saved)
      tree["v"] = version
      #expect(SavedToday(data: try JSONSerialization.data(withJSONObject: tree)) == nil)
    }
    var unversioned = try fileTree(saved)
    unversioned["v"] = nil
    #expect(SavedToday(data: try JSONSerialization.data(withJSONObject: unversioned)) == nil)
    // A later version's file need not have a response this one can read.
    let later = #"{"v":2,"savedAt":"soon","key":3,"answer":{}}"#
    #expect(SavedToday(data: Data(later.utf8)) == nil)
  }

  @Test("a file that doesn't read as a saved answer is none")
  func unreadable() throws {
    let response = try TodayResponse.decode(from: Fixtures.data("leeds-dry"))
    var tree = try fileTree(SavedToday(key: "ip", savedAt: response.updatedAt, response: response))
    tree["response"] = ["location": "Leeds"]
    #expect(SavedToday(data: try JSONSerialization.data(withJSONObject: tree)) == nil)
    #expect(SavedToday(data: Data()) == nil)
    #expect(SavedToday(data: Data("{".utf8)) == nil)
  }
}

@Suite("What unlock.v1 keeps")
struct StoredUnlockTests {
  @Test("reads back as StoreKit's code wrote it")
  func roundTrip() throws {
    let checkedAt = try #require(ApiJSON.parseDate("2026-11-23T08:00:00.000Z"))
    for unlocked in [true, false] {
      let unlock = StoredUnlock(unlocked: unlocked, checkedAt: checkedAt, productID: "unlock")
      let data = try unlock.stored()
      #expect(StoredUnlock(stored: data) == unlock)
      #expect(StoredUnlock.unlocked(stored: data) == unlocked)
    }
  }

  @Test("is { unlocked, checkedAt, productID }")
  func shape() throws {
    let checkedAt = try #require(ApiJSON.parseDate("2026-11-23T08:00:00.000Z"))
    let data = try StoredUnlock(unlocked: true, checkedAt: checkedAt, productID: "p").stored()
    let tree = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    #expect(Set(tree.keys) == ["unlocked", "checkedAt", "productID"])
    #expect(tree["checkedAt"] as? String == "2026-11-23T08:00:00.000Z")
  }

  @Test("nothing, or anything else, is locked")
  func locked() {
    #expect(!StoredUnlock.unlocked(stored: nil))
    #expect(!StoredUnlock.unlocked(stored: Data("true".utf8)))
    #expect(!StoredUnlock.unlocked(stored: Data(#"{"unlocked":true}"#.utf8)))
    #expect(StoredUnlock(stored: Data()) == nil)
  }
}

@Suite("The API's error answer")
struct ApiErrorTests {
  @Test("reads the server's code and message")
  func decodes() throws {
    let body =
      #"{"error":{"code":"not_found","message":"There is no page for that place.","detail":"x"}}"#
    let error = try ApiError.decode(from: Data(body.utf8))
    #expect(error.error.code == "not_found")
    #expect(error.error.message == "There is no page for that place.")
    #expect(error == ApiError(code: "not_found", message: "There is no page for that place."))
  }

  @Test("a body without both isn't one")
  func notOne() {
    #expect(throws: (any Error).self) {
      try ApiError.decode(from: Data(#"{"error":{"code":"x"}}"#.utf8))
    }
    #expect(throws: (any Error).self) { try ApiError.decode(from: Data("<html>".utf8)) }
  }
}
