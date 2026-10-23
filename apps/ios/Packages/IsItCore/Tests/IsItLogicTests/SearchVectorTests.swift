import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

extension VectorPort {
  /// `search.json`: client `searchInput` and `resultDetail`, ported as `PlaceSearch.input` and
  /// `.detail`, so the picker trims and counts as the website does and words a result the same.
  static let search = VectorPort { file in
    struct Text: Decodable, Sendable {
      let text: String
    }
    try file.compare("searchInput", input: Text.self, output: PlaceSearch.Input.self) {
      PlaceSearch.input($0.text)
    }

    struct Result: Decodable, Sendable {
      let result: SearchResult
    }
    try file.compare("resultDetail", input: Result.self, output: String.self) {
      PlaceSearch.detail($0.result)
    }
  }
}
