import Foundation
import IsItModel

/// The Today card (design 2.6): page content on the middle page, above the upgrade row, shown
/// only while the screen shows where you are (the phone's point or approximate location, never a
/// saved or searched place's page). It offers notifications for where you are and goes for good
/// after "Not now", after the first switch is turned on anywhere, or after "Turn off
/// notifications and delete my data". It never shows while notifications are off for the app in
/// Settings, unless this session's "Turn on" met that.
public struct NotificationCard: Sendable, Equatable {
  public enum Kind: Sendable, Equatable {
    /// The offer: "Turn on", "Not now".
    case offer
    /// This session's "Turn on" met a refused permission, still refused: "Open Settings", "Not
    /// now".
    case refused
    /// This session's "Turn on" was allowed: "Done. …", no buttons; once the server has named
    /// where you are, with its town.
    case turnedOn(name: String?)
  }

  public enum Action: Sendable, Equatable {
    case turnOn, notNow, openSettings
  }

  public struct Button: Sendable, Equatable, Identifiable {
    /// "card-turn-on", "card-not-now", "card-open-settings".
    public let id: String
    public let title: String
    public let action: Action
  }

  public let kind: Kind
  /// `card-line`: `cardOffer`, `notifyDenied`, `cardOn` or `cardOnNamed`.
  public let line: String
  /// `card-kept`, under the offer only: what is kept for where you are, and for how long.
  public let kept: String?
  public let buttons: [Button]

  /// The card for `state`, or nil for none: none unless the screen shows where you are; "Done"
  /// once this session turned them on, with the town once the server has named it
  /// (`AlertSync.hereName`); none once put away or a notification is on ("possible" alone
  /// isn't); the refusal this session met, while it stands; none while refused otherwise; then
  /// the offer, which is also what a refusal allowed since in iOS Settings comes back to.
  public static func card(_ state: NotificationsState) -> NotificationCard? {
    guard state.showsHere else { return nil }
    let notNow = Button(id: "card-not-now", title: AppCopy.notNow, action: .notNow)
    if state.cardTurnedOn {
      let name = AlertSync.hereName(here: state.here.place, reply: state.registration?.response)
      return NotificationCard(
        kind: .turnedOn(name: name),
        line: name.map { AppCopy.cardOnNamed(place: $0) } ?? AppCopy.cardOn, kept: nil,
        buttons: [])
    }
    if state.cardDismissed || state.settings.anyOn { return nil }
    if state.permission == .denied {
      guard state.cardRefused else { return nil }
      return NotificationCard(
        kind: .refused, line: AppCopy.notifyDenied, kept: nil,
        buttons: [
          Button(id: "card-open-settings", title: AppCopy.openSettings, action: .openSettings),
          notNow,
        ])
    }
    return NotificationCard(
      kind: .offer, line: AppCopy.cardOffer, kept: AppCopy.notifyHereKept,
      buttons: [Button(id: "card-turn-on", title: AppCopy.turnOn, action: .turnOn), notNow])
  }

  /// Whether `target` is where you are (`here`, design decision 35): approximate IP location, or
  /// the phone's own point in where you are's cell. A city's page or a searched place's never is,
  /// whatever its name, nor a point of the phone's in another cell (a recent place's, a
  /// notification's), nor any point of the phone's while where you are is approximate.
  public static func showsHere(_ target: Target, here: HerePlace) -> Bool {
    switch target {
    case .ip: true
    case .coords(let point):
      point.source == .device && here.target.key.utf8.elementsEqual(target.key.utf8)
    case .city: false
    }
  }
}
