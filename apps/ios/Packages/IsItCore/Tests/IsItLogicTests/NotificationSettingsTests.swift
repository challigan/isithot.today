import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

/// The phone's own cell in Leeds, as `AlertSync.here` gives it.
private let leedsCell = HerePlace.device(Target.Coordinates(source: .device, lat: 53.8, lon: -1.55))

/// Notifications with `prefs` on, where you are `here` (refused when `refused`), in
/// `permission` and location `access`, with `registration`.
private func state(
  _ prefs: AlertPrefs = AlertPrefs(), here: HerePlace = .ip, refused: Bool = false,
  permission: AlertSync.Permission = .authorized,
  access: AlertSync.LocationAccess = .notDetermined, registration: AlertRegistration? = nil
) -> NotificationsState {
  NotificationsState(
    settings: AlertSettings(prefs: prefs, here: here.cell), permission: permission,
    locationAccess: access, here: HereState(place: here, refused: refused),
    registration: registration)
}

/// `record` with its answer's `here` replaced: none, or one of another name or country.
private func answer(_ record: AlertRegistration, here: DeviceResponse.Here?)
  -> AlertRegistration
{
  var changed = record
  let response = record.response
  changed.response = DeviceResponse(
    id: response.id, deviceTz: response.deviceTz, here: here, saved: response.saved,
    refused: response.refused, alerts: response.alerts, seenAt: response.seenAt)
  return changed
}

/// The evening on.
private let evening = AlertPrefs(evening: true)

extension NotificationSettings {
  /// The switches, in order.
  var switches: [Switch] {
    items.compactMap { if case .toggle(let row) = $0 { row } else { nil } }
  }

  /// The rows that act, in order.
  var rows: [SettingsScreen.Row] {
    items.compactMap { if case .row(let row) = $0 { row } else { nil } }
  }

  /// The "Where you are" row.
  var hereRow: HereRow? {
    items.lazy.compactMap { if case .here(let row) = $0 { row } else { nil } }.first
  }

  /// The lines among the items.
  var lines: [Line] {
    items.compactMap { if case .line(let line) = $0 { line } else { nil } }
  }

  /// Each item's identifier, in order.
  var ids: [String] {
    items.map {
      switch $0 {
      case .toggle(let row): row.id
      case .line(let line): line.id
      case .here(let row): row.id
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
      case .line(let line): all.append(line.text)
      case .here(let row): all += [row.title, row.value, row.note].compactMap { $0 }
      case .row(let row): all += [row.title, row.detail].compactMap { $0 }
      }
    }
    return all + [warnings?.title].compactMap { $0 }
  }
}

extension NotificationPlacePage {
  /// Every string the page shows.
  var words: [String] {
    [title, about.text, place.title, place.note] + [place.value].compactMap { $0 }
      + [useMyLocation?.title, problem?.text, openSettings?.title].compactMap { $0 }
  }

  /// Every identifier on the page, in order.
  var ids: [String] {
    [about.id, place.id] + [useMyLocation?.id, problem?.id, openSettings?.id].compactMap { $0 }
  }
}

/// Settings → Notifications and the "Where you are" page (design 2.1, 2.4), as plain values.
@Suite("Settings → Notifications, as plain values")
struct NotificationSettingsTests {
  @Test("approximate location needs no place first: the switches, the kept line and the row")
  func noGate() throws {
    let section = NotificationSettings(state())
    #expect(section.heading == "Notifications")
    #expect(section.notice == nil)
    #expect(section.ids == ["notify-evening", "notify-morning", "notify-here-kept", "notify-here"])
    #expect(section.status == nil)
    #expect(section.footer.id == "notify-footer")
    #expect(section.footer.text == AppCopy.notifyFooter)
    #expect(section.warnings == nil)
    let kept = try #require(section.lines.first)
    #expect(kept.id == "notify-here-kept")
    #expect(
      kept.text
        == "Uses your location if you share it, otherwise a rough place from your internet "
        + "connection, which we keep while notifications are on.")
    #expect(kept.text == AppCopy.notifyHereKept)
    // The phone's cell, or location access never asked or refused, changes nothing here.
    for access in AlertSync.LocationAccess.allCases {
      for here in [HerePlace.ip, leedsCell] {
        #expect(NotificationSettings(state(here: here, access: access)).ids == section.ids)
      }
    }
  }

  @Test("the switches: evening and morning, then possible only while one of them is on")
  func theSwitchesAndTheirNotes() throws {
    let off = NotificationSettings(state())
    #expect(off.switches.map(\.id) == ["notify-evening", "notify-morning"])
    #expect(off.switches.map(\.kind) == [.evening, .morning])
    #expect(off.switches.map(\.title) == ["Evening before (about 6pm)", "On the day (about 7am)"])
    #expect(
      off.switches.map(\.note) == ["When snow is likely tomorrow.", "When snow is likely today."])
    #expect(off.switches.map(\.icon) == [.evening, .morning])
    #expect(off.switches.map(\.isOn) == [false, false])
    // "Possible" kept on alone (as no rule leaves it) still counts as off.
    let alone = NotificationSettings(state(AlertPrefs(possible: true)))
    #expect(alone.switches.map(\.id) == ["notify-evening", "notify-morning"])

    let on = NotificationSettings(state(evening))
    #expect(on.switches.map(\.id) == ["notify-evening", "notify-morning", "notify-possible"])
    #expect(on.switches.map(\.isOn) == [true, false, false])
    let possible = try #require(on.switches.dropFirst(2).first)
    #expect(possible.kind == .possible)
    #expect(possible.title == "Also when snow is possible")
    #expect(possible.note == "When some forecasts expect snow, but not most.")
    #expect(possible.icon == .possible)
    let all = NotificationSettings(state(AlertPrefs(evening: true, morning: true, possible: true)))
    #expect(all.switches.map(\.isOn) == [true, true, true])
    let morning = NotificationSettings(state(AlertPrefs(morning: true)))
    #expect(morning.switches.map(\.isOn) == [false, true, false])
    // Under the switches, the kept line, the row, then the test.
    #expect(
      on.ids == [
        "notify-evening", "notify-morning", "notify-possible", "notify-here-kept", "notify-here",
        "notify-test",
      ])
  }

  @Test("refused in Settings: the line, Open Settings first, then the switches, all off")
  func deniedSaysSo() throws {
    let section = NotificationSettings(state(permission: .denied))
    #expect(section.notice?.id == "notify-notice")
    #expect(section.notice?.text == "Notifications are off for this app in Settings.")
    let first = try #require(section.rows.first)
    #expect(
      first
        == SettingsScreen.Row(
          id: "notify-open-settings", title: "Open Settings",
          action: .notification(.openNotificationSettings), icon: .openSettings))
    #expect(
      section.ids == [
        "notify-open-settings", "notify-evening", "notify-morning", "notify-here-kept",
        "notify-here",
      ])
    #expect(section.switches.allSatisfy { !$0.isOn })
    for permission in [AlertSync.Permission.authorized, .provisional, .notDetermined] {
      let other = NotificationSettings(state(permission: permission))
      #expect(other.notice == nil, "\(permission)")
      #expect(!other.ids.contains("notify-open-settings"), "\(permission)")
    }
  }

  @Test("the row before an answer: where you are and how it is found, with no town")
  func theRowBeforeAnAnswer() throws {
    let approximate = try #require(NotificationSettings(state(evening)).hereRow)
    #expect(approximate.id == "notify-here")
    #expect(approximate.title == "Where you are")
    #expect(approximate.title == AppCopy.notifyHere)
    #expect(approximate.value == nil)
    #expect(approximate.note == "Approximate, from your internet connection")
    #expect(approximate.icon == .notificationPlace)
    let phone = try #require(NotificationSettings(state(evening, here: leedsCell)).hereRow)
    #expect(phone.value == nil)
    #expect(phone.note == "Your location")
    #expect(phone.note == CoreCopy.yourLocation)
  }

  @Test("the row after an answer: the server's town, for the kind of place it was about")
  func theRowAfterAnAnswer() throws {
    func row(_ here: HerePlace, _ name: String) throws -> NotificationSettings.HereRow {
      try #require(
        NotificationSettings(state(evening, here: here, registration: try registration(name)))
          .hereRow)
    }
    #expect(try row(.ip, "put-here-ip").value == "Leeds")
    #expect(try row(.ip, "put-here-ip").note == "Approximate, from your internet connection")
    #expect(try row(leedsCell, "put-here-device").value == "Leeds")
    #expect(try row(leedsCell, "put-here-device").note == "Your location")
    // An hour later the connection is in Newcastle.
    #expect(try row(.ip, "put-here-refresh").value == "Newcastle")
    // An answer about the other kind names no town: access withdrawn since, or given since.
    #expect(try row(.ip, "put-here-device").value == nil)
    #expect(try row(.ip, "put-here-device").note == "Approximate, from your internet connection")
    #expect(try row(leedsCell, "put-here-ip").value == nil)
    #expect(try row(leedsCell, "put-here-ip").note == "Your location")
  }

  @Test("a point with no town near shows no value, never core's Your location as a town")
  func anUnnamedPlace() throws {
    let far = answer(
      try registration("put-here-device"),
      here: DeviceResponse.Here(
        name: "Your location", timezone: "Etc/GMT+2", query: "lat=0&lon=-30&source=device",
        country: nil, follows: .device))
    let cell = HerePlace.device(Target.Coordinates(source: .device, lat: 0, lon: -30))
    let row = try #require(
      NotificationSettings(state(evening, here: cell, registration: far)).hereRow)
    #expect(row.value == nil)
    #expect(row.note == "Your location")
  }

  @Test("Not found yet only once the server found no place: here null, or its refusal")
  func notFoundYet() throws {
    let nowhere = answer(try registration("put-here-ip"), here: nil)
    let unlocated = try #require(
      NotificationSettings(state(evening, registration: nowhere)).hereRow)
    #expect(unlocated.value == nil)
    #expect(unlocated.note == "Not found yet")
    #expect(unlocated.note == AppCopy.notifyHereUnknown)
    let refused = try #require(NotificationSettings(state(evening, refused: true)).hereRow)
    #expect(refused.value == nil)
    #expect(refused.note == "Not found yet")
    // The phone's cell is the phone's location whatever the server said before.
    let phone = try #require(
      NotificationSettings(state(evening, here: leedsCell, refused: true, registration: nowhere))
        .hereRow)
    #expect(phone.note == "Your location")
    // Before any answer, with nothing refused, approximate.
    #expect(NotificationSettings(state(evening)).hereRow?.note == AppCopy.notifyHereApprox)
  }

  @Test("with both switches off nothing is sent, so the row shows the kind alone, no town")
  func offShowsTheKindAlone() throws {
    let kept = try registration("put-here-ip")
    let off = try #require(NotificationSettings(state(registration: kept)).hereRow)
    #expect(off.value == nil)
    #expect(off.note == "Approximate, from your internet connection")
    let refusedOff = try #require(
      NotificationSettings(state(refused: true, registration: answer(kept, here: nil))).hereRow)
    #expect(refusedOff.value == nil)
    #expect(refusedOff.note == "Approximate, from your internet connection")
    let phoneOff = try #require(
      NotificationSettings(
        state(here: leedsCell, registration: try registration("put-here-device"))
      )
      .hereRow)
    #expect(phoneOff.value == nil)
    #expect(phoneOff.note == "Your location")
    // "Possible" alone switches nothing on.
    #expect(
      NotificationSettings(state(AlertPrefs(possible: true), registration: kept)).hereRow?.value
        == nil)
  }

  @Test("the test row, while a notification is on: its outcome in words, busy while sending")
  func theTestRowWhileOn() throws {
    let off = NotificationSettings(state())
    #expect(!off.ids.contains("notify-test"))
    let possibleAlone = NotificationSettings(state(AlertPrefs(possible: true)))
    #expect(!possibleAlone.ids.contains("notify-test"))

    func row(_ test: NotificationsState.Test, _ prefs: AlertPrefs = evening) throws
      -> SettingsScreen.Row
    {
      var shown = state(prefs)
      shown.test = test
      return try #require(NotificationSettings(shown).rows.first { $0.id == "notify-test" })
    }
    #expect(
      try row(.idle)
        == SettingsScreen.Row(
          id: "notify-test", title: "Send a test notification", action: .notification(.sendTest),
          icon: .test))
    #expect(try row(.idle, AlertPrefs(morning: true)).id == "notify-test")
    #expect(try row(.sending).busy)
    #expect(try row(.sending).detail == nil)
    #expect(try !row(.done(.sent(count: 1))).busy)
    #expect(try row(.done(.sent(count: 1))).detail == "Sent. It should arrive in a few seconds.")
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

  @Test("the status line: a change not saved, or the server's own words for where you are")
  func theStatusLine() {
    var shown = state(evening)
    #expect(NotificationSettings(shown).status == nil)
    shown.status = .notSaved
    let notSaved = NotificationSettings(shown).status
    #expect(notSaved?.id == "notify-status")
    #expect(
      notSaved?.text
        == "Couldn't save your notification choices. The app will try again when you next open it.")
    let words =
      "We couldn't tell where you are from your internet connection. Try again later, or use "
      + "your location."
    shown.status = .placeRefused(words)
    #expect(NotificationSettings(shown).status?.text == words)
    shown.status = .ok
    #expect(NotificationSettings(shown).status == nil)
  }

  @Test("the Met Office's warnings while where you are is in the UK, by the server's country")
  func theMetOfficeLinkForUKPlaces() throws {
    let leeds = try registration("put-here-ip")
    let uk = try #require(NotificationSettings(state(evening, registration: leeds)).warnings)
    let url = try #require(
      URL(string: "https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings"))
    #expect(
      uk
        == SettingsScreen.Row(
          id: "notify-warnings", title: "Met Office warnings", action: .open(url), icon: .warnings))
    #expect(
      NotificationSettings(
        state(evening, here: leedsCell, registration: try registration("put-here-device"))
      ).warnings == uk)
    // Whatever kind of place the answer was about: its country is where the phone is.
    #expect(
      NotificationSettings(state(evening, here: leedsCell, registration: leeds)).warnings == uk)
    let reykjavik = answer(
      leeds,
      here: DeviceResponse.Here(
        name: "Reykjavík", timezone: "Atlantic/Reykjavik",
        query: "lat=64.15&lon=-21.95&source=device",
        country: "IS", follows: .ip))
    #expect(NotificationSettings(state(evening, registration: reykjavik)).warnings == nil)
    let far = answer(
      leeds,
      here: DeviceResponse.Here(
        name: "Your location", timezone: "Etc/GMT+2", query: "lat=0&lon=-30&source=device",
        country: nil, follows: .ip))
    #expect(NotificationSettings(state(evening, registration: far)).warnings == nil)
    // No answer, no place in it, or nothing on: no link.
    #expect(NotificationSettings(state(evening)).warnings == nil)
    #expect(
      NotificationSettings(state(evening, registration: answer(leeds, here: nil))).warnings == nil)
    #expect(NotificationSettings(state(registration: leeds)).warnings == nil)
  }

  @Test("the page: how where you are is found, the place now, and Use my location until allowed")
  func thePage() throws {
    let page = NotificationPlacePage(state())
    #expect(page.title == "Where you are")
    #expect(page.title == AppCopy.notifyPlaceTitle)
    #expect(page.about.id == "notify-place-about")
    #expect(
      page.about.text
        == "Notifications for where you are use your location if you share it with the app, "
        + "otherwise a rough place from your internet connection. It's updated when you open the "
        + "app, at most once an hour, and kept only while notifications are on.")
    #expect(page.place.id == "notify-place-here")
    #expect(page.place.title == "Where you are")
    #expect(page.place.value == nil)
    #expect(page.place.note == "Approximate, from your internet connection")
    #expect(page.place.icon == .notificationPlace)
    // Location access never asked: Use my location, which asks at the tap.
    #expect(
      page.useMyLocation
        == SettingsScreen.Row(
          id: "notify-place-my-location", title: "Use my location",
          action: .notification(.useMyLocation), icon: .myLocation))
    #expect(page.problem == nil)
    #expect(page.openSettings == nil)
    var locating = state()
    locating.locating = true
    #expect(NotificationPlacePage(locating).useMyLocation?.busy == true)
    // The page's row says what Settings' says, after an answer too.
    for (here, name) in [(HerePlace.ip, "put-here-ip"), (leedsCell, "put-here-device")] {
      let shown = state(evening, here: here, access: .granted, registration: try registration(name))
      let row = try #require(NotificationSettings(shown).hereRow)
      let placed = NotificationPlacePage(shown).place
      #expect(placed.value == row.value)
      #expect(placed.value == "Leeds")
      #expect(placed.note == row.note)
    }
  }

  @Test("allowed, nothing to do; refused, the line and Open Settings")
  func thePageByAccess() throws {
    let allowed = NotificationPlacePage(state(evening, here: leedsCell, access: .granted))
    #expect(allowed.place.note == "Your location")
    #expect(allowed.useMyLocation == nil)
    #expect(allowed.problem == nil)
    #expect(allowed.openSettings == nil)
    #expect(allowed.ids == ["notify-place-about", "notify-place-here"])
    // Allowed with no fix yet: approximate, and still nothing to do.
    #expect(NotificationPlacePage(state(evening, access: .granted)).useMyLocation == nil)

    let refused = NotificationPlacePage(state(evening, access: .denied))
    #expect(refused.useMyLocation == nil)
    #expect(refused.problem?.id == "notify-place-problem")
    #expect(refused.problem?.text == "Location access is off for this app in Settings.")
    #expect(refused.problem?.text == AppCopy.notifyLocationDenied)
    #expect(
      refused.openSettings
        == SettingsScreen.Row(
          id: "notify-place-open-settings", title: "Open Settings",
          action: .notification(.openLocationSettings), icon: .openSettings))
    #expect(
      refused.ids == [
        "notify-place-about", "notify-place-here", "notify-place-problem",
        "notify-place-open-settings",
      ])
  }

  @Test("no fix at the tap: try again, with Use my location still there")
  func noFix() throws {
    for access in [AlertSync.LocationAccess.granted, .notDetermined] {
      var unavailable = state(access: access)
      unavailable.locationUnavailable = true
      let page = NotificationPlacePage(unavailable)
      #expect(page.useMyLocation?.id == "notify-place-my-location", "\(access)")
      #expect(page.problem?.id == "notify-place-problem")
      #expect(page.problem?.text == "Couldn't find your location. Try again.")
      #expect(page.problem?.text == AppCopy.notifyLocationUnavailable)
      #expect(page.openSettings == nil)
      #expect(
        page.ids == [
          "notify-place-about", "notify-place-here", "notify-place-my-location",
          "notify-place-problem",
        ])
    }
    // Refused since: the refusal's line, not the fix's.
    var refused = state(access: .denied)
    refused.locationUnavailable = true
    let page = NotificationPlacePage(refused)
    #expect(page.problem?.text == AppCopy.notifyLocationDenied)
    #expect(page.useMyLocation == nil)
    #expect(page.openSettings?.id == "notify-place-open-settings")
  }

  @Test("Use my location stays, busy, while it finds the phone, though access is allowed by then")
  func findingThePhone() throws {
    // Allowed at the prompt, or tried again after no fix (which clears that line first): the
    // fix is still to come, so the row that was tapped stays, taking no tap, until it does.
    var finding = state(access: .granted)
    finding.locating = true
    let page = NotificationPlacePage(finding)
    #expect(
      page.useMyLocation
        == SettingsScreen.Row(
          id: "notify-place-my-location", title: "Use my location",
          action: .notification(.useMyLocation), icon: .myLocation, busy: true))
    #expect(page.problem == nil)
    #expect(
      page.ids == ["notify-place-about", "notify-place-here", "notify-place-my-location"])
    // Found: nothing left to do.
    finding.locating = false
    #expect(NotificationPlacePage(finding).useMyLocation == nil)
  }

  @Test("every word in every state is about snow, in British English, with an id each")
  func snowOnlyBritish() throws {
    let records = [
      nil, try registration("put-here-ip"), try registration("put-here-device"),
      try registration("put-here-refresh"), answer(try registration("put-here-ip"), here: nil),
    ]
    let prefs = [
      AlertPrefs(), AlertPrefs(evening: true), AlertPrefs(morning: true, possible: true),
    ]
    let tests: [NotificationsState.Test] =
      [.idle, .sending, .done(.sent(count: 1)), .done(.sent(count: 2))]
      + [.dryRun, .limited, .quiet, .notRegistered, .failed].map { .done($0) }
    let statuses: [NotificationsState.Status] = [.ok, .notSaved, .placeRefused("Words.")]
    var count = 0
    for permission in AlertSync.Permission.allCases {
      for access in AlertSync.LocationAccess.allCases {
        for here in [HerePlace.ip, leedsCell] {
          for on in prefs {
            for record in records {
              // Each result in turn, so every one meets every kind of place and permission.
              var shown = state(
                on, here: here, refused: count % 3 == 0, permission: permission, access: access,
                registration: record)
              shown.test = tests[count % tests.count]
              shown.status = statuses[count % statuses.count]
              shown.locationUnavailable = count % 2 == 0
              shown.locating = count % 4 == 1
              count += 1
              let section = NotificationSettings(shown)
              let page = NotificationPlacePage(shown)
              for word in section.words + page.words {
                #expect(otherTopic(in: word) == nil, "\(word)")
                #expect(!word.isEmpty)
                #expect(!word.lowercased().contains("alert"), "\(word)")
                #expect(!word.lowercased().contains("place on screen"), "\(word)")
              }
              #expect(Set(section.ids).count == section.ids.count)
              #expect(Set(page.ids).count == page.ids.count)
            }
          }
        }
      }
    }
  }
}
