import Foundation
import IsItModel
import Testing

// The copy pnpm mobile:generate writes (packages/mobile): it compiles, and spot values are the
// TypeScript's. Every question is checked against core's own in the golden vectors (questions.json).

@Suite("CoreCopy: the words shared with the website")
struct CoreCopyTests {
  @Test("the COPY strings the app uses")
  func copy() {
    #expect(CoreCopy.notAvailable == "Not available right now.")
    #expect(CoreCopy.checking == "Checking…")
    #expect(CoreCopy.retry == "Retry")
    #expect(CoreCopy.approximate == "Using approximate location.")
    #expect(CoreCopy.useMyLocation == "Use my location")
    #expect(CoreCopy.yourLocation == "Your location")
    #expect(CoreCopy.searchPlaceholder == "Town or city")
    #expect(CoreCopy.searchTooShort == "Type at least 2 letters.")
    #expect(CoreCopy.outboundIntro == "Want the full picture? See the forecast on")
    #expect(CoreCopy.nearby == "Nearby:")
    #expect(CoreCopy.nextHoursSnow == "Chance of snow, next 12 hours")
    #expect(CoreCopy.yesterday == "yesterday")
    #expect(
      CoreCopy.metOfficeCredit
        == "Contains Met Office data © Crown copyright, the Met Office, licensed under CC BY-SA 4.0"
    )
    #expect(CoreCopy.snowUnitsLabel == "Snow units")
  }

  @Test("the views' labels, left to right, and Tomorrow")
  func views() {
    #expect(AppView.allCases.map(\.rawValue) == ["now", "today", "week"])
    #expect(AppView.allCases.map(CoreCopy.viewLabel) == ["Now", "Today", "This week"])
    #expect(CoreCopy.tomorrowLabel == "Tomorrow")
  }

  @Test("the units' names: cm with °C, in with °F")
  func units() {
    #expect(CoreCopy.snowUnitName(.c) == "cm")
    #expect(CoreCopy.snowUnitName(.f) == "in")
  }

  @Test("a label for every band and reason, and none for one the app doesn't know")
  func bandsAndReasons() {
    #expect(
      SnowBand.allCases.map(CoreCopy.snowBandLabel) == [
        "No snow", "A few flakes", "Snow possible", "Snow", "Heavy snow", "Deep snow", nil,
      ]
    )
    #expect(SnowReason.allCases.map(CoreCopy.snowReasonLabel) == ["Too warm", "Rain", "Dry", nil])
  }

  @Test("the API's error messages by code")
  func errors() {
    #expect(
      CoreCopy.errorMessage(code: "rate_limited") == "Too many requests. Try again in a minute.")
    #expect(CoreCopy.errorMessage(code: "upstream_unavailable") == CoreCopy.unavailable)
    #expect(CoreCopy.errorMessage(code: "teapot") == nil)
  }
}

@Suite("Questions: core's question for each view")
struct QuestionsTests {
  @Test("without a place, and with an empty one, as core asks")
  func withoutAPlace() {
    #expect(Questions.snow(view: .now, place: nil, tomorrow: false) == "Is it snowing right now?")
    #expect(Questions.snow(view: .today, place: nil, tomorrow: false) == "Will it snow today?")
    #expect(Questions.snow(view: .today, place: "", tomorrow: true) == "Will it snow tomorrow?")
    #expect(Questions.snow(view: .week, place: nil, tomorrow: false) == "Will it snow this week?")
  }

  @Test("with a place, tomorrow changing only the middle view")
  func withAPlace() {
    #expect(
      Questions.snow(view: .now, place: "Leeds", tomorrow: true)
        == "Is it snowing in Leeds right now?"
    )
    #expect(
      Questions.snow(view: .today, place: "Leeds", tomorrow: false)
        == "Will it snow in Leeds today?"
    )
    #expect(
      Questions.snow(view: .today, place: "Leeds", tomorrow: true)
        == "Will it snow in Leeds tomorrow?"
    )
    #expect(
      Questions.snow(view: .week, place: "Leeds", tomorrow: true)
        == "Will it snow in Leeds this week?"
    )
  }

  @Test("a place's name goes in as it is, whatever it holds")
  func names() {
    for name in ["St John's", "“Quoted”", "$1 & $&", #"Back\slash \(x)"#, "{place}", "Zürich"] {
      #expect(
        Questions.snow(view: .today, place: name, tomorrow: false)
          == "Will it snow in \(name) today?"
      )
    }
  }

  @Test("each template has the slot once with a place, and none without")
  func templates() {
    for view in AppView.allCases {
      for tomorrow in [false, true] {
        let placed = Questions.template(view: view, tomorrow: tomorrow, withPlace: true)
        let plain = Questions.template(view: view, tomorrow: tomorrow, withPlace: false)
        #expect(placed.components(separatedBy: Questions.slot).count == 2, "\(view) \(tomorrow)")
        #expect(!plain.contains(Questions.slot), "\(view) \(tomorrow)")
        #expect(placed.replacingOccurrences(of: " in {place}", with: "") == plain)
      }
    }
  }
}

@Suite("AppCopy: the app's own words")
struct AppCopyTests {
  @Test("plain strings")
  func plain() {
    #expect(AppCopy.settings == "Settings")
    #expect(AppCopy.restore == "Restore purchase")
    #expect(AppCopy.offline(time: "3:05pm") == "You're offline. Showing the forecast from 3:05pm.")
    #expect(AppCopy.unitsFootnote == "Temperatures follow: cm with °C, inches with °F.")
    #expect(AppCopy.credits == "Credits and licences")
    #expect(AppCopy.widgetDescription == "Today's snow answer, then tomorrow's from 6pm.")
    #expect(AppCopy.notifyFooter.hasPrefix("These are forecasts, not official warnings."))
    #expect(AppCopy.privacyAccounts == "There are no accounts.")
    // The purchase's (phase 7.1): what it is, and why it can't be bought.
    for text in [AppCopy.upgradeDescription, AppCopy.upgradeUnavailable, AppCopy.purchasesOff] {
      #expect(!text.isEmpty)
    }
    #expect(
      AppCopy.upgradeUnavailable == "The purchase isn't available right now. Try again later.")
    #expect(AppCopy.purchasesOff == "In-app purchases are turned off on this iPhone.")
  }

  @Test("the notifications' words (phases 8.1 and 8.4a)")
  func notifications() {
    #expect(AppCopy.notifyLocationDenied == "Location access is off for this app in Settings.")
    #expect(AppCopy.notifyLocationUnavailable == "Couldn't find your location. Try again.")
    #expect(
      AppCopy.testDryRun == "Our server isn't sending notifications yet, so nothing was sent.")
    #expect(
      AppCopy.testQuiet
        == "Nothing is sent from 9pm to 7am at the place. Try again after 7am there.")
    #expect(
      AppCopy.notifyNotSaved
        == "Couldn't save your notification choices. The app will try again when you next open it.")
    #expect(AppCopy.cardOn.hasPrefix("Done. You'll get a notification the evening before snow"))
  }

  @Test("where you are: Settings' row, its page and the card (phase 8.4a)")
  func whereYouAre() {
    #expect(AppCopy.notifyHere == "Where you are")
    #expect(AppCopy.notifyPlaceTitle == "Where you are")
    #expect(AppCopy.notifyHereApprox == "Approximate, from your internet connection")
    #expect(AppCopy.notifyHereUnknown == "Not found yet")
    #expect(
      AppCopy.notifyHereKept
        == "Uses your location if you share it, otherwise a rough place from your internet "
        + "connection, which we keep while notifications are on.")
    #expect(AppCopy.notifyHereAbout.hasPrefix("Notifications for where you are use your location"))
    #expect(AppCopy.notifyHereAbout.contains("when you open the app, at most once an hour"))
    #expect(
      AppCopy.cardOffer == "Get a notification the evening before snow is likely where you are.")
    #expect(
      AppCopy.cardOn
        == "Done. You'll get a notification the evening before snow is likely where you are. You "
        + "can change this in Settings.")
    #expect(
      AppCopy.cardOnNamed(place: "Leeds")
        == "Done. You'll get a notification the evening before snow is likely near Leeds. You can "
        + "change this in Settings.")
  }

  @Test("what Your privacy shows is kept, the slots filled, and what its button did (8.2, 8.4a)")
  func kept() {
    #expect(AppCopy.keptID(id: "b8465956") == "ID b8465956")
    #expect(
      AppCopy.keptHere(place: "Leeds", zone: "Europe/London")
        == "Where you are: Leeds, Europe/London")
    #expect(
      AppCopy.keptPlace(place: "Leeds", zone: "Europe/London") == "Leeds, Europe/London")
    #expect(
      AppCopy.keptUnits(label: CoreCopy.snowUnitsLabel, units: CoreCopy.snowUnitName(.c))
        == "Snow units: cm")
    #expect(AppCopy.deleteDone.hasPrefix("Notifications are off. We've deleted"))
    #expect(AppCopy.deleteNotYet.hasPrefix("Couldn't reach our server, so nothing is deleted yet."))
    #expect(AppCopy.privacyForecast.contains("your notification choices and the last forecast"))
  }

  @Test("strings with slots are functions that fill them, the text around kept as it is")
  func slots() {
    #expect(AppCopy.placeButtonLabel(place: "Leeds") == "Place: Leeds. Change place.")
    #expect(
      AppCopy.upgradeRow(price: "£1.99")
        == "No ads, plus widgets for your home and lock screen · £1.99")
    #expect(AppCopy.version(version: "1.0", build: "112") == "Version 1.0 (112)")
    #expect(AppCopy.buy(price: "£1.99") == "Buy for £1.99")
    #expect(AppCopy.agreementShort(snowy: "5", total: "6") == "5 of 6 forecasts")
    #expect(
      AppCopy.reportAdMail(time: "9:05am GMT", place: "Aberdeen")
        == "Time: 9:05am GMT\nPlace: Aberdeen\nWhat was wrong with the ad:\n"
    )
    #expect(AppCopy.placeButtonLabel(place: #"\(x) $1"#) == #"Place: \(x) $1. Change place."#)
  }

  @Test("the widget's words")
  func widget() {
    #expect(AppCopy.widgetLocked == "Open the app to turn on widgets.")
    #expect(AppCopy.widgetStale == "No recent forecast. Open the app to refresh.")
    #expect(AppCopy.widgetSlotAnswer(slot: "Tomorrow", answer: "Yes.") == "Tomorrow · Yes.")
    #expect(AppCopy.widgetSlotLine(slot: "Today", text: "Too warm") == "Today: Too warm")
    #expect(AppCopy.widgetBandAmount(band: "Heavy snow", amount: "5cm") == "Heavy snow · 5cm")
    #expect(
      AppCopy.widgetBandAmountSpoken(band: "Heavy snow", amount: "5cm") == "Heavy snow, 5cm")
    #expect(
      AppCopy.widgetHeading(place: "Durham", slot: "Tomorrow", answer: "Yes.")
        == "Durham. Tomorrow: Yes.")
    #expect(
      AppCopy.widgetSentence(
        heading: "Durham. Tomorrow: Yes.", detail: "Snow, 4cm",
        agreement: "6 of 6 forecasts expect snow")
        == "Durham. Tomorrow: Yes. Snow, 4cm. 6 of 6 forecasts expect snow.")
    #expect(
      AppCopy.widgetSentenceShort(heading: "Tomorrow: Yes.", detail: "Snow, 4cm")
        == "Tomorrow: Yes. Snow, 4cm.")
    #expect(
      AppCopy.widgetGauge(slot: "Tomorrow", agreement: "6 of 6 forecasts expect snow")
        == "Tomorrow: 6 of 6 forecasts expect snow.")
    #expect(
      AppCopy.widgetNow(answer: "No.", verdict: "Too warm for snow.") == "No. Too warm for snow.")
  }
}
