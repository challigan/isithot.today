import Foundation
import IsItModel
import IsItTestSupport
import Testing

/// "HH:MM" at `moment` in `zone`.
func clock(_ moment: Date, in zone: String) throws -> String {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = try #require(TimeZone(identifier: zone))
  let parts = calendar.dateComponents([.hour, .minute], from: moment)
  let hour = try #require(parts.hour)
  let minute = try #require(parts.minute)
  let pad = { (n: Int) in n < 10 ? "0\(n)" : "\(n)" }
  return "\(pad(hour)):\(pad(minute))"
}

/// The minutes past the UTC hour at `moment`.
func minutesPastUTCHour(_ moment: Date) -> Int {
  Int(moment.timeIntervalSince1970.truncatingRemainder(dividingBy: 3600) / 60)
}

@Suite("The fixtures show the states they are for")
struct FixtureStateTests {
  @Test("durham-tomorrow: no snow today, and snow likely tomorrow from every forecast")
  func durhamTomorrow() throws {
    let response = try decode("durham-tomorrow")
    #expect(response.updated?.clock == "6:05pm GMT")
    let snow = try #require(response.snow)
    #expect(snow.days.map(\.band) == [.nosnow, .snow])
    #expect(snow.days.map(\.answer) == ["No.", "Yes."])
    #expect(snow.days.last?.snowy == 6)
    #expect(snow.days.last?.likely?.from == 2)
    #expect(snow.days.last?.likely?.to == 8)
    let ahead = try #require(snow.ahead)
    #expect(try ahead.map { try clock($0.time, in: "Europe/London") }.last == "00:00")
    #expect(ahead.last?.today.date == "2026-12-17")
    #expect(ahead.last?.today.band == .snow)
  }

  @Test("shrewsbury-maybe: Maybe today, in every hour ahead")
  func shrewsburyMaybe() throws {
    let snow = try #require(try decode("shrewsbury-maybe").snow)
    #expect(snow.days.first?.band == .maybesnow)
    #expect(snow.days.first?.answer == "Maybe.")
    #expect(snow.ahead?.allSatisfy { $0.today.band == .maybesnow } == true)
  }

  @Test("reykjavik-mixed: Now goes from none to flakes to possible, and back")
  func reykjavikMixed() throws {
    let response = try decode("reykjavik-mixed")
    #expect(response.location.timezone == "Etc/GMT+1")
    let snow = try #require(response.snow)
    #expect(snow.days.map(\.band) == [.flakes, .maybesnow])
    #expect(
      snow.ahead?.map(\.now.band) == [.nosnow, .flakes, .maybesnow, .nosnow, .nosnow, .nosnow])
  }

  @Test("denver-f: a searched place in °F, with snow in inches")
  func denver() throws {
    let response = try decode("denver-f")
    #expect(response.units == .f)
    #expect(response.snow?.unit == .in)
    #expect(response.location.source == .search)
    #expect(response.location.slug == nil)
    #expect(response.snow?.days.last?.band == .maybesnow)
    #expect(response.snow?.days.last?.amount == 0.2)
  }

  @Test(
    "the offset zones: each hour ahead starts off the UTC hour, at the place's own hours",
    arguments: [
      ("kolkata-0530", "Asia/Kolkata", 30, ["22:00", "23:00", "00:00", "01:00", "02:00", "03:00"]),
      (
        "kathmandu-0545", "Asia/Kathmandu", 15,
        ["18:00", "19:00", "20:00", "21:00", "22:00", "23:00"]
      ),
      (
        "adelaide-1030", "Australia/Adelaide", 30,
        ["18:00", "19:00", "20:00", "21:00", "22:00", "23:00"]
      ),
      (
        "kiritimati-14", "Pacific/Kiritimati", 0,
        ["18:00", "19:00", "20:00", "21:00", "22:00", "23:00"]
      ),
    ]
  )
  func offsetZones(name: String, zone: String, minutes: Int, hours: [String]) throws {
    let response = try decode(name)
    #expect(response.location.timezone == zone)
    let ahead = try #require(response.snow?.ahead)
    #expect(ahead.map { minutesPastUTCHour($0.time) } == Array(repeating: minutes, count: 6))
    #expect(try ahead.map { try clock($0.time, in: zone) } == hours)
    let tomorrow = try #require(response.snow?.days.last)
    #expect(try clock(tomorrow.from, in: zone) == "00:00")
  }

  @Test("the clock changes: 1am twice in October, and no 1am in March")
  func clockChanges() throws {
    let autumn = try #require(try decode("london-dst-autumn-night").snow?.ahead)
    #expect(
      try autumn.map { try clock($0.time, in: "Europe/London") } == [
        "01:00", "01:00", "02:00", "03:00", "04:00", "05:00",
      ])
    let spring = try #require(try decode("london-dst-spring-night").snow?.ahead)
    #expect(
      try spring.map { try clock($0.time, in: "Europe/London") } == [
        "02:00", "03:00", "04:00", "05:00", "06:00", "07:00",
      ])
    for name in ["london-dst-autumn-evening", "london-dst-spring-evening"] {
      let first = try #require(try decode(name).snow?.ahead?.first)
      #expect(try clock(first.time, in: "Europe/London") == "18:00", "\(name)")
    }
  }

  @Test("ip-first-launch: placed by IP, in the server's units")
  func ipFirstLaunch() throws {
    let response = try decode("ip-first-launch")
    #expect(response.location.source == .ip)
    #expect(response.location.name == "Leeds")
    #expect(response.units == .c)
  }

  @Test("stale: answered from the cache, with the upstream down")
  func stale() throws {
    let response = try decode("stale")
    #expect(response.stale == true)
    #expect(response.updatedAt == (try instant("2026-12-02T07:05:00Z")))
    #expect(response.snow?.days.first?.from == (try instant("2026-12-02T09:05:00Z")))
    #expect(response.snow == (try decode("aberdeen-snow").snow))
  }

  @Test("no-week and no-now: aberdeen-snow without its own week, or its own Now")
  func missingBlocks() throws {
    let noWeek = try #require(try decode("no-week").snow)
    #expect(noWeek.week == nil)
    #expect(noWeek.now != nil)
    #expect(noWeek.ahead?.allSatisfy { $0.week != nil } == true)
    let noNow = try #require(try decode("no-now").snow)
    #expect(noNow.now == nil)
    #expect(noNow.week != nil)
    #expect(noNow.ahead?.count == 6)
  }

  @Test("limited: two models, so every day says so, and there is no week")
  func limited() throws {
    let snow = try #require(try decode("limited").snow)
    for day in snow.days {
      #expect(day.total == 2, "\(day.date)")
      #expect(day.confidence == .limited, "\(day.date)")
      #expect(day.limitedText == "Limited forecast data", "\(day.date)")
    }
    #expect(snow.week == nil)
    #expect(snow.ahead?.allSatisfy { $0.week == nil } == true)
  }

  @Test("old-forecast: fetched 7 hours before the moment it is for")
  func oldForecast() throws {
    let response = try decode("old-forecast")
    let now = try instant(try Fixtures.info("old-forecast").now)
    #expect(now.timeIntervalSince(response.updatedAt) == 7 * 3600)
    #expect(response.stale == nil)
  }

  @Test("forecast-ends: no tomorrow, no week, and three hours ahead")
  func forecastEnds() throws {
    let snow = try #require(try decode("forecast-ends").snow)
    #expect(snow.days.count == 1)
    #expect(snow.week == nil)
    let ahead = try #require(snow.ahead)
    #expect(
      try ahead.map { try clock($0.time, in: "Europe/London") } == ["21:00", "22:00", "23:00"])
    #expect(ahead.allSatisfy { $0.week == nil })
  }
}
