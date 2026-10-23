import Foundation

/// The API's JSON. Dates are ISO 8601 in UTC, with or without fractional seconds; the server
/// writes milliseconds ("2026-12-02T09:05:00.000Z"), and so does the encoder.
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

  /// An ISO 8601 date and time, or `nil`.
  public static func parseDate(_ text: String) -> Date? {
    (try? withFraction.parse(text)) ?? (try? withoutFraction.parse(text))
  }

  private static let withFraction = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
  private static let withoutFraction = Date.ISO8601FormatStyle()
}
