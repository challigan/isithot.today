import Foundation
import IsItModel
import Testing

@Suite("The API's dates, written and read")
struct ApiJSONDateTests {
  @Test("are written as JavaScript's toISOString writes them, to the millisecond")
  func written() {
    #expect(ApiJSON.string(Date(epochMs: 1_796_205_601_234)) == "2026-12-02T10:00:01.234Z")
    #expect(ApiJSON.string(Date(epochMs: 1_796_205_600_000)) == "2026-12-02T10:00:00.000Z")
    #expect(ApiJSON.string(Date(epochMs: 1_796_205_600_007)) == "2026-12-02T10:00:00.007Z")
    #expect(ApiJSON.string(Date(epochMs: 0)) == "1970-01-01T00:00:00.000Z")
    #expect(ApiJSON.string(Date(epochMs: -1)) == "1969-12-31T23:59:59.999Z")
    // A moment between two milliseconds is written as its nearest.
    #expect(
      ApiJSON.string(Date(timeIntervalSince1970: 1_796_205_601.234_6)) == "2026-12-02T10:00:01.235Z"
    )
  }

  @Test("read back as the same Date, whatever the millisecond")
  func roundTrip() throws {
    var ms = 1_796_205_600_000
    for step in 0..<5_000 {
      ms += 1 + step % 7
      let date = Date(epochMs: ms)
      let read = try #require(ApiJSON.parseDate(ApiJSON.string(date)))
      #expect(read == date, "\(ms)")
    }
  }

  @Test("read as the moment of their millisecond, however the parser adds up the fraction")
  func read() throws {
    let date = try #require(ApiJSON.parseDate("2026-12-02T10:00:01.234Z"))
    #expect(date == Date(epochMs: 1_796_205_601_234))
    #expect(ApiJSON.parseDate("2026-12-02T10:00:01.2349Z") == date)
    #expect(ApiJSON.parseDate("2026-12-02T10:00:01Z") == Date(epochMs: 1_796_205_601_000))
  }
}
