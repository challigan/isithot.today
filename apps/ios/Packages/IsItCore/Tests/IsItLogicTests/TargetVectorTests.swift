import IsItModel
import IsItTestSupport
import Testing

extension VectorPort {
  /// target.json: client `targetKey` is `Target.key`, `deviceTarget` is `Target.device(lat:lon:)`,
  /// `searchTarget` is `Target(search:)` and `targetFromQuery` is `Target(query:)`. Each target
  /// out is decoded from the client's JSON and compared whole.
  static let target = VectorPort { file in
    try file.compare("targetKey", input: KeyInput.self, output: String.self) { $0.target.key }
    try file.compare("deviceTarget", input: DeviceInput.self, output: Target.self) {
      .device(lat: $0.lat, lon: $0.lon)
    }
    try file.compare("searchTarget", input: SearchInput.self, output: Target.self) {
      Target(search: $0.result)
    }
    try file.compare("targetFromQuery", input: QueryInput.self, output: Target?.self) {
      Target(query: $0.query)
    }
  }
}

/// A `targetKey` case's input.
private struct KeyInput: Decodable, Sendable {
  let target: Target
}

/// A `deviceTarget` case's input: where the phone says it is.
private struct DeviceInput: Decodable, Sendable {
  let lat: Double
  let lon: Double
}

/// A `searchTarget` case's input: a result as `/api/v1/search` gives it.
private struct SearchInput: Decodable, Sendable {
  let result: SearchResult
}

/// A `targetFromQuery` case's input.
private struct QueryInput: Decodable, Sendable {
  let query: String
}
