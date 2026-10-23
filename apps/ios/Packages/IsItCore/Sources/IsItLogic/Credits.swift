import Foundation
import IsItModel

/// A piece of a credit: plain text, or a phrase linked to its source or licence.
public struct CreditPart: Codable, Sendable, Equatable {
  public let text: String
  /// Where the phrase links to; nil for plain text.
  public let url: URL?

  public init(text: String, url: URL? = nil) {
    self.text = text
    self.url = url
  }
}

/// The credits of the footer (`attribution`), with Open-Meteo, the licences and NASA POWER
/// linked, as the website links them: the port of core `creditParts` (`copy.ts`), checked
/// against `page.json`.
public enum Credits {
  /// `text` in pieces, in order (core `creditParts`): each phrase of `CoreCopy.creditLinks` with
  /// its link, from the left (where two could start at the same place, the first in the list),
  /// and the text between them, never empty. Phrases are matched code unit for code unit, as
  /// JavaScript's `startsWith` matches them.
  public static func parts(_ text: String) -> [CreditPart] {
    let links = CoreCopy.creditLinks.compactMap { link -> (phrase: [UInt16], url: URL)? in
      guard !link.phrase.isEmpty, let url = URL(string: link.url) else { return nil }
      return (Array(link.phrase.utf16), url)
    }
    let units = Array(text.utf16)
    var parts: [CreditPart] = []
    // Where the plain text since the last link starts.
    var start = 0
    var index = 0
    while index < units.count {
      guard let link = links.first(where: { units[index...].starts(with: $0.phrase) }) else {
        index += 1
        continue
      }
      if index > start {
        parts.append(CreditPart(text: string(units[start..<index])))
      }
      let end = index + link.phrase.count
      parts.append(CreditPart(text: string(units[index..<end]), url: link.url))
      index = end
      start = end
    }
    if start < units.count {
      parts.append(CreditPart(text: string(units[start...])))
    }
    return parts
  }

  private static func string(_ units: ArraySlice<UInt16>) -> String {
    String(decoding: units, as: UTF16.self)
  }
}
