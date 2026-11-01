import Foundation

/// A value that must come in time (iOS build spec, section 11.2): StoreKit's entitlements in the
/// widget (V3), and the widget's request, which the system may stop with the extension.
public enum Deadline {
  /// `work`'s value, or nil when it hasn't come within `seconds`. Late work is left to finish
  /// and its value dropped; the wait is never longer than `seconds`. Two unstructured tasks race
  /// to resume one continuation, claimed once under a lock: a task group would wait for a child
  /// that ignores cancellation, and `for await` over StoreKit's entitlements may never end.
  public static func value<T: Sendable>(
    within seconds: TimeInterval, _ work: @escaping @Sendable () async -> T
  ) async -> T? {
    let once = Once()
    return await withCheckedContinuation { (continuation: CheckedContinuation<T?, Never>) in
      // Cancelled once the work has its value, it returns without claiming.
      let timer = Task {
        do {
          try await Task.sleep(nanoseconds: nanoseconds(seconds))
        } catch {
          return
        }
        if once.claim() { continuation.resume(returning: nil) }
      }
      Task {
        let value = await work()
        timer.cancel()
        if once.claim() { continuation.resume(returning: value) }
      }
    }
  }

  /// `seconds` in nanoseconds: none for a limit that is negative or not a number, and the longest
  /// wait there is for one too long to count.
  private static func nanoseconds(_ seconds: TimeInterval) -> UInt64 {
    let nanoseconds = seconds * 1_000_000_000
    guard nanoseconds > 0 else { return 0 }
    return nanoseconds < Double(UInt64.max) ? UInt64(nanoseconds) : .max
  }
}

/// Whether the wait has been resumed: the first to claim it resumes it, and no one after.
private final class Once: @unchecked Sendable {
  private let lock = NSLock()
  private var claimed = false

  /// True for the first caller only.
  func claim() -> Bool {
    lock.withLock {
      defer { claimed = true }
      return !claimed
    }
  }
}
