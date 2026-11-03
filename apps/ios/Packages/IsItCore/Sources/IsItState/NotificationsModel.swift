import Foundation
import IsItLogic
import IsItModel
import Observation

/// The app's notifications (phases 8.1 and 8.4a; iOS build spec, sections 12.1 and 12.2; design
/// 4.6): the switches and the phone's last cell (`alerts.v2`), the permission, location access,
/// where you are, the push token, the server's set (`alertSync.v2`) kept in step by `AlertSync` at
/// every moment 12.2 names, the test notification, the Today card (`ui.alertCard`) and the links
/// into Settings. The system's notifications are behind `NotificationPlatform`, the phone's
/// location behind `LocationService` and the keys behind `NotificationStore`, so the tests run it
/// on Linux with fakes; it is the only writer of the three keys.
///
/// Where you are, the free notification's place, is never a place chosen on screen
/// (`AlertSync.here`): the phone's cell while location access is allowed and the app has a fix
/// (this launch's, or the cell kept from an earlier one), otherwise approximate, which the server
/// finds from the registration's own connection. A fix is taken at the start and on each return
/// to the app, only while access is allowed, never asking, and when the screen shows a point of
/// the phone's in another cell than where you are (the picker's "Use my location", or an older
/// point: a recent place's, a notification's), which is never a fix itself: the model's own fix
/// decides. Every sync asked for while a fix is out waits for it, so a PUT never carries where
/// you are from before it (the token registering brings, a heartbeat or a refresh due).
///
/// Nothing prompts at launch: the permission is asked for only when the first switch is turned
/// on, in Settings or by the card's "Turn on", and the location only at "Use my location". The
/// token is this launch's alone: `alertSync.v2` keeps the one the last PUT carried only to name
/// the server's set, for a DELETE or a test. The sync is single-flight: a change made while a
/// request is out is sent once it is answered, all such changes together, and a 429 is tried again
/// once, at its `Retry-After`. While where you are is approximate, the set is sent again on
/// becoming active an hour after the last (`AlertSync.action`); a set the server couldn't place
/// waits until it changes or the app becomes active again.
@MainActor
@Observable
public final class NotificationsModel {
  /// What the views show: the keys, the permission, location access, where you are, and what this
  /// session's taps came to.
  public private(set) var state: NotificationsState
  /// Each time a link asked for Settings → Notifications (`willitsnow://settings/notifications`,
  /// iOS Settings' link): the home screen opens Settings at each.
  public private(set) var settingsRequests = 0
  /// Each time Settings asked for the picker; `pickerLocating` says which kind.
  public private(set) var pickerRequests = 0
  /// Whether the last of those asked the picker to find the phone's location rather than to
  /// search.
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
  /// This launch's fix of the phone's location (a device point), while access is allowed: the
  /// model's own, at the start, a return, "Use my location", or for a point of the phone's on
  /// screen. Never kept as it is: `alerts.v2` keeps its cell.
  @ObservationIgnored private var fix: Target?
  /// The fix under way that every sync waits for (`fixFirst`): nil when none is.
  @ObservationIgnored private var fixing: Task<Void, Never>?
  /// Whether location access has been read: until then the cell kept is left as it is.
  @ObservationIgnored private var locationRead = false
  /// When the app last became active: the start, then each return (the hourly refresh, and the
  /// refused set's wait).
  @ObservationIgnored private var activeAt = Date(epochMs: 0)
  /// The set the server last refused (400 `bad_location`), and when: until it stores one, or
  /// every switch goes off.
  @ObservationIgnored private var refused: AlertSync.Sent?
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
  /// permission and location access are `.notDetermined` until they are read, and where you are
  /// approximate.
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

  /// Launch step 6, a place chosen in the picker or under "Nearby:", a city gone for approximate
  /// location, and a change of units (LiveHooks' `syncAlerts`): keeps the place on screen and its
  /// units, and whether the screen shows where you are (the card's only screen); a point of the
  /// phone's on screen in another cell than where you are is no fix itself, but asks for one
  /// (location access read again first, as the picker may just have been allowed it), which
  /// decides; then a sync, which waits for that fix. Returns at once: the first call starts the
  /// model, in a task.
  public func screenChanged(target: Target, units: Units?) {
    self.target = target
    self.units = units
    showHere()
    if starting == nil {
      start()
      return
    }
    if started, phoneElsewhereOnScreen { _ = fixFirst(readingAccess: true) }
    sync()
  }

  /// The scene became active: the permission and location access again, a fix while location
  /// is allowed, a registration while a switch is on and allowed, and a sync (the heartbeat, the
  /// hourly refresh while approximate, a denial's DELETE, a retry), which waits for the fix, as
  /// the one the registration's token brings does. Nothing before the start.
  public func becameActive() async {
    guard let starting else { return }
    await starting.value
    activeAt = clock.now
    await readPermission()
    await readLocation()
    let fixed = fixFirst()
    registerWhileOn()
    await fixed.value
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

  /// Settings or the "Where you are" page appeared: the permission and location access again,
  /// read and never asked, and a sync.
  public func refreshPermission() async {
    await readPermission()
    await readLocation()
    sync()
  }

  // MARK: - Settings

  /// A switch in Settings → Notifications. The first one turned on (evening or morning while
  /// neither is) is for where you are, which is always a place: it asks for permission when it
  /// isn't allowed, the system's prompt when never asked, the answer already given when denied.
  /// Allowed, the switch turns on, the card goes for good, and the app registers; refused, every
  /// switch stays off and the permission reads denied. Any other change is kept and synced at
  /// once.
  public func setSwitch(_ which: AlertSwitch, on: Bool) async {
    await ensureStarted()
    if let turningOn { _ = await turningOn.value }
    let prefs = state.settings.prefs
    guard which != .possible, on, !prefs.evening, !prefs.morning else {
      keep(AlertSync.setting(prefs, which, on: on))
      return
    }
    _ = await turnOn(which)
  }

  /// "Use my location" on the "Where you are" page: asks for location only now, at this tap
  /// (the system's prompt when never asked), then one fix, which where you are takes. Says so
  /// when no fix comes though access is allowed; denied, the page shows "Open Settings".
  public func useMyLocation() async {
    guard !state.locating else { return }
    state.locating = true
    state.locationUnavailable = false
    var access = await location.access()
    if access == .notDetermined { access = await location.requestAccess() }
    apply(access)
    if access == .granted {
      switch await location.fix() {
      case .located(let latitude, let longitude):
        fix = .device(lat: latitude, lon: longitude)
        placeHere()
      case .denied:
        apply(.denied)
      case .unavailable:
        state.locationUnavailable = true
      }
    }
    state.locating = false
    sync()
  }

  /// "Send a test notification": once at a time. Without a registration it syncs first; still
  /// none, it fails without asking. A test the server has no record for forgets the
  /// registration, which is sent again while a switch is on.
  public func sendTest() async {
    await ensureStarted()
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

  /// Settings asked for the picker: a search, or the phone's location when `locating`.
  public func requestPicker(locating: Bool) {
    pickerLocating = locating
    pickerRequests += 1
  }

  /// Settings closed: the test result, "Use my location"'s no-fix line and the delete's line go.
  /// A test or a delete under way stays.
  public func dismissResults() {
    if case .done = state.test { state.test = .idle }
    state.locationUnavailable = false
    if state.delete == .done || state.delete == .notYet { state.delete = .idle }
  }

  // MARK: - The card

  /// The card's "Turn on": the evening notification for where you are, as the first switch turns
  /// on in Settings. The card then says it is done, this session, or that notifications are off
  /// for the app.
  public func turnOnFromCard() async {
    await ensureStarted()
    if let turningOn { _ = await turningOn.value }
    if await turnOn(.evening) {
      state.cardTurnedOn = true
    } else {
      state.cardRefused = true
    }
  }

  /// The card's "Not now": it goes for good.
  public func dismissCard() {
    dismissCardForGood()
  }

  // MARK: - Your privacy (8.2)

  /// "Turn off notifications and delete my data": every switch off, the phone's cell forgotten
  /// (the next fix brings it back while location is allowed), the card put away (one this
  /// session's "Turn on" made say it was done too), and the server's set deleted with the token
  /// last sent. Done once it is deleted; not yet when the delete didn't reach the server, which a
  /// later sync then does, making it done. No confirmation: turning notifications on again undoes
  /// it.
  public func deleteMyData() async {
    await ensureStarted()
    state.delete = .deleting
    state.settings = AlertSettings()
    store.saveSettings(state.settings)
    fix = nil
    placeHere()
    dismissCardForGood()
    state.cardTurnedOn = false
    sync()
    await synced()
    state.delete = state.registration == nil ? .done : .notYet
  }

  // MARK: - Links

  /// A link asked for Settings → Notifications.
  public func requestSettings() {
    settingsRequests += 1
  }

  /// Each place's zone in the server's set by its `Target.key` (`AlertSync.replyZones`), for the
  /// router: where you are's, and each saved place's; empty when none is kept.
  public var zones: [String: String] {
    state.registration.map { AlertSync.replyZones($0.response) } ?? [:]
  }

  /// Waits for the start, the fix under way, the sync under way and any it queued (the tests,
  /// `sendTest` and `deleteMyData`). A retry scheduled is not waited for.
  public func synced() async {
    await starting?.value
    await fixing?.value
    while let syncing { await syncing.value }
  }

  // MARK: - The start

  /// Starts the model once (from the first `screenChanged`, or the first Settings, card or
  /// privacy action, which may come before launch step 6), and waits for the start.
  private func ensureStarted() async {
    if starting == nil { start() }
    await starting?.value
  }

  /// The start, the launch's becoming active: the permission and location access read and
  /// applied; a fix while location is allowed, unless the screen shows the phone's point in
  /// where you are's own cell (launch step 4 has just fixed it, and it is the cell kept); a
  /// registration while a switch is on and allowed; then the first sync, which waits for the
  /// fix, as the one the registration's token brings does.
  private func start() {
    activeAt = clock.now
    starting = Task {
      await readPermission()
      await readLocation()
      started = true
      let fixed = phoneHereOnScreen ? nil : fixFirst()
      registerWhileOn()
      await fixed?.value
      sync()
    }
  }

  /// Whether the place on screen is a point of the phone's in where you are's own cell.
  private var phoneHereOnScreen: Bool {
    guard let target, case .coords(let place) = target, place.source == .device else {
      return false
    }
    return NotificationCard.showsHere(target, here: state.here.place)
  }

  /// Whether the place on screen is a point of the phone's in another cell than where you are:
  /// one the picker's "Use my location" has just found, or an older one (a recent place's, a
  /// notification's), which only a fix can tell apart.
  private var phoneElsewhereOnScreen: Bool {
    guard case .coords(let place)? = target, place.source == .device else { return false }
    return !phoneHereOnScreen
  }

  /// Whether the screen shows where you are, for the card (`NotificationCard.showsHere`): kept
  /// in step with the place on screen and with where you are.
  private func showHere() {
    let shows = target.map { NotificationCard.showsHere($0, here: state.here.place) } ?? false
    if state.showsHere != shows { state.showsHere = shows }
  }

  /// One fix while location access is allowed (`locateHere`), with location access read again
  /// first when `readingAccess`, in a task that every sync asked for until it is in waits for
  /// (`sync`), so no PUT carries where you are from before it. One at a time: asked for while
  /// one is out, it is that one.
  private func fixFirst(readingAccess: Bool = false) -> Task<Void, Never> {
    if let fixing { return fixing }
    let fixed = Task {
      if readingAccess { await readLocation() }
      await locateHere()
      fixing = nil
    }
    fixing = fixed
    return fixed
  }

  // MARK: - The permission and where you are

  /// Reads the permission and applies it. Denied with a switch on: every switch off, and the
  /// sync then deletes the set. Never asked with a switch on or a registration kept (only a
  /// backup restored from another phone can do that): every switch off, and the registration
  /// forgotten here only, with no request, as its token is the other phone's. Allowed, nothing:
  /// the permission coming back never turns a switch on.
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

  /// Reads location access, never asking, and applies it.
  private func readLocation() async {
    apply(await location.access())
  }

  /// Location access as read or answered: kept for the views, and where you are worked out
  /// again. Not allowed, this launch's fix goes, and with it the cell kept: where you are is
  /// approximate.
  private func apply(_ access: LocationAccess) {
    locationRead = true
    switch access {
    case .granted:
      state.locationAccess = .granted
    case .denied:
      state.locationAccess = .denied
      fix = nil
    case .notDetermined:
      state.locationAccess = .notDetermined
      fix = nil
    }
    placeHere()
  }

  /// One fix while location access is allowed, never asking, which where you are takes. A fix
  /// that finds access gone applies that; none, nothing changes.
  private func locateHere() async {
    guard state.locationAccess == .granted else { return }
    switch await location.fix() {
    case .located(let latitude, let longitude):
      fix = .device(lat: latitude, lon: longitude)
      placeHere()
    case .denied:
      apply(.denied)
    case .unavailable:
      break
    }
  }

  /// Where you are (`AlertSync.here`) from location access, this launch's fix and the cell kept,
  /// and whether the screen shows it; `alerts.v2` keeps its cell, and nothing while approximate,
  /// once location access has been read.
  private func placeHere() {
    let place = AlertSync.here(access: state.locationAccess, fix: fix, kept: state.settings.here)
    state.here.place = place
    showHere()
    guard locationRead, state.settings.here != place.cell else { return }
    state.settings.here = place.cell
    store.saveSettings(state.settings)
  }

  /// The first switch on, for where you are: asks when the permission doesn't allow it (one
  /// prompt for every tap meanwhile), and whether it was allowed.
  private func turnOn(_ which: AlertSwitch) async -> Bool {
    let turning = Task { () -> Bool in
      if !Self.allows(state.permission) {
        _ = await platform.requestPermission()
        await readPermission()
      }
      guard Self.allows(state.permission) else {
        state.permission = .denied
        return false
      }
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

  /// Keeps `registration` in `alertSync.v2`, or removes it with nil.
  private func keep(registration: AlertRegistration?) {
    state.registration = registration
    store.saveRegistration(registration)
  }

  private func dismissCardForGood() {
    state.cardDismissed = true
    store.saveCardDismissed(true)
  }

  // MARK: - The sync

  /// Syncs once the start has applied the permission: now, or once the fix under way is in
  /// (`fixFirst`), unless a sync is under way, which then runs once more when it ends, with
  /// whatever changed meanwhile.
  private func sync() {
    guard started else { return }
    if syncing != nil {
      again = true
      return
    }
    syncing = Task {
      repeat {
        again = false
        await fixing?.value
        await syncOnce()
      } while again
      syncing = nil
    }
  }

  /// One sync (`AlertSync.action`): nothing, a DELETE with the token last sent, or a PUT of the
  /// set (where you are, and no saved place) with this launch's, each reply kept as it says. The
  /// retry waiting is dropped, as this is it.
  private func syncOnce() async {
    retryWork?.cancel()
    retryWork = nil
    let settings = state.settings
    let here = state.here.place
    let registration = state.registration
    let units = self.units ?? registration?.units
    let action = AlertSync.action(
      prefs: settings.prefs,
      permission: state.permission,
      token: token,
      here: here,
      units: units ?? .c,
      last: registration?.sent,
      refused: refused,
      activeAt: activeAt,
      now: clock.now,
      env: env,
      appVersion: appVersion
    )
    switch action {
    case .none, .needsToken:
      // With every switch off there is no set, so none waits: turned on again, it is sent.
      // Otherwise the server's words for a set it couldn't place stay while that set waits.
      if !settings.anyOn {
        refused = nil
        state.here.refused = false
      }
      if refused == nil { state.status = .ok }
    case .delete:
      guard let registration else { return }
      deleted(await client.forgetDevice(token: registration.token))
    case .put:
      // The units come with the first answer: a later `screenChanged` brings them.
      guard let units, let token else { return }
      let body = AlertSync.body(
        token: token, env: env, here: here, units: units, prefs: settings.prefs,
        appVersion: appVersion)
      let fingerprint = AlertSync.fingerprint(body)
      let sentAt = clock.now
      switch await client.registerDevice(body) {
      case .stored(let response):
        refused = nil
        state.here.refused = false
        keep(
          registration: AlertRegistration(
            fingerprint: fingerprint, at: Date(epochMs: sentAt.epochMs), token: token, env: env,
            units: units, response: response))
        state.status = .ok
      case .forgotten:
        keep(registration: nil)
        state.status = .ok
      case .retry(let seconds):
        retry(after: seconds)
      case .placeRefused(let message):
        // The server couldn't tell where you are, and has forgotten the set: so does the
        // phone, keeping the switches; the same set waits (`AlertSync.action`).
        refused = AlertSync.Sent(fingerprint: fingerprint, at: Date(epochMs: clock.now.epochMs))
        state.here.refused = true
        keep(registration: nil)
        state.status = .placeRefused(message)
      case .failed:
        // A change the server didn't take says so; a heartbeat or a refresh alone says nothing.
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
      if state.delete == .notYet { state.delete = .done }
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
