import Foundation
import IsItModel

/// The app's version, as its bundle gives it (`CFBundleShortVersionString` and
/// `CFBundleVersion`): "1.0" and "112".
public struct AppVersion: Sendable, Equatable {
  public let version: String
  public let build: String

  /// The version from the bundle's two values; nil when either is missing or empty.
  public init?(version: String?, build: String?) {
    guard let version, !version.isEmpty, let build, !build.isEmpty else { return nil }
    self.version = version
    self.build = build
  }

  /// Settings' last line (section 10.4): "Version 1.0 (112)".
  public var line: String { AppCopy.version(version: version, build: build) }
}

/// What the app shows when no mail app can open a draft (section 10.7): where to write, with a
/// button that copies the address and says so.
public struct MailFallback: Sendable, Equatable, Identifiable {
  /// "Report an ad", or "Contact us".
  public let title: String
  /// "Email support@willitsnow.today with a screenshot of the ad and the time you saw it."
  public let body: String
  /// The support address, which "Copy address" copies.
  public let address: String
  /// "Copy address"
  public let copyAddress: String
  /// "Copied.", once the address is copied.
  public let copied: String
  /// "Close"
  public let close: String

  public var id: String { title }

  init(title: String, body: String, address: String) {
    self.title = title
    self.body = body
    self.address = address
    copyAddress = AppCopy.copyAddress
    copied = AppCopy.copied
    close = CoreCopy.close
  }
}

/// An email the app offers to write, to the support address (core `CONTACT_EMAIL`): Contact us
/// (section 10.4) and Report an ad (section 10.7). The app opens `url`; when no mail app can
/// (the open's completion says false), it shows `fallback` instead.
public struct MailDraft: Sendable, Equatable {
  public let address: String
  public let subject: String?
  public let body: String?
  public let fallback: MailFallback

  /// `mailto:` the address, with the subject and the body when there are, each encoded as
  /// JavaScript's `encodeURIComponent` encodes it (RFC 6068): a space is `%20`, a line break
  /// `%0A`. Nil only for an address no URL can hold.
  public var url: URL? {
    var text = "mailto:" + address
    let fields = [("subject", subject), ("body", body)].compactMap { name, value in
      value.map { "\(name)=\(Self.encoded($0))" }
    }
    if !fields.isEmpty { text += "?" + fields.joined(separator: "&") }
    return URL(string: text)
  }

  /// Contact us: an email to the support address, with nothing filled in.
  public static func contactUs() -> MailDraft {
    let address = Constants.Site.contactEmail
    return MailDraft(
      address: address,
      subject: nil,
      body: nil,
      fallback: MailFallback(
        title: AppCopy.contactUs,
        body: AppCopy.contactUsBody(email: address),
        address: address
      )
    )
  }

  /// Report an ad, written at `now`: the subject names the app's version ("Report an ad
  /// (willitsnow.today 1.0)", or "Report an ad" without one), and the body the time on the phone,
  /// in its own time zone `zone`, and the place on screen (empty while none is known), with a
  /// line to say what was wrong.
  public static func reportAd(
    version: AppVersion?,
    place: String?,
    at now: Date,
    zone: String
  ) -> MailDraft {
    let address = Constants.Site.contactEmail
    return MailDraft(
      address: address,
      subject: version.map { AppCopy.reportAdSubject(version: $0.version) } ?? AppCopy.reportAd,
      body: AppCopy.reportAdMail(time: phoneTime(now, zone: zone), place: place ?? ""),
      fallback: MailFallback(
        title: AppCopy.reportAd,
        body: AppCopy.reportAdBody(email: address),
        address: address
      )
    )
  }

  /// The time on the phone for the report, in figures with its zone, so it can be matched with
  /// the ad's logs: "2026-10-23 15:05 Europe/London". A zone the system doesn't know is read as
  /// UTC, under its own name (`PlaceTime.local`).
  public static func phoneTime(_ now: Date, zone: String) -> String {
    let local = PlaceTime.local(now, in: zone)
    let minutes = Int((local.hours * 60).rounded())
    return "\(local.date) \(twoDigits(minutes / 60)):\(twoDigits(minutes % 60)) \(zone)"
  }

  private static func twoDigits(_ value: Int) -> String {
    value < 10 ? "0\(value)" : String(value)
  }

  /// What `encodeURIComponent` leaves as it is: letters, digits and `-_.!~*'()`.
  private static let unreserved = CharacterSet(
    charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
  )

  /// `text` percent-encoded as UTF-8, everything but `unreserved`.
  static func encoded(_ text: String) -> String {
    text.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
  }
}
