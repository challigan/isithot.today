import IsItModel
import IsItTestSupport
import Testing

extension VectorPort {
  /// grid.json: core `roundToGrid` is `GridRounding.round`.
  static let grid = VectorPort { file in
    try file.compare("roundToGrid", input: GridInput.self, output: Double.self) {
      GridRounding.round($0.value, step: $0.step)
    }
  }
}

/// A `roundToGrid` case's input.
private struct GridInput: Decodable, Sendable {
  let value: Double
  let step: Double
}
