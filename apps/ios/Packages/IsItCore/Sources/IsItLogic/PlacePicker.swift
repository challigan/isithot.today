import Foundation
import IsItModel

/// The place picker as plain values (iOS build spec, section 10.3), from where its search and its
/// location fix are and its two lists: the title, the search box's prompt and its clear button's
/// label, "Use my location" first, then the search's line and its results, or with nothing
/// typed, the saved places under "Saved" and the recent places under "Recent". Every place but
/// the phone's own point has a star that saves or removes it (`Star`), with the words VoiceOver
/// reads and is told. IsItUI draws it; the app's model says what each row does.
public struct PlacePicker: Sendable, Equatable {
  /// "Search for a place".
  public let title: String
  /// "Close".
  public let close: String
  /// The search box's prompt, "Town or city".
  public let prompt: String
  /// "Clear search", the label of the search box's clear button, the app's own (IsItUI).
  public let clear: String
  /// "Use my location", always the first row.
  public let location: LocationRow
  /// A line in place of results: "Type at least 2 letters.", "No places found." or why the
  /// search failed; nil otherwise.
  public let status: String?
  /// The search's results, best first; while a newer search is on its way, the last one's.
  public let results: [ResultRow]
  /// "Saved", over the saved places, with nothing typed: shown then even with none saved, so a
  /// first launch's picker says what the stars are for.
  public let savedHeading: String?
  /// The saved places, in the order saved, with nothing typed.
  public let saved: [SavedRow]
  /// "Tap the star beside a place to save it here.", with nothing typed and none saved.
  public let savedHint: String?
  /// "You can save up to 10 places. Remove one to save another.", with nothing typed and the
  /// list full: the empty stars are gone then, and this says why.
  public let savedFull: String?
  /// "Recent", over the recent places, shown only with nothing typed and some to show.
  public let recentHeading: String?
  /// The recent places that aren't saved (`SavedPlaces.shownRecent`), newest first, with nothing
  /// typed.
  public let recents: [RecentRow]
  /// "Delete": a recent place's press-and-hold item and VoiceOver action, which forgets it.
  public let deleteRecent: String

  /// The "Use my location" row.
  public struct LocationRow: Sendable, Equatable {
    /// "Use my location".
    public let title: String
    /// A line beneath it: "Finding you…" while the fix is out; "Location access is off. Search
    /// for a place instead." when permission is off; or that no fix came.
    public let detail: String?
    /// Whether the fix is out: the row waits, and a second tap does nothing.
    public let busy: Bool
    /// "Open Settings", which opens the app's page in Settings, while permission is off.
    public let openSettings: String?

    public init(title: String, detail: String?, busy: Bool, openSettings: String?) {
      self.title = title
      self.detail = detail
      self.busy = busy
      self.openSettings = openSettings
    }
  }

  /// A place's star: filled for a saved place, which a tap removes, and empty for one a tap saves.
  public struct Star: Sendable, Equatable {
    /// Whether the place is saved.
    public let saved: Bool
    /// What it does, as VoiceOver reads it and a row's press-and-hold menu shows it: "Save
    /// Leeds", or "Remove Leeds from saved places".
    public let label: String
    /// What VoiceOver is told once it is tapped: "Leeds saved.", or "Leeds removed from saved
    /// places.".
    public let announcement: String

    public init(saved: Bool, label: String, announcement: String) {
      self.saved = saved
      self.label = label
      self.announcement = announcement
    }

    /// The star of the place named `name`, saved or not.
    init(name: String, saved: Bool) {
      if saved {
        self.init(
          saved: true,
          label: AppCopy.unsavePlace(place: name),
          announcement: AppCopy.placeUnsaved(place: name)
        )
      } else {
        self.init(
          saved: false,
          label: AppCopy.savePlace(place: name),
          announcement: AppCopy.placeSaved(place: name)
        )
      }
    }
  }

  /// A search result: "Leeds", with "England, United Kingdom" beneath.
  public struct ResultRow: Sendable, Equatable, Identifiable {
    /// Its place in the results.
    public let id: Int
    public let name: String
    /// The region and country (`PlaceSearch.detail`), nil when there are neither.
    public let detail: String?
    /// What choosing it chooses.
    public let result: SearchResult
    /// "Saved" when it is a saved place, as VoiceOver reads the row after its name; else nil.
    public let value: String?
    /// Its star, nil when the saved places are full and it isn't one of them.
    public let star: Star?
  }

  /// A saved place, by its name, with its line beneath when it has one.
  public struct SavedRow: Sendable, Equatable, Identifiable {
    /// The place's key (`Target.key`), one per place.
    public let id: String
    public let name: String
    public let detail: String?
    public let place: SavedPlace
    /// Its filled star, which removes it.
    public let star: Star
  }

  /// A recent place, by its name, with its line beneath when it has one.
  public struct RecentRow: Sendable, Equatable, Identifiable {
    /// The place's key (`Target.key`), one per place.
    public let id: String
    public let name: String
    public let detail: String?
    public let place: RecentPlace
    /// Its empty star, nil for the phone's own point (which is never saved) and while the saved
    /// places are full.
    public let star: Star?
  }

  /// The picker with its search at `search`, its location fix at `location`, and its saved and
  /// recent places, `lists`.
  public init(search: PlaceSearchState, location: LocationState, lists: PlaceLists) {
    title = CoreCopy.searchLabel
    close = CoreCopy.close
    prompt = CoreCopy.searchPlaceholder
    clear = AppCopy.clearSearch
    deleteRecent = AppCopy.deleteRecent
    self.location = LocationRow(location)
    let shown: [SearchResult]
    switch search {
    case .empty:
      status = nil
      shown = []
    case .tooShort:
      status = CoreCopy.searchTooShort
      shown = []
    case .searching(let previous):
      status = nil
      shown = previous
    case .found(let found):
      status = found.isEmpty ? CoreCopy.searchNoResults : nil
      shown = found
    case .failed(let message):
      status = message
      shown = []
    }
    let saved = lists.saved
    results = shown.enumerated().map { index, result in
      let isSaved = SavedPlaces.isSaved(Target(search: result), in: saved)
      return ResultRow(
        id: index,
        name: result.name,
        detail: PlaceSearch.line(result),
        result: result,
        value: isSaved ? AppCopy.saved : nil,
        star: Self.star(for: Target(search: result), name: result.name, saved: saved)
      )
    }
    guard case .empty = search else {
      savedHeading = nil
      self.saved = []
      savedHint = nil
      savedFull = nil
      recentHeading = nil
      recents = []
      return
    }
    savedHeading = AppCopy.saved
    self.saved = saved.map { place in
      SavedRow(
        id: place.target.key,
        name: place.name,
        detail: Self.line(place.detail),
        place: place,
        star: Star(name: place.name, saved: true)
      )
    }
    savedHint = saved.isEmpty ? AppCopy.savedHint : nil
    savedFull =
      saved.count >= SavedPlaces.max ? AppCopy.savedFull(max: String(SavedPlaces.max)) : nil
    let shownRecent = SavedPlaces.shownRecent(lists)
    recentHeading = shownRecent.isEmpty ? nil : AppCopy.recent
    recents = shownRecent.map { place in
      RecentRow(
        id: place.target.key,
        name: place.name,
        detail: Self.line(place.detail),
        place: place,
        star: Self.star(for: place.target, name: place.name, saved: saved)
      )
    }
  }

  /// The star of `target`'s place, named `name`: filled when it is saved, empty when it can be,
  /// and none otherwise (the phone's own point, or a full list).
  private static func star(for target: Target, name: String, saved: [SavedPlace]) -> Star? {
    if SavedPlaces.isSaved(target, in: saved) { return Star(name: name, saved: true) }
    return SavedPlaces.canSave(target, in: saved) ? Star(name: name, saved: false) : nil
  }

  /// A row's line, or nil for none or an empty one.
  private static func line(_ detail: String?) -> String? {
    guard let detail, !detail.isEmpty else { return nil }
    return detail
  }
}

extension PlacePicker.LocationRow {
  /// The row for the location fix at `state`.
  init(_ state: LocationState) {
    let detail: String?
    switch state {
    case .idle:
      detail = nil
    case .locating:
      detail = CoreCopy.locating
    case .denied:
      detail = CoreCopy.locationDenied
    case .unavailable:
      detail = AppCopy.locationUnavailable
    }
    self.init(
      title: CoreCopy.useMyLocation,
      detail: detail,
      busy: state == .locating,
      openSettings: state == .denied ? AppCopy.openSettings : nil
    )
  }
}

/// Where the picker's search is (`PlacePickerModel`, IsItState, runs it).
public enum PlaceSearchState: Sendable, Equatable {
  /// Nothing typed, or only spaces.
  case empty
  /// Too few letters to search for.
  case tooShort
  /// A search is waiting for the pause after typing, or for its answer; `previous` is what the
  /// last search found, shown meanwhile.
  case searching(previous: [SearchResult])
  /// What the search found, best first; empty for no places.
  case found([SearchResult])
  /// The search failed: the line that says why.
  case failed(String)

  /// The results on screen in this state, which a newer search shows until its own arrive.
  public var shown: [SearchResult] {
    switch self {
    case .searching(let previous): previous
    case .found(let found): found
    case .empty, .tooShort, .failed: []
    }
  }
}

/// Where the picker's "Use my location" is.
public enum LocationState: Sendable, Equatable {
  /// Not asked, or the last fix was chosen.
  case idle
  /// Asking for permission, or for the fix.
  case locating
  /// Permission is off: denied, or restricted.
  case denied
  /// Permission is on, but no fix came.
  case unavailable
}
