import Foundation
import IsItModel
import IsItTestSupport
import Testing

/// The moments and dates the clock rules read from the hot and rain answers (`hotDays`,
/// `hotNow`, `rain`) and from snow's Now (`series`), which the snow app otherwise doesn't decode.
@Suite("The clock rules' moments decode")
struct ClockDecodingTests {
  @Test("every fixture has the hot days and Now, and rain's today and Now, on snow's moments")
  func everyFixture() throws {
    for name in try Fixtures.names() {
      let response = try decode(name)
      let snow = try #require(response.snow, "\(name)")
      // The answers are worked out at the same moment, for the same days.
      #expect(response.hotDays?.map(\.date) == snow.days.map(\.date), "\(name)")
      let rain = try #require(response.rain, "\(name)")
      #expect(rain.days.map(\.from) == snow.days.map(\.from), "\(name)")
      let hourly = try #require(response.hotNow?.series, "\(name)")
      #expect(!hourly.isEmpty, "\(name)")
      #expect(zip(hourly, hourly.dropFirst()).allSatisfy { $0.time < $1.time }, "\(name)")
      if let now = snow.now {
        #expect(rain.now?.series.map(\.time) == now.series?.map(\.time), "\(name)")
      }
      // An hour ahead's Now has no series.
      #expect(snow.ahead?.allSatisfy { $0.now.series == nil } == true, "\(name)")
    }
  }

  @Test("an hour's start is epoch milliseconds, and its date the place's")
  func series() throws {
    let response = try decode("kolkata-0530")
    let first = try #require(response.hotNow?.series.first)
    let json = try tree("kolkata-0530")
    let now = try #require(json["now"] as? JSONObject)
    let points = try #require(now["series"] as? [JSONObject])
    let time = try #require(points.first?["time"] as? Int)
    #expect(first.time == Date(epochMs: time))
    #expect(first.time.epochMs == time)
    #expect(first.date == points.first?["date"] as? String)
    // Kolkata's hours start at half past the UTC hour.
    #expect(first.time.epochMs % 3_600_000 == 1_800_000)
  }

  @Test("damaged clock blocks are dropped, and the snow kept")
  func damaged() throws {
    var json = try tree("aberdeen-snow")
    json["days"] = [["high": 3]]
    json["now"] = ["time": "soon", "series": []]
    var rain = try #require(json["rain"] as? JSONObject)
    var rainNow = try #require(rain["now"] as? JSONObject)
    rainNow["series"] = [["time": "noon", "date": "2026-12-02"]]
    rain["now"] = rainNow
    json["rain"] = rain
    var snow = try #require(json["snow"] as? JSONObject)
    var snowNow = try #require(snow["now"] as? JSONObject)
    snowNow["series"] = "none"
    snow["now"] = snowNow
    json["snow"] = snow
    let response = try decode(json)
    #expect(response.hotDays == nil)
    #expect(response.hotNow == nil)
    // A damaged Now drops only rain's Now, and the series only snow's series.
    #expect(response.rain?.now == nil)
    #expect(response.rain?.days.count == 2)
    #expect(response.snow?.now?.series == nil)
    #expect(response.snow?.now?.answer == "No.")
    #expect(response.snow?.days.first?.band == .snow)
  }

  @Test("an answer without the hot or rain answers decodes without their moments")
  func missing() throws {
    var json = try tree("leeds-dry")
    json["days"] = nil
    json["now"] = nil
    json["rain"] = nil
    let response = try decode(json)
    #expect(response.hotDays == nil)
    #expect(response.hotNow == nil)
    #expect(response.rain == nil)
    #expect(response.snow?.days.count == 2)
  }

  @Test("moments in epoch milliseconds read back as themselves")
  func epochMs() {
    for ms in [0, 1, -1, 999, 1_796_195_100_000, 1_792_882_799_999, 1_806_195_599_999] {
      #expect(Date(epochMs: ms).epochMs == ms, "\(ms)")
    }
    #expect(Date(timeIntervalSince1970: 1_796_195_100.000_4).epochMs == 1_796_195_100_000)
    #expect(Date(timeIntervalSince1970: 1_796_195_100.000_6).epochMs == 1_796_195_100_001)
  }
}
