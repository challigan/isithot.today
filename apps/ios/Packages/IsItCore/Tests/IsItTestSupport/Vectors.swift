import Foundation

/// The golden vectors pnpm mobile:generate writes (packages/mobile `vectors.ts`): inputs, and
/// what the TypeScript reference gives for them. A file is `{ fn, source, cases }`, and each
/// case `{ fn, in, out }`, the function it is for, its input and the reference's output. A
/// port's test reads a whole file as a `VectorFile`.
public enum Vectors {
  public enum LoadError: Error, CustomStringConvertible {
    case noFolder
    case noFile(String)
    case noFunction(String, String)

    public var description: String {
      switch self {
      case .noFolder: "No Vectors folder in the test resources"
      case .noFile(let name): "No vector file \(name).json: run pnpm mobile:generate"
      case .noFunction(let name, let fn): "\(name).json has no cases for \(fn)"
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
    try cases(in: data(name), fn: fn, input: input, output: output, decoder: decoder)
  }

  /// `cases(_:fn:input:output:decoder:)` for a file's bytes.
  static func cases<Input: Decodable & Sendable, Output: Decodable & Sendable>(
    in data: Data,
    fn: String,
    input: Input.Type,
    output: Output.Type,
    decoder: JSONDecoder
  ) throws -> [Case<Input, Output>] {
    decoder.userInfo[functionKey] = fn
    let file = try decoder.decode(File<Input, Output>.self, from: data)
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

/// A whole vector file, read once: `{ fn, source, cases }`, with each function's cases decoded
/// when a test asks for them, as that function's own types. It notes whose cases were asked for,
/// so a test can tell when a function in the file was left out (`unread`).
public final class VectorFile {
  /// The file's name, without `.json`.
  public let name: String
  /// The functions it covers, comma-separated.
  public let fn: String
  /// Where each comes from, in the same order (`client@pickHour`).
  public let source: String
  /// The functions it covers, in the file's order.
  public let functions: [String]
  /// How many cases each function has.
  public let counts: [String: Int]
  /// The functions whose cases a test has read.
  public private(set) var read: Set<String> = []
  private let data: Data

  /// The vector file pnpm mobile:generate wrote as `<name>.json`.
  public convenience init(_ name: String) throws {
    try self.init(name: name, data: Vectors.data(name))
  }

  /// A vector file from its bytes.
  public init(name: String, data: Data) throws {
    let outline = try JSONDecoder().decode(Outline.self, from: data)
    self.name = name
    fn = outline.fn
    source = outline.source
    functions = outline.fn.components(separatedBy: ", ")
    counts = outline.cases.reduce(into: [:]) { counts, item in counts[item.fn, default: 0] += 1 }
    self.data = data
  }

  /// The functions it covers whose cases no test has read, in the file's order.
  public var unread: [String] {
    functions.filter { !read.contains($0) }
  }

  /// `fn`'s cases, in order, each input decoded as `Input` and output as `Output` (an optional
  /// type where the output can be null), with its index in the file. Throws for a function the
  /// file doesn't cover.
  public func cases<Input: Decodable & Sendable, Output: Decodable & Sendable>(
    _ fn: String,
    input: Input.Type = Input.self,
    output: Output.Type = Output.self,
    decoder: JSONDecoder = JSONDecoder()
  ) throws -> [Vectors.Case<Input, Output>] {
    guard counts[fn] != nil else { throw Vectors.LoadError.noFunction(name, fn) }
    let found = try Vectors.cases(
      in: data, fn: fn, input: input, output: output, decoder: decoder)
    read.insert(fn)
    return found
  }

  /// The file without its cases' inputs and outputs.
  private struct Outline: Decodable {
    let fn: String
    let source: String
    let cases: [Entry]

    struct Entry: Decodable {
      let fn: String
    }
  }
}
