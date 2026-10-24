import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItTestSupport
import Testing

/// Settings' snow units control (iOS build spec, section 10.4): the units are kept in
/// `units.v1`, and the answer is asked for again in them, as the website's units pill does.
@MainActor
@Suite("The snow units, from Settings")
struct UnitsTests {
  /// aberdeen-snow saved a minute ago, in centimetres, so the launch keeps it without asking.
  func openAberdeen(replies: [FakeTransport.Reply]) throws -> Harness {
    let saved = try savedAberdeen()
    return Harness(
      now: later(saved.savedAt, minutes: 1),
      store: .init(place: aberdeen, units: .c, today: saved),
      replies: replies
    )
  }

  @Test("inches are kept, asked for, saved and shown, and the notifications follow")
  func inches() async throws {
    let h = try openAberdeen(replies: [try FakeTransport.fixture("denver-f")])
    await h.model.launch()
    #expect(h.transport.urls.isEmpty, "the launch kept the saved answer")
    let calls = h.hooks.calls.count
    await h.model.setUnits(.f)
    #expect(h.model.units == .f)
    #expect(h.store.loadUnits() == .f)
    #expect(h.store.contents.read(\.unitsSaves) == 1)
    #expect(
      h.transport.urls == [
        "https://willitsnow.today/api/v1/today?place=aberdeen-gb&units=f&ahead=snow"
      ])
    #expect(h.model.response?.units == .f)
    #expect(h.model.phase == .ready)
    #expect(h.store.today?.response.units == .f)
    #expect(h.store.today?.key == "city:aberdeen-gb")
    #expect(h.widgets.reloads == 1)
    #expect(Array(h.hooks.calls.dropFirst(calls)) == ["syncAlerts city:aberdeen-gb f"])
    #expect(h.model.nextRefreshAt != nil)
  }

  @Test("while the answer in the new units is on its way, the last one stays on screen")
  func answerStays() async throws {
    let saved = try savedAberdeen()
    let inches = HTTPResponse(status: 200, body: try Fixtures.data("denver-f"))
    let transport = GatedTransport(first: inches, others: inches)
    let model = AppModel(
      environment: AppEnvironment(
        client: APIClient(transport: transport),
        clock: TestClock(later(saved.savedAt, minutes: 1)),
        store: FakeState(.init(place: aberdeen, units: .c, today: saved)),
        widgets: FakeWidgets(),
        hooks: NoHooks(),
        random: { _ in 0 }
      ))
    await model.launch()
    let setting = Task { await model.setUnits(.f) }
    let started = await yieldUntil { transport.requests == 1 }
    try #require(started, "the fetch in inches never started")
    #expect(model.units == .f)
    #expect(model.response == saved.response)
    #expect(model.phase == .ready)
    #expect(model.page(.today, at: model.now).state == .ready)
    transport.release()
    await setting.value
    #expect(model.response?.units == .f)
  }

  @Test("the units already in use ask nothing")
  func sameUnits() async throws {
    let h = try openAberdeen(replies: [try FakeTransport.fixture("aberdeen-snow")])
    await h.model.launch()
    let calls = h.hooks.calls
    await h.model.setUnits(.c)
    #expect(h.transport.urls.isEmpty)
    #expect(h.store.contents.read(\.unitsSaves) == 0)
    #expect(h.hooks.calls == calls)
  }

  @Test("offline, the units stay chosen and the answer on screen stays, with the offline line")
  func offline() async throws {
    let h = try openAberdeen(replies: [.failure(.notConnectedToInternet)])
    await h.model.launch()
    await h.model.setUnits(.f)
    #expect(h.model.units == .f)
    #expect(h.store.loadUnits() == .f)
    #expect(h.model.response?.units == .c)
    #expect(h.model.phase == .offline)
    #expect(h.model.offlineLine(at: h.model.now) != nil)
    // The next launch asks in inches, and never paints the answer saved in centimetres.
    #expect(!Launch.paints(try savedAberdeen(), target: aberdeen, units: .f, at: h.model.now))
  }

  @Test("before the first answer chose them, the units chosen are the first asked for")
  func beforeTheFirstAnswer() async throws {
    let now = try fixtureNow("ip-first-launch")
    let h = Harness(now: now, replies: [try FakeTransport.fixture("ip-first-launch")])
    #expect(h.model.units == nil)
    await h.model.setUnits(.f)
    #expect(h.store.loadUnits() == .f)
    #expect(h.transport.urls.count == 1)
    #expect(h.transport.urls.first?.contains("units=f") == true)
    // The answer's own units don't replace the ones chosen.
    #expect(h.model.units == .f)
  }
}
