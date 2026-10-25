import SwiftUI

/// How a `PillButton` is laid out: a chip hugging its words, drawn at least `minHeight` tall (the
/// place 36, a note 34, Retry and the picker's Close 44), or wide, across the whole column, at
/// least 52 tall (Settings' page buttons).
enum PillSize: Equatable {
  case chip(minHeight: CGFloat)
  case wide
}

/// What a `PillButton` is filled with: secondary, the surface's own (`BrandTokens.secondaryFill`:
/// a chip on a page, the wash on the sheet, a card on content), its words in ink; or primary, the
/// website's selected tab, an ink fill with its words in `pill` ("Copy address").
enum PillStyle: Equatable {
  case primary
  case secondary
}

/// The website's pill as a button (`.pill`, `.button`): its label padded on a fill, a capsule at
/// one line and a rounded rectangle when the words wrap, never cut short. As `WordsButton`, a tap
/// anywhere on the `HitTarget.minimum` line acts, and its accessibility element is the pill, so
/// the element is fill and words, never mostly the page's gradient, the case the audit misjudged
/// on PR #33's runs (DECISIONS); a pill under `HitTarget.shortestElement` keeps the whole line.
/// The label sets its own type (`.brandFont`); the button sets its colour. Pressed, it scales
/// (`PressStyle`), never dimmed.
struct PillButton<Label: View>: View {
  let size: PillSize
  let style: PillStyle
  /// A 1-point edge in `BrandTokens.border`: a page's Retry and the sheet's Close.
  let bordered: Bool
  /// The button's role: destructive for "Turn off notifications and delete my data" (phase 8).
  let role: ButtonRole?
  let action: () -> Void
  let label: Label

  @SurfaceTokens private var tokens
  /// The pill's size as laid out, which grows with the text size.
  @State private var pill: CGSize = .zero

  init(
    _ size: PillSize,
    _ style: PillStyle = .secondary,
    bordered: Bool = false,
    role: ButtonRole? = nil,
    action: @escaping () -> Void,
    @ViewBuilder label: () -> Label
  ) {
    self.size = size
    self.style = style
    self.bordered = bordered
    self.role = role
    self.action = action
    self.label = label()
  }

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
    Button(role: role, action: action) {
      label
        .multilineTextAlignment(.leading)
        .fixedSize(horizontal: false, vertical: true)
        .foregroundStyle(style == .primary ? tokens.selectedWords : tokens.ink)
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, verticalPadding)
        .frame(maxWidth: size == .wide ? .infinity : nil, minHeight: minHeight)
        .background(style == .primary ? tokens.selected : tokens.secondaryFill, in: shape)
        .overlay {
          if bordered {
            shape.strokeBorder(tokens.border, lineWidth: 1)
          }
        }
        .onGeometryChange(for: CGSize.self) { proxy in
          proxy.size
        } action: { laidOut in
          pill = laidOut
        }
        .frame(minHeight: HitTarget.minimum)
        .contentShape(.interaction, Rectangle())
    }
    .buttonStyle(PressStyle())
    .contentShape(.accessibility, WordsBand(height: band))
  }

  private var minHeight: CGFloat {
    switch size {
    case .chip(let minHeight): minHeight
    case .wide: 52
    }
  }

  /// Half the least height: a capsule at one line, a rounded rectangle once the words wrap.
  private var cornerRadius: CGFloat { minHeight / 2 }

  /// The website's: 12 by 4.8 on a chip (`.pill`), 20 by 12 on a page button.
  private var horizontalPadding: CGFloat { size == .wide ? 20 : 12 }
  private var verticalPadding: CGFloat { size == .wide ? 12 : 4.8 }

  /// The pill's height, or 0, the whole line, for a pill shorter than any element the audit's
  /// hit-region check has passed (`HitTarget.shortestElement`).
  private var band: CGFloat {
    pill.height < HitTarget.shortestElement ? 0 : pill.height
  }
}

/// A round chip holding an SF Symbol, the website's gear: a `chip` circle as tall as the place's
/// pill (36 at Large, growing with the text to 60), the symbol 18 points (to 28), centred in a
/// frame of at least 44 by 44, which is its element and its tap region (a circle alone is under
/// 44 on both sides). The symbol is decorative; `label` is what VoiceOver reads.
struct IconPillButton: View {
  let systemName: String
  let label: String
  let action: () -> Void

  @SurfaceTokens private var tokens
  @ScaledMetric(relativeTo: .callout) private var circle: CGFloat = 36
  @ScaledMetric(relativeTo: .callout) private var symbol: CGFloat = 18

  /// Spelt out, since the top bar makes one from another file, and the private tokens could
  /// leave the memberwise initialiser private to this one.
  init(systemName: String, label: String, action: @escaping () -> Void) {
    self.systemName = systemName
    self.label = label
    self.action = action
  }

  var body: some View {
    Button(action: action) {
      Image(systemName: systemName)
        .font(.system(size: min(symbol, 28)))
        .foregroundStyle(tokens.ink)
        .frame(width: min(circle, 60), height: min(circle, 60))
        .background(tokens.secondaryFill, in: Circle())
        .frame(minWidth: HitTarget.minimum, minHeight: HitTarget.minimum)
        .contentShape(Rectangle())
    }
    .buttonStyle(PressStyle())
    .accessibilityLabel(Text(verbatim: label))
  }
}

/// A button style that keeps its label's colours and scales it to 0.96 while pressed, at once
/// and not at all under Reduce Motion: never dimmed, so never short of contrast.
struct PressStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    PressedLabel(configuration: configuration)
  }
}

private struct PressedLabel: View {
  let configuration: ButtonStyleConfiguration

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    configuration.label
      .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
      .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isPressed)
  }
}

/// A row's press, as the website's rows and Settings' cards show it: the wash behind the whole
/// row (corners of 9.6 in the picker, edge to edge on a card), the words unchanged.
struct RowPressStyle: ButtonStyle {
  var cornerRadius: CGFloat = 0

  func makeBody(configuration: Configuration) -> some View {
    PressedRow(configuration: configuration, cornerRadius: cornerRadius)
  }
}

private struct PressedRow: View {
  let configuration: ButtonStyleConfiguration
  let cornerRadius: CGFloat

  @SurfaceTokens private var tokens

  var body: some View {
    configuration.label
      .background {
        // A shape with no accessibility modifier, so no element.
        if configuration.isPressed {
          RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(tokens.wash)
        }
      }
  }
}

/// The website's map pin (Header.astro), drawn in a 24-unit square:
/// `M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z` and a circle of 2.5 at (12, 9.5).
/// Stroked, as the website strokes it (2 units, round caps and joins).
struct PinShape: Shape {
  func path(in rect: CGRect) -> Path {
    let unit = min(rect.width, rect.height) / 24
    func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
      CGPoint(x: rect.minX + x * unit, y: rect.minY + y * unit)
    }
    var path = Path()
    path.move(to: point(12, 21))
    path.addCurve(to: point(5, 9.5), control1: point(12, 21), control2: point(5, 14.8))
    // Over the top, through (12, 2.5): the angle grows from 180° to 360°, which is
    // `clockwise: false` in Path's terms, whose sense of clockwise is a y-up space's.
    path.addArc(
      center: point(12, 9.5), radius: 7 * unit, startAngle: .degrees(180),
      endAngle: .degrees(360), clockwise: false)
    path.addCurve(to: point(12, 21), control1: point(19, 14.8), control2: point(12, 21))
    path.closeSubpath()
    path.addEllipse(
      in: CGRect(origin: point(9.5, 7), size: CGSize(width: 5 * unit, height: 5 * unit)))
    return path
  }
}
