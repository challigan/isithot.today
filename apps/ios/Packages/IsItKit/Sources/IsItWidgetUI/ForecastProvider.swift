import Foundation
import IsItLogic
import IsItModel
import IsItState
import UIKit
import WidgetKit
import os

/// The widget's timeline provider (iOS build spec, section 11.2): WidgetKit's completions over
/// `WidgetTimeline`, whose plain async code does the work and is tested on Linux. The
/// placeholder and the gallery are the sample; any other snapshot is what is saved; a timeline
/// is `WidgetTimeline.plan(at:)`'s, with one log line. Every path calls its completion once.
public struct ForecastProvider: TimelineProvider {
  public typealias Entry = ForecastEntry

  /// One line per timeline, in every build (TestFlight's are Release), read with Console.app on
  /// a Mac with the iPhone attached: what StoreKit said in the extension settles V3.
  private static let log = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "", category: "timeline")

  /// Whether this process has the answer's face (the extension's `UIAppFonts`), worked out once,
  /// for the log line's `font=`.
  private static let font = UIFont(name: BrandFont.answer.rawValue, size: 12) != nil

  /// Opens the App Group and builds the timeline each time WidgetKit asks; nil without a group.
  private let timeline: @Sendable () -> WidgetTimeline?

  public init(timeline: @escaping @Sendable () -> WidgetTimeline?) {
    self.timeline = timeline
  }

  /// The sample, at once, with no I/O (WidgetKit draws it redacted).
  public func placeholder(in context: Context) -> ForecastEntry {
    ForecastEntry(WidgetTimeline.sample(at: Date()))
  }

  /// The gallery (`context.isPreview`): the sample, whatever the purchase. Otherwise
  /// `saved(at:)`'s first entry: no request, no StoreKit; the stale face without a group. The
  /// planner plans one entry at least.
  public func getSnapshot(
    in context: Context, completion: @escaping @Sendable (ForecastEntry) -> Void
  ) {
    let now = Date()
    guard !context.isPreview else {
      completion(ForecastEntry(WidgetTimeline.sample(at: now)))
      return
    }
    guard let timeline = self.timeline() else {
      completion(Self.withoutGroup(at: now).entries[0])
      return
    }
    completion(ForecastEntry(timeline.saved(at: now).entries[0]))
  }

  /// `context.family` and `context.displaySize` are read first, as the context needn't be
  /// Sendable; then the plan, its log line, and the completion with what WidgetKit is given for
  /// it. Without a group: one stale entry, looked at again after the retry.
  public func getTimeline(
    in context: Context, completion: @escaping @Sendable (Timeline<ForecastEntry>) -> Void
  ) {
    let family = WidgetLook.Family(context.family).rawValue
    let size = context.displaySize
    guard let timeline = self.timeline() else {
      completion(Self.withoutGroup(at: Date()))
      return
    }
    Task {
      let plan = await timeline.plan(at: Date())
      let line = plan.logLine(
        family: family, width: Int(size.width.rounded()), height: Int(size.height.rounded()),
        font: Self.font)
      Self.log.notice("\(line, privacy: .public)")
      completion(Self.timeline(plan))
    }
  }

  /// What WidgetKit is given for `plan`: its entries in order, and `.never` or `.after(date)`
  /// for its reload. Static and public because `TimelineProviderContext` has no public
  /// initialiser, so no test can call `getTimeline`; WidgetProviderTests calls this instead.
  public static func timeline(_ plan: WidgetTimeline.Plan) -> Timeline<ForecastEntry> {
    Timeline(entries: plan.entries.map { ForecastEntry($0) }, policy: policy(plan.reload))
  }

  // MARK: - Private

  /// The timeline without the App Group: the planner's for no answer, one stale entry, looked
  /// at again after `Constants.Widget.retryMinutes`.
  private static func withoutGroup(at now: Date) -> Timeline<ForecastEntry> {
    let plan = WidgetPlanner.entries(nil, fetchedAt: now, now: now, unlocked: true)
    return Timeline(
      entries: plan.entries.map { ForecastEntry(date: $0.date, face: WidgetFace($0, unit: .cm)) },
      policy: policy(plan.reloadAt))
  }

  /// WidgetKit's reload policy for the planner's.
  private static func policy(_ reload: WidgetPlan.Reload) -> TimelineReloadPolicy {
    switch reload {
    case .never: .never
    case .after(let date): .after(date)
    }
  }
}
