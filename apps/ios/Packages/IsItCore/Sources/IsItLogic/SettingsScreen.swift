import Foundation
import IsItModel

/// A page Settings opens on its own navigation stack (sections 10.4 and 10.6).
public enum SettingsPage: String, Sendable, Hashable, CaseIterable {
  case yourPrivacy
  case howItWorks
  case credits
}

/// The Settings sheet as plain values (iOS build spec, section 10.4), in a native form's order:
///
/// 1. Units: "Snow units", cm | in, and the footnote;
/// 2. Notifications (section 12.1): phase 8 inserts it here, with its own switches;
/// 3. Upgrade and "Restore purchase": phase 7 inserts them here, with StoreKit. Until then
///    there is nothing to buy or restore, so neither shows, rather than a row that can't work
///    (section 0.2: nothing dormant);
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
  }

  public struct Row: Sendable, Equatable, Identifiable {
    /// The row's accessibility identifier: "privacy-policy".
    public let id: String
    public let title: String
    public let action: Action
  }

  public struct Section: Sendable, Equatable, Identifiable {
    public let id: String
    /// "Privacy", "About", "Help"; nil for a section of one row that says what it is.
    public let heading: String?
    public let rows: [Row]
  }

  /// "Settings"
  public let title: String
  /// "Close"
  public let close: String
  public let units: UnitsControl
  /// Privacy, Report an ad (free only), About and Help, in order.
  public let sections: [Section]
  /// "Version 1.0 (112)", or nil when the bundle doesn't say.
  public let version: String?

  /// Settings for the units `units` (nil before the first answer), the free version unless
  /// `unlocked`, with "Privacy choices" when `privacyChoices` (ads on and the form required),
  /// and the app's `version`.
  public init(units: Units?, unlocked: Bool, privacyChoices: Bool, version: AppVersion?) {
    title = AppCopy.settings
    close = CoreCopy.close
    self.units = UnitsControl(
      label: CoreCopy.snowUnitsLabel,
      choices: [Units.c, .f].map { .init(units: $0, name: CoreCopy.snowUnitName($0)) },
      selected: units,
      footnote: AppCopy.unitsFootnote
    )
    var privacy: [Row] = []
    if privacyChoices {
      privacy.append(
        Row(id: "privacy-choices", title: AppCopy.privacyChoices, action: .privacyChoices))
    }
    privacy.append(Row(id: "your-privacy", title: AppCopy.yourPrivacy, action: .page(.yourPrivacy)))
    privacy += Self.web("privacy-policy", AppCopy.privacyPolicy, Constants.Site.privacy)
    var sections = [Section(id: "privacy", heading: AppCopy.settingsPrivacy, rows: privacy)]
    if !unlocked {
      sections.append(
        Section(
          id: "report",
          heading: nil,
          rows: [Row(id: "report-ad", title: AppCopy.reportAd, action: .reportAd)]
        ))
    }
    sections.append(
      Section(
        id: "about",
        heading: AppCopy.settingsAbout,
        rows: [
          Row(id: "how-it-works", title: CoreCopy.howItWorks, action: .page(.howItWorks)),
          Row(id: "credits", title: AppCopy.credits, action: .page(.credits)),
        ] + Self.web("terms", AppCopy.terms, Constants.Site.terms)
      ))
    sections.append(
      Section(
        id: "help",
        heading: AppCopy.settingsHelp,
        rows: [Row(id: "contact-us", title: AppCopy.contactUs, action: .mail(.contactUs()))]
          + Self.web("support", AppCopy.support, Constants.Site.support)
      ))
    self.sections = sections
    self.version = version?.line
  }

  /// A row that opens `address` in Safari; none if it isn't a URL.
  private static func web(_ id: String, _ title: String, _ address: String) -> [Row] {
    URL(string: address).map { [Row(id: id, title: title, action: .open($0))] } ?? []
  }
}
