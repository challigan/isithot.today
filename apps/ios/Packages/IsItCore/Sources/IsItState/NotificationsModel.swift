import Foundation
import IsItLogic
import IsItModel
import Observation

/// The app's notifications (phase 8.1; iOS build spec, sections 12.1 and 12.2): the switches and
/// the place (`alerts.v1`), the permission, the push token, the server's record (`alertSync.v1`)
/// kept in step by `AlertSync` at every moment 12.2 names, the test notification, the Today card
/// (`ui.alertCard`) and the links into Settings. The system's notifications are behind
/// `NotificationPlatform` and the keys behind `NotificationStore`, so the tests run it on Linux
/// with fakes; it is the only writer of the three keys.
///
/// Nothing prompts at launch: the permission is asked for only when the first switch is turned
/// on, in Settings or by the card's "Turn on", and the location only at "Use my location". The
/// token is this launch's alone: `alertSync.v1` keeps the one the last PUT carried only to name
/// the server's record, for a DELETE or a test. The sync is single-flight: a change made while a
/// request is out is sent once it is answered, all such changes together, and a 429 is tried again
/// once, at its `Retry-After`.
@MainActor
@Observable
public final class NotificationsModel {
  /// What the views show: the keys, the permission, and what this session's taps came to.
  public private(set) var state: NotificationsState
  /// Each time a link asked for Settings → Notifications (`willitsnow://settings/notifications`,
  /// iOS Settings' link): the home screen opens Settings at each.
  public private(set) var settingsRequests = 0
  /// Each time Settings' gate asked for the picker; `pickerLocating` says which kind.
  public private(set) var pickerRequests = 0
  /// Whether the last of those asked the picker to find the phone's location ("Use my
  /// location") rather than to search.
  public private(set) var pickerLocating = false

  @ObservationIgnored private let platform: any NotificationPlatform
  @ObservationIgnored private let store: any NotificationStore
  @ObservationIgnored private let client: APIClient
  @ObservationIgnored private let location: any LocationService
  @ObservationIgnored private let clock: any AppClock
  @ObservationIgnored private let env: RegistrationBody.Env
  @ObservationIgnored private let appVersion: String
  /// The place on screen, as last given.
  @ObservationIgnored private var target: Target?
  /// The units every request asks in, as last given: nil before the first answer chose them.
  @ObservationIgnored private var units: Units?
  /// This launch's push token, once the system gave one. Never kept.
  @ObservationIgnored private var token: String?
  /// The start, once begun: whatever needs it waits for it.
  @ObservationIgnored private var starting: Task<Void, Never>?
  /// Whether the start has read and applied the permission: nothing is synced before.
  @ObservationIgnored private var started = false
  /// The sync under way, and whether another was asked for meanwhile.
  @ObservationIgnored private var syncing: Task<Void, Never>?
  @ObservationIgnored private var again = false
  /// The one retry after a 429.
  @ObservationIgnored private var retryWork: ScheduledWork?
  /// The first switch's turning on, while its prompt is out.
  @ObservationIgnored private var turningOn: Task<Bool, Never>?

  /// A model over what `store` keeps. Nothing is asked of the system until the start: the
  /// permission is `.notDetermined` until it is read.
  public init(
    platform: any NotificationPlatform,
    store: any NotificationStore,
    client: APIClient,
    location: any LocationService,
    clock: any AppClock,
    env: RegistrationBody.Env,
    appVersion: String
  ) {
    self.platform = platform
    self.store = store
    self.client = client
    self.location = location
    self.clock = clock
    self.env = env
    self.appVersion = appVersion
    state = NotificationsState(
      settings: store.loadSettings(),
      registration: store.loadRegistration(),
      cardDismissed: store.loadCardDismissed()
    )
  }

  // MARK: - The moments (12.2)

  /// Launch step 6, a place chosen in the picker, and a change of units (LiveHooks'
  /// `syncAlerts`): keeps the place on screen and its units; a place that follows the phone
  /// takes the phone's place on screen when it is in another cell; then a sync. Returns at once:
  /// the first call starts the model, in a task.
  public func screenChanged(target: Target, units: Units?) {
    self.target = target
    self.units = units
    follow(target)
    if starting == nil {
      start()
    } else {
      sync()
    }
  }

  /// The scene became active: the permission again, a registration while a switch is on and
  /// allowed, the place's own fix, and a sync (the heartbeat, a denial's DELETE, a retry).
  /// Nothing before the start.
  public func becameActive() async {
    guard let starting else { return }
    await starting.value
    await readPermission()
    registerWhileOn()
    await fixOwnPlace()
    sync()
  }

  /// The system gave this launch's token, in hex: kept for this launch only, and synced.
  public func tokenArrived(_ hex: String) {
    token = hex
    sync()
  }

  /// The system gave no token: nothing, as the next `.active` registers again. Nothing is
  /// logged.
  public func registrationFailed() {}

  /// Settings or the place page appeared: the permission again, and a sync.
  public func refreshPermission() async {
    await readPermission()
    sync()
  }

  // MARK: - Settings

  /// A switch in Settings → Notifications. The first one turned on (evening or morning while
  /// neither is) is for the place kept, else the place on screen; with neither (approximate
  /// location, nothing kept) nothing changes, as the gate shows instead. It asks for permission
  /// when it isn't allowed: the system's prompt when never asked, the answer already given when
  /// denied. Allowed, the switch turns on, the place is kept, the card goes for good, and the app
  /// registers; refused, every switch stays off and the permission reads denied. Any other
  /// change is kept and synced at once.
  public func setSwitch(_ which: AlertSwitch, on: Bool, onScreen: OnScreen) async {
    await start(from: onScreen)
    if let turningOn { _ = await turningOn.value }
    let prefs = state.settings.prefs
    guard which != .possible, on, !prefs.evening, !prefs.morning else {
      keep(AlertSync.setting(prefs, which, on: on))
      return
    }
    let place =
      state.settings.place ?? AlertSync.firstPlace(onScreen: onScreen.target, name: onScreen.name)
    guard let place else { return }
    _ = await turnOn(which, at: place)
  }

  /// A choice on the place page: the place on screen, chosen and fixed; the phone's location,
  /// followed, asking for location only now, at this tap (the system's prompt when never asked),
  /// and saying why when none comes; the kept place, kept.
  public func choosePlace(_ choice: PlaceChoice) async {
    switch choice {
    case .kept:
      return
    case .onScreen(let target, let name):
      keep(.chosen(target, name: name))
    case .myLocation:
      guard !state.locating else { return }
      state.locating = true
      state.placeProblem = await locate()
      state.locating = false
    }
  }

  /// "Send a test notification": once at a time. Without a registration it syncs first; still
  /// none, it fails without asking. A test the server has no record for forgets the
  /// registration, which is sent again while a switch is on.
  public func sendTest() async {
    await start(from: nil)
    guard state.test != .sending else { return }
    state.test = .sending
    if state.registration == nil {
      sync()
      await synced()
    }
    guard let registration = state.registration else {
      state.test = .done(.failed)
      return
    }
    let outcome = await client.testDevice(token: registration.token)
    if outcome == .notRegistered, state.registration?.token == registration.token {
      keep(registration: nil)
      sync()
    }
    state.test = .done(outcome)
  }

  /// Settings' gate asked for the picker: a search, or the phone's location when `locating`.
  public func requestPicker(locating: Bool) {
    pickerLocating = locating
    pickerRequests += 1
  }

  /// Settings closed: the test result and the place problem go. A test under way stays.
  public func dismissResults() {
    if case .done = state.test { state.test = .idle }
    state.placeProblem = nil
  }

  // MARK: - The card

  /// The card's "Turn on": the evening notification for the place on screen, always, over any
  /// kept, as the first switch turns on in Settings. The card then says it is done, this session,
  /// or that notifications are off for the app.
  public func turnOnFromCard(onScreen: OnScreen) async {
    await start(from: onScreen)
    if let turningOn { _ = await turningOn.value }
    guard let place = AlertSync.firstPlace(onScreen: onScreen.target, name: onScreen.name) else {
      return
    }
    if await turnOn(.evening, at: place) {
      state.cardTurnedOn = true
    } else {
      state.cardRefused = true
    }
  }

  /// The card's "Not now": it goes for good.
  public func dismissCard() {
    dismissCardForGood()
  }

  // MARK: - Links

  /// A link asked for Settings → Notifications.
  public func requestSettings() {
    settingsRequests += 1
  }

  /// The registration's place's zone by its `Target.key`, for the router; empty when none.
  public var zones: [String: String] {
    guard let response = state.registration?.response,
      let place = Target(query: response.place.query)
    else { return [:] }
    return [place.key: response.place.timezone]
  }

  /// Waits for the start, the sync under way and any it queued (the tests and `sendTest`). A
  /// retry scheduled is not waited for.
  public func synced() async {
    await starting?.value
    while let syncing { await syncing.value }
  }

  // MARK: - The start

  /// Starts the model once (from the first `screenChanged`, or the first Settings or card
  /// action, which may come before launch step 6), and waits for the start. `onScreen`
  /// gives the place when none was given yet, and the units while none are known, as after an
  /// offline first launch, whose step 6 had no answer to take them from.
  private func start(from onScreen: OnScreen?) async {
    if let onScreen {
      if target == nil { target = onScreen.target }
      if units == nil { units = onScreen.units }
    }
    if starting == nil { start() }
    await starting?.value
  }

  /// The start: the permission read and applied; a registration while a switch is on and
  /// allowed; the place's own fix, unless the phone's own place is on screen (launch step 4 has
  /// just fixed it, and `screenChanged` followed it); then the first sync.
  private func start() {
    starting = Task {
      await readPermission()
      started = true
      registerWhileOn()
      if !phoneOnScreen { await fixOwnPlace() }
      sync()
    }
  }

  /// Whether the place on screen is the phone's own point.
  private var phoneOnScreen: Bool {
    guard case .coords(let place)? = target else { return false }
    return place.source == .device
  }

  // MARK: - The permission and the place

  /// Reads the permission and applies it. Denied with a switch on: every switch off, the place
  /// kept, and the sync then deletes the record. Never asked with a switch on or a registration
  /// kept (only a backup restored from another phone can do that): every switch off, and the
  /// registration forgotten here only, with no request, as its token is the other phone's.
  /// Allowed, nothing: the permission coming back never turns a switch on.
  private func readPermission() async {
    let permission = await platform.permission()
    state.permission = permission
    switch permission {
    case .denied:
      if state.settings.prefs != AlertPrefs() { keep(AlertPrefs(), syncing: false) }
    case .notDetermined:
      if state.settings.prefs != AlertPrefs() { keep(AlertPrefs(), syncing: false) }
      if state.registration != nil { keep(registration: nil) }
    case .authorized, .provisional:
      break
    }
  }

  /// `registerForRemoteNotifications()`, while a switch is on and the permission allows.
  private func registerWhileOn() {
    if state.settings.anyOn, Self.allows(state.permission) { platform.register() }
  }

  /// The place's own fix: only while the place follows the phone, and only with location
  /// already allowed, never asking; one fix, which moves it to the fix's cell. A place chosen
  /// meanwhile stands.
  private func fixOwnPlace() async {
    guard case .follows = state.settings.place, await location.access() == .granted,
      case .located(let latitude, let longitude) = await location.fix()
    else { return }
    follow(.device(lat: latitude, lon: longitude))
  }

  /// A place that follows the phone, moved to `fix` when that is the phone's place in another
  /// cell (`AlertSync.following`), and kept.
  private func follow(_ fix: Target) {
    guard let moved = AlertSync.following(state.settings.place, fix: fix) else { return }
    state.settings.place = moved
    store.saveSettings(state.settings)
  }

  /// "Use my location": the problem to show, or nil once the place follows the phone.
  private func locate() async -> NotificationsState.PlaceProblem? {
    var access = await location.access()
    if access == .notDetermined { access = await location.requestAccess() }
    guard access == .granted else { return .locationDenied }
    switch await location.fix() {
    case .located(let latitude, let longitude):
      keep(.follows(.device(lat: latitude, lon: longitude)))
      return nil
    case .denied:
      return .locationDenied
    case .unavailable:
      return .locationUnavailable
    }
  }

  /// The first switch on, at `place`: asks when the permission doesn't allow it (one prompt
  /// for every tap meanwhile), and whether it was allowed.
  private func turnOn(_ which: AlertSwitch, at place: AlertPlace) async -> Bool {
    let turning = Task { () -> Bool in
      if !Self.allows(state.permission) {
        _ = await platform.requestPermission()
        await readPermission()
      }
      guard Self.allows(state.permission) else {
        state.permission = .denied
        return false
      }
      state.settings.place = place
      keep(AlertSync.setting(state.settings.prefs, which, on: true), syncing: false)
      dismissCardForGood()
      platform.register()
      sync()
      return true
    }
    turningOn = turning
    let allowed = await turning.value
    turningOn = nil
    return allowed
  }

  /// Whether the permission lets notifications be shown.
  private static func allows(_ permission: AlertSync.Permission) -> Bool {
    permission == .authorized || permission == .provisional
  }

  // MARK: - Keeping

  /// Keeps `prefs`, and syncs unless `syncing` is false.
  private func keep(_ prefs: AlertPrefs, syncing: Bool = true) {
    state.settings.prefs = prefs
    store.saveSettings(state.settings)
    if syncing { sync() }
  }

  /// Keeps `place` as the notification place, clears the place page's problem, and syncs.
  private func keep(_ place: AlertPlace) {
    state.settings.place = place
    store.saveSettings(state.settings)
    state.placeProblem = nil
    sync()
  }

  /// Keeps `registration` in `alertSync.v1`, or removes it with nil.
  private func keep(registration: AlertRegistration?) {
    state.registration = registration
    store.saveRegistration(registration)
  }

  private func dismissCardForGood() {
    state.cardDismissed = true
    store.saveCardDismissed(true)
  }

  // MARK: - The sync

  /// Syncs once the start has applied the permission: now, unless a sync is under way, which
  /// then runs once more when it ends, with whatever changed meanwhile.
  private func sync() {
    guard started else { return }
    if syncing != nil {
      again = true
      return
    }
    syncing = Task {
      repeat {
        again = false
        await syncOnce()
      } while again
      syncing = nil
    }
  }

  /// One sync (`AlertSync.action`): nothing, a DELETE with the token last sent, or a PUT with
  /// this launch's, each reply kept as it says. The retry waiting is dropped, as this is it.
  private func syncOnce() async {
    retryWork?.cancel()
    retryWork = nil
    let settings = state.settings
    let registration = state.registration
    let units = self.units ?? registration?.units
    let now = clock.now
    let action = AlertSync.action(
      prefs: settings.prefs,
      permission: state.permission,
      token: token,
      place: settings.place?.target,
      units: units ?? .c,
      last: registration?.sent,
      now: now,
      env: env,
      appVersion: appVersion
    )
    switch action {
    case .none, .needsPlace, .needsToken:
      state.status = .ok
    case .delete:
      guard let registration else { return }
      deleted(await client.forgetDevice(token: registration.token))
    case .put:
      // The units come with the first answer: a later `screenChanged` brings them, as does
      // Settings' or the card's place on screen.
      guard let units, let token, let place = settings.place?.target,
        let body = AlertSync.body(
          token: token, env: env, place: place, units: units, prefs: settings.prefs,
          appVersion: appVersion)
      else { return }
      let fingerprint = AlertSync.fingerprint(body)
      switch await client.registerDevice(body) {
      case .stored(let response):
        keep(
          registration: AlertRegistration(
            fingerprint: fingerprint, at: Date(epochMs: now.epochMs), token: token, env: env,
            units: units, response: response))
        state.status = .ok
      case .forgotten:
        keep(registration: nil)
        state.status = .ok
      case .retry(let seconds):
        retry(after: seconds)
      case .placeRefused(let message):
        state.status = .placeRefused(message)
      case .failed:
        // A change the server didn't take says so; a heartbeat alone says nothing.
        let same = registration.map { $0.fingerprint.utf8.elementsEqual(fingerprint.utf8) }
        if same != true { state.status = .notSaved }
      }
    }
  }

  /// A DELETE's reply: forgotten (the server answers so whether or not it held one), a retry,
  /// or a change not saved.
  private func deleted(_ reply: AlertSync.SyncReply) {
    switch reply {
    case .forgotten, .stored:
      keep(registration: nil)
      state.status = .ok
    case .retry(let seconds):
      retry(after: seconds)
    case .placeRefused, .failed:
      state.status = .notSaved
    }
  }

  /// One sync again `seconds` from now, on the model's clock.
  private func retry(after seconds: Int) {
    let due = clock.now.addingTimeInterval(TimeInterval(seconds))
    retryWork = clock.schedule(at: due) { [weak self] in
      self?.retryWork = nil
      self?.sync()
    }
  }
}
