import SwiftUI

/// One choice of a `PillSegments`: what it is, its words and, for the UI tests, its identifier.
struct PillSegment<ID: Hashable>: Identifiable {
  let id: ID
  let title: String
  var identifier: String?
}

/// How a `PillSegments` shares its width: equally, as the home screen's tabs share the track, or
/// each segment hugging its words, as Settings' cm and in do.
enum SegmentWidths: Equatable {
  case equal
  case hugging(minWidth: CGFloat)
}

/// The website's segmented pill (`.tabs`, `.units`): a track holding a button for each choice,
/// the chosen one on an ink thumb with its words in `pill`, the thumb sliding to a new choice in
/// 300 ms on the website's curve (`cubic-bezier(0.2, 0.8, 0.2, 1)`), at once under Reduce Motion.
/// The track is a chip on a page and the wash on a content card, with a full-ink edge there under
/// Increase Contrast. Each segment is a `Button` at least `HitTarget.minimum` tall, marked
/// `.isSelected` when chosen, so VoiceOver and the UI tests find each by its words. The track and
/// the thumb are shapes with no accessibility modifier; the caller makes the group its element
/// (`.accessibilityElement(children: .contain)`) with its label and identifier.
struct PillSegments<ID: Hashable>: View {
  let segments: [PillSegment<ID>]
  let selected: ID
  let widths: SegmentWidths
  /// The segments' words.
  let role: TextRole
  /// Between the track's edge and the thumb: the website's 4 on the tabs, 3 on the units.
  let inset: CGFloat
  let choose: (ID) -> Void

  @Namespace private var thumb
  @SurfaceTokens private var tokens
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  init(
    _ segments: [PillSegment<ID>],
    selected: ID,
    widths: SegmentWidths,
    role: TextRole,
    inset: CGFloat = 4,
    choose: @escaping (ID) -> Void
  ) {
    self.segments = segments
    self.selected = selected
    self.widths = widths
    self.role = role
    self.inset = inset
    self.choose = choose
  }

  var body: some View {
    HStack(spacing: 0) {
      ForEach(segments) { segment in
        button(segment)
      }
    }
    .padding(inset)
    .background(track, in: Capsule())
    .overlay {
      if tokens.surface == .content, tokens.increasedContrast {
        Capsule().strokeBorder(tokens.ink, lineWidth: 1)
      }
    }
    .animation(
      reduceMotion ? nil : .timingCurve(0.2, 0.8, 0.2, 1, duration: 0.3), value: selected)
  }

  /// A chip on a page or the sheet; the wash on a content card, where a chip would be the card.
  private var track: Color {
    tokens.surface == .content ? tokens.wash : tokens.chip
  }

  private func button(_ segment: PillSegment<ID>) -> some View {
    let chosen = segment.id == selected
    return Button {
      choose(segment.id)
    } label: {
      Text(verbatim: segment.title)
        .brandFont(role)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .foregroundStyle(chosen ? tokens.selectedWords : tokens.ink)
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, 4.8)
        .frame(minWidth: minWidth, maxWidth: maxWidth, minHeight: HitTarget.minimum)
        .background {
          if chosen {
            Capsule()
              .fill(tokens.selected)
              .matchedGeometryEffect(id: "thumb", in: thumb)
          }
        }
        .contentShape(Capsule())
    }
    .buttonStyle(PressStyle())
    .accessibilityAddTraits(chosen ? .isSelected : [])
    .accessibilityIdentifier(ifAny: segment.identifier)
  }

  /// The website's tabs pad their words 1.6 a side in equal thirds; the units, hugging, 16.
  private var horizontalPadding: CGFloat {
    switch widths {
    case .equal: 1.6
    case .hugging: 16
    }
  }

  private var minWidth: CGFloat? {
    switch widths {
    case .equal: nil
    case .hugging(let minWidth): minWidth
    }
  }

  private var maxWidth: CGFloat? {
    switch widths {
    case .equal: .infinity
    case .hugging: nil
    }
  }
}

extension View {
  /// `identifier` as the view's accessibility identifier, when there is one.
  @ViewBuilder func accessibilityIdentifier(ifAny identifier: String?) -> some View {
    if let identifier {
      accessibilityIdentifier(identifier)
    } else {
      self
    }
  }

  /// `value` as the view's accessibility value, when there is one: none rather than an empty
  /// one, which VoiceOver and the UI tests would read as a value.
  @ViewBuilder func accessibilityValue(ifAny value: String?) -> some View {
    if let value {
      accessibilityValue(Text(verbatim: value))
    } else {
      self
    }
  }
}
