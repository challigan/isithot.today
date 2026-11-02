import Foundation
import IsItModel

/// What the app's notifications are doing, as the views show them (`NotificationsModel.state`):
/// what `alerts.v1` and `alertSync.v1` keep, the permission, and what this session's taps came
/// to.
public struct NotificationsState: Sendable, Equatable {
  /// "Send a test notification": not tapped, under way, or its outcome.
  public enum Test: Sendable, Equatable {
    case idle, sending
    case done(AlertSync.TestOutcome)
  }

  /// The section's status line: nothing to say, a change the server didn't take, or the server's
  /// own words for a place it refused (400 `bad_location`).
  public enum Status: Sendable, Equatable {
    case ok, notSaved
    case placeRefused(String)
  }

  /// Why "Use my location" on the place page found no place.
  public enum PlaceProblem: Sendable, Equatable {
    case locationDenied, locationUnavailable
  }

  /// "Turn off notifications and delete my data" (Your privacy): not tapped, under way, done, or
  /// not yet, when the delete didn't reach the server.
  public enum Delete: Sendable, Equatable {
    case idle, deleting, done, notYet
  }

  public var settings: AlertSettings
  public var permission: AlertSync.Permission
  /// The server's record, as the last PUT it answered made it; nil while none is kept.
  public var registration: AlertRegistration?
  public var test: Test
  public var status: Status
  public var placeProblem: PlaceProblem?
  /// "Use my location" on the place page is finding the phone.
  public var locating: Bool
  public var delete: Delete
  /// The card is put away for good (`ui.alertCard`).
  public var cardDismissed: Bool
  /// This session: the card's "Turn on" was allowed (the card says so until the next launch).
  public var cardTurnedOn: Bool
  /// This session: the card's "Turn on" met a refused permission.
  public var cardRefused: Bool

  public init(
    settings: AlertSettings = AlertSettings(),
    permission: AlertSync.Permission = .notDetermined,
    registration: AlertRegistration? = nil,
    cardDismissed: Bool = false
  ) {
    self.settings = settings
    self.permission = permission
    self.registration = registration
    test = .idle
    status = .ok
    placeProblem = nil
    locating = false
    delete = .idle
    self.cardDismissed = cardDismissed
    cardTurnedOn = false
    cardRefused = false
  }

  /// The place the notifications are for, or would be for once a switch is first turned on: the
  /// one kept, else the place on screen (`AlertSync.firstPlace`). Nil only at approximate
  /// location with none kept.
  func place(onScreen: OnScreen) -> AlertPlace? {
    settings.place ?? AlertSync.firstPlace(onScreen: onScreen.target, name: onScreen.name)
  }

  /// A chosen place's name as it shows: its own, else the server's for it while the registration
  /// is for that place; nil when there is neither.
  func name(of target: Target, given name: String) -> String? {
    if !name.isEmpty { return name }
    guard let registration, Target(query: registration.response.place.query)?.key == target.key
    else { return nil }
    return registration.response.place.name
  }
}

/// Settings → Notifications (section 12.1), as plain values: drawn between the units and the
/// upgrade card, in Settings' own parts.
///
/// - With no place kept and the screen on approximate location, the gate: "Choose a place for
///   notifications…", "Use my location" and "Search", and no switch (approximate location is
///   never a notification place).
/// - Otherwise, while notifications are off for the app in iOS Settings, that line and "Open
///   Settings" first. Then the switches: the evening before, on the day, and "Also when snow is
///   possible" only while one of them is on; the place, which opens the place page; while a
///   notification is on, "Send a test notification", its outcome beneath it; and the status line.
/// - Always the footer, and for a UK place, "Met Office warnings" in Safari.
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

  /// The place row, which pushes the place page (`SettingsPage.notificationPlace`).
  public struct PlaceRow: Sendable, Equatable {
    /// "notify-place"
    public let id: String
    /// "Place"
    public let title: String
    /// "Leeds"; "Your location" while it follows the phone; nil while there is no name for it.
    public let value: String?
    /// "Follows your location each time you open the app.", while it follows.
    public let note: String?
    /// `.notificationPlace`
    public let icon: SettingsScreen.Icon
  }

  public enum Item: Sendable, Equatable {
    case toggle(Switch)
    case place(PlaceRow)
    /// A row that acts: the gate's two, Open Settings, the test (its outcome its detail, busy
    /// while sending).
    case row(SettingsScreen.Row)
  }

  /// A line of words, with its accessibility identifier.
  public struct Line: Sendable, Equatable, Identifiable {
    public let id: String
    public let text: String
  }

  /// "Notifications"
  public let heading: String
  /// "notify-notice": the gate's line, or that notifications are off in Settings.
  public let notice: Line?
  public let items: [Item]
  /// "notify-status": a change not saved, or the server's words for a place it refused.
  public let status: Line?
  /// "notify-footer": these are forecasts, not official warnings.
  public let footer: Line
  /// "notify-warnings": the Met Office's warnings page, for a UK place.
  public let warnings: SettingsScreen.Row?

  /// The section for `state`, with `onScreen` the place on screen.
  public init(_ state: NotificationsState, onScreen: OnScreen) {
    heading = AppCopy.notifications
    footer = Line(id: "notify-footer", text: AppCopy.notifyFooter)
    guard let place = state.place(onScreen: onScreen) else {
      notice = Line(id: "notify-notice", text: AppCopy.needsPlace)
      items = [
        .row(
          SettingsScreen.Row(
            id: "notify-use-my-location", title: CoreCopy.useMyLocation,
            action: .notification(.useMyLocation), icon: .useMyLocation)),
        .row(
          SettingsScreen.Row(
            id: "notify-search", title: AppCopy.search, action: .notification(.search),
            icon: .search)),
      ]
      status = nil
      warnings = nil
      return
    }
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
    switch place {
    case .chosen(let target, let name):
      items.append(
        .place(
          PlaceRow(
            id: "notify-place", title: AppCopy.notifyPlace,
            value: state.name(of: target, given: name), note: nil, icon: .notificationPlace)))
    case .follows:
      items.append(
        .place(
          PlaceRow(
            id: "notify-place", title: AppCopy.notifyPlace, value: CoreCopy.yourLocation,
            note: AppCopy.notifyFollows, icon: .notificationPlace)))
    }
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
    if AlertSync.country(of: place, onScreen: onScreen) == "GB",
      let url = URL(string: Constants.Outbound.metOfficeWarnings)
    {
      warnings = SettingsScreen.Row(
        id: "notify-warnings", title: CoreCopy.metOfficeWarnings, action: .open(url),
        icon: .warnings)
    } else {
      warnings = nil
    }
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

  /// The test's outcome in words, beneath its row: nil before it, and while it is under way.
  /// A record the server no longer has fails alike, as the model registers again.
  private static func outcome(_ test: NotificationsState.Test) -> String? {
    switch test {
    case .idle, .sending: nil
    case .done(.sent): AppCopy.testSent
    case .done(.dryRun): AppCopy.testDryRun
    case .done(.limited): AppCopy.testLimited
    case .done(.quiet): AppCopy.testQuiet
    case .done(.notRegistered), .done(.failed): AppCopy.testFailed
    }
  }
}

/// The place page (`SettingsPage.notificationPlace`): where the notifications are for, in
/// order, the place kept when it isn't the one on screen, the place on screen (a city's page or
/// a searched place, with its name), and the phone's location, followed; the one in use is
/// selected. Beneath, why "Use my location" found nothing, with "Open Settings" when location
/// access is off.
public struct NotificationPlacePage: Sendable, Equatable {
  public struct Choice: Sendable, Equatable, Identifiable {
    /// "notify-place-kept", "notify-place-on-screen", "notify-place-my-location".
    public let id: String
    /// "Leeds", "Use the place on screen: Durham", "Use my location".
    public let title: String
    /// "Follows your location each time you open the app.", under "Use my location".
    public let note: String?
    public let icon: SettingsScreen.Icon
    public let selected: Bool
    /// "Use my location" while it finds the phone: no second tap.
    public let busy: Bool
    public let choice: PlaceChoice
  }

  /// "Notification place"
  public let title: String
  public let choices: [Choice]
  /// "notify-place-problem": location off for the app, or no fix (naming the place on screen
  /// only when it is a choice).
  public let problem: NotificationSettings.Line?
  /// "notify-place-open-settings", while location access is off.
  public let openSettings: SettingsScreen.Row?

  /// The page for `state`, with `onScreen` the place on screen.
  public init(_ state: NotificationsState, onScreen: OnScreen) {
    title = AppCopy.notifyPlaceTitle
    let shown = state.place(onScreen: onScreen)
    var choices: [Choice] = []
    if case .chosen(let target, let name)? = state.settings.place,
      target.key != onScreen.target.key
    {
      choices.append(
        Choice(
          id: "notify-place-kept",
          title: state.name(of: target, given: name) ?? AppCopy.notifyPlace, note: nil,
          icon: .notificationPlace, selected: true, busy: false, choice: .kept))
    }
    if Self.choosable(onScreen.target), let name = onScreen.name, !name.isEmpty {
      var selected = false
      if case .chosen(let target, _)? = shown { selected = target.key == onScreen.target.key }
      choices.append(
        Choice(
          id: "notify-place-on-screen", title: AppCopy.notifyPlaceOnScreen(place: name),
          note: nil, icon: .onScreenPlace, selected: selected, busy: false,
          choice: .onScreen(onScreen.target, name: name)))
    }
    var follows = false
    if case .follows? = shown { follows = true }
    choices.append(
      Choice(
        id: "notify-place-my-location", title: AppCopy.notifyPlaceMyLocation,
        note: AppCopy.notifyFollows, icon: .myLocation, selected: follows,
        busy: state.locating, choice: .myLocation))
    self.choices = choices
    switch state.placeProblem {
    case .locationDenied?:
      problem = NotificationSettings.Line(
        id: "notify-place-problem", text: AppCopy.notifyLocationDenied)
      openSettings = SettingsScreen.Row(
        id: "notify-place-open-settings", title: AppCopy.openSettings,
        action: .notification(.openLocationSettings), icon: .openSettings)
    case .locationUnavailable?:
      // The place on screen as the other way only while the page offers it.
      let offered = choices.contains { $0.id == "notify-place-on-screen" }
      problem = NotificationSettings.Line(
        id: "notify-place-problem",
        text: offered ? AppCopy.notifyLocationUnavailable : AppCopy.notifyLocationTryAgain)
      openSettings = nil
    case nil:
      problem = nil
      openSettings = nil
    }
  }

  /// A place on screen that can be chosen and fixed: a city's page or a searched place, never
  /// approximate location, and not the phone's point, which "Use my location" follows.
  private static func choosable(_ target: Target) -> Bool {
    switch target {
    case .city: true
    case .coords(let place): place.source == .search
    case .ip: false
    }
  }
}

/// What a choice on the place page asks for.
public enum PlaceChoice: Sendable, Equatable {
  /// The place on screen, under its name: chosen and fixed.
  case onScreen(Target, name: String)
  /// The phone's location, followed.
  case myLocation
  /// The place already chosen, kept.
  case kept
}
