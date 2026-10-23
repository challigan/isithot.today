import Foundation
import IsItModel

/// One of the picker's recent places (client `RecentPlace`), as `recent.v1` keeps it.
public struct RecentPlace: Codable, Sendable, Equatable {
  /// A place someone chose: never approximate IP location.
  public var target: Target
  /// The place's name as it was shown (a device location's comes from its answer).
  public var name: String

  public init(target: Target, name: String) {
    self.target = target
    self.name = name
  }
}

/// The picker's recent places: newest first, one entry per place (`Target.key`), and never
/// approximate IP location. The port of client `recent.ts`, checked against `recent.json`.
public enum RecentPlaces {
  /// The most the list keeps.
  public static let defaultMax = 5

  /// The list with `target` first, without any older entry for the same place, at most `max`
  /// long (client `addRecent`). Approximate IP location is never added: the list is only cut to
  /// `max`.
  public static func adding(
    _ target: Target,
    name: String,
    to list: [RecentPlace],
    max: Int = defaultMax
  ) -> [RecentPlace] {
    if case .ip = target { return prefix(list, max) }
    let others = removing(target, from: list)
    return prefix([RecentPlace(target: target, name: name)] + others, max)
  }

  /// The list without `target` (client `removeRecent`).
  public static func removing(_ target: Target, from list: [RecentPlace]) -> [RecentPlace] {
    // Keys compared byte for byte, as JavaScript compares strings, where Swift's `==` would take
    // canonically equivalent text (a slug from a query) as the same.
    let key = Array(target.key.utf8)
    return list.filter { !$0.target.key.utf8.elementsEqual(key) }
  }

  /// `list.slice(0, max)`: the first `max`, or for a negative `max` all but the last `-max`.
  private static func prefix(_ list: [RecentPlace], _ max: Int) -> [RecentPlace] {
    let end = max < 0 ? Swift.max(list.count + max, 0) : Swift.min(max, list.count)
    return Array(list[..<end])
  }
}
