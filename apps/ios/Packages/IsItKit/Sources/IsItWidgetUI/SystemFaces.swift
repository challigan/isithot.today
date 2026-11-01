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
/// The right half is one VoiceOver element, reading Now and every row it shows: the Now line
/// reads "Now: …", so the visible "Now" over it is hidden, as `.combine` merges every child that
/// isn't (Apple, `AccessibilityChildBehavior.combine`), and VoiceOver would otherwise read "Now"
/// twice; a row left out for want of room isn't drawn, so it isn't read either.
struct ForecastMediumView: View {
  let face: WidgetFace
  let look: WidgetLook
  let art: WidgetArt

  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

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

  /// "Now" and its line, then as many of the week's rows as fit whole in the height left, in the
  /// face's ink, which a `Link` around them would otherwise tint (docs/DECISIONS.md, "After
  /// Carl's first look").
  ///
  /// Now comes first. Its block has a higher layout priority than the rows', and "a parent layout
  /// offers the child views with the highest layout priority all the space offered to the parent
  /// minus the minimum space required for all its lower-priority children" (Apple,
  /// `layoutPriority(_:)`). The rows need no space at all (their last choice is none), so the
  /// stack offers Now the whole height, and its line takes the lines it needs (`nowLine`) before
  /// any row is shown. At the default priority, which "causes space to be apportioned evenly to
  /// all sibling views", Now and the rows shared the height: the brief's reading of Carl's
  /// report, where Now had one line, cut short. By the fonts' metrics the old stack would have
  /// given Now its two lines at Large, so his text size, or the phone, may differ from the model;
  /// the priority gives Now its lines either way. A priority rather than `fixedSize`: where Now
  /// is taller than the half, at the accessibility sizes, a fixed line would draw past the
  /// widget's edge, where this one shrinks before it ends in "…".
  ///
  /// Now's block is the first of two that fits the height (`ViewThatFits`, below): "Now" over
  /// the line; then the line alone, which VoiceOver reads the same ("Now: …"), so the words keep
  /// their size rather than the label at the accessibility sizes. The second always fits: its
  /// frame's ideal height is zero, and a frame with both a minimum and a maximum "adopts the size
  /// proposed for it, clamped to the constraints", the ideal "replacing any corresponding
  /// unspecified dimensions in the proposal" (Apple, `frame(minWidth:idealWidth:…)`), so the
  /// choice never rests on what `ViewThatFits` draws when nothing fits, which Apple doesn't say.
  /// Laid out, it takes the height there is, and its line shrinks to fit it.
  ///
  /// Then the rows, in the height Now leaves. `ViewThatFits` "selects the first child whose ideal
  /// size on the constrained axes fits within the proposed size" (Apple, `ViewThatFits`). It is
  /// constrained in height alone, so it judges each child's height at the half's width, where
  /// its rows are as tall as their words need (`WeekRowView`). Its children (`fits(_:)`) are
  /// every row, then one fewer, down to one, each with the rows' dots and then without, then
  /// none. So it shows the most rows that fit whole: no row is cut off, and no gap is left that
  /// another whole row would fill. At larger text sizes rows are taller and Now needs more, so
  /// fewer fit. The dots are the list's choice, not a row's: a row without them means no
  /// forecast has data for its day, so they go from every row at once, and only where keeping
  /// them would cost a row.
  private var nowAndRows: some View {
    VStack(alignment: .leading, spacing: 2) {
      if let now = face.now {
        ViewThatFits(in: .vertical) {
          VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: now.label)
              .widgetFont(.nowLabel)
              .lineLimit(1)
              .accessibilityHidden(true)
            nowLine(now)
          }
          nowLine(now)
            .frame(minHeight: 0, idealHeight: 0, maxHeight: .infinity, alignment: .topLeading)
        }
        .layoutPriority(1)
      }
      ViewThatFits(in: .vertical) {
        ForEach(Self.fits(face.week), id: \.self) { fit in
          rows(fit)
        }
        Color.clear
          .frame(height: 0)
      }
    }
    // A `Link`'s label centres the lines of its texts, as a button's does: PR #44's first macOS
    // run drew Now's second line centred under its first in the `-link` tiles, the widget as it is
    // on a Home Screen. Now's lines, and a wrapped band label's, start at the left, as the rest do.
    .multilineTextAlignment(.leading)
    .foregroundStyle(look.ink(face.band, in: art))
    .accessibilityElement(children: .combine)
  }

  /// Now's line. Up to XXXL, two lines at most, shrinking to 0.75 (`WidgetType`'s floor for 15
  /// points): by the fonts' metrics every Now line fits two lines there, at full size or shrunk,
  /// in the half of every medium the HIG lists for an iPhone, from the SE's 321 by 148 to the
  /// 430-wide row's 364 by 170.
  /// At the accessibility sizes, where some don't, as many lines as the height holds, shrinking
  /// to half (12.5 points at AX1, still over the HIG's 11) before it ends in "…"; by the same
  /// metrics only one line, at AX5 on the SE's medium, still would.
  private func nowLine(_ now: WidgetFace.Now) -> some View {
    Text(verbatim: now.text)
      .widgetFont(.nowLine)
      .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
      .minimumScaleFactor(dynamicTypeSize.isAccessibilitySize ? 0.5 : 0.75)
      .accessibilityLabel(now.spoken)
  }

  /// One way to show the week: its first `count` rows, with their dots or without.
  struct Fit: Hashable {
    let count: Int
    let dots: Bool
  }

  /// The ways to show `week`, best first: every row, then one fewer, down to one; at each count,
  /// with the rows' dots (when one of them has any), then without. A week's count of each, and
  /// no more: rows past the week's end would be the same rows again, measured again.
  static func fits(_ week: [WidgetFace.Day]) -> [Fit] {
    stride(from: week.count, through: 1, by: -1).flatMap { count in
      let dotted = week.prefix(count).contains { $0.agreement != nil }
      return (dotted ? [true, false] : [false]).map { Fit(count: count, dots: $0) }
    }
  }

  /// The week's rows `fit` shows, told apart by their labels, a week's being distinct.
  private func rows(_ fit: Fit) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      ForEach(face.week.prefix(fit.count), id: \.label) { day in
        WeekRowView(day: day, art: art, dots: fit.dots)
      }
    }
    .padding(.top, 4)
  }
}

/// A day after the middle day, on the medium's right half: the day, its glyph, its band's label
/// and, when the list has them, its small dots. A block of its own with no words of its own, so
/// the spec's cut-list item 2 (section 23.3) removes it and `WidgetFace.week` and leaves nothing
/// hidden. One VoiceOver element, reading the row as the app's week page does (`day.spoken`),
/// dots or none.
///
/// Its words are never cut short. The day keeps its whole width (at least `labelWidth`), and the
/// band's label takes the first of three forms that fits across what is left (`ViewThatFits`,
/// constrained in width): on one line, shrinking as far as `bandFloor`, as before; then wrapped
/// at its words, at its full size, on as many lines as it needs, the row as tall as they are,
/// where its longest word fits a line; then neither, a block taller than any widget (`unfit`),
/// so the list it is in doesn't fit and `ForecastMediumView` goes on to the next way to show
/// the week. Without dots, that last comes only where a word is wider than the room beside the
/// day and the glyph: by the fonts' metrics, "possible" at XXXL on the SE's medium, or beside
/// "Today", the widest day, at XXXL on the 375- and 393-wide ones and at XXL on the SE's; and
/// the longer words at the accessibility sizes. A list ends at the first row it can't draw, as
/// the days run in order.
struct WeekRowView: View {
  let day: WidgetFace.Day
  let art: WidgetArt
  /// Whether the row draws its dots, the list's choice (`ForecastMediumView`).
  let dots: Bool

  /// The smallest the band's label is drawn on one line: 13 points at Large, so 11.05, over the
  /// HIG's 11 (`WidgetType`'s floor for 13 points).
  private static let bandFloor: CGFloat = 0.85

  /// The height of a row that can't be drawn whole: taller than any widget, so no list holding
  /// it fits.
  private static let unfit: CGFloat = 10_000

  @ScaledMetric(relativeTo: .footnote) private var labelWidth: CGFloat = 30

  var body: some View {
    HStack(spacing: 4) {
      Text(verbatim: day.label)
        .widgetFont(.rowLabel)
        .lineLimit(1)
        .fixedSize()
        .frame(minWidth: labelWidth, alignment: .leading)
      GlyphMark(band: day.band, art: art, size: 14)
      ViewThatFits(in: .horizontal) {
        oneLine
        wrapped
        Color.clear
          .frame(width: 0, height: Self.unfit)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if dots, let agreement = day.agreement {
        AgreementDots(agreement, inRow: true)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(day.spoken)
  }

  /// The band's label on one line: as wide as it is at `bandFloor` (a hidden copy at that size
  /// sizes it), and drawn in all the width it is given, at its full size or shrunk as far as
  /// the floor; one line at its own height, whatever the copy's.
  private var oneLine: some View {
    Text(verbatim: day.bandLabel)
      .widgetFont(.rowBand, scale: Self.bandFloor)
      .lineLimit(1)
      .hidden()
      .frame(maxWidth: .infinity, alignment: .leading)
      .overlay(alignment: .leading) {
        Text(verbatim: day.bandLabel)
          .widgetFont(.rowBand)
          .lineLimit(1)
          .minimumScaleFactor(Self.bandFloor)
          .fixedSize(horizontal: false, vertical: true)
      }
  }

  /// The band's label wrapped at its words, at its full size: as wide as its longest word (a
  /// hidden copy, a word to a line, that adds no height; with no ideal width of its own, the
  /// label adds none), and as tall as its lines in the width it is given, as many as it needs.
  private var wrapped: some View {
    ZStack(alignment: .topLeading) {
      Text(verbatim: day.bandLabel.split(separator: " ").joined(separator: "\n"))
        .widgetFont(.rowBand)
        .fixedSize()
        .hidden()
        .frame(height: 0)
      Text(verbatim: day.bandLabel)
        .widgetFont(.rowBand)
        .fixedSize(horizontal: false, vertical: true)
        .frame(minWidth: 0, idealWidth: 0, maxWidth: .infinity, alignment: .leading)
    }
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
