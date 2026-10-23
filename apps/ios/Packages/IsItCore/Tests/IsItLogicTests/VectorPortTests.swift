import Foundation
import IsItTestSupport
import Testing

/// What every port's check is built from, on a small file of its own: `compare` runs the port on
/// each of a function's cases, and the file notes whose cases were read.
@Suite("A port's check")
struct VectorPortTests {
  static let data = Data(
    """
    {
      "fn": "double, negate",
      "source": "test@double, test@negate",
      "cases": [
        {"fn":"double","in":{"value":2},"out":4},
        {"fn":"negate","in":{"value":2},"out":-2},
        {"fn":"double","in":{"value":-1.5},"out":-3}
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
    #expect(file.read == ["double"])
    #expect(file.unread == ["negate"])
  }

  @Test("a port that reads every function's cases leaves none unread")
  func port() throws {
    let port = VectorPort { file in
      try file.compare("double", input: Value.self, output: Double.self) { $0.value * 2 }
      try file.compare("negate", input: Value.self, output: Double.self) { -$0.value }
    }
    let file = try VectorFile(name: "test", data: Self.data)
    #expect(file.unread == ["double", "negate"])
    try port.check(file)
    #expect(file.unread.isEmpty)
  }

  @Test("asking for a function the file doesn't cover fails")
  func unknownFunction() throws {
    let file = try VectorFile(name: "test", data: Self.data)
    #expect(throws: Vectors.LoadError.self) {
      try file.compare("triple", input: Value.self, output: Double.self) { $0.value * 3 }
    }
    #expect(file.read.isEmpty)
  }
}
