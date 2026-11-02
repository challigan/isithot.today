import Foundation
import IsItModel

/// "How it works" (iOS build spec, section 10.6): the website's About page for snow, rewritten
/// for the app (`AppCopy.how*`), without the paragraph about the four sites. Every number is
/// the judging's own, from the generated constants (core `SNOW` and `MODELS`), written as the
/// About page writes it (`String(n)`, `Math.round`), so the text can't drift from the rules.
public struct HowItWorks: Sendable, Equatable {
  public struct Section: Sendable, Equatable {
    /// nil for the introduction.
    public let heading: String?
    public let paragraphs: [String]
  }

  /// "How it works"
  public let title: String
  public let sections: [Section]

  public init() {
    let number = JavaScriptNumber.string
    let percent = { (share: Double) in number(JavaScriptNumber.round(share * 100)) }
    let count = String(Constants.models.count)
    title = CoreCopy.howItWorks
    sections = [
      Section(heading: nil, paragraphs: [AppCopy.howIntro]),
      Section(
        heading: AppCopy.howAnswer,
        paragraphs: [
          AppCopy.howModels(
            count: count,
            // Fresh snow from 10 mm of water, cm, as the About page rounds it.
            depth: number(JavaScriptNumber.round(10 * Constants.Snow.cmPerMm)),
            day: number(Constants.Snow.Day.snow),
            hour: number(Constants.Snow.Hour.snow)
          ),
          AppCopy.howChance(
            likely: percent(Constants.Snow.likelyFrom),
            maybe: percent(Constants.Snow.maybeFrom)
          ),
          AppCopy.howWarm(warm: number(Constants.Snow.warmAboveC)),
        ]
      ),
      Section(
        heading: CoreCopy.viewLabel(.week),
        paragraphs: [AppCopy.howWeek(height: number(Constants.Snow.Normals.maxHeightDifference))]
      ),
      Section(heading: AppCopy.howLocation, paragraphs: [AppCopy.howLocationBody]),
      Section(
        heading: AppCopy.howData,
        paragraphs: [
          AppCopy.forecastModels(count: count, agencies: AppCredits.modelAgencies),
          AppCopy.howEstimates,
        ]
      ),
    ]
  }
}

/// "Credits and licences" (section 10.6): the forecast data, with its sources and licences linked
/// (core's credits, as the footer has them, then the climate records and the place names), and
/// the typeface and software in the app, each with its notice in full, a file the app bundles.
public struct CreditsPage: Sendable, Equatable {
  public struct Notice: Sendable, Equatable, Identifiable {
    /// "Bricolage Grotesque"
    public let name: String
    /// What it does in the app, its copyright and its licence.
    public let summary: String
    /// Its project's page.
    public let url: URL?
    /// "Bricolage Grotesque's project page": the label of the link to it, which shows the URL.
    public let urlLabel: String
    /// The notice's resource in the app's bundle, a `.txt` file.
    public let file: String

    public var id: String { file }
  }

  /// "Credits and licences"
  public let title: String
  /// "Forecasts and data"
  public let dataHeading: String
  /// "The forecasts come from 6 models run by ECMWF, NOAA (GFS), …"
  public let models: String
  /// Each credit in pieces, its phrases linked (`Credits.parts`).
  public let data: [[CreditPart]]
  /// "Typeface and software"
  public let softwareHeading: String
  public let notices: [Notice]

  public init() {
    title = AppCopy.credits
    dataHeading = AppCopy.creditsData
    models = AppCopy.forecastModels(
      count: String(Constants.models.count),
      agencies: AppCredits.modelAgencies
    )
    data =
      [CoreCopy.forecastCredit, CoreCopy.metOfficeCredit].map { Credits.parts($0) }
      + AppCredits.data.map { Credits.parts($0.text, adding: $0.links) }
    softwareHeading = AppCopy.creditsSoftware
    notices = AppCredits.notices.map {
      Notice(
        name: $0.name, summary: $0.summary, url: URL(string: $0.url),
        urlLabel: AppCopy.noticeProjectPage(name: $0.name), file: $0.file)
    }
  }
}

/// "Your privacy" (section 10.6): while notifications are registered, what the server keeps for
/// them comes first, under the title, with the button that deletes it, so the page's audit at
/// its top sees it whole (phase 8.2); once that button is tapped, what it did, in its place. Then
/// what the app sends and what is kept, in plain lines that say what the website's privacy
/// notice says; then the full policy.
public struct YourPrivacy: Sendable, Equatable {
  /// What is kept for notifications, from the last registration's answer (`keptLines`).
  public struct Kept: Sendable, Equatable {
    /// "What we keep for notifications"
    public let heading: String
    /// "ID b8465956", "Where you are: Leeds, Europe/London", "Snow units: cm", "Evening before
    /// (about 6pm)"
    public let lines: [String]
    /// "Turn off notifications and delete my data"
    public let delete: String
  }

  /// "Your privacy"
  public let title: String
  /// The plain lines, in order: the forecast's request, notifications, the ads (while they are
  /// on, with "See Privacy choices." while that row is in Settings), purchases, accounts.
  public let lines: [String]
  /// Nil while not registered for notifications.
  public let kept: Kept?
  /// What "Turn off notifications and delete my data" did (`deleteStatus(_:)`), once tapped.
  public let deleteStatus: String?
  /// "Privacy policy", opening willitsnow.today/privacy in Safari.
  public let policy: SettingsScreen.Row?

  /// The lines for the free version while `adsOn`, with the pointer to "Privacy choices" while
  /// `privacyChoices`; `kept` is what the server keeps, line by line, while registered, and
  /// `deleteStatus` what the delete did.
  public init(
    adsOn: Bool, privacyChoices: Bool, kept: [String]? = nil, deleteStatus: String? = nil
  ) {
    title = AppCopy.yourPrivacy
    var lines = [AppCopy.privacyForecast, AppCopy.privacyNotifications]
    if adsOn {
      lines.append(AppCopy.privacyAds)
      if privacyChoices { lines.append(AppCopy.seePrivacyChoices) }
    }
    lines += [AppCopy.privacyPurchases, AppCopy.privacyAccounts]
    self.lines = lines
    self.kept = kept.map {
      Kept(heading: AppCopy.keptForNotifications, lines: $0, delete: AppCopy.deleteMyData)
    }
    self.deleteStatus = deleteStatus
    policy = URL(string: Constants.Site.privacy).map {
      SettingsScreen.Row(
        id: "full-policy", title: AppCopy.privacyPolicy, action: .open($0), icon: .policy)
    }
  }

  /// What the server keeps for notifications, as the last PUT it answered (`alertSync.v2`) says
  /// (design 2.8): the ID's first 8 digits; where you are, its name and time zone, while the
  /// server has a place for it; the snow units it was sent in ("Snow units: cm"); then each switch
  /// it holds on, in Settings' words and order. Nil while not registered.
  public static func keptLines(_ registration: AlertRegistration?) -> [String]? {
    guard let registration else { return nil }
    let response = registration.response
    var lines = [AppCopy.keptID(id: String(response.id.prefix(8)))]
    if let here = response.here {
      lines.append(AppCopy.keptHere(place: here.name, zone: here.timezone))
    }
    lines.append(
      AppCopy.keptUnits(
        label: CoreCopy.snowUnitsLabel, units: CoreCopy.snowUnitName(registration.units)))
    let snow = response.alerts.snow
    if snow.evening { lines.append(AppCopy.evening) }
    if snow.morning { lines.append(AppCopy.morning) }
    if snow.possible { lines.append(AppCopy.possible) }
    return lines
  }

  /// What the delete did, in words: done, or not yet, when it didn't reach the server (the app
  /// tries again at its next open); nil before it and while it is under way.
  public static func deleteStatus(_ delete: NotificationsState.Delete) -> String? {
    switch delete {
    case .done: AppCopy.deleteDone
    case .notYet: AppCopy.deleteNotYet
    case .idle, .deleting: nil
    }
  }
}
