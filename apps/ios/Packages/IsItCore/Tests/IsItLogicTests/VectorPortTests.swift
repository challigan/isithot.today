import Foundation
import IsItTestSupport
import Testing

/// What every port's check is built from, on a small file of its own: `compare` runs the port on
/// each of a function's cases, and the file notes each case a check has run on.
@Suite("A port's check")
struct VectorPortTests {
  static let data = Data(
    """
    {
      "fn": "double, negate, name",
      "source": "test@double, test@negate, test@name",
      "cases": [
        {"fn":"double","in":{"value":2},"out":4},
        {"fn":"negate","in":{"value":2},"out":-2},
        {"fn":"double","in":{"value":-1.5},"out":-3},
        {"fn":"name","in":{"value":1},"out":"Caf\\u00e9"}
      ]
    }
    """.utf8)

  struct Value: Decodable, Sendable {
    let value: Double
  }

  @Test("compare runs the port on each of the function's cases, in order, and on no other")
  func compare() throws {
    let file = try VectorFile(name: "test", data: Self.data)
    var inputs: [Double] = []
    try file.compare("double", input: Value.self, output: Double.self) { input in
      inputs.append(input.value)
      return input.value * 2
    }
    #expect(inputs == [2, -1.5])
    #expect(file.checkedCount("double") == 2)
    #expect(file.unchecked == ["negate", "name"])
  }

  @Test("a port that checks every function's cases leaves none unchecked")
  func port() throws {
    let port = VectorPort { file in
      try file.compare("double", input: Value.self, output: Double.self) { $0.value * 2 }
      try file.compare("negate", input: Value.self, output: Double.self) { -$0.value }
      try file.compare("name", input: Value.self, output: String.self) { _ in "Caf\u{e9}" }
    }
    let file = try VectorFile(name: "test", data: Self.data)
    #expect(file.unchecked == ["double", "negate", "name"])
    try port.check(file)
    #expect(file.unchecked.isEmpty)
  }

  @Test("reading a function's cases without checking them leaves it unchecked")
  func readOnly() throws {
    let file = try VectorFile(name: "test", data: Self.data)
    let cases = try file.cases("double", input: Value.self, output: Double.self)
    #expect(cases.count == 2)
    #expect(file.checkedCount("double") == 0)
    #expect(file.unchecked == ["double", "negate", "name"])
  }

  @Test("a check that stops part way leaves the cases after it unchecked")
  func partWay() throws {
    struct Stop: Error {}
    let file = try VectorFile(name: "test", data: Self.data)
    #expect(throws: Stop.self) {
      try file.forEachCase("double", input: Value.self, output: Double.self) { item in
        if item.input.value < 0 { throw Stop() }
      }
    }
    #expect(file.checkedCount("double") == 1)
    #expect(file.unchecked == ["double", "negate", "name"])
  }

  @Test("asking for a function the file doesn't cover fails")
  func unknownFunction() throws {
    let file = try VectorFile(name: "test", data: Self.data)
    #expect(throws: Vectors.LoadError.self) {
      try file.compare("triple", input: Value.self, output: Double.self) { $0.value * 3 }
    }
    #expect(file.unchecked == ["double", "negate", "name"])
  }

  @Test("text is the same only code unit for code unit, where == takes equivalent text as equal")
  func text() {
    let composed = "Caf\u{e9}"
    let decomposed = "Cafe\u{301}"
    #expect(composed == decomposed)
    #expect(sameText(composed, composed))
    #expect(!sameText(composed, decomposed))
    let some: String? = composed
    let other: String? = decomposed
    let none: String? = nil
    #expect(!sameText(some as Any, other as Any))
    #expect(sameText(none as Any, none as Any))
    // At any depth: in a struct, a list and an enum's payload.
    struct Named: Equatable {
      let names: [String]
      let place: Place?
    }
    enum Place: Equatable {
      case city(slug: String, name: String?)
    }
    let a = Named(names: ["x", composed], place: .city(slug: "a", name: composed))
    let b = Named(names: ["x", composed], place: .city(slug: "a", name: decomposed))
    let c = Named(names: ["x", decomposed], place: .city(slug: "a", name: composed))
    #expect(a == b && a == c)
    #expect(sameText(a, a))
    #expect(!sameText(a, b))
    #expect(!sameText(a, c))
  }
}
