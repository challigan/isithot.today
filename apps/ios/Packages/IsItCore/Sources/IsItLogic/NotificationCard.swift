import Foundation
import IsItModel

/// The Today card (spec 10.2, item 5): page content on the middle page, above the upgrade row,
/// that offers notifications for the place on screen and goes for good after "Not now", after
/// the first switch is turned on anywhere, or after "Turn off notifications and delete my data".
/// It never shows while notifications are off for the app in Settings, unless this session's
/// "Turn on" met that.
public struct NotificationCard: Sendable, Equatable {
  public enum Kind: Sendable, Equatable {
    /// A place on screen: "Turn on", "Not now".
    case chosen
    /// Approximate location: a place first, "Use my location", "Search", "Not now".
    case approximate
    /// This session's "Turn on" met a refused permission, still refused: "Open Settings", "Not
    /// now".
    case refused
    /// This session's "Turn on" was allowed: "Done. …", no buttons.
    case turnedOn
  }

  public enum Action: Sendable, Equatable {
    case turnOn, notNow, useMyLocation, search, openSettings
  }

  public struct Button: Sendable, Equatable, Identifiable {
    /// "card-turn-on", "card-not-now", "card-use-my-location", "card-search",
    /// "card-open-settings".
    public let id: String
    public let title: String
    public let action: Action
  }

  public let kind: Kind
  /// `card-line`: `cardChosen`, `cardApprox`, `notifyDenied` or `cardOn`.
  public let line: String
  public let buttons: [Button]

  /// The card for `state` with `onScreen` the place on screen, or nil for none: "Done" once this
  /// session turned them on; none once put away or a notification is on ("possible" alone
  /// isn't); the refusal this session met, while it stands; none while refused otherwise; then a
  /// place first at approximate location, or the offer for the place on screen, which is also
  /// what a refusal allowed since in iOS Settings comes back to.
  public static func card(_ state: NotificationsState, onScreen: OnScreen) -> NotificationCard? {
    let notNow = Button(id: "card-not-now", title: AppCopy.notNow, action: .notNow)
    if state.cardTurnedOn {
      return NotificationCard(kind: .turnedOn, line: AppCopy.cardOn, buttons: [])
    }
    if state.cardDismissed || state.settings.anyOn { return nil }
    if state.permission == .denied {
      guard state.cardRefused else { return nil }
      return NotificationCard(
        kind: .refused, line: AppCopy.notifyDenied,
        buttons: [
          Button(id: "card-open-settings", title: AppCopy.openSettings, action: .openSettings),
          notNow,
        ])
    }
    if onScreen.target == .ip {
      return NotificationCard(
        kind: .approximate, line: AppCopy.cardApprox,
        buttons: [
          Button(
            id: "card-use-my-location", title: CoreCopy.useMyLocation, action: .useMyLocation),
          Button(id: "card-search", title: AppCopy.search, action: .search),
          notNow,
        ])
    }
    return NotificationCard(
      kind: .chosen, line: AppCopy.cardChosen,
      buttons: [Button(id: "card-turn-on", title: AppCopy.turnOn, action: .turnOn), notNow])
  }
}
