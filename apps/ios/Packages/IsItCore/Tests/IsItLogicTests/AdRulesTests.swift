import Foundation
import IsItLogic
import IsItModel
import Testing

/// When the free version's ads may show (`AdRules`): the full-screen ad's 5 minutes apart and 55
/// minutes old at most, and the waits before a failed load is asked for again.
@Suite("The ads' rules")
struct AdRulesTests {
  let now = Date(epochMs: 1_796_202_300_000)

  /// Whether a full-screen ad is due now, the last one shown `secondsAgo` (nil: none yet).
  func isDue(_ secondsAgo: Double?, firstRun: Bool = false) -> Bool {
    let lastShown = secondsAgo.map { now.addingTimeInterval(-$0) }
    return AdRules.interstitialDue(lastShown: lastShown, now: now, firstRun: firstRun)
  }

  /// Whether a full-screen ad loaded `secondsAgo` may still show.
  func isFresh(_ secondsAgo: Double) -> Bool {
    AdRules.interstitialFresh(loadedAt: now.addingTimeInterval(-secondsAgo), now: now)
  }

  @Test("a full-screen ad is due with none shown yet, and from 5 minutes after the last")
  func due() {
    #expect(isDue(nil))
    #expect(isDue(300))
    #expect(isDue(86_400))
    #expect(!isDue(299))
    #expect(!isDue(299.999))
    #expect(!isDue(0))
  }

  @Test("a last one after now, the phone's clock having moved back, counts as just shown")
  func clockBack() {
    #expect(!isDue(-0.001))
    #expect(!isDue(-3_600))
  }

  @Test("never in the app's first run")
  func firstRun() {
    for secondsAgo in [nil, 0, 300, 86_400.0] {
      #expect(!isDue(secondsAgo, firstRun: true), "\(String(describing: secondsAgo))")
    }
  }

  @Test("a full-screen ad loaded under 55 minutes ago may show, and from 55 minutes on, not")
  func fresh() {
    #expect(isFresh(0))
    #expect(isFresh(54 * 60 + 59))
    #expect(isFresh(55 * 60 - 0.001))
    #expect(!isFresh(55 * 60))
    #expect(!isFresh(3_600))
  }

  @Test("one loaded after now, the clock having moved back, can't be aged, so isn't fresh")
  func loadedLater() {
    #expect(!isFresh(-0.001))
    #expect(!isFresh(-3_600))
  }

  @Test("the waits after failed loads in a row: 60 seconds, doubling, at most 600")
  func retryDelay() {
    let waits = (1...7).map { AdRules.retryDelay(failures: $0) }
    #expect(waits == [60, 120, 240, 480, 600, 600, 600])
    #expect(AdRules.retryDelay(failures: 1_000) == 600)
    #expect(AdRules.retryDelay(failures: .max) == 600)
  }

  @Test("no failures, or fewer, count as one")
  func retryDelayNone() {
    #expect(AdRules.retryDelay(failures: 0) == 60)
    #expect(AdRules.retryDelay(failures: -3) == 60)
    #expect(AdRules.retryDelay(failures: .min) == 60)
  }
}
