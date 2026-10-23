import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItUI
import SwiftUI
import UIKit

/// The Settings sheet (iOS build spec, section 10.4), from the model: IsItLogic's presenters
/// (`SettingsScreen`, `YourPrivacy`) for the model's units and purchase, drawn by IsItUI's
/// `SettingsView`, with the app's own services behind the actions: the units through
/// `AppModel.setUnits(_:)`, the pasteboard, the bundled notices and the bundle's version.
///
/// Phase 6 has no ads and no notifications yet, so "Privacy choices" and the data kept for
/// notifications (with its delete button) don't show: phase 8 passes whether Google's form is
/// required and the last registration's lines. "Ads on" is the free version, as section 14.2
/// starts the ads only when not unlocked; phase 7's purchase sets `unlocked`.
struct SettingsSheet: View {
  let model: AppModel

  var body: some View {
    let model = model
    SettingsView(
      screen: SettingsScreen(
        units: model.units,
        unlocked: model.unlocked,
        privacyChoices: false,
        version: AppBundle.version
      ),
      privacy: YourPrivacy(adsOn: !model.unlocked, privacyChoices: false),
      actions: SettingsActions(
        setUnits: { units in Task { await model.setUnits(units) } },
        reportAd: {
          MailDraft.reportAd(
            version: AppBundle.version,
            place: model.placeName,
            at: model.now,
            zone: TimeZone.current.identifier
          )
        },
        copy: { UIPasteboard.general.string = $0 },
        notice: AppBundle.notice
      )
    )
    .debugRecorder()
  }
}

/// What the app's bundle holds that Settings shows: its version and build (Info.plist), and the
/// notices it bundles (`Resources/Licences`).
enum AppBundle {
  static let version = AppVersion(
    version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
    build: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
  )

  /// A bundled notice's full text, by its resource name; nil when it isn't bundled.
  static func notice(_ file: String) -> String? {
    guard let url = Bundle.main.url(forResource: file, withExtension: "txt") else { return nil }
    return try? String(contentsOf: url, encoding: .utf8)
  }
}
