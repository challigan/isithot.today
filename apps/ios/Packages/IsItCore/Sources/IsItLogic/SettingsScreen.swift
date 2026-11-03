import Foundation
import IsItModel

/// A page Settings opens on its own navigation stack (sections 10.4 and 10.6).
public enum SettingsPage: String, Sendable, Hashable, CaseIterable {
  /// The upgrade page (`UpgradePage`), pushed from the upgrade row, and from Settings →
  /// Notifications' "Saved places" without the purchase (phase 8.4b).
  case upgrade
  case yourPrivacy
  case howItWorks
  case credits
  /// Where you are (`NotificationPlacePage`), the free notification's place, pushed from
  /// Settings → Notifications' "Where you are" row.
  case notificationPlace
}

/// The Settings sheet as plain values (iOS build spec, section 10.4), in a native form's order:
///
/// 1. Units: "Snow units", cm | in, and the footnote;
/// 2. Notifications (section 12.1): `NotificationSettings`, drawn between the units and the
///    upgrade card; not one of `sections`;
/// 3. Upgrade: in the free version, "No ads, widgets and more · £1.99" once StoreKit has a price,
///    and "No ads, widgets and more" without one until then (no price StoreKit didn't give, and
///    the purchase is always there to find), either opening the upgrade page, which says why it
///    can't sell; once owned, the thanks (`AppCopy.thanks`); and "Restore purchase", always, its
///    result beneath it (section 10.4). The words are all `AppCopy`'s. A card with no heading,
///    as Report an ad's;
/// 4. Privacy: "Privacy choices" (only while the ads are on and Google's consent says the form
///    is required, which phase 8's ads report), "Your privacy", "Privacy policy";
/// 5. "Report an ad", in the free version only (section 10.7);
/// 6. About: "How it works", "Credits and licences", "Terms";
/// 7. Help: "Contact us", "Support";
/// 8. the version, "Version 1.0 (112)".
///
/// Web pages are willitsnow.today's own (`Constants.Site`), opened in Safari; the emails go to
/// the support address. Nothing here names another app, website or weather type (section 10.8).
public struct SettingsScreen: Sendable, Equatable {
  /// The snow units control: "Snow units", cm | in, the choice, and the footnote.
  public struct UnitsControl: Sendable, Equatable {
    public struct Choice: Sendable, Equatable, Identifiable {
      public let units: Units
      /// "cm", "in"
      public let name: String

      public var id: String { units.rawValue }
    }

    /// "Snow units"
    public let label: String
    public let choices: [Choice]
    /// The units every request asks in; nil before the first answer chose them, when neither
    /// choice shows as chosen.
    public let selected: Units?
    /// "Temperatures follow: cm with °C, inches with °F."
    public let footnote: String
    /// The row's icon: `.units`.
    public let icon: Icon
  }

  /// The icon at the start of a row (DECISIONS, "The iPhone app in the website's look"), one for
  /// each row, so that none goes without. IsItUI draws each as an SF Symbol, in a switch that
  /// names every case, and leaves it out at accessibility sizes, where the words need the card's
  /// width. Your privacy's "Privacy policy" button carries `.policy` too, as a row, but shows none.
  public enum Icon: String, Sendable, Equatable, CaseIterable {
    /// "Snow units", the units control's row.
    case units
    case upgrade
    case thanks
    case restore
    case privacyChoices
    case yourPrivacy
    case policy
    case reportAd
    case howItWorks
    case credits
    case terms
    case contactUs
    case support
    /// Settings → Notifications' switches: the evening before, on the day, and also when snow
    /// is possible.
    case evening
    case morning
    case possible
    /// The "Where you are" row, in Settings and on its page.
    case notificationPlace
    /// "Send a test notification".
    case test
    /// "Open Settings", for the app's notifications or its location access.
    case openSettings
    /// "Met Office warnings", in Safari.
    case warnings
    /// The "Where you are" page's "Use my location".
    case myLocation
    /// Settings → Notifications' "Saved places", the bells' row (phase 8.4b).
    case savedPlaces
  }

  /// What a row does when tapped.
  public enum Action: Sendable, Equatable {
    /// Opens a web page in Safari.
    case open(URL)
    /// Opens an email (`MailDraft.url`), or with no mail app, its fallback.
    case mail(MailDraft)
    /// Report an ad: the email is written at the tap (`MailDraft.reportAd`), with the time then.
    case reportAd
    /// Opens a page on Settings' own stack.
    case page(SettingsPage)
    /// Google's privacy options form (phase 8).
    case privacyChoices
    /// "Restore purchase": `AppStore.sync()`, then the entitlements again.
    case restore
    /// Says something and does nothing when tapped: the thanks once owned.
    case note
    /// A row of Settings → Notifications or of its "Where you are" page (`NotificationsModel`
    /// acts on it).
    case notification(NotificationAction)
  }

  /// What a row of Settings → Notifications, or of its "Where you are" page, asks for (design
  /// 2.1, 2.4).
  public enum NotificationAction: Sendable, Equatable {
    /// "Send a test notification".
    case sendTest
    /// The "Where you are" page's "Use my location": location access, asked for at the tap when
    /// it never was, then a fix for where you are.
    case useMyLocation
    /// "Open Settings" while notifications are off for the app: its notification settings.
    case openNotificationSettings
    /// "Open Settings" while location access is off for the app: its settings.
    case openLocationSettings
    /// "Saved places" with the purchase: the search screen, where each saved place's bell is
    /// (`NotificationsModel.requestPicker(locating: false)`, phase 8.4b). Without the purchase the
    /// row opens the upgrade page instead (`.page(.upgrade)`).
    case savedPlaces
  }

  public struct Row: Sendable, Equatable, Identifiable {
    /// The row's accessibility identifier: "privacy-policy".
    public let id: String
    public let title: String
    public let action: Action
    public let icon: Icon
    /// A line beneath the title: Restore purchase's result.
    public let detail: String?
    /// The row takes no tap meanwhile: Restore purchase while it restores.
    public let busy: Bool

    public init(
      id: String, title: String, action: Action, icon: Icon, detail: String? = nil,
      busy: Bool = false
    ) {
      self.id = id
      self.title = title
      self.action = action
      self.icon = icon
      self.detail = detail
      self.busy = busy
    }
  }

  public struct Section: Sendable, Equatable, Identifiable {
    public let id: String
    /// "Privacy", "About", "Help"; nil for a card whose rows say what they are: the upgrade
    /// and Restore purchase, and Report an ad.
    public let heading: String?
    public let rows: [Row]
  }

  /// "Settings"
  public let title: String
  /// "Close"
  public let close: String
  public let units: UnitsControl
  /// Upgrade, Privacy, Report an ad (free only), About and Help, in order.
  public let sections: [Section]
  /// "Version 1.0 (112)", or nil when the bundle doesn't say.
  public let version: String?

  /// Settings for the units `units` (nil before the first answer), the free version unless
  /// `unlocked`, with "Privacy choices" when `privacyChoices` (ads on and the form required),
  /// the purchase as `PurchaseModel` keeps it (`purchase`), and the app's `version`.
  public init(
    units: Units?, unlocked: Bool, privacyChoices: Bool, purchase: PurchaseState,
    version: AppVersion?
  ) {
    title = AppCopy.settings
    close = CoreCopy.close
    self.units = UnitsControl(
      label: CoreCopy.snowUnitsLabel,
      choices: [Units.c, .f].map { .init(units: $0, name: CoreCopy.snowUnitName($0)) },
      selected: units,
      footnote: AppCopy.unitsFootnote,
      icon: .units
    )
    var upgrade: [Row] = []
    if unlocked {
      upgrade.append(Row(id: "thanks", title: AppCopy.thanks, action: .note, icon: .thanks))
    } else if case .ready(let price, _) = purchase.product {
      upgrade.append(
        Row(
          id: "upgrade", title: AppCopy.upgradeSettings(price: price), action: .page(.upgrade),
          icon: .upgrade))
    } else {
      upgrade.append(
        Row(id: "upgrade", title: AppCopy.upgradeTitle, action: .page(.upgrade), icon: .upgrade))
    }
    upgrade.append(UpgradePage.restoreRow(id: "restore", purchase.restore))
    var privacy: [Row] = []
    if privacyChoices {
      privacy.append(
        Row(
          id: "privacy-choices", title: AppCopy.privacyChoices, action: .privacyChoices,
          icon: .privacyChoices))
    }
    privacy.append(
      Row(
        id: "your-privacy", title: AppCopy.yourPrivacy, action: .page(.yourPrivacy),
        icon: .yourPrivacy))
    privacy += Self.web("privacy-policy", AppCopy.privacyPolicy, Constants.Site.privacy, .policy)
    var sections = [
      Section(id: "upgrade", heading: nil, rows: upgrade),
      Section(id: "privacy", heading: AppCopy.settingsPrivacy, rows: privacy),
    ]
    if !unlocked {
      sections.append(
        Section(
          id: "report",
          heading: nil,
          rows: [
            Row(id: "report-ad", title: AppCopy.reportAd, action: .reportAd, icon: .reportAd)
          ]
        ))
    }
    sections.append(
      Section(
        id: "about",
        heading: AppCopy.settingsAbout,
        rows: [
          Row(
            id: "how-it-works", title: CoreCopy.howItWorks, action: .page(.howItWorks),
            icon: .howItWorks),
          Row(id: "credits", title: AppCopy.credits, action: .page(.credits), icon: .credits),
        ] + Self.web("terms", AppCopy.terms, Constants.Site.terms, .terms)
      ))
    sections.append(
      Section(
        id: "help",
        heading: AppCopy.settingsHelp,
        rows: [
          Row(
            id: "contact-us", title: AppCopy.contactUs, action: .mail(.contactUs()),
            icon: .contactUs)
        ] + Self.web("support", AppCopy.support, Constants.Site.support, .support)
      ))
    self.sections = sections
    self.version = version?.line
  }

  /// A row that opens `address` in Safari, with `icon`; none if it isn't a URL.
  private static func web(_ id: String, _ title: String, _ address: String, _ icon: Icon)
    -> [Row]
  {
    URL(string: address).map { [Row(id: id, title: title, action: .open($0), icon: icon)] } ?? []
  }
}
