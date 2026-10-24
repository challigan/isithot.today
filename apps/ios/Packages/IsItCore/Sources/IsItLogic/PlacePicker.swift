import Foundation
import IsItModel

/// The place picker as plain values (iOS build spec, section 10.3), from where its search and its
/// location fix are and the recent places: the title, the search box's prompt, "Use my
/// location" first, then the search's line and its results, or with nothing typed, the recent
/// places under "Recent". IsItUI draws it; the app's model says what each row does.
public struct PlacePicker: Sendable, Equatable {
  /// "Search for a place".
  public let title: String
  /// "Close".
  public let close: String
  /// The search box's prompt, "Town or city".
  public let prompt: String
  /// "Use my location", always the first row.
  public let location: LocationRow
  /// A line in place of results: "Type at least 2 letters.", "No places found." or why the
  /// search failed; nil otherwise.
  public let status: String?
  /// The search's results, best first; while a newer search is on its way, the last one's.
  public let results: [ResultRow]
  /// "Recent", over the recent places, shown only with nothing typed and some to show.
  public let recentHeading: String?
  /// The recent places, newest first, with nothing typed; each can be swiped away.
  public let recents: [RecentRow]

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

  /// A search result: "Leeds", with "England, United Kingdom" beneath.
  public struct ResultRow: Sendable, Equatable, Identifiable {
    /// Its place in the results.
    public let id: Int
    public let name: String
    /// The region and country (`PlaceSearch.detail`), nil when there are neither.
    public let detail: String?
    /// What choosing it chooses.
    public let result: SearchResult
  }

  /// A recent place, by its name.
  public struct RecentRow: Sendable, Equatable, Identifiable {
    /// The place's key (`Target.key`), one per place.
    public let id: String
    public let name: String
    public let place: RecentPlace
  }

  /// The picker with its search at `search`, its location fix at `location`, and `recents`.
  public init(search: PlaceSearchState, location: LocationState, recents: [RecentPlace]) {
    title = CoreCopy.searchLabel
    close = CoreCopy.close
    prompt = CoreCopy.searchPlaceholder
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
    results = shown.enumerated().map { index, result in
      let detail = PlaceSearch.detail(result)
      return ResultRow(
        id: index,
        name: result.name,
        detail: detail.isEmpty ? nil : detail,
        result: result
      )
    }
    if case .empty = search, !recents.isEmpty {
      recentHeading = AppCopy.recent
      self.recents = recents.map { RecentRow(id: $0.target.key, name: $0.name, place: $0) }
    } else {
      recentHeading = nil
      self.recents = []
    }
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
