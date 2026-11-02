import Foundation
import IsItLogic
import IsItModel
import IsItState

/// `alerts.v1`, `alertSync.v1` and `ui.alertCard` in the app's own defaults (spec 9.6), beside
/// `recent.v1`: the notification switches and place, the registration the server holds (with the
/// token it was sent with, only to name that record), and whether the card was put away. Only the
/// app reads them, so they aren't in the App Group. A save that can't encode leaves what was
/// kept. UserDefaults may be used from any thread, so it is Sendable.
public struct NotificationDefaults: NotificationStore, @unchecked Sendable {
  public let defaults: UserDefaults

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  public func loadSettings() -> AlertSettings {
    AlertSettings(stored: defaults.data(forKey: Keys.App.alerts))
  }

  public func saveSettings(_ settings: AlertSettings) {
    guard let data = try? settings.stored() else { return }
    defaults.set(data, forKey: Keys.App.alerts)
  }

  public func loadRegistration() -> AlertRegistration? {
    AlertRegistration(stored: defaults.data(forKey: Keys.App.alertSync))
  }

  public func saveRegistration(_ registration: AlertRegistration?) {
    guard let registration else {
      defaults.removeObject(forKey: Keys.App.alertSync)
      return
    }
    guard let data = try? registration.stored() else { return }
    defaults.set(data, forKey: Keys.App.alertSync)
  }

  public func loadCardDismissed() -> Bool {
    defaults.bool(forKey: Keys.App.card)
  }

  public func saveCardDismissed(_ dismissed: Bool) {
    defaults.set(dismissed, forKey: Keys.App.card)
  }

  /// Forgets all three (`-resetStore`).
  public func removeAll() {
    for key in [Keys.App.alerts, Keys.App.alertSync, Keys.App.card] {
      defaults.removeObject(forKey: key)
    }
  }
}
