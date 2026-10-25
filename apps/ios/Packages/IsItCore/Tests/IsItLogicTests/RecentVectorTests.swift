import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

extension VectorPort {
  /// `recent.json`: client `addRecent` and `removeRecent`, ported as `RecentPlaces.adding` and
  /// `.removing`. Each list is decoded from the client's JSON (`recent.v1`) and compared whole,
  /// each place's line (`detail`) with it: present where the reference wrote one, absent where it
  /// left it out.
  static let recent = VectorPort { file in
    struct Add: Decodable, Sendable {
      let list: [RecentPlace]
      let target: Target
      let name: String
      let max: Int?
      let detail: String?
    }
    try file.compare("addRecent", input: Add.self, output: [RecentPlace].self) {
      if let max = $0.max {
        RecentPlaces.adding($0.target, name: $0.name, detail: $0.detail, to: $0.list, max: max)
      } else {
        RecentPlaces.adding($0.target, name: $0.name, detail: $0.detail, to: $0.list)
      }
    }

    struct Remove: Decodable, Sendable {
      let list: [RecentPlace]
      let target: Target
    }
    try file.compare("removeRecent", input: Remove.self, output: [RecentPlace].self) {
      RecentPlaces.removing($0.target, from: $0.list)
    }
  }
}
