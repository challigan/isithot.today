import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

/// The page the app shows for the spec's fixtures, at each one's own moment (`_fixture.now`), as
/// `page.json` has it from the TypeScript (packages/mobile `homePage`, from core `viewDisplay`
/// and the client's rules): the strings here are the vectors', so these read as the spec's
/// examples, and `PageVectorTests` checks every case.
@Suite("The home page, from the answer")
struct HomePageTests {
  let answers = FixtureAnswers()

  /// The page for `fixture` at its own moment.
  func page(
    _ fixture: String,
    _ view: AppView = .today,
    phase: HomePage.Phase = .ready,
    message: String? = nil,
    placeName: String? = nil
  ) throws -> HomePage {
    let now = try #require(ApiJSON.parseDate(try Fixtures.info(fixture).now))
    return HomePage(
      try answers(fixture), view: view, at: now, phase: phase, message: message,
      placeName: placeName)
  }

  @Test("aberdeen-snow: Yes today from all six forecasts, though it isn't snowing now")
  func aberdeen() throws {
    let today = try page("aberdeen-snow")
    #expect(today.state == .ready)
    #expect(today.label == "Today")
    #expect(today.band == .snow)
    #expect(today.palette == Palettes.Snow.snow)
    #expect(today.question == "Will it snow today?")
    #expect(today.answer == "Yes.")
    #expect(today.headingLabel == "Aberdeen. Will it snow today? Yes.")
    #expect(today.verdict == "It'll snow.")
    #expect(today.detail == "3 to 4cm still to come. Mostly between 5pm and midnight.")
    let day = try #require(today.day)
    #expect(day.heading == "6 of 6 forecasts expect snow")
    #expect(day.summary == "Forecasts range from 0.9cm to 5cm; 6 of 6 expect snow.")
    #expect(day.strip.min == "0cm")
    #expect(day.strip.dots.count == 6)
    #expect(
      day.lines.map(\.text) == [
        "ECMWF · 5cm", "GFS · 4cm", "ICON · 3cm", "UKMO · 4cm", "Météo-France · 3cm",
        "GEM · 0.9cm",
      ])
    #expect(day.limited == nil)
    #expect(today.retry == nil)
    let footer = try #require(today.footer)
    #expect(footer.updated == "Updated 9:05am GMT")
    #expect(footer.notice == nil)
    #expect(footer.outboundIntro == "Want the full picture? See the forecast on")
    #expect(footer.links.map(\.name) == ["BBC Weather", "Met Office", "AccuWeather"])
    #expect(footer.nearbyLabel == "Nearby:")
    #expect(!footer.nearby.isEmpty)

    let now = try page("aberdeen-snow", .now)
    #expect(now.headingLabel == "Aberdeen. Is it snowing right now? No.")
    #expect(now.verdict == "Raining, not snowing.")
    #expect(now.band == .nosnow)
    #expect(now.day == nil)
    let week = try page("aberdeen-snow", .week)
    #expect(week.headingLabel == "Aberdeen. Will it snow this week? Yes.")
    #expect(week.label == "This week")
    #expect(week.band == .heavysnow)
  }

  @Test("durham-tomorrow: from 6pm the middle page answers for tomorrow")
  func durham() throws {
    let tomorrow = try page("durham-tomorrow")
    #expect(tomorrow.tomorrow)
    #expect(tomorrow.label == "Tomorrow")
    #expect(tomorrow.question == "Will it snow tomorrow?")
    #expect(tomorrow.headingLabel == "Durham. Will it snow tomorrow? Yes.")
    #expect(tomorrow.verdict == "It'll snow.")
    #expect(tomorrow.detail == "4 to 5cm of snow. Mostly between 2am and 8am.")
    #expect(tomorrow.day?.summary == "Forecasts range from 3cm to 5cm; 6 of 6 expect snow.")
    #expect(tomorrow.footer?.updated == "Updated 6:05pm GMT")
  }

  @Test("leeds-dry: No, rain not snow, with every forecast at none")
  func leeds() throws {
    let today = try page("leeds-dry")
    #expect(today.headingLabel == "Leeds. Will it snow today? No.")
    #expect(today.verdict == "Rain, not snow.")
    #expect(today.band == .nosnow)
    #expect(today.palette == Palettes.Snow.nosnow)
    #expect(today.day?.heading == "0 of 6 forecasts expect snow")
    #expect(today.day?.summary == "All forecasts say 0cm; none expect snow.")
    #expect(try page("leeds-dry", .week).verdict == "A few flakes on Sat, nothing more.")
  }

  @Test("aberdeen-snow: Now's next hours, each read as a chance at its hour")
  func nextHours() throws {
    let now = try page("aberdeen-snow", .now)
    let hours = try #require(now.hours)
    #expect(hours.heading == "Chance of snow, next 12 hours")
    #expect(hours.rows.count == 6)
    #expect(
      hours.rows.first
        == HomePage.HourRow(label: "10am", value: "20%", chance: 20, spoken: "20% chance at 10am"))
    #expect(hours.rows.map(\.label) == ["10am", "12pm", "2pm", "4pm", "6pm", "8pm"])
    #expect(hours.rows.allSatisfy { $0.spoken == "\($0.value) chance at \($0.label)" })
    #expect(now.day == nil && now.week == nil)
    // Only the Now page has the hours, and only the week page the days.
    let today = try page("aberdeen-snow")
    #expect(today.hours == nil && today.week == nil)
    #expect(try page("aberdeen-snow", .week).hours == nil)
    #expect(try page("no-now", .now).hours == nil)
  }

  @Test("durham-tomorrow: the week's days, each read with its agreement, never a percentage")
  func weekDays() throws {
    let week = try #require(try page("durham-tomorrow", .week).week)
    #expect(week.heading == "The week ahead")
    #expect(week.rows.count == 7)
    #expect(week.rows.map(\.label) == ["Today", "Thu", "Fri", "Sat", "Sun", "Mon", "Tue"])
    #expect(
      week.rows[1]
        == HomePage.WeekRow(
          label: "Thu", amount: "4cm", bandLabel: "Snow", left: 50, snowy: 6, total: 6,
          spoken: "Thursday, 4cm, snow, 6 of 6 forecasts expect snow"))
    #expect(week.rows[0].spoken == "Today, 0cm, too warm, 0 of 6 forecasts expect snow")
    #expect(week.rows[2].spoken == "Friday, 8cm, heavy snow, 6 of 6 forecasts expect snow")
    // A day with a model short of data has fewer forecasts in its agreement.
    #expect(week.rows[4].total == 5)
    #expect(week.rows[4].spoken == "Sunday, 0cm, dry, 0 of 5 forecasts expect snow")
    #expect(week.rows.allSatisfy { !$0.spoken.contains("%") })
    #expect(try page("durham-tomorrow", .week).day == nil)
  }

  @Test("the week's dots: from none to the snowiest day, as the website places them")
  func weekTrack() throws {
    // Durham's 8cm on Friday is the track's end, Thursday's 4cm halfway, no snow its start.
    let durham = try #require(try page("durham-tomorrow", .week).week)
    #expect(durham.rows.map(\.left) == [0, 50, 100, 0, 0, 0, 0])
    // Leeds' one snowy day, 0.2cm, is its end however little falls.
    let leeds = try #require(try page("leeds-dry", .week).week)
    #expect(leeds.rows.map(\.left) == [0, 0, 0, 0, 100, 0, 0])
    // A week without snow divides by 1, as core's track does: every dot at the start.
    let dry = try #require(try page("kathmandu-0545", .week).week)
    #expect(dry.rows.allSatisfy { $0.amount == "0cm" })
    #expect(dry.rows.allSatisfy { $0.left == 0 })
  }

  @Test("leeds-dry and denver-f: one forecast in core's words for one, and inches")
  func weekWords() throws {
    let leeds = try #require(try page("leeds-dry", .week).week)
    #expect(leeds.rows[1].spoken == "Wednesday, 0cm, dry, 0 of 6 forecasts expect snow")
    #expect(
      leeds.rows[4].spoken == "Saturday, 0.2cm, a few flakes, 1 of 5 forecasts expects snow")
    let denver = try #require(try page("denver-f", .week).week)
    #expect(denver.rows[1].amount == "0.2in")
    #expect(
      denver.rows[1].spoken == "Friday, 0.2in, snow possible, 3 of 6 forecasts expect snow")
  }

  @Test("an answer saved before the week's days had their agreement: read without it")
  func weekWithoutAgreement() throws {
    var json = try #require(
      JSONSerialization.jsonObject(with: Fixtures.data("durham-tomorrow")) as? [String: Any])
    var snow = try #require(json["snow"] as? [String: Any])
    var week = try #require(snow["week"] as? [String: Any])
    let days = try #require(week["days"] as? [[String: Any]])
    week["days"] = days.map { day in day.filter { !["snowy", "total", "chance"].contains($0.key) } }
    snow["week"] = week
    json["snow"] = snow
    let res = try TodayResponse.decode(from: JSONSerialization.data(withJSONObject: json))
    let now = try #require(ApiJSON.parseDate(try Fixtures.info("durham-tomorrow").now))
    let rows = try #require(HomePage(res, view: .week, at: now, phase: .ready).week).rows
    #expect(rows[1].snowy == nil && rows[1].total == nil)
    #expect(rows[1].spoken == "Thursday, 4cm, snow")
    #expect(rows[0].spoken == "Today, 0cm, too warm")
  }

  @Test("stale: the stale line, and offline, the offline line instead")
  func stale() throws {
    let stale = try page("stale")
    #expect(stale.state == .ready)
    #expect(stale.footer?.updated == "Updated 7:05am GMT")
    #expect(stale.footer?.notice == "Showing the last forecast we have. It will refresh shortly.")
    let offline = try page("stale", phase: .offline)
    #expect(offline.footer?.notice == "You're offline. Showing the forecast from 7:05am GMT.")
  }

  @Test("no-now: Now is not available, and the other pages are")
  func noNow() throws {
    let now = try page("no-now", .now)
    #expect(now.state == .notAvailable)
    #expect(now.answer == "Not available right now.")
    #expect(now.headingLabel == "Aberdeen. Is it snowing right now? Not available right now.")
    #expect(now.band == nil)
    #expect(now.palette == Palettes.Snow.nosnow)
    #expect(now.verdict == nil && now.detail == nil)
    #expect(now.footer?.updated == "Updated 9:05am GMT")
    #expect(try page("no-now").state == .ready)
  }

  @Test("limited: two forecasts, and the limited line")
  func limited() throws {
    let today = try page("limited")
    #expect(today.day?.heading == "2 of 2 forecasts expect snow")
    #expect(today.day?.limited == "Limited forecast data")
    #expect(today.day?.lines.map(\.text) == ["ECMWF · 5cm", "GFS · 4cm"])
    #expect(try page("limited", .week).state == .notAvailable)
  }

  @Test("denver-f: amounts in inches, and the server's clock without a zone")
  func denver() throws {
    let today = try page("denver-f")
    #expect(today.headingLabel == "Denver. Will it snow today? No.")
    #expect(today.day?.summary == "All forecasts say 0in; none expect snow.")
    #expect(today.day?.lines.first?.text == "ECMWF · 0in")
    #expect(today.day?.strip.max.hasSuffix("in") == true)
    #expect(today.footer?.updated == "Updated 9:05am")
    #expect(try page("denver-f", .week).headingLabel == "Denver. Will it snow this week? Maybe.")
  }

  @Test("kathmandu-0545: an offset zone, its own hour and date")
  func kathmandu() throws {
    let today = try page("kathmandu-0545")
    #expect(!today.tomorrow)
    #expect(today.headingLabel == "Kathmandu. Will it snow today? No.")
    #expect(today.verdict == "Too warm for snow.")
    #expect(today.footer?.updated == "Updated 5:30pm")
  }

  @Test("old-forecast: past usableUntil, no recent forecast, and the footer without a notice")
  func oldForecast() throws {
    let old = try page("old-forecast", phase: .offline)
    #expect(old.state == .noRecent)
    #expect(old.answer == "No recent forecast. Connect to the internet to refresh.")
    #expect(old.band == nil && old.day == nil && old.verdict == nil)
    #expect(old.footer?.updated == "Updated 11:05am GMT")
    #expect(old.footer?.notice == nil)
  }

  @Test("with no answer: checking, then the error with Retry, and no footer")
  func noAnswer() {
    let moment = Date(epochMs: 1_796_202_300_000)
    let loading = HomePage(nil, view: .today, at: moment, phase: .loading)
    #expect(loading.state == .loading)
    #expect(loading.answer == "Checking…")
    #expect(loading.headingLabel == "Will it snow today? Checking…")
    #expect(loading.palette == Palettes.Snow.nosnow)
    #expect(loading.retry == nil && loading.footer == nil)
    let error = HomePage(nil, view: .today, at: moment, phase: .error, placeName: "Leeds")
    #expect(error.state == .error)
    #expect(
      error.headingLabel
        == "Leeds. Will it snow today? Forecasts are unavailable right now. Try again in a few minutes."
    )
    #expect(error.retry == "Retry")
    #expect(error.footer == nil)
    // Offline, it isn't the forecasts that are unavailable.
    let offline = HomePage(nil, view: .today, at: moment, phase: .offline, placeName: "Leeds")
    #expect(offline.state == .error)
    #expect(
      offline.headingLabel
        == "Leeds. Will it snow today? No recent forecast. Connect to the internet to refresh.")
    #expect(offline.palette == Palettes.Snow.nosnow)
    #expect(offline.retry == "Retry")
    #expect(offline.footer == nil)
    // The server's own message, when it sent one (section 4), and an empty one isn't.
    let said = "Latitude and longitude must be decimal degrees."
    let bad = HomePage(nil, view: .today, at: moment, phase: .error, message: said)
    #expect(bad.state == .error)
    #expect(bad.answer == said)
    #expect(bad.headingLabel == "Will it snow today? \(said)")
    #expect(bad.retry == "Retry")
    let empty = HomePage(nil, view: .today, at: moment, phase: .error, message: "")
    #expect(empty.answer == "Forecasts are unavailable right now. Try again in a few minutes.")
    // Rate limited: core's words for it, never "offline", with Retry.
    let limited = HomePage(nil, view: .today, at: moment, phase: .limited, message: said)
    #expect(limited.state == .error)
    #expect(limited.answer == "Too many requests. Try again in a minute.")
    #expect(limited.retry == "Retry")
    #expect(limited.footer == nil)
  }

  @Test("a failed request over the answer: forecasts are unavailable, with Retry")
  func failedOverAnswer() throws {
    let said = "Latitude and longitude must be decimal degrees."
    for message in [nil, said] {
      let error = try page("aberdeen-snow", phase: .error, message: message)
      #expect(error.state == .ready)
      #expect(error.headingLabel == "Aberdeen. Will it snow today? Yes.")
      #expect(error.verdict == "It'll snow.")
      #expect(error.retry == "Retry")
      #expect(error.footer?.updated == "Updated 9:05am GMT")
      #expect(
        error.footer?.notice == "Forecasts are unavailable right now. Try again in a few minutes.")
    }
    // The unavailable line beats the stale line, as the offline line does.
    #expect(try page("stale", phase: .error).footer?.notice == CoreCopy.unavailable)
    // A view with nothing to show keeps the line and Retry.
    let now = try page("no-now", .now, phase: .error)
    #expect(now.state == .notAvailable)
    #expect(now.retry == "Retry" && now.footer?.notice == CoreCopy.unavailable)
    // Past usableUntil there is no forecast showing: no line, and no Retry.
    let old = try page("old-forecast", phase: .error)
    #expect(old.state == .noRecent)
    #expect(old.retry == nil && old.footer?.notice == nil)
  }

  @Test("rate limited over the answer: quiet, as when it worked, and never offline")
  func limitedOverAnswer() throws {
    for name in ["aberdeen-snow", "stale"] {
      let limited = try page(name, phase: .limited)
      let ready = try page(name)
      #expect(limited == ready, "\(name)")
      #expect(limited.retry == nil)
    }
    #expect(try page("aberdeen-snow", phase: .limited).footer?.notice == nil)
    #expect(try page("stale", phase: .limited).footer?.notice == CoreCopy.stale)
  }

  @Test("the place: the top bar's name, else the answer's; an empty one leaves it out")
  func place() throws {
    #expect(
      try page("aberdeen-snow", placeName: "Old Aberdeen").headingLabel
        == "Old Aberdeen. Will it snow today? Yes.")
    #expect(try page("aberdeen-snow", placeName: "").headingLabel == "Will it snow today? Yes.")
  }

  @Test("the credits: each line of the answer's attribution, with its phrases linked")
  func credits() throws {
    let credits = try #require(try page("aberdeen-snow").footer?.credits)
    #expect(credits.count == 3)
    #expect(credits.map { $0.map(\.text).joined() } == (try answers("aberdeen-snow").attribution))
    let openMeteo = URL(string: "https://open-meteo.com/")
    let licence = URL(string: "https://creativecommons.org/licenses/by/4.0/")
    #expect(
      credits[0] == [
        CreditPart(text: "Weather data by Open-Meteo.com", url: openMeteo),
        CreditPart(text: " ("),
        CreditPart(text: "CC BY 4.0", url: licence),
        CreditPart(text: "), modified"),
      ])
    let nasa = URL(string: "https://power.larc.nasa.gov/")
    #expect(credits[2].last == CreditPart(text: "NASA POWER", url: nasa))
  }
}

@Suite("The home screen's top bar")
struct HomeTopBarTests {
  @Test("the place, labelled to change it, and Settings")
  func place() {
    let bar = HomeTopBar(placeName: "Leeds", approximate: false)
    #expect(bar.place == "Leeds")
    #expect(bar.placeLabel == "Place: Leeds. Change place.")
    #expect(bar.approximate == nil && bar.useMyLocation == nil)
    #expect(bar.settings == "Settings")
  }

  @Test("on the approximate place, the website's chip alone, its line only VoiceOver's hint")
  func approximate() {
    let bar = HomeTopBar(placeName: "Leeds", approximate: true)
    #expect(bar.approximate == nil)
    #expect(bar.useMyLocation == "Use my exact location")
    // The picker's row keeps its own words.
    #expect(bar.useMyLocation != CoreCopy.useMyLocation)
  }

  @Test("a notice says why, above the chip on the approximate place, or on its own")
  func notice() {
    let gone = HomeTopBar(placeName: "Leeds", approximate: true, notice: AppCopy.slugGone)
    #expect(
      gone.approximate
        == "That place is no longer available. Showing your approximate location.")
    #expect(gone.useMyLocation == "Use my exact location")
    let chosen = HomeTopBar(placeName: "Leeds", approximate: false, notice: AppCopy.slugGone)
    #expect(chosen.approximate == AppCopy.slugGone)
    #expect(chosen.useMyLocation == nil)
  }

  @Test("before the place is known, the website's line for it, labelled to change it")
  func unknown() {
    for name in [nil, ""] as [String?] {
      let bar = HomeTopBar(placeName: name, approximate: true)
      #expect(bar.place == "Finding you…")
      #expect(bar.placeLabel == "Finding you…, change place.")
    }
  }
}
