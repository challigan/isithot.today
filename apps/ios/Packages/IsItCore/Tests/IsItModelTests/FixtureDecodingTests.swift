import Foundation
import IsItModel
import IsItTestSupport
import Testing

/// A moment as the fixtures write it.
func instant(_ text: String) throws -> Date {
  try #require(ApiJSON.parseDate(text))
}

func decode(_ name: String) throws -> TodayResponse {
  try TodayResponse.decode(from: Fixtures.data(name))
}

@Suite("The fixtures decode")
struct FixtureDecodingTests {
  @Test("every fixture pnpm mobile:generate writes is here")
  func names() throws {
    #expect(try Fixtures.names() == ["aberdeen-snow", "leeds-dry"])
  }

  @Test("every fixture decodes, with its snow, and encodes back to the same")
  func everyFixture() throws {
    for name in try Fixtures.names() {
      let response = try decode(name)
      #expect(response.snow?.days.isEmpty == false, "\(name)")
      #expect(response.snow?.now != nil, "\(name)")
      #expect(response.snow?.week != nil, "\(name)")
      #expect(response.snow?.ahead?.count == 6, "\(name)")
      #expect(response.links?.isEmpty == false, "\(name)")
      #expect(response.updated != nil, "\(name)")
      let again = try ApiJSON.decoder().decode(
        TodayResponse.self,
        from: ApiJSON.encoder().encode(response)
      )
      #expect(again == response, "\(name)")
    }
  }

  @Test("aberdeen-snow: snow today, and for the rest of the day in every hour ahead")
  func aberdeenSnow() throws {
    let response = try decode("aberdeen-snow")
    #expect(response.location.name == "Aberdeen")
    #expect(response.location.slug == "aberdeen-gb")
    #expect(response.location.source == .city)
    #expect(response.location.timezone == "Europe/London")
    #expect(response.units == .c)
    #expect(response.updatedAt == (try instant("2026-12-02T09:05:00.000Z")))
    #expect(response.updated?.date == "2026-12-02")
    #expect(response.updated?.clock == "9:05am GMT")
    #expect(response.stale == nil)
    #expect(response.links?.map(\.name) == ["BBC Weather", "Met Office", "AccuWeather"])
    #expect(
      response.links?.first?.url == URL(string: "https://www.bbc.co.uk/weather/2657832")
    )
    #expect(response.nearby?.first?.slug == "dundee-gb")
    #expect(response.nearby?.first?.name == "Dundee")

    let snow = try #require(response.snow)
    #expect(snow.unit == .cm)
    let today = try #require(snow.days.first)
    #expect(today.date == "2026-12-02")
    #expect(today.from == response.updatedAt)
    #expect(today.partial)
    #expect(today.band == .snow)
    #expect(today.answer == "Yes.")
    #expect(today.reason == nil)
    #expect(today.bandLabel == "Snow")
    #expect(today.confidence == .good)
    #expect(today.snowy * 2 > today.total)
    #expect(today.models.count == today.total)

    // Raining for now.
    let now = try #require(snow.now)
    #expect(now.band == .nosnow)
    #expect(now.answer == "No.")
    #expect(now.hours.count == 6)
    #expect(snow.week?.answer == "Yes.")
    #expect(snow.week?.days.count == 7)

    let ahead = try #require(snow.ahead)
    #expect(ahead.count == 6)
    #expect(ahead.first?.time == (try instant("2026-12-02T10:00:00Z")))
    for (i, entry) in ahead.enumerated() {
      #expect(entry.time == response.updatedAt.addingTimeInterval(Double(55 + 60 * i) * 60))
      #expect(entry.today.date == "2026-12-02")
      #expect(entry.today.band == .snow, "ahead[\(i)]")
      #expect(entry.today.answer == "Yes.", "ahead[\(i)]")
      #expect(entry.week?.answer == "Yes.", "ahead[\(i)]")
    }
  }

  @Test("leeds-dry: no snow today, tomorrow or this week, each with why")
  func leedsDry() throws {
    let response = try decode("leeds-dry")
    #expect(response.location.name == "Leeds")
    #expect(response.updatedAt == (try instant("2026-12-01T09:05:00Z")))
    let snow = try #require(response.snow)
    #expect(snow.days.map(\.band) == [.nosnow, .nosnow])
    #expect(snow.days.map(\.answer) == ["No.", "No."])
    #expect(snow.days.map(\.reason) == [.rain, .dry])
    #expect(snow.days.map(\.bandLabel) == ["Rain", "Dry"])
    #expect(snow.days.first?.snowy == 0)
    #expect(snow.now?.answer == "No.")

    let week = try #require(snow.week)
    #expect(week.answer == "No.")
    #expect(week.snowDays == 0)
    #expect(week.maybeDays == 0)
    #expect(
      week.days.map(\.band) == [.nosnow, .nosnow, .nosnow, .nosnow, .flakes, .nosnow, .nosnow])
    #expect(Set(week.days.compactMap(\.reason)) == [.rain, .dry, .warm])
    #expect(week.days.map(\.label) == ["Today", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"])
    for day in week.days where day.band == .nosnow {
      #expect(day.snowy == 0, "\(day.date)")
      #expect(day.reason != nil, "\(day.date)")
    }

    // Rain for the rest of the day until 2pm, then dry.
    let ahead = try #require(snow.ahead)
    #expect(ahead.map(\.today.band) == Array(repeating: .nosnow, count: 6))
    #expect(ahead.map(\.today.reason) == [.rain, .rain, .rain, .rain, .dry, .dry])
  }
}
