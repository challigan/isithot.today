import IsItLogic
import IsItState
import UIKit
import UserNotifications

/// The system's notifications (spec 12.1, 12.2): the permission from UserNotifications, asked
/// only by `requestPermission()`, and the push token from UIKit, which comes through the app
/// delegate (`NotificationInbox`). Nothing here touches the centre until a method is called, so
/// the unit tests' host, which never launches, never asks.
@MainActor
public final class UserNotificationsPlatform: NotificationPlatform {
  /// Banners and sounds, and iOS Settings' link back to the app's notification settings.
  public nonisolated static let options: UNAuthorizationOptions = [
    .alert, .sound, .providesAppNotificationSettings,
  ]

  public init() {}

  public func permission() async -> AlertSync.Permission { Self.permission(await Self.status()) }

  public func requestPermission() async -> Bool { await Self.request() }

  public func register() { UIApplication.shared.registerForRemoteNotifications() }

  /// `UNAuthorizationStatus` as `AlertSync` knows it: `ephemeral` (App Clips only) as authorized,
  /// and a case to come as authorized too, which changes nothing: as not determined it would turn
  /// the switches off and forget the registration on the phone alone (decision 8), leaving a
  /// server record the app could no longer delete.
  public nonisolated static func permission(
    _ status: UNAuthorizationStatus
  ) -> AlertSync.Permission {
    switch status {
    case .authorized: .authorized
    case .provisional: .provisional
    case .denied: .denied
    case .notDetermined: .notDetermined
    case .ephemeral: .authorized
    @unknown default: .authorized
    }
  }

  /// Off the main actor, so the centre's settings, which aren't Sendable, never cross into it.
  private nonisolated static func status() async -> UNAuthorizationStatus {
    await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
  }

  /// The prompt's answer; a thrown error is no.
  private nonisolated static func request() async -> Bool {
    (try? await UNUserNotificationCenter.current().requestAuthorization(options: options)) ?? false
  }
}
