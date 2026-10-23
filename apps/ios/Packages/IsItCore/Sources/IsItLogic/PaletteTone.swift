import Foundation
import IsItModel

extension Palette {
  /// Whether the page is dark under light ink (the snow bands: white on purple), rather than
  /// light under dark ink (no snow, a few flakes). The forecast pages always use their band's
  /// palette, whatever the phone's appearance (iOS build spec, section 10.1), so the system's
  /// controls on a page (the switcher's segmented control, a bordered button) take the colour
  /// scheme that matches it, and their own text keeps the contrast the page's ink has
  /// (section 16).
  public var inkIsLight: Bool {
    Self.relativeLuminance(ink) > Self.relativeLuminance(g1)
  }

  /// WCAG 2's relative luminance of a 0xRRGGBB colour in sRGB, 0 (black) to 1 (white).
  public static func relativeLuminance(_ rgb: UInt32) -> Double {
    let channels = [rgb >> 16, rgb >> 8, rgb].map { channel -> Double in
      let value = Double(channel & 0xff) / 255
      return value <= 0.039_28 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
}
