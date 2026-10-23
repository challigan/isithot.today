import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

extension VectorPort {
  /// `placeTime.json`: core `localDateTime`, ported as `PlaceTime.local(_:in:)`.
  static let placeTime = VectorPort { file in
    struct At: Decodable, Sendable, CustomStringConvertible {
      let timezone: String
      let now: Int

      var description: String { "\(timezone) at \(now)" }
    }
    try file.compare("localDateTime", input: At.self, output: LocalDateTime.self) {
      PlaceTime.local(Date(epochMs: $0.now), in: $0.timezone)
    }
  }
}
