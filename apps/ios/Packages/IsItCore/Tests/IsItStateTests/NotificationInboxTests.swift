import Foundation
import IsItState
import Testing

/// What a handler heard, in order, with a gate for each event it holds on (by its number, from
/// 1), so a test can keep one event's handling going while others are posted.
@MainActor
final class Heard {
  private(set) var events: [NotificationInbox.Event] = []
  private(set) var started = 0
  private var gates: [Int: Gate] = [:]

  /// Holds the handling of the `number`th event heard until `release(number)`.
  func hold(_ number: Int) {
    gates[number] = Gate()
  }

  func release(_ number: Int) {
    gates[number]?.open()
  }

  func handle(_ event: NotificationInbox.Event) async {
    started += 1
    await gates[started]?.wait()
    events.append(event)
  }
}

/// `NotificationInbox` (iOS build spec, section 12.3): the app delegate and the centre's
/// delegate post as soon as the system speaks, which can be before the app has attached its
/// handler. Each test builds its own inbox: no Linux test touches `shared`, as Swift Testing
/// runs the tests in parallel.
@MainActor
@Suite("The notifications' inbox", .timeLimit(.minutes(1)))
struct NotificationInboxTests {
  let tap = NotificationInbox.Event.tapped(Data(#"{"topic":"snow"}"#.utf8))

  @Test("events posted before the handler is attached are kept, and delivered in order")
  func keptUntilAttached() async {
    let inbox = NotificationInbox()
    let heard = Heard()
    inbox.post(.token("0a"))
    inbox.post(tap)
    inbox.post(.openSettings)
    await inbox.drained()
    #expect(heard.events.isEmpty)
    inbox.attach { await heard.handle($0) }
    await inbox.drained()
    #expect(heard.events == [.token("0a"), tap, .openSettings])
  }

  @Test("once attached, each event is delivered as it is posted")
  func deliveredAfter() async {
    let inbox = NotificationInbox()
    let heard = Heard()
    inbox.attach { await heard.handle($0) }
    inbox.post(.registrationFailed)
    await inbox.drained()
    #expect(heard.events == [.registrationFailed])
    inbox.post(.arrived(nil))
    await inbox.drained()
    #expect(heard.events == [.registrationFailed, .arrived(nil)])
  }

  @Test("one at a time: a handler that waits lets no later event overtake it")
  func oneAtATime() async {
    let inbox = NotificationInbox()
    let heard = Heard()
    heard.hold(1)
    inbox.attach { await heard.handle($0) }
    inbox.post(.token("0a"))
    inbox.post(tap)
    #expect(await yieldUntil { heard.started == 1 }, "the first event was never handled")
    for _ in 0..<100 { await Task.yield() }
    #expect(heard.started == 1)
    #expect(heard.events.isEmpty)
    heard.release(1)
    await inbox.drained()
    #expect(heard.events == [.token("0a"), tap])
  }

  @Test("a second handler replaces the first, from the next event on")
  func aSecondAttachReplacesTheFirst() async {
    let inbox = NotificationInbox()
    let first = Heard()
    let second = Heard()
    inbox.attach { await first.handle($0) }
    inbox.post(.token("0a"))
    await inbox.drained()
    inbox.attach { await second.handle($0) }
    inbox.post(.openSettings)
    await inbox.drained()
    #expect(first.events == [.token("0a")])
    #expect(second.events == [.openSettings])
  }

  @Test("drained returns only once the last event posted has been handled")
  func drainedWaitsForTheLast() async {
    let inbox = NotificationInbox()
    let heard = Heard()
    heard.hold(2)
    inbox.attach { await heard.handle($0) }
    inbox.post(.token("0a"))
    inbox.post(tap)
    inbox.post(.openSettings)
    let drained = Task { await inbox.drained() }
    #expect(await yieldUntil { heard.started == 2 }, "the second event was never handled")
    #expect(heard.events == [.token("0a")])
    heard.release(2)
    await drained.value
    #expect(heard.events == [.token("0a"), tap, .openSettings])
  }
}
