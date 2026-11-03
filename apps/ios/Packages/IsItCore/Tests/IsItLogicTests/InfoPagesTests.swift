import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

@Suite("How it works, Credits and licences, and Your privacy")
struct InfoPagesTests {
  @Test("How it works: the About page's snow section, with the judging's own numbers")
  func howItWorks() {
    let page = HowItWorks()
    #expect(page.title == "How it works")
    #expect(
      page.sections.map(\.heading) == [
        nil, "The answer", "This week", "Your location", "Data sources",
      ])
    let text = page.sections.flatMap(\.paragraphs)
    #expect(
      text == [
        "The app answers one question: will it snow where you are? Here is how it gets from a "
          + "pile of forecasts to one answer.",
        "We ask 6 forecast models how much snow they expect, hour by hour, as a depth of fresh "
          + "snow: 7 cm for every 10 mm of water, the usual ratio. A model expects snow when it "
          + "forecasts at least 0.5 cm for the day. For a shorter stretch, like the rest of an "
          + "evening, less is enough: 0.1 cm for each hour that is left.",
        "The share of models expecting snow is the chance. When 60% or more of them do, the "
          + "answer is yes; from 25%, it is maybe. How much snow comes from the middle forecast "
          + "(the median).",
        "In an hour warmer than 2.5°C, nothing counts as snow, whatever a model says. When the "
          + "answer is no, it says why, with the lowest temperature expected.",
        "The week's answer is yes when any day brings snow. Where long-term climate records "
          + "cover the place, we also say whether snow is rare or common there at this time of "
          + "year, and compare the week with normal. Snow depends so much on height that we only "
          + "do this where the records' 50 km grid cell is within 300 m of the place's height. "
          + "Amounts are fresh snowfall, not what will be lying on the ground: some of it may "
          + "melt as it lands.",
        "Until you choose a place, the app uses an approximate location from your internet "
          + "connection. If you allow it, your phone's location is used instead, rounded to "
          + "about 5 km before it leaves your phone. You can also search for any place.",
        "The forecasts come from 6 models run by ECMWF, NOAA (GFS), DWD (ICON), the Met Office "
          + "(UKMO), Météo-France and Environment and Climate Change Canada (GEM). We combine and "
          + "modify them: the blended figures and the answers are our own work, not the weather "
          + "services'.",
        "Forecasts are estimates. For anything that matters, check your national weather service.",
      ])
  }

  @Test("How it works follows the constants it reads, never a number of its own")
  func howItWorksNumbers() {
    let text = HowItWorks().sections.flatMap(\.paragraphs).joined(separator: " ")
    #expect(text.contains("We ask \(Constants.models.count) forecast models"))
    #expect(text.contains("When \(Int((Constants.Snow.likelyFrom * 100).rounded()))% or more"))
    #expect(text.contains("from \(Int((Constants.Snow.maybeFrom * 100).rounded()))%, it is maybe"))
    #expect(text.contains("\(Int((10 * Constants.Snow.cmPerMm).rounded())) cm for every 10 mm"))
    #expect(text.contains("within \(Int(Constants.Snow.Normals.maxHeightDifference)) m"))
    #expect(text.contains(AppCredits.modelAgencies))
    #expect(text.contains("rounded to about 5 km before it leaves your phone"))
    #expect(!text.contains("{") && !text.contains("}"))
    #expect(otherTopic(in: text) == nil)
  }

  @Test("Credits and licences: core's credits linked as in the footer, then the records and names")
  func credits() throws {
    let page = CreditsPage()
    #expect(page.title == "Credits and licences")
    #expect(page.dataHeading == "Forecasts and data")
    #expect(page.models.hasPrefix("The forecasts come from 6 models run by ECMWF, NOAA (GFS)"))
    #expect(
      page.data.map { $0.map(\.text).joined() } == [
        CoreCopy.forecastCredit,
        CoreCopy.metOfficeCredit,
        "Climate data: NASA POWER (Prediction Of Worldwide Energy Resources), long-term monthly "
          + "averages of snowfall from the NASA Langley Research Center (LaRC) POWER Project, "
          + "licensed under CC BY 4.0",
        "Place names: GeoNames, licensed under CC BY 4.0",
      ])
    #expect(page.data[0] == Credits.parts(CoreCopy.forecastCredit))
    let linked = page.data.map { parts in
      parts.compactMap { part in part.url.map { "\(part.text) \($0.absoluteString)" } }
    }
    #expect(
      linked == [
        [
          "Weather data by Open-Meteo.com https://open-meteo.com/",
          "CC BY 4.0 https://creativecommons.org/licenses/by/4.0/",
        ],
        ["CC BY-SA 4.0 https://creativecommons.org/licenses/by-sa/4.0/"],
        [
          "NASA POWER https://power.larc.nasa.gov/",
          "CC BY 4.0 https://creativecommons.org/licenses/by/4.0/",
        ],
        [
          "GeoNames https://www.geonames.org/",
          "CC BY 4.0 https://creativecommons.org/licenses/by/4.0/",
        ],
      ])
  }

  @Test("the typeface and Google's SDKs, each with its notice in a bundled file")
  func notices() throws {
    let page = CreditsPage()
    #expect(page.softwareHeading == "Typeface and software")
    #expect(
      page.notices.map(\.name) == [
        "Bricolage Grotesque", "Google Mobile Ads SDK", "Google User Messaging Platform SDK",
      ])
    #expect(
      page.notices.map(\.file) == [
        "BricolageGrotesque-OFL", "Google-Mobile-Ads-LICENSE", "Google-UMP-LICENSE",
      ])
    // The whole app's typeface, not only the answer's: every page sets its words in it.
    #expect(
      page.notices[0].summary
        == "The app's typeface. Copyright 2022 The Bricolage Grotesque Project Authors, "
        + "licensed under the SIL Open Font License, Version 1.1.")
    #expect(page.notices[0].summary.contains("SIL Open Font License, Version 1.1"))
    #expect(page.notices[1].summary.contains("Apache License, Version 2.0"))
    #expect(page.notices.allSatisfy { $0.url?.scheme == "https" })
    // The project link's label, in words: a URL as a label was "not human-readable" to the
    // accessibility audit on PR #33's second macOS run.
    #expect(
      page.notices.map(\.urlLabel) == [
        "Bricolage Grotesque's project page", "Google Mobile Ads SDK's project page",
        "Google User Messaging Platform SDK's project page",
      ])
    for text in [page.title, page.models]
      + page.notices.flatMap({ [$0.name, $0.summary, $0.urlLabel] })
    {
      #expect(otherTopic(in: text) == nil, "\(text)")
    }
  }

  @Test("Your privacy, free: the plain lines, the ads line, no notifications data yet, the policy")
  func privacyFree() throws {
    let page = YourPrivacy(adsOn: true, privacyChoices: false)
    #expect(page.title == "Your privacy")
    #expect(
      page.lines == [
        "To get the forecast, the app sends the place (a town, or your location rounded to about "
          + "5 km) and your units to our server. Until you choose a place, our server estimates a "
          + "rough one from your internet connection. Place names you search for go to Open-Meteo, "
          + "our forecast provider, to find matching places. The app keeps your place, units, "
          + "recent and saved places, your notification choices and the last forecast on your "
          + "iPhone.",
        "Only while notifications are on, we keep your device's notification token, an ID made "
          + "from it, the place you get notifications for and its time zone, your units and which "
          + "notifications you chose, with a few details such as the app's version and when it "
          + "last checked in. The place is where you are (your location rounded to about 5 km or, "
          + "if you haven't shared it, a rough place our server estimates from your internet "
          + "connection, updated when you open the app, at most once an hour). We delete them "
          + "when you turn notifications off in the app, when Apple tells us the app is no longer "
          + "installed, or about 90 days after you last open it. If you turn notifications off in "
          + "your iPhone's Settings instead, we delete them the next time you open the app. For a "
          + "few days after each notification and each test, and after some forecast checks that "
          + "found nothing to send, we also keep a note of it, even once the rest is deleted. It "
          + "holds no token or place.",
        "In the free version, Google shows the ads and may collect device and usage data. The "
          + "app keeps when it last showed a full-screen ad, so it shows one at most every 5 "
          + "minutes.",
        "Apple handles purchases. We never see your payment details. The app keeps a note on "
          + "your iPhone of whether you've made the one-off purchase.",
        "There are no accounts.",
      ])
    #expect(page.kept == nil)
    #expect(page.deleteStatus == nil)
    let policy = try #require(page.policy)
    #expect(policy.title == "Privacy policy")
    #expect(policy.id == "full-policy")
    #expect(policy.action == .open(try #require(URL(string: "https://willitsnow.today/privacy"))))
  }

  @Test("Your privacy points to Privacy choices only while that row is there; no ads line bought")
  func privacyAds() {
    let choices = YourPrivacy(adsOn: true, privacyChoices: true).lines
    #expect(
      choices[2...3] == [
        "In the free version, Google shows the ads and may collect device and usage data. The "
          + "app keeps when it last showed a full-screen ad, so it shows one at most every 5 "
          + "minutes.",
        "See Privacy choices.",
      ])
    let bought = YourPrivacy(adsOn: false, privacyChoices: true).lines
    #expect(bought.count == 4)
    #expect(!bought.contains { $0.contains("Google") || $0.contains("Privacy choices") })
  }

  @Test("what is kept for notifications shows, with the delete button, only with lines to show")
  func kept() throws {
    let lines = ["ID 3f9c1a2b", "Where you are: Leeds, Europe/London", "Snow units: cm"]
    let page = YourPrivacy(adsOn: false, privacyChoices: false, kept: lines)
    let kept = try #require(page.kept)
    #expect(kept.heading == "What we keep for notifications")
    #expect(kept.lines == lines)
    #expect(kept.delete == "Turn off notifications and delete my data")
    for line in YourPrivacy(adsOn: true, privacyChoices: true).lines {
      #expect(otherTopic(in: line) == nil, "\(line)")
    }
  }

  @Test("the kept lines are the last set's: the ID, where you are, the units, the switches")
  func keptLines() throws {
    let leeds = try registration("put-here-ip")
    let id = try deviceResponse("put-here-ip").id
    #expect(
      YourPrivacy.keptLines(leeds) == [
        "ID " + id.prefix(8), "Where you are: Leeds, Europe/London", "Snow units: cm",
        "Evening before (about 6pm)",
      ])
    #expect(YourPrivacy.keptLines(leeds)?.first == "ID b8465956")
    #expect(
      YourPrivacy.keptLines(try registration("put-here-ip", units: .f))?.dropFirst(2).first
        == "Snow units: in")
    // The phone's location, and the connection an hour later in Newcastle.
    #expect(
      YourPrivacy.keptLines(try registration("put-here-device"))?.dropFirst().first
        == "Where you are: Leeds, Europe/London")
    #expect(
      YourPrivacy.keptLines(try registration("put-here-refresh"))?.dropFirst().first
        == "Where you are: Newcastle, Europe/London")
    #expect(YourPrivacy.keptLines(nil) == nil)
  }

  @Test("no where-you-are line while the server has no free place")
  func keptWithoutAFreePlace() throws {
    var kept = try registration("put-here-ip")
    let response = kept.response
    kept.response = DeviceResponse(
      id: response.id, here: nil, alerts: response.alerts, seenAt: response.seenAt)
    #expect(
      YourPrivacy.keptLines(kept) == [
        "ID b8465956", "Snow units: cm", "Evening before (about 6pm)",
      ])
  }

  @Test("each switch the server holds on is a kept line, in Settings' words and order")
  func keptSwitches() throws {
    let leeds = try registration("put-here-ip")
    func lines(_ snow: AlertPrefs) throws -> [String] {
      let response = leeds.response
      var kept = leeds
      kept.response = DeviceResponse(
        id: response.id, here: response.here, alerts: RegistrationBody.Alerts(snow: snow),
        seenAt: response.seenAt)
      return Array(try #require(YourPrivacy.keptLines(kept)).dropFirst(3))
    }
    #expect(
      try lines(AlertPrefs(evening: true, morning: true, possible: true)) == [
        "Evening before (about 6pm)", "On the day (about 7am)", "Also when snow is possible",
      ])
    #expect(
      try lines(AlertPrefs(morning: true, possible: true)) == [
        "On the day (about 7am)", "Also when snow is possible",
      ])
    #expect(try lines(AlertPrefs()) == [])
    let page = YourPrivacy(adsOn: false, privacyChoices: false, kept: YourPrivacy.keptLines(leeds))
    #expect(page.kept?.lines == YourPrivacy.keptLines(leeds))
    for line in try #require(YourPrivacy.keptLines(leeds)) {
      #expect(otherTopic(in: line) == nil, "\(line)")
    }
  }

  @Test("what the delete did, in words, once it has")
  func deleteStatus() {
    #expect(
      YourPrivacy.deleteStatus(.done)
        == "Notifications are off. We've deleted your notification token, place, units and "
        + "choices.")
    #expect(
      YourPrivacy.deleteStatus(.notYet)
        == "Couldn't reach our server, so nothing is deleted yet. The app will try again when you "
        + "next open it.")
    #expect(YourPrivacy.deleteStatus(.idle) == nil)
    #expect(YourPrivacy.deleteStatus(.deleting) == nil)
    let page = YourPrivacy(
      adsOn: false, privacyChoices: false, deleteStatus: YourPrivacy.deleteStatus(.done))
    #expect(page.deleteStatus == AppCopy.deleteDone)
    #expect(page.kept == nil)
    for text in [AppCopy.deleteDone, AppCopy.deleteNotYet] {
      #expect(otherTopic(in: text) == nil, "\(text)")
    }
  }
}
