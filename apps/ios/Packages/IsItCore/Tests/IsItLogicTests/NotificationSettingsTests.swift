import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

/// Leeds, a city page, and Durham.
private let leeds = Target.city(slug: "leeds-gb", name: "Leeds")
private let durham = Target.city(slug: "durham-gb", name: "Durham")

/// The phone's own point in Leeds, on the forecast grid.
private let leedsCell = Target.device(lat: 53.8, lon: -1.55)

/// The places on screen the tests show: Leeds's page, the phone's point in Leeds, approximate IP
/// location (named by its answer), Durham's page and Reykjavík's.
private let onLeeds = OnScreen(target: leeds, name: "Leeds", country: "GB", units: .c)
private let onCell = OnScreen(target: leedsCell, name: "Leeds", country: "GB", units: .c)
private let onIP = OnScreen(target: .ip, name: "Leeds", country: "GB", units: .c)
private let onDurham = OnScreen(target: durham, name: "Durham", country: "GB", units: .c)
private let onReykjavik = OnScreen(
  target: .city(slug: "reykjavik-is", name: "Reykjavík"), name: "Reykjavík", country: "IS",
  units: .c)

/// Notifications with `prefs` on and `place` kept, in `permission`, with `registration`.
private func state(
  _ prefs: AlertPrefs = AlertPrefs(), place: AlertPlace? = nil,
  permission: AlertSync.Permission = .authorized, registration: AlertRegistration? = nil
) -> NotificationsState {
  NotificationsState(
    settings: AlertSettings(prefs: prefs, place: place), permission: permission,
    registration: registration)
}

extension NotificationSettings {
  /// The switches, in order.
  var switches: [Switch] {
    items.compactMap { if case .toggle(let row) = $0 { row } else { nil } }
  }

  /// The rows that act, in order.
  var rows: [SettingsScreen.Row] {
    items.compactMap { if case .row(let row) = $0 { row } else { nil } }
  }

  /// The place row.
  var placeRow: PlaceRow? {
    items.lazy.compactMap { if case .place(let row) = $0 { row } else { nil } }.first
  }

  /// Each item's identifier, in order.
  var ids: [String] {
    items.map {
      switch $0 {
      case .toggle(let row): row.id
      case .place(let row): row.id
      case .row(let row): row.id
      }
    }
  }

  /// Every string the section shows.
  var words: [String] {
    var all = [heading, footer.text] + [notice?.text, status?.text].compactMap { $0 }
    for item in items {
      switch item {
      case .toggle(let row): all += [row.title, row.note]
      case .place(let row): all += [row.title, row.value, row.note].compactMap { $0 }
      case .row(let row): all += [row.title, row.detail].compactMap { $0 }
      }
    }
    return all + [warnings?.title].compactMap { $0 }
  }
}

extension NotificationPlacePage {
  /// Every string the page shows.
  var words: [String] {
    [title] + choices.flatMap { [$0.title, $0.note].compactMap { $0 } }
      + [problem?.text, openSettings?.title].compactMap { $0 }
  }
}

/// Settings → Notifications and the place page (section 12.1), as plain values.
@Suite("Settings → Notifications, as plain values")
struct NotificationSettingsTests {
  @Test("at approximate location with nothing kept: the line, Use my location and Search only")
  func theGateAtApproximateLocation() {
    let section = NotificationSettings(state(), onScreen: onIP)
    #expect(section.heading == "Notifications")
    #expect(section.notice?.id == "notify-notice")
    #expect(section.notice?.text == AppCopy.needsPlace)
    #expect(
      section.notice?.text
        == "Choose a place for notifications: use your location or search for a town.")
    #expect(
      section.items == [
        .row(
          SettingsScreen.Row(
            id: "notify-use-my-location", title: "Use my location",
            action: .notification(.useMyLocation), icon: .useMyLocation)),
        .row(
          SettingsScreen.Row(
            id: "notify-search", title: "Search", action: .notification(.search), icon: .search)),
      ])
    #expect(section.switches.isEmpty)
    #expect(section.status == nil)
    #expect(section.footer.id == "notify-footer")
    #expect(section.footer.text == AppCopy.notifyFooter)
    #expect(section.warnings == nil)
    // Denied changes nothing here: there is no place to turn anything on for.
    #expect(NotificationSettings(state(permission: .denied), onScreen: onIP) == section)
  }

  @Test("a place already kept needs no gate, at approximate location too")
  func aKeptPlaceNeedsNoGate() {
    let section = NotificationSettings(
      state(place: .chosen(leeds, name: "Leeds")), onScreen: onIP)
    #expect(section.notice == nil)
    #expect(section.ids == ["notify-evening", "notify-morning", "notify-place"])
    #expect(section.placeRow?.value == "Leeds")
  }

  @Test("the switches: evening and morning, then possible only while one of them is on")
  func theSwitchesAndTheirNotes() {
    let off = NotificationSettings(state(), onScreen: onLeeds)
    #expect(off.switches.map(\.id) == ["notify-evening", "notify-morning"])
    #expect(off.switches.map(\.kind) == [.evening, .morning])
    #expect(off.switches.map(\.title) == ["Evening before (about 6pm)", "On the day (about 7am)"])
    #expect(
      off.switches.map(\.note) == ["When snow is likely tomorrow.", "When snow is likely today."])
    #expect(off.switches.map(\.icon) == [.evening, .morning])
    #expect(off.switches.map(\.isOn) == [false, false])
    // "Possible" kept on alone (as no rule leaves it) still counts as off.
    let alone = NotificationSettings(state(AlertPrefs(possible: true)), onScreen: onLeeds)
    #expect(alone.switches.map(\.id) == ["notify-evening", "notify-morning"])

    let evening = NotificationSettings(
      state(AlertPrefs(evening: true), place: .chosen(leeds, name: "Leeds")), onScreen: onLeeds)
    #expect(evening.switches.map(\.id) == ["notify-evening", "notify-morning", "notify-possible"])
    #expect(evening.switches.map(\.isOn) == [true, false, false])
    let possible = evening.switches[2]
    #expect(possible.kind == .possible)
    #expect(possible.title == "Also when snow is possible")
    #expect(possible.note == "When some forecasts expect snow, but not most.")
    #expect(possible.icon == .possible)
    let all = NotificationSettings(
      state(AlertPrefs(evening: true, morning: true, possible: true)), onScreen: onLeeds)
    #expect(all.switches.map(\.isOn) == [true, true, true])
    let morning = NotificationSettings(state(AlertPrefs(morning: true)), onScreen: onLeeds)
    #expect(morning.switches.map(\.isOn) == [false, true, false])
    // The place, then the test, follow the switches.
    #expect(
      evening.ids == [
        "notify-evening", "notify-morning", "notify-possible", "notify-place", "notify-test",
      ])
  }

  @Test("refused in Settings: the line, Open Settings first, then the switches, all off")
  func deniedSaysSo() throws {
    let section = NotificationSettings(
      state(place: .chosen(leeds, name: "Leeds"), permission: .denied), onScreen: onLeeds)
    #expect(section.notice?.id == "notify-notice")
    #expect(section.notice?.text == "Notifications are off for this app in Settings.")
    let first = try #require(section.rows.first)
    #expect(
      first
        == SettingsScreen.Row(
          id: "notify-open-settings", title: "Open Settings",
          action: .notification(.openNotificationSettings), icon: .openSettings))
    #expect(
      section.ids == ["notify-open-settings", "notify-evening", "notify-morning", "notify-place"])
    #expect(section.switches.allSatisfy { !$0.isOn })
    for permission in [AlertSync.Permission.authorized, .provisional, .notDetermined] {
      let other = NotificationSettings(
        state(place: .chosen(leeds, name: "Leeds"), permission: permission), onScreen: onLeeds)
      #expect(other.notice == nil, "\(permission)")
      #expect(!other.ids.contains("notify-open-settings"), "\(permission)")
    }
  }

  @Test("the place row: the chosen place's name, the registration's, or Your location")
  func thePlaceRow() throws {
    let chosen = try #require(
      NotificationSettings(state(place: .chosen(leeds, name: "Leeds")), onScreen: onDurham)
        .placeRow)
    #expect(chosen.id == "notify-place")
    #expect(chosen.title == "Place")
    #expect(chosen.value == "Leeds")
    #expect(chosen.note == nil)
    #expect(chosen.icon == .notificationPlace)
    // Chosen before the screen had a name for it: the server's name, for that place only.
    let leedsRecord = try registration("put-leeds")
    let unnamed = AlertPlace.chosen(.city(slug: "leeds-gb"), name: "")
    #expect(
      NotificationSettings(state(place: unnamed, registration: leedsRecord), onScreen: onDurham)
        .placeRow?.value == "Leeds")
    #expect(
      NotificationSettings(state(place: unnamed), onScreen: onDurham).placeRow?.value == nil)
    let durhamRecord = try registration("put-durham")
    #expect(
      NotificationSettings(state(place: unnamed, registration: durhamRecord), onScreen: onDurham)
        .placeRow?.value == nil)
    let follows = try #require(
      NotificationSettings(state(place: .follows(leedsCell)), onScreen: onDurham).placeRow)
    #expect(follows.value == "Your location")
    #expect(follows.value == CoreCopy.yourLocation)
    #expect(follows.note == "Follows your location each time you open the app.")
    // Before any is kept: the place on screen, as the first switch would keep it.
    #expect(NotificationSettings(state(), onScreen: onLeeds).placeRow?.value == "Leeds")
    #expect(NotificationSettings(state(), onScreen: onCell).placeRow?.value == "Your location")
    let nameless = OnScreen(target: .city(slug: "leeds-gb"), name: nil, country: nil, units: nil)
    #expect(NotificationSettings(state(), onScreen: nameless).placeRow?.value == nil)
  }

  @Test("the test row, while a notification is on: its outcome in words, busy while sending")
  func theTestRowWhileOn() throws {
    let off = NotificationSettings(state(place: .chosen(leeds, name: "Leeds")), onScreen: onLeeds)
    #expect(!off.ids.contains("notify-test"))
    let possibleAlone = NotificationSettings(
      state(AlertPrefs(possible: true), place: .chosen(leeds, name: "Leeds")), onScreen: onLeeds)
    #expect(!possibleAlone.ids.contains("notify-test"))

    func row(_ test: NotificationsState.Test, _ prefs: AlertPrefs = AlertPrefs(evening: true))
      throws -> SettingsScreen.Row
    {
      var shown = state(prefs, place: .chosen(leeds, name: "Leeds"))
      shown.test = test
      let section = NotificationSettings(shown, onScreen: onLeeds)
      return try #require(section.rows.first { $0.id == "notify-test" })
    }
    #expect(
      try row(.idle)
        == SettingsScreen.Row(
          id: "notify-test", title: "Send a test notification", action: .notification(.sendTest),
          icon: .test))
    #expect(try row(.idle, AlertPrefs(morning: true)).id == "notify-test")
    #expect(try row(.sending).busy)
    #expect(try row(.sending).detail == nil)
    #expect(try !row(.done(.sent)).busy)
    #expect(try row(.done(.sent)).detail == "Sent. It should arrive in a few seconds.")
    #expect(
      try row(.done(.dryRun)).detail
        == "Our server isn't sending notifications yet, so nothing was sent.")
    #expect(
      try row(.done(.limited)).detail
        == "You can send 3 test notifications an hour. Try again later.")
    #expect(
      try row(.done(.quiet)).detail
        == "Nothing is sent from 9pm to 7am at the place. Try again after 7am there.")
    for outcome in [AlertSync.TestOutcome.notRegistered, .failed] {
      #expect(
        try row(.done(outcome)).detail == "Couldn't send a test notification. Try again later.")
    }
  }

  @Test("the status line: a change not saved, or the server's own words for a place")
  func theStatusLine() {
    var shown = state(AlertPrefs(evening: true), place: .chosen(leeds, name: "Leeds"))
    #expect(NotificationSettings(shown, onScreen: onLeeds).status == nil)
    shown.status = .notSaved
    let notSaved = NotificationSettings(shown, onScreen: onLeeds).status
    #expect(notSaved?.id == "notify-status")
    #expect(
      notSaved?.text
        == "Couldn't save your notification choices. The app will try again when you next open it.")
    shown.status = .placeRefused("There is no page for that place.")
    #expect(
      NotificationSettings(shown, onScreen: onLeeds).status?.text
        == "There is no page for that place.")
    shown.status = .ok
    #expect(NotificationSettings(shown, onScreen: onLeeds).status == nil)
  }

  @Test("the Met Office's warnings, for a UK place only")
  func theMetOfficeLinkForUKPlaces() throws {
    let uk = try #require(
      NotificationSettings(state(place: .chosen(leeds, name: "Leeds")), onScreen: onReykjavik)
        .warnings)
    let url = try #require(
      URL(string: "https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings"))
    #expect(
      uk
        == SettingsScreen.Row(
          id: "notify-warnings", title: "Met Office warnings", action: .open(url), icon: .warnings))
    // Before any is kept, the place on screen's.
    #expect(NotificationSettings(state(), onScreen: onLeeds).warnings == uk)
    let reykjavik = AlertPlace.chosen(.city(slug: "reykjavik-is"), name: "Reykjavík")
    #expect(NotificationSettings(state(place: reykjavik), onScreen: onLeeds).warnings == nil)
    #expect(NotificationSettings(state(), onScreen: onReykjavik).warnings == nil)
    // The phone's cell: the answer on that cell says the country.
    #expect(
      NotificationSettings(state(place: .follows(leedsCell)), onScreen: onCell).warnings == uk)
    #expect(
      NotificationSettings(state(place: .follows(leedsCell)), onScreen: onLeeds).warnings == nil)
  }

  @Test("the place page: the kept place, the place on screen, and the phone's location")
  func thePlacePage() throws {
    let fresh = NotificationPlacePage(state(), onScreen: onLeeds)
    #expect(fresh.title == "Notification place")
    #expect(fresh.choices.map(\.id) == ["notify-place-on-screen", "notify-place-my-location"])
    let onScreen = fresh.choices[0]
    #expect(onScreen.title == "Use the place on screen: Leeds")
    #expect(onScreen.note == nil)
    #expect(onScreen.icon == .onScreenPlace)
    #expect(onScreen.selected)
    #expect(!onScreen.busy)
    #expect(onScreen.choice == .onScreen(leeds, name: "Leeds"))
    let myLocation = fresh.choices[1]
    #expect(myLocation.title == "Use my location")
    #expect(myLocation.note == "Follows your location each time you open the app.")
    #expect(myLocation.icon == .myLocation)
    #expect(!myLocation.selected)
    #expect(!myLocation.busy)
    #expect(myLocation.choice == .myLocation)
    #expect(fresh.problem == nil)
    #expect(fresh.openSettings == nil)

    let keptHere = NotificationPlacePage(
      state(place: .chosen(leeds, name: "Leeds")), onScreen: onLeeds)
    #expect(keptHere.choices.map(\.id) == ["notify-place-on-screen", "notify-place-my-location"])
    #expect(keptHere.choices.map(\.selected) == [true, false])

    let keptElsewhere = NotificationPlacePage(
      state(place: .chosen(leeds, name: "Leeds")), onScreen: onDurham)
    #expect(
      keptElsewhere.choices.map(\.id) == [
        "notify-place-kept", "notify-place-on-screen", "notify-place-my-location",
      ])
    #expect(
      keptElsewhere.choices.map(\.title) == [
        "Leeds", "Use the place on screen: Durham", "Use my location",
      ])
    #expect(keptElsewhere.choices.map(\.selected) == [true, false, false])
    #expect(
      keptElsewhere.choices.map(\.choice) == [
        .kept, .onScreen(durham, name: "Durham"), .myLocation,
      ])
    #expect(keptElsewhere.choices[0].icon == .notificationPlace)
    #expect(keptElsewhere.choices[0].note == nil)
    // A kept place with no name of its own takes the server's.
    let unnamed = NotificationPlacePage(
      state(
        place: .chosen(.city(slug: "leeds-gb"), name: ""),
        registration: try registration("put-leeds")),
      onScreen: onDurham)
    #expect(unnamed.choices.first?.title == "Leeds")

    let follows = NotificationPlacePage(state(place: .follows(leedsCell)), onScreen: onDurham)
    #expect(follows.choices.map(\.selected) == [false, true])
    // The phone's point on screen, before any is kept, is followed.
    #expect(
      NotificationPlacePage(state(), onScreen: onCell).choices.map(\.id) == [
        "notify-place-my-location"
      ])
    #expect(NotificationPlacePage(state(), onScreen: onCell).choices.map(\.selected) == [true])
    // Approximate location is never a place to choose; nor a city with no name yet.
    #expect(
      NotificationPlacePage(state(), onScreen: onIP).choices.map(\.id) == [
        "notify-place-my-location"
      ])
    #expect(NotificationPlacePage(state(), onScreen: onIP).choices.map(\.selected) == [false])
    let nameless = OnScreen(target: .city(slug: "leeds-gb"), name: nil, country: nil, units: nil)
    #expect(
      NotificationPlacePage(state(), onScreen: nameless).choices.map(\.id) == [
        "notify-place-my-location"
      ])
    // A searched place on screen can be chosen.
    let biel = Target.coords(
      Target.Coordinates(source: .search, lat: 47.15, lon: 7.25, name: "Biel/Bienne"))
    let onBiel = OnScreen(target: biel, name: "Biel/Bienne", country: "CH", units: .c)
    #expect(
      NotificationPlacePage(state(), onScreen: onBiel).choices.first?.choice
        == .onScreen(biel, name: "Biel/Bienne"))

    var locating = state(place: .chosen(leeds, name: "Leeds"))
    locating.locating = true
    let busy = NotificationPlacePage(locating, onScreen: onLeeds)
    #expect(busy.choices.map(\.busy) == [false, true])
  }

  @Test("the place page's problems: location off, with Open Settings; no fix, without")
  func thePlacePageProblems() {
    var denied = state()
    denied.placeProblem = .locationDenied
    let off = NotificationPlacePage(denied, onScreen: onLeeds)
    #expect(off.problem?.id == "notify-place-problem")
    #expect(off.problem?.text == "Location access is off for this app in Settings.")
    #expect(
      off.openSettings
        == SettingsScreen.Row(
          id: "notify-place-open-settings", title: "Open Settings",
          action: .notification(.openLocationSettings), icon: .openSettings))
    var unavailable = state()
    unavailable.placeProblem = .locationUnavailable
    let none = NotificationPlacePage(unavailable, onScreen: onLeeds)
    #expect(none.problem?.id == "notify-place-problem")
    #expect(
      none.problem?.text == "Couldn't find your location. Try again, or use the place on screen.")
    #expect(none.openSettings == nil)
  }

  @Test("no fix with no place on screen to choose: try again, and nothing more")
  func noFixWithoutThePlaceOnScreen() throws {
    var unavailable = state()
    unavailable.placeProblem = .locationUnavailable
    // The phone's own point and approximate location are never offered, nor a place unnamed.
    let unnamed = OnScreen(target: durham, name: nil, country: "GB", units: .c)
    for screen in [onCell, onIP, unnamed] {
      let page = NotificationPlacePage(unavailable, onScreen: screen)
      #expect(!page.choices.contains { $0.id == "notify-place-on-screen" }, "\(screen)")
      #expect(page.problem?.id == "notify-place-problem")
      #expect(page.problem?.text == "Couldn't find your location. Try again.", "\(screen)")
      #expect(page.problem?.text == AppCopy.notifyLocationTryAgain)
      #expect(page.openSettings == nil)
    }
  }

  @Test("every word in every state is about snow, in British English, with an id each")
  func snowOnlyBritish() throws {
    let records = [nil, try registration("put-leeds"), try registration("put-device")]
    let places: [AlertPlace?] = [
      nil, .chosen(leeds, name: "Leeds"), .chosen(.city(slug: "leeds-gb"), name: ""),
      .follows(leedsCell),
    ]
    let prefs = [
      AlertPrefs(), AlertPrefs(evening: true), AlertPrefs(morning: true, possible: true),
    ]
    let tests: [NotificationsState.Test] =
      [.idle, .sending] + AlertSync.TestOutcome.allCases.map { .done($0) }
    let statuses: [NotificationsState.Status] = [.ok, .notSaved, .placeRefused("Words.")]
    let problems: [NotificationsState.PlaceProblem?] = [
      nil, .locationDenied, .locationUnavailable,
    ]
    var count = 0
    for permission in AlertSync.Permission.allCases {
      for place in places {
        for on in prefs {
          for record in records {
            for screen in [onLeeds, onCell, onIP, onDurham, onReykjavik] {
              // Each result in turn, so every one meets every kind of place and permission.
              var shown = state(on, place: place, permission: permission, registration: record)
              shown.test = tests[count % tests.count]
              shown.status = statuses[count % statuses.count]
              shown.placeProblem = problems[count % problems.count]
              shown.locating = count % 2 == 0
              count += 1
              let section = NotificationSettings(shown, onScreen: screen)
              let page = NotificationPlacePage(shown, onScreen: screen)
              for word in section.words + page.words {
                #expect(otherTopic(in: word) == nil, "\(word)")
                #expect(!word.isEmpty)
                #expect(!word.lowercased().contains("alert"), "\(word)")
              }
              #expect(Set(section.ids).count == section.ids.count)
              #expect(Set(page.choices.map(\.id)).count == page.choices.count)
            }
          }
        }
      }
    }
  }
}
