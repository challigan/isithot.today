import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

extension VectorPort {
  /// `saved.json`: client `isSaved`, `canSave`, `savePlace`, `unsavePlace`, `choosePlace` and
  /// `shownRecent`, ported as `SavedPlaces`. Each list is decoded from the client's JSON
  /// (`savedPlaces.v1`, `recent.v1`) and compared whole, lines and all.
  static let saved = VectorPort { file in
    struct Saved: Decodable, Sendable {
      let saved: [SavedPlace]
      let target: Target
    }
    try file.compare("isSaved", input: Saved.self, output: Bool.self) {
      SavedPlaces.isSaved($0.target, in: $0.saved)
    }
    try file.compare("canSave", input: Saved.self, output: Bool.self) {
      SavedPlaces.canSave($0.target, in: $0.saved)
    }

    struct Save: Decodable, Sendable {
      let lists: PlaceLists
      let place: SavedPlace
    }
    try file.compare("savePlace", input: Save.self, output: PlaceLists.self) {
      SavedPlaces.saving($0.place, in: $0.lists)
    }

    struct Unsave: Decodable, Sendable {
      let lists: PlaceLists
      let target: Target
    }
    try file.compare("unsavePlace", input: Unsave.self, output: PlaceLists.self) {
      SavedPlaces.unsaving($0.target, in: $0.lists)
    }

    struct Choose: Decodable, Sendable {
      let lists: PlaceLists
      let target: Target
      let name: String
      let detail: String?
    }
    try file.compare("choosePlace", input: Choose.self, output: PlaceLists.self) {
      SavedPlaces.choosing($0.target, name: $0.name, detail: $0.detail, in: $0.lists)
    }

    struct Shown: Decodable, Sendable {
      let lists: PlaceLists
    }
    try file.compare("shownRecent", input: Shown.self, output: [RecentPlace].self) {
      SavedPlaces.shownRecent($0.lists)
    }
  }
}
