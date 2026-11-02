import Foundation

/// The fixtures pnpm mobile:generate writes (packages/mobile `fixtures.ts`): real answers from
/// the server at a fixed moment, each with `_fixture` saying what it was asked and why.
public enum Fixtures {
  public enum LoadError: Error, CustomStringConvertible {
    case noFolder
    case noFixture(String)
    case noPath(String, String)

    public var description: String {
      switch self {
      case .noFolder: "No Fixtures folder in the test resources"
      case .noFixture(let name): "No fixture \(name).json: run pnpm mobile:generate"
      case .noPath(let name, let path): "Nothing at \(path) in the fixture \(name)"
      }
    }
  }

  /// Every fixture's name, without `.json`, in order.
  public static func names() throws -> [String] {
    let files = try FileManager.default.contentsOfDirectory(
      at: try folder(),
      includingPropertiesForKeys: nil
    )
    return files.filter { $0.pathExtension == "json" }
      .map { $0.deletingPathExtension().lastPathComponent }
      .sorted()
  }

  /// The fixture's bytes, as the server sent them but for `_fixture`.
  public static func data(_ name: String) throws -> Data {
    let url = try folder().appendingPathComponent("\(name).json")
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw LoadError.noFixture(name)
    }
    return try Data(contentsOf: url)
  }

  /// Every search fixture's name, without `.json`, in order: the server's answers to the
  /// picker's searches, in the `Search` folder.
  public static func searchNames() throws -> [String] {
    let files = try FileManager.default.contentsOfDirectory(
      at: try folder().appendingPathComponent("Search", isDirectory: true),
      includingPropertiesForKeys: nil
    )
    return files.filter { $0.pathExtension == "json" }
      .map { $0.deletingPathExtension().lastPathComponent }
      .sorted()
  }

  /// A search fixture's bytes, as the server sent them but for `_fixture`.
  public static func search(_ name: String) throws -> Data {
    let url = try folder().appendingPathComponent("Search", isDirectory: true)
      .appendingPathComponent("\(name).json")
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw LoadError.noFixture("Search/\(name)")
    }
    return try Data(contentsOf: url)
  }

  /// What a search fixture says about itself (`_fixture`): its query is `q=…`.
  public static func searchInfo(_ name: String) throws -> Info {
    try JSONDecoder().decode(WithInfo.self, from: search(name)).info
  }

  /// Every devices fixture's name, without `.json`, in order: the server's replies to the
  /// notification requests (`PUT` and `DELETE /api/v1/devices`, `POST /api/v1/devices/test`),
  /// made by its own handlers (packages/mobile `deviceFixtures.ts`), in the `Devices` folder.
  public static func deviceNames() throws -> [String] {
    let files = try FileManager.default.contentsOfDirectory(
      at: try folder().appendingPathComponent("Devices", isDirectory: true),
      includingPropertiesForKeys: nil
    )
    return files.filter { $0.pathExtension == "json" }
      .map { $0.deletingPathExtension().lastPathComponent }
      .sorted()
  }

  /// A devices fixture's bytes: `_fixture`, then the reply as the server sent it (`status`,
  /// `retryAfter`, `text`).
  public static func device(_ name: String) throws -> Data {
    let url = try folder().appendingPathComponent("Devices", isDirectory: true)
      .appendingPathComponent("\(name).json")
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw LoadError.noFixture("Devices/\(name)")
    }
    return try Data(contentsOf: url)
  }

  /// What a devices fixture holds: the request it answers, and the server's reply.
  public struct DeviceInfo: Sendable, Equatable {
    /// "PUT /api/v1/devices", "DELETE /api/v1/devices" or "POST /api/v1/devices/test".
    public let request: String
    /// The request's JSON body, its keys sorted, or nil for none.
    public let body: Data?
    /// The moment the server answered, ISO 8601 UTC.
    public let now: String
    /// What the reply shows, and how the fixture was made.
    public let note: String
    /// The reply's status.
    public let status: Int
    /// The reply's `Retry-After` header, or nil without one.
    public let retryAfter: String?
    /// The reply's body as the server sent it, "" for none.
    public let text: String

    /// The reply's body as a transport hands it over.
    public var reply: Data { Data(text.utf8) }
  }

  /// What the devices fixture `name` holds.
  public static func deviceInfo(_ name: String) throws -> DeviceInfo {
    let file = try JSONSerialization.jsonObject(with: device(name)) as? [String: Any]
    guard let file, let fixture = file["_fixture"] as? [String: Any],
      let request = fixture["request"] as? String,
      let now = fixture["now"] as? String,
      let note = fixture["note"] as? String,
      let status = file["status"] as? Int,
      let text = file["text"] as? String
    else { throw LoadError.noPath("Devices/\(name)", "_fixture") }
    let body = try (fixture["body"] as? [String: Any]).map {
      try JSONSerialization.data(withJSONObject: $0, options: [.sortedKeys])
    }
    return DeviceInfo(
      request: request, body: body, now: now, note: note, status: status,
      retryAfter: file["retryAfter"] as? String, text: text)
  }

  /// A notification's payload as the server's `alertPush()` makes it, what a phone receives: in
  /// the `Payloads` folder, "durham-evening", "durham-old" or "malformed".
  public static func payload(_ name: String) throws -> Data {
    let url = try folder().appendingPathComponent("Payloads", isDirectory: true)
      .appendingPathComponent("\(name).json")
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw LoadError.noFixture("Payloads/\(name)")
    }
    return try Data(contentsOf: url)
  }

  /// What a fixture says about itself (`_fixture`).
  public struct Info: Decodable, Sendable, Equatable {
    /// The query the app asked with, without the "?".
    public let query: String
    /// The moment the fixture is for, ISO 8601 UTC: when the server answered, or for an answer
    /// the app saved earlier (old-forecast), when the app looks at it.
    public let now: String
    /// What the answer shows, and how the fixture was made.
    public let note: String
  }

  /// The fixture's `_fixture`.
  public static func info(_ name: String) throws -> Info {
    try JSONDecoder().decode(WithInfo.self, from: data(name)).info
  }

  /// The value at `path` in the fixture, decoded as `T`: how a vector names one of the answer's
  /// own objects ("snow.days.1", "snow.ahead.2.today"), read back as packages/mobile `atPath`
  /// does. The path is object keys and array indexes, separated by dots. Pass the decoder the
  /// type needs (`ApiJSON.decoder()` for the API's types).
  public static func decode<T: Decodable>(
    _ type: T.Type,
    at path: String,
    in name: String,
    decoder: JSONDecoder = JSONDecoder()
  ) throws -> T {
    var value = try JSONSerialization.jsonObject(with: data(name))
    for key in path.split(separator: ".", omittingEmptySubsequences: false).map(String.init) {
      if let object = value as? [String: Any], let next = object[key] {
        value = next
      } else if let array = value as? [Any], let index = Int(key), array.indices.contains(index) {
        value = array[index]
      } else {
        throw LoadError.noPath(name, path)
      }
    }
    let json = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
    return try decoder.decode(T.self, from: json)
  }

  private struct WithInfo: Decodable {
    let info: Info

    enum CodingKeys: String, CodingKey {
      case info = "_fixture"
    }
  }

  private static func folder() throws -> URL {
    guard let url = Bundle.module.url(forResource: "Fixtures", withExtension: nil) else {
      throw LoadError.noFolder
    }
    return url
  }
}
