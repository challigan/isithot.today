import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItTestSupport
import Testing

/// `-clock fixed` (iOS build spec, section 9.8): the UI tests' clock, which reads one moment
/// however long the app runs, so each screen they read is the one its moment shows.
@Suite("A fixed clock: one moment, and nothing falls due")
struct FixedClockTests {
  let moment = Date(epochMs: 1_796_202_300_000)

  @Test("reads the moment it was given, however long it runs")
  func readsOneMoment() async throws {
    let clock = FixedClock(at: moment)
    #expect(clock.now == moment)
    try await Task.sleep(nanoseconds: 20_000_000)
    #expect(clock.now == moment)
  }

  @MainActor
  @Test("runs work for a time it has reached at once, never work for a later time")
  func schedules() async {
    let clock = FixedClock(at: moment)
    let ran = Locked<[String]>([])
    _ = clock.schedule(at: moment) { ran.change { $0.append("now") } }
    _ = clock.schedule(at: moment.addingTimeInterval(-1)) { ran.change { $0.append("before") } }
    _ = clock.schedule(at: moment.addingTimeInterval(0.001)) { ran.change { $0.append("later") } }
    clock.schedule(at: moment) { ran.change { $0.append("cancelled") } }.cancel()
    #expect(await yieldUntil { ran.read(\.count) == 2 })
    for _ in 0..<1_000 { await Task.yield() }
    #expect(ran.read { $0.sorted() } == ["before", "now"])
  }

  /// The model on a fixed clock, as a UI test launched with `-clock fixed` runs it: the answer
  /// at the moment, and neither the quiet refresh nor the retry after a failure ever asks again.
  @MainActor
  @Test("the model on it asks once, after an answer or a failure alike")
  func modelAsksOnce() async throws {
    let made = try fixtureNow("aberdeen-snow")
    for reply in [try FakeTransport.fixture("aberdeen-snow"), .failure(.notConnectedToInternet)] {
      let transport = FakeTransport([reply])
      let model = AppModel(
        environment: AppEnvironment(
          client: APIClient(transport: transport),
          clock: FixedClock(at: made),
          store: FakeState(),
          widgets: FakeWidgets()
        ))
      await model.launch()
      let due = try #require(model.nextRefreshAt, "nothing scheduled")
      #expect(due > made)
      for _ in 0..<10_000 { await Task.yield() }
      #expect(transport.requests.count == 1)
      #expect(model.now == made)
      #expect(model.nextRefreshAt == due)
    }
  }
}

/// The minute tick in the model's minutes (`MinuteTick.anchor`), which the home screen's
/// `TimelineView` ticks from, so that a clock started at 5:59:30pm turns the page at 6pm on its
/// own clock rather than at the system's next minute.
@Suite("The minute tick, on the model's minutes")
struct MinuteTickAnchorTests {
  /// How far a moment is into its minute, seconds.
  func into(_ date: Date) -> TimeInterval {
    let seconds = date.timeIntervalSince1970.truncatingRemainder(dividingBy: 60)
    return seconds < 0 ? seconds + 60 : seconds
  }

  @Test("with the two clocks the same, the system's minute and the lead")
  func sameClocks() {
    let system = Date(epochMs: 1_796_202_310_250)
    let anchor = MinuteTick.anchor(model: system, system: system)
    #expect(anchor.epochMs == 1_796_202_300_050)
    #expect(MinuteTick.lead == 0.05)
  }

  @Test("each tick is the lead into one of the model's minutes, however far apart the clocks")
  func everyOffset() {
    let system = Date(epochMs: 1_796_202_300_000)
    for offset in stride(from: -3_700.0, through: 3_700, by: 7.31) {
      let anchor = MinuteTick.anchor(model: system.addingTimeInterval(offset), system: system)
      #expect(anchor <= system.addingTimeInterval(MinuteTick.lead), "offset \(offset)")
      #expect(anchor > system.addingTimeInterval(MinuteTick.lead - 60), "offset \(offset)")
      for tick in 0..<3 {
        let model = anchor.addingTimeInterval(Double(tick) * 60 + offset)
        #expect(abs(into(model) - MinuteTick.lead) < 0.000_1, "offset \(offset), tick \(tick)")
      }
    }
  }

  @Test("before 1970 too")
  func beforeTheEpoch() {
    let system = Date(epochMs: 1_796_202_300_000)
    let anchor = MinuteTick.anchor(model: Date(timeIntervalSince1970: -10), system: system)
    #expect(anchor.epochMs == system.epochMs - 50_000 + 50)
  }

  /// Durham at 5:59:30pm, where UI tests start the flip: the next tick is at 6pm on the model's
  /// clock, 30 seconds on, and it turns the middle page to tomorrow; the one before is 5:59pm.
  @MainActor
  @Test("durham-tomorrow from 5:59:30pm: the next tick is 6pm at the place, and turns the page")
  func durhamFlip() throws {
    let res = try fixture("durham-tomorrow")
    let made = try fixtureNow("durham-tomorrow")
    // 6:05pm GMT, so 5:59:30pm is 5 minutes 30 seconds before.
    let start = later(made, seconds: -330)
    let system = Date(epochMs: 1_900_000_000_123)
    let anchor = MinuteTick.anchor(model: start, system: system)
    let offset = start.timeIntervalSince(system)
    let first = anchor.addingTimeInterval(offset)
    let next = anchor.addingTimeInterval(60 + offset)
    #expect((PlaceTime.local(first, in: "Europe/London").hours * 60).rounded() == 17 * 60 + 59)
    #expect((PlaceTime.local(next, in: "Europe/London").hours * 60).rounded() == 18 * 60)
    #expect(abs(next.timeIntervalSince(start) - (30 + MinuteTick.lead)) < 0.000_1)
    let before = HomePage(res, view: .today, at: first, phase: .ready)
    let after = HomePage(res, view: .today, at: next, phase: .ready)
    #expect(!before.tomorrow)
    #expect(after.tomorrow)
    #expect(after.label == MiddleDay.label(.today, tomorrow: true))
  }
}
