import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

extension VectorPort {
  /// `links.json`: client `parseDeepLink` and `notificationRoute`, ported as `DeepLink.parse`
  /// and `DeepLink.route(payload:placeToday:)`. A payload is any JSON, as a notification's
  /// `userInfo` holds it: it reaches the port as `JSONSerialization` reads it. Each route is
  /// decoded from the client's JSON and compared whole.
  static let links = VectorPort { file in
    struct Link: Decodable, Sendable {
      let url: String
    }
    try file.compare("parseDeepLink", input: Link.self, output: DeepLink.Route?.self) {
      DeepLink.parse($0.url)
    }

    struct Tap: Decodable, Sendable {
      let payload: JSONValue
      let placeToday: String?
    }
    try file.compare("notificationRoute", input: Tap.self, output: DeepLink.Route?.self) { tap in
      DeepLink.route(payload: try tap.payload.foundation()) { _ in tap.placeToday }
    }
  }
}

/// What the vectors don't reach: the forms the system hands the app.
@Suite("Deep links and notification taps")
struct DeepLinkTests {
  @Test("a URL the system opens the app with reads as its text does")
  func url() throws {
    let url = try #require(URL(string: "willitsnow://view/week?from=widget"))
    #expect(DeepLink.parse(url) == .view(.week))
  }

  @Test("a notification's userInfo, with its aps, routes as its payload does")
  func userInfo() {
    let userInfo: [AnyHashable: Any] = [
      "aps": ["alert": ["title": "Durham", "body": "Snow is likely tomorrow."]],
      "topic": "snow",
      "kind": "evening",
      "date": "2026-12-17",
      "view": "today",
      "place": "place=durham-gb",
      "name": "Durham",
    ]
    var asked: [Target] = []
    let route = DeepLink.route(payload: userInfo) { target in
      asked.append(target)
      return "2026-12-16"
    }
    let durham = Target.city(slug: "durham-gb", name: "Durham")
    #expect(route == .place(durham, view: .today))
    #expect(asked == [durham])
  }

  @Test(
    "a route reads back as itself from the client's JSON",
    arguments: [
      DeepLink.Route.view(.now), .upgrade, .settings(.notifications),
      .place(.city(slug: "durham-gb"), view: .week), .place(.city(slug: "durham-gb"), view: nil),
    ])
  func roundTrip(_ route: DeepLink.Route) throws {
    let read = try JSONDecoder().decode(DeepLink.Route.self, from: JSONEncoder().encode(route))
    #expect(read == route)
  }
}

/// Any JSON value, as a vector's input has it.
enum JSONValue: Decodable, Sendable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([JSONValue].self) {
      self = .array(value)
    } else {
      self = .object(try container.decode([String: JSONValue].self))
    }
  }

  /// The value as `JSONSerialization` reads it from JSON, as a notification's `userInfo` holds
  /// it: nil for null at the top.
  func foundation() throws -> Any? {
    if case .null = self { return nil }
    return try JSONSerialization.jsonObject(with: Data(json.utf8), options: [.fragmentsAllowed])
  }

  /// The value written back as JSON.
  private var json: String {
    switch self {
    case .null: "null"
    case .bool(let value): value ? "true" : "false"
    case .number(let value): String(value)
    case .string(let value): Self.quoted(value)
    case .array(let values): "[" + values.map(\.json).joined(separator: ",") + "]"
    case .object(let fields):
      "{" + fields.map { Self.quoted($0.key) + ":" + $0.value.json }.joined(separator: ",") + "}"
    }
  }

  private static func quoted(_ text: String) -> String {
    let data = (try? JSONEncoder().encode(text)) ?? Data("\"\"".utf8)
    return String(decoding: data, as: UTF8.self)
  }
}
