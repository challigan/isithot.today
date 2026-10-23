import IsItLogic
import IsItModel
import SwiftUI

/// One forecast page (iOS build spec, section 10.2), scrolling, top to bottom: the glyph, its
/// flakes drifting on first paint and when the band changes; the question and the answer, one
/// heading for VoiceOver with the place; the verdict and the detail; the body (the middle page's
/// agreement, strip and model list, Now's next hours, or the week's days); Retry in the error
/// state; and the footer, with Retry under its line after a failed request while an answer
/// shows. Everything shown is `page`'s, so the page reads as the website does for the same
/// answer. Up to the largest accessibility text size nothing is cut short: text wraps, the
/// answer word shrinks to fit its line rather than break, and the page scrolls.
public struct ForecastPageView: View {
  let page: HomePage
  let theme: PageTheme
  /// The band's glyph, template images the page tints in `theme.ink`; nil without an answer.
  let glyph: PageGlyph?
  /// Never drift the glyph: a test's still screens.
  let still: Bool
  let actions: HomeActions

  @ScaledMetric(relativeTo: .largeTitle) private var glyphSize: CGFloat = 112

  public init(
    page: HomePage,
    theme: PageTheme,
    glyph: PageGlyph?,
    still: Bool = false,
    actions: HomeActions
  ) {
    self.page = page
    self.theme = theme
    self.glyph = glyph
    self.still = still
    self.actions = actions
  }

  public var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        header
        if let day = page.day {
          DayBodyView(day: day, ink: theme.ink)
        }
        if let hours = page.hours {
          NowBodyView(hours: hours, ink: theme.ink)
        }
        if let week = page.week {
          WeekBodyView(week: week, ink: theme.ink)
        }
        if let retry = page.retry, page.footer == nil {
          RetryButton(title: retry, action: actions.retry)
        }
        if let footer = page.footer {
          PageFooterView(footer: footer, retry: page.retry, actions: actions)
            .padding(.top, 24)
        }
      }
      .padding(.horizontal, 20)
      .padding(.top, 8)
      .padding(.bottom, 32)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .foregroundStyle(theme.ink)
    .tint(theme.ink)
    .environment(\.colorScheme, theme.controls)
    .accessibilityIdentifier("page-\(page.view.rawValue)")
  }

  /// The glyph, the heading, the verdict and the detail; while the first answer is on its way,
  /// shapes that hold their places.
  @ViewBuilder private var header: some View {
    let size = min(glyphSize, 160)
    if let glyph {
      GlyphView(glyph: glyph, size: size, still: still)
    } else if page.state == .loading {
      Circle()
        .fill(theme.ink.opacity(0.12))
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
    VStack(alignment: .leading, spacing: 2) {
      Text(verbatim: page.question)
        .font(.title3)
        .fixedSize(horizontal: false, vertical: true)
      if page.state == .ready {
        // One word ("Maybe."), which at the largest sizes shrinks to fit rather than breaking.
        Text(verbatim: page.answer)
          .font(answerFont)
          .lineLimit(1)
          .minimumScaleFactor(0.5)
      } else {
        Text(verbatim: page.answer)
          .font(answerFont)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(verbatim: page.headingLabel))
    .accessibilityAddTraits(.isHeader)
    .accessibilityIdentifier("heading")
    if let verdict = page.verdict {
      Text(verbatim: verdict)
        .font(.title3.weight(.semibold))
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("verdict")
    }
    if let detail = page.detail {
      Text(verbatim: detail)
        .font(.body)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("detail")
    }
    if page.state == .loading {
      VStack(alignment: .leading, spacing: 10) {
        placeholder(width: 0.6)
        placeholder(width: 0.9)
        placeholder(width: 0.75)
      }
      .accessibilityHidden(true)
    }
  }

  /// The answer word in the website's answer font, Bricolage Grotesque, growing with Dynamic
  /// Type as the large title does; what a state says in its place, in the system font.
  private var answerFont: Font {
    page.state == .ready
      ? .custom("BricolageAnswer", size: 64, relativeTo: .largeTitle)
      : .title2.weight(.semibold)
  }

  /// A bar of the loading skeleton, `width` of the page wide.
  private func placeholder(width: CGFloat) -> some View {
    GeometryReader { proxy in
      RoundedRectangle(cornerRadius: 6)
        .fill(theme.ink.opacity(0.12))
        .frame(width: proxy.size.width * width)
    }
    .frame(height: 16)
  }
}

/// The middle page's body: the agreement heading ("5 of 6 forecasts expect snow"), the strip,
/// the model list ("ECMWF · 2cm", each model's name over its amount at accessibility sizes) and
/// the limited line.
struct DayBodyView: View {
  let day: HomePage.Day
  let ink: Color

  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(verbatim: day.heading)
        .font(.headline)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("agreement")
      ModelStripView(strip: day.strip, ink: ink)
      VStack(alignment: .leading, spacing: typeSize.isAccessibilitySize ? 12 : 6) {
        ForEach(Array(day.lines.enumerated()), id: \.offset) { index, line in
          ModelLineView(line: line, stacked: typeSize.isAccessibilitySize)
            .accessibilityIdentifier("model-\(index)")
        }
      }
      .padding(.top, 4)
      if let limited = day.limited {
        Text(verbatim: limited)
          .font(.footnote)
          .accessibilityIdentifier("limited")
      }
    }
  }
}

/// One model's row. A model that disagrees with the answer has a lighter amount rather than
/// fainter text, as on the website, so the row keeps its contrast.
struct ModelLineView: View {
  let line: HomePage.ModelLine
  let stacked: Bool

  var body: some View {
    Group {
      if stacked {
        VStack(alignment: .leading, spacing: 2) {
          Text(verbatim: line.name)
          Text(verbatim: line.value)
            .fontWeight(line.out ? .regular : .semibold)
        }
      } else {
        Text(verbatim: line.text)
          .fontWeight(line.out ? .regular : .semibold)
      }
    }
    .font(.body)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(verbatim: line.name))
    .accessibilityValue(Text(verbatim: line.value))
  }
}

/// The models strip (`StripGeometry`, core's positions in % of its width): the track, the snowy
/// zone from the day's threshold, a dot per model at its amount (fainter for one that disagrees),
/// and the end labels. One accessibility element, read as the day's `stripSummary`.
struct ModelStripView: View {
  let strip: StripGeometry
  let ink: Color

  @ScaledMetric(relativeTo: .body) private var height: CGFloat = 44
  @ScaledMetric(relativeTo: .body) private var dot: CGFloat = 13
  @ScaledMetric(relativeTo: .body) private var zoneHeight: CGFloat = 24

  var body: some View {
    VStack(spacing: 4) {
      GeometryReader { proxy in
        let width = proxy.size.width
        let middle = proxy.size.height / 2
        ZStack(alignment: .topLeading) {
          Capsule()
            .fill(ink.opacity(0.25))
            .frame(width: width, height: 2)
            .position(x: width / 2, y: middle)
          if let zone = strip.zone, zone.width > 0 {
            Capsule()
              .fill(ink.opacity(0.14))
              .frame(width: width * zone.width / 100, height: zoneHeight)
              .position(x: width * (zone.left + zone.width / 2) / 100, y: middle)
          }
          ForEach(Array(strip.dots.enumerated()), id: \.offset) { _, model in
            Circle()
              .fill(ink.opacity(model.out ? 0.4 : 1))
              .frame(width: dot, height: dot)
              .position(x: width * model.left / 100, y: middle)
          }
        }
      }
      .frame(height: height)
      HStack {
        Text(verbatim: strip.min)
        Spacer()
        Text(verbatim: strip.max)
      }
      .font(.footnote)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(verbatim: strip.summary))
    .accessibilityIdentifier("strip")
  }
}

/// "Retry": in the error state on the page, or under the footer's line over an answer.
struct RetryButton: View {
  let title: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Text(verbatim: title)
        .font(.headline)
        .padding(.horizontal, 8)
    }
    .buttonStyle(.bordered)
    // The large size's bezel is taller than the 44 points a control is tapped by.
    .controlSize(.large)
    .accessibilityIdentifier("retry")
  }
}
