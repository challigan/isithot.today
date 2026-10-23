import Foundation
import IsItTestSupport
import Testing

/// How a port is checked against its vector file: given the whole file, the check reads each of
/// its functions' cases and compares the port's answer with the reference's, with `compare` or
/// its own expectations. Each port is listed in `PortedVectors.all`, and `VectorCoverageTests`
/// runs it.
struct VectorPort: Sendable {
  let check: @Sendable (VectorFile) throws -> Void

  init(_ check: @escaping @Sendable (VectorFile) throws -> Void) {
    self.check = check
  }
}

extension VectorFile {
  /// Checks each of `fn`'s cases: `port`, given the case's input, gives the reference's output.
  /// A mismatch names the file, the case's index, the function and its input, and shows both
  /// values.
  func compare<Input: Decodable & Sendable, Output: Decodable & Sendable & Equatable>(
    _ fn: String,
    input: Input.Type = Input.self,
    output: Output.Type = Output.self,
    decoder: JSONDecoder = JSONDecoder(),
    sourceLocation: SourceLocation = #_sourceLocation,
    _ port: (Input) throws -> Output
  ) throws {
    for item in try cases(fn, input: input, output: output, decoder: decoder) {
      let actual = try port(item.input)
      #expect(
        actual == item.output,
        "\(name).json case \(item.index): \(fn)(\(item.input))",
        sourceLocation: sourceLocation
      )
    }
  }
}
