import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

/// A search fixture's results, as the server sent them.
func searchResults(_ name: String) throws -> [SearchResult] {
  try SearchResponse.decode(from: Fixtures.search(name)).results
}

let recentLeeds = RecentPlace(target: .city(slug: "leeds-gb", name: "Leeds"), name: "Leeds")
let recentHere = RecentPlace(target: .device(lat: 53.8, lon: -1.55), name: "Leeds")
let savedLeeds = SavedPlace(
  target: .city(slug: "leeds-gb", name: "Leeds"), name: "Leeds", detail: "England, United Kingdom")

/// The picker's lists: `recent`, with `saved` saved.
func places(_ recent: [RecentPlace], saved: [SavedPlace] = []) -> PlaceLists {
  PlaceLists(saved: saved, recent: recent)
}

/// The place picker as plain values (iOS build spec, section 10.3), from the search's state, the
/// location row's and the recent places.
@Suite("The place picker's content")
struct PlacePickerTests {
  @Test("its words: the title, Close, the prompt, the clear button and Use my location")
  func words() {
    let picker = PlacePicker(search: .empty, location: .idle, lists: places([]))
    #expect(picker.title == "Search for a place")
    #expect(picker.close == "Close")
    #expect(picker.prompt == "Town or city")
    #expect(picker.clear == "Clear search")
    #expect(
      picker.location
        == PlacePicker.LocationRow(
          title: "Use my location", detail: nil, busy: false, openSettings: nil))
    #expect(picker.status == nil)
    #expect(picker.results.isEmpty)
    #expect(picker.recentHeading == nil)
    #expect(picker.recents.isEmpty)
    #expect(picker.deleteRecent == "Delete")
  }

  @Test("with nothing typed, the recent places under Recent, newest first")
  func recents() {
    let picker = PlacePicker(
      search: .empty, location: .idle, lists: places([recentHere, recentLeeds]))
    #expect(picker.recentHeading == "Recent")
    #expect(picker.recents.map(\.name) == ["Leeds", "Leeds"])
    #expect(picker.recents.map(\.id) == ["device:53.8,-1.55", "city:leeds-gb"])
    #expect(picker.recents.map(\.place) == [recentHere, recentLeeds])
    // What VoiceOver is told once Delete forgets one, the phone's own point too, which has no
    // star.
    #expect(
      picker.recents.map(\.deleted)
        == Array(repeating: "Leeds deleted from recent places.", count: 2))
    // Typing hides them: the box's own line or results take their place.
    for search in [
      PlaceSearchState.tooShort, .searching(previous: []), .found([]), .failed("No."),
    ] {
      let typing = PlacePicker(search: search, location: .idle, lists: places([recentLeeds]))
      #expect(typing.recentHeading == nil, "\(search)")
      #expect(typing.recents.isEmpty, "\(search)")
    }
  }

  @Test("too short, no places and a failure each have their line, and no results")
  func lines() {
    let short = PlacePicker(search: .tooShort, location: .idle, lists: places([]))
    #expect(short.status == "Type at least 2 letters.")
    #expect(short.results.isEmpty)
    let none = PlacePicker(search: .found([]), location: .idle, lists: places([]))
    #expect(none.status == "No places found.")
    let failed = PlacePicker(
      search: .failed(AppCopy.searchOffline), location: .idle, lists: places([]))
    #expect(failed.status == "You're offline. Connect to the internet to search.")
    #expect(failed.results.isEmpty)
  }

  @Test("a result reads its name with its region and country beneath")
  func results() throws {
    let found = try searchResults("search-leeds") + (try searchResults("search-kathmandu"))
    let picker = PlacePicker(search: .found(found), location: .idle, lists: places([recentLeeds]))
    #expect(picker.status == nil)
    #expect(picker.results.map(\.name) == ["Leeds", "Kathmandu"])
    #expect(picker.results.map(\.detail) == ["England, United Kingdom", "Bagmati Province, Nepal"])
    #expect(picker.results.map(\.id) == [0, 1])
    #expect(picker.results.map(\.result) == found)
    // A result with neither region nor country has no line beneath.
    let json = #"{"name":"Bath","region":null,"country":null,"countryName":null,"lat":1,"lon":2}"#
    let bare = try JSONDecoder().decode(SearchResult.self, from: Data(json.utf8))
    let row = PlacePicker(search: .found([bare]), location: .idle, lists: places([])).results[0]
    #expect(row.name == "Bath")
    #expect(row.detail == nil)
  }

  @Test("while a new search is out, the last one's results stay")
  func searching() throws {
    let leeds = try searchResults("search-leeds")
    let picker = PlacePicker(
      search: .searching(previous: leeds), location: .idle, lists: places([]))
    #expect(picker.status == nil)
    #expect(picker.results.map(\.name) == ["Leeds"])
    #expect(PlaceSearchState.searching(previous: leeds).shown == leeds)
    #expect(PlaceSearchState.found(leeds).shown == leeds)
    for state in [PlaceSearchState.empty, .tooShort, .failed("x")] {
      #expect(state.shown.isEmpty)
    }
  }

  @Test("Use my location: finding you, permission off with Open Settings, or no fix")
  func location() {
    let row = { (state: LocationState) in
      PlacePicker(search: .empty, location: state, lists: places([])).location
    }
    #expect(
      row(.locating)
        == PlacePicker.LocationRow(
          title: "Use my location", detail: "Finding you…", busy: true, openSettings: nil))
    #expect(
      row(.denied)
        == PlacePicker.LocationRow(
          title: "Use my location",
          detail: "Location access is off. Search for a place instead.",
          busy: false,
          openSettings: "Open Settings"
        ))
    #expect(
      row(.unavailable)
        == PlacePicker.LocationRow(
          title: "Use my location",
          detail: "Couldn't find your location. Search for a place instead.",
          busy: false,
          openSettings: nil
        ))
  }
}

/// The picker's saved places, as plain values: the Saved section over Recent with nothing typed,
/// the stars on every row but the phone's own point, a saved result's value, and the words
/// VoiceOver reads and is told.
@Suite("The place picker's saved places")
struct PlacePickerSavedTests {
  let york = RecentPlace(
    target: .city(slug: "york-gb", name: "York"), name: "York", detail: "England, United Kingdom")
  /// Ten saved places: a full list.
  let full = (1...SavedPlaces.max).map {
    SavedPlace(target: .city(slug: "place-\($0)"), name: "Place \($0)")
  }

  @Test("with nothing typed, Saved over Recent, and Recent without the saved places")
  func savedOverRecent() {
    // Leeds is in both, as a write cut short could leave it: shown once, under Saved.
    let picker = PlacePicker(
      search: .empty, location: .idle,
      lists: places([york, recentLeeds, recentHere], saved: [savedLeeds]))
    #expect(picker.savedHeading == "Saved")
    #expect(picker.saved.map(\.id) == ["city:leeds-gb"])
    #expect(picker.saved.map(\.name) == ["Leeds"])
    #expect(picker.saved.map(\.detail) == ["England, United Kingdom"])
    #expect(picker.saved.map(\.place) == [savedLeeds])
    #expect(
      picker.savedLine
        == "Tap a place's bell to get notifications for it, with the one-off purchase.")
    #expect(picker.savedFull == nil)
    #expect(picker.recentHeading == "Recent")
    #expect(picker.recents.map(\.id) == ["city:york-gb", "device:53.8,-1.55"])
    #expect(picker.recents.map(\.detail) == ["England, United Kingdom", nil])
  }

  @Test("each star says what a tap does, and what VoiceOver is told after it")
  func stars() {
    let picker = PlacePicker(
      search: .empty, location: .idle, lists: places([york, recentHere], saved: [savedLeeds]))
    #expect(
      picker.saved[0].star
        == PlacePicker.Star(
          saved: true,
          label: "Remove Leeds from saved places",
          announcement: "Leeds removed from saved places."
        ))
    #expect(
      picker.recents[0].star
        == PlacePicker.Star(saved: false, label: "Save York", announcement: "York saved."))
    // The phone's own point is never saved: no star.
    #expect(picker.recents[1].star == nil)
  }

  @Test("with none saved, the heading and the line, even with no recent places, free or paid")
  func noneSaved() {
    let first = PlacePicker(search: .empty, location: .idle, lists: places([]))
    #expect(first.savedHeading == "Saved")
    #expect(first.saved.isEmpty)
    #expect(
      first.savedLine
        == "Tap the star beside a place to save it. Saved places can have notifications with "
        + "the one-off purchase.")
    #expect(first.savedFull == nil)
    #expect(first.recentHeading == nil)
    let some = PlacePicker(search: .empty, location: .idle, lists: places([york]))
    #expect(some.savedLine == first.savedLine)
    #expect(some.recentHeading == "Recent")
    for active in [false, true] {
      let paid = PlacePicker(
        search: .empty, location: .idle, lists: places([york]), unlocked: true, active: active)
      #expect(
        paid.savedLine
          == "Tap the star beside a place to save it, then tap its bell to get notifications.")
    }
  }

  @Test("full: the line says why, no empty stars, and the filled ones still remove")
  func fullList() throws {
    let leeds = try searchResults("search-leeds")
    let picker = PlacePicker(
      search: .empty, location: .idle, lists: places([york, recentHere], saved: full))
    #expect(picker.saved.count == 10)
    #expect(
      picker.savedLine
        == "Tap a place's bell to get notifications for it, with the one-off purchase.")
    #expect(picker.savedFull == "You can save up to 10 places. Remove one to save another.")
    #expect(picker.saved.allSatisfy { $0.star.saved })
    #expect(picker.recents.map(\.star) == [nil, nil])
    // A result that isn't saved has no star either; one that is keeps its filled star.
    let searching = PlacePicker(
      search: .found(leeds), location: .idle, lists: places([], saved: full))
    #expect(searching.results[0].star == nil)
    #expect(searching.results[0].value == nil)
    let saved = Array(full.dropLast()) + [savedLeeds]
    let found = PlacePicker(search: .found(leeds), location: .idle, lists: places([], saved: saved))
    #expect(found.results[0].star?.saved == true)
    #expect(found.results[0].value == "Saved")
    // One fewer, and the stars come back.
    let nine = PlacePicker(
      search: .empty, location: .idle, lists: places([york], saved: Array(full.dropLast())))
    #expect(nine.savedFull == nil)
    #expect(nine.recents[0].star?.label == "Save York")
  }

  @Test("a result's star and value: empty and none, or filled and Saved")
  func results() throws {
    let found = try searchResults("search-leeds") + (try searchResults("search-kathmandu"))
    let picker = PlacePicker(
      search: .found(found), location: .idle, lists: places([], saved: [savedLeeds]))
    #expect(picker.results.map(\.value) == ["Saved", nil])
    #expect(
      picker.results.map(\.star?.label) == ["Remove Leeds from saved places", "Save Kathmandu"])
    #expect(
      picker.results.map(\.star?.announcement) == [
        "Leeds removed from saved places.", "Kathmandu saved.",
      ])
    // The same place by its key, whatever name it was saved under.
    let renamed = SavedPlace(target: .city(slug: "leeds-gb"), name: "Leeds, West Yorkshire")
    let again = PlacePicker(
      search: .found(found), location: .idle, lists: places([], saved: [renamed]))
    #expect(again.results[0].value == "Saved")
  }

  @Test("typing hides Saved and Recent; the results carry their stars")
  func typing() throws {
    let leeds = try searchResults("search-leeds")
    for search in [
      PlaceSearchState.tooShort, .searching(previous: leeds), .found(leeds), .failed("No."),
    ] {
      let picker = PlacePicker(
        search: search, location: .idle, lists: places([york], saved: [savedLeeds]))
      #expect(picker.savedHeading == nil, "\(search)")
      #expect(picker.saved.isEmpty, "\(search)")
      #expect(picker.savedLine == nil, "\(search)")
      #expect(picker.savedFull == nil, "\(search)")
      #expect(picker.recentHeading == nil, "\(search)")
      #expect(picker.recents.isEmpty, "\(search)")
    }
    let whenFull = PlacePicker(
      search: .found(leeds), location: .idle, lists: places([], saved: full))
    #expect(whenFull.savedFull == nil)
  }

  @Test("a row's line: none for an empty one")
  func lines() {
    let bare = SavedPlace(target: .city(slug: "bath-gb"), name: "Bath", detail: "")
    let recent = RecentPlace(target: .city(slug: "ripon-gb"), name: "Ripon", detail: "")
    let picker = PlacePicker(
      search: .empty, location: .idle, lists: places([recent], saved: [bare]))
    #expect(picker.saved[0].detail == nil)
    #expect(picker.recents[0].detail == nil)
  }

  @Test("every new word is sentence case and about snow alone")
  func words() throws {
    let found = try searchResults("search-leeds")
    let empty = PlacePicker(search: .empty, location: .idle, lists: places([york]))
    let whenFull = PlacePicker(search: .empty, location: .idle, lists: places([], saved: full))
    let searching = PlacePicker(
      search: .found(found), location: .idle, lists: places([], saved: [savedLeeds]))
    let paid = PlacePicker(
      search: .empty, location: .idle, lists: places([york]), unlocked: true, active: true)
    let paidSaved = PlacePicker(
      search: .empty, location: .idle, lists: places([], saved: [savedLeeds]), unlocked: true,
      active: true)
    let rung = PlacePicker(
      search: .empty, location: .idle, lists: places([], saved: [savedLeeds]), unlocked: true,
      bells: [savedLeeds.target.key], active: true, bellDenied: true)
    // The heading, the five lines (none saved free and paid, a bell's with and without the
    // purchase, full), Delete and what VoiceOver is told of it, the empty star's two, the filled
    // star's two, the saved result's star's two and its value, the filled star's words once its
    // bell is on, the bell's three labels, and the denied line with its Open Settings.
    let texts =
      [
        empty.savedHeading, empty.savedLine, paid.savedLine, whenFull.savedLine,
        paidSaved.savedLine, whenFull.savedFull, empty.deleteRecent,
      ]
      .compactMap { $0 } + [empty.recents[0].deleted]
      + [empty.recents[0].star, whenFull.saved[0].star, searching.results[0].star]
      .compactMap { $0 }.flatMap { [$0.label, $0.announcement] }
      + searching.results.compactMap(\.value) + [rung.saved[0].star.announcement]
      + [whenFull.saved[0].bell, paidSaved.saved[0].bell, rung.saved[0].bell].map(\.label)
      + [rung.bellDenied?.text, rung.bellDenied?.openSettings].compactMap { $0 }
    #expect(texts.count == 21)
    // Only "Saved" is there twice: the heading, and a saved result's value.
    #expect(Set(texts).count == 20)
    for text in texts {
      #expect(otherTopic(in: text) == nil, "\(text)")
      #expect(text.first?.isUppercase == true, "\(text)")
      #expect(!text.lowercased().contains("alert"), "\(text)")
      #expect(!text.lowercased().contains("location"), "\(text)")
    }
  }
}

/// `savedPlaces.v1` as the app keeps it in its own defaults.
@Suite("The saved places, as kept")
struct SavedPlacesStoredTests {
  @Test("a list is kept as the client's JSON, its lines with it, and reads back the same")
  func roundTrip() throws {
    let kathmandu = try searchResults("search-kathmandu")[0]
    let list = [
      savedLeeds,
      SavedPlace(
        target: Target(search: kathmandu), name: "Kathmandu", detail: "Bagmati Province, Nepal"),
      SavedPlace(target: .city(slug: "york-gb"), name: "York"),
    ]
    let data = try SavedPlaces.stored(list)
    #expect(SavedPlaces.list(stored: data) == list)
    let json = try #require(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
    #expect(json.count == 3)
    #expect(json[0]["name"] as? String == "Leeds")
    #expect(json[0]["detail"] as? String == "England, United Kingdom")
    let target = try #require(json[0]["target"] as? [String: Any])
    #expect(target["kind"] as? String == "city")
    #expect(target["slug"] as? String == "leeds-gb")
    // No line: none written, as `Target` leaves out what it hasn't.
    #expect(json[2].keys.sorted() == ["name", "target"])
  }

  @Test("nothing, or what isn't a list, is no saved places")
  func nothing() {
    #expect(SavedPlaces.list(stored: nil).isEmpty)
    #expect(SavedPlaces.list(stored: Data()).isEmpty)
    #expect(SavedPlaces.list(stored: Data(#"{"target":{"kind":"city","slug":"a"}}"#.utf8)).isEmpty)
    #expect(SavedPlaces.list(stored: Data("not json".utf8)).isEmpty)
  }

  @Test("an entry that isn't a place, IP, the phone's point, no name and a repeat are skipped")
  func lenient() throws {
    let json = #"""
      [
        {"target":{"kind":"city","slug":"leeds-gb"},"name":"Leeds","detail":"England"},
        {"target":{"kind":"ip"},"name":"Somewhere"},
        {"target":{"kind":"moon"},"name":"Tycho"},
        {"name":"No target"},
        7,
        {"target":{"kind":"coords","source":"device","lat":53.8,"lon":-1.55},"name":"Here"},
        {"target":{"kind":"city","slug":"york-gb"},"name":""},
        {"target":{"kind":"city","slug":"leeds-gb","name":"Leeds"},"name":"Leeds again"},
        {"target":{"kind":"coords","source":"search","lat":53.8,"lon":-1.55},"name":"Leeds"}
      ]
      """#
    let list = SavedPlaces.list(stored: Data(json.utf8))
    #expect(list.map(\.name) == ["Leeds", "Leeds"])
    #expect(list.map(\.target.key) == ["city:leeds-gb", "search:53.8,-1.55"])
    #expect(list[0].detail == "England")
  }

  @Test("at most ten, the first saved")
  func cap() throws {
    let places = (1...12).map { SavedPlace(target: .city(slug: "place-\($0)"), name: "\($0)") }
    let list = SavedPlaces.list(stored: try SavedPlaces.stored(places))
    #expect(list.count == SavedPlaces.max)
    #expect(SavedPlaces.max == 10)
    #expect(list.map(\.name) == (1...10).map(String.init))
  }
}

/// `recent.v1` as the app keeps it in its own defaults.
@Suite("The recent places, as kept")
struct RecentStoredTests {
  @Test("a list is kept as the client's JSON, and reads back the same")
  func roundTrip() throws {
    let kathmandu = try searchResults("search-kathmandu")[0]
    let list = [
      RecentPlace(target: Target(search: kathmandu), name: "Kathmandu"), recentHere, recentLeeds,
    ]
    let data = try RecentPlaces.stored(list)
    #expect(RecentPlaces.list(stored: data) == list)
    let json = try #require(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
    #expect(json.count == 3)
    let target = try #require(json[2]["target"] as? [String: Any])
    #expect(target["kind"] as? String == "city")
    #expect(target["slug"] as? String == "leeds-gb")
    #expect(json[2]["name"] as? String == "Leeds")
  }

  @Test("nothing, or what isn't a list, is no recent places")
  func nothing() {
    #expect(RecentPlaces.list(stored: nil).isEmpty)
    #expect(RecentPlaces.list(stored: Data()).isEmpty)
    #expect(RecentPlaces.list(stored: Data(#"{"target":{"kind":"ip"}}"#.utf8)).isEmpty)
    #expect(RecentPlaces.list(stored: Data("not json".utf8)).isEmpty)
  }

  @Test("an entry that isn't a place, IP location and a second entry for a place are skipped")
  func lenient() throws {
    let json = #"""
      [
        {"target":{"kind":"city","slug":"leeds-gb"},"name":"Leeds"},
        {"target":{"kind":"ip"},"name":"Somewhere"},
        {"target":{"kind":"moon"},"name":"Tycho"},
        {"name":"No target"},
        7,
        {"target":{"kind":"city","slug":"leeds-gb","name":"Leeds"},"name":"Leeds again"},
        {"target":{"kind":"coords","source":"device","lat":53.8,"lon":-1.55},"name":"Here"}
      ]
      """#
    let list = RecentPlaces.list(stored: Data(json.utf8))
    #expect(list.map(\.name) == ["Leeds", "Here"])
  }

  @Test("a place's line is kept, and an entry from before lines reads without one")
  func detail() throws {
    let list = [
      RecentPlace(
        target: .city(slug: "leeds-gb", name: "Leeds"), name: "Leeds",
        detail: "England, United Kingdom"),
      recentHere,
    ]
    let data = try RecentPlaces.stored(list)
    #expect(RecentPlaces.list(stored: data) == list)
    let json = try #require(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
    #expect(json[0]["detail"] as? String == "England, United Kingdom")
    #expect(json[1].keys.sorted() == ["name", "target"])
    let old = #"[{"target":{"kind":"city","slug":"leeds-gb"},"name":"Leeds"}]"#
    #expect(RecentPlaces.list(stored: Data(old.utf8)).map(\.detail) == [nil])
  }

  @Test("at most five, the newest")
  func cap() throws {
    let places = (1...7).map {
      RecentPlace(target: .city(slug: "place-\($0)"), name: "Place \($0)")
    }
    let list = RecentPlaces.list(stored: try RecentPlaces.stored(places))
    #expect(list.count == RecentPlaces.defaultMax)
    #expect(list.map(\.name) == ["Place 1", "Place 2", "Place 3", "Place 4", "Place 5"])
  }
}

/// The bells beside the saved places' stars (phase 8.4b, design 2.2 and 2.3): on every saved row
/// and saved result, locked without the purchase, shown on only while something can be sent, and
/// the line under the saved places for each state.
@Suite("The place picker's bells")
struct PlacePickerBellTests {
  let durham = SavedPlace(
    target: .city(slug: "durham-gb", name: "Durham"), name: "Durham",
    detail: "England, United Kingdom")
  /// Ten saved places: a full list.
  let full = (1...SavedPlaces.max).map {
    SavedPlace(target: .city(slug: "place-\($0)"), name: "Place \($0)")
  }

  /// The picker with nothing typed and `saved` saved, with the bells as given.
  func picker(
    _ saved: [SavedPlace], unlocked: Bool = true, bells: [String] = [], active: Bool = true,
    search: PlaceSearchState = .empty
  ) -> PlacePicker {
    PlacePicker(
      search: search, location: .idle, lists: places([], saved: saved), unlocked: unlocked,
      bells: bells, active: active)
  }

  @Test("a saved row's bell: locked without the purchase, else on only while it can send")
  func states() {
    let key = durham.target.key
    let cases: [(unlocked: Bool, on: Bool, active: Bool, state: AlertSync.BellState)] = [
      (false, false, false, .locked), (false, true, true, .locked), (false, false, true, .locked),
      (true, false, true, .off), (true, true, false, .off), (true, false, false, .off),
      (true, true, true, .on),
    ]
    for item in cases {
      let bell = picker(
        [savedLeeds, durham], unlocked: item.unlocked, bells: item.on ? [key] : [],
        active: item.active
      ).saved[1].bell
      #expect(bell.state == item.state, "\(item)")
      #expect(bell.place == durham)
      #expect(bell.badge == (item.state == .locked), "\(item)")
    }
    // Leeds's bell is its own: Durham's being on leaves it off.
    #expect(picker([savedLeeds, durham], bells: [key]).saved[0].bell.state == .off)
  }

  @Test("a bell's label says what a tap does, by the row's name")
  func labels() {
    let key = durham.target.key
    #expect(
      picker([durham], unlocked: false).saved[0].bell.label
        == "Turn on notifications for Durham, with the one-off purchase")
    #expect(picker([durham]).saved[0].bell.label == "Turn on notifications for Durham")
    #expect(
      picker([durham], bells: [key], active: false).saved[0].bell.label
        == "Turn on notifications for Durham")
    #expect(
      picker([durham], bells: [key]).saved[0].bell.label == "Turn off notifications for Durham")
  }

  @Test("a saved result has a bell, under the result's name; a result not saved has none")
  func results() throws {
    let found = try searchResults("search-leeds") + (try searchResults("search-kathmandu"))
    let renamed = SavedPlace(target: .city(slug: "leeds-gb"), name: "Leeds, West Yorkshire")
    for unlocked in [false, true] {
      let shown = picker(
        [renamed], unlocked: unlocked, bells: [renamed.target.key], search: .found(found))
      let bell = try #require(shown.results[0].bell)
      #expect(bell.place == renamed)
      #expect(bell.state == (unlocked ? .on : .locked))
      #expect(
        bell.label
          == (unlocked
            ? "Turn off notifications for Leeds"
            : "Turn on notifications for Leeds, with the one-off purchase"))
      #expect(shown.results[1].bell == nil)
      // Typing hides the saved rows, never a saved result's bell.
      #expect(shown.saved.isEmpty)
    }
    // While a newer search is on its way, the last results keep their bells.
    #expect(
      picker([savedLeeds], search: .searching(previous: found)).results.map { $0.bell?.state }
        == [.off, nil])
  }

  @Test("unsaving a place whose bell shows on says its notifications are off too")
  func unsavingARungPlace() throws {
    let key = savedLeeds.target.key
    let rung = picker([savedLeeds], bells: [key])
    #expect(
      rung.saved[0].star.announcement
        == "Leeds removed from saved places. Its notifications are off.")
    #expect(rung.saved[0].star.label == "Remove Leeds from saved places")
    let found = try searchResults("search-leeds")
    #expect(
      picker([savedLeeds], bells: [key], search: .found(found)).results[0].star?.announcement
        == "Leeds removed from saved places. Its notifications are off.")
    // A bell that shows off or locked, kept or not, sends nothing: the star's words as before.
    for shown in [
      picker([savedLeeds]), picker([savedLeeds], bells: [key], active: false),
      picker([savedLeeds], unlocked: false, bells: [key]),
    ] {
      #expect(shown.saved[0].star.announcement == "Leeds removed from saved places.")
    }
  }

  @Test("the line under the saved places, one for each state (design 2.3)")
  func lines() {
    let key = savedLeeds.target.key
    let noneFree =
      "Tap the star beside a place to save it. Saved places can have notifications with the "
      + "one-off purchase."
    let nonePaid =
      "Tap the star beside a place to save it, then tap its bell to get notifications."
    let locked = "Tap a place's bell to get notifications for it, with the one-off purchase."
    let hint = "Tap a place's bell to get notifications for it."
    let fullLine = "You can save up to 10 places. Remove one to save another."
    #expect(picker([], unlocked: false).savedLine == noneFree)
    #expect(picker([]).savedLine == nonePaid)
    // Free: the purchase's line, whatever the bells kept.
    #expect(picker([savedLeeds], unlocked: false).savedLine == locked)
    #expect(picker([savedLeeds], unlocked: false, bells: [key]).savedLine == locked)
    // Paid: how a bell works until one shows on, then nothing.
    #expect(picker([savedLeeds]).savedLine == hint)
    #expect(picker([savedLeeds], bells: [key], active: false).savedLine == hint)
    #expect(picker([savedLeeds], bells: [key]).savedLine == nil)
    // Full: the list's line first, then the bell's.
    let fullFree = picker(full, unlocked: false)
    #expect(fullFree.savedFull == fullLine)
    #expect(fullFree.savedLine == locked)
    #expect(picker(full).savedFull == fullLine)
    #expect(picker(full).savedLine == hint)
    let fullRung = picker(full, bells: [full[3].target.key])
    #expect(fullRung.savedFull == fullLine)
    #expect(fullRung.savedLine == nil)
    // Typing hides both.
    let typing = picker([savedLeeds], search: .tooShort)
    #expect(typing.savedLine == nil)
    #expect(typing.savedFull == nil)
  }

  @Test("the lines follow the client's rule, key by key, for every state")
  func linesFollowTheRule() {
    #expect(
      PlacePicker.SavedLine.allCases.map(\.rawValue) == [
        "savedFull", "savedLineNoneFree", "savedLineNonePaid", "bellHint", "bellHintLocked",
      ])
    #expect(PlacePicker.SavedLine.savedFull.text == AppCopy.savedFull(max: "10"))
    #expect(PlacePicker.SavedLine.savedLineNoneFree.text == AppCopy.savedLineNoneFree)
    #expect(PlacePicker.SavedLine.savedLineNonePaid.text == AppCopy.savedLineNonePaid)
    #expect(PlacePicker.SavedLine.bellHint.text == AppCopy.bellHint)
    #expect(PlacePicker.SavedLine.bellHintLocked.text == AppCopy.bellHintLocked)
    for count in [0, 1, 9, 10] {
      for unlocked in [false, true] {
        for rung in [false, true] where count > 0 || !rung {
          let saved = Array(full.prefix(count))
          let shown = picker(
            saved, unlocked: unlocked, bells: rung ? [saved[0].target.key] : [])
          let keys = PlacePicker.savedLines(
            savedCount: count, unlocked: unlocked, anyBellOn: rung && unlocked)
          let texts = keys.map(\.text)
          #expect(
            [shown.savedFull, shown.savedLine].compactMap { $0 } == texts,
            "\(count) \(unlocked) \(rung)")
        }
      }
    }
  }

  @Test("notifications denied: after a bell's tap met it, the line and Open Settings, typing too")
  func denied() throws {
    #expect(picker([savedLeeds]).bellDenied == nil)
    for search in [PlaceSearchState.empty, .found(try searchResults("search-leeds"))] {
      let shown = PlacePicker(
        search: search, location: .idle, lists: places([], saved: [savedLeeds]), unlocked: true,
        bells: [savedLeeds.target.key], active: false, bellDenied: true)
      #expect(
        shown.bellDenied
          == PlacePicker.BellDenied(
            text: "Notifications are off for this app in Settings.", openSettings: "Open Settings"))
      // Nothing can be sent while denied: every bell shows off, kept underneath.
      #expect(shown.saved.allSatisfy { $0.bell.state == .off })
      #expect(shown.results.compactMap(\.bell).allSatisfy { $0.state == .off })
    }
  }

  @Test("a bell is a saved place's by its key, byte for byte; a recent place has none")
  func keysByteForByte() {
    let composed = SavedPlace(target: .city(slug: "caf\u{E9}-fr"), name: "Caf\u{E9}")
    let decomposed = "city:cafe\u{301}-fr"
    #expect(decomposed == composed.target.key)
    let shown = PlacePicker(
      search: .empty, location: .idle,
      lists: places([recentLeeds], saved: [composed]), unlocked: true, bells: [decomposed],
      active: true)
    #expect(shown.saved[0].bell.state == .off)
    #expect(shown.recents.count == 1)
  }
}
