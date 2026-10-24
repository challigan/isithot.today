import Foundation

/// A clock that reads one moment however long the app runs: a Debug build's `-clock fixed` (iOS
/// build spec, section 9.8), so a UI test reads the screen its moment shows, every time, and
/// nothing falls due by itself while it reads. Work for a time already reached runs at once, as
/// `SystemClock` runs it; work for any later time never runs, since that time never comes.
public struct FixedClock: AppClock {
  public let now: Date

  public init(at moment: Date) {
    now = moment
  }

  public func schedule(at date: Date, _ work: @escaping @MainActor @Sendable () async -> Void)
    -> ScheduledWork
  {
    guard date <= now else { return ScheduledWork {} }
    let task = Task { @MainActor in
      guard !Task.isCancelled else { return }
      await work()
    }
    return ScheduledWork { task.cancel() }
  }
}
