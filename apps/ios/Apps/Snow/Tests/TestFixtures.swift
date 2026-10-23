import Foundation
import IsItModel
import XCTest

/// The fixtures `pnpm mobile:generate` writes, from this test bundle's own copy (`Fixtures`).
enum TestFixtures {
  private final class Marker {}

  static func response(_ name: String) throws -> TodayResponse {
    let url = try XCTUnwrap(
      Bundle(for: Marker.self).url(
        forResource: name,
        withExtension: "json",
        subdirectory: "Fixtures"
      ),
      "No Fixtures/\(name).json in the test bundle"
    )
    return try TodayResponse.decode(from: Data(contentsOf: url))
  }
}
