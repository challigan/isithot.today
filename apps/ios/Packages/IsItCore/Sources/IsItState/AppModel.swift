import Foundation
import IsItLogic
import IsItModel
import Observation

/// The app's state, and the order it launches in (iOS build spec, sections 9.4 and 9.5): the
/// place and units, the answer and how the last fetch went, the holds, the purchase, the view
/// on screen and a pending route. Its services come through `AppEnvironment`, so the tests run
/// it on Linux with fakes. The views read it and call its few functions; every decision is one
/// of `Launch`, `Refresh` and `AnswerState`'s.
@MainActor
@Observable
public final class AppModel {
  /// Where the answers are for: `place.v1`, approximate IP location when none is chosen.
  public private(set) var target: Target
  /// The units every request carries: `units.v1`, or, before the first answer, none, so the
  /// server chooses; the app then keeps the answer's (section 5.6).
  public private(set) var units: Units?
  /// The answer on screen: the saved one painted at launch, then each one fetched.
  public private(set) var response: TodayResponse?
  /// When `response` was fetched.
  public private(set) var fetchedAt: Date?
  /// How the last fetch went.
  public private(set) var phase: AppPhase
  /// The holds for a phone clock running fast (`Freshness.hold`), kept while the app runs.
  public private(set) var holds = Freshness.Holds()
  /// Whether the purchase is owned: `unlock.v1`, then StoreKit's check at launch step 5, and
  /// from then on, or from sooner, each change `PurchaseModel` tells (`purchaseChanged(owned:)`).
  public private(set) var unlocked: Bool
  /// The view on screen; the pager and the switcher set it as the user moves. The app opens on
  /// the view for the time of day (`MiddleDay.defaultView`) once: from the saved answer it
  /// paints, or else from the first answer it shows, unless the user has moved or a route has
  /// chosen a view by then, as the website opens on it only once and never once the visitor has
  /// moved (`openOnDefault`). After that it moves only as the user moves it, by a route to a view,
  /// or on the return after a long time away; never as a place under "Nearby:", a place chosen
  /// in the picker or Retry brings an answer.
  public var view: AppView {
    get { shownView }
    set {
      // The view on screen chosen again (a pager may write back the one it shows) is no move.
      if newValue != shownView { opened = true }
      shownView = newValue
    }
  }
  private var shownView: AppView
  /// A line to tell the user once, until `dismissNotice()`: `AppCopy.slugGone`, say.
  public private(set) var notice: String?
  /// A route waiting for the launch to finish (step 7).
  public private(set) var route: DeepLink.Route?
  /// When the next quiet refresh is due, or nil when none is (in the background, say).
  public private(set) var nextRefreshAt: Date?
  /// The picker's recent places (`recent.v1`), newest first: the last five chosen there. A place
  /// may also be saved if a write was cut short; the picker shows it once, under "Saved"
  /// (`SavedPlaces.shownRecent`).
  public private(set) var recents: [RecentPlace]
  /// The picker's saved places (`savedPlaces.v1`), in the order saved: at most ten, kept until
  /// removed, never the phone's own point.
  public private(set) var saved: [SavedPlace]

  @ObservationIgnored private let environment: AppEnvironment
  /// The launch's fetch (step 3), decided with the paint in `init`.
  @ObservationIgnored private let launchFetch: Fetch?
  @ObservationIgnored private var launched = false
  /// Whether the view on screen has been chosen: by the saved answer painted at launch, the first
  /// answer shown, the user or a route. Until then the first answer opens on its view for the
  /// time of day.
  @ObservationIgnored private var opened: Bool
  @ObservationIgnored private var launchFinished = false
  /// Whether `PurchaseModel` has told the model an answer this launch (`purchaseChanged`): step
  /// 5's answer, which may have been read before it, then leaves `unlocked` alone.
  @ObservationIgnored private var purchaseHeard = false
  /// Whether step 5 has started the ads (`hooks.startAds()`): only then does a purchase stop
  /// them (`purchaseChanged`).
  @ObservationIgnored private var adsStarted = false
  /// Counts the fetches started; only the latest one's answer is shown.
  @ObservationIgnored private var requests = 0
  @ObservationIgnored private var refreshWork: ScheduledWork?
  /// When the app went to the background, while it is there.
  @ObservationIgnored private var awayFrom: Date?
  /// While the app is in the background, when the quiet refresh or the retry after a failure is
  /// due: on the return it is due then still, at once if that time has passed.
  @ObservationIgnored private var dueOnReturn: Date?
  /// A place the picker chose without a name (the device's), which joins the recent places
  /// under its answer's name when that answer arrives.
  @ObservationIgnored private var unnamedChoice: Target?

  /// Step 1: reads what was stored, and paints the saved answer at once, in the view for the
  /// time of day, when it is for the place and still has an hour to show (`Launch.plan`);
  /// otherwise the loading state. Nothing is fetched until `launch()`.
  public init(environment: AppEnvironment) {
    self.environment = environment
    let store = environment.store
    let now = environment.clock.now
    let target = store.loadPlace()
    let units = store.loadUnits()
    let plan = Launch.plan(store.loadToday(), target: target, units: units, at: now)
    self.target = target
    self.units = units
    unlocked = store.loadUnlocked()
    launchFetch = plan.fetch
    response = plan.paint?.response
    fetchedAt = plan.paint?.savedAt
    phase = plan.paint == nil ? .loading : .ready
    shownView = MiddleDay.defaultView(plan.paint?.response, at: now)
    opened = plan.paint != nil
    recents = environment.recents.loadRecents()
    saved = environment.saved.loadSavedPlaces()
  }

  // MARK: - What the views call

  /// Steps 2 to 7 of the launch, once. Step 2 starts the entitlement check (phase 7); step 3
  /// fetches, unless the saved answer is recent (`Launch.reuses`), then saves the answer,
  /// writes the App Group and reloads the widgets; step 4, for "My location", takes one
  /// location fix when permission is already granted, never asking (`fixMoved(from:)`), and
  /// fetches again only when the place's 0.05° cell changed and the place is still the one the
  /// fix was for, so a place chosen meanwhile stands; step 5 takes the check's answer, unless
  /// `PurchaseModel` has told a newer one meanwhile, and starts the ads only when not unlocked
  /// (phase 8); step 6 syncs the notifications (phase 8); step 7 handles a pending route (phases
  /// 6 and 8).
  public func launch() async {
    guard !launched else { return }
    launched = true
    let hooks = environment.hooks
    hooks.startEntitlementCheck()
    if let launchFetch {
      await load(launchFetch)
    } else if let response {
      scheduleRefresh(at: next(after: response))
    }
    if case .coords(let place) = target, place.source == .device {
      let located = target
      if let moved = await fixMoved(from: located),
        target.key.utf8.elementsEqual(located.key.utf8)
      {
        keep(moved)
        await load(.plain)
      }
    }
    if let owned = await hooks.entitlement(), !purchaseHeard { unlocked = owned }
    if !unlocked {
      adsStarted = true
      await hooks.startAds()
    }
    await hooks.syncAlerts(target: target, units: units)
    launchFinished = true
    if let pending = route {
      route = nil
      await follow(pending)
    }
  }

  /// Asks again now, keeping what is on screen: pull to refresh, and the error state's "Try
  /// again". Past the caches when the answer on screen is out of date.
  public func refresh() async {
    await load(Refresh.fetch(response, at: environment.clock.now, holds: holds))
  }

  /// The app went to the background: nothing is fetched until it comes back, and the refresh
  /// or retry that was due is kept for then.
  public func didEnterBackground() {
    // Told twice before coming back, what was due when the app first left is due still.
    if awayFrom == nil { dueOnReturn = nextRefreshAt }
    awayFrom = environment.clock.now
    cancelRefresh()
  }

  /// The app came back from the background (`Refresh.foreground`): after more than 30 minutes
  /// away, back to the view for the time of day, and a fetch; sooner, a fetch only when the
  /// answer is out of date, past its hours or missing. Otherwise what was due when the app left
  /// is scheduled again for its own time (at once when that has passed): the quiet refresh at
  /// the next forecast hour, or the retry a minute after a failure. Does nothing unless the app
  /// was in the background, or before the launch.
  public func willEnterForeground() async {
    guard let away = awayFrom else { return }
    let due = dueOnReturn
    awayFrom = nil
    dueOnReturn = nil
    guard launched else { return }
    let now = environment.clock.now
    let back = Refresh.foreground(
      response,
      fetchedAt: fetchedAt,
      awayFrom: away,
      at: now,
      holds: holds
    )
    if back.resetView { shownView = MiddleDay.defaultView(response, at: now) }
    if let fetch = back.fetch {
      await load(fetch)
    } else if let response {
      scheduleRefresh(at: due ?? next(after: response))
    }
  }

  /// What the answer views show at `now` (`AnswerState.at`): the minute tick passes its date.
  public func answer(at now: Date) -> AnswerState {
    AnswerState.at(now, response: response, phase: phase)
  }

  /// The footer's offline line at `now`, or nil (`AnswerState.offlineLine`).
  public func offlineLine(at now: Date) -> String? {
    AnswerState.offlineLine(response, phase: phase, at: now)
  }

  /// Opens `route`: at once once the launch has finished, else at its end (step 7).
  public func open(_ route: DeepLink.Route) async {
    guard launchFinished else {
      self.route = route
      return
    }
    await follow(route)
  }

  /// A route to a view (a widget's) puts that view on screen, over the view for the time of day
  /// the launch chose (section 10.2: "unless a route says otherwise"), and an answer still to
  /// come after a failed launch keeps it; every route then goes to the later phases' hooks.
  private func follow(_ route: DeepLink.Route) async {
    if case .view(let shown) = route {
      shownView = shown
      opened = true
    }
    await environment.hooks.handle(route)
  }

  /// The user has read the notice.
  public func dismissNotice() {
    notice = nil
  }

  // MARK: - The purchase

  /// StoreKit's answer changed (a purchase, an Ask to Buy approval, a restore, a refund or a
  /// Family Sharing removal, or the launch's check disagreeing with `unlock.v1`), as
  /// `PurchaseModel` tells it: `unlocked` follows at once, so the home row, the band, the boxes,
  /// Report an ad, Privacy choices and Your privacy's ads line go or come back with it, and step 5
  /// keeps it. Owned once step 5 has started the ads, they stop for good this launch
  /// (`hooks.stopAds()`); owned before step 5, step 5 doesn't start them, and nothing is stopped.
  /// No longer owned mid-session, nothing starts: the ads start at the next launch (spec 13);
  /// before step 5, step 5 starts them, as in any free launch, whatever was heard before.
  public func purchaseChanged(owned: Bool) async {
    purchaseHeard = true
    guard owned != unlocked else { return }
    unlocked = owned
    if owned, adsStarted { await environment.hooks.stopAds() }
  }

  // MARK: - The place picker

  /// A picker over this model (section 10.3), with the model's client, its pause after typing
  /// timed by the environment's `waits`: the sheet makes one each time it opens.
  public func makePicker() -> PlacePickerModel {
    PlacePickerModel(app: self, client: environment.client, clock: environment.waits)
  }

  /// Chooses `target` as the place, as the picker does (section 10.3): it is kept in
  /// `place.v1`, loaded in place (`select(_:)`, which saves it for the widgets and reloads them),
  /// and unless it is a saved place, which stays where it is, joins the recent places under
  /// `name`, with its line (`detail`), at once (`SavedPlaces.choosing`); a place without a name
  /// (the device's) joins them under its answer's name when the answer arrives. Then the
  /// notifications are synced (phase 8's `syncAlerts`), as a notification place that follows the
  /// device's location may have moved. The view on screen stays, as for a place under "Nearby:":
  /// a place chosen from This week opens on its week. The place on screen again only asks again.
  public func choose(_ target: Target, name: String?, detail: String? = nil) async {
    if let name, !name.isEmpty {
      unnamedChoice = nil
      keepLists(SavedPlaces.choosing(target, name: name, detail: detail, in: lists))
    } else {
      unnamedChoice = target
    }
    await select(target)
    await environment.hooks.syncAlerts(target: self.target, units: units)
  }

  /// Takes `place` off the recent places (Delete in the picker).
  public func removeRecent(_ place: RecentPlace) {
    saveRecents(RecentPlaces.removing(place.target, from: recents))
  }

  /// The picker's saved and recent places, together, as `SavedPlaces` changes them.
  public var lists: PlaceLists {
    PlaceLists(saved: saved, recent: recents)
  }

  /// Saves `place` (a star in the picker): at the end of the saved places, and out of the recent
  /// places (`SavedPlaces.saving`). Nothing is chosen or asked for: the picker stays as it is. A
  /// place that can't be saved (the list full, the phone's own point, or saved already) changes
  /// nothing.
  public func save(_ place: SavedPlace) {
    keepLists(SavedPlaces.saving(place, in: lists))
  }

  /// Removes `target`'s place from the saved places (its filled star), putting it back on top of
  /// the recent places, so its empty star there saves it again (`SavedPlaces.unsaving`). Nothing
  /// is chosen or asked for.
  public func unsave(_ target: Target) {
    keepLists(SavedPlaces.unsaving(target, in: lists))
  }

  /// "Use my location" (section 10.3): asks for When In Use permission only now, at the tap,
  /// and only if it was never asked; then one fix, rounded to the 0.05° grid
  /// (`Target.device(lat:lon:)`). Denied or restricted, nothing is asked again, and the picker
  /// says so. It chooses nothing: the picker chooses the place it gives.
  public func locate() async -> LocationOutcome {
    let location = environment.location
    var access = await location.access()
    if access == .notDetermined { access = await location.requestAccess() }
    guard access == .granted else { return .denied }
    switch await location.fix() {
    case .located(let latitude, let longitude):
      return .located(.device(lat: latitude, lon: longitude))
    case .denied:
      return .denied
    case .unavailable:
      return .unavailable
    }
  }

  /// Launch step 4: for the device's place `located`, one fix when permission is granted,
  /// never asking; the device's new place when its 0.05° cell differs, else nil.
  private func fixMoved(from located: Target) async -> Target? {
    let location = environment.location
    guard await location.access() == .granted,
      case .located(let latitude, let longitude) = await location.fix()
    else { return nil }
    let moved = Target.device(lat: latitude, lon: longitude)
    return moved.key.utf8.elementsEqual(located.key.utf8) ? nil : moved
  }

  private func saveRecents(_ list: [RecentPlace]) {
    recents = list
    environment.recents.saveRecents(list)
  }

  /// Keeps `lists`, writing each that changed whole: the saved places first, then the recent
  /// places. A write cut short between the two leaves a place in both, which the picker shows once,
  /// under "Saved" (`SavedPlaces.shownRecent`), until the next change to Recent drops it.
  private func keepLists(_ lists: PlaceLists) {
    if lists.saved != saved {
      saved = lists.saved
      environment.saved.saveSavedPlaces(lists.saved)
    }
    if lists.recent != recents { saveRecents(lists.recent) }
  }

  // MARK: - Loading a place

  /// Loads the answer for `target` in place, as a place under "Nearby:" does (section 10.2):
  /// it becomes the place, kept in `place.v1`, and the page shows the loading state for it
  /// until its own answer arrives, never the last place's answer under its name, on the view the
  /// user is on; a failure then shows as it would with nothing saved. The notice, about the last
  /// place, goes. The place on screen again only asks again (`refresh()`).
  public func select(_ target: Target) async {
    notice = nil
    guard !target.key.utf8.elementsEqual(self.target.key.utf8) else {
      await refresh()
      return
    }
    keep(target)
    response = nil
    fetchedAt = nil
    phase = .loading
    cancelRefresh()
    await load(.plain)
  }

  /// Settings' snow units control (section 10.4): `units` become the units every request asks
  /// in, kept in `units.v1`, and the answer is asked for again in them (`refresh()`), keeping
  /// what is on screen meanwhile, as the website's units pill does; then the notifications
  /// follow (launch step 6's sync, phase 8), since their registration carries the units. The
  /// units already in use ask nothing.
  public func setUnits(_ units: Units) async {
    guard units != self.units else { return }
    self.units = units
    environment.store.saveUnits(units)
    await refresh()
    await environment.hooks.syncAlerts(target: target, units: units)
  }

  // MARK: - What the home screen draws

  /// The time now by the model's clock, which the home screen draws the answer at with the
  /// minute tick: the system's, or in a Debug build launched on a fixture, the fixture's.
  public var now: Date { environment.clock.now }

  /// The place as the top bar names it: the place's own name (a city page's, a searched
  /// place's), else the answer's; nil while neither is known (approximate IP location before
  /// the first answer).
  public var placeName: String? {
    let own: String?
    switch target {
    case .ip: own = nil
    case .city(_, let name): own = name
    case .coords(let place): own = place.name
    }
    return [own, response?.location.name].compactMap { $0 }.first { !$0.isEmpty }
  }

  /// The top bar (`HomeTopBar`): the place, and on approximate IP location the line beneath
  /// it, which says why while there is a notice (`AppCopy.slugGone`).
  public var topBar: HomeTopBar {
    HomeTopBar(placeName: placeName, approximate: target == .ip, notice: notice)
  }

  /// The page for `view` at `now` (`HomePage`), from the answer on screen and how the last
  /// fetch went (with the server's message after a failure), with the top bar's place.
  public func page(_ view: AppView, at now: Date) -> HomePage {
    HomePage(
      response,
      view: view,
      at: now,
      phase: HomePage.Phase(phase),
      message: phase.serverMessage,
      placeName: placeName
    )
  }

  // MARK: - Fetching

  /// Fetches the answer for the place, as `fetch` says, and shows it, or what went wrong. With
  /// nothing on screen, the loading state meanwhile; otherwise the answer stays. When a newer
  /// fetch has started meanwhile, its answer wins and this one is dropped.
  private func load(_ fetch: Fetch) async {
    requests += 1
    let request = requests
    if response == nil { phase = .loading }
    let target = self.target
    let units = self.units
    let client = environment.client
    do {
      var answer = try await client.today(for: target, units: units)
      let now = environment.clock.now
      if fetch == .fresh, Freshness.outOfDate(answer, at: now, holds: holds) != nil {
        answer = try await client.today(for: target, units: units, freshAt: now)
      }
      guard request == requests else { return }
      show(answer, for: target, holding: fetch == .fresh)
    } catch {
      guard request == requests else { return }
      await failed(APIClient.failure(for: error))
    }
  }

  /// Shows `answer` for `target`, saves it as the last good answer, reloads the widgets, keeps
  /// its units when none were chosen, schedules the next refresh, and when the picker chose
  /// `target` without a name, adds it to the recent places under the answer's. The first answer
  /// shown, with no view chosen yet, opens on its view for the time of day.
  private func show(_ answer: TodayResponse, for target: Target, holding: Bool) {
    let now = environment.clock.now
    if holding { holds = Freshness.hold(holds, answer, at: now) }
    response = answer
    fetchedAt = now
    phase = .ready
    if !opened {
      shownView = MiddleDay.defaultView(answer, at: now)
      opened = true
    }
    if let unnamed = unnamedChoice {
      unnamedChoice = nil
      let name = answer.location.name
      if unnamed.key.utf8.elementsEqual(target.key.utf8), !name.isEmpty {
        keepLists(SavedPlaces.choosing(target, name: name, in: lists))
      }
    }
    if units == nil {
      units = answer.units
      environment.store.saveUnits(answer.units)
    }
    do {
      try environment.store.saveToday(SavedToday(key: target.key, savedAt: now, response: answer))
      environment.widgets.reloadAllTimelines()
    } catch {
      // Not saved: the app still shows it, and the widgets keep the answer they had.
    }
    scheduleRefresh(at: next(after: answer))
  }

  /// After a failed fetch: the phase it leaves, and when to ask again (`Refresh.retry`). A
  /// city page's place that is no longer there (404 `not_found`) is dropped for approximate IP
  /// location, which is fetched at once, and the user is told (section 4).
  private func failed(_ failure: FetchError) async {
    if case .failed(404?, "not_found"?, _) = failure, case .city = target {
      keep(.ip)
      response = nil
      fetchedAt = nil
      notice = AppCopy.slugGone
      await load(.plain)
      return
    }
    phase = AppPhase(failure)
    let now = environment.clock.now
    let retry = Refresh.retry(after: failure, response: response, at: now, jitterMs: jitter())
    if let retry {
      scheduleRefresh(at: retry)
    } else {
      cancelRefresh()
      dueOnReturn = nil
    }
  }

  /// Makes `target` the place, and keeps it.
  private func keep(_ target: Target) {
    self.target = target
    environment.store.savePlace(target)
  }

  // MARK: - The quiet refresh

  private func next(after answer: TodayResponse) -> Date {
    Refresh.next(after: answer, at: environment.clock.now, jitterMs: jitter())
  }

  private func jitter() -> Int {
    environment.random(0...Constants.Client.refreshJitterMs)
  }

  /// Asks again at `date`, quietly, replacing any refresh scheduled before; never while in the
  /// background, where it is kept for the return instead.
  private func scheduleRefresh(at date: Date) {
    cancelRefresh()
    guard awayFrom == nil else {
      dueOnReturn = date
      return
    }
    nextRefreshAt = date
    refreshWork = environment.clock.schedule(at: date) { [weak self] in
      await self?.refreshDue()
    }
  }

  private func cancelRefresh() {
    refreshWork?.cancel()
    refreshWork = nil
    nextRefreshAt = nil
  }

  private func refreshDue() async {
    refreshWork = nil
    nextRefreshAt = nil
    await refresh()
  }
}
