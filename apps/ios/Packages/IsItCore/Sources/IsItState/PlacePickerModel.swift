import Foundation
import IsItLogic
import IsItModel
import Observation

/// The place picker's state (iOS build spec, sections 4 and 10.3), for one showing of the sheet
/// (`AppModel.makePicker()`): the search box's text and its search, the "Use my location" row,
/// and whether a place was chosen, when the sheet closes. `content` is what IsItUI draws.
///
/// The search waits for a pause in typing (`Constants.Search.debounceMs`, 250 ms, timed by
/// `AppEnvironment.waits`) before it asks, from 2 letters (`PlaceSearch.input`); each keystroke
/// cancels the search before it, the wait and the request both, and only the newest search's
/// answer is ever shown. While a new search is on its way, the last one's results stay.
@MainActor
@Observable
public final class PlacePickerModel {
  /// The search box's text, as typed.
  public private(set) var text = ""
  /// Where the search is.
  public private(set) var search = PlaceSearchState.empty
  /// Where "Use my location" is.
  public private(set) var location = LocationState.idle
  /// Whether a place was chosen: the sheet closes.
  public private(set) var finished = false

  @ObservationIgnored private let app: AppModel
  @ObservationIgnored private let client: APIClient
  @ObservationIgnored private let clock: any AppClock
  /// Counts the searches started; only the newest one's answer is shown.
  @ObservationIgnored private var searches = 0
  /// Whether this showing is over: a place was chosen, or the sheet closed. A fix that comes
  /// after that is dropped.
  @ObservationIgnored private var over = false
  /// The wait before the newest search asks.
  @ObservationIgnored private var waiting: ScheduledWork?
  /// The newest search's request, while it is out.
  @ObservationIgnored private var request: Task<SearchResponse, any Error>?

  init(app: AppModel, client: APIClient, clock: any AppClock) {
    self.app = app
    self.client = client
    self.clock = clock
  }

  /// What the picker shows: the search, the location row, and the saved and recent places.
  public var content: PlacePicker {
    PlacePicker(search: search, location: location, lists: app.lists)
  }

  /// The search box now holds `text`: cancels the search before, and with 2 letters or more,
  /// searches for the trimmed text after the pause. The same text again changes nothing.
  public func type(_ text: String) {
    guard !text.utf8.elementsEqual(self.text.utf8) else { return }
    self.text = text
    let shown = search.shown
    cancelSearch()
    searches += 1
    switch PlaceSearch.input(text) {
    case .empty:
      search = .empty
    case .tooShort:
      search = .tooShort
    case .search(let q):
      search = .searching(previous: shown)
      let number = searches
      let at = clock.now.addingTimeInterval(TimeInterval(Constants.Search.debounceMs) / 1000)
      waiting = clock.schedule(at: at) { [weak self] in
        await self?.run(q, number)
      }
    }
  }

  /// The keyboard's Search key: chooses the first result, as Enter does on the website, once a
  /// search has found some; otherwise nothing.
  public func submit() async {
    guard case .found(let found) = search, let first = found.first else { return }
    await choose(first)
  }

  /// Chooses a search result (`Target(search:)`: its city page's slug, or its point on the
  /// grid), named as the search named it, with its line. The sheet closes at once, then the
  /// place loads.
  public func choose(_ result: SearchResult) async {
    finish()
    await app.choose(Target(search: result), name: result.name, detail: PlaceSearch.line(result))
  }

  /// Chooses a recent place, which moves to the top of the list.
  public func choose(_ place: RecentPlace) async {
    finish()
    await app.choose(place.target, name: place.name, detail: place.detail)
  }

  /// Chooses a saved place, which stays where it is in Saved and doesn't join Recent. A saved
  /// place is never the phone's own point, so nothing follows the phone from here.
  public func choose(saved place: SavedPlace) async {
    finish()
    await app.choose(place.target, name: place.name, detail: place.detail)
  }

  /// Takes `place` off the recent places.
  public func remove(_ place: RecentPlace) {
    app.removeRecent(place)
  }

  /// A result's empty star: saves the place as the search named it, with its line. The sheet
  /// stays open on the same results, and nothing is chosen or asked for.
  public func save(_ result: SearchResult) {
    app.save(
      SavedPlace(
        target: Target(search: result), name: result.name, detail: PlaceSearch.line(result))
    )
  }

  /// A recent place's empty star: it moves to the end of the saved places, name, line and all.
  public func save(_ place: RecentPlace) {
    app.save(SavedPlace(target: place.target, name: place.name, detail: place.detail))
  }

  /// A filled star, on a saved place or a result that is one: the place goes back on top of the
  /// recent places, where one more tap saves it again. Nothing is chosen or asked for.
  public func unsave(_ target: Target) {
    app.unsave(target)
  }

  /// "Use my location": permission, asked only now and only if never asked, then one fix
  /// (`AppModel.locate()`). With a fix, the sheet closes and the device's place loads, joining
  /// the recent places under its answer's name; without one, the row says why. A tap while
  /// the fix is out does nothing, and a fix that comes once a place was chosen or the sheet
  /// closed is dropped: Close means no place, and a place chosen meanwhile stays chosen.
  public func useMyLocation() async {
    guard location != .locating else { return }
    location = .locating
    let found = await app.locate()
    guard !over else {
      location = .idle
      return
    }
    switch found {
    case .located(let place):
      location = .idle
      finish()
      await app.choose(place, name: nil)
    case .denied:
      location = .denied
    case .unavailable:
      location = .unavailable
    }
  }

  /// The sheet closed: nothing more is asked, no answer still on its way is shown, and a fix
  /// still on its way chooses nothing.
  public func close() {
    cancelSearch()
    searches += 1
    over = true
  }

  // MARK: - The search

  /// After the pause: asks for `q`, unless a newer search started meanwhile, and shows what
  /// came back only if none did while it was out.
  private func run(_ q: String, _ number: Int) async {
    guard number == searches else { return }
    waiting = nil
    let client = client
    let request = Task { try await client.search(q) }
    self.request = request
    let outcome = await request.result
    guard number == searches else { return }
    self.request = nil
    switch outcome {
    case .success(let response):
      search = .found(response.results)
    case .failure(let error):
      search = .failed(APIClient.failure(for: error).searchMessage)
    }
  }

  private func cancelSearch() {
    waiting?.cancel()
    waiting = nil
    request?.cancel()
    request = nil
  }

  private func finish() {
    cancelSearch()
    searches += 1
    finished = true
    over = true
  }
}
