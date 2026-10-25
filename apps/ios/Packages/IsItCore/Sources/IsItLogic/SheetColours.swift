import Foundation
import IsItModel

/// The colours Settings' sheets (Settings with its pages, and the mail fallback; the place picker
/// wears the page's band now) draw their own text in where the system's fall short of WCAG AA's 4.5:1 for text under 18
/// points (iOS build spec, section 16), each 0xRRGGBB in sRGB, with the system backgrounds that
/// text sits on, which a Linux test holds them to. The sheets follow the system's appearance,
/// not a page's palette, and in the light appearance two system colours fail: the secondary
/// label (60% of 0x3c3c43) blends to 3.28:1 on a grouped list's background and 3.43:1 on its
/// rows, and the default tint, the system's blue (0x007aff), gives 3.59:1 and 4.01:1. In the dark
/// appearance the secondary label passes, 5.29:1 or more, and IsItUI keeps it there. (Ratios
/// rounded down, as packages/mobile writes the palettes'.)
public enum SheetColours {
  /// Secondary text in the light appearance: a section's header and footer, a result's region
  /// and country, the search's line, the location's. 5.36:1 on a grouped list's background.
  public static let secondaryLight: UInt32 = 0x636366
  /// The tint of the sheets' buttons, links and toolbar items, light and dark: the system's blue
  /// as Increase Contrast draws it (Apple's Human Interface Guidelines, "Color").
  public static let accentLight: UInt32 = 0x0040dd
  public static let accentDark: UInt32 = 0x409cff

  /// The light appearance's backgrounds a sheet's text is on: a grouped list's
  /// (`systemGroupedBackground`) and its rows' (`secondarySystemGroupedBackground`), which a
  /// sheet's elevated level leaves as they are.
  public static let lightBackgrounds: [UInt32] = [0xf2f2f7, 0xffffff]
  /// The dark appearance's: a grouped list's and its rows', at the base level and, as a sheet
  /// draws them, the elevated one.
  public static let darkBackgrounds: [UInt32] = [0x000000, 0x1c1c1e, 0x2c2c2e]

  /// WCAG 2's contrast ratio between two 0xRRGGBB colours, from 1 to 21.
  public static func contrast(_ a: UInt32, _ b: UInt32) -> Double {
    let (x, y) = (Palette.relativeLuminance(a), Palette.relativeLuminance(b))
    return (max(x, y) + 0.05) / (min(x, y) + 0.05)
  }
}
