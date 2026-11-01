import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItTestSupport
import Testing

/// One request per query at a time (`FetchGate`, spec 11.2's single flight): the widgets reloaded
/// together ask once. Each test makes a gate of its own, and lets a held request through only once
/// every caller has joined it.
@Suite("The widget's single flight", .timeLimit(.minutes(1)))
struct FetchGateTests {
  /// What a widget's request gives: aberdeen-snow, fetched over `transport`, as the widget saves it.
  func work(_ transport: any HTTPTransport, at now: Date) -> @Sendable () async -> SavedToday? {
    let client = APIClient(transport: transport)
    return {
      guard let response = try? await client.today(for: .city(slug: "aberdeen-gb"), units: .c)
      else { return nil }
      return SavedToday(key: "city:aberdeen-gb", savedAt: now, response: response)
    }
  }

  @Test("two callers at once ask once, and both get the one answer")
  func twoAtOnceAskOnce() async throws {
    let transport = GatedTransport(
      first: HTTPResponse(status: 200, body: try Fixtures.data("aberdeen-snow")),
      others: HTTPResponse(status: 503, body: Data()))
    let gate = FetchGate()
    let now = try fixtureNow("aberdeen-snow")
    async let first = gate.run("aberdeen", work(transport, at: now))
    async let second = gate.run("aberdeen", work(transport, at: later(now, minutes: 1)))
    #expect(await joined(gate, key: "aberdeen", count: 2))
    transport.release()
    let (one, two) = await (first, second)
    #expect(transport.requests == 1)
    #expect(one != nil)
    #expect(one == two)
    #expect(one?.savedAt == now || one?.savedAt == later(now, minutes: 1))
  }

  @Test("two queries ask twice")
  func twoQueriesAskTwice() async throws {
    let transport = FakeTransport([try FakeTransport.fixture("aberdeen-snow")])
    let gate = FetchGate()
    let now = try fixtureNow("aberdeen-snow")
    async let first = gate.run("aberdeen", work(transport, at: now))
    async let second = gate.run("aberdeen, in °F", work(transport, at: now))
    let (one, two) = await (first, second)
    #expect(transport.requests.count == 2)
    #expect(one != nil && two != nil)
  }

  @Test("a caller after the last request has finished asks again")
  func oneAfterAnotherAsksAgain() async throws {
    let transport = FakeTransport([try FakeTransport.fixture("aberdeen-snow")])
    let gate = FetchGate()
    let now = try fixtureNow("aberdeen-snow")
    let one = await gate.run("aberdeen", work(transport, at: now))
    let two = await gate.run("aberdeen", work(transport, at: later(now, minutes: 1)))
    #expect(transport.requests.count == 2)
    #expect(one?.savedAt == now)
    #expect(two?.savedAt == later(now, minutes: 1))
  }

  @Test("no caller is counted once the request is done, nor any before it starts")
  func noCallerOnceItsDone() async throws {
    let transport = GatedTransport(
      first: HTTPResponse(status: 200, body: try Fixtures.data("aberdeen-snow")),
      others: HTTPResponse(status: 503, body: Data()))
    let gate = FetchGate()
    let now = try fixtureNow("aberdeen-snow")
    #expect(await gate.callers(for: "aberdeen") == 0)
    async let first = gate.run("aberdeen", work(transport, at: now))
    async let second = gate.run("aberdeen", work(transport, at: now))
    #expect(await joined(gate, key: "aberdeen", count: 2))
    #expect(await gate.callers(for: "leeds") == 0)
    transport.release()
    _ = await (first, second)
    #expect(await gate.callers(for: "aberdeen") == 0)
  }
}
