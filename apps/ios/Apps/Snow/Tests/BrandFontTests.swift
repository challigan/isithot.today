import CoreText
import IsItModel
import UIKit
import XCTest

/// The app's fonts (iOS build spec, sections 9.7 and 10.1; DECISIONS, "The iPhone app in the
/// website's look"): the app's `UIAppFonts` registers every `BrandFont` under the PostScript name
/// `Font.custom` asks for, each in its own family, and every text face draws the letters of the
/// places and credits the app shows, latin-ext's too. Were one missing or named otherwise,
/// SwiftUI would fall back to the system font without a word.
final class BrandFontTests: XCTestCase {
  func testTheAppRegistersEveryBrandFont() throws {
    for face in BrandFont.allCases {
      let font = try XCTUnwrap(
        UIFont(name: face.rawValue, size: 17), "\(face.rawValue) isn't registered")
      XCTAssertEqual(font.fontName, face.rawValue)
      XCTAssertEqual(font.familyName, face == .answer ? "BricolageAnswer" : "Bricolage Text")
    }
    XCTAssertEqual(UIFont.fontNames(forFamilyName: "BricolageAnswer"), ["BricolageAnswer"])
    // The three text faces, one family, none of them the others' name.
    XCTAssertEqual(
      Set(UIFont.fontNames(forFamilyName: "Bricolage Text")),
      Set(BrandFont.allCases.filter { $0 != .answer }.map(\.rawValue))
    )
  }

  func testEveryTextFaceDrawsThePlacesAndFiguresTheAppShows() {
    let sample = Array("Météo-France Łódź 0.9cm 100% ° ’ … ·".utf16)
    for face in BrandFont.allCases where face != .answer {
      let font = CTFontCreateWithName(face.rawValue as CFString, 17, nil)
      XCTAssertEqual(CTFontCopyPostScriptName(font) as String, face.rawValue)
      var glyphs = [CGGlyph](repeating: 0, count: sample.count)
      XCTAssertTrue(
        CTFontGetGlyphsForCharacters(font, sample, &glyphs, sample.count),
        "\(face.rawValue) has no glyph for some of the sample"
      )
      XCTAssertFalse(glyphs.contains(0), face.rawValue)
    }
  }

  /// The built Info.plist names every font, so the app registers each (packages/mobile's
  /// appFonts.test.ts checks both plists in the repo, the widget's too).
  func testTheAppsInfoPlistListsEveryBrandFont() {
    XCTAssertEqual(
      Bundle.main.object(forInfoDictionaryKey: "UIAppFonts") as? [String],
      BrandFont.allCases.map(\.file)
    )
  }
}
