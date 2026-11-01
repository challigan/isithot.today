import IsItLogic
import SwiftUI
import WidgetKit

/// The answer as the small family shows it, and the medium's left half (iOS build spec, section
/// 11.1): the place, the slot, the glyph and the answer word, the detail and the agreement's
/// dots, in Bricolage, inside WidgetKit's own margins. The first of three stacks that fits the
/// height: all of it; then without the slot and the dots; then the answer line and the detail.
/// Without a day the answer line is the glyph alone, and the detail says the answer is not
/// available. One VoiceOver element, reading the face's sentence (`spoken`).
public struct ForecastAnswerView: View {
  public let face: WidgetFace
  public let look: WidgetLook
  public let art: WidgetArt

  @ScaledMetric(relativeTo: .largeTitle) private var glyphSize: CGFloat = 36

  public init(face: WidgetFace, look: WidgetLook, art: WidgetArt) {
    self.face = face
    self.look = look
    self.art = art
  }

  public var body: some View {
    ViewThatFits(in: .vertical) {
      VStack(alignment: .leading, spacing: 2) {
        place
        Text(verbatim: face.slot)
          .widgetFont(.slot)
          .lineLimit(1)
        Spacer(minLength: 0)
        answerLine
        detail
        if let agreement = face.agreement {
          AgreementDots(agreement)
            .padding(.top, 4)
        }
      }
      VStack(alignment: .leading, spacing: 2) {
        place
        Spacer(minLength: 0)
        answerLine
        detail
      }
      VStack(alignment: .leading, spacing: 2) {
        answerLine
        detail
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .foregroundStyle(look.ink(face.band, in: art))
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(face.spoken)
  }

  /// The place caption, one line; nothing when the face names none.
  @ViewBuilder private var place: some View {
    if !face.place.isEmpty {
      Text(verbatim: face.place)
        .widgetFont(.place)
        .lineLimit(1)
    }
  }

  /// The glyph and the answer word, both in the accent group; the glyph alone without an answer.
  private var answerLine: some View {
    HStack(spacing: 6) {
      GlyphMark(band: face.band, art: art, size: glyphSize)
      if !face.answer.isEmpty {
        Text(verbatim: face.answer)
          .widgetFont(.answer)
          .lineLimit(1)
          .minimumScaleFactor(0.5)
          .widgetAccentable()
      }
    }
  }

  /// "Snow · 4cm", the reason ("Too warm"), or core's not-available line, in two lines at most.
  private var detail: some View {
    Text(verbatim: face.detail)
      .widgetFont(.detail)
      .lineLimit(2)
      .minimumScaleFactor(0.75)
  }
}

/// The medium family: the answer on the left (`ForecastAnswerView`) and, when the face has Now or
/// the week's rows, the right half, a `Link` to the week's view when the widget is interactive.
/// The right half is one VoiceOver element: the Now line reads "Now: …", so the visible "Now"
/// over it is hidden, as `.combine` merges every child that isn't (Apple,
/// `AccessibilityChildBehavior.combine`), and VoiceOver would otherwise read "Now" twice.
struct ForecastMediumView: View {
  let face: WidgetFace
  let look: WidgetLook
  let art: WidgetArt

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      ForecastAnswerView(face: face, look: look, art: art)
        .frame(maxWidth: .infinity, alignment: .leading)
      if face.now != nil || !face.week.isEmpty {
        rightHalf
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      }
    }
  }

  /// The week's link around Now and the rows, or the two alone in a snapshot or a preview.
  @ViewBuilder private var rightHalf: some View {
    if look.interactive, let week = URL(string: face.weekLink) {
      Link(destination: week) { nowAndRows }
    } else {
      nowAndRows
    }
  }

  /// "Now" and its line, then the first of four rows, two rows or none that fits the height, in
  /// the face's ink, which a `Link` around them would otherwise tint.
  private var nowAndRows: some View {
    VStack(alignment: .leading, spacing: 2) {
      if let now = face.now {
        Text(verbatim: now.label)
          .widgetFont(.nowLabel)
          .lineLimit(1)
          .accessibilityHidden(true)
        Text(verbatim: now.text)
          .widgetFont(.nowLine)
          .lineLimit(2)
          .accessibilityLabel(now.spoken)
      }
      ViewThatFits(in: .vertical) {
        rows(4)
        rows(2)
        Color.clear
          .frame(height: 0)
      }
    }
    .foregroundStyle(look.ink(face.band, in: art))
    .accessibilityElement(children: .combine)
  }

  /// The first `count` of the week's rows, told apart by their labels, a week's being distinct.
  private func rows(_ count: Int) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      ForEach(face.week.prefix(count), id: \.label) { day in
        WeekRowView(day: day, art: art)
      }
    }
    .padding(.top, 4)
  }
}

/// A day after the middle day, on the medium's right half: the day, its glyph, its band's label
/// and its small dots. A block of its own with no words of its own, so the spec's cut-list item 2
/// (section 23.3) removes it and `WidgetFace.week` and leaves nothing hidden. One VoiceOver
/// element, reading the row as the app's week page does (`day.spoken`).
struct WeekRowView: View {
  let day: WidgetFace.Day
  let art: WidgetArt

  @ScaledMetric(relativeTo: .footnote) private var labelWidth: CGFloat = 30

  var body: some View {
    HStack(spacing: 4) {
      Text(verbatim: day.label)
        .widgetFont(.rowLabel)
        .lineLimit(1)
        .frame(minWidth: labelWidth, alignment: .leading)
      GlyphMark(band: day.band, art: art, size: 14)
      Text(verbatim: day.bandLabel)
        .widgetFont(.rowBand)
        .lineLimit(1)
        .minimumScaleFactor(0.85)
      Spacer(minLength: 0)
      if let agreement = day.agreement {
        AgreementDots(agreement, inRow: true)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(day.spoken)
  }
}

/// The locked and the stale face in the small and medium families: the nosnow glyph at the top
/// (the face's band), the message at the bottom, wider in the medium. No `Link`: every tap goes
/// to the face's link (the upgrade, or Today). One element reading the message (the face's
/// `spoken` is its message).
struct MessageFace: View {
  let face: WidgetFace
  let art: WidgetArt

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      GlyphMark(band: face.band, art: art, size: 30)
      Spacer(minLength: 0)
      Text(verbatim: face.message)
        .widgetFont(.message)
        .lineLimit(4)
        .minimumScaleFactor(0.75)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(face.spoken)
  }
}
