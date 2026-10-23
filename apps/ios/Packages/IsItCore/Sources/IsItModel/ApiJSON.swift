import Foundation

/// The API's JSON. Dates are ISO 8601 in UTC, with or without fractional seconds; the server
/// writes milliseconds ("2026-12-02T09:05:00.000Z", JavaScript's `toISOString`), and so does the
/// encoder.
public enum ApiJSON {
  public static func decoder() -> JSONDecoder {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .custom { decoder in
      let container = try decoder.singleValueContainer()
      let text = try container.decode(String.self)
      guard let date = parseDate(text) else {
        throw DecodingError.dataCorruptedError(
          in: container,
          debugDescription: "Not an ISO 8601 date: \(text)"
        )
      }
      return date
    }
    return decoder
  }

  public static func encoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .custom { date, encoder in
      var container = encoder.singleValueContainer()
      try container.encode(withFraction.format(date))
    }
    return encoder
  }

  /// An ISO 8601 date and time, or `nil`. For the forms the server writes (a "Z", and none to
  /// three fractional digits), the moment is `Date.parse`'s to the millisecond. Finer digits are
  /// dropped, as `Date.parse` drops them, rather than rounded. Elsewhere the two differ, and no
  /// answer has them: JavaScript reads a time with no offset as the device's own, which this
  /// refuses, and refuses "+00", which this reads.
  public static func parseDate(_ text: String) -> Date? {
    let text = toMilliseconds(text)
    return (try? withFraction.parse(text)) ?? (try? withoutFraction.parse(text))
  }

  /// `text` with a fraction of a second cut to its first three digits, the milliseconds.
  private static func toMilliseconds(_ text: String) -> String {
    let scalars = text.unicodeScalars
    guard let point = scalars.firstIndex(of: ".") else { return text }
    let digits = scalars[scalars.index(after: point)...].prefix { ("0"..."9").contains($0) }
    guard digits.count > 3 else { return text }
    var cut = String.UnicodeScalarView(scalars[...point])
    cut.append(contentsOf: digits.prefix(3))
    cut.append(contentsOf: scalars[digits.endIndex...])
    return String(cut)
  }

  private static let withFraction = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
  private static let withoutFraction = Date.ISO8601FormatStyle()
}
