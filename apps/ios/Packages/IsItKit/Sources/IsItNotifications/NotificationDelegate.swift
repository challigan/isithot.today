import Foundation
import IsItState
import UserNotifications

/// The notification centre's delegate. Neither the class nor its methods are main-actor: Apple
/// names no thread for them. Each copies the payload out as JSON (`Sendable`), then posts it to
/// the main actor and calls the system's completion handler there, which a tap needs (UIKit
/// updates the scene when it is called). Only the completion-handler forms: the async ones, on a
/// type that isn't main-actor, end off the main thread and crash a tap ("Call must be made on main
/// thread"), even empty; and implementing both forms of one would clash as Objective-C selectors.
/// Owned by the app delegate, since the centre holds its delegate weakly. Should the module ever
/// take main-actor isolation by default (SE-0466), the class must be marked `nonisolated`.
public final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
  private let post: @MainActor @Sendable (NotificationInbox.Event) -> Void

  /// A delegate that hands each event to `post`, on the main actor.
  public init(post: @escaping @MainActor @Sendable (NotificationInbox.Event) -> Void) {
    self.post = post
  }

  /// In the foreground: a banner, the list and the sound; the app refetches quietly.
  public func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
    withCompletionHandler completionHandler:
      @escaping @Sendable (UNNotificationPresentationOptions) -> Void
  ) {
    let payload = Self.json(notification.request.content.userInfo)
    let post = self.post
    Task { @MainActor in
      post(.arrived(payload))
      completionHandler([.banner, .list, .sound])
    }
  }

  /// A tap (the default action: no category declares another).
  public func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping @Sendable () -> Void
  ) {
    let isTap = response.actionIdentifier == UNNotificationDefaultActionIdentifier
    let payload = isTap ? Self.json(response.notification.request.content.userInfo) : nil
    let post = self.post
    Task { @MainActor in
      if isTap { post(.tapped(payload)) }
      completionHandler()
    }
  }

  /// iOS Settings' link to the app's notification settings (`.providesAppNotificationSettings`).
  public func userNotificationCenter(
    _ center: UNUserNotificationCenter, openSettingsFor notification: UNNotification?
  ) {
    let post = self.post
    Task { @MainActor in post(.openSettings) }
  }

  /// The payload as JSON, or nil for one JSON can't hold (it routes nowhere).
  public static func json(_ userInfo: [AnyHashable: Any]) -> Data? {
    guard JSONSerialization.isValidJSONObject(userInfo) else { return nil }
    return try? JSONSerialization.data(withJSONObject: userInfo)
  }
}
