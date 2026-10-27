import Foundation
import IsItModel

/// When the free version's ads may show (phase 8.3): the full-screen ad's spacing and age, and
/// the wait before a failed load is asked for again. Pure: `AdsModel` (IsItState) reads the
/// clock and keeps when the last full-screen ad showed.
public enum AdRules {
  /// Whether a full-screen ad may show now: never in the app's first run, and only once
  /// `Constants.Ads.interstitialGapMinutes` have passed since the last one (none yet: due), as
  /// Google never allows one right after another. A last one after `now` (the phone's clock
  /// moved back) counts as just shown: the minutes count from it.
  public static func interstitialDue(lastShown: Date?, now: Date, firstRun: Bool) -> Bool {
    guard !firstRun else { return false }
    guard let lastShown else { return true }
    return now.timeIntervalSince(lastShown) >= gap
  }

  /// Whether an interstitial loaded at `loadedAt` may still be shown: younger than
  /// `Constants.Ads.interstitialMaxAgeMinutes`, short of the hour after which Google's SDK no
  /// longer shows it. One loaded after `now` (the clock moved back) can't be aged, so isn't.
  public static func interstitialFresh(loadedAt: Date, now: Date) -> Bool {
    let age = now.timeIntervalSince(loadedAt)
    return age >= 0 && age < maxAge
  }

  /// The wait before loading again after `failures` failed loads in a row (1 or more; fewer
  /// count as 1): `Constants.Ads.retryFirstSeconds`, doubling with each failure, at most
  /// `retryMaxSeconds` (60, 120, 240, 480, 600, 600… seconds).
  public static func retryDelay(failures: Int) -> TimeInterval {
    let first = TimeInterval(Constants.Ads.retryFirstSeconds)
    let doublings = Double(max(failures, 1) - 1)
    return min(first * pow(2, doublings), TimeInterval(Constants.Ads.retryMaxSeconds))
  }

  /// The least time between two full-screen ads, seconds.
  private static let gap = TimeInterval(Constants.Ads.interstitialGapMinutes * 60)
  /// The age at which a loaded full-screen ad is dropped, seconds.
  private static let maxAge = TimeInterval(Constants.Ads.interstitialMaxAgeMinutes * 60)
}
