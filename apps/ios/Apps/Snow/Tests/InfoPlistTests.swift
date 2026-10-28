import Foundation
import IsItModel
import XCTest

/// The app's Info.plist and bundle as built (iOS build spec, sections 9.7, 13 and 15.2): the
/// location permission's purpose string is the one appCopy.ts words, which Info.plist reads as a
/// build setting from the generated Configs/Generated/Copy.xcconfig, and no StoreKit
/// configuration ships.
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

  /// Snow.storekit is the StoreKit tests' and Xcode's Run action's, never the app's: a bundled
  /// one would be in every build that ships (phase 7.1). The whole bundle is searched, the
  /// widget's too, but for the test bundles Xcode puts in it to run them (`PlugIns/*.xctest`),
  /// which no archive holds, and of which the StoreKit tests' holds Snow.storekit.
  func testTheAppBundlesNoStoreKitConfiguration() throws {
    let app = Bundle.main.bundleURL
    let named = Bundle.main.urls(forResourcesWithExtension: "storekit", subdirectory: nil) ?? []
    XCTAssertEqual(named, [])
    let walk = try XCTUnwrap(
      FileManager.default.enumerator(at: app, includingPropertiesForKeys: nil))
    var found: [String] = []
    for case let url as URL in walk {
      if url.pathExtension == "xctest" {
        walk.skipDescendants()
      } else if url.pathExtension == "storekit" {
        found.append(String(url.path.dropFirst(app.path.count)))
      }
    }
    XCTAssertEqual(found, [])
  }
}
