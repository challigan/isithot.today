import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

extension VectorPort {
  /// `strip.json`: the snow models strip of core `viewDisplay(res, 'snow', 'today', 'ready',
  /// { tomorrow })`, ported as `StripGeometry`, for every fixture, today and tomorrow, and for an
  /// answer without snow.
  static let strip = VectorPort { file in
    let answers = FixtureAnswers()
    struct Strip: Decodable, Sendable, FixtureCase {
      let fixture: String
      let without: [String]?
      let tomorrow: Bool

      var description: String { "\(answerDescription), tomorrow \(tomorrow)" }
    }
    try file.compare("viewDisplay", input: Strip.self, output: StripGeometry.self) {
      StripGeometry(try answers($0), tomorrow: $0.tomorrow)
    }
  }
}
