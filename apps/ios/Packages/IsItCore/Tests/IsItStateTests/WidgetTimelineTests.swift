import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItTestSupport
import Testing

/// A widget's timeline (`WidgetTimeline`, spec 11.2) at aberdeen-snow's moment, for
/// `city:aberdeen-gb` in °C unless said: the purchase check, which answer it plans from, the
/// request and its guarded save, the faces, the snapshot and the sample, and the log line. Each
/// test has a gate of its own (`timeline(…)`), as Swift Testing runs them together.
@Suite("The widget's timeline", .timeLimit(.minutes(1)))
struct WidgetTimelineTests {
  let key = "city:aberdeen-gb"
  let aberdeen = Target.city(slug: "aberdeen-gb")

  /// When aberdeen-snow was answered.
  let now: Date

  init() throws {
    now = try fixtureNow("aberdeen-snow")
  }

  /// The App Group as the app leaves it: `unlock.v1` saying `unlocked` (none for nil), the place,
  /// the units, and `today` saved.
  func appGroup(
    unlocked: Bool? = true,
    place: Target? = nil,
    units: Units? = .c,
    today: SavedToday? = nil
  ) throws -> FakeWidgetStore {
    FakeWidgetStore(
      .init(
        place: place ?? aberdeen, units: units,
        unlock: try unlocked.map { try flag($0, at: now) }, today: today))
  }

  /// aberdeen-snow, saved under `key` at `savedAt`.
  func kept(at savedAt: Date, key: String = "city:aberdeen-gb") throws -> SavedToday {
    SavedToday(key: key, savedAt: savedAt, response: try fixture("aberdeen-snow"))
  }

  /// aberdeen-snow, saved under `key` `minutes` before now.
  func kept(minutesAgo minutes: Double, key: String = "city:aberdeen-gb") throws -> SavedToday {
    try kept(at: later(now, minutes: -minutes), key: key)
  }

  /// The server, answering aberdeen-snow.
  func aberdeenServer() throws -> FakeTransport {
    FakeTransport([try FakeTransport.fixture("aberdeen-snow")])
  }

  /// No connection.
  func offline() -> FakeTransport {
    FakeTransport([.failure(.notConnectedToInternet)])
  }

  /// A server whose answer, aberdeen-snow, waits until the test releases it.
  func heldServer() throws -> GatedTransport {
    GatedTransport(
      first: HTTPResponse(status: 200, body: try Fixtures.data("aberdeen-snow")),
      others: HTTPResponse(status: 503, body: Data()))
  }

  /// `plan`'s log line, for each family's size, names no place: neither a key, a name nor a URL.
  func expectNoPlace(
    _ plan: WidgetTimeline.Plan, sourceLocation: SourceLocation = #_sourceLocation
  ) {
    for (family, width, height) in [
      ("systemSmall", 170, 170), ("systemMedium", 364, 170), ("accessoryInline", 257, 26),
    ] {
      let line = plan.logLine(family: family, width: width, height: height, font: true)
      for word in ["aberdeen", "leeds", "denver", "city:", "device:", "search:", "http"] {
        #expect(!line.lowercased().contains(word), "\(line)", sourceLocation: sourceLocation)
      }
    }
  }

  /// `timeline`'s plan at `now`, its log line held to name no place.
  func planned(
    _ timeline: WidgetTimeline, at now: Date, sourceLocation: SourceLocation = #_sourceLocation
  ) async -> WidgetTimeline.Plan {
    let plan = await timeline.plan(at: now)
    expectNoPlace(plan, sourceLocation: sourceLocation)
    return plan
  }

  /// `plan`'s entries are the planner's for `res` fetched at `fetchedAt`, faced in its unit, and
  /// its reload is the planner's.
  func expectPlanner(
    _ plan: WidgetTimeline.Plan, _ res: TodayResponse, fetchedAt: Date, at now: Date,
    sourceLocation: SourceLocation = #_sourceLocation
  ) {
    let expected = WidgetPlanner.entries(res, fetchedAt: fetchedAt, now: now, unlocked: true)
    let unit = res.snow?.unit ?? .cm
    #expect(
      plan.entries.map(\.date) == expected.entries.map(\.date), sourceLocation: sourceLocation)
    #expect(
      plan.entries.map(\.face) == expected.entries.map { WidgetFace($0, unit: unit) },
      sourceLocation: sourceLocation)
    #expect(plan.reload == expected.reloadAt, sourceLocation: sourceLocation)
  }

  /// `plan` is the locked face alone, reloaded as `reload` says, and nothing was asked or saved.
  func expectLocked(
    _ plan: WidgetTimeline.Plan, reload: WidgetPlan.Reload, transport: FakeTransport,
    store: FakeWidgetStore, sourceLocation: SourceLocation = #_sourceLocation
  ) {
    #expect(plan.entries.map(\.face.state) == [.locked], sourceLocation: sourceLocation)
    #expect(plan.reload == reload, sourceLocation: sourceLocation)
    #expect(plan.unlock == .no, sourceLocation: sourceLocation)
    #expect(plan.source == .locked, sourceLocation: sourceLocation)
    #expect(transport.requests.isEmpty, sourceLocation: sourceLocation)
    #expect(store.saves == 0, sourceLocation: sourceLocation)
  }

  // MARK: - Unlock

  @Test("the flag unlocks whatever StoreKit says, and StoreKit's answer is only logged")
  func theFlagUnlocksWhateverStoreKitSays() async throws {
    let entitlements = FakeEntitlements([])
    let plan = await planned(
      timeline(try appGroup(), transport: try aberdeenServer(), entitlements: entitlements),
      at: now)
    #expect(plan.unlock == .flag)
    #expect(plan.storeKit == .answered(0))
    #expect(entitlements.calls == 1)
    #expect(plan.source == .fetched)
    #expect(plan.entries.count == 8)
    #expect(plan.entries.first?.face.state == .ok)
  }

  @Test("a payer's StoreKit is asked beside the answer, and what it holds is logged")
  func aPayersStoreKitIsLogged() async throws {
    let entitlements = FakeEntitlements([fact(id: 1)])
    let plan = await planned(
      timeline(try appGroup(), transport: try aberdeenServer(), entitlements: entitlements),
      at: now)
    #expect(plan.unlock == .flag)
    #expect(plan.storeKit == .answered(1))
    #expect(entitlements.calls == 1)
  }

  @Test("with the flag, a StoreKit that never answers is waited for no longer than its limit")
  func theFlagWaitsForStoreKitNoLongerThanItsLimit() async throws {
    let store = try appGroup()
    let transport = try aberdeenServer()
    let start = Date()
    let plan = await planned(
      timeline(
        store, transport: transport, entitlements: FakeEntitlements(held: true),
        checkWithin: 0.05),
      at: now)
    #expect(Date().timeIntervalSince(start) < 5)
    #expect(plan.unlock == .flag)
    #expect(plan.storeKit == .late)
    #expect(plan.source == .fetched)
    #expect(plan.entries.first?.face.state == .ok)
  }

  @Test("a verified entitlement unlocks when the flag says locked, and the planner's reload stands")
  func aVerifiedEntitlementUnlocksWhenTheFlagSaysLocked() async throws {
    let transport = try aberdeenServer()
    let plan = await planned(
      timeline(
        try appGroup(unlocked: false), transport: transport,
        entitlements: FakeEntitlements([fact(id: 1, family: true)])),
      at: now)
    #expect(plan.unlock == .storeKit)
    #expect(plan.storeKit == .answered(1))
    #expect(plan.source == .fetched)
    #expect(transport.requests.count == 1)
    expectPlanner(plan, try fixture("aberdeen-snow"), fetchedAt: now, at: now)
  }

  @Test("StoreKit holding nothing locks when the flag says locked, until the app reloads it")
  func emptyEntitlementsLock() async throws {
    let store = try appGroup(unlocked: false)
    let transport = try aberdeenServer()
    let plan = await planned(
      timeline(store, transport: transport, entitlements: FakeEntitlements([])), at: now)
    expectLocked(plan, reload: .never, transport: transport, store: store)
    #expect(plan.storeKit == .answered(0))
  }

  @Test("a StoreKit that never answers locks when the flag says locked, within its limit")
  func lateEntitlementsLock() async throws {
    let store = try appGroup(unlocked: false)
    let transport = try aberdeenServer()
    let start = Date()
    let plan = await planned(
      timeline(
        store, transport: transport, entitlements: FakeEntitlements(held: true),
        checkWithin: 0.05),
      at: now)
    #expect(Date().timeIntervalSince(start) < 5)
    expectLocked(plan, reload: .never, transport: transport, store: store)
    #expect(plan.storeKit == .late)
  }

  @Test("an unverified, a revoked or another product's transaction locks")
  func unverifiedRevokedOrAnotherProductLock() async throws {
    let facts = [
      fact(id: 1, verified: false), fact(id: 2, revoked: true),
      fact(id: 3, product: "today.willitsnow.app.other"),
    ]
    for held in facts {
      let store = try appGroup(unlocked: false)
      let transport = try aberdeenServer()
      let plan = await planned(
        timeline(store, transport: transport, entitlements: FakeEntitlements([held])),
        at: now)
      expectLocked(plan, reload: .never, transport: transport, store: store)
      #expect(plan.storeKit == .answered(1))
    }
  }

  @Test("with no flag, a locked widget looks again in an hour, StoreKit empty or late")
  func noFlagLocksButLooksAgainInAnHour() async throws {
    for entitlements in [FakeEntitlements([]), FakeEntitlements(held: true)] {
      let store = try appGroup(unlocked: nil)
      let transport = try aberdeenServer()
      let plan = await planned(
        timeline(store, transport: transport, entitlements: entitlements, checkWithin: 0.05),
        at: now)
      expectLocked(
        plan, reload: .after(later(now, minutes: 60)), transport: transport, store: store)
    }
  }

  @Test("junk in the flag is no flag")
  func junkInTheFlagIsNoFlag() async throws {
    let store = try appGroup(unlocked: nil)
    store.contents.change { $0.unlock = Data("{\"unlocked\":true}".utf8) }
    #expect(store.loadUnlock() == nil)
    let transport = try aberdeenServer()
    let plan = await planned(timeline(store, transport: transport), at: now)
    expectLocked(plan, reload: .after(later(now, minutes: 60)), transport: transport, store: store)
  }

  @Test("with no flag, StoreKit's purchase never asks the server, as before the first unlock")
  func noFlagNeverAsksTheServer() async throws {
    // The App Group unreadable: no flag, and the place reads as approximate IP location.
    let store = FakeWidgetStore()
    let transport = try aberdeenServer()
    let plan = await planned(
      timeline(store, transport: transport, entitlements: FakeEntitlements([fact(id: 1)])),
      at: now)
    #expect(plan.unlock == .storeKit)
    #expect(plan.source == .none)
    #expect(transport.requests.isEmpty)
    #expect(store.saves == 0)
    #expect(plan.entries.map(\.face.state) == [.stale])
    #expect(plan.reload == .after(later(now, minutes: 60)))
  }

  @Test("with no flag, StoreKit's purchase shows what is saved for the place, with no request")
  func noFlagShowsWhatIsSavedForThePlace() async throws {
    let saved = try kept(minutesAgo: 120)
    let transport = try aberdeenServer()
    let plan = await planned(
      timeline(
        try appGroup(unlocked: nil, today: saved), transport: transport,
        entitlements: FakeEntitlements([fact(id: 1)])),
      at: now)
    #expect(plan.unlock == .storeKit)
    #expect(plan.source == .saved)
    #expect(transport.requests.isEmpty)
    expectPlanner(plan, saved.response, fetchedAt: saved.savedAt, at: now)
  }

  // MARK: - The log

  @Test("the log line says what happened, in key=value tokens, and nothing else")
  func theLogLineSaysWhatHappenedAndNothingElse() async throws {
    let reused = await planned(
      timeline(
        try appGroup(today: try kept(minutesAgo: 10)), transport: try aberdeenServer(),
        entitlements: FakeEntitlements([fact(id: 1)])),
      at: now)
    #expect(
      reused.logLine(family: "systemSmall", width: 170, height: 170, font: true)
        == "family=systemSmall width=170 height=170 unlock=flag storekit=answered:1"
        + " source=reused entries=8 font=ok")
    let fetched = await planned(
      timeline(try appGroup(), transport: try aberdeenServer()), at: now)
    #expect(
      fetched.logLine(family: "systemMedium", width: 364, height: 170, font: false)
        == "family=systemMedium width=364 height=170 unlock=flag storekit=answered:0"
        + " source=fetched entries=8 font=missing")
    let locked = await planned(
      timeline(try appGroup(unlocked: false), transport: try aberdeenServer()), at: now)
    #expect(
      locked.logLine(family: "accessoryCircular", width: 76, height: 76, font: true)
        == "family=accessoryCircular width=76 height=76 unlock=no storekit=answered:0"
        + " source=locked entries=1 font=ok")
    let fromSaved = await planned(
      timeline(
        try appGroup(unlocked: nil, today: try kept(minutesAgo: 120)),
        transport: try aberdeenServer(), entitlements: FakeEntitlements([fact(id: 1)])),
      at: now)
    #expect(
      fromSaved.logLine(family: "accessoryRectangular", width: 172, height: 76, font: true)
        == "family=accessoryRectangular width=172 height=76 unlock=storeKit storekit=answered:1"
        + " source=saved entries=8 font=ok")
    let none = await planned(
      timeline(
        try appGroup(), transport: offline(), entitlements: FakeEntitlements(held: true),
        checkWithin: 0.05),
      at: now)
    #expect(
      none.logLine(family: "systemSmall", width: 158, height: 158, font: true)
        == "family=systemSmall width=158 height=158 unlock=flag storekit=late source=none"
        + " entries=1 font=ok")
    let snapshot = timeline(try appGroup(today: try kept(minutesAgo: 120)), transport: offline())
      .saved(at: now)
    expectNoPlace(snapshot)
    #expect(
      snapshot.logLine(family: "accessoryInline", width: 257, height: 26, font: true)
        == "family=accessoryInline width=257 height=26 unlock=flag storekit=unasked"
        + " source=saved entries=8 font=ok")
  }

  // MARK: - The answer

  @Test("a fresh saved answer is reused, with no request, planned from when it was fetched")
  func aFreshSavedAnswerIsReused() async throws {
    let saved = try kept(minutesAgo: 10)
    let store = try appGroup(today: saved)
    let transport = try aberdeenServer()
    let plan = await planned(timeline(store, transport: transport), at: now)
    #expect(transport.requests.isEmpty)
    #expect(plan.source == .reused)
    #expect(store.saves == 0)
    expectPlanner(plan, saved.response, fetchedAt: saved.savedAt, at: now)
  }

  @Test("an hour-old answer is asked for again, and the new one saved and planned from now")
  func anHourOldAnswerIsAskedForAgain() async throws {
    let store = try appGroup(today: try kept(minutesAgo: 60))
    let transport = try aberdeenServer()
    let plan = await planned(timeline(store, transport: transport), at: now)
    #expect(transport.requests.count == 1)
    #expect(plan.source == .fetched)
    #expect(store.saves == 1)
    #expect(store.today?.key == key)
    #expect(store.today?.savedAt == now)
    let res = try fixture("aberdeen-snow")
    let refresh = now.addingTimeInterval(TimeInterval(Constants.Widget.refreshHours) * 3600)
    #expect(plan.reload == .after(min(refresh, Freshness.usableUntil(res))))
    expectPlanner(plan, res, fetchedAt: now, at: now)
  }

  @Test("another place's answer is never reused")
  func anotherPlacesAnswerIsNeverReused() async throws {
    let transport = try aberdeenServer()
    let plan = await planned(
      timeline(
        try appGroup(today: try kept(minutesAgo: 10, key: "city:leeds-gb")),
        transport: transport),
      at: now)
    #expect(transport.requests.count == 1)
    #expect(plan.source == .fetched)
  }

  @Test("an answer in other units is never reused")
  func anAnswerInOtherUnitsIsNeverReused() async throws {
    let transport = try aberdeenServer()
    let plan = await planned(
      timeline(try appGroup(units: .f, today: try kept(minutesAgo: 10)), transport: transport),
      at: now)
    #expect(transport.requests.count == 1)
    #expect(plan.source == .fetched)
  }

  @Test("with no units chosen yet, the saved answer's units do")
  func withNoUnitsYetTheSavedAnswersUnitsDo() async throws {
    let transport = try aberdeenServer()
    let plan = await planned(
      timeline(try appGroup(units: nil, today: try kept(minutesAgo: 10)), transport: transport),
      at: now)
    #expect(transport.requests.isEmpty)
    #expect(plan.source == .reused)
  }

  @Test("a saved answer from the future, the clock moved back, is asked for again")
  func aSavedAnswerFromTheFutureIsAskedForAgain() async throws {
    let transport = try aberdeenServer()
    let plan = await planned(
      timeline(try appGroup(today: try kept(minutesAgo: -1)), transport: transport),
      at: now)
    #expect(transport.requests.count == 1)
    #expect(plan.source == .fetched)
  }

  @Test("a saved answer with no hour left to show is asked for again")
  func aSavedAnswerPastItsHoursIsAskedForAgain() async throws {
    let until = Freshness.usableUntil(try fixture("aberdeen-snow"))
    let transport = try aberdeenServer()
    let plan = await planned(
      timeline(
        try appGroup(today: try kept(at: later(until, minutes: -10))), transport: transport),
      at: until)
    #expect(transport.requests.count == 1)
    #expect(plan.source == .fetched)
    #expect(plan.entries.map(\.face.state) == [.stale])
  }

  @Test("offline, the widget falls back to this place's answer, however old, and saves nothing")
  func offlineFallsBackToThisPlacesAnswer() async throws {
    let saved = try kept(minutesAgo: 120)
    let store = try appGroup(today: saved)
    let plan = await planned(timeline(store, transport: offline()), at: now)
    #expect(plan.source == .saved)
    #expect(store.saves == 0)
    #expect(store.today == saved)
    expectPlanner(plan, saved.response, fetchedAt: saved.savedAt, at: now)
  }

  @Test("offline, another place's answer is never shown: the stale face, looked at in an hour")
  func offlineWithAnotherPlacesAnswerIsStale() async throws {
    let plan = await planned(
      timeline(
        try appGroup(today: try kept(minutesAgo: 10, key: "city:leeds-gb")),
        transport: offline()),
      at: now)
    #expect(plan.source == .none)
    #expect(plan.entries.map(\.face.state) == [.stale])
    #expect(plan.reload == .after(later(now, minutes: 60)))
  }

  @Test("offline with nothing saved, the stale face, looked at in an hour")
  func offlineWithNothingSavedIsStale() async throws {
    let plan = await planned(timeline(try appGroup(), transport: offline()), at: now)
    #expect(plan.source == .none)
    #expect(plan.entries.map(\.face.state) == [.stale])
    #expect(plan.reload == .after(later(now, minutes: 60)))
  }

  @Test("turned away for asking too often, the widget falls back")
  func tooManyRequestsFallsBack() async throws {
    let transport = FakeTransport([try FakeTransport.error(429, code: "rate_limited")])
    let plan = await planned(
      timeline(try appGroup(today: try kept(minutesAgo: 120)), transport: transport),
      at: now)
    #expect(transport.requests.count == 1)
    #expect(plan.source == .saved)
  }

  @Test("an error answer, the widget falls back")
  func anErrorAnswerFallsBack() async throws {
    let transport = FakeTransport([try FakeTransport.error(503, code: "upstream_unavailable")])
    let plan = await planned(
      timeline(try appGroup(today: try kept(minutesAgo: 120)), transport: transport),
      at: now)
    #expect(transport.requests.count == 1)
    #expect(plan.source == .saved)
  }

  @Test("a server too slow for the limit, the widget falls back")
  func aServerTooSlowFallsBack() async throws {
    let transport = try heldServer()
    releasing { transport.release() }
    let store = try appGroup(today: try kept(minutesAgo: 120))
    let start = Date()
    let plan = await planned(
      timeline(store, transport: transport, fetchWithin: 0.05), at: now)
    #expect(Date().timeIntervalSince(start) < 5)
    #expect(plan.source == .saved)
    #expect(store.saves == 0)
    transport.release()
  }

  // MARK: - Saving

  @Test("it saves what it fetched, which the app's next launch then paints")
  func itSavesWhatItFetched() async throws {
    let store = try appGroup()
    let plan = await planned(timeline(store, transport: try aberdeenServer()), at: now)
    #expect(plan.source == .fetched)
    #expect(store.saves == 1)
    let fetched = SavedToday(key: key, savedAt: now, response: try fixture("aberdeen-snow"))
    #expect(store.today == fetched)
    let launch = Launch.plan(store.today, target: aberdeen, units: .c, at: later(now, minutes: 1))
    #expect(launch.paint == fetched)
  }

  /// Plans with the request held until `meanwhile` has changed the App Group, as the app may
  /// while the widget waits.
  func planHeld(
    _ store: FakeWidgetStore, meanwhile: @Sendable (FakeWidgetStore) -> Void
  ) async throws -> WidgetTimeline.Plan {
    let transport = try heldServer()
    let widget = timeline(store, transport: transport)
    async let plan = widget.plan(at: now)
    #expect(await eventually { transport.requests == 1 })
    meanwhile(store)
    transport.release()
    let planned = await plan
    expectNoPlace(planned)
    #expect(transport.requests == 1)
    return planned
  }

  @Test("it never saves over an answer for the place saved after its request began")
  func itNeverSavesOverANewerAnswer() async throws {
    let newer = try kept(at: later(now, minutes: 1))
    let store = try appGroup()
    let plan = try await planHeld(store) { store in
      store.contents.change { $0.onLoadToday = { $0.today = newer } }
    }
    #expect(plan.source == .fetched)
    #expect(store.saves == 0)
    #expect(store.today == newer)
  }

  @Test("it never saves for a place the app has left, and plans all the same")
  func itNeverSavesForAPlaceTheAppHasLeft() async throws {
    let store = try appGroup()
    let plan = try await planHeld(store) { store in
      store.contents.change { $0.place = .city(slug: "leeds-gb") }
    }
    #expect(plan.source == .fetched)
    #expect(plan.entries.first?.face.place == "Aberdeen")
    #expect(store.saves == 0)
    #expect(store.today == nil)
  }

  @Test("it never saves in units the app has left")
  func itNeverSavesInUnitsTheAppHasLeft() async throws {
    let store = try appGroup()
    let plan = try await planHeld(store) { store in
      store.contents.change { $0.units = .f }
    }
    #expect(plan.source == .fetched)
    #expect(store.saves == 0)
    #expect(store.today == nil)
  }

  @Test("a save that fails still plans")
  func aFailedSaveStillPlans() async throws {
    let store = try appGroup()
    store.contents.change { $0.failsToSave = true }
    let plan = await planned(timeline(store, transport: try aberdeenServer()), at: now)
    #expect(plan.source == .fetched)
    #expect(store.saves == 0)
    expectPlanner(plan, try fixture("aberdeen-snow"), fetchedAt: now, at: now)
  }

  // MARK: - Together

  @Test("two widgets at once ask once and save once")
  func twoWidgetsAtOnceAskOnceAndSaveOnce() async throws {
    let store = try appGroup()
    let transport = try heldServer()
    let gate = FetchGate()
    let widget = timeline(store, transport: transport, gate: gate)
    let query = try #require(widget.client.request(for: aberdeen, units: .c)).url
    async let first = widget.plan(at: now)
    async let second = widget.plan(at: now)
    #expect(await joined(gate, key: query.absoluteString, count: 2))
    transport.release()
    let (one, two) = await (first, second)
    #expect(transport.requests == 1)
    #expect(store.saves == 1)
    #expect(one == two)
    #expect(one.source == .fetched)
  }

  // MARK: - The query

  @Test("the widget asks as the app asks, for every kind of place and units")
  func theWidgetAsksAsTheAppAsks() async throws {
    let places: [Target] = [
      .ip, aberdeen, .coords(.init(source: .search, lat: 39.75, lon: -105, name: "Denver")),
      .device(lat: 53.8, lon: -1.55),
    ]
    for place in places {
      for units in [nil, .c, .f] as [Units?] {
        let transport = try aberdeenServer()
        let widget = timeline(try appGroup(place: place, units: units), transport: transport)
        _ = await planned(widget, at: now)
        let asked = try #require(widget.client.request(for: place, units: units))
        #expect(transport.requests == [asked], "\(place.key) in \(units?.rawValue ?? "none")")
      }
    }
  }

  // MARK: - Names

  @Test("it names the place as the app does: its own name, else the answer's")
  @MainActor
  func itNamesThePlaceAsTheAppDoes() async throws {
    let places: [(Target, String)] = [
      (.city(slug: "aberdeen-gb", name: "Old Aberdeen"), "Old Aberdeen"),
      (aberdeen, "Aberdeen"),
      (
        .coords(.init(source: .search, lat: 57.15, lon: -2.1, name: "Bridge of Don")),
        "Bridge of Don"
      ),
      (.ip, "Aberdeen"),
      (.city(slug: "aberdeen-gb", name: ""), "Aberdeen"),
    ]
    for (place, name) in places {
      let plan = await timeline(try appGroup(place: place), transport: try aberdeenServer())
        .plan(at: now)
      #expect(plan.entries.first?.face.place == name, "\(place)")
      let app = Harness(
        now: now, store: .init(place: place, units: .c),
        replies: [try FakeTransport.fixture("aberdeen-snow")])
      await app.model.launch()
      #expect(app.model.placeName == name, "\(place)")
    }
  }

  // MARK: - Faces

  @Test(
    "each entry's face is the presenter's own, in the answer's unit",
    arguments: [("aberdeen-snow", Units.c), ("denver-f", .f)])
  func theFacesAreThePresentersOwn(_ fixtureName: String, _ units: Units) async throws {
    let now = try fixtureNow(fixtureName)
    let plan = await planned(
      timeline(
        try appGroup(place: try fixtureTarget(fixtureName), units: units),
        transport: FakeTransport([try FakeTransport.fixture(fixtureName)])),
      at: now)
    #expect(plan.source == .fetched)
    expectPlanner(plan, try fixture(fixtureName), fetchedAt: now, at: now)
  }

  @Test("a locked plan is the locked face, dated now")
  func aLockedPlanIsTheLockedFace() async throws {
    let plan = await planned(
      timeline(try appGroup(unlocked: false), transport: try aberdeenServer()), at: now)
    let locked = WidgetPlanner.entries(nil, fetchedAt: now, now: now, unlocked: false)
    #expect(plan.entries.map(\.date) == [now])
    #expect(plan.entries.map(\.face) == locked.entries.map { WidgetFace($0, unit: .cm) })
    #expect(plan.entries.first?.face.link == "willitsnow://upgrade")
  }

  // MARK: - The snapshot

  @Test("the snapshot never asks the server or StoreKit, even with an old answer")
  func theSnapshotNeverAsks() throws {
    let saved = try kept(minutesAgo: 120)
    let transport = try aberdeenServer()
    let entitlements = FakeEntitlements([fact(id: 1)])
    let widget = timeline(
      try appGroup(today: saved), transport: transport, entitlements: entitlements)
    let plan = widget.saved(at: now)
    #expect(transport.requests.isEmpty)
    #expect(entitlements.calls == 0)
    #expect(plan.source == .saved)
    #expect(plan.storeKit == .unasked)
    expectPlanner(plan, saved.response, fetchedAt: saved.savedAt, at: now)
    let none = timeline(try appGroup(), transport: transport, entitlements: entitlements)
      .saved(at: now)
    #expect(none.source == .none)
    #expect(none.entries.map(\.face.state) == [.stale])
    #expect(transport.requests.isEmpty)
    #expect(entitlements.calls == 0)
  }

  @Test("the snapshot follows the flag: locked, locked for an hour without one, else the answer")
  func theSnapshotFollowsTheFlag() throws {
    let saved = try kept(minutesAgo: 10)
    let snapshot = { (unlocked: Bool?) in
      timeline(try appGroup(unlocked: unlocked, today: saved), transport: self.offline())
        .saved(at: now)
    }
    let locked = try snapshot(false)
    #expect(locked.entries.map(\.face.state) == [.locked])
    #expect(locked.reload == .never)
    #expect((locked.unlock, locked.source, locked.storeKit) == (.no, .locked, .unasked))
    let noFlag = try snapshot(nil)
    #expect(noFlag.entries.map(\.face.state) == [.locked])
    #expect(noFlag.reload == .after(later(now, minutes: 60)))
    let unlocked = try snapshot(true)
    #expect((unlocked.unlock, unlocked.source, unlocked.storeKit) == (.flag, .saved, .unasked))
    expectPlanner(unlocked, saved.response, fetchedAt: saved.savedAt, at: now)
  }

  // MARK: - The sample

  @Test("the gallery shows tomorrow's snow in Durham, dated now")
  func theGalleryShowsTomorrowsSnowInDurham() throws {
    let entry = WidgetTimeline.sample(at: now)
    #expect(entry.date == now)
    #expect(entry.face == WidgetFace.sample)
    #expect(entry.face.place == "Durham")
    #expect(entry.face.slotAnswer == "Tomorrow · Yes.")
  }

  @Test("the sample needs no store, no server and no StoreKit")
  func theSampleNeedsNoStore() {
    let entry = WidgetTimeline.sample(at: .distantPast)
    #expect(entry.date == .distantPast)
    #expect(entry.face.state == .ok)
    #expect(entry.face.band == .snow)
  }
}
