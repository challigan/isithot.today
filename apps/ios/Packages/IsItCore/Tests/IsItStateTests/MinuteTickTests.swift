import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItTestSupport
import Testing

let durham = Target.city(slug: "durham-gb", name: "Durham")

/// `date` plus `seconds`.
func later(_ date: Date, seconds: Double) -> Date {
  date.addingTimeInterval(seconds)
}

/// The page on screen, as the home screen draws it at the model's clock.
@MainActor
func onScreen(_ model: AppModel) -> HomePage {
  model.page(model.view, at: model.now)
}

/// `Announcements` as the home screen keeps it, in a class so that `#expect` can ask it.
@MainActor
final class Listener {
  private var announcements = Announcements()

  /// What is announced as the page on screen is drawn at the model's clock, under a sheet when
  /// `covered`.
  func hears(_ model: AppModel, covered: Bool = false) -> String? {
    announcements.drawn(onScreen(model), covered: covered)
  }

  /// What is announced as `page` is drawn.
  func hears(_ page: HomePage) -> String? {
    announcements.drawn(page)
  }
}

/// The three tabs' labels, as the switcher shows them at the model's clock.
@MainActor
func tabs(_ model: AppModel) -> [String] {
  AppView.allCases.map { model.page($0, at: model.now).label }
}

/// The 18:00 flip (iOS build spec, section 9.5): at 6pm at the place the middle tab becomes
/// "Tomorrow" and shows `snow.days[1]`, driven by the minute's tick alone, with no request, and
/// the view on screen stays where it is while the app is open.
@MainActor
@Suite("The 6pm flip, at the minute's tick")
struct FlipTests {
  /// Launches on the fixture `name` for `target` at `start`, then moves the clock to `flip`,
  /// checking the middle page just before and at it, and that nothing was asked meanwhile.
  func flip(
    _ name: String,
    target: Target,
    from start: Date,
    to flip: Date,
    place: String
  ) async throws {
    let res = try fixture(name)
    let tomorrow = try #require(res.snow?.days.dropFirst().first)
    let h = Harness(
      now: start,
      store: .init(place: target, units: .c),
      replies: [try FakeTransport.fixture(name)]
    )
    await h.model.launch()
    #expect(h.transport.requests.count == 1)
    #expect(h.model.view == .today)
    let before = h.model.page(.today, at: h.model.now)
    #expect(!before.tomorrow)
    #expect(before.label == "Today")
    #expect(before.question == "Will it snow today?")
    #expect(tabs(h.model) == ["Now", "Today", "This week"])
    #expect(MiddleDay.defaultView(h.model.response, at: h.model.now) == .today)
    // No refresh falls due by the flip: the minute's tick alone turns the page.
    #expect(h.clock.pending.allSatisfy { $0 > flip })

    h.clock.now = flip
    let after = h.model.page(.today, at: h.model.now)
    #expect(after.tomorrow)
    #expect(after.label == "Tomorrow")
    #expect(after.question == "Will it snow tomorrow?")
    #expect(after.answer == tomorrow.answer)
    #expect(after.verdict == tomorrow.verdict)
    #expect(after.detail == tomorrow.detail)
    #expect(after.day?.heading == tomorrow.agreementText)
    #expect(after.headingLabel == "\(place). Will it snow tomorrow? \(tomorrow.answer)")
    #expect(tabs(h.model) == ["Now", "Tomorrow", "This week"])
    #expect(h.transport.requests.count == 1)
    // The view stays where it is; the app would open on Now from here.
    #expect(h.model.view == .today)
    #expect(MiddleDay.defaultView(h.model.response, at: h.model.now) == .now)
  }

  @Test("durham-tomorrow: Today at 5:59pm, Tomorrow at 6pm, GMT")
  func durhamAtSix() async throws {
    let made = try fixtureNow("durham-tomorrow")
    // 6:05pm GMT on 16 December: 5:59pm and 6pm that day, as page.json has Durham across 6pm.
    try await flip(
      "durham-tomorrow",
      target: durham,
      from: later(made, minutes: -6),
      to: later(made, minutes: -5),
      place: "Durham"
    )
  }

  @Test("london-dst-autumn-evening: the clock runs from 5:30pm to 6pm, minute by minute")
  func londonEvening() async throws {
    let made = try fixtureNow("london-dst-autumn-evening")
    let h = Harness(
      now: made,
      store: .init(place: .city(slug: "london-gb", name: "London"), units: .c),
      replies: [try FakeTransport.fixture("london-dst-autumn-evening")]
    )
    await h.model.launch()
    for minute in 0..<30 {
      h.clock.now = later(made, minutes: Double(minute))
      #expect(tabs(h.model) == ["Now", "Today", "This week"], "at 5:\(30 + minute)pm")
    }
    h.clock.now = later(made, seconds: 29 * 60 + 59)
    #expect(!h.model.page(.today, at: h.model.now).tomorrow, "at 5:59:59pm")
    h.clock.now = later(made, minutes: 30)
    #expect(tabs(h.model) == ["Now", "Tomorrow", "This week"])
    #expect(
      h.model.page(.today, at: h.model.now).headingLabel == "London. Will it snow tomorrow? No.")
    #expect(h.transport.requests.count == 1)
  }

  @Test("kathmandu-0545: 6pm in an offset zone (UTC+5:45) is 12:15 UTC")
  func kathmanduAtSix() async throws {
    // 5:30pm in Kathmandu is 11:45 UTC; 5:59pm is 12:14 UTC and 6pm 12:15 UTC.
    let made = try fixtureNow("kathmandu-0545")
    try await flip(
      "kathmandu-0545",
      target: try fixtureTarget("kathmandu-0545"),
      from: later(made, minutes: 29),
      to: later(made, minutes: 30),
      place: "Kathmandu"
    )
    #expect(PlaceTime.local(later(made, minutes: 30), in: "Asia/Kathmandu").hours == 18)
    #expect(PlaceTime.local(later(made, minutes: 29), in: "Asia/Kathmandu").hours < 18)
  }
}

/// Changes are announced once to VoiceOver (sections 9.5 and 16): the home screen hands
/// `Announcements` the page on screen each time it draws it, as these tests do at each step,
/// and posts what comes back.
@MainActor
@Suite("Changes announced once")
struct AnnouncementTests {
  @Test("the answer arriving after Checking… is announced once; the minute's tick says nothing")
  func firstAnswer() async throws {
    let made = try fixtureNow("aberdeen-snow")
    let h = Harness(
      now: made,
      store: .init(place: aberdeen, units: .c),
      replies: [try FakeTransport.fixture("aberdeen-snow")]
    )
    let heard = Listener()
    #expect(onScreen(h.model).state == .loading)
    #expect(heard.hears(h.model) == nil)
    await h.model.launch()
    #expect(heard.hears(h.model) == "Aberdeen. Will it snow today? Yes. It'll snow.")
    #expect(heard.hears(h.model) == nil)
    for minute in 1...10 {
      h.clock.now = later(made, minutes: Double(minute))
      #expect(heard.hears(h.model) == nil, "minute \(minute)")
    }
  }

  @Test("a saved answer painted at launch says nothing, nor a fetch that changes nothing")
  func paintedThenSame() async throws {
    let made = try fixtureNow("aberdeen-snow")
    let saved = SavedToday(
      key: aberdeen.key, savedAt: later(made, minutes: -15), response: try fixture("aberdeen-snow"))
    let h = Harness(
      now: made,
      store: .init(place: aberdeen, units: .c, today: saved),
      replies: [try FakeTransport.fixture("aberdeen-snow")]
    )
    let heard = Listener()
    #expect(onScreen(h.model).state == .ready)
    #expect(heard.hears(h.model) == nil)
    await h.model.launch()
    #expect(h.transport.requests.count == 1)
    #expect(heard.hears(h.model) == nil)
    await h.model.refresh()
    #expect(heard.hears(h.model) == nil)
  }

  @Test("a refresh that changes the answer on screen is announced, once")
  func refreshChanges() async throws {
    let made = try fixtureNow("no-now")
    let h = Harness(
      now: made,
      store: .init(place: aberdeen, units: .c),
      replies: [
        try FakeTransport.fixture("no-now"),
        try FakeTransport.fixture("aberdeen-snow"),
      ]
    )
    await h.model.launch()
    h.model.view = .now
    let heard = Listener()
    #expect(
      onScreen(h.model).headingLabel
        == "Aberdeen. Is it snowing right now? Not available right now.")
    #expect(heard.hears(h.model) == nil)
    await h.model.refresh()
    #expect(heard.hears(h.model) == "Aberdeen. Is it snowing right now? No. Raining, not snowing.")
    #expect(heard.hears(h.model) == nil)
    // The same answer again says nothing.
    await h.model.refresh()
    #expect(h.transport.requests.count == 3)
    #expect(heard.hears(h.model) == nil)
  }

  @Test("moving to another page says nothing: VoiceOver reads it from there")
  func movingSaysNothing() async throws {
    let h = Harness(
      now: try fixtureNow("aberdeen-snow"),
      store: .init(place: aberdeen, units: .c),
      replies: [try FakeTransport.fixture("aberdeen-snow")]
    )
    await h.model.launch()
    let heard = Listener()
    #expect(heard.hears(h.model) == nil)
    for view in [AppView.week, .now, .today, .week] {
      h.model.view = view
      #expect(heard.hears(h.model) == nil, "\(view)")
    }
    // A route to a view says nothing either.
    await h.model.open(.view(.now))
    #expect(h.model.view == .now)
    #expect(heard.hears(h.model) == nil)
  }

  @Test("the hour picked changing Now's answer or verdict is announced once, at that hour")
  func hourChanges() async throws {
    let made = try fixtureNow("aberdeen-snow")
    let res = try fixture("aberdeen-snow")
    let h = Harness(
      now: made,
      store: .init(place: aberdeen, units: .c),
      replies: [try FakeTransport.fixture("aberdeen-snow")]
    )
    await h.model.launch()
    h.model.view = .now
    let heard = Listener()
    #expect(heard.hears(h.model) == nil)
    // Each minute until the answer's hours run out: an announcement wherever the hour picked
    // changes the heading or the verdict, and only there.
    let until = Freshness.usableUntil(res)
    var said: [(Date, String)] = []
    var minute = 1.0
    let shown = onScreen(h.model)
    var last = [shown.headingLabel, shown.verdict]
    var changes = 0
    while later(made, minutes: minute) < later(until, minutes: 2) {
      h.clock.now = later(made, minutes: minute)
      let page = onScreen(h.model)
      if [page.headingLabel, page.verdict] != last { changes += 1 }
      last = [page.headingLabel, page.verdict]
      if let text = heard.hears(page) { said.append((h.clock.now, text)) }
      minute += 1
    }
    #expect(said.count == changes)
    // At 10am Now's verdict turns from rain to none, its answer still No (the fixture's first
    // hour ahead); at 3pm Now turns from No to Maybe (its last); at usableUntil there is no
    // recent forecast.
    #expect(said.count == 3)
    let ten = try #require(res.snow?.ahead?.first?.time)
    let dry = try #require(said.first)
    #expect(dry.0 == ten)
    #expect(dry.1 == "Aberdeen. Is it snowing right now? No. It's not snowing.")
    let three = try #require(res.snow?.ahead?.last?.time)
    let maybe = try #require(said.dropFirst().first)
    #expect(maybe.0 == three)
    #expect(maybe.1 == "Aberdeen. Is it snowing right now? Maybe. Snow showers around.")
    // The first minute's tick from usableUntil on.
    let gone = try #require(said.last)
    #expect(gone.0 >= until && gone.0 < later(until, minutes: 1))
    #expect(
      gone.1
        == "Aberdeen. Is it snowing right now? No recent forecast. Connect to the internet to refresh."
    )
  }

  @Test("the 6pm flip is announced once, on the middle page")
  func flipAnnounced() async throws {
    let made = try fixtureNow("london-dst-autumn-evening")
    let h = Harness(
      now: made,
      store: .init(place: .city(slug: "london-gb", name: "London"), units: .c),
      replies: [try FakeTransport.fixture("london-dst-autumn-evening")]
    )
    await h.model.launch()
    let heard = Listener()
    #expect(heard.hears(h.model) == nil)
    var said: [String] = []
    for minute in 1...40 {
      h.clock.now = later(made, minutes: Double(minute))
      if let text = heard.hears(h.model) { said.append(text) }
    }
    #expect(said == ["London. Will it snow tomorrow? No. Too warm for snow."])
  }

  @Test("under a sheet nothing is announced, the 6pm flip neither then nor once it closes")
  func coveredFlipSaysNothing() async throws {
    let made = try fixtureNow("london-dst-autumn-evening")
    let h = Harness(
      now: made,
      store: .init(place: .city(slug: "london-gb", name: "London"), units: .c),
      replies: [try FakeTransport.fixture("london-dst-autumn-evening")]
    )
    await h.model.launch()
    let heard = Listener()
    #expect(heard.hears(h.model) == nil)
    var said: [String] = []
    for minute in 1...40 {
      h.clock.now = later(made, minutes: Double(minute))
      // Settings or the picker is open over the pages, which are out of the accessibility tree.
      if let text = heard.hears(h.model, covered: true) { said.append(text) }
    }
    #expect(said.isEmpty)
    // The sheet closes on the page as it now is: VoiceOver reads it from there, and nothing
    // from under the sheet is said late.
    #expect(heard.hears(h.model) == nil)
  }

  @Test("what changed under a sheet is kept: the next change after it is announced")
  func coveredThenChange() async throws {
    let made = try fixtureNow("aberdeen-snow")
    let h = Harness(
      now: made,
      store: .init(place: aberdeen, units: .c),
      replies: [.failure(.notConnectedToInternet), .answer(try dundee())]
    )
    let heard = Listener()
    #expect(heard.hears(h.model, covered: true) == nil)
    await h.model.launch()
    #expect(heard.hears(h.model, covered: true) == nil)
    #expect(heard.hears(h.model) == nil)
    await h.model.select(dundeeTarget)
    #expect(heard.hears(h.model) == "Dundee. Will it snow today? Yes. It'll snow.")
  }

  @Test("a failure with nothing to show is announced, and then a nearby place's answer")
  func failureAndNewPlace() async throws {
    let made = try fixtureNow("aberdeen-snow")
    let h = Harness(
      now: made,
      store: .init(place: aberdeen, units: .c),
      replies: [.failure(.notConnectedToInternet), .answer(try dundee())]
    )
    let heard = Listener()
    #expect(heard.hears(h.model) == nil)
    await h.model.launch()
    #expect(
      heard.hears(h.model)
        == "Aberdeen. Will it snow today? No recent forecast. Connect to the internet to refresh.")
    await h.model.select(dundeeTarget)
    #expect(heard.hears(h.model) == "Dundee. Will it snow today? Yes. It'll snow.")
  }

  @Test("the evening's first answer, which opens on Now while Checking… was on Today, once")
  func eveningFirstAnswer() async throws {
    let made = try fixtureNow("durham-tomorrow")
    let h = Harness(
      now: made,
      store: .init(place: durham, units: .c),
      replies: [try FakeTransport.fixture("durham-tomorrow")]
    )
    let heard = Listener()
    #expect(h.model.view == .today)
    #expect(onScreen(h.model).headingLabel == "Durham. Will it snow today? Checking…")
    #expect(heard.hears(h.model) == nil)
    await h.model.launch()
    #expect(h.model.view == .now)
    #expect(heard.hears(h.model) == "Durham. Is it snowing right now? No. Too warm for snow.")
    #expect(heard.hears(h.model) == nil)
    for minute in 1...10 {
      h.clock.now = later(made, minutes: Double(minute))
      #expect(heard.hears(h.model) == nil, "minute \(minute)")
    }
  }

  @Test("nothing while a place under Nearby is checking; then its answer, once")
  func checkingSaysNothing() async throws {
    let saved = try savedAberdeen()
    let transport = GatedTransport(first: try dundee(), others: try dundee())
    let model = AppModel(
      environment: AppEnvironment(
        client: APIClient(transport: transport),
        clock: TestClock(later(saved.savedAt, minutes: 1)),
        store: FakeState(.init(place: aberdeen, units: .c, today: saved)),
        widgets: FakeWidgets(),
        hooks: NoHooks(),
        random: { _ in 0 }
      ))
    let heard = Listener()
    await model.launch()
    #expect(transport.requests == 0)
    #expect(heard.hears(model) == nil)
    let selecting = Task { await model.select(dundeeTarget) }
    try #require(
      await yieldUntil { transport.requests == 1 }, "the nearby place's fetch never started")
    #expect(onScreen(model).headingLabel == "Dundee. Will it snow today? Checking…")
    #expect(heard.hears(model) == nil)
    transport.release()
    await selecting.value
    #expect(heard.hears(model) == "Dundee. Will it snow today? Yes. It'll snow.")
    #expect(heard.hears(model) == nil)
  }

  @Test("a place under Nearby chosen on This week is announced there")
  func nearbyOnTheWeek() async throws {
    let h = Harness(
      now: try fixtureNow("aberdeen-snow"),
      store: .init(place: aberdeen, units: .c),
      replies: [try FakeTransport.fixture("aberdeen-snow"), .answer(try dundee())]
    )
    await h.model.launch()
    h.model.view = .week
    let heard = Listener()
    #expect(heard.hears(h.model) == nil)
    await h.model.select(dundeeTarget)
    #expect(
      heard.hears(h.model)
        == "Dundee. Will it snow this week? Yes. Snow today and on Sun and Mon, heavy on Sun.")
    #expect(heard.hears(h.model) == nil)
  }

  @Test("a new verdict under the same heading is announced, with the heading, at its hour")
  func verdictChanges() async throws {
    // leeds-dry on Today: still "No." at 2pm, where the hour ahead says it won't snow, not rain.
    let h = Harness(
      now: try fixtureNow("leeds-dry"),
      store: .init(place: .city(slug: "leeds-gb", name: "Leeds"), units: .c),
      replies: [try FakeTransport.fixture("leeds-dry")]
    )
    await h.model.launch()
    let two = try #require(ApiJSON.parseDate("2026-12-01T14:00:00.000Z"))
    h.clock.now = later(two, minutes: -1)
    let heard = Listener()
    let before = onScreen(h.model)
    #expect(before.headingLabel == "Leeds. Will it snow today? No.")
    #expect(before.verdict == "Rain, not snow.")
    #expect(heard.hears(h.model) == nil)
    h.clock.now = two
    #expect(onScreen(h.model).headingLabel == before.headingLabel)
    #expect(heard.hears(h.model) == "Leeds. Will it snow today? No. It won't snow.")
    #expect(heard.hears(h.model) == nil)
  }
}
