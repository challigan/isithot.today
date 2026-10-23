import Foundation

/// The fixtures pnpm mobile:generate writes (packages/mobile `fixtures.ts`): real answers from
/// the server at a fixed moment, each with `_fixture` saying what it was asked and why.
public enum Fixtures {
  public enum LoadError: Error, CustomStringConvertible {
    case noFolder
    case noFixture(String)

    public var description: String {
      switch self {
      case .noFolder: "No Fixtures folder in the test resources"
      case .noFixture(let name): "No fixture \(name).json: run pnpm mobile:generate"
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

  private static func folder() throws -> URL {
    guard let url = Bundle.module.url(forResource: "Fixtures", withExtension: nil) else {
      throw LoadError.noFolder
    }
    return url
  }
}
