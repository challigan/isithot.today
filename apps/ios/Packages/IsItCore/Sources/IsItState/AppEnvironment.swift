import Foundation
import IsItLogic
import IsItModel

/// What `AppModel` works with (iOS build spec, section 9.4), each behind a protocol so that the
/// tests, on Linux, give it fakes: the API, the clock, what is stored, the widgets, the phone's
/// location, the recent and saved places, the later phases' steps, and the random jitter.
public struct AppEnvironment: Sendable {
  public var client: APIClient
  /// The time the answers are shown at, and the refreshes', retries' and holds' work at a time.
  public var clock: any AppClock
  /// Short waits that count time passing but no moment shown: the picker's pause after typing
  /// (`Constants.Search.debounceMs`). The model's clock unless given, as in the app; a Debug
  /// build under `-clock fixed`, whose `FixedClock` never runs later work, gives the system's,
  /// so the picker still searches.
  public var waits: any AppClock
  public var store: any StoredState
  public var widgets: any WidgetReloader
  /// The phone's location: launch step 4's fix for "My location", and the picker's "Use my
  /// location" (phase 6).
  public var location: any LocationService
  /// The picker's recent places, `recent.v1` (phase 6).
  public var recents: any RecentStore
  /// The picker's saved places, `savedPlaces.v1` (the website's look, step 4).
  public var saved: any SavedPlaceStore
  public var hooks: any AppHooks
  /// A random whole number in the range: the refreshes' jitter.
  public var random: @Sendable (ClosedRange<Int>) -> Int

  public init(
    client: APIClient,
    clock: any AppClock = SystemClock(),
    waits: (any AppClock)? = nil,
    store: any StoredState,
    widgets: any WidgetReloader,
    location: any LocationService = NoLocation(),
    recents: any RecentStore = MemoryRecents(),
    saved: any SavedPlaceStore = MemorySavedPlaces(),
    hooks: any AppHooks = NoHooks(),
    random: @escaping @Sendable (ClosedRange<Int>) -> Int = { Int.random(in: $0) }
  ) {
    self.client = client
    self.clock = clock
    self.waits = waits ?? clock
    self.store = store
    self.widgets = widgets
    self.location = location
    self.recents = recents
    self.saved = saved
    self.hooks = hooks
    self.random = random
  }
}

/// The time, and work to do at a time: `SystemClock` in the app, a clock the tests move.
public protocol AppClock: Sendable {
  /// The time now.
  var now: Date { get }
  /// Runs `work` at `date`, or at once when it has passed, unless cancelled first.
  func schedule(at date: Date, _ work: @escaping @MainActor @Sendable () async -> Void)
    -> ScheduledWork
}

/// Work an `AppClock` will do, until cancelled.
public struct ScheduledWork: Sendable {
  private let onCancel: @Sendable () -> Void

  public init(cancel: @escaping @Sendable () -> Void) {
    onCancel = cancel
  }

  /// Stops the work, if it hasn't started.
  public func cancel() {
    onCancel()
  }
}

/// The system's clock. The app cancels what it scheduled when it goes to the background, and
/// decides again when it comes back, so a wait never has to outlast the phone's sleep.
public struct SystemClock: AppClock {
  /// How far this clock is ahead of the system's, seconds (behind when negative): none in the
  /// app. A Debug build launched on a fixture runs from the fixture's moment
  /// (`init(startingAt:)`), so the fixture shows what it was made for on any day.
  public let offset: TimeInterval

  public init() {
    offset = 0
  }

  /// A clock that reads `start` now and runs on from there, as the system's does.
  public init(startingAt start: Date) {
    offset = start.timeIntervalSinceNow
  }

  public var now: Date { Date().addingTimeInterval(offset) }

  public func schedule(at date: Date, _ work: @escaping @MainActor @Sendable () async -> Void)
    -> ScheduledWork
  {
    let task = Task { @MainActor [offset] in
      // Counted on this clock, which may run apart from the system's.
      let wait = date.timeIntervalSinceNow - offset
      if wait > 0 {
        do {
          try await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
        } catch {
          return
        }
      }
      guard !Task.isCancelled else { return }
      await work()
    }
    return ScheduledWork { task.cancel() }
  }
}

/// What the app keeps between launches (iOS build spec, section 9.6): in the App Group, the
/// place (`place.v1`), the units (`units.v1`), the purchase (`unlock.v1`, read only here:
/// `PurchaseModel` writes it, through `UnlockStore`) and the last good answer (`today.v1.json`).
/// `SharedStore` (IsItServices) in the app; `MemoryState` without an App Group, and in the tests.
public protocol StoredState: Sendable {
  /// The chosen place, or approximate IP location when there is none.
  func loadPlace() -> Target
  /// Keeps `target` as the chosen place; approximate IP location is kept as none.
  func savePlace(_ target: Target)
  /// The units, or nil before the first answer chose them.
  func loadUnits() -> Units?
  func saveUnits(_ units: Units)
  /// Whether the purchase is owned, as `PurchaseModel` last wrote it.
  func loadUnlocked() -> Bool
  /// The last good answer, or nil (none, unreadable, or another store version's).
  func loadToday() -> SavedToday?
  /// Keeps `saved` as the last good answer, replacing the one before.
  func saveToday(_ saved: SavedToday) throws
}

/// The picker's recent places (`recent.v1`, in the app's own defaults: iOS build spec, section
/// 9.6), the last five chosen. `RecentDefaults` (IsItServices) in the app.
public protocol RecentStore: Sendable {
  /// The list kept, newest first (`RecentPlaces.list(stored:)` reads it).
  func loadRecents() -> [RecentPlace]
  /// Keeps `list`, replacing the one before.
  func saveRecents(_ list: [RecentPlace])
}

/// Recent places kept in memory only: the tests', and a build's without its own defaults.
public final class MemoryRecents: RecentStore, @unchecked Sendable {
  private let lock = NSLock()
  private var list: [RecentPlace]

  public init(_ list: [RecentPlace] = []) {
    self.list = list
  }

  public func loadRecents() -> [RecentPlace] { lock.withLock { list } }

  public func saveRecents(_ list: [RecentPlace]) { lock.withLock { self.list = list } }
}

/// The picker's saved places (`savedPlaces.v1`, in the app's own defaults beside `recent.v1`),
/// at most ten, in the order saved. `SavedPlaceDefaults` (IsItServices) in the app. Not the App
/// Group: no widget reads them, as the widget follows the place on screen.
public protocol SavedPlaceStore: Sendable {
  /// The list kept, in the order saved (`SavedPlaces.list(stored:)` reads it).
  func loadSavedPlaces() -> [SavedPlace]
  /// Keeps `list`, replacing the one before.
  func saveSavedPlaces(_ list: [SavedPlace])
}

/// Saved places kept in memory only: the tests', and a build's without its own defaults.
public final class MemorySavedPlaces: SavedPlaceStore, @unchecked Sendable {
  private let lock = NSLock()
  private var list: [SavedPlace]

  public init(_ list: [SavedPlace] = []) {
    self.list = list
  }

  public func loadSavedPlaces() -> [SavedPlace] { lock.withLock { list } }

  public func saveSavedPlaces(_ list: [SavedPlace]) { lock.withLock { self.list = list } }
}

/// Tells the widgets that the saved answer changed: WidgetKit's `reloadAllTimelines` in the app.
public protocol WidgetReloader: Sendable {
  func reloadAllTimelines()
}

/// The launch's steps that later phases fill (iOS build spec, section 9.4). `NoHooks` does
/// nothing for each until then. Step 4's location fix is no hook: phase 6 filled it, with
/// `LocationService`.
public protocol AppHooks: Sendable {
  /// Step 2 (phase 7, StoreKit): starts `Transaction.updates` and the entitlement check, and
  /// returns at once (`PurchaseModel.start()`).
  func startEntitlementCheck()
  /// Step 5 (phase 7): once the check has finished, whether the purchase is owned
  /// (`PurchaseModel.launchEntitlement()`); nil keeps what `unlock.v1` says.
  func entitlement() async -> Bool?
  /// Step 5 (phase 8): consent, then Mobile Ads, then the banner. Called only when not unlocked.
  func startAds() async
  /// Phase 7: the purchase became owned while the app runs: the ads stop for good this launch.
  func stopAds() async
  /// Step 6 (phase 8): when a notification switch is on, registration and `AlertSync`. Also
  /// called when the picker chooses a place (section 10.3), so a notification place that
  /// follows the device's location follows it; a chosen notification place never follows
  /// browsing, which `AlertSync` decides.
  func syncAlerts(target: Target, units: Units?) async
  /// Step 7 (phases 6 and 8): a notification tap, a widget or a deep link.
  func handle(_ route: DeepLink.Route) async
}

/// The later phases' steps, before those phases: each does nothing.
public struct NoHooks: AppHooks {
  public init() {}

  /// Phase 7 starts StoreKit here.
  public func startEntitlementCheck() {}

  /// Phase 7 answers from StoreKit; until then `unlock.v1` stands.
  public func entitlement() async -> Bool? { nil }

  /// Phase 8 starts consent and the ads.
  public func startAds() async {}

  /// Phase 7 stops the ads here.
  public func stopAds() async {}

  /// Phase 8 syncs the notifications.
  public func syncAlerts(target: Target, units: Units?) async {}

  /// Phases 6 and 8 route.
  public func handle(_ route: DeepLink.Route) async {}
}

/// What is stored, kept in memory only: for a build that can't open its App Group (nothing is
/// kept between launches, and the widgets see nothing), and for previews.
public final class MemoryState: StoredState, @unchecked Sendable {
  private let lock = NSLock()
  private var place: Target
  private var units: Units?
  private let unlocked: Bool
  private var today: SavedToday?

  public init(
    place: Target = .ip,
    units: Units? = nil,
    unlocked: Bool = false,
    today: SavedToday? = nil
  ) {
    self.place = place
    self.units = units
    self.unlocked = unlocked
    self.today = today
  }

  public func loadPlace() -> Target { lock.withLock { place } }

  public func savePlace(_ target: Target) { lock.withLock { place = target } }

  public func loadUnits() -> Units? { lock.withLock { units } }

  public func saveUnits(_ units: Units) { lock.withLock { self.units = units } }

  public func loadUnlocked() -> Bool { unlocked }

  public func loadToday() -> SavedToday? { lock.withLock { today } }

  public func saveToday(_ saved: SavedToday) throws { lock.withLock { today = saved } }
}
