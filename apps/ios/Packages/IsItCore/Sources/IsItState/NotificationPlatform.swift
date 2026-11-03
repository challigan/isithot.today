import Foundation
import IsItLogic
import IsItModel

/// The system's notifications as `NotificationsModel` uses them: IsItNotifications'
/// `UserNotificationsPlatform` in the app, a Debug build's stand-in under the UI tests' launch
/// arguments, a fake in the tests. On the main actor, as `PurchasePlatform` is.
@MainActor
public protocol NotificationPlatform: AnyObject {
  /// The permission now. Never asks.
  func permission() async -> AlertSync.Permission
  /// The system's prompt when the app has never asked, and whether it was allowed; otherwise
  /// the answer already given, at once.
  func requestPermission() async -> Bool
  /// `registerForRemoteNotifications()`. The token, or the failure, comes later through
  /// `NotificationInbox`, or never: some devices give none.
  func register()
}

/// `alerts.v2`, `alertSync.v2` and `ui.alertCard` (spec 9.6, design 4.2), in the app's own
/// defaults, which only `NotificationsModel` writes: `NotificationDefaults` (IsItNotifications) in
/// the app; `MemoryNotificationStore` in the tests.
public protocol NotificationStore: Sendable {
  /// `alerts.v2`, or every switch off and nothing kept when there is none to read.
  func loadSettings() -> AlertSettings
  func saveSettings(_ settings: AlertSettings)
  /// `alertSync.v2`, or nil.
  func loadRegistration() -> AlertRegistration?
  /// Keeps `registration` in `alertSync.v2`; nil removes it.
  func saveRegistration(_ registration: AlertRegistration?)
  /// `ui.alertCard`: whether the Today card has gone for good.
  func loadCardDismissed() -> Bool
  func saveCardDismissed(_ dismissed: Bool)
}

/// The notifications' three keys kept in memory only: the tests', and a build's without its own
/// defaults.
public final class MemoryNotificationStore: NotificationStore, @unchecked Sendable {
  private let lock = NSLock()
  private var settings: AlertSettings
  private var registration: AlertRegistration?
  private var cardDismissed: Bool

  public init(
    settings: AlertSettings = AlertSettings(),
    registration: AlertRegistration? = nil,
    cardDismissed: Bool = false
  ) {
    self.settings = settings
    self.registration = registration
    self.cardDismissed = cardDismissed
  }

  public func loadSettings() -> AlertSettings { lock.withLock { settings } }

  public func saveSettings(_ settings: AlertSettings) { lock.withLock { self.settings = settings } }

  public func loadRegistration() -> AlertRegistration? { lock.withLock { registration } }

  public func saveRegistration(_ registration: AlertRegistration?) {
    lock.withLock { self.registration = registration }
  }

  public func loadCardDismissed() -> Bool { lock.withLock { cardDismissed } }

  public func saveCardDismissed(_ dismissed: Bool) { lock.withLock { cardDismissed = dismissed } }
}
