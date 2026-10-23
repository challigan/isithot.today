import IsItModel
import SnowKit
import SwiftUI
import UIKit
import XCTest

/// Every snow glyph drawn from SnowKit's generated asset catalogue and attached for the contact
/// sheet: V7 (iOS build spec, sections 7.2 and 26) asks whether the SVG template images render as
/// the website draws them. Each is drawn whole, and as its still layer under its drift layer,
/// which should look the same. Each is tinted on its band's palette (the ink on the gradient from
/// g1 to g2, as a forecast page draws it), and the tint comes only from the foreground style, so
/// a glyph that shows black has lost its template rendering. Review artefacts, not pixel
/// comparisons: the checks are that each glyph draws something, at its size.
final class GlyphSnapshotTests: XCTestCase {
  /// The glyphs' size in the catalogue, the website's view box.
  private static let size = CGSize(width: 120, height: 120)
  private static let scale: CGFloat = 3

  @MainActor
  func testEveryGlyphDraws() throws {
    let blank = try png(Color.clear.frame(width: Self.size.width, height: Self.size.height))
    for band in SnowBand.allCases where band != .unknown {
      let name = "glyph-\(band.rawValue)"
      let whole = Glyphs.image(band).frame(width: Self.size.width, height: Self.size.height)
      XCTAssertNotEqual(try png(whole), blank, "\(name) drew nothing")
      try attach(whole, on: band, named: name)
      if let layers = Glyphs.layers(band) {
        let stacked = ZStack {
          layers.still
          layers.drift
        }
        .frame(width: Self.size.width, height: Self.size.height)
        XCTAssertNotEqual(try png(layers.drift), blank, "\(name)'s drift layer drew nothing")
        try attach(stacked, on: band, named: "\(name)-layers")
      } else {
        XCTAssertEqual(band, .nosnow, "only nosnow has no flakes to drift")
      }
    }
  }

  /// A band the app doesn't know draws as nosnow.
  @MainActor
  func testUnknownDrawsAsNoSnow() throws {
    XCTAssertEqual(try png(Glyphs.image(.unknown)), try png(Glyphs.image(.nosnow)))
    XCTAssertNil(Glyphs.layers(.unknown))
  }

  /// `content` drawn at the test's scale, as PNG data.
  @MainActor
  private func png<Content: View>(_ content: Content) throws -> Data {
    let renderer = ImageRenderer(content: content)
    renderer.scale = Self.scale
    let image = try XCTUnwrap(renderer.uiImage, "ImageRenderer drew nothing")
    return try XCTUnwrap(image.pngData(), "No PNG")
  }

  /// Draws `glyph` in `band`'s ink on its gradient, top to bottom, and attaches it.
  @MainActor
  private func attach<Content: View>(
    _ glyph: Content,
    on band: SnowBand,
    named name: String
  ) throws {
    let palette = Palettes.snow(band)
    let ground = LinearGradient(
      colors: [Color(rgb: palette.g1), Color(rgb: palette.g2)],
      startPoint: .top,
      endPoint: .bottom
    )
    let tinted = glyph.foregroundStyle(Color(rgb: palette.ink)).background(ground)
    let renderer = ImageRenderer(content: tinted)
    renderer.scale = Self.scale
    let image = try XCTUnwrap(renderer.uiImage, "ImageRenderer drew nothing for \(name)")
    XCTAssertEqual(image.size, Self.size)
    XCTAssertEqual(image.scale, Self.scale)

    // PNG, as the contact sheet reads it.
    let png = try XCTUnwrap(image.pngData(), "No PNG for \(name)")
    let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
