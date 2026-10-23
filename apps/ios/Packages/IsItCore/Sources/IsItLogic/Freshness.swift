import Foundation
import IsItModel

/// How long an answer holds, and when to ask again: the port of client `freshness.ts`, checked
/// against `freshness.json`. Nothing here reads a clock: whatever needs the time is given it.
/// Moments are compared and added in whole milliseconds (`Date.epochMs`), as the TypeScript
/// does, so the rules agree with it to the millisecond.
public enum Freshness {
  /// Why an answer is out of date (client `Stale`): the place's day has moved on, or the hour
  /// it holds for.
  public enum Stale: String, Codable, Sendable, CaseIterable {
    case day, hour
  }

  /// How long a fresh answer that is out of date already counts as current: past `until`, the
  /// moment it went out of date, until `at`.
  public struct Hold: Sendable, Equatable {
    public let until: Date
    public let at: Date

    public init(until: Date, at: Date) {
      self.until = until
      self.at = at
    }
  }

  /// The holds the app keeps between answers, and passes back (client `Holds`). A clock running
  /// fast makes the answer look out of date before the server has a newer one: past the hour
  /// today's answers hold for, or past the place's midnight. When a fresh answer is out of date
  /// already, it is good until the server reaches that moment: at the latest, as long from now
  /// as the server had left when working it out. So a fast clock costs at most one extra
  /// request per server hour, and one at midnight.
  public struct Holds: Sendable, Equatable {
    public var day: Hold?
    public var hour: Hold?

    public init(day: Hold? = nil, hour: Hold? = nil) {
      self.day = day
      self.hour = hour
    }

    public subscript(reason: Stale) -> Hold? {
      get {
        switch reason {
        case .day: day
        case .hour: hour
        }
      }
      set {
        switch reason {
        case .day: day = newValue
        case .hour: hour = newValue
        }
      }
    }
  }

  /// When today's rain, snow and wind answers go out of date: the next forecast hour (client
  /// `hourUntil`). Nil without a today.
  public static func hourUntil(_ res: TodayResponse) -> Date? {
    hourUntilMs(res).map(Date.init(epochMs:))
  }

  /// When today's answer goes out of date: the place's midnight, the first hour of the hot
  /// answer's series on a later date (client `dayUntil`). Nil when the series doesn't reach it.
  public static func dayUntil(_ res: TodayResponse) -> Date? {
    dayUntilMs(res).map(Date.init(epochMs:))
  }

  /// `holds` with a hold for each way a fresh answer is out of date already when it arrives at
  /// `now` (client `hold`). The others are kept as they are.
  public static func hold(_ holds: Holds, _ res: TodayResponse, at now: Date) -> Holds {
    let now = now.epochMs
    var next = holds
    // `made`: when the server worked that part of the answer out.
    func set(_ reason: Stale, _ until: Int?, made: Date?) {
      guard let until, let made else { return }
      let from = made.epochMs
      if now >= until && from < until {
        next[reason] = Hold(until: Date(epochMs: until), at: Date(epochMs: now + until - from))
      }
    }
    set(.day, dayUntilMs(res), made: res.hotNow?.time)
    set(.hour, hourUntilMs(res), made: hourly(res)?.from)
    return next
  }

  /// Whether the answer is out of date at `now` (client `outOfDate`): past local midnight
  /// (today's answer is yesterday's) or past the end of the hourly series it carries (`day`),
  /// or past the hour today's rain, snow and wind answers hold for (`hour`). A clock running far
  /// behind is not a reason, and one running fast waits for the server (`Holds`).
  public static func outOfDate(_ res: TodayResponse, at now: Date, holds: Holds) -> Stale? {
    let now = now.epochMs
    /// Whether the clock has passed `until` for `reason`, or the hold on it.
    func past(_ reason: Stale, _ until: Int) -> Bool {
      if let held = holds[reason], held.until.epochMs == until {
        return now >= held.at.epochMs
      }
      return now >= until
    }
    if let hotNow = res.hotNow {
      let series = hotNow.series
      let old: Bool
      if let current = currentDate(series, at: now) {
        old = current > (res.hotDays?.first?.date ?? "")
      } else {
        old = series.last.map { now > $0.time.epochMs } ?? false
      }
      if old {
        guard let midnight = dayUntilMs(res) else { return .day }
        if past(.day, midnight) { return .day }
      }
    }
    guard let until = hourUntilMs(res), past(.hour, until) else { return nil }
    return .hour
  }

  /// Until when an answer may be shown at all (client `usableUntil`): the end of its last hour
  /// ahead (or, without hours ahead, the hour it holds for), and never once the forecast behind
  /// it is older than the server's own stale limit (`Constants.Cache.forecastStale`). Past it
  /// the app and the widgets say they have no recent forecast, rather than show an old hour.
  public static func usableUntil(_ res: TodayResponse) -> Date {
    Date(epochMs: usableUntilMs(res))
  }

  /// When an app that stays open asks again (client `nextRefreshAt`): the start of the next
  /// forecast hour after `now`, plus `jitterMs` (0 to `Constants.Client.refreshJitterMs`,
  /// chosen at random by the caller).
  public static func nextRefreshAt(_ res: TodayResponse, after now: Date, jitterMs: Int) -> Date {
    Date(epochMs: hourAfter(hourly(res)?.series, now.epochMs) + jitterMs)
  }

  // MARK: - In milliseconds, as the TypeScript counts (core `HOUR` is `Date.hourMs`)

  static func hourUntilMs(_ res: TodayResponse) -> Int? {
    guard let block = hourly(res), let from = block.from else { return nil }
    return hourAfter(block.series, from.epochMs)
  }

  static func dayUntilMs(_ res: TodayResponse) -> Int? {
    let date = res.hotDays?.first?.date ?? ""
    return res.hotNow?.series.first { $0.date > date }?.time.epochMs
  }

  static func usableUntilMs(_ res: TodayResponse) -> Int {
    let end: Int?
    if let last = res.snow?.ahead?.last {
      end = last.time.epochMs + Date.hourMs
    } else {
      end = hourUntilMs(res)
    }
    let stale = res.updatedAt.epochMs + Constants.Cache.forecastStale * 1000
    // No end is no limit, as JavaScript's Infinity.
    return end.map { Swift.min($0, stale) } ?? stale
  }

  /// What today's rain, snow and wind answers hold for, which all cover the rest of the day from
  /// the same moment: rain's carries it, or snow's in an answer without rain.
  private struct Hourly {
    /// When today's window starts.
    let from: Date?
    /// The hours of its Now's series.
    let series: [ApiClockHour]?
  }

  private static func hourly(_ res: TodayResponse) -> Hourly? {
    if let rain = res.rain {
      return Hourly(from: rain.days.first?.from, series: rain.now?.series)
    }
    if let snow = res.snow {
      return Hourly(from: snow.days.first?.from, series: snow.now?.series)
    }
    return nil
  }

  /// The start of the first forecast hour after `at`: the series' next, else the next UTC hour.
  private static func hourAfter(_ series: [ApiClockHour]?, _ at: Int) -> Int {
    if let next = series?.first(where: { $0.time.epochMs > at }) {
      return next.time.epochMs
    }
    return Int((Double(at) / Double(Date.hourMs)).rounded(.down)) * Date.hourMs + Date.hourMs
  }

  /// The local date of the hour core `computeNow` reads at `time`, or nil where it has no answer:
  /// the last hour begun by then, or for a clock less than an hour behind the series, its first;
  /// with a next hour no more than 3 hours on, or within the hour. Only the hours' moments
  /// decide it.
  private static func currentDate(_ series: [ApiClockHour], at time: Int) -> String? {
    guard let first = series.first else { return nil }
    var i = -1
    while i + 1 < series.count && series[i + 1].time.epochMs <= time { i += 1 }
    let a: ApiClockHour
    if i >= 0 {
      a = series[i]
    } else if time > first.time.epochMs - Date.hourMs {
      a = first
    } else {
      return nil
    }
    if i >= 0, i + 1 < series.count,
      series[i + 1].time.epochMs - a.time.epochMs <= 3 * Date.hourMs
    {
      return a.date
    }
    return time - a.time.epochMs < Date.hourMs ? a.date : nil
  }
}
