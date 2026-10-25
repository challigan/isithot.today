import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItTestSupport
import Testing

/// aberdeen-snow's answer as if for Dundee, one of its places nearby: the fake server's answer
/// when the app loads Dundee in place.
func dundee() throws -> HTTPResponse {
  var json = try #require(
    JSONSerialization.jsonObject(with: Fixtures.data("aberdeen-snow")) as? [String: Any])
  var location = try #require(json["location"] as? [String: Any])
  location["name"] = "Dundee"
  json["location"] = location
  return HTTPResponse(status: 200, body: try JSONSerialization.data(withJSONObject: json))
}

let dundeeTarget = Target.city(slug: "dundee-gb", name: "Dundee")

/// What the home screen draws from AppModel (iOS build spec, sections 9.4, 9.5 and 10.2): the
/// top bar and the Today page in each of the model's states, at the model's clock.
@MainActor
@Suite("The home screen, from the model")
struct HomeScreenTests {
  @Test("the first launch, with nothing stored, asks by IP and shows the approximate place")
  func firstLaunch() async throws {
    let made = try fixtureNow("ip-first-launch")
    let h = Harness(now: made, replies: [try FakeTransport.fixture("ip-first-launch")])
    // Before the answer: no place yet, on approximate location, checking.
    #expect(h.model.now == made)
    #expect(h.model.placeName == nil)
    #expect(h.model.topBar == HomeTopBar(placeName: nil, approximate: true))
    #expect(h.model.topBar.place == "Finding you…")
    #expect(h.model.topBar.placeLabel == "Finding you…, change place.")
    // The website's chip, with no line beside it: "Using approximate location." is its hint.
    #expect(h.model.topBar.approximate == nil)
    #expect(h.model.topBar.useMyLocation == "Use my exact location")
    let checking = h.model.page(.today, at: h.model.now)
    #expect(checking.state == .loading)
    #expect(checking.headingLabel == "Will it snow today? Checking…")

    await h.model.launch()
    #expect(h.transport.urls == ["https://willitsnow.today/api/v1/today?ahead=snow"])
    #expect(h.model.placeName == "Leeds")
    let bar = h.model.topBar
    #expect(bar.placeLabel == "Place: Leeds. Change place.")
    #expect(bar.approximate == nil)
    #expect(bar.useMyLocation == "Use my exact location")
    let page = h.model.page(.today, at: h.model.now)
    #expect(
      page
        == HomePage(
          try fixture("ip-first-launch"), view: .today, at: made, phase: .ready, placeName: "Leeds"
        ))
    #expect(page.state == .ready)
    #expect(page.headingLabel == "Leeds. Will it snow today? No.")
    #expect(page.footer?.updated == "Updated 12:05pm GMT")
    #expect(page.footer?.notice == nil)
    // The page is drawn at the model's clock as it moves.
    h.clock.now = later(made, minutes: 3)
    #expect(h.model.now == later(made, minutes: 3))
  }

  @Test("a failure with nothing saved: the error with Retry, which recovers")
  func errorThenRetry() async throws {
    let made = try fixtureNow("leeds-dry")
    let h = Harness(
      now: made,
      store: .init(place: .city(slug: "leeds-gb", name: "Leeds"), units: .c),
      replies: [
        try FakeTransport.error(503, code: "upstream_unavailable"),
        try FakeTransport.fixture("leeds-dry"),
      ]
    )
    await h.model.launch()
    let error = h.model.page(.today, at: h.model.now)
    #expect(error.state == .error)
    #expect(
      error.headingLabel
        == "Leeds. Will it snow today? Forecasts are unavailable right now. Try again in a few minutes."
    )
    #expect(error.retry == "Retry")
    #expect(error.palette == Palettes.Snow.nosnow)
    // A city page's place is named before its answer, and isn't approximate.
    #expect(h.model.topBar.place == "Leeds")
    #expect(h.model.topBar.approximate == nil)
    #expect(h.model.topBar.useMyLocation == nil)

    // Retry.
    await h.model.refresh()
    let page = h.model.page(.today, at: h.model.now)
    #expect(page.state == .ready)
    #expect(page.headingLabel == "Leeds. Will it snow today? No.")
    #expect(page.retry == nil)
  }

  @Test("offline with nothing saved: no recent forecast, with Retry")
  func offlineWithNothing() async throws {
    let made = try fixtureNow("leeds-dry")
    let h = Harness(
      now: made,
      store: .init(place: .city(slug: "leeds-gb", name: "Leeds"), units: .c),
      replies: [.failure(.notConnectedToInternet)]
    )
    await h.model.launch()
    let page = h.model.page(.today, at: h.model.now)
    #expect(page.state == .error)
    #expect(
      page.headingLabel
        == "Leeds. Will it snow today? No recent forecast. Connect to the internet to refresh.")
    #expect(page.retry == "Retry")
    #expect(page.footer == nil)
    #expect(page.answer == FetchError.offline.message)
  }

  @Test("offline with the saved answer: its hour, the footer's offline line, then the stale state")
  func offlineWithAnswer() async throws {
    let saved = try savedAberdeen()
    let h = Harness(
      now: later(saved.savedAt, minutes: 15),
      store: .init(place: aberdeen, units: .c, today: saved),
      replies: [.failure(.notConnectedToInternet)]
    )
    // Painted before anything is fetched.
    #expect(h.model.page(.today, at: h.model.now).state == .ready)
    await h.model.launch()
    #expect(h.model.phase == .offline)
    let page = h.model.page(.today, at: h.model.now)
    #expect(page.state == .ready)
    #expect(page.headingLabel == "Aberdeen. Will it snow today? Yes.")
    #expect(page.retry == nil)
    #expect(page.footer?.notice == "You're offline. Showing the forecast from 9:05am GMT.")
    #expect(page.footer?.notice == h.model.offlineLine(at: h.model.now))
    // From usableUntil on, never the old hour.
    let until = Freshness.usableUntil(saved.response)
    #expect(h.model.page(.today, at: until.addingTimeInterval(-0.001)).state == .ready)
    let stale = h.model.page(.today, at: until)
    #expect(stale.state == .noRecent)
    #expect(stale.answer == AppCopy.staleApp)
    #expect(stale.verdict == nil && stale.day == nil && stale.band == nil)
    #expect(h.model.answer(at: until) == .stale)
  }

  @Test("an error with the answer on screen keeps it, says forecasts are unavailable, with Retry")
  func errorWithAnswer() async throws {
    let saved = try savedAberdeen()
    let h = Harness(
      now: later(saved.savedAt, minutes: 15),
      store: .init(place: aberdeen, units: .c, today: saved),
      replies: [
        try FakeTransport.error(503, code: "upstream_unavailable"),
        try FakeTransport.fixture("aberdeen-snow"),
      ]
    )
    await h.model.launch()
    let page = h.model.page(.today, at: h.model.now)
    #expect(page.state == .ready)
    #expect(page.headingLabel == "Aberdeen. Will it snow today? Yes.")
    #expect(page.retry == "Retry")
    #expect(
      page.footer?.notice == "Forecasts are unavailable right now. Try again in a few minutes.")
    #expect(h.model.offlineLine(at: h.model.now) == nil)
    // Retry.
    await h.model.refresh()
    let again = h.model.page(.today, at: h.model.now)
    #expect(again.retry == nil)
    #expect(again.footer?.notice == nil)
  }

  @Test("rate limited with the answer on screen: kept quietly, never offline, and no Retry")
  func rateLimitedWithAnswer() async throws {
    let saved = try savedAberdeen()
    let h = Harness(
      now: later(saved.savedAt, minutes: 15),
      store: .init(place: aberdeen, units: .c, today: saved),
      replies: [try FakeTransport.error(429, code: "rate_limited")]
    )
    await h.model.launch()
    let page = h.model.page(.today, at: h.model.now)
    #expect(page.state == .ready)
    #expect(page.headingLabel == "Aberdeen. Will it snow today? Yes.")
    #expect(page.retry == nil)
    #expect(page.footer?.notice == nil)
    #expect(h.model.offlineLine(at: h.model.now) == nil)
    #expect(
      page
        == HomePage(
          saved.response, view: .today, at: h.model.now, phase: .ready, placeName: "Aberdeen"))
  }

  @Test("rate limited with nothing saved: core's words for it, with Retry, never offline")
  func rateLimitedWithNothing() async throws {
    let h = Harness(
      now: try fixtureNow("leeds-dry"),
      store: .init(place: .city(slug: "leeds-gb", name: "Leeds"), units: .c),
      replies: [try FakeTransport.error(429, code: "rate_limited")]
    )
    await h.model.launch()
    let page = h.model.page(.today, at: h.model.now)
    #expect(page.state == .error)
    #expect(
      page.headingLabel == "Leeds. Will it snow today? Too many requests. Try again in a minute.")
    #expect(page.answer == FetchError.rateLimited.message)
    #expect(page.retry == "Retry")
    // It asks again by itself a minute later, plus the jitter.
    #expect(h.clock.pending == [h.clock.now.addingTimeInterval(105)])
  }

  @Test("an error with nothing saved says the server's message, or that forecasts are unavailable")
  func serverMessageWithNothing() async throws {
    let searched = Target.coords(.init(source: .search, lat: 53.8, lon: -1.55, name: "Leeds"))
    let h = Harness(
      now: try fixtureNow("leeds-dry"),
      store: .init(place: searched, units: .c),
      replies: [
        try FakeTransport.error(400, code: "bad_location"),
        .answer(HTTPResponse(status: 500, body: Data())),
      ]
    )
    await h.model.launch()
    let bad = h.model.page(.today, at: h.model.now)
    #expect(bad.state == .error)
    #expect(bad.answer == "Latitude and longitude must be decimal degrees.")
    #expect(bad.answer != CoreCopy.unavailable)
    #expect(bad.answer == h.model.phase.serverMessage)
    #expect(bad.retry == "Retry")
    // A failure with no message of the server's.
    await h.model.refresh()
    #expect(h.model.phase.serverMessage == nil)
    let none = h.model.page(.today, at: h.model.now)
    #expect(none.answer == "Forecasts are unavailable right now. Try again in a few minutes.")
  }

  @Test("the page and AnswerState agree, for every fixture, moment and phase")
  func agreesWithAnswerState() throws {
    let phases: [AppPhase] = [
      .loading, .ready, .offline, .error(.rateLimited),
      .error(.failed(status: 503, code: "upstream_unavailable", message: CoreCopy.unavailable)),
      .error(
        .failed(
          status: 400, code: "bad_location",
          message: "Latitude and longitude must be decimal degrees.")),
      .error(.failed(status: 500, code: nil, message: nil)),
    ]
    var checked = 0
    for name in try Fixtures.names() {
      let res = try fixture(name)
      let until = Freshness.usableUntil(res)
      for now in [try fixtureNow(name), until.addingTimeInterval(-0.001), until] {
        for phase in phases {
          let state = AnswerState.at(now, response: res, phase: phase)
          let page = HomePage(
            res, view: .today, at: now, phase: HomePage.Phase(phase),
            message: phase.serverMessage)
          switch state {
          case .answer:
            #expect(page.state == .ready || page.state == .notAvailable, "\(name) at \(now)")
          case .stale:
            #expect(
              page.state == .noRecent || (res.snow == nil && page.state == .notAvailable),
              "\(name) at \(now)")
          case .loading, .offline, .error:
            Issue.record("\(name) at \(now): \(state) with an answer")
          }
          // Offline, while there is a forecast to show, the footer's line is AnswerState's; it
          // has none in any other phase, a 429 included.
          if phase == .offline, page.state != .noRecent {
            #expect(
              page.footer?.notice == AnswerState.offlineLine(res, phase: phase, at: now),
              "\(name) at \(now)")
          }
          if phase != .offline {
            #expect(AnswerState.offlineLine(res, phase: phase, at: now) == nil)
          }
          checked += 1
        }
      }
    }
    #expect(checked >= 21 * 3 * 7)
    let moment = try fixtureNow("leeds-dry")
    for phase in phases {
      let page = HomePage(
        nil, view: .today, at: moment, phase: HomePage.Phase(phase),
        message: phase.serverMessage)
      switch AnswerState.at(moment, response: nil, phase: phase) {
      case .loading:
        #expect(page.state == .loading && page.answer == CoreCopy.checking)
      case .offline:
        #expect(page.state == .error && page.answer == FetchError.offline.message)
      case .error(let failure):
        #expect(page.state == .error && page.answer == failure.message)
      case .answer, .stale:
        Issue.record("an answer with none")
      }
    }
  }

  @Test("each phase is the page's")
  func phases() {
    #expect(HomePage.Phase(AppPhase.loading) == .loading)
    #expect(HomePage.Phase(AppPhase.ready) == .ready)
    #expect(HomePage.Phase(AppPhase.offline) == .offline)
    #expect(HomePage.Phase(AppPhase.error(.failed(status: 400, code: nil, message: nil))) == .error)
    #expect(HomePage.Phase(AppPhase.error(.rateLimited)) == .limited)
  }

  @Test("the server's message, only for a failure that came with one")
  func serverMessage() {
    let said = "Latitude and longitude must be decimal degrees."
    let bad = AppPhase.error(.failed(status: 400, code: "bad_location", message: said))
    #expect(bad.serverMessage == said)
    #expect(AppPhase.error(.failed(status: 503, code: nil, message: "")).serverMessage == nil)
    #expect(AppPhase.error(.failed(status: 500, code: nil, message: nil)).serverMessage == nil)
    for phase in [AppPhase.loading, .ready, .offline, .error(.rateLimited)] {
      #expect(phase.serverMessage == nil)
    }
  }

  @Test("the place's name: its own, else the answer's, and never an empty one")
  func placeName() async throws {
    let saved = try savedAberdeen()
    let named = Harness(
      now: later(saved.savedAt, minutes: 1),
      store: .init(place: .city(slug: "aberdeen-gb", name: "Old Aberdeen"), units: .c),
      replies: [.failure(.notConnectedToInternet)]
    )
    #expect(named.model.placeName == "Old Aberdeen")
    let unnamed = Harness(
      now: later(saved.savedAt, minutes: 1),
      store: .init(place: .city(slug: "aberdeen-gb", name: ""), units: .c),
      replies: [try FakeTransport.fixture("aberdeen-snow")]
    )
    #expect(unnamed.model.placeName == nil)
    await unnamed.model.launch()
    #expect(unnamed.model.placeName == "Aberdeen")
    let searched = Harness(
      now: try fixtureNow("denver-f"),
      store: .init(
        place: .coords(.init(source: .search, lat: 39.75, lon: -105, name: "Denver")),
        units: .f),
      replies: [.failure(.notConnectedToInternet)]
    )
    #expect(searched.model.placeName == "Denver")
    #expect(searched.model.topBar.approximate == nil)
    #expect(searched.model.topBar.useMyLocation == nil)
  }
}

@MainActor
@Suite("A nearby place, loaded in place")
struct NearbyTests {
  /// aberdeen-snow saved a minute ago for its place, so the launch keeps it without asking.
  func openAberdeen(replies: [FakeTransport.Reply]) throws -> Harness {
    let saved = try savedAberdeen()
    return Harness(
      now: later(saved.savedAt, minutes: 1),
      store: .init(place: aberdeen, units: .c, today: saved),
      replies: replies
    )
  }

  @Test("becomes the place, is asked for, saved and shown under its own name")
  func loaded() async throws {
    let h = try openAberdeen(replies: [.answer(try dundee())])
    await h.model.launch()
    #expect(h.transport.requests.isEmpty)
    let nearby = try #require(h.model.page(.today, at: h.model.now).footer?.nearby.first)
    #expect(nearby.slug == "dundee-gb" && nearby.name == "Dundee")

    await h.model.select(.city(slug: nearby.slug, name: nearby.name))
    #expect(
      h.transport.urls == [
        "https://willitsnow.today/api/v1/today?place=dundee-gb&units=c&ahead=snow"
      ]
    )
    #expect(h.model.target == dundeeTarget)
    #expect(h.store.loadPlace() == dundeeTarget)
    #expect(h.store.today?.key == "city:dundee-gb")
    #expect(h.widgets.reloads == 1)
    #expect(h.model.topBar.place == "Dundee")
    #expect(h.model.topBar.approximate == nil)
    #expect(h.model.topBar.useMyLocation == nil)
    let page = h.model.page(.today, at: h.model.now)
    #expect(page.state == .ready)
    #expect(page.headingLabel == "Dundee. Will it snow today? Yes.")
    #expect(h.model.nextRefreshAt != nil)
  }

  @Test("while it is asked for, the page is checking under its name, never the last answer")
  func checkingMeanwhile() async throws {
    let saved = try savedAberdeen()
    let transport = GatedTransport(first: try dundee(), others: try dundee())
    let store = FakeState(.init(place: aberdeen, units: .c, today: saved))
    let model = AppModel(
      environment: AppEnvironment(
        client: APIClient(transport: transport),
        clock: TestClock(later(saved.savedAt, minutes: 1)),
        store: store,
        widgets: FakeWidgets(),
        hooks: NoHooks(),
        random: { _ in 0 }
      ))
    await model.launch()
    #expect(transport.requests == 0)
    let selecting = Task { await model.select(dundeeTarget) }
    var turns = 0
    while transport.requests < 1 && turns < 100_000 {
      turns += 1
      await Task.yield()
    }
    try #require(transport.requests == 1, "the nearby place's fetch never started")
    #expect(model.response == nil)
    #expect(model.phase == .loading)
    #expect(model.nextRefreshAt == nil)
    #expect(model.topBar.place == "Dundee")
    let checking = model.page(.today, at: model.now)
    #expect(checking.state == .loading)
    #expect(checking.headingLabel == "Dundee. Will it snow today? Checking…")
    #expect(checking.footer == nil)
    transport.release()
    await selecting.value
    #expect(model.page(.today, at: model.now).headingLabel == "Dundee. Will it snow today? Yes.")
  }

  @Test("offline, it says so under its name, and asks again a minute later")
  func offline() async throws {
    let h = try openAberdeen(replies: [.failure(.notConnectedToInternet)])
    await h.model.launch()
    await h.model.select(dundeeTarget)
    #expect(h.model.response == nil)
    let page = h.model.page(.today, at: h.model.now)
    #expect(page.state == .error)
    #expect(
      page.headingLabel
        == "Dundee. Will it snow today? No recent forecast. Connect to the internet to refresh.")
    #expect(page.retry == "Retry")
    #expect(h.clock.pending.last == h.clock.now.addingTimeInterval(105))
    // The last place's answer stays saved for its key until the new one replaces it.
    #expect(h.store.today?.key == "city:aberdeen-gb")
  }

  @Test("the place on screen again only asks again")
  func samePlace() async throws {
    let h = try openAberdeen(replies: [try FakeTransport.fixture("aberdeen-snow")])
    await h.model.launch()
    await h.model.select(aberdeen)
    #expect(
      h.transport.urls == [
        "https://willitsnow.today/api/v1/today?place=aberdeen-gb&units=c&ahead=snow"
      ]
    )
    #expect(h.model.response?.location.name == "Aberdeen")
    #expect(h.store.contents.read(\.placeSaves) == 0)
  }

  @Test("a city page's place that is gone says why in the top bar, until a place is chosen")
  func slugGoneNotice() async throws {
    let h = Harness(
      now: try fixtureNow("ip-first-launch"),
      store: .init(place: .city(slug: "atlantis-xx"), units: .c),
      replies: [
        try FakeTransport.error(404, code: "not_found"),
        try FakeTransport.fixture("ip-first-launch"),
      ]
    )
    await h.model.launch()
    #expect(h.model.target == .ip)
    #expect(
      h.model.topBar.approximate
        == "That place is no longer available. Showing your approximate location.")
    #expect(h.model.topBar.useMyLocation == "Use my exact location")
    #expect(h.model.topBar.place == "Leeds")
    let nearby = try #require(h.model.page(.today, at: h.model.now).footer?.nearby.first)
    await h.model.select(.city(slug: nearby.slug, name: nearby.name))
    #expect(h.model.notice == nil)
    #expect(h.model.topBar.approximate == nil)
    #expect(h.model.topBar.useMyLocation == nil)
  }
}

@Suite("The system's clock")
struct SystemClockTests {
  @Test("started at a moment, it reads that moment and runs on from it")
  func startingAt() {
    let start = Date(epochMs: 1_796_202_300_000)
    let read = SystemClock(startingAt: start).now
    #expect(read >= start)
    #expect(read.timeIntervalSince(start) < 5)
    #expect(SystemClock().offset == 0)
    #expect(abs(SystemClock().now.timeIntervalSinceNow) < 5)
  }

  /// When the work `clock` was given ran, by the system's clock, waiting at most `seconds`; nil
  /// if it hadn't by then. The work is cancelled either way.
  func runTime(
    on clock: SystemClock, at date: Date, within seconds: TimeInterval
  ) async throws -> Date? {
    let ran = Locked<Date?>(nil)
    let work = clock.schedule(at: date) { ran.change { $0 = Date() } }
    let deadline = Date().addingTimeInterval(seconds)
    while ran.read({ $0 }) == nil && Date() < deadline {
      try await Task.sleep(nanoseconds: 10_000_000)
    }
    work.cancel()
    return ran.read { $0 }
  }

  @Test("ahead of the system's, work due by its time runs at once")
  func aheadRunsAtOnce() async throws {
    // Weeks ahead, as a fixture's moment can be: due a second ago by this clock, not in weeks.
    let clock = SystemClock(startingAt: Date().addingTimeInterval(40 * 86_400))
    let ran = try await runTime(on: clock, at: clock.now.addingTimeInterval(-1), within: 5)
    #expect(ran != nil, "work due by the clock's time didn't run")
  }

  @Test("behind the system's, work waits for its time on this clock")
  func behindWaits() async throws {
    // Weeks behind: due in 0.2 s by this clock, though weeks ago by the system's.
    let clock = SystemClock(startingAt: Date().addingTimeInterval(-40 * 86_400))
    let asked = Date()
    let ran = try await runTime(on: clock, at: clock.now.addingTimeInterval(0.2), within: 5)
    let when = try #require(ran, "work due in 0.2 s didn't run")
    #expect(when.timeIntervalSince(asked) >= 0.19)
  }

  @Test("cancelled before it is due, work never runs")
  func cancelled() async throws {
    let clock = SystemClock()
    let ran = Locked(false)
    let work = clock.schedule(at: clock.now.addingTimeInterval(0.2)) { ran.change { $0 = true } }
    work.cancel()
    try await Task.sleep(nanoseconds: 500_000_000)
    #expect(!ran.read { $0 })
  }
}
