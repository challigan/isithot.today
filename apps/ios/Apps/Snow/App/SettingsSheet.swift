import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItUI
import SwiftUI
import UIKit

/// The Settings sheet (iOS build spec, section 10.4), from the model: IsItLogic's presenters
/// (`SettingsScreen`, `YourPrivacy`, `UpgradePage`) for the model's units and purchase, drawn by
/// IsItUI's `SettingsView`, with the app's own services behind the actions: the units through
/// `AppModel.setUnits(_:)`, the purchase through `PurchaseModel`, the pasteboard, the bundled
/// notices and the bundle's version. HomeView presents it, under the Debug recorder as it does
/// the picker.
///
/// The upgrade card comes first: "Remove ads and add widgets", with StoreKit's price once it has
/// given one, pushes the upgrade page onto Settings' own stack (no sheet over a sheet), or the
/// thanks once the purchase is owned; then Restore purchase, always, its result beneath it. The
/// product is asked for again as Settings appears, so a launch offline is put right later, and a
/// failure's line and the restore result go as it closes.
///
/// "Privacy choices" shows in the free version while Google's consent says its privacy options
/// form is required (`AdsModel.privacyChoices`), opens that form, and Your privacy points to it
/// meanwhile. "Ads on" is the free version, as section 14.2 starts the ads only when not
/// unlocked; the purchase sets `unlocked` the moment it is owned (`AppModel.purchaseChanged`),
/// which hides both at once, and Report an ad with them. The notifications are phase 8.1's, so
/// the data kept for them (with its delete button) doesn't show yet: that phase passes the last
/// registration's lines.
struct SettingsSheet: View {
  let model: AppModel
  /// The free version's ads.
  let ads: AdsModel
  /// The purchase: the upgrade card and its page.
  let purchases: PurchaseModel

  var body: some View {
    let model = model
    let ads = ads
    let purchases = purchases
    let choices = !model.unlocked && ads.privacyChoices
    SettingsView(
      screen: SettingsScreen(
        units: model.units,
        unlocked: model.unlocked,
        privacyChoices: choices,
        purchase: purchases.state,
        version: AppBundle.version
      ),
      privacy: YourPrivacy(adsOn: !model.unlocked, privacyChoices: choices),
      upgrade: UpgradePage(unlocked: model.unlocked, purchase: purchases.state),
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
        notice: AppBundle.notice,
        upgrade: .live(purchases),
        privacyChoices: choices ? { Task { await ads.openPrivacyChoices() } } : nil
      )
    )
    .task { await purchases.loadProduct() }
    .onDisappear { purchases.dismissResults() }
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
