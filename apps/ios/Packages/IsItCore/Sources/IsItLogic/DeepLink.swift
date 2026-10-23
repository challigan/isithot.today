import Foundation
import IsItModel

/// Where a link into the app, or a tap on one of its notifications, opens it: the port of
/// client `links.ts`, checked against `links.json`.
public enum DeepLink {
  /// Where the app opens (client `Route`).
  public enum Route: Sendable, Equatable {
    /// willitsnow://view/now, today or week (a widget).
    case view(AppView)
    /// willitsnow://upgrade (a locked widget).
    case upgrade
    /// willitsnow://settings/notifications.
    case settings(Section)
    /// A notification tap: its place, on `view`, or with nil on the place's view for the time
    /// of day (`MiddleDay.defaultView`, the client's `'default'`). The target is never
    /// approximate IP location.
    case place(Target, view: AppView?)

    /// A part of Settings a link opens.
    public enum Section: String, Codable, Sendable, CaseIterable {
      case notifications
    }
  }

  /// A willitsnow:// link, the app's URL scheme (client `parseDeepLink`). Case is ignored, and so
  /// is a query or fragment; anything else is nil, and the app opens as usual.
  public static func parse(_ url: String) -> Route? {
    let text = Array(javaScriptTrimmed(url).lowercased().unicodeScalars)
    guard let (host, path) = match(text) else { return nil }
    switch (host, path) {
    case ("view", let path?):
      return AppView(rawValue: path).map(Route.view)
    case ("upgrade", nil):
      return .upgrade
    case ("settings", "notifications"?):
      return .settings(.notifications)
    default:
      return nil
    }
  }

  /// `parse(_:)` for the URL the system opens the app with.
  public static func parse(_ url: URL) -> Route? {
    parse(url.absoluteString)
  }

  /// Where a tap on a notification goes (client `notificationRoute`): to the notification's own
  /// place, which need not be the one on screen. It opens on the notification's view (the middle
  /// one) while the day it was about is still today or tomorrow there: after 6pm the middle view
  /// reads Tomorrow and after midnight Today, either way that day. Once the day has passed it
  /// opens on the place's view for the time of day (`view` nil). `placeNow` gives the place's
  /// date and time now, as `PlaceTime.local(_:in:)` gives it in the place's zone (client
  /// `placeToday`, of which only the date is read), or nil when the app can't tell (it has no
  /// answer there yet), and the notification is then taken as current. A payload that is
  /// malformed, or for another topic or no chosen place, is nil: the app opens as usual.
  ///
  /// `payload` is the notification's `userInfo`, or any JSON object as `JSONSerialization` reads
  /// it: `topic`, `kind`, `date`, `view`, `place` (the place's today query) and `name`.
  public static func route(payload: Any?, placeNow: (Target) -> LocalDateTime?) -> Route? {
    guard let fields = payload as? [AnyHashable: Any] else { return nil }
    guard fields["topic"] as? String == "snow",
      let shown = (fields["view"] as? String).flatMap(AppView.init(rawValue:)),
      let day = (fields["date"] as? String).flatMap(calendarDay),
      let place = fields["place"] as? String,
      let found = Target(query: place),
      AlertSync.placeAllowed(found)
    else { return nil }
    var target = found
    // A city's query has no name, but the notification has.
    if case .city(let slug, _) = found, let name = fields["name"] as? String, !name.isEmpty {
      target = .city(slug: slug, name: name)
    }
    guard let today = placeNow(target)?.date else { return .place(target, view: shown) }
    // What `Date.parse` doesn't read is NaN, never today or tomorrow.
    let ahead = parsedDate(today).map { day - $0 }
    return .place(target, view: ahead == 0 || ahead == dayMs ? shown : nil)
  }

  // MARK: - Private

  private static let dayMs = 24 * 60 * 60 * 1000

  /// `^willitsnow:\/\/([a-z]+)(?:\/([a-z]+))?\/?(?:[?#]|$)`, the reference's pattern, matched
  /// as JavaScript matches it: the host and the path, or nil when it doesn't match.
  private static func match(_ text: [Unicode.Scalar]) -> (host: String, path: String?)? {
    let scheme = Array("willitsnow://".unicodeScalars)
    guard text.starts(with: scheme) else { return nil }
    var index = scheme.count
    let host = letters(text, from: &index)
    guard !host.isEmpty else { return nil }
    // With the path first, as the pattern tries it, then without.
    if index < text.count, text[index] == "/" {
      var after = index + 1
      let path = letters(text, from: &after)
      if !path.isEmpty, ends(text, at: after) { return (host, path) }
    }
    return ends(text, at: index) ? (host, nil) : nil
  }

  /// The run of `a` to `z` from `index`, which moves past it.
  private static func letters(_ text: [Unicode.Scalar], from index: inout Int) -> String {
    var run = String.UnicodeScalarView()
    while index < text.count, ("a"..."z").contains(text[index]) {
      run.append(text[index])
      index += 1
    }
    return String(run)
  }

  /// `\/?(?:[?#]|$)` at `index`: a slash or none, then the end, a query or a fragment.
  private static func ends(_ text: [Unicode.Scalar], at index: Int) -> Bool {
    var index = index
    if index < text.count, text[index] == "/" { index += 1 }
    return index == text.count || text[index] == "?" || text[index] == "#"
  }

  /// `text` without what JavaScript's `trim` takes off its ends: white space (ECMAScript
  /// WhiteSpace, the space separators among it) and line terminators. Not Swift's
  /// `whitespacesAndNewlines`, which has U+0085 and not U+FEFF.
  private static func javaScriptTrimmed(_ text: String) -> String {
    let scalars = text.unicodeScalars
    let isSpace = { (scalar: Unicode.Scalar) -> Bool in
      switch scalar.value {
      case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0xFEFF, 0x2028, 0x2029: true
      default: scalar.properties.generalCategory == .spaceSeparator
      }
    }
    guard let first = scalars.firstIndex(where: { !isSpace($0) }),
      let last = scalars.lastIndex(where: { !isSpace($0) })
    else { return "" }
    return String(scalars[first...last])
  }

  /// A calendar date (YYYY-MM-DD) as its UTC midnight in epoch milliseconds, or nil: 2026-02-30
  /// is not one (client `calendarDay`). The reference reads it with `Date.parse` and keeps it
  /// only when `toISOString` gives it back, which leaves exactly the real dates from 0000 to
  /// 9999.
  private static func calendarDay(_ text: String) -> Int? {
    guard let (year, month, day) = CivilDate.parts(text), day <= daysIn(month, of: year) else {
      return nil
    }
    return CivilDate.daysSinceEpoch(year: year, month: month, day: day) * dayMs
  }

  /// A place's date as JavaScript's `Date.parse` reads it, in epoch milliseconds: YYYY-MM-DD as
  /// UTC midnight, with any day up to 31 rolling over into the next month (2026-11-31 is 1
  /// December), as V8 reads it. Nil, JavaScript's NaN, for anything else. `Date.parse` also
  /// reads date-times and other forms, which a `LocalDateTime`'s date never is: `placeNow`
  /// takes one, rather than any text, so the app passes `PlaceTime.local(_:in:)` and not, say,
  /// an ISO formatter's output.
  private static func parsedDate(_ text: String) -> Int? {
    guard let (year, month, day) = CivilDate.parts(text) else { return nil }
    return CivilDate.daysSinceEpoch(year: year, month: month, day: day) * dayMs
  }

  private static func daysIn(_ month: Int, of year: Int) -> Int {
    switch month {
    case 2: year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) ? 29 : 28
    case 4, 6, 9, 11: 30
    default: 31
    }
  }
}

extension DeepLink.Route: Codable {
  private enum CodingKeys: String, CodingKey {
    case kind, view, section, target
  }

  private enum Kind: String, Codable {
    case view, upgrade, settings, place
  }

  /// A place route's view when it opens on the place's view for the time of day.
  private static let byTimeOfDay = "default"

  /// The client's JSON: `{ kind: "view", view }`, `{ kind: "upgrade" }`, `{ kind: "settings",
  /// section }`, or `{ kind: "place", target, view }`, whose view is "default" for nil.
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .kind) {
    case .view:
      self = .view(try container.decode(AppView.self, forKey: .view))
    case .upgrade:
      self = .upgrade
    case .settings:
      self = .settings(try container.decode(Section.self, forKey: .section))
    case .place:
      let view = try container.decode(String.self, forKey: .view)
      let shown = view == Self.byTimeOfDay ? nil : AppView(rawValue: view)
      guard view == Self.byTimeOfDay || shown != nil else {
        throw DecodingError.dataCorruptedError(
          forKey: .view, in: container, debugDescription: "Not a view: \(view)")
      }
      self = .place(try container.decode(Target.self, forKey: .target), view: shown)
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .view(let view):
      try container.encode(Kind.view, forKey: .kind)
      try container.encode(view, forKey: .view)
    case .upgrade:
      try container.encode(Kind.upgrade, forKey: .kind)
    case .settings(let section):
      try container.encode(Kind.settings, forKey: .kind)
      try container.encode(section, forKey: .section)
    case .place(let target, let view):
      try container.encode(Kind.place, forKey: .kind)
      try container.encode(target, forKey: .target)
      try container.encode(view?.rawValue ?? Self.byTimeOfDay, forKey: .view)
    }
  }
}
