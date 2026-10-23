import IsItModel
import SwiftUI

/// The snow glyphs, from `Resources/Glyphs.xcassets`, which pnpm mobile:generate writes from the
/// website's `snowGlyphs.ts`. They are template images, so they take the foreground style (the
/// palette's ink on a forecast page), and decorative, as on the website: VoiceOver skips them,
/// since the answer beside a glyph says what it shows.
public enum Glyphs {
  /// The glyph for `band`, whole, as it is at rest. A band the app doesn't know draws as `nosnow`.
  public static func image(_ band: SnowBand) -> Image {
    Image(decorative: assetName(band), bundle: .module)
  }

  /// The glyph in two layers, so that its flakes can drift as they do on the website: the
  /// flakes, and the rest, which stays still. Drawn one over the other, they make `image(band)`.
  /// Nil when nothing in the glyph drifts.
  public static func layers(_ band: SnowBand) -> (still: Image, drift: Image)? {
    let name = assetName(band)
    guard GlyphAssets.drifting.contains(name) else { return nil }
    return (
      Image(decorative: "\(name)-still", bundle: .module),
      Image(decorative: "\(name)-drift", bundle: .module)
    )
  }

  /// The image set for `band`: its own, or `nosnow`'s for a band with no glyph.
  static func assetName(_ band: SnowBand) -> String {
    GlyphAssets.names.contains(band.rawValue) ? band.rawValue : SnowBand.nosnow.rawValue
  }
}
