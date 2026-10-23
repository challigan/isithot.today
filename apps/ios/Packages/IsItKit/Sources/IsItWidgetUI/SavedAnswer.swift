import Foundation
import IsItLogic
import IsItModel
import IsItServices
import SwiftUI
import WidgetKit

/// What the skeleton's widget shows: the saved answer's place and the rest of today, worded by the
/// server, for the hour picked (`HourPicker.pick`), or nothing when none is saved or its hours
/// have run out. Phase 7 replaces this with `WidgetPlanner`'s entries, which add 6pm, and the
/// locked and stale states (iOS build spec, section 11).
public struct SavedAnswerEntry: TimelineEntry, Equatable, Sendable {
  public let date: Date
  public let answer: SavedAnswer?

  public init(date: Date, answer: SavedAnswer?) {
    self.date = date
    self.answer = answer
  }
}

/// The saved answer, as the widget shows it.
public struct SavedAnswer: Equatable, Sendable {
  /// "Aberdeen"
  public let place: String
  /// "Yes."
  public let answer: String
  /// "Snow", or the verdict for an answer from before `bandLabel`.
  public let label: String

  /// The rest of today from `response`; nil without a snow answer.
  public init?(response: TodayResponse) {
    guard let day = response.snow?.days.first else { return nil }
    self.init(place: response.location.name, day: day)
  }

  /// The rest of today as `response` answers it at `date`, for the hour picked then
  /// (`HourPicker.pick`); nil once its hours have run out (`Freshness.usableUntil`), so the
  /// widget never shows an old hour as if it were current, or without a snow answer.
  public init?(response: TodayResponse, at date: Date) {
    guard let day = HourPicker.pick(response, at: date)?.today else { return nil }
    self.init(place: response.location.name, day: day)
  }

  private init(place: String, day: ApiSnowDay) {
    self.place = place
    answer = day.answer
    label = day.bandLabel ?? day.verdict
  }
}

/// The skeleton's timeline, from the answer the app saved in the App Group: an entry now, one as
/// each of its hours ahead starts, and one with nothing when its hours run out. The app reloads
/// the timelines whenever it saves an answer, so the widget never asks again by itself.
public struct SavedAnswerProvider: TimelineProvider {
  private let store: () -> SharedStore?

  /// `store` opens the App Group each time the widget asks, so an answer saved since is read.
  public init(store: @escaping () -> SharedStore?) {
    self.store = store
  }

  /// The entry at `date`: the saved answer's hour then, or none.
  public func entry(at date: Date) -> SavedAnswerEntry {
    entries(from: date)[0]
  }

  /// The entries from `now`: one now, one as each hour ahead starts, and one at
  /// `Freshness.usableUntil`, which has no answer; just one, with none, when nothing is saved.
  public func entries(from now: Date) -> [SavedAnswerEntry] {
    guard let response = store()?.loadToday()?.response else {
      return [SavedAnswerEntry(date: now, answer: nil)]
    }
    let until = Freshness.usableUntil(response)
    let starts = (response.snow?.ahead ?? []).map(\.time).filter { $0 > now && $0 < until }
    let dates = [now] + starts + (until > now ? [until] : [])
    return dates.map { SavedAnswerEntry(date: $0, answer: SavedAnswer(response: response, at: $0)) }
  }

  public func placeholder(in context: Context) -> SavedAnswerEntry {
    SavedAnswerEntry(date: Date(), answer: nil)
  }

  public func getSnapshot(in context: Context, completion: @escaping (SavedAnswerEntry) -> Void) {
    completion(entry(at: Date()))
  }

  public func getTimeline(
    in context: Context,
    completion: @escaping (Timeline<SavedAnswerEntry>) -> Void
  ) {
    completion(Timeline(entries: entries(from: Date()), policy: .never))
  }
}

/// The skeleton widget's one layout, the small family's. The widget gives it its background.
public struct SavedAnswerView: View {
  public let entry: SavedAnswerEntry

  public init(entry: SavedAnswerEntry) {
    self.entry = entry
  }

  public var body: some View {
    if let answer = entry.answer {
      VStack(alignment: .leading, spacing: 4) {
        Text(verbatim: answer.place)
          .font(.caption.weight(.semibold))
          .lineLimit(1)
        Spacer(minLength: 0)
        Text(verbatim: answer.answer)
          .font(.largeTitle.weight(.bold))
          .lineLimit(1)
          .minimumScaleFactor(0.6)
        Text(verbatim: answer.label)
          .font(.subheadline)
          .lineLimit(2)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    } else {
      // Nothing saved yet: the shape of an answer, with no words until the app has one.
      VStack(alignment: .leading, spacing: 8) {
        Capsule().frame(width: 72, height: 10)
        Spacer(minLength: 0)
        Capsule().frame(width: 56, height: 28)
        Capsule().frame(width: 96, height: 12)
      }
      .foregroundStyle(.quaternary)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      .accessibilityHidden(true)
    }
  }
}
