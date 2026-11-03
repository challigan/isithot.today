import Foundation
import IsItLogic
import IsItModel
import Observation

/// What a tap on a saved place's bell came to (phase 8.4b, design 4.6), which the picker says to
/// VoiceOver once it is known.
public enum BellResult: Sendable, Equatable {
  /// Without the one-off purchase: the upgrade sheet opens over the picker, and nothing is said.
  case needsPurchase
  /// The bell turned on: "Notifications on for Kathmandu."
  case on
  /// The bell turned on with "Evening before", as every switch was off, which is for where you
  /// are too: "Evening notifications on for Kathmandu and where you are."
  case onWithHere
  /// The bell turned off: "Notifications off for Kathmandu."
  case off
  /// Notifications are off for the app in iOS Settings, or the prompt was refused: "Notifications
  /// are off for this app in Settings.", with Open Settings under the saved places.
  case denied
}

/// The saved places' bells, as the picker shows and taps them: `NotificationsModel`'s, a fake in
/// the tests.
@MainActor
public protocol PickerBells: AnyObject {
  /// The bells on, by the saved place's `Target.key`, in saved order (`alerts.v2`'s), kept while
  /// nothing can be sent and without the purchase.
  var bells: [String] { get }
  /// Whether anything can be sent (`AlertSync.active`): otherwise every bell shows off.
  var active: Bool { get }
  /// Whether notifications are off for the app in iOS Settings.
  var permissionDenied: Bool { get }
  /// A tap on `place`'s bell, shown with the purchase `unlocked` or not, once its work is done.
  func toggleBell(_ place: SavedPlace, unlocked: Bool) async -> BellResult
}

/// The place picker's state (iOS build spec, sections 4 and 10.3), for one showing of the sheet
/// (`AppModel.makePicker(bells:announce:)`): the search box's text and its search, the "Use my
/// location" row, and whether a place was chosen, when the sheet closes; and each saved place's
/// bell (phase 8.4b, design 2.2), as the purchase and the notifications have it, whose tap's
/// outcome is said to VoiceOver once it is known, and whose purchase, when locked, opens over the
/// picker. `content` is what IsItUI draws.
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

  /// The saved place whose locked bell opened the purchase: the upgrade sheet shows over the
  /// picker while it is set, and its bell turns on by itself when the sheet closes with the
  /// purchase owned (`purchaseSheetClosed(unlocked:)`).
  public private(set) var purchasing: SavedPlace?
  /// Whether a bell's tap met notifications denied in iOS Settings this showing: its line shows
  /// under the saved places while they still are.
  private var bellMetDenied = false

  /// The saved places' bells: the notifications'. Without them, each bell is the purchase's alone
  /// and a tap does nothing.
  @ObservationIgnored private let bells: (any PickerBells)?
  /// Says a bell's outcome to VoiceOver.
  @ObservationIgnored private let announce: @MainActor (String) -> Void

  init(
    app: AppModel, client: APIClient, clock: any AppClock, bells: (any PickerBells)?,
    announce: @escaping @MainActor (String) -> Void
  ) {
    self.app = app
    self.client = client
    self.clock = clock
    self.bells = bells
    self.announce = announce
  }

  /// What the picker shows: the search, the location row, and the saved and recent places, each
  /// saved place's bell as the purchase (`AppModel.unlocked`) and the notifications have it, and
  /// the denied line once a bell's tap met it, while notifications are still denied.
  public var content: PlacePicker {
    PlacePicker(
      search: search, location: location, lists: app.lists, unlocked: app.unlocked,
      bells: bells?.bells ?? [], active: bells?.active ?? false,
      bellDenied: bellMetDenied && bells?.permissionDenied == true)
  }

  /// A tap on `place`'s bell: the notifications do its work (`PickerBells.toggleBell`), with the
  /// purchase as the picker shows it, then its outcome is said to VoiceOver, in the place's name:
  /// on, on with the evening, off, or denied, which also shows the denied line. Without the
  /// purchase nothing is said: `purchasing` opens the upgrade sheet over the picker. Nil, doing
  /// nothing, without the notifications. Never closes the sheet, so never shows an ad.
  @discardableResult
  public func toggleBell(_ place: SavedPlace) async -> BellResult? {
    await toggle(place, unlocked: app.unlocked)
  }

  /// The upgrade sheet a locked bell opened has closed: with the purchase now `unlocked`, that
  /// bell turns on by itself (asking for notifications if they were never asked), and its outcome
  /// is said; one already on underneath (bells kept from before a refund) stays on, and is said to
  /// be. Without the purchase, or for a place no longer saved, nothing.
  public func purchaseSheetClosed(unlocked: Bool) async {
    guard let place = purchasing else { return }
    purchasing = nil
    let key = place.target.key.utf8
    guard unlocked, let bells, app.saved.contains(where: { $0.target.key.utf8.elementsEqual(key) })
    else { return }
    if bells.active, bells.bells.contains(where: { $0.utf8.elementsEqual(key) }) {
      say(.on, for: place)
      return
    }
    await toggle(place, unlocked: true)
  }

  /// A bell's tap with the purchase `unlocked` or not, and its outcome said.
  @discardableResult
  private func toggle(_ place: SavedPlace, unlocked: Bool) async -> BellResult? {
    guard let bells else { return nil }
    let result = await bells.toggleBell(place, unlocked: unlocked)
    if result == .needsPurchase {
      purchasing = place
    } else {
      bellMetDenied = result == .denied
      say(result, for: place)
    }
    return result
  }

  /// Says `result` for `place` to VoiceOver (design 2.2); nothing for the purchase.
  private func say(_ result: BellResult, for place: SavedPlace) {
    switch result {
    case .needsPurchase: return
    case .on: announce(AppCopy.bellTurnedOn(place: place.name))
    case .onWithHere: announce(AppCopy.bellTurnedOnWithHere(place: place.name))
    case .off: announce(AppCopy.bellTurnedOff(place: place.name))
    case .denied: announce(AppCopy.notifyDenied)
    }
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
