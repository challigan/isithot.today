import Foundation
import IsItModel
import XCTest

/// The app's Info.plist as built (iOS build spec, sections 9.7 and 15.2): the location
/// permission's purpose string is the one appCopy.ts words, which Info.plist reads as a build
/// setting from the generated Configs/Generated/Copy.xcconfig.
final class InfoPlistTests: XCTestCase {
  func testTheLocationPurposeStringIsTheAppsCopy() throws {
    let purpose = try XCTUnwrap(
      Bundle.main.object(forInfoDictionaryKey: "NSLocationWhenInUseUsageDescription") as? String,
      "No NSLocationWhenInUseUsageDescription: the system would never ask for the location"
    )
    XCTAssertEqual(purpose, AppCopy.locationPurpose)
    XCTAssertFalse(purpose.contains("$("), "A build setting Xcode didn't fill in: \(purpose)")
  }

  /// Section 15.2: approximate location can pick another cell, and height, so it is never the
  /// default.
  func testTheAppDoesNotAskForApproximateLocationByDefault() {
    XCTAssertNil(Bundle.main.object(forInfoDictionaryKey: "NSLocationDefaultAccuracyReduced"))
  }
}
