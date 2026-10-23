import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

extension VectorPort {
  /// `tomorrow.json`: core `showsTomorrow`, `defaultView` and `viewLabel`, ported as
  /// `MiddleDay.showsTomorrow`, `.defaultView` and `.label`.
  static let tomorrow = VectorPort { file in
    let answers = FixtureAnswers()
    try file.compare("showsTomorrow", input: FixtureAt.self, output: Bool.self) {
      MiddleDay.showsTomorrow(try answers($0), at: Date(epochMs: $0.now))
    }
    try file.compare("defaultView", input: FixtureAt.self, output: AppView.self) {
      MiddleDay.defaultView(try answers($0), at: Date(epochMs: $0.now))
    }
    struct Label: Decodable, Sendable, CustomStringConvertible {
      let view: AppView
      let tomorrow: Bool

      var description: String { "\(view.rawValue), tomorrow \(tomorrow)" }
    }
    try file.compare("viewLabel", input: Label.self, output: String.self) {
      MiddleDay.label($0.view, tomorrow: $0.tomorrow)
    }
  }
}
