import IsItLogic
import IsItModel
import SwiftUI

/// One forecast page (iOS build spec, section 10.2) in the website's look (DECISIONS, "The
/// iPhone app in the website's look"), scrolling, top to bottom: the question with the glyph at
/// its top right, its flakes drifting on first paint and when the band changes; the answer word
/// at the website's size, 0.3 of the page's width; the question and the answer one heading for
/// VoiceOver with the place; the verdict and the detail; the body (the middle page's agreement,
/// strip and grid of models, Now's grid of hours, or the week's days); Retry in the error state;
/// and the footer, with Retry under its line after a failed request while an answer shows.
/// Everything shown is `page`'s, so the page reads as the website does for the same answer. Up
/// to the largest accessibility text size nothing is cut short: text wraps, the glyph moves above
/// the question, the grids take two columns, the answer word shrinks to fit its line rather than
/// break, and the page scrolls.
public struct ForecastPageView: View {
  let page: HomePage
  let theme: PageTheme
  /// The band's glyph, template images the page tints in `theme.ink`; nil without an answer.
  let glyph: PageGlyph?
  /// Never drift the glyph: a test's still screens.
  let still: Bool
  /// The pager's width, which sizes the answer word and the glyph, as the website's viewport
  /// does.
  let pageWidth: CGFloat
  let actions: HomeActions

  @Environment(\.dynamicTypeSize) private var typeSize
  /// The glyph's size, the website's 112 points, growing with the text.
  @ScaledMetric(relativeTo: .largeTitle) private var glyphSize: CGFloat = 112
  /// How much the answer word has grown with the text, in percent.
  @ScaledMetric(relativeTo: .largeTitle) private var answerGrowth: CGFloat = 100
  /// The detail's size as drawn, by which its width and the space round it are set.
  @ScaledMetric(relativeTo: .body) private var detailSize: CGFloat = TextRole.detail.size

  public init(
    page: HomePage,
    theme: PageTheme,
    glyph: PageGlyph?,
    still: Bool = false,
    pageWidth: CGFloat,
    actions: HomeActions
  ) {
    self.page = page
    self.theme = theme
    self.glyph = glyph
    self.still = still
    self.pageWidth = pageWidth
    self.actions = actions
  }

  public var body: some View {
    let accessibilitySize = typeSize.isAccessibilitySize
    // The website's body sits 44 below the detail, plus the detail's half-leading.
    let bodyGap = 44 + 0.15 * detailSize
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        hero(accessibilitySize: accessibilitySize)
        if let verdict = page.verdict {
          Text(verbatim: verdict)
            .brandFont(.verdict)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("verdict")
            .padding(.top, 24 - answerOverhang)
        }
        if let detail = page.detail {
          // Full ink, not the website's 0.9 opacity, which gives 4.31:1 under snow's glow.
          Text(verbatim: detail)
            .brandFont(.detail)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("detail")
            .frame(maxWidth: 20.2 * detailSize, alignment: .leading)
            .padding(.top, 5.6 + 0.15 * detailSize)
        }
        if let day = page.day {
          DayBodyView(day: day)
            .padding(.top, bodyGap)
        }
        if let hours = page.hours {
          NowBodyView(hours: hours)
            .padding(.top, bodyGap)
        }
        if let week = page.week {
          WeekBodyView(week: week)
            .padding(.top, bodyGap)
        }
        if let retry = page.retry, page.footer == nil {
          RetryButton(title: retry, action: actions.retry)
            .padding(.top, 20)
        }
        if let footer = page.footer {
          PageFooterView(footer: footer, retry: page.retry, actions: actions)
        }
      }
      .padding(.horizontal, 20)
      // The glyph's top, the website's 4vh; at accessibility sizes, the glyph's own line.
      .padding(.top, accessibilitySize ? 24 : 35)
      .padding(.bottom, 32)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .foregroundStyle(theme.ink)
    .tint(theme.ink)
    .environment(\.colorScheme, theme.controls)
    .environment(\.pageTheme, theme)
    .environment(\.surface, .page)
    .accessibilityIdentifier("page-\(page.view.rawValue)")
  }

  /// The answer word's size at Large: the website's 30vw, from 96 to 208.
  private var answerBase: CGFloat { TextRole.answerSize(pageWidth: pageWidth) }

  /// How far the answer word's line reaches above its capitals and below its baseline beyond the
  /// website's 0.86 line height, which SwiftUI can't set under the face's 1.2: 0.17 of its size,
  /// taken from the space above and below it, so the question, the answer and the verdict sit
  /// as the website's do (-16.5 at Large) while every text keeps its whole frame.
  private var answerOverhang: CGFloat { 0.17 * answerBase * answerGrowth / 100 }

  /// The glyph and the heading. At standard sizes the glyph sits at the top right, 8 points into
  /// the gutter as the website's does, and the heading 35 below its top, the question wrapping
  /// short of the glyph; at accessibility sizes the glyph on a line of its own, trailing, and the
  /// question under it, full width. The glyph is drawn in full ink.
  @ViewBuilder private func hero(accessibilitySize: Bool) -> some View {
    let width = max(pageWidth - 40, 0)
    let size = min(glyphSize, 176, 0.4 * width)
    if accessibilitySize {
      VStack(alignment: .leading, spacing: 12) {
        if let glyph {
          GlyphView(glyph: glyph, size: size, still: still)
            .offset(x: 8)
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        heading(questionWidth: width)
      }
    } else {
      ZStack(alignment: .topTrailing) {
        if let glyph {
          GlyphView(glyph: glyph, size: size, still: still)
            .offset(x: 8)
        }
        heading(questionWidth: glyph == nil ? width : width - size)
          .padding(.top, 35)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }

  /// The question and the answer: one heading element, with the place, which hugs their words.
  /// The question is offered no more than `questionWidth` and keeps its own width
  /// (`LimitedWidth`), so the element never reaches over the glyph or across the page's gradient
  /// beside a short question. With an answer, the answer word on one line, shrinking rather than
  /// breaking; without, what the state says ("Checking…"), wrapping.
  private func heading(questionWidth: CGFloat) -> some View {
    let ready = page.state == .ready
    return VStack(alignment: .leading, spacing: ready ? 4 - answerOverhang : 4) {
      LimitedWidth(width: questionWidth) {
        Text(verbatim: page.question)
          .brandFont(.question)
          .fixedSize(horizontal: false, vertical: true)
      }
      if ready {
        Text(verbatim: page.answer)
          .brandFont(.answer, size: answerBase)
          .lineLimit(1)
          .minimumScaleFactor(0.3)
      } else {
        Text(verbatim: page.answer)
          .brandFont(.answerState)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(verbatim: page.headingLabel))
    .accessibilityAddTraits(.isHeader)
    .accessibilityIdentifier("heading")
  }
}

/// The middle page's body, the website's `.models`: the agreement heading ("5 of 6 forecasts
/// expect snow"), the strip, the grid of models, each its amount over its name (three columns,
/// two at accessibility sizes), and the limited line.
struct DayBodyView: View {
  let day: HomePage.Day

  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      // Full ink, not the website's 0.9 opacity (as the detail).
      Text(verbatim: day.heading)
        .brandFont(.label)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("agreement")
      ModelStripView(strip: day.strip)
        .padding(.top, 16)
      EqualColumns(
        columns: typeSize.isAccessibilitySize ? 2 : 3, spacing: 20, lineSpacing: 14.4
      ) {
        ForEach(Array(day.lines.enumerated()), id: \.offset) { index, line in
          ValueCell(
            value: line.value, name: line.name, out: line.out, spoken: line.name,
            spokenValue: line.value, identifier: "model-\(index)")
        }
      }
      .padding(.top, 24)
      if let limited = day.limited {
        Text(verbatim: limited)
          .brandFont(.small)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityIdentifier("limited")
          .padding(.top, 12)
      }
    }
  }
}

/// A cell of the website's grids (`.list li`): a value over its name, the value lighter for a
/// model that disagrees with the answer (`out`), as on the website, never fainter. One
/// accessibility element over both lines, which hugs them (DECISIONS: the audit looks for words
/// no element covers, and judges an element by its frame); the column's width goes round it.
struct ValueCell: View {
  let value: String
  let name: String
  let out: Bool
  /// What VoiceOver reads: a model's name, with its amount as the value; an hour's "20% chance
  /// at 10am", with none.
  let spoken: String
  let spokenValue: String?
  let identifier: String

  var body: some View {
    VStack(alignment: .leading, spacing: 1.6) {
      Text(verbatim: value)
        .brandFont(out ? .valueOut : .value)
      Text(verbatim: name)
        .brandFont(.caption)
    }
    .fixedSize(horizontal: false, vertical: true)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(verbatim: spoken))
    .accessibilityValue(ifAny: spokenValue)
    .accessibilityIdentifier(identifier)
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// The models strip (`StripGeometry`, core's positions in % of its width), as the website draws
/// it: the track, the snowy zone from the day's threshold, a dot per model at its amount
/// (fainter for one that disagrees), and the end labels 8 below. One accessibility element, read
/// as the day's `stripSummary`.
struct ModelStripView: View {
  let strip: StripGeometry

  @SurfaceTokens private var tokens
  @ScaledMetric(relativeTo: .body) private var height: CGFloat = 44
  @ScaledMetric(relativeTo: .body) private var dot: CGFloat = 12.8
  @ScaledMetric(relativeTo: .body) private var zoneHeight: CGFloat = 24

  var body: some View {
    VStack(spacing: 8) {
      GeometryReader { proxy in
        let width = proxy.size.width
        let middle = proxy.size.height / 2
        ZStack(alignment: .topLeading) {
          Capsule()
            .fill(tokens.ink.opacity(0.25))
            .frame(width: width, height: 2)
            .position(x: width / 2, y: middle)
          if let zone = strip.zone, zone.width > 0 {
            Capsule()
              .fill(tokens.ink.opacity(0.14))
              .frame(width: width * zone.width / 100, height: zoneHeight)
              .position(x: width * (zone.left + zone.width / 2) / 100, y: middle)
          }
          ForEach(Array(strip.dots.enumerated()), id: \.offset) { _, model in
            Circle()
              .fill(tokens.ink.opacity(model.out ? 0.4 : 1))
              .frame(width: dot, height: dot)
              .position(x: width * model.left / 100, y: middle)
          }
        }
      }
      .frame(height: height)
      HStack {
        Text(verbatim: strip.min)
          .monospacedDigit()
        Spacer()
        Text(verbatim: strip.max)
          .monospacedDigit()
      }
      .brandFont(.caption)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(verbatim: strip.summary))
    .accessibilityIdentifier("strip")
  }
}

/// "Retry": in the error state under the words, or under the footer's line over an answer. The
/// website's `.retry` chip, filled with the page's chip colour rather than its 10% ink, which
/// gives 4.01:1 on maybesnow, with the `border` edge; drawn and tapped at least 44 tall. Its word
/// is in `label`, as the picker's Close, built the same way, is: the Medium 14.4 with
/// subheadline both were in is drawn at 14 points at Medium and Large alike, which the audit
/// failed in Close and in a notice's project page (DECISIONS, "After #34's second full run").
struct RetryButton: View {
  let title: String
  let action: () -> Void

  var body: some View {
    PillButton(.chip(minHeight: HitTarget.minimum), bordered: true, action: action) {
      Text(verbatim: title)
        .brandFont(.label)
    }
    .accessibilityIdentifier("retry")
  }
}
