import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

/// A `widgetFace.json` case: `widget.json`'s plan, and the entry of it to face.
struct FaceCase: Decodable, Sendable, CustomStringConvertible {
  let fixture: String?
  let without: [String]?
  let fetchedAt: Int
  let now: Int
  let unlocked: Bool
  let placeName: String?
  let index: Int

  var description: String {
    let answer = fixture.map { name in
      without.map { "\(name) without \($0.joined(separator: ", "))" } ?? name
    }
    return "entry \(index) of \(answer ?? "no answer") at \(now), fetched \(fetchedAt), "
      + (unlocked ? "unlocked" : "locked") + (placeName.map { ", named \($0)" } ?? "")
  }

  /// The case's entry, replanned by `WidgetPlanner.entries` (held to `widget.json` already), and
  /// the unit its amounts are in: the answer's, or centimetres without one.
  func entry(_ answers: FixtureAnswers) throws -> (entry: WidgetEntry, unit: SnowUnit) {
    let res = try fixture.map { try answers($0, without: without ?? []) }
    let plan = WidgetPlanner.entries(
      res,
      fetchedAt: Date(epochMs: fetchedAt),
      now: Date(epochMs: now),
      unlocked: unlocked,
      placeName: placeName
    )
    try #require(plan.entries.indices.contains(index), "\(self): no such entry")
    return (plan.entries[index], res?.snow?.unit ?? .cm)
  }
}

extension VectorPort {
  /// `widgetFace.json`: packages/mobile `widgetFace`, ported as `WidgetFace`, for every fixture's
  /// first entry, every entry of aberdeen-snow's timeline and of durham-tomorrow either side of
  /// 6pm, locked, with no answer, with and without the place's own name, a week day without
  /// counts, no middle day, and the fixtures the right half reads differently. Each face is built
  /// from the entry as `WidgetPlanner` plans it and compared whole with the decoded reference.
  static let widgetFace = VectorPort { file in
    let answers = FixtureAnswers()
    try file.compare("widgetFace", input: FaceCase.self, output: WidgetFace.self) { input in
      let (entry, unit) = try input.entry(answers)
      return WidgetFace(entry, unit: unit)
    }
  }
}

/// Every `widgetFace.json` case's entry, with the face the Swift builds for it: what the checks of
/// `WidgetFaceTests` read across all of them.
func vectorFaces() throws -> [(entry: WidgetEntry, face: WidgetFace)] {
  let answers = FixtureAnswers()
  return try Vectors.cases(
    "widgetFace", fn: "widgetFace", input: FaceCase.self, output: WidgetFace.self
  ).map { item in
    let (entry, unit) = try item.input.entry(answers)
    return (entry, WidgetFace(entry, unit: unit))
  }
}
