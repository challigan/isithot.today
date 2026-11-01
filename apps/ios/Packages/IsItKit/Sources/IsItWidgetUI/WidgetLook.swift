import IsItModel
import SwiftUI
import WidgetKit

/// Where WidgetKit draws a widget, as plain values: the entry view reads them from the
/// environment (`widgetFamily`, `widgetRenderingMode`, `showsWidgetContainerBackground`, which a
/// test can't set) and the layouts take them, so a snapshot or the app (7.3) can say them itself.
public struct WidgetLook: Sendable, Equatable {
  /// The five families the widget offers (iOS build spec, section 11.1).
  public enum Family: String, Sendable, CaseIterable {
    case small, medium, circular, rectangular, inline
  }

  public var family: Family
  /// `widgetRenderingMode == .fullColor`: false on a tinted or clear Home Screen (accented) and
  /// on the Lock Screen and StandBy at night (vibrant).
  public var fullColour: Bool
  /// The palette is drawn behind: false in StandBy and CarPlay, and wherever WidgetKit removes it.
  public var showsBackground: Bool
  /// The medium's right half is a `Link` (a widget), or not (a snapshot, a preview in the app).
  public var interactive: Bool

  public init(family: Family, fullColour: Bool, showsBackground: Bool, interactive: Bool) {
    self.family = family
    self.fullColour = fullColour
    self.showsBackground = showsBackground
    self.interactive = interactive
  }

  /// The look WidgetKit's environment gives (the entry view's): `fullColour` is `mode ==
  /// .fullColor`. Tested in the Unit plan for every family and mode, since nothing can set the
  /// environment's family.
  public init(
    family: WidgetFamily, mode: WidgetRenderingMode, showsBackground: Bool, interactive: Bool
  ) {
    self.init(
      family: Family(family), fullColour: mode == .fullColor, showsBackground: showsBackground,
      interactive: interactive)
  }

  /// The ink for a face in `band`: the palette's own only in full colour with the palette behind
  /// it; otherwise opaque white, which WidgetKit tints (accented) or maps to the Lock Screen's
  /// material (vibrant), and which StandBy and CarPlay draw on black. Opaque either way, as
  /// hierarchy is by face and size, never by opacity.
  func ink(_ band: SnowBand, in art: WidgetArt) -> Color {
    fullColour && showsBackground ? Color(rgb: art.palette(band).ink) : .white
  }
}

extension WidgetLook.Family {
  /// WidgetKit's family; a family the widget doesn't offer draws as small.
  public init(_ family: WidgetFamily) {
    switch family {
    case .systemSmall: self = .small
    case .systemMedium: self = .medium
    case .accessoryCircular: self = .circular
    case .accessoryRectangular: self = .rectangular
    case .accessoryInline: self = .inline
    default: self = .small
    }
  }
}

/// A topic's art: its glyph for a band, and its palette (SnowKit's `Glyphs.image`, IsItModel's
/// `Palettes.snow`, given by the extension), as the app gives IsItUI its own.
public struct WidgetArt: Sendable {
  public let glyph: @Sendable (SnowBand) -> Image
  public let palette: @Sendable (SnowBand) -> IsItModel.Palette

  public init(
    glyph: @escaping @Sendable (SnowBand) -> Image,
    palette: @escaping @Sendable (SnowBand) -> IsItModel.Palette
  ) {
    self.glyph = glyph
    self.palette = palette
  }
}
