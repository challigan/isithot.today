import Foundation
import IsItLogic

/// What Settings' notifications and the "Where you are" page ask the app to do (iOS build spec,
/// section 12.1; design 2.1, 2.4): the views keep no state, and hand each tap to
/// `NotificationsModel` through these.
public struct NotificationActions {
  /// A switch turned on or off: the model asks for permission at the first one, and the switch
  /// shows what the model then holds.
  public var setSwitch: (AlertSwitch, Bool) -> Void
  /// A row's action: the test, "Use my location" on the "Where you are" page, Open Settings
  /// (notifications, or location).
  public var perform: (SettingsScreen.NotificationAction) -> Void
  /// Settings or the "Where you are" page appeared: the permission is read again.
  public var appeared: () -> Void

  public init(
    setSwitch: @escaping (AlertSwitch, Bool) -> Void,
    perform: @escaping (SettingsScreen.NotificationAction) -> Void,
    appeared: @escaping () -> Void
  ) {
    self.setSwitch = setSwitch
    self.perform = perform
    self.appeared = appeared
  }
}
