import Foundation
import IsItAds
import IsItLogic
import IsItModel
import IsItNotifications
import IsItServices
import IsItState
import IsItUI
import Observation
import StoreKit
import SwiftUI
import UIKit
import os

/// Every test and debug hook in the app (iOS build spec, section 9.8), here and nowhere else.
/// A Release build compiles none of them: there each one is a stub that does nothing and names
/// no launch argument, and the fixtures aren't in its bundle (`EXCLUDED_SOURCE_FILE_NAMES`).
/// Phase 8.1's hooks stand in for the system's notifications (`-notifications`, `-pushToken`),
/// the devices calls (`-devices`), the card's being put away under `-uitest` (`-alertCard`), the
/// place a test launches on (`-place`) and a notification's tap (`-route`); phase 8.4a's
/// `-location ask:<lat>,<lon>` stands in for location access asked for at a tap.
@MainActor
enum DebugHooks {
  #if DEBUG
    /// When the App Group can't open, keep the last answer in the app's own container (V1), so a
    /// Debug build signed without the entitlement still works on its own.
    static let storeFallback = true

    /// The launch arguments that change how the app starts, before the model reads `store`:
    /// `-uitest` turns UIKit's animations off and counts the touches the system cancels, for
    /// `debug-cancels` (`TouchWatch`). It leaves SwiftUI's own animations and transitions running,
    /// which `setAnimationsEnabled(_:)` doesn't reach: the home screen's background still fades
    /// from one band's colours to the next, which `debug-theme` reads (`themeReadout`).
    /// `-resetStore` forgets the place, the units, the saved answer, the recent and saved places,
    /// when the last full-screen ad showed, and the notifications' switches and the phone's cell
    /// for where you are, their registration and the card's being put away (`alerts.v2`,
    /// `alertSync.v2`, `ui.alertCard`), for a first launch. It leaves `unlock.v1` alone, which
    /// only `PurchaseModel` writes, and which nothing reads under StoreKit's stand-in
    /// (`standsInForStoreKit`), as every UI test runs. Then `-place <query>` keeps that place
    /// (`Target(query:)`, a city's or a searched place's) as the one to launch on; a query that is
    /// no place, or approximate location's, stops the app.
    static func prepare(
      store: SharedStore?,
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) {
      if arguments.contains("-uitest") {
        UIView.setAnimationsEnabled(false)
        TouchWatch.install()
      }
      if arguments.contains("-resetStore") {
        RecentDefaults().removeAll()
        SavedPlaceDefaults().removeAll()
        AdDefaults().removeAll()
        NotificationDefaults().removeAll()
      }
      if arguments.contains("-resetStore"), let store {
        store.savePlace(.ip)
        store.defaults.removeObject(forKey: Keys.AppGroup.units)
        do {
          try store.removeToday()
        } catch {
          fatalError("-resetStore: the saved answer can't be removed: \(error)")
        }
      }
      if let query = value(after: "-place", in: arguments) {
        guard let target = Target(query: query), target != .ip else {
          fatalError("-place: \(query) isn't a place's query")
        }
        guard let store else { fatalError("-place: there is no store to keep \(query) in") }
        store.savePlace(target)
      }
    }

    /// The server the app asks instead of willitsnow.today's, from the fixtures `pnpm
    /// mobile:generate` wrote (packages/mobile), which only Debug builds bundle:
    ///
    /// - `-fixture <name>` answers every request for an answer with that fixture, as if fetched
    ///   now, after forgetting the saved answer, so the launch fetches the fixture rather than
    ///   painting what an earlier launch saved; the fixture is then saved, for the widget, as any
    ///   answer is. The picker's searches are answered as `-network` answers them (`SearchStub`).
    /// - `-network <name>[,<name>…]` leaves the app's own transport, URLSession and section 4's
    ///   settings in place and stubs the network beneath them (`URLProtocolStub`): it answers
    ///   the request for approximate IP location with the first fixture, a request for another
    ///   fixture's own place with that fixture, the picker's search for a search fixture's text
    ///   with that search fixture (`Fixtures/Search`), and any other request with an error.
    ///   Nothing is forgotten, so a launch paints and reuses what was saved, as it does for real.
    ///   `-network off` has no connection at all; `-network unavailable` answers every request
    ///   as the server does when the forecasts can't be had (503 `upstream_unavailable`).
    ///
    /// Under either, the notifications' devices calls are answered from `Fixtures/Devices` as
    /// `-devices` says (`DevicesStub`).
    ///
    /// A name with no fixture, or one that doesn't decode, stops the app, so a UI test can't pass
    /// on the wrong screen. Nil, for willitsnow.today, without either.
    static func transport(
      forgetting store: SharedStore?,
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> (any HTTPTransport)? {
      if let name = value(after: "-fixture", in: arguments) {
        let data = answerData(name)
        try? store?.removeToday()
        return FixtureTransport(body: data, searches: SearchStub(), devices: DevicesStub.shared)
      }
      guard value(after: "-network", in: arguments) != nil else { return nil }
      // Read now, on the main thread, so a bad name stops the launch rather than a request.
      _ = URLProtocolStub.server
      _ = DevicesStub.shared
      let configuration = URLSessionTransport.configuration()
      configuration.protocolClasses = [URLProtocolStub.self]
      return URLSessionTransport(session: URLSession(configuration: configuration))
    }

    /// The model's clock: from `-now <iso>` when given, else from the moment of the fixture
    /// `-fixture` names, or the first `-network` names (`_fixture.now`), so a fixture launched
    /// on any day shows the state it was made for (the hour picked, Tomorrow from 6pm at the
    /// place, no recent forecast). `-clock run`, the default, runs on from there; `-clock fixed`
    /// stays at that moment (from the launch's own without either), so a UI test reads the
    /// screen its moment shows and nothing falls due meanwhile (`FixedClock`): no quiet
    /// refresh, no retry. The picker's pause after typing is timed apart, by `waits()`, so it
    /// still searches. Nil, for the system's clock, without any of them.
    static func clock(arguments: [String] = ProcessInfo.processInfo.arguments) -> (any AppClock)? {
      let mode = value(after: "-clock", in: arguments)
      if let mode, mode != "fixed", mode != "run" {
        fatalError("-clock: \(mode) isn't fixed or run")
      }
      let start: Date?
      if let text = value(after: "-now", in: arguments) {
        guard let moment = ApiJSON.parseDate(text) else {
          fatalError("-now: \(text) isn't an ISO 8601 moment")
        }
        start = moment
      } else {
        let network = value(after: "-network", in: arguments).flatMap {
          StubServer.modes.contains($0) ? nil : StubServer.fixtureNames($0).first
        }
        start = (value(after: "-fixture", in: arguments) ?? network).map { fixtureMoment($0) }
      }
      if mode == "fixed" { return FixedClock(at: start ?? Date()) }
      return start.map { SystemClock(startingAt: $0) }
    }

    /// The clock for short waits, which count time passing and show no moment
    /// (`AppEnvironment.waits`: the picker's pause after typing). Under `-clock fixed`, whose
    /// clock never runs work due later, the system's, so a picker test at a fixed moment still
    /// searches; nil, for the model's clock, otherwise.
    static func waits(arguments: [String] = ProcessInfo.processInfo.arguments) -> (any AppClock)? {
      value(after: "-clock", in: arguments) == "fixed" ? SystemClock() : nil
    }

    /// The phone's location without Core Location, so a UI test never sees the system's prompt
    /// (`-location <lat>,<lon>|ask:<lat>,<lon>|denied|unavailable`): permission given and a fix
    /// at those coordinates; permission never asked until something asks for it (the "Where you
    /// are" page's "Use my location", or the picker's), which the stand-in allows, and then a fix
    /// at those coordinates (`AskingLocation`); permission off; or permission given and no fix. A
    /// value that is none of these stops the app. Nil, for Core Location, without it.
    static func location(
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> (any LocationService)? {
      guard let text = value(after: "-location", in: arguments) else { return nil }
      switch text {
      case "denied":
        return FixedLocation(permission: .denied, answer: .denied)
      case "unavailable":
        return FixedLocation(permission: .granted, answer: .unavailable)
      default:
        let asks = text.hasPrefix(askPrefix)
        let point = asks ? String(text.dropFirst(askPrefix.count)) : text
        let parts = point.split(separator: ",").compactMap { Double(String($0)) }
        guard parts.count == 2, abs(parts[0]) <= 90, abs(parts[1]) <= 180 else {
          fatalError("-location: \(text) isn't <lat>,<lon>, ask:<lat>,<lon>, denied or unavailable")
        }
        let fix = LocationFix.located(latitude: parts[0], longitude: parts[1])
        return asks ? AskingLocation(answer: fix) : FixedLocation(permission: .granted, answer: fix)
      }
    }

    /// What begins `-location`'s value when the permission is to be asked for first.
    private static let askPrefix = "ask:"

    /// `-apiOrigin <url>`: a deploy preview's API instead of willitsnow.today's (section 4).
    static func apiOrigin(arguments: [String] = ProcessInfo.processInfo.arguments) -> URL? {
      value(after: "-apiOrigin", in: arguments).flatMap { URL(string: $0) }
    }

    /// `-noads 1`: the free version's ads never start (`LiveHooks`), so a UI test's screens are
    /// the app's own, and nothing it does reaches Google, whose SDKs the stubbed network never
    /// covers: no consent form, no band under the pages, no box at their ends, no full-screen
    /// ad. Any other value stops the app.
    static func noAds(arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool {
      guard let value = value(after: "-noads", in: arguments) else { return false }
      guard value == "1" else { fatalError("-noads: \(value) isn't 1") }
      return true
    }

    /// The ads model as AdsTests read it (`AdsReadout`), over the home screen: how far the ads have
    /// come, whether a full-screen ad is loaded and how many have shown, so a test that sees no ad
    /// can tell Google's silence from the app's own failure. Nothing at all under `-noads 1`, so
    /// every other UI test's tree, and so its audits, is as it was.
    @ViewBuilder
    static func adsReadout(
      _ ads: AdsModel,
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> some View {
      if !noAds(arguments: arguments) {
        AdsReadout(ads: ads)
      }
    }

    /// The place picker as the app holds it (`PickerReadout`), over the home screen, for every UI
    /// test (`-uitest`), with the ads or without: whether the home screen has the picker `open`,
    /// and once it hasn't, whether the picker's content has left the screen, so PickerTests and
    /// AdsTests read the picker closed from the app, not from XCUITest's tree, which on PR #38's
    /// and #39's macOS runs went on finding a closed picker's search box for 10 and 15 seconds
    /// (DECISIONS, "Ads in the iPhone app: three placements"); and how many touches the system
    /// has cancelled (`TouchWatch`), by which the UI tests' gestures know one the simulator
    /// cancelled. Nothing without `-uitest`.
    @ViewBuilder
    static func pickerReadout(
      open: Bool,
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> some View {
      if arguments.contains("-uitest") {
        PickerReadout(open: open)
      }
    }

    /// The picker's content came on screen (`PickerSheet`'s `onAppear`), for `pickerReadout`.
    static func pickerAppeared() {
      DebugPresence.shared.pickerOnScreen = true
      DebugPresence.shared.pickersShown += 1
    }

    /// The picker's content left the screen (`PickerSheet`'s `onDisappear`), for `pickerReadout`.
    static func pickerDisappeared() {
      DebugPresence.shared.pickerOnScreen = false
    }

    /// The home screen's colours as the UI tests read them (`ThemeReadout`), at the top of the
    /// home screen, for every UI test (`-uitest`): `debug-theme`, the band of the page on screen
    /// (`band`, or "none" without one) once every fade the background has begun is over and the
    /// last was to that page's `theme`, and "fading" until then. A tab tap or an answer brings the
    /// new page's heading at once, and the background takes 0.9 s more to fade to its colours
    /// (`HomeShell`), so a test that read the words and took a screenshot caught the fade on PR
    /// #45's run (DECISIONS, "What PR #45's first macOS run showed"). Nothing without `-uitest`.
    @ViewBuilder
    static func themeReadout(
      band: SnowBand?,
      theme: PageTheme,
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> some View {
      if arguments.contains("-uitest") {
        ThemeReadout(band: band, theme: theme)
      }
    }

    /// What `HomeShell` tells as its background begins fading to a theme, and what it hands back
    /// to be called once that fade is over, for `themeReadout`, under `-uitest`; nil otherwise, so
    /// the shell adds nothing to the fade. Each is kept (`ThemeFades`) on the main actor, where
    /// the readout reads them, after the update the fade begins in, whose state is SwiftUI's and
    /// not to be changed then, and whatever thread the completion comes on: the main actor runs
    /// them in the order they come, so a fade's end is never kept before its beginning.
    static func themeFades(
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> ((PageTheme) -> () -> Void)? {
      guard arguments.contains("-uitest") else { return nil }
      return { theme in
        Task { @MainActor in DebugPresence.shared.fades.began(to: theme) }
        return { Task { @MainActor in DebugPresence.shared.fades.ended() } }
      }
    }

    /// `-unlocked 0|1`: whether the purchase is owned, whatever `unlock.v1` says, so a UI test
    /// launches the free version or the paid one; nil without it. It stands in for StoreKit's
    /// answers too (`purchases(arguments:)`), so the launch's check gives the same answer rather
    /// than the simulator's. Any other value stops the app.
    static func unlocked(arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool? {
      guard let value = value(after: "-unlocked", in: arguments) else { return nil }
      switch value {
      case "0": return false
      case "1": return true
      default: fatalError("-unlocked: \(value) is neither 0 nor 1")
      }
    }

    /// The store the model reads: under StoreKit's stand-in, `store` with the purchase as
    /// `-unlocked` says, or not owned without it (`UnlockedState`), from the model's first look
    /// at it, whatever an earlier launch left in `unlock.v1`; `store` itself otherwise.
    static func store(
      _ store: any StoredState,
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> any StoredState {
      guard standsInForStoreKit(arguments: arguments) else { return store }
      return UnlockedState(store: store, unlocked: unlocked(arguments: arguments) ?? false)
    }

    /// Whether a launch argument asks for StoreKit's stand-in (`FakePurchases`): every UI test
    /// (`-uitest`), and `-unlocked`, `-purchase` and `-restore`. XCUITest can't buy against
    /// Snow.storekit: on the runner's iOS 26.5 simulator StoreKit Test doesn't connect to its
    /// test environment (FB22500243, which Apple lists as fixed from iOS 26.6, a runtime the
    /// runner doesn't have), FB22237318 was still reported on 26.5 though its release notes list
    /// it fixed, and the confirmation sheet is the system's. An app that asked the App Store from
    /// a UI test would show what that store says, or a sign-in. Under it nothing writes
    /// `unlock.v1`.
    static func standsInForStoreKit(
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> Bool {
      ["-uitest", "-unlocked", "-purchase", "-restore"].contains { arguments.contains($0) }
    }

    /// What Buy comes to under StoreKit's stand-in (`-purchase`).
    enum PurchaseOutcome: String, CaseIterable {
      /// Bought and verified: owned from then on.
      case bought
      /// Ask to Buy: waiting for a parent, who never answers in a UI test.
      case pending
      case cancelled
      /// No connection, in the system's own words (`URLError(.notConnectedToInternet)`).
      case failed
      /// Bought, but StoreKit's check of it failed (`invalidSignature`, in StoreKit's words), so
      /// not owned.
      case unverified
    }

    /// What Restore purchase comes to under StoreKit's stand-in (`-restore`).
    enum RestoreOutcome: String, CaseIterable {
      /// The App Store holds the purchase: owned from then on.
      case found
      /// Synced, and nothing owned.
      case nothing = "none"
      /// The sign-in cancelled.
      case cancelled
      /// No connection, in the system's own words.
      case failed
    }

    /// StoreKit's stand-in, or nil for StoreKit:
    /// - the purchase is owned as `-unlocked 0|1` says, false without it;
    /// - the product is for sale at `Constants.Purchase.displayPrice`, with Family Sharing, under
    ///   `-purchase` or `-restore`; otherwise the App Store has none (`.unavailable`), so every
    ///   older UI test's home screens are as they were (no home row), and Settings shows the
    ///   upgrade row without a price and Restore purchase;
    /// - `-purchase bought|pending|cancelled|failed|unverified`: what Buy comes to (`bought` by
    ///   default); `failed` is `URLError(.notConnectedToInternet)`'s own words, `unverified` a
    ///   fact whose failure is the words of
    ///   `VerificationResult<Transaction>.VerificationError.invalidSignature`;
    /// - `-restore found|none|cancelled|failed`: what Restore purchase comes to (`none` by
    ///   default); `found` makes it owned, and `failed` is the same words as Buy's.
    /// Any other value stops the app.
    static func purchases(
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> (any PurchasePlatform)? {
      guard standsInForStoreKit(arguments: arguments) else { return nil }
      return FakePurchases(
        owned: unlocked(arguments: arguments) ?? false,
        forSale: arguments.contains("-purchase") || arguments.contains("-restore"),
        buy: outcome("-purchase", in: arguments, otherwise: PurchaseOutcome.bought),
        restore: outcome("-restore", in: arguments, otherwise: RestoreOutcome.nothing)
      )
    }

    /// `unlock.v1` for StoreKit's stand-in: in memory, holding `-unlocked`'s answer, so a UI
    /// test never writes the App Group's; nil, for the App Group, without the stand-in.
    static func unlockStore(
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> (any UnlockStore)? {
      guard standsInForStoreKit(arguments: arguments) else { return nil }
      let unlock = unlocked(arguments: arguments).map {
        StoredUnlock(unlocked: $0, checkedAt: Date(), productID: Constants.Purchase.productID)
      }
      return MemoryUnlockStore(unlock)
    }

    /// The outcome `flag` names in `arguments`, or `otherwise` without the flag. A value that
    /// names none, or none at all, stops the app.
    private static func outcome<Outcome: RawRepresentable & CaseIterable>(
      _ flag: String,
      in arguments: [String],
      otherwise: Outcome
    ) -> Outcome where Outcome.RawValue == String {
      guard arguments.contains(flag) else { return otherwise }
      let text = value(after: flag, in: arguments) ?? ""
      guard let outcome = Outcome(rawValue: text) else {
        let names = Outcome.allCases.map(\.rawValue).joined(separator: ", ")
        fatalError("\(flag): \(text) isn't one of \(names)")
      }
      return outcome
    }

    /// `-umpGeography eea|other`: where UMP takes the phone to be, so a UI test meets the
    /// consent form (the EEA) or none (a region with no regulation in force) wherever it runs,
    /// UMP forgetting its kept answer at each such launch (`GoogleAds`). Nil, for where the phone
    /// is, without it; any other value stops the app.
    static func umpGeography(
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> ConsentGeography? {
      guard let value = value(after: "-umpGeography", in: arguments) else { return nil }
      switch value {
      case "eea": return .eea
      case "other": return .other
      default: fatalError("-umpGeography: \(value) is neither eea nor other")
      }
    }

    /// What `-notifications` stands in for: the permission not yet asked, with the prompt
    /// allowing (`allow`, the default) or refusing (`deny`); that state from the start
    /// (`authorized`, `denied`, `provisional`); or the real centre's (`system`).
    enum NotificationsMode: String, CaseIterable {
      case allow
      case deny
      case authorized
      case denied
      case provisional
      case system
    }

    /// What the stand-in's registration gives (`-pushToken`): a token in hex, nothing (as some
    /// devices give), or the failure.
    enum PushTokenAnswer {
      case token(String)
      case nothing
      case failure
    }

    /// Whether a launch argument asks for the notifications' stand-in (`FakeNotifications`):
    /// every UI test (`-uitest`), and `-notifications` and `-pushToken`. Under it the real
    /// centre is asked nothing, nor given its delegate, unless `-notifications system`, so no UI
    /// test leaves a permission behind but the one that means to.
    static func standsInForNotifications(
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> Bool {
      ["-uitest", "-notifications", "-pushToken"].contains { arguments.contains($0) }
    }

    /// The notifications' stand-in, or nil for the system's (`UserNotificationsPlatform`):
    /// - `-notifications allow|deny|authorized|denied|provisional|system`, the permission
    ///   (`allow` by default): asked from not determined, the prompt's answer is kept; `system`
    ///   asks the real centre, for NotificationPermissionTests and the banner step only;
    /// - `-pushToken <hex>|none|fail`, what registering gives: that token (by default
    ///   `Fixtures/Devices/put-here-ip.json`'s, so the devices stub knows it, and no real token
    ///   is in the app or a test), no token, or the failure.
    /// Any other value stops the app.
    static func notifications(
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> (any NotificationPlatform)? {
      guard standsInForNotifications(arguments: arguments) else { return nil }
      return FakeNotifications(
        mode: outcome("-notifications", in: arguments, otherwise: NotificationsMode.allow),
        token: pushToken(arguments: arguments)
      )
    }

    /// Whether the app delegate gives the real centre its delegate: always but under the
    /// notifications' stand-in, where only `-notifications system` does (the banner step's
    /// `simctl push` needs the app's `willPresent`).
    static func usesNotificationCenter(
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> Bool {
      guard standsInForNotifications(arguments: arguments) else { return true }
      return value(after: "-notifications", in: arguments) == NotificationsMode.system.rawValue
    }

    /// `-pushToken`'s answer: put-here-ip's token without it. Hex is lowercase and 64 to 200
    /// digits, as the server takes; any other value stops the app.
    private static func pushToken(arguments: [String]) -> PushTokenAnswer {
      guard let text = value(after: "-pushToken", in: arguments) else {
        return .token(devicesFixture("put-here-ip", body: TokenBody.self).note.body.token)
      }
      switch text {
      case "none": return .nothing
      case "fail": return .failure
      default:
        guard (64...200).contains(text.count), text.allSatisfy({ hexDigits.contains($0) }) else {
          fatalError("-pushToken: \(text) isn't hex, none or fail")
        }
        return .token(text)
      }
    }

    /// The digits of a token in hex.
    private static let hexDigits = Set("0123456789abcdef")

    /// The store the notifications keep their keys in: under `-uitest` the card reads as put away
    /// (`CardHidden`) unless `-alertCard shown`, so every older UI test's home screens, and so
    /// their audits, are as they were; `store` itself otherwise. Any other value stops the app.
    static func notificationStore(
      _ store: NotificationDefaults,
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> any NotificationStore {
      if let shown = value(after: "-alertCard", in: arguments) {
        guard shown == "shown" else { fatalError("-alertCard: \(shown) isn't shown") }
        return store
      }
      return arguments.contains("-uitest") ? CardHidden(store: store) : store
    }

    /// `-route <name>`: the payload `Fixtures/Payloads/<name>.json` holds, the server's own
    /// (`alertPush()`), which the app posts to its inbox as a tap that launched it; nil without
    /// it. A name with no payload stops the app.
    static func route(arguments: [String] = ProcessInfo.processInfo.arguments) -> Data? {
      guard let name = value(after: "-route", in: arguments) else { return nil }
      guard
        let url = Bundle.main.url(
          forResource: name, withExtension: "json", subdirectory: "Fixtures/Payloads"),
        let data = try? Data(contentsOf: url)
      else { fatalError("The app has no Fixtures/Payloads/\(name).json") }
      return data
    }

    /// A notification's tap whose payload routes nowhere: one line in the Debug log, which holds
    /// none of the payload (section 12.3). The app opens as usual.
    static func unrouted() {
      Logger(subsystem: Bundle.main.bundleIdentifier ?? "", category: "notifications")
        .debug("A notification's payload routes nowhere.")
    }

    /// A devices fixture (`Fixtures/Devices/<name>.json`), its request's body read as `Body`. A
    /// name with no fixture, or one that doesn't decode, stops the app.
    fileprivate nonisolated static func devicesFixture<Body: Decodable>(
      _ name: String, body: Body.Type
    ) -> DevicesFixture<Body> {
      guard
        let url = Bundle.main.url(
          forResource: name, withExtension: "json", subdirectory: "Fixtures/Devices"),
        let data = try? Data(contentsOf: url),
        let fixture = try? JSONDecoder().decode(DevicesFixture<Body>.self, from: data)
      else { fatalError("Fixtures/Devices/\(name).json is missing or doesn't decode") }
      return fixture
    }

    /// What `-openURLs` asks for: Settings records each web page and email it would open, on
    /// screen (`debugRecorder()`), instead of leaving the app; with `nomail` it also refuses
    /// every email, as a phone with no mail app does, so the fallback sheet shows.
    enum OpenURLs: String {
      case record
      case nomail
    }

    /// `-openURLs record|nomail`, for SettingsTests; nil without it, when links open as they do
    /// for real. Any other value stops the app, so a test can't pass on the wrong screen.
    nonisolated static func openURLs(
      arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> OpenURLs? {
      guard let mode = value(after: "-openURLs", in: arguments) else { return nil }
      guard let known = OpenURLs(rawValue: mode) else {
        fatalError("-openURLs: \(mode) is neither record nor nomail")
      }
      return known
    }

    /// Whether the glyphs keep still, their flakes never drifting (section 10.2): in a test
    /// launched at a set moment (`-now`), whose screens are compared as they are, and in every UI
    /// test (`-uitest`), whose screens are attached.
    static func stillMotion(arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool {
      arguments.contains("-now") || arguments.contains("-uitest")
    }

    /// Whether the app launches (`AppModel.launch()`): not while it only hosts the unit tests,
    /// which own the App Group meanwhile (the hosted tests run in the app's process, with
    /// XCTest's configuration in its environment), unless it was launched on a stubbed server.
    nonisolated static func launches(
      arguments: [String] = ProcessInfo.processInfo.arguments,
      environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Bool {
      environment["XCTestConfigurationFilePath"] == nil || arguments.contains("-fixture")
        || arguments.contains("-network")
    }

    /// The argument after `flag`, if there is one.
    fileprivate nonisolated static func value(after flag: String, in arguments: [String])
      -> String?
    {
      guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1)
      else { return nil }
      return arguments[index + 1]
    }

    /// Every search fixture (`Fixtures/Search`), by its query ("q=Leeds"), each checked to
    /// decode; none without the folder, when every search is answered 404.
    fileprivate nonisolated static func searchAnswers() -> [String: Data] {
      let folder = Bundle.main.url(forResource: "Fixtures", withExtension: nil)?
        .appendingPathComponent("Search", isDirectory: true)
      let urls = folder.flatMap {
        try? FileManager.default.contentsOfDirectory(at: $0, includingPropertiesForKeys: nil)
      }
      var answers: [String: Data] = [:]
      for url in (urls ?? []) where url.pathExtension == "json" {
        guard let data = try? Data(contentsOf: url),
          let note = try? JSONDecoder().decode(FixtureNote.self, from: data),
          (try? SearchResponse.decode(from: data)) != nil
        else { fatalError("Fixtures/Search/\(url.lastPathComponent) doesn't decode") }
        answers[note.note.query] = data
      }
      return answers
    }

    /// The query a fixture was asked with (`_fixture.query`).
    fileprivate nonisolated static func fixtureQuery(_ name: String) -> String {
      guard let fixture = try? JSONDecoder().decode(FixtureNote.self, from: fixtureData(name))
      else { fatalError("\(name).json has no query") }
      return fixture.note.query
    }

    /// The fixture's answer, as the server sent it, checked to decode.
    fileprivate nonisolated static func answerData(_ name: String) -> Data {
      let data = fixtureData(name)
      do {
        _ = try TodayResponse.decode(from: data)
      } catch {
        fatalError("\(name).json doesn't decode: \(error)")
      }
      return data
    }

    /// The moment the fixture was made for (`_fixture.now`).
    private static func fixtureMoment(_ name: String) -> Date {
      guard
        let fixture = try? JSONDecoder().decode(FixtureNote.self, from: fixtureData(name)),
        let moment = ApiJSON.parseDate(fixture.note.now)
      else { fatalError("\(name).json has no moment") }
      return moment
    }

    /// The fixture's file, from the copy only Debug builds bundle. A name with no fixture stops
    /// the app.
    private nonisolated static func fixtureData(_ name: String) -> Data {
      guard
        let url = Bundle.main.url(
          forResource: name,
          withExtension: "json",
          subdirectory: "Fixtures"
        ),
        let data = try? Data(contentsOf: url)
      else { fatalError("The app has no Fixtures/\(name).json") }
      return data
    }
  #else
    static let storeFallback = false

    static func prepare(store: SharedStore?) {}

    static func transport(forgetting store: SharedStore?) -> (any HTTPTransport)? { nil }

    static func clock() -> (any AppClock)? { nil }

    static func waits() -> (any AppClock)? { nil }

    static func apiOrigin() -> URL? { nil }

    static func noAds() -> Bool { false }

    static func adsReadout(_ ads: AdsModel) -> some View { EmptyView() }

    static func pickerReadout(open: Bool) -> some View { EmptyView() }

    static func pickerAppeared() {}

    static func pickerDisappeared() {}

    static func themeReadout(band: SnowBand?, theme: PageTheme) -> some View { EmptyView() }

    static func themeFades() -> ((PageTheme) -> () -> Void)? { nil }

    static func store(_ store: any StoredState) -> any StoredState { store }

    static func purchases() -> (any PurchasePlatform)? { nil }

    static func unlockStore() -> (any UnlockStore)? { nil }

    static func umpGeography() -> ConsentGeography? { nil }

    static func stillMotion() -> Bool { false }

    nonisolated static func launches() -> Bool { true }

    static func location() -> (any LocationService)? { nil }

    static func notifications() -> (any NotificationPlatform)? { nil }

    static func usesNotificationCenter() -> Bool { true }

    static func notificationStore(_ store: NotificationDefaults) -> any NotificationStore { store }

    static func route() -> Data? { nil }

    static func unrouted() {}
  #endif
}

#if DEBUG
  /// `-fixture`'s server: every request for an answer answered with the same fixture, with
  /// status 200, and the picker's searches as `-network` answers them. The units each request
  /// asked in are noted for the recorder (`DebugRecorder`). The devices calls are answered as
  /// `-devices` says (`DevicesStub`), and not noted: they ask in no units.
  private struct FixtureTransport: HTTPTransport {
    let body: Data
    let searches: SearchStub
    let devices: DevicesStub

    func get(_ request: HTTPRequest) async throws -> HTTPResponse {
      DebugRecorder.requested(request.url)
      if let found = searches.reply(to: request.url) {
        return HTTPResponse(status: found.status, body: found.body)
      }
      return HTTPResponse(status: 200, body: body)
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
      switch devices.reply(method: request.method.rawValue, url: request.url, body: request.body) {
      case .failure(let code):
        throw URLError(code)
      case .answer(let status, let body, let retryAfter):
        return HTTPResponse(status: status, body: body, retryAfter: retryAfter)
      }
    }
  }

  /// The picker's searches, under `-fixture` and `-network` alike: `GET /api/v1/search` with a
  /// search fixture's query gets that fixture (`Fixtures/Search`), and any other search a 404
  /// with no body.
  private struct SearchStub {
    /// The search fixtures, by their queries.
    let answers = DebugHooks.searchAnswers()

    /// The reply to `url` when it is a search; nil for any other request.
    func reply(to url: URL) -> (status: Int, body: Data)? {
      guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
        components.path == "/api/v1/search"
      else { return nil }
      guard let found = answers[components.percentEncodedQuery ?? ""] else {
        return (404, Data())
      }
      return (200, found)
    }
  }

  /// `-network`'s server, as `URLProtocolStub` answers.
  private struct StubServer {
    enum Reply {
      case failure(URLError.Code)
      case answer(status: Int, body: Data)
    }

    /// What `-network` names: no connection, the server failing, or its fixtures.
    enum Mode {
      case off
      case unavailable
      /// The fixture it answers the request for approximate IP location with, and the others,
      /// each for its own place (`place(_:)`).
      case fixtures(ip: Data, places: [String: Data])
    }

    /// The names `-network` takes that aren't a fixture's.
    static let modes: Set<String> = ["off", "unavailable"]

    let mode: Mode
    /// The picker's searches.
    let searches = SearchStub()

    /// The server `-network` names in `arguments`, or nil without it.
    init?(arguments: [String]) {
      guard let name = DebugHooks.value(after: "-network", in: arguments) else { return nil }
      switch name {
      case "off": mode = .off
      case "unavailable": mode = .unavailable
      default:
        let names = Self.fixtureNames(name)
        guard let first = names.first else { fatalError("-network: \(name) names no fixture") }
        var places: [String: Data] = [:]
        for other in names.dropFirst() {
          guard let target = Target(query: DebugHooks.fixtureQuery(other)) else {
            fatalError("-network: \(other).json asks for no place")
          }
          places[Self.place(target)] = DebugHooks.answerData(other)
        }
        mode = .fixtures(ip: DebugHooks.answerData(first), places: places)
      }
    }

    /// The fixtures `-network <name>[,<name>…]` names, in order: the first for approximate IP
    /// location.
    static func fixtureNames(_ value: String) -> [String] {
      value.split(separator: ",").map(String.init)
    }

    /// A place as the stub tells places apart: a city by its slug, coordinates by their point
    /// on the grid, whoever's they are (a device's fix is answered as a search for the same
    /// point would be, as the server's forecast is the same).
    static func place(_ target: Target) -> String {
      switch target {
      case .ip: "ip"
      case .city(let slug, _): "city:\(slug)"
      case .coords(let point): "point:\(point.lat),\(point.lon)"
      }
    }

    /// No connection for `-network off`. For `-network unavailable`, every request answered as
    /// the server answers when the forecasts can't be had: 503, with its `upstream_unavailable`
    /// error and core's message for it. Otherwise, for `GET /api/v1/today` with `ahead=snow`:
    /// the first fixture for approximate IP location (`units` once they are known, or `t` past
    /// the caches, but no place), and another fixture for its own place; for `GET
    /// /api/v1/search`, the search fixture asked with the same query. A 404 for another path or
    /// search, and a 400 for any other request, both with no body, so a request for the wrong
    /// place shows the error, never an answer.
    func reply(to request: URLRequest) -> Reply {
      let fixture: Data
      let places: [String: Data]
      switch mode {
      case .off:
        return .failure(.notConnectedToInternet)
      case .unavailable:
        let code = "upstream_unavailable"
        let error = ApiError(code: code, message: CoreCopy.errorMessage(code: code) ?? "")
        return .answer(status: 503, body: (try? JSONEncoder().encode(error)) ?? Data())
      case .fixtures(let ip, let others):
        fixture = ip
        places = others
      }
      guard request.httpMethod == "GET", let url = request.url,
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
      else { return .answer(status: 404, body: Data()) }
      if let found = searches.reply(to: url) {
        return .answer(status: found.status, body: found.body)
      }
      let query = components.percentEncodedQuery ?? ""
      guard components.path == "/api/v1/today" else { return .answer(status: 404, body: Data()) }
      let items = components.queryItems ?? []
      let names = Set(items.map(\.name))
      let ahead = items.first { $0.name == "ahead" }?.value
      guard ahead == "snow" else { return .answer(status: 400, body: Data()) }
      if names.isSubset(of: ["ahead", "units", "t"]) {
        return .answer(status: 200, body: fixture)
      }
      guard let target = Target(query: query), let answer = places[Self.place(target)] else {
        return .answer(status: 400, body: Data())
      }
      return .answer(status: 200, body: answer)
    }
  }

  /// The store under StoreKit's stand-in: whether the purchase is owned as `-unlocked` says (not
  /// owned without it), and everything else as `store` keeps it.
  private struct UnlockedState: StoredState {
    let store: any StoredState
    let unlocked: Bool

    func loadPlace() -> Target { store.loadPlace() }

    func savePlace(_ target: Target) { store.savePlace(target) }

    func loadUnits() -> Units? { store.loadUnits() }

    func saveUnits(_ units: Units) { store.saveUnits(units) }

    func loadUnlocked() -> Bool { unlocked }

    func loadToday() -> SavedToday? { store.loadToday() }

    func saveToday(_ saved: SavedToday) throws { try store.saveToday(saved) }
  }

  /// StoreKit's stand-in (`DebugHooks.purchases`), for the UI tests: it answers at once, from the
  /// launch arguments alone, and never asks the App Store. Nothing comes through
  /// `Transaction.updates` (no Ask to Buy approval comes in a UI test), and finishing does
  /// nothing. Its one transaction is the product's, verified unless `-purchase unverified` says
  /// StoreKit's check failed. Each answer the arguments name is a lowercase word, and each
  /// failure the system's or StoreKit's own words, so none of it is copy.
  @MainActor
  private final class FakePurchases: PurchasePlatform {
    /// Whether the purchase is owned: as `-unlocked` says, then as Buy or Restore purchase makes
    /// it.
    private var owned: Bool
    /// Whether the App Store has the product for sale.
    private let forSale: Bool
    private let bought: DebugHooks.PurchaseOutcome
    private let restored: DebugHooks.RestoreOutcome

    init(
      owned: Bool,
      forSale: Bool,
      buy: DebugHooks.PurchaseOutcome,
      restore: DebugHooks.RestoreOutcome
    ) {
      self.owned = owned
      self.forSale = forSale
      bought = buy
      restored = restore
    }

    func listen(_ heard: @escaping @MainActor (PurchaseFact) async -> Void) {}

    func entitlements() async -> [PurchaseFact] {
      owned ? [Self.fact(failure: nil)] : []
    }

    func product(_ id: String) async -> PurchaseState.Product {
      guard forSale else { return .unavailable }
      return .ready(price: Constants.Purchase.displayPrice, familyShareable: true)
    }

    func buy(_ id: String) async -> BuyResult {
      switch bought {
      case .bought:
        owned = true
        return .completed(Self.fact(failure: nil))
      case .pending:
        return .pending
      case .cancelled:
        return .cancelled
      case .failed:
        return .failed(Self.offline)
      case .unverified:
        let error = VerificationResult<StoreKit.Transaction>.VerificationError.invalidSignature
        return .completed(Self.fact(failure: error.localizedDescription))
      }
    }

    func finish(_ transactionID: UInt64) async {}

    func sync() async -> SyncResult {
      switch restored {
      case .found:
        owned = true
        return .synced
      case .nothing:
        return .synced
      case .cancelled:
        return .cancelled
      case .failed:
        return .failed(Self.offline)
      }
    }

    /// The product's one transaction: verified, unless `failure` is StoreKit's words for its
    /// check.
    private static func fact(failure: String?) -> PurchaseFact {
      PurchaseFact(
        transactionID: 1,
        productID: Constants.Purchase.productID,
        verificationFailure: failure,
        revoked: false,
        familyShared: false
      )
    }

    /// A failure's words: no connection, as the system says it.
    private static var offline: String {
      URLError(.notConnectedToInternet).localizedDescription
    }
  }

  /// `-location`'s stand-in for Core Location: permission as given, never a prompt, and the
  /// same fix each time.
  private struct FixedLocation: LocationService {
    let permission: LocationAccess
    let answer: LocationFix

    func access() async -> LocationAccess { permission }

    func requestAccess() async -> LocationAccess { permission }

    func fix() async -> LocationFix { answer }
  }

  /// `-location ask:<lat>,<lon>`'s stand-in for Core Location: permission never asked until
  /// `requestAccess()`, which allows it, as the system's prompt answered "Allow While Using App"
  /// would, without showing one; then granted, and the same fix each time. Before that, no fix,
  /// as Core Location gives none without permission (`CoreLocationService.fix()`).
  private actor AskingLocation: LocationService {
    let answer: LocationFix
    /// `requestAccess()` was called: the permission is given.
    private var allowed = false

    init(answer: LocationFix) {
      self.answer = answer
    }

    func access() -> LocationAccess { allowed ? .granted : .notDetermined }

    func requestAccess() -> LocationAccess {
      allowed = true
      return .granted
    }

    func fix() -> LocationFix { allowed ? answer : .denied }
  }

  /// The notifications' stand-in (`DebugHooks.notifications`), for the UI tests: the permission
  /// as `-notifications` says, never the system's prompt, and the token `-pushToken` names,
  /// posted to the inbox as UIKit's would be, a moment after registering. Under `-notifications
  /// system` the permission is the real centre's (`UserNotificationsPlatform`), and the token
  /// still the stand-in's, which the devices stub knows.
  @MainActor
  private final class FakeNotifications: NotificationPlatform {
    /// The real centre, under `system`.
    private let system: UserNotificationsPlatform?
    private var status: AlertSync.Permission
    /// Whether the prompt allows, when it is asked for from not determined.
    private let allows: Bool
    private let token: DebugHooks.PushTokenAnswer

    init(mode: DebugHooks.NotificationsMode, token: DebugHooks.PushTokenAnswer) {
      self.token = token
      system = mode == .system ? UserNotificationsPlatform() : nil
      allows = mode != .deny
      switch mode {
      case .allow, .deny, .system: status = .notDetermined
      case .authorized: status = .authorized
      case .denied: status = .denied
      case .provisional: status = .provisional
      }
    }

    func permission() async -> AlertSync.Permission {
      if let system { return await system.permission() }
      return status
    }

    func requestPermission() async -> Bool {
      if let system { return await system.requestPermission() }
      if status == .notDetermined { status = allows ? .authorized : .denied }
      return status == .authorized || status == .provisional
    }

    func register() {
      switch token {
      case .token(let hex):
        Task { NotificationInbox.shared.post(.token(hex)) }
      case .failure:
        Task { NotificationInbox.shared.post(.registrationFailed) }
      case .nothing:
        break
      }
    }
  }

  /// The notifications' keys under `-uitest` without `-alertCard shown`: as `store` keeps them,
  /// but the card reads as put away, and putting it away writes nothing.
  private struct CardHidden: NotificationStore {
    let store: NotificationDefaults

    func loadSettings() -> AlertSettings { store.loadSettings() }

    func saveSettings(_ settings: AlertSettings) { store.saveSettings(settings) }

    func loadRegistration() -> AlertRegistration? { store.loadRegistration() }

    func saveRegistration(_ registration: AlertRegistration?) {
      store.saveRegistration(registration)
    }

    func loadCardDismissed() -> Bool { true }

    func saveCardDismissed(_ dismissed: Bool) {}
  }

  /// A devices fixture as the hooks read it (`Fixtures/Devices`): its request's body, and the
  /// server's reply, its status, `Retry-After` and text, as the server sent them.
  private struct DevicesFixture<Body: Decodable>: Decodable {
    struct Note: Decodable {
      let body: Body
    }

    let note: Note
    let status: Int
    let retryAfter: String?
    let text: String

    enum CodingKeys: String, CodingKey {
      case note = "_fixture"
      case status, retryAfter, text
    }
  }

  /// A devices request's body, as far as its token.
  private struct TokenBody: Decodable {
    let token: String
  }

  /// A devices fixture's status and its request's version, read before the body is, so 8.1's
  /// `put-*` fixtures (version 1 bodies, which `RegistrationBody` doesn't read) are passed over.
  private struct FixtureVersion: Decodable {
    struct Note: Decodable {
      struct Body: Decodable {
        let v: Int?
      }

      let body: Body
    }

    let note: Note
    let status: Int

    enum CodingKeys: String, CodingKey {
      case note = "_fixture"
      case status
    }
  }

  /// `-devices sent|dryrun|limited|quiet|gone|down[,…]|unlocated|offline`: the server's devices
  /// calls, under `-fixture` (`FixtureTransport.send`) and `-network` (`URLProtocolStub`), from
  /// `Fixtures/Devices`, which the server's own code wrote:
  /// - `PUT /api/v1/devices` (version 2, design 4.9): with evening and morning off, 204, as the
  ///   server forgets the device; else the reply of the version 2 `put-*` fixture the server
  ///   answered with 200 whose set is the request's (where you are as sent, approximate or the
  ///   phone's cell, and the saved places), with the switches the request sent, as the server
  ///   echoes them, 200; for any other set, `put-unlocated`'s 400, as the server answers a set it
  ///   can't locate. Each fixture is a whole set, so no reply is put together here. Under
  ///   `unlocated`, every PUT has that 400;
  /// - `DELETE /api/v1/devices`: 204;
  /// - `POST /api/v1/devices/test`: the `test-*` fixture of each of `-devices`' other names in
  ///   turn, the last repeating (`sent` by default), with its `Retry-After`;
  /// - `offline`: every devices call fails with no connection.
  /// A name with no fixture stops the app.
  private final class DevicesStub: @unchecked Sendable {
    enum Reply {
      case failure(URLError.Code)
      case answer(status: Int, body: Data, retryAfter: String?)
    }

    /// A set the server stored, as a version 2 body names it: where you are, and the saved
    /// places.
    struct PlaceSet: Equatable {
      let here: RegistrationBody.Here
      let saved: [RegistrationBody.Saved]
    }

    /// Read once, from the launch arguments.
    static let shared = DevicesStub(arguments: ProcessInfo.processInfo.arguments)

    /// The test sends' answers, in turn.
    private let tests: [DevicesFixture<TokenBody>]
    /// Every device call fails.
    private let offline: Bool
    /// Every PUT is answered as a set the server can't locate.
    private let refusesAll: Bool
    /// Each set registered with 200, and the server's reply for it, in the fixtures' order.
    private let sets: [(set: PlaceSet, reply: DeviceResponse)]
    /// The server's 400 for a set it can't locate.
    private let unlocated: DevicesFixture<RegistrationBody>
    private let lock = NSLock()
    /// The next test send's place in `tests`.
    private var turn = 0

    init(arguments: [String]) {
      let names = (DebugHooks.value(after: "-devices", in: arguments) ?? "sent")
        .split(separator: ",").map(String.init)
      offline = names == ["offline"]
      refusesAll = names.contains("unlocated")
      let testNames = names.filter { $0 != "unlocated" }
      tests = (offline ? [] : testNames.isEmpty ? ["sent"] : testNames).map { name in
        guard ["sent", "dryrun", "limited", "quiet", "gone", "down"].contains(name) else {
          fatalError(
            "-devices: \(name) isn't sent, dryrun, limited, quiet, gone, down, unlocated "
              + "or offline")
        }
        return DebugHooks.devicesFixture("test-\(name)", body: TokenBody.self)
      }
      sets = Self.registered().map { fixture in
        guard
          let reply = try? JSONDecoder().decode(DeviceResponse.self, from: Data(fixture.text.utf8))
        else { fatalError("A put fixture's reply doesn't decode") }
        let body = fixture.note.body
        return (PlaceSet(here: body.here, saved: body.saved), reply)
      }
      unlocated = DebugHooks.devicesFixture("put-unlocated", body: RegistrationBody.self)
    }

    /// Whether `url` is a devices call.
    static func handles(_ url: URL) -> Bool {
      url.path.hasPrefix("/api/v1/devices")
    }

    /// The reply to `method` on `url` with `body`.
    func reply(method: String, url: URL, body: Data?) -> Reply {
      if offline { return .failure(.notConnectedToInternet) }
      switch (method, url.path) {
      case (HTTPMethod.put.rawValue, "/api/v1/devices"):
        return registered(body)
      case (HTTPMethod.delete.rawValue, "/api/v1/devices"):
        return .answer(status: 204, body: Data(), retryAfter: nil)
      case (HTTPMethod.post.rawValue, "/api/v1/devices/test"):
        let fixture = nextTest()
        return .answer(
          status: fixture.status, body: Data(fixture.text.utf8), retryAfter: fixture.retryAfter)
      default:
        return .answer(status: 404, body: Data(), retryAfter: nil)
      }
    }

    /// A PUT's reply: forgotten with no switch on, the set's record, or the set refused.
    private func registered(_ body: Data?) -> Reply {
      guard let body, let sent = try? JSONDecoder().decode(RegistrationBody.self, from: body),
        sent.v == RegistrationBody.version
      else { return .answer(status: 400, body: Data(), retryAfter: nil) }
      if !sent.alerts.snow.evening, !sent.alerts.snow.morning {
        return .answer(status: 204, body: Data(), retryAfter: nil)
      }
      let set = PlaceSet(here: sent.here, saved: sent.saved)
      guard !refusesAll, let found = sets.first(where: { $0.set == set })?.reply,
        let echoed = try? JSONEncoder().encode(
          DeviceResponse(
            id: found.id, deviceTz: found.deviceTz, here: found.here, saved: found.saved,
            refused: found.refused, alerts: sent.alerts, seenAt: found.seenAt))
      else {
        return .answer(
          status: unlocated.status, body: Data(unlocated.text.utf8),
          retryAfter: unlocated.retryAfter)
      }
      return .answer(status: 200, body: echoed, retryAfter: nil)
    }

    /// The test send's answer now, the last repeating once all are given.
    private func nextTest() -> DevicesFixture<TokenBody> {
      lock.withLock {
        let fixture = tests[min(turn, tests.count - 1)]
        turn += 1
        return fixture
      }
    }

    /// The version 2 `put-*` fixtures the server answered with 200, each a whole set's
    /// registration, by name.
    private static func registered() -> [DevicesFixture<RegistrationBody>] {
      let folder = Bundle.main.url(forResource: "Fixtures", withExtension: nil)?
        .appendingPathComponent("Devices", isDirectory: true)
      let urls = folder.flatMap {
        try? FileManager.default.contentsOfDirectory(at: $0, includingPropertiesForKeys: nil)
      }
      return (urls ?? [])
        .filter { $0.lastPathComponent.hasPrefix("put-") && $0.pathExtension == "json" }
        .sorted { $0.lastPathComponent < $1.lastPathComponent }
        .filter { url in
          guard let data = try? Data(contentsOf: url),
            let header = try? JSONDecoder().decode(FixtureVersion.self, from: data)
          else { fatalError("Fixtures/Devices/\(url.lastPathComponent) doesn't decode") }
          return header.status == 200 && header.note.body.v == RegistrationBody.version
        }
        .map {
          DebugHooks.devicesFixture(
            $0.deletingPathExtension().lastPathComponent, body: RegistrationBody.self)
        }
    }
  }

  /// Section 9.8's URLProtocol stub: under `-network`, the network beneath the app's own
  /// URLSession transport, answering as `StubServer` says.
  private final class URLProtocolStub: URLProtocol {
    /// Read once, from the launch arguments.
    static let server = StubServer(arguments: ProcessInfo.processInfo.arguments)

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
      guard let client else { return }
      if let url = request.url, DevicesStub.handles(url) {
        // Not noted for the recorder: a devices call asks in no units.
        let reply = DevicesStub.shared.reply(
          method: request.httpMethod ?? "", url: url, body: Self.body(of: request))
        switch reply {
        case .failure(let code):
          client.urlProtocol(self, didFailWithError: URLError(code))
        case .answer(let status, let body, let retryAfter):
          answer(client, status: status, body: body, retryAfter: retryAfter)
        }
        return
      }
      if let url = request.url { DebugRecorder.requested(url) }
      switch Self.server?.reply(to: request) ?? .failure(.notConnectedToInternet) {
      case .failure(let code):
        client.urlProtocol(self, didFailWithError: URLError(code))
      case .answer(let status, let body):
        answer(client, status: status, body: body, retryAfter: nil)
      }
    }

    override func stopLoading() {}

    /// Hands the client a JSON answer, with its `Retry-After` when it has one.
    private func answer(
      _ client: any URLProtocolClient, status: Int, body: Data, retryAfter: String?
    ) {
      var headers = ["Content-Type": "application/json"]
      headers["Retry-After"] = retryAfter
      guard
        let url = request.url,
        let response = HTTPURLResponse(
          url: url,
          statusCode: status,
          httpVersion: "HTTP/1.1",
          headerFields: headers
        )
      else {
        client.urlProtocol(self, didFailWithError: URLError(.badURL))
        return
      }
      client.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client.urlProtocol(self, didLoad: body)
      client.urlProtocolDidFinishLoading(self)
    }

    /// A request's body: a URLProtocol is given it as a stream, not as `httpBody`.
    private static func body(of request: URLRequest) -> Data? {
      if let body = request.httpBody { return body }
      guard let stream = request.httpBodyStream else { return nil }
      stream.open()
      defer { stream.close() }
      var data = Data()
      var buffer = [UInt8](repeating: 0, count: 4096)
      while stream.hasBytesAvailable {
        let count = stream.read(&buffer, maxLength: buffer.count)
        guard count > 0 else { break }
        data.append(buffer, count: count)
      }
      return data
    }
  }

  /// What a fixture says about itself (`_fixture`), as far as the hooks read it: its query and
  /// its moment.
  private struct FixtureNote: Decodable {
    struct Note: Decodable {
      /// What the app asked, without the "?".
      let query: String
      /// ISO 8601 UTC.
      let now: String
    }

    let note: Note

    enum CodingKeys: String, CodingKey {
      case note = "_fixture"
    }
  }

  /// What `-openURLs` shows (`debugRecorder()`): the last web page or email the app would have
  /// opened, and the units the last request to the server asked in, so a UI test reads both on
  /// screen, as the lines' accessibility values. Only the units of a request, never its place.
  @MainActor
  @Observable
  final class DebugRecorder {
    static let shared = DebugRecorder()

    /// The last URL `openURL` was given, as text; "none" before the first.
    var opened = none
    /// The `units` the last request asked in: "c", "f", or "none" without, or before the first.
    var units = none

    /// What a line says with nothing to show, so that it is on screen from the start.
    private nonisolated static let none = "none"

    /// Notes the units `url`, a request to the server, asks in; from any thread.
    nonisolated static func requested(_ url: URL) {
      let units =
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
        .first { $0.name == "units" }?.value ?? none
      Task { @MainActor in shared.units = units }
    }
  }

  /// Under `-openURLs`: every URL the view opens is recorded instead of opened, a mail URL
  /// refused too under `nomail`, and the recorder's two lines show below the content.
  ///
  /// Below it, not over it: the lines were a bottom `safeAreaInset` on a translucent bar, which
  /// insets a list's content but not its frame, so a sheet's last rows ran under the bar. On PR
  /// #33's macOS run a tap on Support, Settings' last row, landed on the bar, the full policy's
  /// row in Your privacy sat 1 point under it, and the audit found text under it short of
  /// contrast. Opaque, and in a text style that changes at every text size (subheadline,
  /// 12 to 15 points from the smallest to Large): `caption2` keeps 11 points from the smallest
  /// size to Large, which the audit's Dynamic Type check failed on both lines.
  ///
  /// The URL wraps whole, so the lines take what height it needs, from the sheet's content:
  /// Report an ad's email, 201 characters with no space, is about 6 lines at Large, after its
  /// label, and taller than the window at AX5. So no audit reads a sheet over lines that hold an email:
  /// `SettingsTests.testRowsOpenWhatTheySay` taps the emails after its pages' audits, and the
  /// mail fallback, audited with one recorded, covers Settings and its lines. Not held to a few
  /// lines in a scroll view: the URL would then be cut at the lines' foot, which is what the
  /// audit's clipped-text check fails.
  @MainActor
  private struct URLRecorder: ViewModifier {
    let mode: DebugHooks.OpenURLs

    func body(content: Content) -> some View {
      let recorder = DebugRecorder.shared
      VStack(spacing: 0) {
        content
          .environment(
            \.openURL,
            OpenURLAction { url in
              recorder.opened = url.absoluteString
              return mode == .nomail && url.scheme == "mailto" ? .discarded : .handled
            }
          )
        // Each line shows its label, then what it holds ("Units last asked for: f",
        // `AppCopy.recorderLine`), held to its full height; its accessibility label is the label
        // alone and its value what it holds, which the UI tests read. The URL as a label was "not
        // human-readable" to the audit on PR #33's second macOS run; on its third the units' line,
        // showing only "none" or "f" under its longer label and not held to its height, was "Text
        // clipped", where the URL's line, held, passed showing "none" under "Last link opened".
        VStack(alignment: .leading, spacing: 2) {
          line(AppCopy.recorderOpened, recorder.opened)
            .accessibilityIdentifier("debug-opened")
          line(AppCopy.recorderUnits, recorder.units)
            .accessibilityIdentifier("debug-units")
        }
        .font(.subheadline)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
        .background(.background)
      }
    }

    /// A line of the recorder: `label`, then `value`, wrapping whole; to VoiceOver and the UI
    /// tests, `label`, with `value` as its value.
    private func line(_ label: String, _ value: String) -> some View {
      Text(verbatim: AppCopy.recorderLine(name: label, value: value))
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityValue(Text(verbatim: value))
    }
  }

  /// `DebugHooks.adsReadout`: three clear elements of a point each, which show nothing and take
  /// no tap, whose accessibility values AdsTests read: `debug-ads`, the ads' phase (idle, asking,
  /// withheld, on, or off once a purchase stopped them); `debug-interstitial`, whether a
  /// full-screen ad is loaded, waiting for a place to be chosen (ready or none); and
  /// `debug-shown`, how many full-screen ads have shown and closed this launch. A view of its
  /// own, reading the model in its own body, so only it is drawn again as they change, not the
  /// home screen. Each value is one lowercase word or a number, shown to no one, so none of it is
  /// copy.
  @MainActor
  private struct AdsReadout: View {
    let ads: AdsModel

    var body: some View {
      HStack(spacing: 0) {
        Reading(id: "debug-ads", value: phase)
        Reading(id: "debug-interstitial", value: ads.interstitialReady ? "ready" : "none")
        Reading(id: "debug-shown", value: String(ads.interstitialsShown))
      }
      .allowsHitTesting(false)
    }

    /// The ads' phase as one word.
    private var phase: String {
      switch ads.phase {
      case .idle: "idle"
      case .asking: "asking"
      case .withheld: "withheld"
      case .on: "on"
      case .off: "off"
      }
    }
  }

  /// A clear point identified `id`, whose accessibility value is `value`: one element of a Debug
  /// readout, which shows nothing.
  private struct Reading: View {
    let id: String
    let value: String

    var body: some View {
      Color.clear
        .frame(width: 1, height: 1)
        .accessibilityElement()
        .accessibilityValue(Text(verbatim: value))
        .accessibilityIdentifier(id)
    }
  }

  /// `DebugHooks.pickerReadout`: three clear elements of a point each, which show nothing and take
  /// no tap, whose accessibility values the UI tests read. `debug-picker`: open, while the home
  /// screen has the picker open; closing, once it has closed it but the picker's content is still
  /// on screen (SwiftUI hasn't called its `onDisappear`); closed otherwise, as before any picker
  /// opened. `debug-pickers`: how many times a picker's content has come on screen, so a test
  /// knows the picker it reads is the one its tap opened, and that closed is that one closing, not
  /// the readout at rest. `debug-cancels`: how many touches the system has cancelled in the app
  /// this launch (`TouchWatch`), so a gesture that changed nothing can say the simulator cancelled
  /// its touch, which the app then never had as a tap. Over the home
  /// screen rather than the picker, so it is read where XCUITest kept up on PR #39's run, and the
  /// home screen's sheet state rather than the picker's, so Google's full-screen ad over the
  /// picker, should it take the picker off screen and back, still reads open. A view of its own,
  /// reading `DebugPresence` in its own body, as `AdsReadout` does, drawn again only as a value
  /// changes. Each value is one lowercase word or a number, shown to no one, so none of it is
  /// copy.
  @MainActor
  private struct PickerReadout: View {
    let open: Bool

    var body: some View {
      HStack(spacing: 0) {
        Reading(id: "debug-picker", value: state)
        Reading(id: "debug-pickers", value: String(DebugPresence.shared.pickersShown))
        Reading(id: "debug-cancels", value: String(DebugPresence.shared.touchesCancelled))
      }
      .allowsHitTesting(false)
    }

    /// The picker as one word.
    private var state: String {
      if open { return "open" }
      return DebugPresence.shared.pickerOnScreen ? "closing" : "closed"
    }
  }

  /// `DebugHooks.themeReadout`: a clear element of a point, which shows nothing and takes no tap,
  /// whose accessibility value the UI tests read: `debug-theme`, as `ThemeFades.reading` judges
  /// it, here in the readout's body, from the page on screen's band and theme and the fades the
  /// shell has told of (`DebugPresence.fades`). The theme the readout first appears with is
  /// the background's, as nothing fades in. Each value is one lowercase word, shown to no one, so
  /// none of it is copy.
  @MainActor
  private struct ThemeReadout: View {
    let band: SnowBand?
    let theme: PageTheme

    var body: some View {
      let presence = DebugPresence.shared
      Reading(id: "debug-theme", value: presence.fades.reading(band: band, theme: theme))
        .allowsHitTesting(false)
        .onAppear {
          // Written only the first time: a write in place tells the readout it changed.
          if presence.fades.last == nil { presence.fades.appeared(with: theme) }
        }
    }
  }

  /// The home screen's background's fades as `ThemeReadout` judges them: how many it has begun
  /// that aren't over (`HomeShell` tells each fade's beginning and end, `DebugHooks.themeFades`),
  /// and the theme the last of them began fading to, or the background first appeared with. Its
  /// reading is the page's band ("none" without one) only with no fade under way and the last
  /// one to the page's theme, and "fading" otherwise. Counted, not judged by a theme alone: a
  /// theme left and come back to within 0.9 s (a place chosen from Nearby, loading as no snow and
  /// answering in snow) would otherwise read settled while the background is still fading away
  /// and back, and an earlier fade's end pass for a later one's (that fade to no snow ending
  /// after a tap on Now). A fade's beginning is kept only after the update it begins in, so in
  /// that update the page's theme is the new one and the last fade's the old one, and it reads
  /// "fading" from that very update, never the new band over the old colours. A band that
  /// changes without changing the theme (a loading page, drawn as no snow, giving way to an
  /// answer of no snow) begins no fade, and reads at once. A fade whose end never comes leaves it
  /// "fading", failing the wait, never passing it early.
  struct ThemeFades {
    /// The fades begun and not yet over.
    private(set) var underway = 0
    /// The theme the last fade began to, or the background first appeared with; nil before.
    private(set) var last: PageTheme?

    /// The background on screen with `theme`, before any fade: the theme it shows.
    mutating func appeared(with theme: PageTheme) {
      if last == nil { last = theme }
    }

    /// A fade begun, to `theme`.
    mutating func began(to theme: PageTheme) {
      underway += 1
      last = theme
    }

    /// A fade over.
    mutating func ended() {
      underway -= 1
    }

    /// `debug-theme` for a page in `band` (nil without one) with `theme`.
    func reading(band: SnowBand?, theme: PageTheme) -> String {
      underway == 0 && last == theme ? (band?.rawValue ?? "none") : "fading"
    }
  }

  /// What `PickerReadout` reads beyond the home screen's sheet: whether the picker's content is
  /// on screen, from its `onAppear` to its `onDisappear` (`DebugHooks.pickerAppeared` and
  /// `pickerDisappeared`), how many times it has come on screen, and how many touches the system
  /// has cancelled; and what `ThemeReadout` reads, the home screen's background's fades.
  @MainActor
  @Observable
  private final class DebugPresence {
    static let shared = DebugPresence()

    var pickerOnScreen = false
    var pickersShown = 0
    /// How many touches the system cancelled in the app this launch (`TouchWatch`).
    var touchesCancelled = 0
    /// The home screen's background's fades (`HomeShell`'s `fades`), and the theme it shows.
    var fades = ThemeFades()
  }

  /// `-uitest`'s count of the touches the system cancelled, for `debug-cancels`: on the CI
  /// simulator backboardd sometimes registers a synthesised gesture's touchscreen twice and
  /// cancels the touch when it goes, so a tap is drawn pressed and let go with no action
  /// (DECISIONS, "What the simulator's log showed"). It reads each event at
  /// `UIApplication.sendEvent(_:)`'s entry, before UIKit dispatches it to a window or any gesture
  /// recognizer sees it, then passes it on unchanged: no recognizer, no change to any touch's
  /// delivery. So the phases it counts are the ones the system set (backboardd's cancels, a
  /// system gesture taking the touch, deactivation), never a recognizer's later cancel of a
  /// view's touches.
  @MainActor
  private enum TouchWatch {
    private static var installed = false

    /// Exchanges `sendEvent(_:)` with `debugWatchedSendEvent(_:)`, once: a second call, or one
    /// that finds either method missing, changes nothing, so the original is never exchanged
    /// back or lost.
    static func install() {
      guard !installed,
        let original = class_getInstanceMethod(
          UIApplication.self, #selector(UIApplication.sendEvent(_:))),
        let watched = class_getInstanceMethod(
          UIApplication.self, #selector(UIApplication.debugWatchedSendEvent(_:)))
      else { return }
      method_exchangeImplementations(original, watched)
      installed = true
    }

    /// Counts the touches `event` holds that the system has cancelled, writing the count only when
    /// there are some: `+= 0` would still tell the readout the count changed (an `@Observable`
    /// property changed in place always does), drawing it again at every touch's down, move and
    /// lift.
    fileprivate static func saw(_ event: UIEvent) {
      guard event.type == .touches, let touches = event.allTouches else { return }
      let cancelled = touches.filter { $0.phase == .cancelled }.count
      if cancelled > 0 {
        DebugPresence.shared.touchesCancelled += cancelled
      }
    }
  }

  extension UIApplication {
    /// `sendEvent(_:)` once `TouchWatch.install()` has exchanged the two: counted, then
    /// delivered by the original, now under this name. `dynamic`, so the call below goes through
    /// the Objective-C runtime, which the exchange changed, and never straight back here.
    @objc fileprivate dynamic func debugWatchedSendEvent(_ event: UIEvent) {
      TouchWatch.saw(event)
      debugWatchedSendEvent(event)
    }
  }
#endif

extension View {
  #if DEBUG
    /// Under `-openURLs`, the URL recorder (`DebugHooks.openURLs`); otherwise the view as it is.
    @MainActor
    @ViewBuilder
    func debugRecorder() -> some View {
      if let mode = DebugHooks.openURLs() {
        modifier(URLRecorder(mode: mode))
      } else {
        self
      }
    }
  #else
    /// A Release build records nothing: the view as it is.
    func debugRecorder() -> some View { self }
  #endif
}
