import Foundation
import IsItTestSupport
import Testing

/// How a port is checked against its vector file: given the whole file, the check runs over each
/// of its functions' cases and compares the port's answer with the reference's, with `compare`
/// or, through `forEachCase`, its own expectations. Each port is listed in `PortedVectors.all`,
/// and `VectorCoverageTests` runs it.
struct VectorPort: Sendable {
  let check: @Sendable (VectorFile) throws -> Void

  init(_ check: @escaping @Sendable (VectorFile) throws -> Void) {
    self.check = check
  }
}

extension VectorFile {
  /// Checks each of `fn`'s cases: `port`, given the case's input, gives the reference's output,
  /// equal and with the same text code unit for code unit (`sameText`). A mismatch names the
  /// file, the case's index, the function and its input, and shows both values.
  func compare<Input: Decodable & Sendable, Output: Decodable & Sendable & Equatable>(
    _ fn: String,
    input: Input.Type = Input.self,
    output: Output.Type = Output.self,
    decoder: JSONDecoder = JSONDecoder(),
    sourceLocation: SourceLocation = #_sourceLocation,
    _ port: (Input) throws -> Output
  ) throws {
    try forEachCase(fn, input: input, output: output, decoder: decoder) { item in
      let actual = try port(item.input)
      let label = "\(name).json case \(item.index): \(fn)(\(item.input))"
      #expect(actual == item.output, "\(label)", sourceLocation: sourceLocation)
      if actual == item.output {
        #expect(
          sameText(actual, item.output),
          "\(label): \(actual) is equal, but not the same text code unit for code unit",
          sourceLocation: sourceLocation
        )
      }
    }
  }
}

/// Whether `a` and `b` hold the same text code unit for code unit, as JavaScript's `===`
/// compares strings: each string in them, at any depth and in order (as `Mirror` sees them).
/// Swift's `==` takes canonically equivalent text as equal ("é" as one scalar, or as "e" and a
/// combining acute), so a port that normalised its text would pass it; the reference's strings,
/// and the app's keys and fingerprints, are compared by their code units.
func sameText(_ a: Any, _ b: Any) -> Bool {
  texts(in: a).elementsEqual(texts(in: b)) { $0.utf8.elementsEqual($1.utf8) }
}

/// Every string in `value`, at any depth, in order.
private func texts(in value: Any) -> [String] {
  if let text = value as? String { return [text] }
  return Mirror(reflecting: value).children.flatMap { texts(in: $0.value) }
}
