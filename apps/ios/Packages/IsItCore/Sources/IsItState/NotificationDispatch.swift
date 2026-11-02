import Foundation
import IsItLogic
import IsItModel

/// Each of `NotificationInbox`'s events, to the models (iOS build spec, section 12.3): the
/// handler the app attaches to its inbox.
@MainActor
public enum NotificationDispatch {
  /// The token to the notifications, which sync with it; its failure, nothing more (the next
  /// `.active` registers again); a notification shown in the foreground, a quiet refetch (the
  /// banner is the system's); a tap, its route (`NotificationRouter`), with the place's zone
  /// from the registration, then from the answer on screen, opened as every route is, so a tap
  /// that launched the app waits for the launch's end; iOS Settings' link, Settings →
  /// Notifications. False only for a tap whose payload routes nowhere: the app opens as usual,
  /// and logs it in Debug builds.
  @discardableResult
  public static func handle(
    _ event: NotificationInbox.Event, app: AppModel, notifications: NotificationsModel
  ) async -> Bool {
    switch event {
    case .token(let hex):
      notifications.tokenArrived(hex)
    case .registrationFailed:
      notifications.registrationFailed()
    case .arrived:
      await app.refresh()
    case .tapped(let json):
      var zones = notifications.zones
      if let response = app.response {
        zones.merge([app.target.key: response.location.timezone]) { kept, _ in kept }
      }
      guard let route = NotificationRouter.route(json: json, now: app.now, zones: zones) else {
        return false
      }
      await app.open(route)
    case .openSettings:
      await app.open(.settings(.notifications))
    }
    return true
  }
}
