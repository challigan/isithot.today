import Foundation
import IsItModel

/// One request per query at a time in this process (spec 11.2, "single-flight"): a widget whose
/// request is already out waits for the same answer, so a small, a medium and a Lock Screen
/// widget reloaded together ask once, and the answer is saved once. Across processes the App
/// Group's saved answer does the same, through `WidgetSource.reuses`.
public actor FetchGate {
  /// The widget extension's one gate. Tests make their own: Swift Testing runs them in
  /// parallel, and their queries are the same URL.
  public static let shared = FetchGate()

  /// The requests out, by query, with how many callers wait on each.
  private var running: [String: (task: Task<SavedToday?, Never>, callers: Int)] = [:]

  public init() {}

  /// `work`'s answer; a caller with the same `key` while it runs gets the same one. Once the
  /// request has finished it is forgotten, so the next caller asks again.
  public func run(
    _ key: String, _ work: @escaping @Sendable () async -> SavedToday?
  ) async -> SavedToday? {
    let task = running[key]?.task ?? Task { await work() }
    running[key] = (task, (running[key]?.callers ?? 0) + 1)
    let answer = await task.value
    // The first caller back forgets the finished request, and with it every caller's count.
    if running[key]?.task == task { running[key] = nil }
    return answer
  }

  /// How many callers are waiting on `key`'s request now, 0 when none is out: what a test waits
  /// on before it lets a held request through, as nothing else shows that a second caller has
  /// joined the first.
  public func callers(for key: String) -> Int {
    running[key]?.callers ?? 0
  }
}
