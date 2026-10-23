import IsItModel
import Testing

// The numbers and keys pnpm mobile:generate writes (packages/mobile): they compile, with the
// types the app needs, and spot values are core's and the client's.

@Suite("Constants: the numbers shared with the server")
struct ConstantsTests {
  @Test("the middle view, the grid, search and the cache")
  func basics() {
    #expect(Constants.tomorrowFromHour == 18)
    #expect(Constants.Grid.forecast == 0.05)
    #expect(Constants.Search.minChars == 2)
    #expect(Constants.Search.maxResults == 8)
    #expect(Constants.Search.debounceMs == 250)
    #expect(Constants.Cache.forecastStale == 6 * 60 * 60)
  }

  @Test("the hours ahead, the widgets and notifications")
  func apps() {
    #expect(Constants.Ahead.hours == 6)
    #expect(Constants.Widget.refreshHours == 4)
    #expect(Constants.Widget.reuseMinutes == 60)
    #expect(Constants.Widget.retryMinutes == 60)
    #expect(Constants.Alerts.heartbeatDays == 7)
  }

  @Test("snow's judging, as Double")
  func snow() {
    let shares: [Double] = [Constants.Snow.maybeFrom, Constants.Snow.likelyFrom]
    #expect(shares == [0.25, 0.6])
    let day: [Double] = [
      Constants.Snow.Day.flakes, Constants.Snow.Day.snow, Constants.Snow.Day.heavy,
      Constants.Snow.Day.deep,
    ]
    #expect(day == [0.1, 0.5, 5, 15])
  }

  @Test("the six models, in order, with who runs them")
  func models() {
    #expect(
      Constants.models.map(\.name) == ["ECMWF", "GFS", "ICON", "UKMO", "Météo-France", "GEM"]
    )
    #expect(Constants.models.first?.id == "ecmwf_ifs025")
    #expect(Constants.models.map(\.agency).contains("the Met Office"))
    #expect(Constants.models.last?.agency == "Environment and Climate Change Canada")
  }

  @Test("the client's timings, ms")
  func client() {
    #expect(Constants.Client.refreshAfterMs == 30 * 60 * 1000)
    #expect(Constants.Client.refreshJitterMs == 90 * 1000)
    #expect(Constants.Client.reuseMs == 10 * 60 * 1000)
    #expect(Constants.Client.requestTimeoutMs == 12 * 1000)
    #expect(Constants.Client.retryAfterMs == 60 * 1000)
  }
}

@Suite("Keys: where the apps keep things")
struct KeysTests {
  @Test("the App Group's keys, the app's own and the store version")
  func keys() {
    #expect(Keys.AppGroup.place == "place.v1")
    #expect(Keys.AppGroup.today == "today.v1.json")
    #expect(Keys.App.lastView == "ui.lastView")
    #expect(Keys.App.card == "ui.alertCard")
    #expect(Keys.storeVersion == 1)
  }
}
