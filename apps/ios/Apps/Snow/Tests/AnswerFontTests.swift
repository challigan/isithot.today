import UIKit
import XCTest

/// The answer font (iOS build spec, sections 9.7 and 10.1): the app's `UIAppFonts` registers
/// `BricolageAnswer.ttf`, under the name `Font.custom("BricolageAnswer", ...)` asks for. Were it
/// missing or named otherwise, SwiftUI would fall back to the system font without a word.
final class AnswerFontTests: XCTestCase {
  func testTheAppRegistersTheAnswerFont() throws {
    let font = try XCTUnwrap(
      UIFont(name: "BricolageAnswer", size: 64), "BricolageAnswer isn't registered")
    XCTAssertEqual(font.fontName, "BricolageAnswer")
    XCTAssertEqual(font.familyName, "BricolageAnswer")
    XCTAssertEqual(UIFont.fontNames(forFamilyName: "BricolageAnswer"), ["BricolageAnswer"])
  }
}
