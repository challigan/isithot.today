import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItTestSupport
import Testing

/// aberdeen-snow's answer and moments: made at 9:05am on 2 December 2026; its hour holds until
/// 10:00 (GMT is UTC there).
struct Aberdeen {
  let response: TodayResponse
  let made: Date
  let ten: Date

  init() throws {
    response = try fixture("aberdeen-snow")
    made = try fixtureNow("aberdeen-snow")
    ten = later(made, minutes: 55)
  }
}

@Suite("How and when an open app asks again")
struct RefreshTests {
  @Test("plainly while the answer is current, past the caches once it is out of date")
  func how() throws {
    let a = try Aberdeen()
    #expect(Refresh.fetch(nil, at: a.ten, holds: .init()) == .plain)
    #expect(Refresh.fetch(a.response, at: later(a.made, minutes: 25), holds: .init()) == .plain)
    #expect(Refresh.fetch(a.response, at: a.ten, holds: .init()) == .fresh)
    // A fresh answer that was out of date already holds until the server reaches its hour.
    let holds = Freshness.hold(.init(), a.response, at: a.ten)
    #expect(Refresh.fetch(a.response, at: later(a.ten, minutes: 30), holds: holds) == .plain)
    #expect(Refresh.fetch(a.response, at: later(a.ten, minutes: 55), holds: holds) == .fresh)
  }

  @Test("at the next forecast hour, plus the jitter")
  func next() throws {
    let a = try Aberdeen()
    let at = later(a.made, minutes: 25)
    #expect(
      Refresh.next(after: a.response, at: at, jitterMs: 45_000) == a.ten.addingTimeInterval(45))
    #expect(
      Refresh.next(after: a.response, at: at, jitterMs: 0)
        == Freshness.nextRefreshAt(a.response, after: at, jitterMs: 0))
  }

  @Test("offline or rate limited, a minute later plus the jitter")
  func retryOffline() throws {
    let a = try Aberdeen()
    let at = later(a.made, minutes: 25)
    for failure in [FetchError.offline, .rateLimited] {
      #expect(
        Refresh.retry(after: failure, response: a.response, at: at, jitterMs: 45_000)
          == at.addingTimeInterval(105))
      #expect(
        Refresh.retry(after: failure, response: nil, at: at, jitterMs: 0)
          == at.addingTimeInterval(60))
    }
  }

  @Test(
    "after another failure, at the next forecast hour, or with nothing on screen, not by itself")
  func retryFailed() throws {
    let a = try Aberdeen()
    let at = later(a.made, minutes: 25)
    let failure = FetchError.failed(status: 503, code: "upstream_unavailable", message: nil)
    #expect(
      Refresh.retry(after: failure, response: a.response, at: at, jitterMs: 45_000)
        == a.ten.addingTimeInterval(45))
    #expect(Refresh.retry(after: failure, response: nil, at: at, jitterMs: 45_000) == nil)
  }
}

@Suite("Back in the foreground")
struct ForegroundTests {
  @Test("after more than 30 minutes away, back to the view for the time of day")
  func resetView() throws {
    let a = try Aberdeen()
    let away = a.made
    let at = { (ms: Int) in Date(epochMs: away.epochMs + ms) }
    let thirty = Refresh.foreground(
      a.response, fetchedAt: away, awayFrom: away, at: at(1_800_000), holds: .init())
    #expect(!thirty.resetView)
    let more = Refresh.foreground(
      a.response, fetchedAt: away, awayFrom: away, at: at(1_800_001), holds: .init())
    #expect(more.resetView)
  }

  @Test("an answer fetched under 30 minutes ago and current is kept")
  func kept() throws {
    let a = try Aberdeen()
    let back = Refresh.foreground(
      a.response,
      fetchedAt: a.made,
      awayFrom: later(a.made, minutes: 5),
      at: later(a.made, minutes: 30),
      holds: .init()
    )
    #expect(back == .init(resetView: false, fetch: nil))
  }

  @Test("back after a minute, an answer fetched more than 30 minutes ago and current is kept")
  func old() throws {
    // Fetched at 9:05, away from 9:40 to 9:41: the answer is still 9am's, and current.
    let a = try Aberdeen()
    let at = later(a.made, minutes: 36)
    #expect(Freshness.outOfDate(a.response, at: at, holds: .init()) == nil)
    let back = Refresh.foreground(
      a.response, fetchedAt: a.made, awayFrom: later(at, minutes: -1), at: at, holds: .init())
    #expect(back == .init(resetView: false, fetch: nil))
  }

  @Test("after more than 30 minutes away, a fetch, however recent the answer")
  func longAway() throws {
    let a = try Aberdeen()
    let away = later(a.made, minutes: 1)
    let at = { (ms: Int) in Date(epochMs: away.epochMs + ms) }
    let thirty = Refresh.foreground(
      a.response, fetchedAt: away, awayFrom: away, at: at(1_800_000), holds: .init())
    #expect(thirty == .init(resetView: false, fetch: nil))
    let more = Refresh.foreground(
      a.response, fetchedAt: away, awayFrom: away, at: at(1_800_001), holds: .init())
    #expect(more == .init(resetView: true, fetch: .plain))
  }

  @Test("an answer out of date is fetched past the caches")
  func outOfDate() throws {
    let a = try Aberdeen()
    let back = Refresh.foreground(
      a.response,
      fetchedAt: later(a.ten, minutes: -2),
      awayFrom: later(a.ten, minutes: -1),
      at: later(a.ten, minutes: 1),
      holds: .init()
    )
    #expect(back == .init(resetView: false, fetch: .fresh))
  }

  @Test("an answer past its hours is fetched again, though recent and not out of date")
  func pastUsable() throws {
    // Upstream failed, so the server's answer is a cached one from 3:30am: usable until 9:30.
    let response = try edited("aberdeen-snow") { $0["updatedAt"] = "2026-12-02T03:30:00.000Z" }
    let made = try fixtureNow("aberdeen-snow")
    #expect(Freshness.usableUntil(response) == later(made, minutes: 25))
    let at = later(made, minutes: 26)
    #expect(Freshness.outOfDate(response, at: at, holds: .init()) == nil)
    let back = Refresh.foreground(
      response, fetchedAt: later(at, minutes: -5), awayFrom: later(at, minutes: -1), at: at,
      holds: .init())
    #expect(back == .init(resetView: false, fetch: .plain))
  }

  @Test("with no answer, or one with no fetch time or a fetch time after now, a fetch")
  func noAnswer() throws {
    let a = try Aberdeen()
    let at = later(a.made, minutes: 10)
    let away = later(a.made, minutes: 9)
    #expect(
      Refresh.foreground(nil, fetchedAt: nil, awayFrom: away, at: at, holds: .init())
        == .init(resetView: false, fetch: .plain))
    #expect(
      Refresh.foreground(a.response, fetchedAt: nil, awayFrom: away, at: at, holds: .init())
        == .init(resetView: false, fetch: .plain))
    #expect(
      Refresh.foreground(
        a.response, fetchedAt: later(at, minutes: 1), awayFrom: away, at: at, holds: .init())
        == .init(resetView: false, fetch: .plain))
  }
}

@Suite("What the answer views show")
struct AnswerStateTests {
  @Test("an answer's picked hour, until it has none, then the stale state")
  func answer() throws {
    let a = try Aberdeen()
    let until = Freshness.usableUntil(a.response)
    for phase in [AppPhase.ready, .offline, .error(.failed(status: 503, code: nil, message: nil))] {
      let picked = try #require(HourPicker.pick(a.response, at: a.made))
      #expect(AnswerState.at(a.made, response: a.response, phase: phase) == .answer(picked))
      let last = try #require(HourPicker.pick(a.response, at: until.addingTimeInterval(-0.001)))
      #expect(last.source == .ahead)
      #expect(
        AnswerState.at(until.addingTimeInterval(-0.001), response: a.response, phase: phase)
          == .answer(last))
      #expect(AnswerState.at(until, response: a.response, phase: phase) == .stale)
    }
  }

  @Test("with no answer: loading, offline, or the error")
  func noAnswer() {
    let now = Date()
    let failure = FetchError.failed(status: 503, code: "upstream_unavailable", message: "Down.")
    #expect(AnswerState.at(now, response: nil, phase: .loading) == .loading)
    #expect(AnswerState.at(now, response: nil, phase: .ready) == .loading)
    #expect(AnswerState.at(now, response: nil, phase: .offline) == .offline)
    #expect(AnswerState.at(now, response: nil, phase: .error(failure)) == .error(failure))
  }

  @Test("offline, the footer says since when the forecast is")
  func offlineLine() throws {
    let a = try Aberdeen()
    #expect(
      AnswerState.offlineLine(a.response, phase: .offline, at: a.ten)
        == "You're offline. Showing the forecast from 9:05am GMT.")
    #expect(
      AnswerState.offlineLine(a.response, phase: .offline, at: later(a.made, minutes: 24 * 60))
        == "You're offline. Showing the forecast from yesterday, 9:05am GMT.")
    #expect(AnswerState.offlineLine(a.response, phase: .ready, at: a.ten) == nil)
    #expect(AnswerState.offlineLine(nil, phase: .offline, at: a.ten) == nil)
    let undated = try edited("aberdeen-snow") { $0["updated"] = nil }
    #expect(AnswerState.offlineLine(undated, phase: .offline, at: a.ten) == nil)
  }

  @Test("a failure's phase: offline for no connection only, an error otherwise, 429 included")
  func phases() {
    let failure = FetchError.failed(status: 400, code: "bad_location", message: "No.")
    #expect(AppPhase(.offline) == .offline)
    #expect(AppPhase(.rateLimited) == .error(.rateLimited))
    #expect(AppPhase(failure) == .error(failure))
  }
}
