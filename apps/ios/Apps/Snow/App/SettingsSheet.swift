import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItUI
import SwiftUI
import UIKit

/// The Settings sheet (iOS build spec, section 10.4), from the model: IsItLogic's presenters
/// (`SettingsScreen`, `NotificationSettings`, `NotificationPlacePage`, `YourPrivacy`,
/// `UpgradePage`) for the model's units, notifications and purchase, drawn by IsItUI's
/// `SettingsView`, with the app's own services behind the actions: the units through
/// `AppModel.setUnits(_:)`, the notifications through `NotificationsModel`, the purchase through
/// `PurchaseModel`, the pasteboard, the bundled notices and the bundle's version. HomeView
/// presents it, under the Debug recorder as it does the picker, so iOS Settings' pages and the
/// Met Office's are recorded as every other link is.
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
/// which hides both at once, and Report an ad with them.
///
/// Notifications (section 12.1; design 2.4) sit between the units and the upgrade card: the
/// switches, which need no place first, as where you are is always one; the line that says what
/// is kept for it; "Where you are", whose page (design 2.1) this builds from the model in its body
/// too, so the pushed page follows the model; and the test. That page's "Use my location" asks
/// the model, which asks for location access at the tap and finds the phone. The permission is
/// read again as Settings or that page appears, and the test's result, the page's problem and the
/// delete's line go as Settings closes. While registered, Your privacy shows what the server
/// keeps for them first, from `alertSync.v2`, with "Turn off notifications and delete my data"
/// (phase 8.2; design 2.8).
struct SettingsSheet: View {
  let model: AppModel
  /// The free version's ads.
  let ads: AdsModel
  /// The purchase: the upgrade card and its page.
  let purchases: PurchaseModel
  /// The notifications: their section, the "Where you are" page and Your privacy's kept block.
  let notifications: NotificationsModel

  @Environment(\.openURL) private var openURL

  var body: some View {
    let model = model
    let ads = ads
    let purchases = purchases
    let notifications = notifications
    let state = notifications.state
    let choices = !model.unlocked && ads.privacyChoices
    SettingsView(
      screen: SettingsScreen(
        units: model.units,
        unlocked: model.unlocked,
        privacyChoices: choices,
        purchase: purchases.state,
        version: AppBundle.version
      ),
      notifications: NotificationSettings(state),
      notificationPlace: NotificationPlacePage(state),
      privacy: YourPrivacy(
        adsOn: !model.unlocked,
        privacyChoices: choices,
        kept: YourPrivacy.keptLines(state.registration),
        deleteStatus: YourPrivacy.deleteStatus(state.delete)
      ),
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
        privacyChoices: choices ? { Task { await ads.openPrivacyChoices() } } : nil,
        deleteMyData: state.registration == nil
          ? nil : { Task { await notifications.deleteMyData() } },
        notifications: NotificationActions(
          setSwitch: { which, on in
            Task { await notifications.setSwitch(which, on: on) }
          },
          perform: perform,
          appeared: { Task { await notifications.refreshPermission() } }
        )
      )
    )
    .task { await purchases.loadProduct() }
    .onDisappear {
      purchases.dismissResults()
      notifications.dismissResults()
    }
  }

  /// A row of Settings → Notifications or of its "Where you are" page: the test; "Use my
  /// location", which asks for location access at the tap and finds the phone for where you are;
  /// iOS Settings' page for the app's notifications, or for its location access (through the
  /// environment's `openURL`, so a Debug build's recorder records both).
  private func perform(_ action: SettingsScreen.NotificationAction) {
    let notifications = notifications
    switch action {
    case .sendTest:
      Task { await notifications.sendTest() }
    case .useMyLocation:
      Task { await notifications.useMyLocation() }
    case .openNotificationSettings:
      open(UIApplication.openNotificationSettingsURLString)
    case .openLocationSettings:
      open(UIApplication.openSettingsURLString)
    }
  }

  /// Opens one of iOS Settings' pages for the app.
  private func open(_ text: String) {
    if let url = URL(string: text) { openURL(url) }
  }
}

/// What the app's bundle holds that Settings and the notifications show or send: its version
/// and build (Info.plist), the APNs environment its registrations name, and the notices it
/// bundles (`Resources/Licences`).
enum AppBundle {
  static let version = AppVersion(
    version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
    build: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
  )

  /// The Info.plist's `IsItPushEnvironment` (`PUSH_ENV` in Snow.xcconfig: the sandbox in Debug,
  /// production in Release), which a registration names so the server sends through the APNs
  /// environment the token belongs to; production when absent or unreadable, as an App Store
  /// build's is.
  static let pushEnvironment: RegistrationBody.Env =
    (Bundle.main.object(forInfoDictionaryKey: "IsItPushEnvironment") as? String)
    .flatMap(RegistrationBody.Env.init(rawValue:)) ?? .production

  /// A bundled notice's full text, by its resource name; nil when it isn't bundled.
  static func notice(_ file: String) -> String? {
    guard let url = Bundle.main.url(forResource: file, withExtension: "txt") else { return nil }
    return try? String(contentsOf: url, encoding: .utf8)
  }
}
