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
  }

  // MARK: - What the views call

  /// Steps 2 to 7 of the launch, once. Step 2 starts the entitlement check (phase 7); step 3
  /// fetches, unless the saved answer is recent (`Launch.reuses`), then saves the answer,
  /// writes the App Group and reloads the widgets; step 4 takes a location fix for "My
  /// location" (phase 6), and fetches again only when the place's cell changed; step 5 starts
  /// the ads once the check has finished, only when not unlocked (phase 8); step 6 syncs the
  /// notifications (phase 8); step 7 handles a pending route (phases 6 and 8).
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
    if case .coords(let place) = target, place.source == .device,
      let moved = await hooks.locate(target), !moved.key.utf8.elementsEqual(target.key.utf8)
    {
      choose(moved)
      await load(.plain)
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

  /// The app went to the background: nothing is fetched until it comes back.
  public func didEnterBackground() {
    awayFrom = environment.clock.now
    cancelRefresh()
  }

  /// The app came back from the background (`Refresh.foreground`): after more than 30 minutes
  /// away, back to the view for the time of day; a fetch when the answer is old, out of date,
  /// past its hours or missing; otherwise the next quiet refresh is scheduled again. Does
  /// nothing unless the app was in the background, or before the launch.
  public func willEnterForeground() async {
    guard let away = awayFrom else { return }
    awayFrom = nil
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
      scheduleRefresh(at: next(after: response))
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
  /// its units when none were chosen, and schedules the next refresh.
  private func show(_ answer: TodayResponse, for target: Target, holding: Bool) {
    let now = environment.clock.now
    if holding { holds = Freshness.hold(holds, answer, at: now) }
    let first = response == nil
    response = answer
    fetchedAt = now
    phase = .ready
    if first { view = MiddleDay.defaultView(answer, at: now) }
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
      choose(.ip)
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
    }
  }

  /// Makes `target` the place, and keeps it.
  private func choose(_ target: Target) {
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
  /// background.
  private func scheduleRefresh(at date: Date) {
    cancelRefresh()
    guard awayFrom == nil else { return }
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
