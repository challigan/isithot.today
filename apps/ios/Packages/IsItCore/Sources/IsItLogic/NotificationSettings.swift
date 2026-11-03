import Foundation
import IsItModel

/// What the app's notifications are doing, as the views show them (`NotificationsModel.state`):
/// what `alerts.v2` and `alertSync.v2` keep, the permission and location access, where you are,
/// the saved places and the purchase their bells need (phase 8.4b), and what this session's taps
/// came to.
public struct NotificationsState: Sendable, Equatable {
  /// "Send a test notification": not tapped, under way, or its outcome.
  public enum Test: Sendable, Equatable {
    case idle, sending
    case done(AlertSync.TestOutcome)
  }

  /// The section's status line: nothing to say, a change the server didn't take, or the server's
  /// own words for a set it refused (400 `bad_location`: it couldn't tell where you are).
  public enum Status: Sendable, Equatable {
    case ok, notSaved
    case placeRefused(String)
  }

  /// "Turn off notifications and delete my data" (Your privacy): not tapped, under way, done, or
  /// not yet, when the delete didn't reach the server.
  public enum Delete: Sendable, Equatable {
    case idle, deleting, done, notYet
  }

  public var settings: AlertSettings
  public var permission: AlertSync.Permission
  /// Whether the app may use the phone's location (Core Location's When In Use).
  public var locationAccess: AlertSync.LocationAccess
  /// Where you are as the app sends it, and whether the server refused it.
  public var here: HereState
  /// The server's record, as the last PUT it answered made it; nil while none is kept.
  public var registration: AlertRegistration?
  /// The saved places, in saved order (phase 8.4b): their bells are `settings.bells`.
  public var saved: [SavedPlace]
  /// Whether the one-off purchase is owned, as StoreKit last said; nil until it has said this
  /// launch, when the set is sent as the last registration had it (`AlertSync.ownsSaved`,
  /// decision 15). For what is sent only: the views show the app's purchase.
  public var unlocked: Bool?
  public var test: Test
  public var status: Status
  /// This session's "Use my location" on the "Where you are" page found no fix, though location
  /// access is allowed.
  public var locationUnavailable: Bool
  /// "Use my location" on the "Where you are" page is finding the phone.
  public var locating: Bool
  public var delete: Delete
  /// The screen shows where you are, approximate location or the phone's point in where you
  /// are's cell (`NotificationCard.showsHere(_:here:)`): the only screen the card shows on.
  public var showsHere: Bool
  /// The card is put away for good (`ui.alertCard`).
  public var cardDismissed: Bool
  /// This session: the card's "Turn on" was allowed (the card says so until the next launch).
  public var cardTurnedOn: Bool
  /// This session: the card's "Turn on" met a refused permission.
  public var cardRefused: Bool

  public init(
    settings: AlertSettings = AlertSettings(),
    permission: AlertSync.Permission = .notDetermined,
    locationAccess: AlertSync.LocationAccess = .notDetermined,
    here: HereState = HereState(),
    registration: AlertRegistration? = nil,
    saved: [SavedPlace] = [],
    unlocked: Bool? = nil,
    showsHere: Bool = false,
    cardDismissed: Bool = false
  ) {
    self.settings = settings
    self.permission = permission
    self.locationAccess = locationAccess
    self.here = here
    self.registration = registration
    self.saved = saved
    self.unlocked = unlocked
    test = .idle
    status = .ok
    locationUnavailable = false
    locating = false
    delete = .idle
    self.showsHere = showsHere
    self.cardDismissed = cardDismissed
    cardTurnedOn = false
    cardRefused = false
  }
}

/// Where you are, as the model last worked it out (`AlertSync.here`), and whether the server
/// refused it. Settings' row, its page and the card read how it was found (`AlertSync.hereKind`)
/// and the town the server named (`AlertSync.hereName`) from this and the registration's answer.
public struct HereState: Sendable, Equatable {
  /// What the app sends for where you are: the phone's cell, or approximate.
  public var place: HerePlace
  /// The server's last answer to a registration was its refusal (400 `bad_location`): it
  /// couldn't tell where you are, and forgot the set. False again once it stores one.
  public var refused: Bool

  public init(place: HerePlace = .ip, refused: Bool = false) {
    self.place = place
    self.refused = refused
  }
}

/// Settings → Notifications (design 2.4), as plain values: drawn between the units and the
/// upgrade card, in Settings' own parts.
///
/// - While notifications are off for the app in iOS Settings, that line and "Open Settings"
///   first.
/// - The switches: the evening before, on the day, and "Also when snow is possible" only while
///   one of them is on. Turning one on needs no place first: where you are is always one.
/// - Under them, what is kept for where you are; then "Where you are", its town and how it was
///   found, which pushes its page; "Saved places" (phase 8.4b), how many bells are on, opening
///   the search screen where they are, or without the purchase what it takes, opening its page;
///   while a notification is on, "Send a test notification", its outcome beneath it (one test, or
///   two with a saved place's bell on); and the status line.
/// - Always the footer, and "Met Office warnings" in Safari while where you are, or a saved place
///   with its bell on, is in the UK, as the server's answer says of each place.
///
/// Nothing here names another app, website or weather type.
public struct NotificationSettings: Sendable, Equatable {
  /// A notification switch.
  public struct Switch: Sendable, Equatable, Identifiable {
    /// "notify-evening", "notify-morning", "notify-possible".
    public let id: String
    public let kind: AlertSwitch
    /// "Evening before (about 6pm)"
    public let title: String
    /// "When snow is likely tomorrow."
    public let note: String
    public let icon: SettingsScreen.Icon
    public let isOn: Bool
  }

  /// "Where you are": its town and how it was found. In Settings it pushes the "Where you are"
  /// page (`SettingsPage.notificationPlace`); on that page it only says.
  public struct HereRow: Sendable, Equatable {
    /// "notify-here" in Settings, "notify-place-here" on the page.
    public let id: String
    /// "Where you are"
    public let title: String
    /// "Leeds": the town the server named (`AlertSync.hereName`); nil before it has, while no
    /// notification is on, and for a place it has no name for.
    public let value: String?
    /// How it was found (`AlertSync.hereKind`): "Your location", "Approximate, from your
    /// internet connection" or "Not found yet".
    public let note: String
    /// `.notificationPlace`
    public let icon: SettingsScreen.Icon
  }

  /// "Saved places" (phase 8.4b, `notify-saved`), under "Where you are": one row for every saved
  /// place's bell, which are in the search screen, not here (no switch per place).
  public struct SavedRow: Sendable, Equatable {
    /// "notify-saved"
    public let id: String
    /// "Saved places"
    public let title: String
    /// With the purchase, how many bells show on, "2 on", or "Off"; without it, "With the
    /// one-off purchase".
    public let value: String
    /// With the purchase, the search screen (`.notification(.savedPlaces)`); without it, the
    /// upgrade page on Settings' own stack (`.page(.upgrade)`).
    public let action: SettingsScreen.Action
    /// `.savedPlaces`
    public let icon: SettingsScreen.Icon

    public init(
      id: String, title: String, value: String, action: SettingsScreen.Action,
      icon: SettingsScreen.Icon
    ) {
      self.id = id
      self.title = title
      self.value = value
      self.action = action
      self.icon = icon
    }
  }

  public enum Item: Sendable, Equatable {
    case toggle(Switch)
    /// "notify-here-kept": what is kept for where you are, and for how long.
    case line(Line)
    case here(HereRow)
    /// "notify-saved": the saved places' bells (phase 8.4b).
    case savedRow(SavedRow)
    /// A row that acts: Open Settings, the test (its outcome its detail, busy while sending).
    case row(SettingsScreen.Row)
  }

  /// A line of words, with its accessibility identifier.
  public struct Line: Sendable, Equatable, Identifiable {
    public let id: String
    public let text: String
  }

  /// "Notifications"
  public let heading: String
  /// "notify-notice": that notifications are off in Settings.
  public let notice: Line?
  public let items: [Item]
  /// "notify-status": a change not saved, or the server's words for a set it refused.
  public let status: Line?
  /// "notify-footer": these are forecasts, not official warnings.
  public let footer: Line
  /// "notify-warnings": the Met Office's warnings page, while where you are, or a saved place with
  /// its bell on, is in the UK.
  public let warnings: SettingsScreen.Row?

  /// The section for `state`, with the one-off purchase as the rest of Settings shows it
  /// (`unlocked`, the app's: `unlock.v1` until StoreKit answers), so "Saved places" agrees with
  /// the upgrade card, the upgrade page it pushes and the search screen's bells.
  public init(_ state: NotificationsState, unlocked: Bool) {
    heading = AppCopy.notifications
    footer = Line(id: "notify-footer", text: AppCopy.notifyFooter)
    var items: [Item] = []
    if state.permission == .denied {
      notice = Line(id: "notify-notice", text: AppCopy.notifyDenied)
      items.append(
        .row(
          SettingsScreen.Row(
            id: "notify-open-settings", title: AppCopy.openSettings,
            action: .notification(.openNotificationSettings), icon: .openSettings)))
    } else {
      notice = nil
    }
    let prefs = state.settings.prefs
    items.append(.toggle(Self.toggle(.evening, isOn: prefs.evening)))
    items.append(.toggle(Self.toggle(.morning, isOn: prefs.morning)))
    if state.settings.anyOn { items.append(.toggle(Self.toggle(.possible, isOn: prefs.possible))) }
    items.append(.line(Line(id: "notify-here-kept", text: AppCopy.notifyHereKept)))
    items.append(.here(Self.hereRow(state, id: "notify-here")))
    items.append(.savedRow(Self.savedRow(state, unlocked: unlocked)))
    if state.settings.anyOn {
      items.append(
        .row(
          SettingsScreen.Row(
            id: "notify-test", title: AppCopy.sendTest, action: .notification(.sendTest),
            icon: .test, detail: Self.outcome(state.test), busy: state.test == .sending)))
    }
    self.items = items
    switch state.status {
    case .ok: status = nil
    case .notSaved: status = Line(id: "notify-status", text: AppCopy.notifyNotSaved)
    case .placeRefused(let text): status = Line(id: "notify-status", text: text)
    }
    // Every place of the server's answer, where you are and each saved place with its bell on,
    // by the country the server gave it.
    let answer = Self.answer(state)
    let countries = [answer?.here?.country] + (answer?.saved.map(\.country) ?? [])
    if countries.contains(where: { $0?.utf8.elementsEqual("GB".utf8) == true }),
      let url = URL(string: Constants.Outbound.metOfficeWarnings)
    {
      warnings = SettingsScreen.Row(
        id: "notify-warnings", title: CoreCopy.metOfficeWarnings, action: .open(url),
        icon: .warnings)
    } else {
      warnings = nil
    }
  }

  /// The server's answer for what is switched on now: none while no notification is, since
  /// nothing is sent then, whatever the last answer said.
  private static func answer(_ state: NotificationsState) -> DeviceResponse? {
    state.settings.anyOn ? state.registration?.response : nil
  }

  /// "Where you are", with `id`: the town the server named for the kind of place sent
  /// (`AlertSync.hereName`), and how it was found (`AlertSync.hereKind`). While no notification
  /// is on, nothing is sent, so the row shows the kind alone: the phone's location or
  /// approximate, never a town, nor "Not found yet".
  static func hereRow(_ state: NotificationsState, id: String) -> HereRow {
    let reply = answer(state)
    let refused = state.settings.anyOn && state.here.refused
    let note =
      switch AlertSync.hereKind(here: state.here.place, reply: reply, refused: refused) {
      case .device: CoreCopy.yourLocation
      case .ip: AppCopy.notifyHereApprox
      case .unknown: AppCopy.notifyHereUnknown
      }
    return HereRow(
      id: id, title: AppCopy.notifyHere,
      value: AlertSync.hereName(here: state.here.place, reply: reply), note: note,
      icon: .notificationPlace)
  }

  /// "Saved places": without the purchase (`unlocked`, as the rest of Settings and the search
  /// screen show it), what it takes, opening the upgrade page; with it, how many saved places'
  /// bells show on (`AlertSync.bellState`: none while nothing can be sent), or "Off", opening the
  /// search screen. What is sent before StoreKit answers (`AlertSync.ownsSaved`) is the sync's
  /// alone: a row that said otherwise would push a page that thanks for the purchase.
  static func savedRow(_ state: NotificationsState, unlocked: Bool) -> SavedRow {
    guard unlocked else {
      return SavedRow(
        id: "notify-saved", title: AppCopy.notifySaved, value: AppCopy.notifySavedLocked,
        action: .page(.upgrade), icon: .savedPlaces)
    }
    let active = AlertSync.active(prefs: state.settings.prefs, permission: state.permission)
    let bells = AlertSync.keptBells(state.settings.bells, savedKeys: state.saved.map(\.target.key))
    let on = active ? bells.count : 0
    return SavedRow(
      id: "notify-saved", title: AppCopy.notifySaved,
      value: on > 0 ? AppCopy.notifySavedOn(count: String(on)) : AppCopy.notifySavedOff,
      action: .notification(.savedPlaces), icon: .savedPlaces)
  }

  /// The switch for `kind`, in its Settings words.
  private static func toggle(_ kind: AlertSwitch, isOn: Bool) -> Switch {
    switch kind {
    case .evening:
      Switch(
        id: "notify-evening", kind: kind, title: AppCopy.evening, note: AppCopy.eveningNote,
        icon: .evening, isOn: isOn)
    case .morning:
      Switch(
        id: "notify-morning", kind: kind, title: AppCopy.morning, note: AppCopy.morningNote,
        icon: .morning, isOn: isOn)
    case .possible:
      Switch(
        id: "notify-possible", kind: kind, title: AppCopy.possible, note: AppCopy.possibleNote,
        icon: .possible, isOn: isOn)
    }
  }

  /// The test's outcome in words, beneath its row: nil before it, and while it is under way; one
  /// test sent, or the server's two (where you are, and a saved place with its bell on). A
  /// record the server no longer has fails alike, as the model registers again.
  private static func outcome(_ test: NotificationsState.Test) -> String? {
    switch test {
    case .idle, .sending: nil
    case .done(.sent(let count)) where count > 1: AppCopy.testSentCount(count: String(count))
    case .done(.sent): AppCopy.testSent
    case .done(.dryRun): AppCopy.testDryRun
    case .done(.limited): AppCopy.testLimited
    case .done(.quiet): AppCopy.testQuiet
    case .done(.notRegistered), .done(.failed): AppCopy.testFailed
    }
  }
}

/// The "Where you are" page (`SettingsPage.notificationPlace`, design 2.1): how where you are is
/// found and how often it moves; the place now, with how it was found, as Settings' row says; and
/// what can be done about it. "Use my location" while location access was never asked (it asks
/// at the tap), while a tap is finding the phone (busy), and after a tap that found no fix; while
/// access is off for the app, that line and "Open Settings"; nothing to do while it is allowed.
/// No place is ever chosen here.
public struct NotificationPlacePage: Sendable, Equatable {
  /// "Where you are"
  public let title: String
  /// "notify-place-about": how where you are is found, how often it moves, how long it is kept.
  public let about: NotificationSettings.Line
  /// "notify-place-here": the town and how it was found, as Settings' row says.
  public let place: NotificationSettings.HereRow
  /// "notify-place-my-location": "Use my location".
  public let useMyLocation: SettingsScreen.Row?
  /// "notify-place-problem": location access off for the app, or no fix.
  public let problem: NotificationSettings.Line?
  /// "notify-place-open-settings", while location access is off.
  public let openSettings: SettingsScreen.Row?

  /// The page for `state`.
  public init(_ state: NotificationsState) {
    title = AppCopy.notifyPlaceTitle
    about = NotificationSettings.Line(id: "notify-place-about", text: AppCopy.notifyHereAbout)
    place = NotificationSettings.hereRow(state, id: "notify-place-here")
    if state.locationAccess == .denied {
      useMyLocation = nil
      problem = NotificationSettings.Line(
        id: "notify-place-problem", text: AppCopy.notifyLocationDenied)
      openSettings = SettingsScreen.Row(
        id: "notify-place-open-settings", title: AppCopy.openSettings,
        action: .notification(.openLocationSettings), icon: .openSettings)
      return
    }
    openSettings = nil
    // While a tap is finding the phone its row stays, busy, though access may be allowed by
    // then: it goes once the fix is in, and stays after none.
    if state.locationAccess == .notDetermined || state.locationUnavailable || state.locating {
      useMyLocation = SettingsScreen.Row(
        id: "notify-place-my-location", title: AppCopy.notifyPlaceMyLocation,
        action: .notification(.useMyLocation), icon: .myLocation, busy: state.locating)
    } else {
      useMyLocation = nil
    }
    problem =
      state.locationUnavailable
      ? NotificationSettings.Line(
        id: "notify-place-problem", text: AppCopy.notifyLocationUnavailable) : nil
  }
}
