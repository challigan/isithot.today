import Foundation
import IsItModel
import IsItTestSupport
import Testing

/// A fixture's JSON as a tree, to change before decoding.
typealias JSONObject = [String: Any]

func tree(_ name: String) throws -> JSONObject {
  try #require(JSONSerialization.jsonObject(with: Fixtures.data(name)) as? JSONObject)
}

func decode(_ json: JSONObject) throws -> TodayResponse {
  try TodayResponse.decode(from: JSONSerialization.data(withJSONObject: json))
}

/// aberdeen-snow with its snow block changed by `edit`.
func aberdeenWithSnow(_ edit: (inout JSONObject) -> Void) throws -> TodayResponse {
  var json = try tree("aberdeen-snow")
  var snow = try #require(json["snow"] as? JSONObject)
  edit(&snow)
  json["snow"] = snow
  return try decode(json)
}

@Suite("Decoding is lenient where the app can do without")
struct LenientDecodingTests {
  @Test("a damaged week is dropped, and the rest of the snow kept")
  func damagedWeek() throws {
    let response = try aberdeenWithSnow { $0["week"] = ["from": 2026, "days": "none"] }
    let snow = try #require(response.snow)
    #expect(snow.week == nil)
    #expect(snow.days.first?.band == .snow)
    #expect(snow.now?.band == .nosnow)
    #expect(snow.ahead?.count == 6)
  }

  @Test("a damaged entry ahead drops the hours ahead, and nothing else")
  func damagedAhead() throws {
    let response = try aberdeenWithSnow { snow in
      var ahead = snow["ahead"] as? [JSONObject] ?? []
      ahead[3]["today"] = nil
      snow["ahead"] = ahead
    }
    #expect(response.snow?.ahead == nil)
    #expect(response.snow?.week?.answer == "Yes.")
  }

  @Test("a damaged Now is dropped")
  func damagedNow() throws {
    let response = try aberdeenWithSnow { $0["now"] = ["time": "soon"] }
    #expect(response.snow?.now == nil)
    #expect(response.snow?.days.count == 2)
  }

  @Test("damaged snow is dropped, and the place kept")
  func damagedSnow() throws {
    let response = try aberdeenWithSnow { $0["days"] = 3 }
    #expect(response.snow == nil)
    #expect(response.location.name == "Aberdeen")
    #expect(response.links?.count == 3)
  }

  @Test("damaged links, Updated line and nearby places are dropped")
  func damagedTopLevel() throws {
    var json = try tree("aberdeen-snow")
    json["links"] = [["name": "BBC Weather", "url": 42]]
    json["updated"] = ["date": "2026-12-02"]
    json["nearby"] = "Dundee"
    let response = try decode(json)
    #expect(response.links == nil)
    #expect(response.updated == nil)
    #expect(response.nearby == nil)
    #expect(response.snow?.days.first?.band == .snow)
  }

  @Test("missing or null blocks are nil")
  func missingBlocks() throws {
    var json = try tree("aberdeen-snow")
    json["snow"] = NSNull()
    json["links"] = nil
    json["updated"] = nil
    json["nearby"] = nil
    let response = try decode(json)
    #expect(response.snow == nil)
    #expect(response.links == nil)
    #expect(response.updated == nil)
    #expect(response.nearby == nil)
    #expect(response.location.slug == "aberdeen-gb")
  }

  @Test("an answer from before the app additions decodes")
  func beforeAdditions() throws {
    // No `links` or `updated` (S3), no snow days' `bandLabel` (S2), week rows without the
    // models' agreement (S1), and no `ahead` (S4).
    var json = try tree("leeds-dry")
    json["links"] = nil
    json["updated"] = nil
    var snow = try #require(json["snow"] as? JSONObject)
    snow["ahead"] = nil
    snow["days"] = (snow["days"] as? [JSONObject])?.map { day in
      var day = day
      day["bandLabel"] = nil
      return day
    }
    var week = try #require(snow["week"] as? JSONObject)
    week["days"] = (week["days"] as? [JSONObject])?.map { row in
      var row = row
      for key in ["chance", "snowy", "total", "reason"] { row[key] = nil }
      return row
    }
    snow["week"] = week
    json["snow"] = snow

    let response = try decode(json)
    let decoded = try #require(response.snow)
    #expect(decoded.days.map(\.band) == [.nosnow, .nosnow])
    #expect(decoded.days.map(\.reason) == [.rain, .dry])
    #expect(decoded.days.allSatisfy { $0.bandLabel == nil })
    #expect(decoded.ahead == nil)
    let rows = try #require(decoded.week?.days)
    #expect(rows.count == 7)
    #expect(rows.allSatisfy { $0.chance == nil && $0.snowy == nil && $0.reason == nil })
    #expect(rows.first?.bandLabel == "Rain")
  }

  @Test("a value the app doesn't know yet is unknown, not a failure")
  func unknownValues() throws {
    var json = try tree("leeds-dry")
    var location = try #require(json["location"] as? JSONObject)
    location["source"] = "satellite"
    json["location"] = location
    var snow = try #require(json["snow"] as? JSONObject)
    var days = try #require(snow["days"] as? [JSONObject])
    days[0]["band"] = "blizzard"
    days[0]["reason"] = "wind"
    days[0]["confidence"] = "great"
    snow["days"] = days
    json["snow"] = snow

    let response = try decode(json)
    #expect(response.location.source == .unknown)
    let today = try #require(response.snow?.days.first)
    #expect(today.band == .unknown)
    #expect(today.reason == .unknown)
    #expect(today.confidence == .unknown)
    #expect(response.snow?.days.last?.band == .nosnow)
  }

  @Test("what the app can't do without still fails")
  func strictWhereNeeded() throws {
    for key in ["location", "units", "updatedAt", "attribution"] {
      var json = try tree("leeds-dry")
      json[key] = nil
      #expect(throws: DecodingError.self, "\(key)") { try decode(json) }
    }
    var json = try tree("leeds-dry")
    json["updatedAt"] = "yesterday"
    #expect(throws: DecodingError.self) { try decode(json) }
  }

  @Test("dates decode with or without fractional seconds")
  func dates() throws {
    let whole = try #require(ApiJSON.parseDate("2026-12-02T09:05:00Z"))
    #expect(ApiJSON.parseDate("2026-12-02T09:05:00.000Z") == whole)
    #expect(ApiJSON.parseDate("2026-12-02T09:05:00.250Z") == whole.addingTimeInterval(0.25))
    #expect(whole.timeIntervalSince1970 == 1_796_202_300)
    #expect(ApiJSON.parseDate("2 December") == nil)

    var json = try tree("aberdeen-snow")
    json["updatedAt"] = "2026-12-02T09:05:00Z"
    #expect(try decode(json).updatedAt == whole)
  }
}
