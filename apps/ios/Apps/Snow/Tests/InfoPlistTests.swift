import Foundation
import IsItModel
import XCTest

/// The app's Info.plist and bundle as built (iOS build spec, sections 9.7, 13, 15.1 and 15.2):
/// the location permission's purpose string is the one appCopy.ts words, which Info.plist reads
/// as a build setting from the generated Configs/Generated/Copy.xcconfig; no StoreKit
/// configuration ships; there are no background modes; and the privacy manifest declares the
/// coarse location and the device ID.
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

  /// Section 9.7: no background modes. Notifications need none: no silent push and no background
  /// fetch, only notifications the person sees (phase 8.1).
  func testTheAppHasNoBackgroundModes() {
    XCTAssertNil(Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes"))
  }

  /// Section 15.1: the app's privacy manifest declares what it collects, each linked to the
  /// person, not used to track them, and for the app's functionality: the coarse location the
  /// forecast is asked for, and the device ID, the push token the notifications are sent to.
  func testThePrivacyManifestDeclaresTheDeviceID() throws {
    let url = try XCTUnwrap(
      Bundle.main.url(forResource: "PrivacyInfo", withExtension: "xcprivacy"),
      "No PrivacyInfo.xcprivacy in the app"
    )
    let manifest = try XCTUnwrap(
      PropertyListSerialization.propertyList(from: Data(contentsOf: url), format: nil)
        as? [String: Any])
    let collected = try XCTUnwrap(manifest["NSPrivacyCollectedDataTypes"] as? [[String: Any]])
    let types = collected.compactMap { $0["NSPrivacyCollectedDataType"] as? String }
    XCTAssertEqual(
      types,
      ["NSPrivacyCollectedDataTypeCoarseLocation", "NSPrivacyCollectedDataTypeDeviceID"]
    )
    for entry in collected {
      let type = entry["NSPrivacyCollectedDataType"] as? String ?? ""
      XCTAssertEqual(entry["NSPrivacyCollectedDataTypeLinked"] as? Bool, true, type)
      XCTAssertEqual(entry["NSPrivacyCollectedDataTypeTracking"] as? Bool, false, type)
      XCTAssertEqual(
        entry["NSPrivacyCollectedDataTypePurposes"] as? [String],
        ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
        type
      )
    }
  }
}
