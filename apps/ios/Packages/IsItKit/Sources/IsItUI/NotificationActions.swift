import Foundation
import IsItLogic

/// What Settings' notifications and the place page ask the app to do (iOS build spec, section
/// 12.1): the views keep no state, and hand each tap to `NotificationsModel` through these.
public struct NotificationActions {
  /// A switch turned on or off: the model asks for permission at the first one, and the switch
  /// shows what the model then holds.
  public var setSwitch: (AlertSwitch, Bool) -> Void
  /// A row's action: the test, the gate's two, Open Settings (notifications, or location), a
  /// place choice.
  public var perform: (SettingsScreen.NotificationAction) -> Void
  /// Settings or the place page appeared: the permission is read again.
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
