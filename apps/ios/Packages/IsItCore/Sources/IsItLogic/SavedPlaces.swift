import Foundation
import IsItModel

/// One of the picker's saved places (client `SavedPlace`), as `savedPlaces.v1` keeps it.
public struct SavedPlace: Codable, Sendable, Equatable {
  /// The place, as it was chosen or found: never approximate IP location, nor the phone's own
  /// point.
  public var target: Target
  /// Its name as shown ("Leeds"). It doesn't change when its answer names it differently.
  public var name: String
  /// The line beneath it ("England, United Kingdom"), when known.
  public var detail: String?

  public init(target: Target, name: String, detail: String? = nil) {
    self.target = target
    self.name = name
    self.detail = detail
  }
}

/// The picker's two lists (client `PlaceLists`), which every action changes together.
public struct PlaceLists: Codable, Sendable, Equatable {
  /// The saved places, in the order saved, the newest last.
  public var saved: [SavedPlace]
  /// The recent places, newest first.
  public var recent: [RecentPlace]

  public init(saved: [SavedPlace], recent: [RecentPlace]) {
    self.saved = saved
    self.recent = recent
  }
}

/// The picker's saved places beside its recent places: at most `max`, in the order saved with
/// the newest last, one entry per place (`Target.key`), and never a place shown in both lists.
/// Saving takes a place out of the recent places, removing it puts it back on top of them (so one
/// more tap on its star undoes it), and choosing a saved place leaves the recent places alone.
/// Approximate IP location is never saved, and nor is the phone's own point: a device fix
/// follows the phone, and a saved place that moved would mislead. The port of client `saved.ts`,
/// checked against `saved.json`.
public enum SavedPlaces {
  /// The most saved places there can be (client `PLACES.savedMax`).
  public static let max = Constants.Places.savedMax

  /// Whether a saved place is `target`'s place, by its key (client `isSaved`).
  public static func isSaved(_ target: Target, in saved: [SavedPlace]) -> Bool {
    // Keys compared byte for byte, as JavaScript compares strings (`RecentPlaces.removing`).
    let key = Array(target.key.utf8)
    return saved.contains { $0.target.key.utf8.elementsEqual(key) }
  }

  /// Whether `target` can be saved (client `canSave`): a place someone chose or found (not
  /// approximate IP location, and not the phone's own point), not saved already, with room for
  /// one more.
  public static func canSave(_ target: Target, in saved: [SavedPlace]) -> Bool {
    switch target {
    case .ip:
      return false
    case .coords(let place) where place.source == .device:
      return false
    case .city, .coords:
      return saved.count < max && !isSaved(target, in: saved)
    }
  }

  /// `place` saved, at the end of the saved places, and out of the recent places (client
  /// `savePlace`). A place that can't be saved, or has no name to show, leaves both as they were.
  public static func saving(_ place: SavedPlace, in lists: PlaceLists) -> PlaceLists {
    guard !place.name.isEmpty, canSave(place.target, in: lists.saved) else { return lists }
    return PlaceLists(
      saved: lists.saved + [place],
      recent: RecentPlaces.removing(place.target, from: lists.recent)
    )
  }

  /// `target`'s place out of the saved places, and back on top of the recent places as it was
  /// saved (its target, name and line), cut to `RecentPlaces.defaultMax` (client `unsavePlace`).
  /// A place that isn't saved leaves both as they were.
  public static func unsaving(_ target: Target, in lists: PlaceLists) -> PlaceLists {
    let key = Array(target.key.utf8)
    let matches = { (saved: SavedPlace) in saved.target.key.utf8.elementsEqual(key) }
    guard let place = lists.saved.first(where: matches) else { return lists }
    return PlaceLists(
      saved: lists.saved.filter { !matches($0) },
      recent: RecentPlaces.adding(
        place.target, name: place.name, detail: place.detail, to: lists.recent)
    )
  }

  /// The lists once `target` is chosen under `name` (client `choosePlace`): a saved place stays
  /// where it is, so the list doesn't shuffle under the thumb, and doesn't join the recent
  /// places; any other joins the recent places, with its line when it has one.
  public static func choosing(
    _ target: Target,
    name: String,
    detail: String? = nil,
    in lists: PlaceLists
  ) -> PlaceLists {
    guard !isSaved(target, in: lists.saved) else { return lists }
    return PlaceLists(
      saved: lists.saved,
      recent: RecentPlaces.adding(target, name: name, detail: detail, to: lists.recent)
    )
  }

  /// The recent places the picker shows under "Recent": those that aren't saved (client
  /// `shownRecent`). Each action keeps the lists apart, but the app writes them one after the
  /// other, so a write cut short between the two could leave a place in both; it is then shown
  /// once, under "Saved".
  public static func shownRecent(_ lists: PlaceLists) -> [RecentPlace] {
    lists.recent.filter { !isSaved($0.target, in: lists.saved) }
  }
}

extension SavedPlaces {
  /// `savedPlaces.v1` as the app keeps it in its own defaults: the list as the client's JSON,
  /// leaving out a line it hasn't, as `Target` leaves out what it hasn't.
  public static func stored(_ list: [SavedPlace]) throws -> Data {
    try JSONEncoder().encode(list)
  }

  /// The list `savedPlaces.v1` keeps, read as leniently as `recent.v1` is: empty for nothing, or
  /// for anything that isn't a list. An entry that doesn't read as a saved place is skipped, as
  /// is one that can't be saved (approximate IP location, the phone's own point), one with an
  /// empty name and a second entry for a place, and the list is cut to `max`, so what is read
  /// back is always a list `saving` could have made.
  public static func list(stored data: Data?) -> [SavedPlace] {
    guard let data, let entries = try? JSONDecoder().decode([Entry].self, from: data) else {
      return []
    }
    var list: [SavedPlace] = []
    for case let place? in entries.map(\.place) {
      guard !place.name.isEmpty, canSave(place.target, in: list) else { continue }
      list.append(place)
    }
    return list
  }

  /// One entry of a stored list, nil when it isn't a saved place.
  private struct Entry: Decodable {
    let place: SavedPlace?

    init(from decoder: any Decoder) throws {
      place = try? SavedPlace(from: decoder)
    }
  }
}
