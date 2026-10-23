import Foundation
import IsItModel
import IsItTestSupport
import Testing

/// The golden vectors are here and readable. IsItLogic's tests (phase 3) compare its ports with
/// them, case by case.
@Suite("The vector files")
struct VectorFilesTests {
  @Test("every vector file pnpm mobile:generate writes is here")
  func names() throws {
    #expect(
      try Vectors.names() == [
        "alerts", "freshness", "grid", "hours", "links", "placeTime", "query", "questions",
        "recent", "strip", "target", "tomorrow", "widget",
      ])
  }

  @Test("each says what it covers, and each case names a function it lists and a fixture there is")
  func headers() throws {
    let fixtures = Set(try Fixtures.names())
    for name in try Vectors.names() {
      let header = try Vectors.header(name)
      let functions = header.fn.components(separatedBy: ", ")
      #expect(header.source.components(separatedBy: ", ").count == functions.count, "\(name)")
      let json = try #require(
        try JSONSerialization.jsonObject(with: Vectors.data(name)) as? [String: Any])
      let cases = try #require(json["cases"] as? [[String: Any]], "\(name)")
      #expect(!cases.isEmpty, "\(name)")
      for (index, item) in cases.enumerated() {
        let fn = try #require(item["fn"] as? String, "\(name) #\(index)")
        #expect(functions.contains(fn), "\(name) #\(index)")
        #expect(item.keys.sorted() == ["fn", "in", "out"], "\(name) #\(index)")
        if let fixture = (item["in"] as? [String: Any])?["fixture"] as? String {
          #expect(fixtures.contains(fixture), "\(name) #\(index): \(fixture)")
        }
      }
    }
  }

  struct Rounding: Decodable, Sendable {
    let value: Double
    let step: Double
  }

  @Test("a function's cases decode as its own types, and the others are skipped")
  func cases() throws {
    let grid = try Vectors.cases(
      "grid", fn: "roundToGrid", input: Rounding.self, output: Double.self)
    #expect(grid.count > 90)
    let first = try #require(grid.first)
    #expect(
      (first.index, first.input.value, first.input.step, first.output) == (0, -0.2, 0.05, -0.2))

    struct Label: Decodable, Sendable {
      let view: String
      let tomorrow: Bool
    }
    let labels = try Vectors.cases(
      "tomorrow", fn: "viewLabel", input: Label.self, output: String.self)
    #expect(labels.map(\.output) == ["Now", "Now", "Today", "Tomorrow", "This week", "This week"])
    #expect((labels.first?.index ?? 0) > 0)

    struct Fixture: Decodable, Sendable {
      let fixture: String
    }
    // A null output decodes as nil.
    let hours = try Vectors.cases(
      "freshness", fn: "dayUntil", input: Fixture.self, output: Double?.self)
    #expect(hours.count == (try Fixtures.names().count))
    #expect(hours.contains { $0.output != nil })
  }

  @Test("a whole file reads once, with its functions, their cases, and whose cases were read")
  func wholeFile() throws {
    for name in try Vectors.names() {
      let file = try VectorFile(name)
      let header = try Vectors.header(name)
      #expect((file.name, file.fn, file.source) == (name, header.fn, header.source))
      #expect(file.functions == header.fn.components(separatedBy: ", "), "\(name)")
      // Every function the file lists has cases, so a port can't pass by reading nothing.
      #expect(Set(file.counts.keys) == Set(file.functions), "\(name)")
      #expect(file.counts.values.allSatisfy { $0 > 0 }, "\(name)")
      #expect(file.read.isEmpty && file.unread == file.functions, "\(name)")
    }

    struct Updated: Decodable, Sendable {
      let updated: ApiUpdated
      let today: String
    }
    let hours = try VectorFile("hours")
    let lines = try hours.cases("updatedLine", input: Updated.self, output: String.self)
    let alone = try Vectors.cases(
      "hours", fn: "updatedLine", input: Updated.self, output: String.self)
    #expect(lines.count == hours.counts["updatedLine"])
    #expect(lines.map(\.index) == alone.map(\.index))
    #expect(lines.map(\.output) == alone.map(\.output))
    #expect(hours.read == ["updatedLine"])
    #expect(hours.unread == ["pickHour", "middleDay"])
    #expect(throws: Vectors.LoadError.self) {
      try hours.cases("updated", input: Updated.self, output: String.self)
    }
  }

  @Test("a path a vector names in a fixture reads back that object of the answer")
  func paths() throws {
    let decoder = ApiJSON.decoder()
    for name in try Fixtures.names() {
      let snow = try #require(try decode(name).snow, "\(name)")
      #expect(try Fixtures.decode(ApiSnow.self, at: "snow", in: name, decoder: decoder) == snow)
      for (index, day) in snow.days.enumerated() {
        let path = "snow.days.\(index)"
        #expect(
          try Fixtures.decode(ApiSnowDay.self, at: path, in: name, decoder: decoder) == day,
          "\(name) \(path)")
      }
      if let now = snow.now {
        #expect(
          try Fixtures.decode(ApiSnowNow.self, at: "snow.now", in: name, decoder: decoder) == now)
      }
      for (index, hour) in (snow.ahead ?? []).enumerated() {
        let path = "snow.ahead.\(index)"
        #expect(
          try Fixtures.decode(ApiSnowNow.self, at: "\(path).now", in: name, decoder: decoder)
            == hour.now, "\(name) \(path)")
        #expect(
          try Fixtures.decode(ApiSnowDay.self, at: "\(path).today", in: name, decoder: decoder)
            == hour.today, "\(name) \(path)")
        #expect(
          try Fixtures.decode(ApiSnowWeek?.self, at: "\(path).week", in: name, decoder: decoder)
            == hour.week, "\(name) \(path)")
      }
    }
    #expect(throws: Fixtures.LoadError.self) {
      try Fixtures.decode(ApiSnowDay.self, at: "snow.days.2", in: "durham-tomorrow")
    }
    #expect(throws: Fixtures.LoadError.self) {
      try Fixtures.decode(ApiSnowNow.self, at: "snow.now", in: "no-now")
    }
  }
}
