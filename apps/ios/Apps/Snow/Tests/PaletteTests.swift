import Foundation
import IsItModel
import SnowKit
import SwiftUI
import UIKit
import XCTest

/// The band palettes pnpm mobile:generate writes (iOS build spec, sections 10.1 and 16): every
/// band's ink meets WCAG AA for body text on both ends of its gradient, the ratios the generator
/// wrote are what the colours give, and `Color(rgb:)` makes the colour the hex names.
final class PaletteTests: XCTestCase {
  func testInkMeetsAAForBodyTextOnBothEndsOfTheGradient() {
    for band in SnowBand.allCases {
      let palette = Palettes.snow(band)
      XCTAssertGreaterThanOrEqual(palette.inkOnG1, 4.5, "\(band)")
      XCTAssertGreaterThanOrEqual(palette.inkOnG2, 4.5, "\(band)")
      XCTAssertGreaterThanOrEqual(contrast(palette.ink, palette.g1), 4.5, "\(band)")
      XCTAssertGreaterThanOrEqual(contrast(palette.ink, palette.g2), 4.5, "\(band)")
    }
  }

  func testTheGeneratedRatiosAreTheColoursOwn() {
    for band in SnowBand.allCases {
      let palette = Palettes.snow(band)
      // The generator rounds them down to two decimals.
      XCTAssertEqual(contrast(palette.ink, palette.g1), palette.inkOnG1, accuracy: 0.01, "\(band)")
      XCTAssertEqual(contrast(palette.ink, palette.g2), palette.inkOnG2, accuracy: 0.01, "\(band)")
    }
  }

  func testABandTheAppDoesNotKnowDrawsAsNoSnow() {
    XCTAssertEqual(Palettes.snow(.unknown), Palettes.snow(.nosnow))
    XCTAssertEqual(Palettes.snow(.snow), Palettes.Snow.snow)
  }

  func testAColourIsTheSRGBItsHexNames() throws {
    var (red, green, blue, alpha): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
    XCTAssertTrue(
      UIColor(Color(rgb: 0x341a3c)).getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    )
    XCTAssertEqual(red * 255, 0x34, accuracy: 0.01)
    XCTAssertEqual(green * 255, 0x1a, accuracy: 0.01)
    XCTAssertEqual(blue * 255, 0x3c, accuracy: 0.01)
    XCTAssertEqual(alpha, 1, accuracy: 0.0001)
  }
}

/// WCAG 2's contrast ratio between two 0xRRGGBB colours, worked out as packages/mobile does.
private func contrast(_ a: UInt32, _ b: UInt32) -> Double {
  func luminance(_ rgb: UInt32) -> Double {
    let channels = [rgb >> 16, rgb >> 8, rgb].map { channel -> Double in
      let value = Double(channel & 0xff) / 255
      return value <= 0.039_28 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  let (x, y) = (luminance(a), luminance(b))
  return (max(x, y) + 0.05) / (min(x, y) + 0.05)
}
