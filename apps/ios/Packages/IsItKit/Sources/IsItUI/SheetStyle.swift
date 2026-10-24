import IsItLogic
import SwiftUI
import UIKit

/// The sheets' own colours (the place picker, Settings with its pages, and the mail fallback),
/// where the system's fall short of WCAG AA's 4.5:1 for text under 18 points in the light
/// appearance (section 16): IsItLogic's `SheetColours`, which a Linux test holds to it. The
/// sheets otherwise draw in the system's colours, and follow its appearance.
enum SheetStyle {
  /// Secondary text: a section's header and footer, a result's region and country, the
  /// search's and the location's lines. In the dark appearance, the system's secondary label,
  /// which passes; in the light, `SheetColours.secondaryLight`, where the system's gives 3.28:1
  /// on a grouped list's background.
  static let secondary = Color(
    uiColor: UIColor { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor.secondaryLabel.resolvedColor(with: traits)
        : UIColor(rgb: SheetColours.secondaryLight)
    })

  /// The tint of the sheets' buttons, links and toolbar items: the system's blue as Increase
  /// Contrast draws it, light and dark, where the default gives 3.59:1 on a grouped list's light
  /// background and 3.82:1 on a sheet's dark rows.
  static let accent = Color(
    uiColor: UIColor { traits in
      UIColor(
        rgb: traits.userInterfaceStyle == .dark
          ? SheetColours.accentDark : SheetColours.accentLight)
    })

  /// The fill of a prominent button, whose label is white: the light appearance's tint in both,
  /// 7.56:1 under white. No blue reads at 4.5:1 both under white and on a dark row, and the
  /// dark tint gives white 2.83:1.
  static let filled = Color(uiColor: UIColor(rgb: SheetColours.accentLight))
}

extension UIColor {
  /// A 0xRRGGBB colour in sRGB, opaque.
  fileprivate convenience init(rgb: UInt32) {
    self.init(
      red: CGFloat((rgb >> 16) & 0xff) / 255,
      green: CGFloat((rgb >> 8) & 0xff) / 255,
      blue: CGFloat(rgb & 0xff) / 255,
      alpha: 1
    )
  }
}
