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
  }

  @Test("strings with slots are functions that fill them, the text around kept as it is")
  func slots() {
    #expect(AppCopy.placeButtonLabel(place: "Leeds") == "Place: Leeds. Change place.")
    #expect(
      AppCopy.upgradeRow(price: "£1.99")
        == "No ads, plus widgets for your home and lock screen · £1.99")
    #expect(AppCopy.version(version: "1.0", build: "112") == "Version 1.0 (112)")
    #expect(AppCopy.agreementShort(snowy: "5", total: "6") == "5 of 6 forecasts")
    #expect(
      AppCopy.reportAdMail(time: "9:05am GMT", place: "Aberdeen")
        == "Time: 9:05am GMT\nPlace: Aberdeen\nWhat was wrong with the ad:\n"
    )
    #expect(AppCopy.intentPhrase(app: "Shortcuts") == "Will it snow tomorrow in Shortcuts?")
    #expect(AppCopy.placeButtonLabel(place: #"\(x) $1"#) == #"Place: \(x) $1. Change place."#)
  }
}
