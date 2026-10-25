import IsItLogic
import IsItModel
import SwiftUI

/// Now's body, the website's Now (`.ahead`, `hoursHtml`): "Chance of snow, next 12 hours", then
/// the grid of 2-hour blocks, each its chance over its time ("20%" over "10am"), three columns and
/// two at accessibility sizes. Each cell is one element, read as "20% chance at 10am" (section
/// 16). The chance bars the app drew before are gone, as the website has none (DECISIONS, "The
/// iPhone app in the website's look").
struct NowBodyView: View {
  let hours: HomePage.Hours

  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(verbatim: hours.heading)
        .brandFont(.heading)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("hours-heading")
      EqualColumns(
        columns: typeSize.isAccessibilitySize ? 2 : 3, spacing: 20, lineSpacing: 14.4
      ) {
        ForEach(Array(hours.rows.enumerated()), id: \.offset) { index, row in
          ValueCell(
            value: row.value, name: row.label, out: false, spoken: row.spoken, spokenValue: nil,
            identifier: "hour-\(index)")
        }
      }
      .padding(.top, 12)
    }
  }
}

/// The week's body, the website's week (`.ahead`, `weekHtml`): "The week ahead", then a row for
/// each day: its name, a track with a dot from none to the week's snowiest day, the amount and
/// the band ("Tue", the dot, "2cm", "Snow"). Each row is one element, read as "Tuesday, 2cm,
/// snow, 4 of 6 forecasts expect snow" (section 16): how many forecasts agree, which spec 10.2
/// drew as a row of dots, is now spoken only, as the website shows none. At accessibility text
/// sizes a row stacks rather than clips, without the track, as the website drops it when the
/// text is large: the day and the amount, then the band.
struct WeekBodyView: View {
  let week: HomePage.Week

  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    let stacked = typeSize.isAccessibilitySize
    VStack(alignment: .leading, spacing: 0) {
      Text(verbatim: week.heading)
        .brandFont(.heading)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("week-heading")
      VStack(alignment: .leading, spacing: stacked ? 12 : 0) {
        ForEach(Array(week.rows.enumerated()), id: \.offset) { index, row in
          WeekRowView(row: row, stacked: stacked)
            .accessibilityIdentifier("day-\(index)")
        }
      }
      .padding(.top, 12)
    }
  }
}

/// One day of the week, at least 32 points tall. Its columns are the website's least widths
/// (52, 44 and 76) raised to the widest snow labels ("0.2cm", "A few flakes") and grown with the
/// text, so they line up row to row; the track takes what is left, at least 24 points.
struct WeekRowView: View {
  let row: HomePage.WeekRow
  let stacked: Bool

  @ScaledMetric(relativeTo: .callout) private var dayWidth: CGFloat = 52
  @ScaledMetric(relativeTo: .body) private var amountWidth: CGFloat = 54
  @ScaledMetric(relativeTo: .subheadline) private var bandWidth: CGFloat = 83
  @ScaledMetric(relativeTo: .body) private var trackHeight: CGFloat = 16

  var body: some View {
    Group {
      if stacked {
        VStack(alignment: .leading, spacing: 2) {
          // The day and the amount side by side while they fit, wrapping as text does: not
          // `ViewThatFits` between two copies of them (why: the switcher's, HomePager.swift).
          FlowLayout(spacing: 12, lineSpacing: 2) {
            day
            amount
          }
          band
        }
      } else {
        HStack(alignment: .center, spacing: 12) {
          day
            .frame(minWidth: dayWidth, alignment: .leading)
          WeekTrack(left: row.left)
            .frame(minWidth: 24, maxWidth: .infinity)
            .frame(height: trackHeight)
          amount
            .frame(minWidth: amountWidth, alignment: .trailing)
          band
            .frame(minWidth: bandWidth, alignment: .leading)
        }
        .frame(minHeight: 32)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(verbatim: row.spoken))
  }

  private var day: some View {
    Text(verbatim: row.label)
      .brandFont(.labelStrong)
      .fixedSize(horizontal: false, vertical: true)
  }

  private var amount: some View {
    Text(verbatim: row.amount)
      .brandFont(.amount)
      .fixedSize(horizontal: false, vertical: true)
  }

  private var band: some View {
    Text(verbatim: row.bandLabel)
      .brandFont(.small)
      .fixedSize(horizontal: false, vertical: true)
  }
}

/// A day's track, the website's `.days .track`: a 2-point line at a quarter of the ink, and the
/// day's dot at `left`% of it, the snowiest day of the week at its end. Shapes only, with no
/// accessibility modifier, so no element: hidden, the dots the rows drew before made an
/// unlabelled element under each row (DECISIONS, PR #33's second run; Backgrounds.swift).
struct WeekTrack: View {
  /// From 0, no snow, to 100, the week's snowiest day.
  let left: Double

  @SurfaceTokens private var tokens
  @ScaledMetric(relativeTo: .body) private var dot: CGFloat = 12.8

  var body: some View {
    GeometryReader { proxy in
      let width = proxy.size.width
      let middle = proxy.size.height / 2
      ZStack(alignment: .topLeading) {
        Capsule()
          .fill(tokens.ink.opacity(0.25))
          .frame(width: width, height: 2)
          .position(x: width / 2, y: middle)
        Circle()
          .fill(tokens.ink)
          .frame(width: dot, height: dot)
          .position(x: width * CGFloat(min(max(left, 0), 100)) / 100, y: middle)
      }
    }
  }
}
