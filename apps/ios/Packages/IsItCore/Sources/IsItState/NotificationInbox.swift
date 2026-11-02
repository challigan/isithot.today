import Foundation

/// What the system says about notifications, on the main actor, kept until the app attaches its
/// handler (iOS build spec, section 12.3): the token or its failure (the app delegate), a
/// notification arriving in the foreground or tapped (the centre's delegate, as the payload's
/// JSON), and iOS Settings' link to the app's notification settings. The delegates post as soon
/// as the system speaks, which for a tap that launched the app is before `WillItSnowApp.init` has
/// attached anything, so the order of the two never matters.
@MainActor
public final class NotificationInbox {
  public enum Event: Sendable, Equatable {
    /// The push token, in hex (`PushToken.hex`).
    case token(String)
    /// `didFailToRegisterForRemoteNotificationsWithError`.
    case registrationFailed
    /// A notification shown while the app is in the foreground: its payload's JSON.
    case arrived(Data?)
    /// A notification tapped: its payload's JSON.
    case tapped(Data?)
    /// iOS Settings' link to the app's own notification settings.
    case openSettings
  }

  /// The app's one inbox, which its delegates post to.
  public static let shared = NotificationInbox()

  /// The events not yet handed to the handler, in the order posted.
  private var kept: [Event] = []
  private var handler: (@MainActor (Event) async -> Void)?
  /// The delivery under way: one handler call at a time, in order.
  private var delivering: Task<Void, Never>?

  public init() {}

  /// Delivers `event` to the handler, after every event before it, or keeps it until one is
  /// attached.
  public func post(_ event: Event) {
    kept.append(event)
    deliver()
  }

  /// Attaches `handler` (a second replaces the first, from the next event on) and delivers what
  /// was kept, in order.
  public func attach(_ handler: @escaping @MainActor (Event) async -> Void) {
    self.handler = handler
    deliver()
  }

  /// Waits until every event posted so far is handled, or, with no handler yet, kept (tests).
  public func drained() async {
    while let delivering { await delivering.value }
  }

  /// Hands the kept events to the handler one at a time, unless a delivery is under way, which
  /// takes the new ones in turn.
  private func deliver() {
    guard delivering == nil, handler != nil, !kept.isEmpty else { return }
    delivering = Task {
      while let handler, !kept.isEmpty {
        await handler(kept.removeFirst())
      }
      delivering = nil
    }
  }
}
