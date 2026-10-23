import Foundation
import IsItLogic
import IsItModel

/// What Settings asks the app to do (iOS build spec, section 10.4). The sheet keeps no state of
/// its own but the page on screen and the mail fallback: it draws the presenters' values
/// (`SettingsScreen`, `YourPrivacy`, `HowItWorks`, `CreditsPage`) and hands each choice to the
/// app through these. Web pages and emails open through SwiftUI's `openURL`, so links in text
/// and rows alike go the same way.
public struct SettingsActions {
  /// The snow units control: every request asks in these units from now on.
  public var setUnits: (Units) -> Void
  /// Report an ad's email, written at the tap, with the time then and the place on screen.
  public var reportAd: @MainActor () -> MailDraft
  /// "Copy address": puts the support address on the pasteboard.
  public var copy: @MainActor (String) -> Void
  /// A bundled notice's full text, by its resource name; nil when it isn't bundled.
  public var notice: (String) -> String?
  /// "Privacy choices": Google's privacy options form. Nil until phase 8 brings the ads.
  public var privacyChoices: (() -> Void)?
  /// "Turn off notifications and delete my data". Nil until phase 8 brings notifications.
  public var deleteMyData: (() -> Void)?

  public init(
    setUnits: @escaping (Units) -> Void,
    reportAd: @escaping @MainActor () -> MailDraft,
    copy: @escaping @MainActor (String) -> Void,
    notice: @escaping (String) -> String?,
    privacyChoices: (() -> Void)? = nil,
    deleteMyData: (() -> Void)? = nil
  ) {
    self.setUnits = setUnits
    self.reportAd = reportAd
    self.copy = copy
    self.notice = notice
    self.privacyChoices = privacyChoices
    self.deleteMyData = deleteMyData
  }
}
