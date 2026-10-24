import Foundation
import IsItLogic
import IsItModel
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
        "BricolageGrotesque-OFL", "GoogleMobileAds-LICENSE", "UserMessagingPlatform-LICENSE",
      ])
    #expect(page.notices[0].summary.contains("SIL Open Font License, Version 1.1"))
    #expect(page.notices[1].summary.contains("Apache License, Version 2.0"))
    #expect(page.notices.allSatisfy { $0.url?.scheme == "https" })
    for text in [page.title, page.models] + page.notices.flatMap({ [$0.name, $0.summary] }) {
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
          + "recent places and the last forecast on your iPhone.",
        "Only while notifications are on, we keep your device's notification token, an ID made "
          + "from it, the place, its time zone, your units and which notifications you chose, "
          + "with a few details such as the app's version and when it last checked in. We delete "
          + "them when you turn notifications off in the app, when Apple tells us the app is no "
          + "longer installed, or about 90 days after you last open it. If you turn notifications "
          + "off in your iPhone's Settings instead, we delete them the next time you open the app. "
          + "For a few days after each notification and each test, we also keep a note that it was "
          + "sent, even once the rest is deleted. It holds no token or place.",
        "In the free version, Google shows the ads and may collect device and usage data.",
        "Apple handles purchases. We never see your payment details.",
        "There are no accounts.",
      ])
    #expect(page.kept == nil)
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
        "In the free version, Google shows the ads and may collect device and usage data.",
        "See Privacy choices.",
      ])
    let bought = YourPrivacy(adsOn: false, privacyChoices: true).lines
    #expect(bought.count == 4)
    #expect(!bought.contains { $0.contains("Google") || $0.contains("Privacy choices") })
  }

  @Test("what is kept for notifications shows, with the delete button, only with lines to show")
  func kept() throws {
    let page = YourPrivacy(
      adsOn: false, privacyChoices: false,
      kept: ["ID 3f9c1a2b", "Leeds, Europe/London", "cm", "Evening before"])
    let kept = try #require(page.kept)
    #expect(kept.heading == "What we keep for notifications")
    #expect(kept.lines == ["ID 3f9c1a2b", "Leeds, Europe/London", "cm", "Evening before"])
    #expect(kept.delete == "Turn off notifications and delete my data")
    for line in YourPrivacy(adsOn: true, privacyChoices: true).lines {
      #expect(otherTopic(in: line) == nil, "\(line)")
    }
  }
}
