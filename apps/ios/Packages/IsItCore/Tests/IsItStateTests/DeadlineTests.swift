import Foundation
import IsItState
import Testing

/// A value that must come in time (`Deadline`): StoreKit's entitlements in the widget, and its
/// request. The wait is never longer than the limit, whatever the work does.
@Suite("A deadline", .timeLimit(.minutes(1)))
struct DeadlineTests {
  @Test("an answer that comes in time is kept")
  func anAnswerInTimeIsKept() async {
    #expect(await Deadline.value(within: 1) { 5 } == 5)
  }

  @Test("no answer in time is nil, as soon as the limit comes")
  func noAnswerInTimeIsNil() async {
    let gate = Gate()
    releasing { gate.open() }
    let start = Date()
    let value = await Deadline.value(within: 0.05) { () async -> Int in
      await gate.wait()
      return 5
    }
    #expect(value == nil)
    #expect(Date().timeIntervalSince(start) < 5)
    gate.open()
  }

  @Test("a late answer is dropped, and the work still finishes")
  func aLateAnswerIsDropped() async {
    let gate = Gate()
    releasing { gate.open() }
    let finished = Locked(false)
    let value = await Deadline.value(within: 0.05) { () async -> Int in
      await gate.wait()
      finished.change { $0 = true }
      return 5
    }
    #expect(value == nil)
    gate.open()
    #expect(await eventually { finished.read { $0 } })
  }

  @Test("the work and the limit arriving together resume the wait once")
  func resumesOnceWhenBothArriveTogether() async {
    var values: [Int?] = []
    for _ in 0..<100 {
      values.append(await Deadline.value(within: 0) { 5 })
    }
    #expect(values.count == 100)
    #expect(values.allSatisfy { $0 == 5 || $0 == nil })
  }
}
