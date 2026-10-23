import SwiftUI

// In SnowKit, the one SwiftUI module the app, the widget and the unit tests all link, beside the
// glyphs it colours; the palettes themselves are IsItModel's `Palettes`.
extension Color {
  /// A colour from 0xRRGGBB in sRGB, as the generated palettes write them: `Color(rgb: p.ink)`.
  public init(rgb: UInt32) {
    self.init(
      .sRGB,
      red: Double((rgb >> 16) & 0xff) / 255,
      green: Double((rgb >> 8) & 0xff) / 255,
      blue: Double(rgb & 0xff) / 255
    )
  }
}
