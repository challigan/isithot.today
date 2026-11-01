import CoreText
import Foundation
import IsItModel
import IsItServices
import IsItState
import UIKit
import XCTest

/// The widget extension as the app embeds it (iOS build spec, sections 9.7, 11 and 15.1):
/// `PlugIns/WillItSnowWidgets.appex`, read through a bundle of its own, as the extension's
/// process reads its own. It asks the app's server, names the app's App Group, carries every
/// brand font and SnowKit's glyphs, declares what it sends, and its timeline is built from its
/// own Info.plist by the extension's own factory (`WidgetTimeline.live(in:)`). What these can't
/// show is the extension's process itself: that it registers the fonts is the timeline's log
/// line's (`font=`), on the device; that an archive ships them, scripts/check-archive.sh's.
final class WidgetBundleTests: XCTestCase {
  func testTheWidgetAsksTheAppsServer() throws {
    let widget = try XCTUnwrap(
      try appex().object(forInfoDictionaryKey: "IsItAPIOrigin") as? String,
      "No IsItAPIOrigin in the widget's Info.plist: it would ask the default server")
    let app = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "IsItAPIOrigin") as? String)
    XCTAssertEqual(widget, app)
    XCTAssertTrue(widget.hasPrefix("https://"), widget)
  }

  func testTheWidgetNamesTheAppGroup() throws {
    XCTAssertEqual(SharedStore.appGroupID(in: try appex()), "group.today.willitsnow.app")
  }

  /// Every brand font is in the extension's own bundle and its `UIAppFonts`, as an extension
  /// can't load the app's, each file holding the face under the PostScript name `Font.custom`
  /// asks for.
  func testTheWidgetCarriesEveryBrandFont() throws {
    let appex = try appex()
    XCTAssertEqual(
      appex.object(forInfoDictionaryKey: "UIAppFonts") as? [String],
      BrandFont.allCases.map(\.file)
    )
    for face in BrandFont.allCases {
      let url = try XCTUnwrap(
        appex.url(forResource: face.rawValue, withExtension: "ttf"),
        "No \(face.file) in the widget")
      let fonts = try XCTUnwrap(
        CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor],
        "\(face.file) holds no font")
      let names = fonts.compactMap { CTFontDescriptorCopyAttribute($0, kCTFontNameAttribute) }
      XCTAssertEqual(names.compactMap { $0 as? String }, [face.rawValue], face.file)
    }
  }

  /// SnowKit's resource bundle is in the extension, with its asset catalogue: `Glyphs.image`
  /// reads `.module`, which in the extension's process is the extension's own copy, so without it
  /// the widget would draw no glyph, and say nothing.
  func testTheWidgetCarriesTheGlyphs() throws {
    let appex = try appex()
    let found = try FileManager.default.contentsOfDirectory(
      at: appex.bundleURL, includingPropertiesForKeys: nil
    ).filter { $0.pathExtension == "bundle" && $0.lastPathComponent.contains("SnowKit") }
    let url = try XCTUnwrap(found.first, "No SnowKit bundle in the widget, only \(found)")
    let snowKit = try XCTUnwrap(Bundle(url: url), "\(url.lastPathComponent) isn't a bundle")
    let catalogue = snowKit.bundleURL.appendingPathComponent("Assets.car")
    XCTAssertTrue(FileManager.default.fileExists(atPath: catalogue.path), "No \(catalogue.path)")
    XCTAssertNotNil(UIImage(named: SnowBand.snow.rawValue, in: snowKit, with: nil))
  }

  /// The extension's privacy manifest declares what it sends, the place, as the app's does
  /// (section 15.1): Coarse Location, linked, not for tracking, for the app's functionality; and
  /// its reason for the App Group's defaults.
  func testTheWidgetsManifestDeclaresWhatItSends() throws {
    let url = try XCTUnwrap(
      try appex().url(forResource: "PrivacyInfo", withExtension: "xcprivacy"),
      "No PrivacyInfo.xcprivacy in the widget")
    let read = try PropertyListSerialization.propertyList(from: Data(contentsOf: url), format: nil)
    let manifest = try XCTUnwrap(read as? [String: Any])
    XCTAssertEqual(manifest["NSPrivacyTracking"] as? Bool, false)

    let collected = try XCTUnwrap(manifest["NSPrivacyCollectedDataTypes"] as? [[String: Any]])
    let place = try XCTUnwrap(
      collected.first {
        $0["NSPrivacyCollectedDataType"] as? String == "NSPrivacyCollectedDataTypeCoarseLocation"
      },
      "The widget's manifest doesn't declare Coarse Location")
    XCTAssertEqual(place["NSPrivacyCollectedDataTypeLinked"] as? Bool, true)
    XCTAssertEqual(place["NSPrivacyCollectedDataTypeTracking"] as? Bool, false)
    XCTAssertEqual(
      place["NSPrivacyCollectedDataTypePurposes"] as? [String],
      ["NSPrivacyCollectedDataTypePurposeAppFunctionality"])

    let used = try XCTUnwrap(manifest["NSPrivacyAccessedAPITypes"] as? [[String: Any]])
    let defaults = try XCTUnwrap(
      used.first {
        $0["NSPrivacyAccessedAPIType"] as? String == "NSPrivacyAccessedAPICategoryUserDefaults"
      },
      "The widget's manifest gives no reason for the App Group's defaults")
    XCTAssertEqual(defaults["NSPrivacyAccessedAPITypeReasons"] as? [String], ["1C8F.1"])
  }

  func testItIsAWidgetKitExtension() throws {
    let point = try XCTUnwrap(
      try appex().object(forInfoDictionaryKey: "NSExtension") as? [String: Any])
    XCTAssertEqual(
      point["NSExtensionPointIdentifier"] as? String, "com.apple.widgetkit-extension")
  }

  /// The extension's own factory over the extension's own Info.plist: the group opens from the
  /// appex's `IsItAppGroup` (in the app's process, which has the same entitlement), and its client
  /// asks the appex's `IsItAPIOrigin`. The appex names the app's group and origin, which `.main`
  /// and the default name too, so this shows only that the real plist opens; the next test shows
  /// that the factory reads the bundle it is given.
  func testTheWidgetsTimelineIsBuiltFromItsOwnPlist() throws {
    let appex = try appex()
    let timeline = try XCTUnwrap(
      WidgetTimeline.live(in: appex), "The widget's timeline didn't open its App Group")
    let origin = try XCTUnwrap(appex.object(forInfoDictionaryKey: "IsItAPIOrigin") as? String)
    XCTAssertEqual(timeline.client.origin.absoluteString, origin)
  }

  /// The factory reads the bundle it is given, not the process's own nor the default: a plist
  /// naming another origin gets a client that asks it, and one without `IsItAppGroup` gets no
  /// timeline. Every timeline waits on the process's one gate (`FetchGate.shared`): the provider
  /// builds one a reload, so a small, a medium and a Lock Screen widget reloaded together ask once
  /// (decision 14).
  func testTheWidgetsTimelineReadsTheBundleItIsGiven() throws {
    let other = "https://preview.willitsnow.today"
    let named = try bundle(
      holding: ["IsItAppGroup": "group.today.willitsnow.app", "IsItAPIOrigin": other])
    let timeline = try XCTUnwrap(
      WidgetTimeline.live(in: named), "The widget's timeline didn't open the App Group it names")
    XCTAssertEqual(timeline.client.origin.absoluteString, other)
    XCTAssertTrue(timeline.gate === FetchGate.shared, "Each timeline has a gate of its own")
    XCTAssertNil(WidgetTimeline.live(in: try bundle(holding: ["IsItAPIOrigin": other])))
  }

  // MARK: - Private

  /// The embedded extension's bundle.
  private func appex() throws -> Bundle {
    let plugIns = try XCTUnwrap(Bundle.main.builtInPlugInsURL, "The app has no PlugIns folder")
    let url = plugIns.appendingPathComponent("WillItSnowWidgets.appex", isDirectory: true)
    return try XCTUnwrap(Bundle(url: url), "No widget extension at \(url.path)")
  }

  /// A bundle whose Info.plist holds only `info`, in a folder of its own that goes when the test
  /// ends.
  private func bundle(holding info: [String: String]) throws -> Bundle {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("\(UUID().uuidString).bundle", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    addTeardownBlock { try? FileManager.default.removeItem(at: url) }
    let plist = try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
    try plist.write(to: url.appendingPathComponent("Info.plist"))
    return try XCTUnwrap(Bundle(url: url), "No bundle at \(url.path)")
  }
}
