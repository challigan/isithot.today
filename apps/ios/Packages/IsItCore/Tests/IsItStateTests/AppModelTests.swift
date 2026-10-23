import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItTestSupport
import Testing

/// AppModel's launch order and refresh rules (iOS build spec, sections 9.4 and 9.5), with a
/// fake server, clock, store, widgets and later phases.
@MainActor
@Suite("The app's launch")
struct AppModelLaunchTests {
  static let aberdeenURL =
    "https://willitsnow.today/api/v1/today?place=aberdeen-gb&units=c&ahead=snow"

  /// aberdeen-snow saved for its place at its own moment, opened `minutes` later, with the
  /// server answering `replies`.
  func openAberdeen(
    after minutes: Double,
    replies: [FakeTransport.Reply],
    hooks: RecordingHooks = RecordingHooks()
  ) throws -> Harness {
    let saved = try savedAberdeen()
    return Harness(
      now: later(saved.savedAt, minutes: minutes),
      store: .init(place: aberdeen, units: .c, today: saved),
      replies: replies,
      hooks: hooks
    )
  }

  @Test("the saved answer for the place is painted at once, then refreshed and saved")
  func paintedThenRefreshed() async throws {
    let h = try openAberdeen(after: 15, replies: [try FakeTransport.fixture("aberdeen-snow")])
    let saved = try savedAberdeen()
    let opened = h.clock.now
    // Painted before anything is fetched, in the view for the time of day.
    #expect(h.model.response == saved.response)
    #expect(h.model.fetchedAt == saved.savedAt)
    #expect(h.model.phase == .ready)
    #expect(h.model.view == .today)
    #expect(h.model.target == aberdeen)
    #expect(h.model.units == .c)
    #expect(h.transport.requests.isEmpty)
    #expect(
      h.model.answer(at: opened)
        == .answer(try #require(HourPicker.pick(saved.response, at: opened))))

    await h.model.launch()
    #expect(h.transport.urls == [Self.aberdeenURL])
    #expect(h.model.phase == .ready)
    #expect(h.model.fetchedAt == opened)
    // Saved for the place at the time fetched, and the widgets told.
    #expect(
      h.store.today
        == SavedToday(key: "city:aberdeen-gb", savedAt: opened, response: saved.response))
    #expect(h.store.saves == 1)
    #expect(h.widgets.reloads == 1)
    // The next quiet refresh: the next forecast hour, 10:00, plus the jitter.
    let refresh = later(saved.savedAt, minutes: 55).addingTimeInterval(45)
    #expect(h.model.nextRefreshAt == refresh)
    #expect(h.clock.pending == [refresh])
    // Steps 2 and 5 to 7 are the later phases' hooks; no location fix for a city page's place.
    #expect(
      h.hooks.calls == [
        "startEntitlementCheck", "entitlement", "startAds", "syncAlerts city:aberdeen-gb c",
      ])
  }

  @Test("an answer saved under 10 minutes ago is kept without asking, and refreshed on the hour")
  func reusedWithinTenMinutes() async throws {
    let h = try openAberdeen(after: 9.99, replies: [try FakeTransport.fixture("aberdeen-snow")])
    await h.model.launch()
    #expect(h.transport.requests.isEmpty)
    #expect(h.store.saves == 0)
    #expect(h.widgets.reloads == 0)
    #expect(h.model.phase == .ready)
    let saved = try savedAberdeen()
    let refresh = later(saved.savedAt, minutes: 55).addingTimeInterval(45)
    #expect(h.clock.pending == [refresh])

    // On the hour the answer is out of date, so the refresh asks past the caches if the new
    // answer is out of date too, which the fake server's is: then it holds.
    #expect(await h.clock.runNext())
    #expect(h.transport.urls == [Self.aberdeenURL, Self.aberdeenURL + "&t=498946"])
    #expect(h.model.holds.hour?.until == later(saved.savedAt, minutes: 55))
    #expect(h.model.fetchedAt == refresh)
    #expect(h.store.saves == 1)
  }

  @Test("an answer saved 10 minutes ago is fetched again")
  func fetchedAtTenMinutes() async throws {
    let h = try openAberdeen(after: 10, replies: [try FakeTransport.fixture("aberdeen-snow")])
    await h.model.launch()
    #expect(h.transport.urls == [Self.aberdeenURL])
  }

  @Test("offline, the picked hour shows until the answer's hours run out, then the stale state")
  func offline() async throws {
    let h = try openAberdeen(after: 15, replies: [.failure(.notConnectedToInternet)])
    let saved = try savedAberdeen()
    await h.model.launch()
    #expect(h.model.phase == .offline)
    #expect(h.model.response == saved.response)
    #expect(h.model.fetchedAt == saved.savedAt)
    #expect(h.store.saves == 0)
    #expect(h.widgets.reloads == 0)
    #expect(
      h.model.offlineLine(at: h.clock.now)
        == "You're offline. Showing the forecast from 9:05am GMT.")
    // The hours ahead take over as they start, as long as the answer is usable.
    let eleven = later(saved.savedAt, minutes: 115)
    let picked = try #require(HourPicker.pick(saved.response, at: eleven))
    #expect(picked.source == .ahead)
    #expect(h.model.answer(at: eleven) == .answer(picked))
    let until = Freshness.usableUntil(saved.response)
    #expect(h.model.answer(at: until.addingTimeInterval(-0.001)) != .stale)
    #expect(h.model.answer(at: until) == .stale)
    // It asks again quietly a minute later, plus the jitter.
    #expect(h.clock.pending == [h.clock.now.addingTimeInterval(105)])
  }

  @Test("back online, the retry shows the new answer")
  func backOnline() async throws {
    let h = try openAberdeen(
      after: 15,
      replies: [.failure(.networkConnectionLost), try FakeTransport.fixture("aberdeen-snow")]
    )
    await h.model.launch()
    #expect(h.model.phase == .offline)
    #expect(await h.clock.runNext())
    #expect(h.model.phase == .ready)
    #expect(h.model.offlineLine(at: h.clock.now) == nil)
    #expect(h.store.saves == 1)
  }

  @Test("a fetch that fails with nothing saved shows the error, and doesn't retry by itself")
  func errorWithNothingSaved() async throws {
    let made = try fixtureNow("leeds-dry")
    let h = Harness(
      now: made,
      store: .init(place: .city(slug: "leeds-gb"), units: .c),
      replies: [
        try FakeTransport.error(503, code: "upstream_unavailable"),
        try FakeTransport.fixture("leeds-dry"),
      ]
    )
    #expect(h.model.phase == .loading)
    #expect(h.model.answer(at: made) == .loading)
    await h.model.launch()
    let failure = FetchError.failed(
      status: 503,
      code: "upstream_unavailable",
      message: CoreCopy.unavailable
    )
    #expect(h.model.phase == .error(failure))
    #expect(h.model.answer(at: made) == .error(failure))
    #expect(h.model.response == nil)
    #expect(h.model.nextRefreshAt == nil)
    #expect(h.clock.pending.isEmpty)

    // "Try again".
    await h.model.refresh()
    #expect(h.model.phase == .ready)
    #expect(h.model.response == (try fixture("leeds-dry")))
    #expect(h.store.saves == 1)
  }

  @Test("offline with nothing saved says so, and tries again a minute later")
  func offlineWithNothingSaved() async throws {
    let made = try fixtureNow("leeds-dry")
    let h = Harness(
      now: made,
      store: .init(place: .city(slug: "leeds-gb"), units: .c),
      replies: [.failure(.timedOut)]
    )
    await h.model.launch()
    #expect(h.model.phase == .offline)
    #expect(h.model.answer(at: made) == .offline)
    #expect(h.model.offlineLine(at: made) == nil)
    #expect(h.clock.pending == [made.addingTimeInterval(105)])
  }

  @Test("rate limited: kept as offline, and asked again a minute later")
  func rateLimited() async throws {
    let h = try openAberdeen(
      after: 15, replies: [try FakeTransport.error(429, code: "rate_limited")])
    await h.model.launch()
    #expect(h.model.phase == .offline)
    #expect(h.model.response == (try savedAberdeen()).response)
    #expect(h.clock.pending == [h.clock.now.addingTimeInterval(105)])
  }

  @Test("an error with the answer on screen keeps it, and waits for the next hour")
  func errorWithAnswer() async throws {
    let h = try openAberdeen(
      after: 15, replies: [try FakeTransport.error(503, code: "upstream_unavailable")])
    await h.model.launch()
    guard case .error = h.model.phase else {
      Issue.record("phase \(h.model.phase)")
      return
    }
    let saved = try savedAberdeen()
    #expect(h.model.response == saved.response)
    #expect(h.clock.pending == [later(saved.savedAt, minutes: 55).addingTimeInterval(45)])
  }

  @Test(
    "the first launch asks by IP location, keeps the units the server chose, and asks with them")
  func firstLaunch() async throws {
    let made = try fixtureNow("ip-first-launch")
    let h = Harness(now: made, replies: [try FakeTransport.fixture("ip-first-launch")])
    #expect(h.model.target == .ip)
    #expect(h.model.units == nil)
    await h.model.launch()
    #expect(h.transport.urls == ["https://willitsnow.today/api/v1/today?ahead=snow"])
    #expect(h.model.units == .c)
    #expect(h.store.loadUnits() == .c)
    #expect(h.store.today?.key == "ip")
    #expect(h.model.response?.location.name == "Leeds")
    #expect(h.model.view == .today)
    await h.model.refresh()
    #expect(h.transport.urls.last == "https://willitsnow.today/api/v1/today?units=c&ahead=snow")
    #expect(h.hooks.calls.contains("syncAlerts ip c"))
  }

  @Test("with nothing painted, the first answer opens on the view for the time of day")
  func firstAnswerView() async throws {
    // Durham at 6:05pm: the middle view shows tomorrow, so the app opens on Now.
    let h = Harness(
      now: try fixtureNow("durham-tomorrow"),
      store: .init(place: .city(slug: "durham-gb"), units: .c),
      replies: [try FakeTransport.fixture("durham-tomorrow")]
    )
    #expect(h.model.view == .today)
    await h.model.launch()
    #expect(h.model.view == .now)
  }

  @Test("a saved answer for another place isn't painted")
  func otherPlace() async throws {
    let saved = try savedAberdeen()
    let h = Harness(
      now: later(saved.savedAt, minutes: 1),
      store: .init(place: .city(slug: "leeds-gb"), units: .c, today: saved),
      replies: [try FakeTransport.fixture("leeds-dry")]
    )
    #expect(h.model.response == nil)
    #expect(h.model.phase == .loading)
    await h.model.launch()
    #expect(h.model.response?.location.name == "Leeds")
    #expect(h.store.today?.key == "city:leeds-gb")
  }

  @Test("a city page's place that is gone falls back to IP location, and says so")
  func slugGone() async throws {
    let made = try fixtureNow("ip-first-launch")
    let h = Harness(
      now: made,
      store: .init(place: .city(slug: "atlantis-xx"), units: .c),
      replies: [
        try FakeTransport.error(404, code: "not_found"),
        try FakeTransport.fixture("ip-first-launch"),
      ]
    )
    await h.model.launch()
    #expect(
      h.transport.urls == [
        "https://willitsnow.today/api/v1/today?place=atlantis-xx&units=c&ahead=snow",
        "https://willitsnow.today/api/v1/today?units=c&ahead=snow",
      ])
    #expect(h.model.target == .ip)
    #expect(h.store.loadPlace() == .ip)
    #expect(h.model.notice == AppCopy.slugGone)
    #expect(h.model.phase == .ready)
    #expect(h.store.today?.key == "ip")
    h.model.dismissNotice()
    #expect(h.model.notice == nil)
  }

  @Test("an answer that can't be saved is still shown, and the widgets aren't told")
  func unsaved() async throws {
    var contents = FakeState.Contents(place: aberdeen, units: .c)
    contents.failsToSave = true
    let h = Harness(
      now: try fixtureNow("aberdeen-snow"),
      store: contents,
      replies: [try FakeTransport.fixture("aberdeen-snow")]
    )
    await h.model.launch()
    #expect(h.model.response?.location.name == "Aberdeen")
    #expect(h.widgets.reloads == 0)
    #expect(h.clock.pending.count == 1)
  }

  @Test("launching twice does it once")
  func once() async throws {
    let h = try openAberdeen(after: 15, replies: [try FakeTransport.fixture("aberdeen-snow")])
    await h.model.launch()
    await h.model.launch()
    #expect(h.transport.requests.count == 1)
    #expect(h.hooks.calls.filter { $0 == "startEntitlementCheck" }.count == 1)
  }
}

@MainActor
@Suite("The launch's later steps")
struct AppModelStepTests {
  @Test("unlocked by unlock.v1, or by the entitlement check, the ads never start")
  func unlocked() async throws {
    let saved = try savedAberdeen()
    let stored = Harness(
      now: later(saved.savedAt, minutes: 1),
      store: .init(place: aberdeen, units: .c, unlocked: true, today: saved),
      replies: [try FakeTransport.fixture("aberdeen-snow")]
    )
    #expect(stored.model.unlocked)
    await stored.model.launch()
    #expect(!stored.hooks.calls.contains("startAds"))

    let checked = Harness(
      now: later(saved.savedAt, minutes: 1),
      store: .init(place: aberdeen, units: .c, today: saved),
      replies: [try FakeTransport.fixture("aberdeen-snow")],
      hooks: RecordingHooks(owned: true)
    )
    #expect(!checked.model.unlocked)
    await checked.model.launch()
    #expect(checked.model.unlocked)
    #expect(
      checked.hooks.calls == [
        "startEntitlementCheck", "entitlement", "syncAlerts city:aberdeen-gb c",
      ])
  }

  @Test("the check can also say the purchase is no longer owned")
  func refunded() async throws {
    let saved = try savedAberdeen()
    let h = Harness(
      now: later(saved.savedAt, minutes: 1),
      store: .init(place: aberdeen, units: .c, unlocked: true, today: saved),
      replies: [try FakeTransport.fixture("aberdeen-snow")],
      hooks: RecordingHooks(owned: false)
    )
    await h.model.launch()
    #expect(!h.model.unlocked)
    #expect(h.hooks.calls.contains("startAds"))
  }

  @Test("for My location, one fix after the fetch, and a fetch again only when the cell changed")
  func location() async throws {
    let leeds = Target.device(lat: 53.8, lon: -1.55)
    let moved = Target.device(lat: 53.9, lon: -1.55)
    let made = try fixtureNow("leeds-dry")
    let replies = [try FakeTransport.fixture("leeds-dry")]
    let same = Harness(
      now: made,
      store: .init(place: leeds, units: .c),
      replies: replies,
      hooks: RecordingHooks(moved: leeds)
    )
    await same.model.launch()
    #expect(same.transport.requests.count == 1)
    #expect(same.hooks.calls.contains("locate device:53.8,-1.55"))

    let h = Harness(
      now: made,
      store: .init(place: leeds, units: .c),
      replies: replies,
      hooks: RecordingHooks(moved: moved)
    )
    await h.model.launch()
    #expect(
      h.transport.urls == [
        "https://willitsnow.today/api/v1/today?lat=53.8&lon=-1.55&source=device&units=c&ahead=snow",
        "https://willitsnow.today/api/v1/today?lat=53.9&lon=-1.55&source=device&units=c&ahead=snow",
      ])
    #expect(h.model.target == moved)
    #expect(h.store.loadPlace() == moved)
    #expect(h.store.today?.key == "device:53.9,-1.55")
    #expect(
      h.hooks.calls == [
        "startEntitlementCheck", "locate device:53.8,-1.55", "entitlement", "startAds",
        "syncAlerts device:53.9,-1.55 c",
      ])
  }

  @Test("a route opened during the launch waits for its end; one opened after, at once")
  func routes() async throws {
    let h = Harness(
      now: try fixtureNow("aberdeen-snow"),
      store: .init(place: aberdeen, units: .c),
      replies: [try FakeTransport.fixture("aberdeen-snow")]
    )
    await h.model.open(.upgrade)
    #expect(h.model.route == .upgrade)
    #expect(h.hooks.calls.isEmpty)
    await h.model.launch()
    #expect(h.model.route == nil)
    #expect(h.hooks.calls.last == "handle")
    #expect(h.hooks.routes == [.upgrade])
    await h.model.open(.view(.week))
    #expect(h.hooks.routes == [.upgrade, .view(.week)])
  }
}

@MainActor
@Suite("An open app keeping current")
struct AppModelRefreshTests {
  /// aberdeen-snow, fetched at its own moment by a launch.
  func launched(_ replies: [FakeTransport.Reply]) async throws -> Harness {
    let h = Harness(
      now: try fixtureNow("aberdeen-snow"),
      store: .init(place: aberdeen, units: .c),
      replies: replies
    )
    await h.model.launch()
    return h
  }

  @Test("the quiet refresh comes each forecast hour, plus the jitter")
  func hourly() async throws {
    let h = try await launched([try FakeTransport.fixture("aberdeen-snow")])
    let made = try fixtureNow("aberdeen-snow")
    #expect(h.clock.pending == [later(made, minutes: 55).addingTimeInterval(45)])
    #expect(await h.clock.runNext())
    #expect(h.transport.requests.count == 3)  // out of date, so once more past the caches
    #expect(h.model.view == .today)
    // The fake server's answer is the same one, so the next hour is its series' next, 11:00.
    #expect(h.clock.pending == [later(made, minutes: 115).addingTimeInterval(45)])
  }

  @Test("in the background nothing is scheduled; back soon, the refresh is scheduled again")
  func backSoon() async throws {
    let h = try await launched([try FakeTransport.fixture("aberdeen-snow")])
    let made = try fixtureNow("aberdeen-snow")
    h.clock.now = later(made, minutes: 10)
    h.model.didEnterBackground()
    #expect(h.clock.pending.isEmpty)
    #expect(h.model.nextRefreshAt == nil)
    h.model.view = .week
    h.clock.now = later(made, minutes: 20)
    await h.model.willEnterForeground()
    #expect(h.transport.requests.count == 1)
    #expect(h.model.view == .week)
    #expect(h.clock.pending == [later(made, minutes: 55).addingTimeInterval(45)])
  }

  @Test("back after more than 30 minutes, the view for the time of day, and a fetch")
  func backLater() async throws {
    let h = try await launched([try FakeTransport.fixture("aberdeen-snow")])
    let made = try fixtureNow("aberdeen-snow")
    h.clock.now = later(made, minutes: 2)
    h.model.didEnterBackground()
    h.model.view = .week
    h.clock.now = later(made, minutes: 33)
    await h.model.willEnterForeground()
    #expect(h.model.view == .today)
    #expect(h.transport.requests.count == 2)
    #expect(h.model.fetchedAt == later(made, minutes: 33))
  }

  @Test("back past the hour, a fetch past the caches")
  func backOutOfDate() async throws {
    let h = try await launched([try FakeTransport.fixture("aberdeen-snow")])
    let made = try fixtureNow("aberdeen-snow")
    h.clock.now = later(made, minutes: 50)
    h.model.didEnterBackground()
    h.clock.now = later(made, minutes: 56)
    await h.model.willEnterForeground()
    #expect(h.transport.urls.last?.hasSuffix("&t=498946") == true)
    #expect(h.model.holds.hour != nil)
  }

  @Test("coming to the foreground without having left does nothing")
  func notAway() async throws {
    let h = try await launched([try FakeTransport.fixture("aberdeen-snow")])
    await h.model.willEnterForeground()
    #expect(h.transport.requests.count == 1)
  }

  @Test("an answer arriving in the background schedules nothing until the app is back")
  func answerInBackground() async throws {
    let made = try fixtureNow("aberdeen-snow")
    let h = Harness(
      now: made,
      store: .init(place: aberdeen, units: .c),
      replies: [try FakeTransport.fixture("aberdeen-snow")]
    )
    h.model.didEnterBackground()
    await h.model.launch()
    #expect(h.model.response != nil)
    #expect(h.clock.pending.isEmpty)
    await h.model.willEnterForeground()
    #expect(h.transport.requests.count == 1)
    #expect(h.clock.pending.count == 1)
  }
}

@MainActor
@Suite("Fetches that overlap")
struct AppModelOverlapTests {
  @Test("a newer fetch's answer wins over an older one that arrives after it")
  func newerWins() async throws {
    let transport = GatedTransport(
      first: HTTPResponse(status: 200, body: try Fixtures.data("aberdeen-snow")),
      others: HTTPResponse(status: 200, body: try Fixtures.data("leeds-dry"))
    )
    let store = FakeState(.init(place: .city(slug: "leeds-gb"), units: .c))
    let model = AppModel(
      environment: AppEnvironment(
        client: APIClient(transport: transport),
        clock: TestClock(try fixtureNow("leeds-dry")),
        store: store,
        widgets: FakeWidgets(),
        hooks: NoHooks(),
        random: { _ in 0 }
      ))
    let launch = Task { await model.launch() }
    var turns = 0
    while transport.requests < 1 && turns < 100_000 {
      turns += 1
      await Task.yield()
    }
    try #require(transport.requests == 1, "the launch's fetch never started")
    await model.refresh()
    #expect(model.response?.location.name == "Leeds")
    transport.release()
    await launch.value
    #expect(model.response?.location.name == "Leeds")
    #expect(store.saves == 1)
  }
}
