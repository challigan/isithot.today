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

/// The place picker as plain values (iOS build spec, section 10.3), from the search's state, the
/// location row's and the recent places.
@Suite("The place picker's content")
struct PlacePickerTests {
  @Test("its words: the title, Close, the prompt, the clear button and Use my location")
  func words() {
    let picker = PlacePicker(search: .empty, location: .idle, recents: [])
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
  }

  @Test("with nothing typed, the recent places under Recent, newest first")
  func recents() {
    let picker = PlacePicker(search: .empty, location: .idle, recents: [recentHere, recentLeeds])
    #expect(picker.recentHeading == "Recent")
    #expect(picker.recents.map(\.name) == ["Leeds", "Leeds"])
    #expect(picker.recents.map(\.id) == ["device:53.8,-1.55", "city:leeds-gb"])
    #expect(picker.recents.map(\.place) == [recentHere, recentLeeds])
    // Typing hides them: the box's own line or results take their place.
    for search in [
      PlaceSearchState.tooShort, .searching(previous: []), .found([]), .failed("No."),
    ] {
      let typing = PlacePicker(search: search, location: .idle, recents: [recentLeeds])
      #expect(typing.recentHeading == nil, "\(search)")
      #expect(typing.recents.isEmpty, "\(search)")
    }
  }

  @Test("too short, no places and a failure each have their line, and no results")
  func lines() {
    let short = PlacePicker(search: .tooShort, location: .idle, recents: [])
    #expect(short.status == "Type at least 2 letters.")
    #expect(short.results.isEmpty)
    let none = PlacePicker(search: .found([]), location: .idle, recents: [])
    #expect(none.status == "No places found.")
    let failed = PlacePicker(search: .failed(AppCopy.searchOffline), location: .idle, recents: [])
    #expect(failed.status == "You're offline. Connect to the internet to search.")
    #expect(failed.results.isEmpty)
  }

  @Test("a result reads its name with its region and country beneath")
  func results() throws {
    let found = try searchResults("search-leeds") + (try searchResults("search-kathmandu"))
    let picker = PlacePicker(search: .found(found), location: .idle, recents: [recentLeeds])
    #expect(picker.status == nil)
    #expect(picker.results.map(\.name) == ["Leeds", "Kathmandu"])
    #expect(picker.results.map(\.detail) == ["England, United Kingdom", "Bagmati Province, Nepal"])
    #expect(picker.results.map(\.id) == [0, 1])
    #expect(picker.results.map(\.result) == found)
    // A result with neither region nor country has no line beneath.
    let json = #"{"name":"Bath","region":null,"country":null,"countryName":null,"lat":1,"lon":2}"#
    let bare = try JSONDecoder().decode(SearchResult.self, from: Data(json.utf8))
    let row = PlacePicker(search: .found([bare]), location: .idle, recents: []).results[0]
    #expect(row.name == "Bath")
    #expect(row.detail == nil)
  }

  @Test("while a new search is out, the last one's results stay")
  func searching() throws {
    let leeds = try searchResults("search-leeds")
    let picker = PlacePicker(search: .searching(previous: leeds), location: .idle, recents: [])
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
      PlacePicker(search: .empty, location: state, recents: []).location
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
