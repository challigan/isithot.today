import Foundation
import IsItModel
import IsItTestSupport

/// A case whose answer is a fixture (`in.fixture`), with the blocks `in.without` lists taken out
/// first, where it lists any ("rain", "snow.now"): how the vectors reach the rules' fallbacks.
protocol FixtureCase: CustomStringConvertible {
  var fixture: String { get }
  var without: [String]? { get }
}

extension FixtureCase {
  /// The fixture, and what is taken out of it.
  var answerDescription: String {
    guard let without, !without.isEmpty else { return fixture }
    return "\(fixture) without \(without.joined(separator: ", "))"
  }
}

/// The fixtures' answers for one port's check, each decoded once: a file has hundreds of cases
/// for the same few.
final class FixtureAnswers {
  /// A block a case takes out that the fixture doesn't have.
  struct NothingAt: Error, CustomStringConvertible {
    let fixture: String
    let path: String

    var description: String { "Nothing at \(path) in the fixture \(fixture) to take out" }
  }

  private var decoded: [String: TodayResponse] = [:]

  /// The case's answer.
  func callAsFunction(_ input: some FixtureCase) throws -> TodayResponse {
    try self(input.fixture, without: input.without ?? [])
  }

  /// The fixture's answer, without the blocks at `paths`, as packages/mobile `withoutBlocks`
  /// takes them out.
  func callAsFunction(_ name: String, without paths: [String] = []) throws -> TodayResponse {
    let key = ([name] + paths).joined(separator: " ")
    if let answer = decoded[key] { return answer }
    var data = try Fixtures.data(name)
    if !paths.isEmpty {
      var root = try JSONSerialization.jsonObject(with: data)
      for path in paths {
        guard let rest = Self.removing(path.split(separator: ".").map(String.init), from: root)
        else { throw NothingAt(fixture: name, path: path) }
        root = rest
      }
      data = try JSONSerialization.data(withJSONObject: root)
    }
    let answer = try TodayResponse.decode(from: data)
    decoded[key] = answer
    return answer
  }

  /// `value` without what is at `keys`, a path of object keys and list indices, as
  /// `withoutBlocks` reads one: a field is left out, a list's item taken out (any after it move
  /// up), and `*` empties a list. Nil when there is nothing there.
  private static func removing(_ keys: [String], from value: Any) -> Any? {
    guard let key = keys.first else { return nil }
    let rest = Array(keys.dropFirst())
    if var list = value as? [Any] {
      if key == "*", rest.isEmpty {
        return list.isEmpty ? nil : [Any]()
      }
      // A list index as JavaScript writes one: 0, or digits not starting with 0.
      guard let index = Int(key), String(index) == key, list.indices.contains(index) else {
        return nil
      }
      if rest.isEmpty {
        list.remove(at: index)
      } else {
        guard let inner = removing(rest, from: list[index]) else { return nil }
        list[index] = inner
      }
      return list
    }
    guard var object = value as? [String: Any], let inner = object[key] else { return nil }
    if rest.isEmpty {
      object[key] = nil
    } else {
      guard let changed = removing(rest, from: inner) else { return nil }
      object[key] = changed
    }
    return object
  }
}

/// A case naming an answer and a moment (epoch milliseconds).
struct FixtureAt: Decodable, Sendable, FixtureCase {
  let fixture: String
  let without: [String]?
  let now: Int

  var description: String { "\(answerDescription) at \(now)" }
}

/// A case naming an answer only.
struct FixtureOnly: Decodable, Sendable, FixtureCase {
  let fixture: String
  let without: [String]?

  var description: String { answerDescription }
}

extension Fixtures {
  /// The answer's own object at `path` in the fixture (`snow.days.1`, `snow.ahead.2.today`), or
  /// nil for no path: what a vector names instead of copying the object.
  static func object<T: Decodable>(_ type: T.Type, at path: String?, in name: String) throws -> T? {
    guard let path else { return nil }
    return try decode(type, at: path, in: name, decoder: ApiJSON.decoder())
  }
}
