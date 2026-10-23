import Foundation

/// A local calendar date (YYYY-MM-DD) read as the client's TypeScript reads it, with no
/// calendar or locale: the links' dates (`DeepLink`) and the week's days (`HomePage.WeekRow`).
enum CivilDate {
  /// YYYY-MM-DD in ASCII digits (`/^\d{4}-\d{2}-\d{2}$/`, whose `\d` is ASCII only), with a
  /// month from 1 to 12 and a day from 1 to 31.
  static func parts(_ text: String) -> (year: Int, month: Int, day: Int)? {
    let bytes = Array(text.utf8)
    guard bytes.count == 10, bytes[4] == UInt8(ascii: "-"), bytes[7] == UInt8(ascii: "-")
    else { return nil }
    func number(_ range: Range<Int>) -> Int? {
      var value = 0
      for byte in bytes[range] {
        guard (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(byte) else { return nil }
        value = value * 10 + Int(byte - UInt8(ascii: "0"))
      }
      return value
    }
    guard let year = number(0..<4), let month = number(5..<7), let day = number(8..<10),
      (1...12).contains(month), (1...31).contains(day)
    else { return nil }
    return (year, month, day)
  }

  /// Days from 1 January 1970 to the date, in the proleptic Gregorian calendar; a day past the
  /// month's end counts on into the next, as JavaScript's `Date.UTC` counts it.
  static func daysSinceEpoch(year: Int, month: Int, day: Int) -> Int {
    let y = month <= 2 ? year - 1 : year
    let era = (y >= 0 ? y : y - 399) / 400
    let yearOfEra = y - era * 400
    let dayOfYear = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
    let dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
    return era * 146_097 + dayOfEra - 719_468
  }

  /// The date's day of the week, 0 for Sunday to 6 for Saturday, as JavaScript's `getUTCDay`
  /// gives it for the date's UTC midnight (core `parseDate`); nil for text that isn't a date.
  static func weekday(_ text: String) -> Int? {
    guard let (year, month, day) = parts(text) else { return nil }
    // 1 January 1970 was a Thursday.
    let days = daysSinceEpoch(year: year, month: month, day: day)
    return ((days % 7) + 7 + 4) % 7
  }
}
