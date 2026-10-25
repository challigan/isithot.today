import IsItLogic
import IsItModel
import SwiftUI

/// Now's body (iOS build spec, section 10.2): "Chance of snow, next 12 hours", then the 2-hour
/// rows ("6pm · 60%"), each one element read as "60% chance at 6pm" (section 16), with a bar for
/// its chance. At accessibility text sizes a row puts its bar under its hour and chance.
struct NowBodyView: View {
  let hours: HomePage.Hours
  let ink: Color

  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(verbatim: hours.heading)
        .font(.headline)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("hours-heading")
      VStack(alignment: .leading, spacing: typeSize.isAccessibilitySize ? 14 : 8) {
        ForEach(Array(hours.rows.enumerated()), id: \.offset) { index, row in
          HourRowView(row: row, ink: ink, stacked: typeSize.isAccessibilitySize)
            .accessibilityIdentifier("hour-\(index)")
        }
      }
    }
  }
}

/// One of Now's 2-hour rows: the hour, a bar for the chance, and the chance.
struct HourRowView: View {
  let row: HomePage.HourRow
  let ink: Color
  let stacked: Bool

  @ScaledMetric(relativeTo: .body) private var columnWidth: CGFloat = 52
  @ScaledMetric(relativeTo: .body) private var barHeight: CGFloat = 8

  var body: some View {
    Group {
      if stacked {
        VStack(alignment: .leading, spacing: 4) {
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            hour
            Spacer(minLength: 8)
            chance
          }
          bar
        }
      } else {
        HStack(alignment: .center, spacing: 12) {
          hour
            .frame(minWidth: columnWidth, alignment: .leading)
          bar
          chance
            .frame(minWidth: columnWidth, alignment: .trailing)
        }
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(verbatim: row.spoken))
  }

  private var hour: some View {
    Text(verbatim: row.label)
      .font(.body)
      .fixedSize(horizontal: false, vertical: true)
  }

  private var chance: some View {
    Text(verbatim: row.value)
      .font(.body.weight(.semibold))
      .monospacedDigit()
      .fixedSize(horizontal: false, vertical: true)
  }

  /// The chance as a filled share of a track, decorative: the row's label says it, and its
  /// shapes have no accessibility element. No accessibility modifier: `.accessibilityHidden(true)`
  /// here made the bar an unlabelled element under its row on PR #33's first macOS run (its
  /// trees), as it made the page's background one (Backgrounds.swift).
  private var bar: some View {
    GeometryReader { proxy in
      ZStack(alignment: .leading) {
        Capsule()
          .fill(ink.opacity(0.18))
        Capsule()
          .fill(ink)
          .frame(width: proxy.size.width * CGFloat(min(max(row.chance, 0), 100)) / 100)
      }
    }
    .frame(height: barHeight)
  }
}

/// The week's body (iOS build spec, section 10.2), under its verdict and detail: a row for each
/// day, "Tue", "2cm", "Snow" and an agreement dot for each forecast with data, filled for each
/// that expects snow, so it says how many agree and never a percentage. Each row is one element,
/// read as "Tuesday, 2cm, snow, 4 of 6 forecasts expect snow" (section 16). At accessibility text
/// sizes a row stacks rather than clips: the day and the amount, then the band, then the dots.
struct WeekBodyView: View {
  let week: HomePage.Week
  let ink: Color

  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    VStack(alignment: .leading, spacing: typeSize.isAccessibilitySize ? 18 : 10) {
      ForEach(Array(week.rows.enumerated()), id: \.offset) { index, row in
        WeekRowView(row: row, ink: ink, stacked: typeSize.isAccessibilitySize)
          .accessibilityIdentifier("day-\(index)")
      }
    }
  }
}

/// One day of the week.
struct WeekRowView: View {
  let row: HomePage.WeekRow
  let ink: Color
  let stacked: Bool

  @ScaledMetric(relativeTo: .body) private var dayWidth: CGFloat = 56
  @ScaledMetric(relativeTo: .body) private var amountWidth: CGFloat = 60

  var body: some View {
    Group {
      if stacked {
        VStack(alignment: .leading, spacing: 4) {
          // The day and the amount side by side while they fit, wrapping as text does: not
          // `ViewThatFits` between two copies of them (why: the top bar's, in HomeShell.swift).
          FlowLayout(spacing: 12, lineSpacing: 2) {
            day
            amount
          }
          band
          dots
        }
      } else {
        HStack(alignment: .center, spacing: 12) {
          day
            .frame(minWidth: dayWidth, alignment: .leading)
          amount
            .frame(minWidth: amountWidth, alignment: .leading)
          band
            .frame(maxWidth: .infinity, alignment: .leading)
          dots
        }
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(verbatim: row.spoken))
  }

  private var day: some View {
    Text(verbatim: row.label)
      .font(.headline)
      .fixedSize(horizontal: false, vertical: true)
  }

  private var amount: some View {
    Text(verbatim: row.amount)
      .font(.body.weight(.semibold))
      .monospacedDigit()
      .fixedSize(horizontal: false, vertical: true)
  }

  private var band: some View {
    Text(verbatim: row.bandLabel)
      .font(.body)
      .fixedSize(horizontal: false, vertical: true)
  }

  /// An answer saved before the week's days had their agreement has no dots.
  @ViewBuilder private var dots: some View {
    if let snowy = row.snowy, let total = row.total, total > 0 {
      AgreementDots(snowy: snowy, total: total, ink: ink)
    }
  }
}

/// A dot for each forecast with data for the day, filled for each that expects snow, outlined
/// for the others. Decorative: the row's label says how many. No accessibility modifier, as the
/// hour bar has none (above): hidden, the dots were one unlabelled element under their row.
struct AgreementDots: View {
  let snowy: Int
  let total: Int
  let ink: Color

  @ScaledMetric(relativeTo: .body) private var size: CGFloat = 10

  var body: some View {
    HStack(spacing: size / 2) {
      ForEach(0..<total, id: \.self) { index in
        Circle()
          .strokeBorder(ink, lineWidth: max(1, size / 6))
          .background(Circle().fill(index < snowy ? ink : Color.clear))
          .frame(width: size, height: size)
      }
    }
    .fixedSize()
  }
}
