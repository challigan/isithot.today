import Foundation
import IsItModel
import IsItTestSupport
import Testing

extension VectorPort {
  /// `questions.json`: core `question(city, view, 'snow', tomorrow)`, which the generated
  /// `Questions.snow(view:place:tomorrow:)` words from core's own templates. The cases include
  /// places a replacement pattern or an interpolation would trip on ("$&", "{place}", "\(…)").
  static let questions = VectorPort { file in
    struct Question: Decodable, Sendable, CustomStringConvertible {
      let city: String?
      let view: AppView
      let tomorrow: Bool

      var description: String {
        "\(city.map { "\"\($0)\"" } ?? "nil"), \(view.rawValue), tomorrow \(tomorrow)"
      }
    }
    try file.compare("question", input: Question.self, output: String.self) {
      Questions.snow(view: $0.view, place: $0.city, tomorrow: $0.tomorrow)
    }
  }
}
