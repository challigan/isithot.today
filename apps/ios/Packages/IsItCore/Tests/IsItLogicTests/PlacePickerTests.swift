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
    #expect(picker.savedHint == nil)
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

  @Test("with none saved, the heading and the hint, even with no recent places")
  func hint() {
    let first = PlacePicker(search: .empty, location: .idle, lists: places([]))
    #expect(first.savedHeading == "Saved")
    #expect(first.saved.isEmpty)
    #expect(first.savedHint == "Tap the star beside a place to save it here.")
    #expect(first.savedFull == nil)
    #expect(first.recentHeading == nil)
    let some = PlacePicker(search: .empty, location: .idle, lists: places([york]))
    #expect(some.savedHint == "Tap the star beside a place to save it here.")
    #expect(some.recentHeading == "Recent")
  }

  @Test("full: the line says why, no empty stars, and the filled ones still remove")
  func fullList() throws {
    let leeds = try searchResults("search-leeds")
    let picker = PlacePicker(
      search: .empty, location: .idle, lists: places([york, recentHere], saved: full))
    #expect(picker.saved.count == 10)
    #expect(picker.savedHint == nil)
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
      #expect(picker.savedHint == nil, "\(search)")
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
    let texts =
      [empty.savedHeading, empty.savedHint, whenFull.savedFull, empty.deleteRecent]
      .compactMap { $0 }
      + [empty.recents[0].star, whenFull.saved[0].star, searching.results[0].star]
      .compactMap { $0 }.flatMap { [$0.label, $0.announcement] }
      + searching.results.compactMap(\.value)
    #expect(texts.count == 11)
    for text in texts {
      #expect(otherTopic(in: text) == nil, "\(text)")
      #expect(text.first?.isUppercase == true, "\(text)")
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
