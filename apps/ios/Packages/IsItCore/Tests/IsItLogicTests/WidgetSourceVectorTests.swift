import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

extension VectorPort {
  /// `widgetSource.json`: client `widgetReuses` and `widgetFallsBack`, ported as
  /// `WidgetSource.reuses` and `.fallsBack`, for each fixture's answer saved under its own key,
  /// asked for under that key, another and the same with a space more, in its units, the others
  /// and none, at moments either side of `reuseMinutes` and `usableUntil`, and with nothing saved.
  /// The saved answer is the fixture's whole response, rebuilt as the App Group keeps it.
  static let widgetSource = VectorPort { file in
    let answers = FixtureAnswers()

    struct Saved: Decodable, Sendable, CustomStringConvertible {
      let fixture: String?
      let savedKey: String?
      let savedAt: Int?
      let key: String
      let units: Units?
      /// `widgetReuses`' only.
      let now: Int?

      var description: String {
        let saved = fixture.map { "\($0) saved under \(savedKey ?? "?") at \(savedAt ?? 0)" }
        return "\(saved ?? "nothing saved"), asked for \(key) in \(units?.rawValue ?? "any units")"
          + (now.map { " at \($0)" } ?? "")
      }
    }

    /// The saved answer the case names, or nil for nothing saved.
    func saved(_ input: Saved) throws -> SavedToday? {
      guard let fixture = input.fixture else { return nil }
      return SavedToday(
        key: try #require(input.savedKey),
        savedAt: Date(epochMs: try #require(input.savedAt)),
        response: try answers(fixture))
    }

    try file.compare("widgetReuses", input: Saved.self, output: Bool.self) { input in
      WidgetSource.reuses(
        try saved(input), key: input.key, units: input.units,
        at: Date(epochMs: try #require(input.now)))
    }
    try file.compare("widgetFallsBack", input: Saved.self, output: Bool.self) { input in
      WidgetSource.fallsBack(try saved(input), key: input.key, units: input.units)
    }
  }
}
