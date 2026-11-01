import Foundation
import IsItModel
import XCTest

/// Snow.storekit as this bundle holds it, the file StoreKit Test loads and Xcode's Run action
/// buys from: one product, the app's (`Constants.Purchase.productID`), a non-consumable shared
/// through Family Sharing, named and described in en_GB as the app's copy words it, in the UK
/// storefront, whose pounds the price tests read. pnpm mobile:generate writes it from
/// packages/mobile (`exportStoreKit.ts`), whose vitest checks the TypeScript; this checks the
/// file the tests use.
final class SnowStoreKitFileTests: XCTestCase {
  func testTheConfigurationSellsTheAppsOneProduct() throws {
    let data = try Data(contentsOf: snowStoreKitURL())
    let file = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    for kind in ["nonRenewingSubscriptions", "subscriptionGroups"] {
      XCTAssertEqual((file[kind] as? [Any])?.count, 0, kind)
    }
    let products = try XCTUnwrap(file["products"] as? [[String: Any]])
    XCTAssertEqual(products.count, 1)
    let product = try XCTUnwrap(products.first)
    XCTAssertEqual(product["productID"] as? String, Constants.Purchase.productID)
    XCTAssertEqual(product["type"] as? String, "NonConsumable")
    XCTAssertEqual(product["familyShareable"] as? Bool, true)
    let localizations = try XCTUnwrap(product["localizations"] as? [[String: Any]])
    let british = try XCTUnwrap(localizations.first { $0["locale"] as? String == "en_GB" })
    XCTAssertEqual(british["displayName"] as? String, AppCopy.upgradeTitle)
    XCTAssertEqual(british["description"] as? String, AppCopy.upgradeDescription)
    let settings = try XCTUnwrap(file["settings"] as? [String: Any])
    XCTAssertEqual(settings["_storefront"] as? String, "GBR")
    XCTAssertEqual(settings["_locale"] as? String, "en_GB")
  }
}
