import IsItLogic
import IsItModel
import SwiftUI
import WidgetKit

/// A widget's background, IsItUI's `PageBackground` model on the widget's own rect: the linear
/// gradient from `g1` to `g2`, from (0.4, 0) to (0.6, 1), and over it a radial glow of `g3`
/// centred at (0.88, 0.06), from the palette's `glow` opacity to clear at 52% of the distance to
/// the farthest corner; no glow under Increase Contrast. packages/mobile `brandColours.ts`
/// judges exactly this, `backgroundAt` over the widget's rect and `inkOnWidget` for the ink on
/// it at every family's size. The entry view hands it to `containerBackground(for: .widget)`,
/// which WidgetKit removes wherever it doesn't draw it; a snapshot draws it itself. Decorative,
/// with no accessibility modifier and no Smart Invert exemption, as the app's: one on a view
/// without an element makes it one.
public struct PaletteBackground: View {
  public let palette: IsItModel.Palette

  @Environment(\.colorSchemeContrast) private var contrast

  public init(palette: IsItModel.Palette) {
    self.palette = palette
  }

  public var body: some View {
    GeometryReader { proxy in
      let size = proxy.size
      let centre = CGPoint(x: size.width * 0.88, y: size.height * 0.06)
      // The farthest corner from the centre, as CSS's `circle` sizes a radial gradient.
      let across = max(centre.x, size.width - centre.x)
      let down = max(centre.y, size.height - centre.y)
      let farthest = (across * across + down * down).squareRoot()
      let g3 = Color(rgb: palette.g3)
      ZStack {
        LinearGradient(
          colors: [Color(rgb: palette.g1), Color(rgb: palette.g2)],
          startPoint: UnitPoint(x: 0.4, y: 0),
          endPoint: UnitPoint(x: 0.6, y: 1)
        )
        if contrast != .increased {
          RadialGradient(
            colors: [g3.opacity(palette.glow), g3.opacity(0)],
            center: UnitPoint(x: 0.88, y: 0.06),
            startRadius: 0,
            endRadius: max(farthest * 0.52, 1)
          )
        }
      }
    }
  }
}

/// The agreement as dots (iOS build spec, section 11.1, "six agreement dots"): one for each model
/// with data, filled for each that expects snow and hollow for the rest, so the two differ by
/// shape as well as colour, which a tinted Home Screen and the Lock Screen take away. Drawn in
/// the foreground style, inside the element that reads the agreement, so VoiceOver never reads
/// the dots alone.
struct AgreementDots: View {
  let agreement: WidgetFace.Agreement

  @ScaledMetric private var across: CGFloat
  @ScaledMetric private var apart: CGFloat

  /// The answer's dots, 7 points across and 3 apart; a week row's, 4 and 2.
  init(_ agreement: WidgetFace.Agreement, inRow: Bool = false) {
    self.agreement = agreement
    _across = ScaledMetric(wrappedValue: inRow ? 4 : 7, relativeTo: .footnote)
    _apart = ScaledMetric(wrappedValue: inRow ? 2 : 3, relativeTo: .footnote)
  }

  var body: some View {
    HStack(spacing: apart) {
      ForEach(0..<agreement.total, id: \.self) { index in
        dot(filled: index < agreement.snowy)
          .frame(width: across, height: across)
      }
    }
  }

  @ViewBuilder private func dot(filled: Bool) -> some View {
    if filled {
      Circle().fill(.foreground)
    } else {
      Circle().strokeBorder(.foreground, lineWidth: 1.5)
    }
  }
}

/// A band's glyph as the widget draws it: the topic's template image (`WidgetArt.glyph`) in the
/// foreground style, the face's ink, scaled to fit `size`, and in the accent group
/// (`widgetAccentable()`) with the answer word. Decorative: the element it is in says what it
/// shows.
struct GlyphMark: View {
  let band: SnowBand
  let art: WidgetArt
  let size: CGFloat

  var body: some View {
    art.glyph(band)
      .resizable()
      .scaledToFit()
      .frame(width: size, height: size)
      .widgetAccentable()
      .accessibilityHidden(true)
  }
}

/// The widget's type scale (iOS build spec, section 11.1): the Home Screen families' roles, each a
/// Bricolage face at its size at Large, growing with Dynamic Type from Large to AX5 as its text
/// style does, a face up under Bold Text (`BrandFont.bolder`, the app's rule). Its own, as the
/// app's `TextRole` sizes are a page's. Never caption2, and no line shrinks under 11 points at
/// Large, the HIG's floor, once its `minimumScaleFactor` has scaled it: none of 13 points below
/// 0.85, none of 15 below 0.75 (the medium's Now line goes to half only at the accessibility
/// sizes, 12.5 points at AX1). The Lock Screen families keep the system's text styles.
enum WidgetType {
  /// The place caption.
  case place
  /// "Today", "Tomorrow".
  case slot
  /// The answer word.
  case answer
  /// "Snow · 4cm", "Too warm".
  case detail
  /// "Now", over the medium's right half.
  case nowLabel
  /// "No. Too warm for snow."
  case nowLine
  /// A week row's day, "Fri".
  case rowLabel
  /// A week row's band, "Heavy snow".
  case rowBand
  /// The locked and stale lines.
  case message

  var face: BrandFont {
    switch self {
    case .place, .nowLine, .rowLabel, .message: .textSemiBold
    case .slot, .nowLabel: .textMedium
    case .answer: .answer
    case .detail, .rowBand: .textRegular
    }
  }

  /// Its size at Large, in points.
  var size: CGFloat {
    switch self {
    case .answer: 40
    case .detail, .nowLine, .message: 15
    case .place, .slot, .nowLabel, .rowLabel, .rowBand: 13
    }
  }

  /// The text style it grows with: the nearest by its default size (largeTitle 34, subheadline
  /// 15, footnote 13).
  var style: Font.TextStyle {
    switch self {
    case .answer: .largeTitle
    case .detail, .nowLine, .message: .subheadline
    case .place, .slot, .nowLabel, .rowLabel, .rowBand: .footnote
    }
  }

  /// Its letter spacing in ems: the answer word's, as the app's.
  var tracking: CGFloat {
    self == .answer ? -0.055 : 0
  }
}

extension View {
  /// Sets `type`'s face, size and tracking, growing with Dynamic Type as its text style does, a
  /// face up under Bold Text, which a custom font doesn't follow on its own. `scale` sets it at
  /// that fraction of its size, for a hidden copy that measures a line at its smallest (a week
  /// row's band label, `WeekRowView`): the faces have no size-specific tracking, so a line's
  /// width scales with its size.
  func widgetFont(_ type: WidgetType, scale: CGFloat = 1) -> some View {
    modifier(WidgetFontModifier(type: type, scale: scale))
  }
}

/// `widgetFont(_:scale:)`: the font, and the tracking in points from a `ScaledMetric` of the
/// size, so it grows with the text.
private struct WidgetFontModifier: ViewModifier {
  let type: WidgetType
  let scale: CGFloat

  @ScaledMetric private var scaled: CGFloat
  @Environment(\.legibilityWeight) private var legibilityWeight

  init(type: WidgetType, scale: CGFloat) {
    self.type = type
    self.scale = scale
    _scaled = ScaledMetric(wrappedValue: type.size * scale, relativeTo: type.style)
  }

  func body(content: Content) -> some View {
    let face = legibilityWeight == .bold ? type.face.bolder : type.face
    content
      .font(.custom(face.rawValue, size: type.size * scale, relativeTo: type.style))
      .tracking(type.tracking * scaled)
  }
}

extension Color {
  /// A colour from 0xRRGGBB in sRGB, as the generated palettes write them. IsItWidgetUI's own,
  /// as it doesn't link SnowKit, whose `Color(rgb:)` the extension and the tests use.
  init(rgb: UInt32) {
    self.init(
      .sRGB,
      red: Double((rgb >> 16) & 0xff) / 255,
      green: Double((rgb >> 8) & 0xff) / 255,
      blue: Double(rgb & 0xff) / 255
    )
  }
}
