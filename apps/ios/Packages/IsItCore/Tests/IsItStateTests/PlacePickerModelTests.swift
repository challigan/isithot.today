import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItTestSupport
import Testing

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

/// A search fixture as the server's answer, with status 200.
func searchReply(_ name: String) throws -> FakeTransport.Reply {
  .answer(HTTPResponse(status: 200, body: try Fixtures.search(name)))
}

/// A search fixture's results.
func found(_ name: String) throws -> [SearchResult] {
  try SearchResponse.decode(from: Fixtures.search(name)).results
}

let leedsCity = Target.city(slug: "leeds-gb", name: "Leeds")

/// A server that holds every request until the test lets it through (`release(_:)`), noting
/// which were cancelled meanwhile: a cancelled request then fails, as URLSession's does.
final class HeldTransport: HTTPTransport {
  private struct Held {
    let request: HTTPRequest
    let gate = Gate()
    var cancelled = false
  }

  private let state = Locked<[Held]>([])
  private let reply: @Sendable (HTTPRequest) throws -> HTTPResponse

  init(_ reply: @escaping @Sendable (HTTPRequest) throws -> HTTPResponse) {
    self.reply = reply
  }

  var urls: [String] { state.read { $0.map(\.request.url.absoluteString) } }
  var cancelled: [Bool] { state.read { $0.map(\.cancelled) } }

  /// Lets the request at `index` (in the order they were made) through.
  func release(_ index: Int) {
    state.read { $0[index].gate }.open()
  }

  func get(_ request: HTTPRequest) async throws -> HTTPResponse {
    let (index, gate) = state.change { held -> (Int, Gate) in
      held.append(Held(request: request))
      return (held.count - 1, held[held.count - 1].gate)
    }
    await withTaskCancellationHandler {
      await gate.wait()
    } onCancel: { [state] in
      state.change { $0[index].cancelled = true }
    }
    if state.read({ $0[index].cancelled }) { throw URLError(.cancelled) }
    return try reply(request)
  }
}

/// The search box (iOS build spec, sections 4 and 10.3): a pause after typing, from 2 letters,
/// a newer keystroke cancelling the older search, and what each answer shows.
@MainActor
@Suite("The picker's search")
struct PlacePickerSearchTests {
  @Test("nothing typed, or too little, asks nothing")
  func tooShort() throws {
    let h = Harness(now: try fixtureNow("leeds-dry"), replies: [try searchReply("search-leeds")])
    let picker = h.model.makePicker()
    #expect(picker.search == .empty)
    picker.type("L")
    #expect(picker.text == "L")
    #expect(picker.search == .tooShort)
    #expect(picker.content.status == "Type at least 2 letters.")
    picker.type("   ")
    #expect(picker.search == .empty)
    #expect(picker.content.status == nil)
    #expect(h.clock.pending.isEmpty)
    #expect(h.transport.requests.isEmpty)
  }

  @Test("a search waits 250 ms after the last keystroke, then asks for the trimmed text")
  func debounce() async throws {
    let made = try fixtureNow("leeds-dry")
    let h = Harness(now: made, replies: [try searchReply("search-leeds")])
    let picker = h.model.makePicker()
    picker.type(" Le")
    picker.type(" Lee")
    picker.type(" Leeds ")
    // The same text again changes nothing.
    picker.type(" Leeds ")
    // Only the last keystroke's wait is left, a quarter of a second on.
    #expect(h.clock.pending == [made.addingTimeInterval(0.25)])
    #expect(picker.search == .searching(previous: []))
    #expect(h.transport.requests.isEmpty)
    await h.clock.runNext()
    #expect(h.transport.urls == ["https://willitsnow.today/api/v1/search?q=Leeds"])
    #expect(h.transport.requests[0].headers == ["Accept": "application/json"])
    #expect(h.transport.requests[0].timeout == 12)
    #expect(picker.search == .found(try found("search-leeds")))
    #expect(picker.content.results.map(\.name) == ["Leeds"])
    #expect(picker.content.results.map(\.detail) == ["England, United Kingdom"])
  }

  @Test("a newer keystroke cancels the request still out, whose answer is never shown")
  func staleRequest() async throws {
    let leeds = try Fixtures.search("search-leeds")
    let kathmandu = try Fixtures.search("search-kathmandu")
    let held = HeldTransport { request in
      HTTPResponse(
        status: 200, body: request.url.absoluteString.hasSuffix("q=Leeds") ? leeds : kathmandu)
    }
    let clock = TestClock(try fixtureNow("leeds-dry"))
    let model = AppModel(
      environment: AppEnvironment(
        client: APIClient(transport: held),
        clock: clock,
        store: FakeState(),
        widgets: FakeWidgets()
      ))
    let picker = model.makePicker()
    picker.type("Leeds")
    let first = Task { () -> Void in await clock.runNext() }
    try #require(await yieldUntil { held.urls.count == 1 }, "the first search never asked")
    picker.type("Kathmandu")
    #expect(held.cancelled == [true])
    #expect(picker.search == .searching(previous: []))
    let second = Task { () -> Void in await clock.runNext() }
    try #require(await yieldUntil { held.urls.count == 2 }, "the second search never asked")
    held.release(1)
    await second.value
    #expect(picker.search == .found(try found("search-kathmandu")))
    // The first answer comes after all: it is dropped.
    held.release(0)
    await first.value
    #expect(picker.search == .found(try found("search-kathmandu")))
    #expect(
      held.urls == [
        "https://willitsnow.today/api/v1/search?q=Leeds",
        "https://willitsnow.today/api/v1/search?q=Kathmandu",
      ])
    #expect(held.cancelled == [true, false])
  }

  @Test("the last search's results stay while the next is on its way; none is said so")
  func previousAndNone() async throws {
    let h = Harness(
      now: try fixtureNow("leeds-dry"),
      replies: [try searchReply("search-leeds"), try searchReply("search-none")]
    )
    let picker = h.model.makePicker()
    picker.type("Leeds")
    await h.clock.runNext()
    picker.type("Xyzzy")
    #expect(picker.search == .searching(previous: try found("search-leeds")))
    #expect(picker.content.results.map(\.name) == ["Leeds"])
    #expect(picker.content.status == nil)
    await h.clock.runNext()
    #expect(picker.search == .found([]))
    #expect(picker.content.status == "No places found.")
    #expect(picker.content.results.isEmpty)
    // Too short again: the results go.
    picker.type("X")
    #expect(picker.content.results.isEmpty)
    #expect(h.transport.requests.count == 2)
  }

  @Test("a failed search says why, and never blames the forecasts for the connection")
  func failures() async throws {
    let h = Harness(
      now: try fixtureNow("leeds-dry"),
      replies: [
        .failure(.notConnectedToInternet),
        try FakeTransport.error(429, code: "rate_limited"),
        try FakeTransport.error(503, code: "upstream_unavailable"),
        .answer(HTTPResponse(status: 500, body: Data())),
        .answer(HTTPResponse(status: 200, body: Data("not json".utf8))),
      ]
    )
    let picker = h.model.makePicker()
    var lines: [String?] = []
    for text in ["Leeds", "Leed", "Lee", "Le", "Lees"] {
      picker.type(text)
      await h.clock.runNext()
      lines.append(picker.content.status)
    }
    #expect(
      lines == [
        "You're offline. Connect to the internet to search.",
        "Too many requests. Try again in a minute.",
        "Forecasts are unavailable right now. Try again in a few minutes.",
        "Forecasts are unavailable right now. Try again in a few minutes.",
        "Forecasts are unavailable right now. Try again in a few minutes.",
      ])
    #expect(FetchError.offline.searchMessage == AppCopy.searchOffline)
    #expect(FetchError.rateLimited.searchMessage == FetchError.rateLimited.message)
  }

  @Test("the search's request: the origin's /api/v1/search, with the text as the website sends it")
  func request() throws {
    let client = APIClient(
      origin: try #require(URL(string: "https://deploy-preview-9--willitsnow.netlify.app/")),
      transport: FakeTransport([try searchReply("search-none")])
    )
    let request = try #require(client.searchRequest(for: "Bath & Wells"))
    #expect(
      request.url.absoluteString
        == "https://deploy-preview-9--willitsnow.netlify.app/api/v1/search?q=Bath%20%26%20Wells")
    #expect(request.headers == ["Accept": "application/json"])
    #expect(
      APIClient(transport: FakeTransport([])).searchRequest(for: "Zürich")?.url.absoluteString
        == "https://willitsnow.today/api/v1/search?q=Z%C3%BCrich")
  }

  @Test("closing the sheet cancels the search still waiting")
  func close() async throws {
    let h = Harness(now: try fixtureNow("leeds-dry"), replies: [try searchReply("search-leeds")])
    let picker = h.model.makePicker()
    picker.type("Leeds")
    picker.close()
    #expect(h.clock.pending.isEmpty)
    #expect(await h.clock.runNext() == false)
    #expect(h.transport.requests.isEmpty)
  }
}

/// Choosing a place (iOS build spec, section 10.3): `place.v1`, the fetch, the widgets, the
/// recent places and the notifications' sync.
@MainActor
@Suite("Choosing a place in the picker")
struct PlacePickerChoiceTests {
  @Test("a result with a city page: kept, loaded, saved for the widgets, and a recent place")
  func city() async throws {
    let h = Harness(
      now: try fixtureNow("leeds-dry"),
      store: .init(units: .c),
      replies: [try searchReply("search-leeds"), try FakeTransport.fixture("leeds-dry")]
    )
    let picker = h.model.makePicker()
    picker.type("Leeds")
    await h.clock.runNext()
    let result = try #require(picker.content.results.first).result
    await picker.choose(result)
    #expect(picker.finished)
    #expect(
      h.transport.urls == [
        "https://willitsnow.today/api/v1/search?q=Leeds",
        "https://willitsnow.today/api/v1/today?place=leeds-gb&units=c&ahead=snow",
      ])
    #expect(h.model.target == leedsCity)
    #expect(h.store.loadPlace() == leedsCity)
    #expect(h.store.today?.key == "city:leeds-gb")
    #expect(h.widgets.reloads == 1)
    #expect(h.model.recents == [RecentPlace(target: leedsCity, name: "Leeds")])
    #expect(h.recents.loadRecents() == h.model.recents)
    // Phase 8's sync, which decides whether the notification place follows.
    #expect(h.hooks.calls == ["syncAlerts city:leeds-gb c"])
    #expect(h.model.topBar.placeLabel == "Place: Leeds. Change place.")
    #expect(h.model.topBar.approximate == nil)
    #expect(h.model.page(.today, at: h.model.now).headingLabel == "Leeds. Will it snow today? No.")
  }

  @Test("a result with no city page is its point on the grid, with what the search said")
  func point() async throws {
    let h = Harness(
      now: try fixtureNow("kathmandu-0545"),
      store: .init(units: .c),
      replies: [try searchReply("search-kathmandu"), try FakeTransport.fixture("kathmandu-0545")]
    )
    let picker = h.model.makePicker()
    picker.type("Kathmandu")
    await h.clock.runNext()
    await picker.submit()
    #expect(picker.finished)
    #expect(
      h.transport.urls.last
        == "https://willitsnow.today/api/v1/today?lat=27.7&lon=85.3&name=Kathmandu"
        + "&region=Bagmati+Province&country=NP&geonameId=1283240&elevation=50&source=search"
        + "&units=c&ahead=snow")
    let place = Target(search: try found("search-kathmandu")[0])
    #expect(h.model.target == place)
    #expect(h.model.target.key == "search:27.7,85.3")
    #expect(h.model.recents == [RecentPlace(target: place, name: "Kathmandu")])
    #expect(h.model.placeName == "Kathmandu")
  }

  @Test("the sheet closes as the place is chosen, and the place loads under its name")
  func closesFirst() async throws {
    let leeds = try Fixtures.search("search-leeds")
    let answer = try Fixtures.data("leeds-dry")
    let held = HeldTransport { request in
      HTTPResponse(status: 200, body: request.url.path.hasSuffix("search") ? leeds : answer)
    }
    let clock = TestClock(try fixtureNow("leeds-dry"))
    let model = AppModel(
      environment: AppEnvironment(
        client: APIClient(transport: held),
        clock: clock,
        store: FakeState(),
        widgets: FakeWidgets()
      ))
    let picker = model.makePicker()
    picker.type("Leeds")
    let searching = Task { () -> Void in await clock.runNext() }
    try #require(await yieldUntil { held.urls.count == 1 })
    held.release(0)
    await searching.value
    let result = try #require(picker.content.results.first).result
    let choosing = Task { await picker.choose(result) }
    try #require(await yieldUntil { held.urls.count == 2 }, "the place was never asked for")
    #expect(picker.finished)
    #expect(model.topBar.place == "Leeds")
    #expect(model.page(.today, at: model.now).state == .loading)
    held.release(1)
    await choosing.value
    #expect(model.page(.today, at: model.now).state == .ready)
  }

  @Test("the Search key chooses the first result, and nothing before there are results")
  func submit() async throws {
    let h = Harness(now: try fixtureNow("leeds-dry"), replies: [try searchReply("search-none")])
    let picker = h.model.makePicker()
    await picker.submit()
    picker.type("Xyzzy")
    await picker.submit()
    await h.clock.runNext()
    await picker.submit()
    #expect(!picker.finished)
    #expect(h.transport.requests.count == 1)
    #expect(h.model.target == .ip)
  }

  @Test("recent places: newest first, one each, at most five, kept, and swiped away")
  func recents() async throws {
    let start = [
      RecentPlace(target: .city(slug: "york-gb", name: "York"), name: "York"),
      RecentPlace(target: .city(slug: "hull-gb", name: "Hull"), name: "Hull"),
      RecentPlace(target: .city(slug: "bath-gb", name: "Bath"), name: "Bath"),
      RecentPlace(target: .city(slug: "ripon-gb", name: "Ripon"), name: "Ripon"),
      RecentPlace(target: .city(slug: "selby-gb", name: "Selby"), name: "Selby"),
    ]
    let h = Harness(
      now: try fixtureNow("leeds-dry"),
      store: .init(units: .c),
      replies: [try searchReply("search-leeds"), try FakeTransport.fixture("leeds-dry")],
      recents: start
    )
    #expect(h.model.recents == start)
    var picker = h.model.makePicker()
    #expect(picker.content.recentHeading == "Recent")
    #expect(picker.content.recents.map(\.name) == ["York", "Hull", "Bath", "Ripon", "Selby"])
    picker.type("Leeds")
    await h.clock.runNext()
    await picker.choose(try #require(picker.content.results.first).result)
    #expect(h.model.recents.map(\.name) == ["Leeds", "York", "Hull", "Bath", "Ripon"])

    // A recent place chosen moves to the top.
    picker = h.model.makePicker()
    let york = try #require(picker.content.recents.first { $0.name == "York" }).place
    await picker.choose(york)
    #expect(picker.finished)
    #expect(h.model.target == york.target)
    #expect(h.model.recents.map(\.name) == ["York", "Leeds", "Hull", "Bath", "Ripon"])
    #expect(
      h.transport.urls.last
        == "https://willitsnow.today/api/v1/today?place=york-gb&units=c&ahead=snow")

    // Swiped away, and kept so.
    picker = h.model.makePicker()
    picker.remove(york)
    #expect(h.model.recents.map(\.name) == ["Leeds", "Hull", "Bath", "Ripon"])
    #expect(h.recents.loadRecents() == h.model.recents)
    #expect(picker.content.recents.map(\.name) == ["Leeds", "Hull", "Bath", "Ripon"])
    // Typing hides them.
    picker.type("Le")
    #expect(picker.content.recents.isEmpty)
  }
}

/// "Use my location" (iOS build spec, sections 9.4 and 10.3): permission asked only at the tap
/// and only if never asked, one fix rounded to the 0.05° grid, and when permission is off, why.
@MainActor
@Suite("The picker's Use my location")
struct PlacePickerLocationTests {
  /// Kathmandu's centre, unrounded, as a fix might give it.
  let fix = Target.coords(.init(source: .device, lat: 27.7172, lon: 85.324))

  @Test("never asked: the prompt, then one fix, rounded, loaded, and named by its answer")
  func first() async throws {
    let h = Harness(
      now: try fixtureNow("kathmandu-0545"),
      store: .init(units: .c),
      replies: [try FakeTransport.fixture("kathmandu-0545")],
      hooks: RecordingHooks(moved: fix, access: .notDetermined, answer: .granted)
    )
    let picker = h.model.makePicker()
    await picker.useMyLocation()
    #expect(picker.finished)
    #expect(picker.location == .idle)
    let here = Target.device(lat: 27.7, lon: 85.3)
    #expect(h.model.target == here)
    #expect(h.store.loadPlace() == here)
    #expect(
      h.transport.urls == [
        "https://willitsnow.today/api/v1/today?lat=27.7&lon=85.3&source=device&units=c&ahead=snow"
      ])
    #expect(
      h.hooks.calls == [
        "location access", "location request", "location fix", "syncAlerts device:27.7,85.3 c",
      ])
    // The device's place has no name of its own: its answer's names it among the recents.
    #expect(h.model.recents == [RecentPlace(target: here, name: "Kathmandu")])
    #expect(h.model.placeName == "Kathmandu")
  }

  @Test("permission off: nothing is asked, nothing loads, and the row says why with Open Settings")
  func denied() async throws {
    let h = Harness(
      now: try fixtureNow("leeds-dry"),
      replies: [try FakeTransport.fixture("leeds-dry")],
      hooks: RecordingHooks(moved: fix, access: .denied)
    )
    let picker = h.model.makePicker()
    await picker.useMyLocation()
    #expect(!picker.finished)
    #expect(picker.location == .denied)
    #expect(picker.content.location.detail == CoreCopy.locationDenied)
    #expect(picker.content.location.openSettings == "Open Settings")
    #expect(h.hooks.calls == ["location access"])
    #expect(h.transport.requests.isEmpty)
    #expect(h.model.target == .ip)
    #expect(h.model.recents.isEmpty)
  }

  @Test("asked, and refused: the same")
  func refused() async throws {
    let h = Harness(
      now: try fixtureNow("leeds-dry"),
      replies: [try FakeTransport.fixture("leeds-dry")],
      hooks: RecordingHooks(moved: fix, access: .notDetermined, answer: .denied)
    )
    let picker = h.model.makePicker()
    await picker.useMyLocation()
    #expect(picker.location == .denied)
    #expect(h.hooks.calls == ["location access", "location request"])
    #expect(h.transport.requests.isEmpty)
    #expect(await h.model.locate() == .denied)
  }

  @Test("permission on, but no fix: the row says so, and nothing changes")
  func unavailable() async throws {
    let h = Harness(
      now: try fixtureNow("leeds-dry"),
      replies: [try FakeTransport.fixture("leeds-dry")],
      hooks: RecordingHooks(moved: nil)
    )
    let picker = h.model.makePicker()
    await picker.useMyLocation()
    #expect(picker.location == .unavailable)
    #expect(picker.content.location.detail == AppCopy.locationUnavailable)
    #expect(picker.content.location.openSettings == nil)
    #expect(h.hooks.calls == ["location access", "location fix"])
    #expect(!picker.finished)
    #expect(h.transport.requests.isEmpty)
  }

  @Test("a second tap while the fix is out does nothing")
  func twice() async throws {
    let h = Harness(
      now: try fixtureNow("kathmandu-0545"),
      store: .init(units: .c),
      replies: [try FakeTransport.fixture("kathmandu-0545")],
      hooks: RecordingHooks(moved: fix, holdingFix: true)
    )
    let picker = h.model.makePicker()
    let first = Task { await picker.useMyLocation() }
    try #require(await yieldUntil { h.hooks.calls.contains("location fix") })
    #expect(picker.location == .locating)
    #expect(picker.content.location.busy)
    #expect(picker.content.location.detail == "Finding you…")
    await picker.useMyLocation()
    #expect(h.hooks.calls.filter { $0 == "location fix" }.count == 1)
    h.hooks.releaseFix()
    await first.value
    #expect(picker.finished)
    #expect(h.transport.requests.count == 1)
  }

  /// The approximate line's "Use my location" opens the picker already finding the phone's
  /// place; Close then means no. A fix that comes after is dropped: nothing is kept, loaded or
  /// remembered, and the notifications aren't synced.
  @Test("closed while the fix is out: nothing is chosen when it comes")
  func closedWhileLocating() async throws {
    let h = Harness(
      now: try fixtureNow("kathmandu-0545"),
      store: .init(units: .c),
      replies: [try FakeTransport.fixture("kathmandu-0545")],
      hooks: RecordingHooks(moved: fix, holdingFix: true)
    )
    let picker = h.model.makePicker()
    let locating = Task { await picker.useMyLocation() }
    try #require(await yieldUntil { h.hooks.calls.contains("location fix") })
    picker.close()
    h.hooks.releaseFix()
    await locating.value
    #expect(!picker.finished)
    #expect(picker.location == .idle)
    #expect(h.model.target == .ip)
    #expect(h.store.loadPlace() == .ip)
    #expect(h.transport.requests.isEmpty)
    #expect(h.model.recents.isEmpty)
    #expect(h.recents.loadRecents().isEmpty)
    #expect(h.hooks.calls == ["location access", "location fix"])
  }

  @Test("a place chosen while the fix is out stays chosen when it comes")
  func chosenWhileLocating() async throws {
    let h = Harness(
      now: try fixtureNow("leeds-dry"),
      store: .init(units: .c),
      replies: [try FakeTransport.fixture("leeds-dry")],
      hooks: RecordingHooks(moved: fix, holdingFix: true)
    )
    let picker = h.model.makePicker()
    let locating = Task { await picker.useMyLocation() }
    try #require(await yieldUntil { h.hooks.calls.contains("location fix") })
    await picker.choose(try #require(try found("search-leeds").first))
    h.hooks.releaseFix()
    await locating.value
    #expect(picker.finished)
    #expect(picker.location == .idle)
    #expect(h.model.target == leedsCity)
    #expect(h.store.loadPlace() == leedsCity)
    #expect(
      h.transport.urls == [
        "https://willitsnow.today/api/v1/today?place=leeds-gb&units=c&ahead=snow"
      ])
    #expect(h.model.recents == [RecentPlace(target: leedsCity, name: "Leeds")])
    #expect(h.hooks.calls == ["location access", "location fix", "syncAlerts city:leeds-gb c"])
  }

  @Test("a device place whose answer never came isn't a recent place")
  func failed() async throws {
    let h = Harness(
      now: try fixtureNow("kathmandu-0545"),
      store: .init(units: .c),
      replies: [.failure(.notConnectedToInternet)],
      hooks: RecordingHooks(moved: fix)
    )
    let picker = h.model.makePicker()
    await picker.useMyLocation()
    #expect(picker.finished)
    #expect(h.model.target == .device(lat: 27.7, lon: 85.3))
    #expect(h.model.recents.isEmpty)
  }

  @Test("the launch's fix for My location never asks for permission")
  func launchNeverAsks() async throws {
    let leeds = Target.device(lat: 53.8, lon: -1.55)
    for access in [LocationAccess.notDetermined, .denied] {
      let h = Harness(
        now: try fixtureNow("leeds-dry"),
        store: .init(place: leeds, units: .c),
        replies: [try FakeTransport.fixture("leeds-dry")],
        hooks: RecordingHooks(moved: fix, access: access)
      )
      await h.model.launch()
      #expect(
        h.hooks.calls == [
          "startEntitlementCheck", "location access", "entitlement", "startAds",
          "syncAlerts device:53.8,-1.55 c",
        ], "\(access)")
      #expect(h.transport.requests.count == 1, "\(access)")
      #expect(h.model.target == leeds, "\(access)")
    }
  }
}
