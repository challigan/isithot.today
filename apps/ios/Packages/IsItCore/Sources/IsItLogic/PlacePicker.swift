import Foundation
import IsItModel

/// The place picker as plain values (iOS build spec, section 10.3), from where its search and its
/// location fix are and its two lists: the title, the search box's prompt and its clear button's
/// label, "Use my location" first, then the search's line and its results, or with nothing
/// typed, the saved places under "Saved" and the recent places under "Recent". Every place but
/// the phone's own point has a star that saves or removes it (`Star`), with the words VoiceOver
/// reads and is told. Every saved place, a saved row or a saved result, has a bell beside its
/// star that turns its notifications on and off, with the one-off purchase (`Bell`, phase 8.4b,
/// design 2.2), and the line under the saved places says what a star and a bell do (design 2.3).
/// IsItUI draws it; the app's model says what each row does.
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
  /// "You can save up to 10 places. Remove one to save another.", with nothing typed and the
  /// list full: the empty stars are gone then, and this says why (`saved-full`). It comes before
  /// `savedLine`.
  public let savedFull: String?
  /// The line under the saved places with nothing typed (`saved-line`), what a star and a bell
  /// do, by the client's rule (`savedLines`): with none saved, how to save a place and what a
  /// saved place can have, free or paid; with places saved, how a bell works, with the purchase
  /// when it isn't owned; none once owned with a bell on. Nil while typing.
  public let savedLine: String?
  /// "Notifications are off for this app in Settings." with "Open Settings" (`bell-open-settings`),
  /// once a bell's tap met notifications denied in iOS Settings (`bellDenied`), under the saved
  /// places, or the results while typing, as a saved result's bell can meet it too; nil
  /// otherwise.
  public let bellDenied: BellDenied?
  /// "Recent", over the recent places, shown only with nothing typed and some to show.
  public let recentHeading: String?
  /// The recent places that aren't saved (`SavedPlaces.shownRecent`), newest first, with nothing
  /// typed.
  public let recents: [RecentRow]
  /// "Delete": a recent place's press-and-hold item and VoiceOver action, which forgets it
  /// (`RecentRow.deleted` is what VoiceOver is told then).
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

    /// The star of the place named `name`, saved or not; `rung` when it is saved and its bell
    /// shows on, so unsaving it turns its notifications off too, and VoiceOver is told so.
    init(name: String, saved: Bool, rung: Bool = false) {
      if saved {
        self.init(
          saved: true,
          label: AppCopy.unsavePlace(place: name),
          announcement: rung
            ? AppCopy.placeUnsavedBellOff(place: name) : AppCopy.placeUnsaved(place: name)
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
    /// Its bell, beside its star, while it is a saved place (phase 8.4b); nil otherwise. Its
    /// label is the row's one press-and-hold item and VoiceOver action.
    public let bell: Bell?
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
    /// Its bell, beside its star (phase 8.4b). Its label is the row's second press-and-hold item
    /// and VoiceOver action, after the star's Remove.
    public let bell: Bell
  }

  /// A saved place's bell (design 2.2), beside its star, 8 points from it: `bell`, `bell.fill`
  /// while on, and `bell` with a small `lock.fill` badge while locked. What a tap does is the
  /// model's (`toggleBell`); what VoiceOver is told comes with its outcome, not from here.
  public struct Bell: Sendable, Equatable {
    /// The saved place it is for: a tap turns its notifications on or off, or, locked, opens the
    /// purchase.
    public let place: SavedPlace
    /// Locked without the purchase; on while its bell is on and something can be sent; otherwise
    /// off (`AlertSync.bellState`).
    public let state: AlertSync.BellState
    /// What a tap does, as VoiceOver reads it and a row's press-and-hold menu shows it: "Turn on
    /// notifications for Kathmandu", "Turn off notifications for Kathmandu", or "Turn on
    /// notifications for Kathmandu, with the one-off purchase".
    public let label: String

    public init(place: SavedPlace, state: AlertSync.BellState, label: String) {
      self.place = place
      self.state = state
      self.label = label
    }

    /// The bell of `place`, named `name` as its row shows it, in `state`.
    init(place: SavedPlace, name: String, state: AlertSync.BellState) {
      let label =
        switch state {
        case .locked: AppCopy.bellLocked(place: name)
        case .off: AppCopy.bellOn(place: name)
        case .on: AppCopy.bellOff(place: name)
        }
      self.init(place: place, state: state, label: label)
    }

    /// The small lock drawn on the bell while it is locked, so the gate shows before the tap;
    /// hidden from VoiceOver, whose label says it.
    public var badge: Bool { state == .locked }
  }

  /// The line a bell's tap shows while notifications are off for the app in iOS Settings, and
  /// its button.
  public struct BellDenied: Sendable, Equatable {
    /// "Notifications are off for this app in Settings."
    public let text: String
    /// "Open Settings", which opens the app's page in Settings.
    public let openSettings: String

    public init(text: String, openSettings: String) {
      self.text = text
      self.openSettings = openSettings
    }
  }

  /// A line under the search screen's saved places (client `SavedLine`), by its copy key:
  /// `savedFull` says the list is full; the rest say what a bell does, with the purchase where it
  /// is needed.
  public enum SavedLine: String, Codable, Sendable, CaseIterable {
    case savedFull, savedLineNoneFree, savedLineNonePaid, bellHint, bellHintLocked

    /// Its words: `savedFull` with `SavedPlaces.max`.
    public var text: String {
      switch self {
      case .savedFull: AppCopy.savedFull(max: String(SavedPlaces.max))
      case .savedLineNoneFree: AppCopy.savedLineNoneFree
      case .savedLineNonePaid: AppCopy.savedLineNonePaid
      case .bellHint: AppCopy.bellHint
      case .bellHintLocked: AppCopy.bellHintLocked
      }
    }
  }

  /// The search screen's lines under its saved places, with nothing typed, one per state (client
  /// `savedLines`, design 2.3): with nothing saved, how to save a place and what a saved place
  /// can have (`savedLineNoneFree` without the purchase, `savedLineNonePaid` with it); with
  /// places saved, `savedFull` first once there are `SavedPlaces.max`, then how a bell works,
  /// with the purchase (`bellHintLocked`, whatever the bells) or, with it, until a bell shows on
  /// (`bellHint`; `anyBellOn` is a saved place's `AlertSync.bellState` being `on`).
  public static func savedLines(savedCount: Int, unlocked: Bool, anyBellOn: Bool) -> [SavedLine] {
    if savedCount < 1 { return [unlocked ? .savedLineNonePaid : .savedLineNoneFree] }
    var lines: [SavedLine] = savedCount >= SavedPlaces.max ? [.savedFull] : []
    if !unlocked {
      lines.append(.bellHintLocked)
    } else if !anyBellOn {
      lines.append(.bellHint)
    }
    return lines
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
    /// What VoiceOver is told once Delete forgets it: "Leeds deleted from recent places.".
    public let deleted: String
  }

  /// The picker with its search at `search`, its location fix at `location`, and its saved and
  /// recent places, `lists`; the bells with the one-off purchase owned (`unlocked`), those of
  /// `bells` (`alerts.v2`'s, by `Target.key`) on, and something can be sent (`active`,
  /// `AlertSync.active`: a switch on and notifications not denied); `bellDenied` once a bell's
  /// tap met notifications denied in iOS Settings. Without them: free, every bell locked.
  public init(
    search: PlaceSearchState, location: LocationState, lists: PlaceLists, unlocked: Bool = false,
    bells: [String] = [], active: Bool = false, bellDenied: Bool = false
  ) {
    self.bellDenied =
      bellDenied ? BellDenied(text: AppCopy.notifyDenied, openSettings: AppCopy.openSettings) : nil
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
    let rung = Set(bells.map { Array($0.utf8) })
    // Each saved place's bell as it shows, by its key.
    let state = { (place: SavedPlace) in
      AlertSync.bellState(
        on: rung.contains(Array(place.target.key.utf8)), unlocked: unlocked, active: active)
    }
    results = shown.enumerated().map { index, result in
      let target = Target(search: result)
      let key = Array(target.key.utf8)
      let place = saved.first { $0.target.key.utf8.elementsEqual(key) }
      let bell = place.map { Bell(place: $0, name: result.name, state: state($0)) }
      return ResultRow(
        id: index,
        name: result.name,
        detail: PlaceSearch.line(result),
        result: result,
        value: place == nil ? nil : AppCopy.saved,
        star: Self.star(for: target, name: result.name, saved: saved, rung: bell?.state == .on),
        bell: bell
      )
    }
    guard case .empty = search else {
      savedHeading = nil
      self.saved = []
      savedLine = nil
      savedFull = nil
      recentHeading = nil
      recents = []
      return
    }
    savedHeading = AppCopy.saved
    self.saved = saved.map { place in
      let bell = Bell(place: place, name: place.name, state: state(place))
      return SavedRow(
        id: place.target.key,
        name: place.name,
        detail: Self.line(place.detail),
        place: place,
        star: Star(name: place.name, saved: true, rung: bell.state == .on),
        bell: bell
      )
    }
    let lines = Self.savedLines(
      savedCount: saved.count, unlocked: unlocked,
      anyBellOn: self.saved.contains { $0.bell.state == .on })
    savedFull = lines.contains(.savedFull) ? PlacePicker.SavedLine.savedFull.text : nil
    savedLine = lines.last { $0 != .savedFull }?.text
    let shownRecent = SavedPlaces.shownRecent(lists)
    recentHeading = shownRecent.isEmpty ? nil : AppCopy.recent
    recents = shownRecent.map { place in
      RecentRow(
        id: place.target.key,
        name: place.name,
        detail: Self.line(place.detail),
        place: place,
        star: Self.star(for: place.target, name: place.name, saved: saved),
        deleted: AppCopy.placeDeleted(place: place.name)
      )
    }
  }

  /// The star of `target`'s place, named `name`: filled when it is saved, empty when it can be,
  /// and none otherwise (the phone's own point, or a full list). `rung` when its bell shows on.
  private static func star(
    for target: Target, name: String, saved: [SavedPlace], rung: Bool = false
  ) -> Star? {
    if SavedPlaces.isSaved(target, in: saved) { return Star(name: name, saved: true, rung: rung) }
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
