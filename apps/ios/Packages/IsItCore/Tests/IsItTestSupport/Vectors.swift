import Foundation

/// The golden vectors pnpm mobile:generate writes (packages/mobile `vectors.ts`): inputs, and
/// what the TypeScript reference gives for them. A file is `{ fn, source, cases }`, and each
/// case `{ fn, in, out }`, the function it is for, its input and the reference's output.
public enum Vectors {
  public enum LoadError: Error, CustomStringConvertible {
    case noFolder
    case noFile(String)

    public var description: String {
      switch self {
      case .noFolder: "No Vectors folder in the test resources"
      case .noFile(let name): "No vector file \(name).json: run pnpm mobile:generate"
      }
    }
  }

  /// A file's header: the functions it covers, comma-separated, and where each comes from
  /// (`client@pickHour`).
  public struct Header: Decodable, Sendable, Equatable {
    public let fn: String
    public let source: String
  }

  /// One case for a function, with its place in the file, to name it when it fails.
  public struct Case<Input: Decodable & Sendable, Output: Decodable & Sendable>: Sendable {
    public let index: Int
    public let input: Input
    public let output: Output
  }

  /// Every vector file's name, without `.json`, in order.
  public static func names() throws -> [String] {
    let files = try FileManager.default.contentsOfDirectory(
      at: try folder(),
      includingPropertiesForKeys: nil
    )
    return files.filter { $0.pathExtension == "json" }
      .map { $0.deletingPathExtension().lastPathComponent }
      .sorted()
  }

  /// The file's bytes.
  public static func data(_ name: String) throws -> Data {
    let url = try folder().appendingPathComponent("\(name).json")
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw LoadError.noFile(name)
    }
    return try Data(contentsOf: url)
  }

  public static func header(_ name: String) throws -> Header {
    try JSONDecoder().decode(Header.self, from: data(name))
  }

  /// The file's cases for `fn`, in order, each input decoded as `Input` and output as `Output`
  /// (an optional type where the output can be null). The other functions' cases are skipped
  /// unread, so each function's types are its own.
  public static func cases<Input: Decodable & Sendable, Output: Decodable & Sendable>(
    _ name: String,
    fn: String,
    input: Input.Type = Input.self,
    output: Output.Type = Output.self,
    decoder: JSONDecoder = JSONDecoder()
  ) throws -> [Case<Input, Output>] {
    decoder.userInfo[functionKey] = fn
    let file = try decoder.decode(File<Input, Output>.self, from: data(name))
    return file.cases.enumerated().compactMap { index, found in
      found.value.map { Case(index: index, input: $0.input, output: $0.output) }
    }
  }

  private static let functionKey = CodingUserInfoKey(rawValue: "IsItTestSupport.Vectors.fn")!

  private struct File<Input: Decodable, Output: Decodable>: Decodable {
    let cases: [Found<Input, Output>]
  }

  /// A case, decoded only if it is for the function asked for.
  private struct Found<Input: Decodable, Output: Decodable>: Decodable {
    let value: (input: Input, output: Output)?

    enum CodingKeys: String, CodingKey {
      case fn
      case input = "in"
      case output = "out"
    }

    init(from decoder: any Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      let fn = try container.decode(String.self, forKey: .fn)
      guard fn == decoder.userInfo[Vectors.functionKey] as? String else {
        value = nil
        return
      }
      value = (
        try container.decode(Input.self, forKey: .input),
        try container.decode(Output.self, forKey: .output)
      )
    }
  }

  private static func folder() throws -> URL {
    guard let url = Bundle.module.url(forResource: "Vectors", withExtension: nil) else {
      throw LoadError.noFolder
    }
    return url
  }
}
