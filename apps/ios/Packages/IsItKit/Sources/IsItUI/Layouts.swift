import SwiftUI

/// Lays its views out left to right, wrapping onto the next line when one doesn't fit, as text
/// wraps, and a view wider than the line onto lines of its own: the footer's links and places at
/// any text size, the top bar's approximate line, and at accessibility sizes the switcher's
/// buttons and a week row's day and amount. Each view is laid out once, wherever it goes, so the
/// accessibility audit follows one element as the text grows, where `ViewThatFits` chooses
/// between copies of it.
struct FlowLayout: Layout {
  var spacing: CGFloat
  var lineSpacing: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    arrangement(of: subviews, width: proposal.width ?? .infinity).size
  }

  func placeSubviews(
    in bounds: CGRect,
    proposal: ProposedViewSize,
    subviews: Subviews,
    cache: inout ()
  ) {
    let placed = arrangement(of: subviews, width: bounds.width)
    for index in subviews.indices {
      let origin = placed.origins[index]
      subviews[index].place(
        at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y),
        proposal: ProposedViewSize(placed.sizes[index])
      )
    }
  }

  /// Where each view goes, at its own size (or the width, for one wider than it), and the size
  /// of the whole.
  private func arrangement(
    of subviews: Subviews,
    width: CGFloat
  ) -> (origins: [CGPoint], sizes: [CGSize], size: CGSize) {
    var origins: [CGPoint] = []
    var sizes: [CGSize] = []
    var x: CGFloat = 0
    var y: CGFloat = 0
    var lineHeight: CGFloat = 0
    var widest: CGFloat = 0
    for subview in subviews {
      var size = subview.sizeThatFits(.unspecified)
      if size.width > width {
        size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
      }
      if x > 0, x + size.width > width {
        x = 0
        y += lineHeight + lineSpacing
        lineHeight = 0
      }
      origins.append(CGPoint(x: x, y: y))
      sizes.append(size)
      widest = max(widest, x + size.width)
      x += size.width + spacing
      lineHeight = max(lineHeight, size.height)
    }
    return (origins, sizes, CGSize(width: widest, height: y + lineHeight))
  }
}

/// `columns` equal columns, filled row by row, each row as tall as its tallest view: CSS's
/// `repeat(n, minmax(0, 1fr))`, the website's grids of Today's models and Now's hours (three
/// columns, two at accessibility sizes). Not lazy, so every view is made at every size and the
/// audit follows each one as the text grows (DECISIONS: a lazy container's text failed the Dynamic
/// Type check though it grew).
struct EqualColumns: Layout {
  var columns: Int
  var spacing: CGFloat
  var lineSpacing: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? idealWidth(of: subviews)
    let rows = rowHeights(of: subviews, column: column(in: width))
    let gaps = lineSpacing * CGFloat(max(rows.count - 1, 0))
    return CGSize(width: width, height: rows.reduce(0, +) + gaps)
  }

  func placeSubviews(
    in bounds: CGRect,
    proposal: ProposedViewSize,
    subviews: Subviews,
    cache: inout ()
  ) {
    let width = column(in: bounds.width)
    var y = bounds.minY
    for (row, height) in rowHeights(of: subviews, column: width).enumerated() {
      for slot in 0..<count where row * count + slot < subviews.count {
        subviews[row * count + slot].place(
          at: CGPoint(x: bounds.minX + CGFloat(slot) * (width + spacing), y: y),
          proposal: ProposedViewSize(width: width, height: height)
        )
      }
      y += height + lineSpacing
    }
  }

  /// At least one column.
  private var count: Int { max(columns, 1) }

  /// A column's width in a row `width` wide.
  private func column(in width: CGFloat) -> CGFloat {
    max(0, (width - spacing * CGFloat(count - 1)) / CGFloat(count))
  }

  /// Each row's height: its tallest view's, at the column's width.
  private func rowHeights(of subviews: Subviews, column: CGFloat) -> [CGFloat] {
    stride(from: 0, to: subviews.count, by: count).map { start in
      subviews[start..<min(start + count, subviews.count)]
        .map { $0.sizeThatFits(ProposedViewSize(width: column, height: nil)).height }
        .max() ?? 0
    }
  }

  /// With no width offered, as wide as the widest view's columns.
  private func idealWidth(of subviews: Subviews) -> CGFloat {
    let widest = subviews.map { $0.sizeThatFits(.unspecified).width }.max() ?? 0
    return widest * CGFloat(count) + spacing * CGFloat(count - 1)
  }
}
