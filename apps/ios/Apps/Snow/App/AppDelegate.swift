import IsItLogic
import IsItNotifications
import IsItState
import UIKit
import UserNotifications

/// The app delegate SwiftUI keeps for what a scene can't do (iOS build spec, sections 12.2 and
/// 12.3), through `@UIApplicationDelegateAdaptor`: the centre's delegate, set before the launch
/// finishes so a tap that launched the app is never missed, and owned here since the centre holds
/// it weakly; and the push token's two callbacks. Each posts to `NotificationInbox.shared`, which
/// keeps it until the app attaches, so whether `WillItSnowApp.init` or this runs first never
/// matters. Under a UI test's stand-in for the notifications (`DebugHooks`) the real centre is
/// left alone, so no UI test leaves a permission behind but the one that means to.
final class AppDelegate: NSObject, UIApplicationDelegate {
  private let notificationDelegate = NotificationDelegate { NotificationInbox.shared.post($0) }

  func application(
    _ application: UIApplication,
    willFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    if DebugHooks.usesNotificationCenter() {
      UNUserNotificationCenter.current().delegate = notificationDelegate
    }
    return true
  }

  func application(
    _ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    NotificationInbox.shared.post(.token(PushToken.hex(deviceToken)))
  }

  /// No token, this time: the next `.active` registers again. Nothing is logged.
  func application(
    _ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error
  ) {
    NotificationInbox.shared.post(.registrationFailed)
  }
}
