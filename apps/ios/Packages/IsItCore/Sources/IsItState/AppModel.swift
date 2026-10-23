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
  /// Whether the purchase is owned: `unlock.v1`, then StoreKit's check (phase 7).
  public private(set) var unlocked: Bool
  /// The view on screen. The launch and a return after a long time away set it to the view for
  /// the time of day (`MiddleDay.defaultView`); the pager sets it as the user moves.
  public var view: AppView
  /// A line to tell the user once, until `dismissNotice()`: `AppCopy.slugGone`, say.
  public private(set) var notice: String?
  /// A route waiting for the launch to finish (step 7).
  public private(set) var route: DeepLink.Route?
  /// When the next quiet refresh is due, or nil when none is (in the background, say).
  public private(set) var nextRefreshAt: Date?
  /// The picker's recent places (`recent.v1`), newest first: the last five chosen there.
  public private(set) var recents: [RecentPlace]

  @ObservationIgnored private let environment: AppEnvironment
  /// The launch's fetch (step 3), decided with the paint in `init`.
  @ObservationIgnored private let launchFetch: Fetch?
  @ObservationIgnored private var launched = false
  @ObservationIgnored private var launchFinished = false
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
    view = MiddleDay.defaultView(plan.paint?.response, at: now)
    recents = environment.recents.loadRecents()
  }

  // MARK: - What the views call

  /// Steps 2 to 7 of the launch, once. Step 2 starts the entitlement check (phase 7); step 3
  /// fetches, unless the saved answer is recent (`Launch.reuses`), then saves the answer,
  /// writes the App Group and reloads the widgets; step 4, for "My location", takes one
  /// location fix when permission is already granted, never asking (`fixMoved(from:)`), and
  /// fetches again only when the place's 0.05° cell changed and the place is still the one the
  /// fix was for, so a place chosen meanwhile stands; step 5 starts the ads once the check has
  /// finished, only when not unlocked (phase 8); step 6 syncs the notifications (phase 8); step
  /// 7 handles a pending route (phases 6 and 8).
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
    if let owned = await hooks.entitlement() { unlocked = owned }
    if !unlocked { await hooks.startAds() }
    await hooks.syncAlerts(target: target, units: units)
    launchFinished = true
    if let pending = route {
      route = nil
      await hooks.handle(pending)
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
    if back.resetView { view = MiddleDay.defaultView(response, at: now) }
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
    await environment.hooks.handle(route)
  }

  /// The user has read the notice.
  public func dismissNotice() {
    notice = nil
  }

  // MARK: - The place picker

  /// A picker over this model (section 10.3), with the model's client and clock: the sheet makes
  /// one each time it opens.
  public func makePicker() -> PlacePickerModel {
    PlacePickerModel(app: self, client: environment.client, clock: environment.clock)
  }

  /// Chooses `target` as the place, as the picker does (section 10.3): it is kept in
  /// `place.v1`, loaded in place (`select(_:)`, which saves it for the widgets and reloads them),
  /// and joins the recent places, under `name`, at once; a place without one (the device's)
  /// joins them under its answer's name when the answer arrives. Then the notifications are
  /// synced (phase 8's `syncAlerts`), as a notification place that follows the device's
  /// location may have moved. The place on screen again only asks again.
  public func choose(_ target: Target, name: String?) async {
    if let name, !name.isEmpty {
      unnamedChoice = nil
      saveRecents(RecentPlaces.adding(target, name: name, to: recents))
    } else {
      unnamedChoice = target
    }
    await select(target)
    await environment.hooks.syncAlerts(target: self.target, units: units)
  }

  /// Takes `place` off the recent places (a swipe in the picker).
  public func removeRecent(_ place: RecentPlace) {
    saveRecents(RecentPlaces.removing(place.target, from: recents))
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

  // MARK: - Loading a place

  /// Loads the answer for `target` in place, as a place under "Nearby:" does (section 10.2):
  /// it becomes the place, kept in `place.v1`, and the page shows the loading state for it
  /// until its own answer arrives, never the last place's answer under its name; a failure then
  /// shows as it would with nothing saved. The notice, about the last place, goes. The place on
  /// screen again only asks again (`refresh()`).
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
  /// `target` without a name, adds it to the recent places under the answer's.
  private func show(_ answer: TodayResponse, for target: Target, holding: Bool) {
    let now = environment.clock.now
    if holding { holds = Freshness.hold(holds, answer, at: now) }
    let first = response == nil
    response = answer
    fetchedAt = now
    phase = .ready
    if first { view = MiddleDay.defaultView(answer, at: now) }
    if let unnamed = unnamedChoice {
      unnamedChoice = nil
      let name = answer.location.name
      if unnamed.key.utf8.elementsEqual(target.key.utf8), !name.isEmpty {
        saveRecents(RecentPlaces.adding(target, name: name, to: recents))
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
