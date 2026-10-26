import SwiftUI

/// Lays its views out left to right, wrapping onto the next line when one doesn't fit, as text
/// wraps, and a view wider than the line onto lines of its own: the footer's links and places at
/// any text size, and at accessibility sizes the switcher's tabs and a week row's day and amount.
/// Each view is laid out once, wherever it goes, so the accessibility audit follows one element
/// as the text grows, where `ViewThatFits` chooses between copies of it.
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

/// Offers its one view no more than `width`, and takes the view's own size: a text wraps short of
/// `width` and its frame still hugs its words, where `.frame(maxWidth:)` would grow to `width` and
/// take the page's gradient beside a short line into the text's accessibility element. The
/// question beside the glyph: an element on a page's gradient hugs its words (DECISIONS, "The
/// iPhone app in the website's look").
struct LimitedWidth: Layout {
  var width: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    subviews.first?.sizeThatFits(offer(proposal)) ?? .zero
  }

  func placeSubviews(
    in bounds: CGRect,
    proposal: ProposedViewSize,
    subviews: Subviews,
    cache: inout ()
  ) {
    subviews.first?.place(at: bounds.origin, proposal: offer(proposal))
  }

  /// The width offered, at most `width`; `width` when none is.
  private func offer(_ proposal: ProposedViewSize) -> ProposedViewSize {
    let most = max(width, 0)
    return ProposedViewSize(width: min(proposal.width ?? most, most), height: proposal.height)
  }
}

/// Lays its one view out on one line when its words fit the width offered, to within `slack`,
/// and wraps them at that width only when they don't. On one line the view is offered no width,
/// so it takes its own and can't wrap. Offered a width, a text can be given a fraction less than
/// its words once its container is drawn on the screen's pixels: the place's pill was drawn
/// 119.0 wide for "Aberdeen", whose words are 72.656 points and its padding, pin and gap 46.4,
/// and on PR #34's last macOS run its "n" wrapped (DECISIONS, "The place pill on one line, after
/// #34 merged"). A line kept whole within the slack runs into the pill's 12-point padding by no
/// more. Wrapped, the words are measured at the width offered and placed with the slack added,
/// so a line measured a fraction wider than the pixels it is drawn on breaks where it did.
struct OneLineWhenItFits: Layout {
  /// How far past the width offered a line may run and still be kept whole: a point, more than
  /// a pixel at any of the iPhone's scales.
  var slack: CGFloat = 1

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    guard let view = subviews.first else { return .zero }
    guard let width = proposal.width, !fitsOnOneLine(view, in: width) else {
      return view.sizeThatFits(.unspecified)
    }
    return view.sizeThatFits(ProposedViewSize(width: width, height: nil))
  }

  func placeSubviews(
    in bounds: CGRect,
    proposal: ProposedViewSize,
    subviews: Subviews,
    cache: inout ()
  ) {
    guard let view = subviews.first else { return }
    let offer =
      fitsOnOneLine(view, in: bounds.width)
      ? ProposedViewSize.unspecified
      : ProposedViewSize(width: bounds.width + slack, height: nil)
    view.place(at: bounds.origin, proposal: offer)
  }

  /// Whether the view's own width is no more than `width` and the slack.
  private func fitsOnOneLine(_ view: LayoutSubview, in width: CGFloat) -> Bool {
    view.sizeThatFits(.unspecified).width <= width + slack
  }
}

/// The top bar's lines, as the website's header wraps (global.css `header`, `flex-wrap` and
/// `space-between`; DECISIONS, "The app's name back at the top left"). Its views are the app's
/// name, the place's pill, the gear, and then any notes about the place. When the name, the pill
/// and the gear fit one line, to within `slack`, the name leads and the pill and the gear trail,
/// `pillGap` apart. Otherwise the name and the gear share the first line and the pill takes the
/// next on its own, leading, offered the whole width, as the website moves its pills under its
/// name. The notes follow beneath: at the bar's trailing edge on one line, as before, and at its
/// leading edge, under the pill, on two. On two lines the name is offered what the gear leaves it,
/// so at the largest text sizes it shrinks (`AppNameView`). Placing chooses from the width the bar
/// was sized at, and each view is measured and placed with the same offer, so a bar placed a pixel
/// narrower than it was sized keeps its lines, and no text in it wraps again; views on a line are
/// centred on it.
struct TopBarLayout: Layout {
  /// Between the name and what follows it on its line: the website's 1rem.
  var gap: CGFloat
  /// Between the pill and the gear.
  var pillGap: CGFloat
  /// How far past the width the one line may run and still be kept, into the gap: a point, more
  /// than a pixel at any of the iPhone's scales.
  var slack: CGFloat = 1

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    arrangement(of: subviews, width: proposal.width).size
  }

  func placeSubviews(
    in bounds: CGRect,
    proposal: ProposedViewSize,
    subviews: Subviews,
    cache: inout ()
  ) {
    // The width it was sized at, which `bounds` may be a pixel narrower than once rounded: the
    // same choice of one line or two, and the same lines.
    let placed = arrangement(of: subviews, width: proposal.width ?? bounds.width)
    for (view, place) in zip(subviews, placed.places) {
      view.place(
        at: CGPoint(x: bounds.minX + place.origin.x, y: bounds.minY + place.origin.y),
        proposal: place.offer
      )
    }
  }

  /// Where a view goes, and what it is offered, measured and placed alike.
  private struct Place {
    let origin: CGPoint
    let offer: ProposedViewSize
  }

  /// Each view's place, in the views' order, and the size of the whole, `width` wide (the one
  /// line's width when none is offered). Fewer than three views are not placed.
  private func arrangement(
    of subviews: Subviews,
    width offered: CGFloat?
  ) -> (places: [Place], size: CGSize) {
    guard subviews.count >= 3 else { return ([], .zero) }
    let (nameView, pillView, gearView) = (subviews[0], subviews[1], subviews[2])
    let name = nameView.sizeThatFits(.unspecified)
    let pill = pillView.sizeThatFits(.unspecified)
    let gear = gearView.sizeThatFits(.unspecified)
    let oneLine = name.width + gap + pill.width + pillGap + gear.width
    let width = offered ?? oneLine
    let onOneLine = oneLine <= width + slack
    var places: [Place] = []
    let line: CGFloat
    var y: CGFloat
    if onOneLine {
      line = max(name.height, pill.height, gear.height)
      let pillX = width - gear.width - pillGap - pill.width
      places.append(Place(origin: CGPoint(x: 0, y: (line - name.height) / 2), offer: .unspecified))
      places.append(
        Place(origin: CGPoint(x: pillX, y: (line - pill.height) / 2), offer: .unspecified))
      y = line
    } else {
      let room = max(width - gap - gear.width, 0)
      let nameOffer =
        name.width <= room + slack
        ? ProposedViewSize.unspecified : ProposedViewSize(width: room, height: nil)
      let shown = nameView.sizeThatFits(nameOffer)
      line = max(shown.height, gear.height)
      let pillOffer = ProposedViewSize(width: width, height: nil)
      places.append(Place(origin: CGPoint(x: 0, y: (line - shown.height) / 2), offer: nameOffer))
      places.append(Place(origin: CGPoint(x: 0, y: line), offer: pillOffer))
      y = line + pillView.sizeThatFits(pillOffer).height
    }
    // The gear at the first line's trailing edge, on one line or two.
    places.append(
      Place(
        origin: CGPoint(x: width - gear.width, y: (line - gear.height) / 2), offer: .unspecified))
    let noteOffer = ProposedViewSize(width: width, height: nil)
    for note in subviews.dropFirst(3) {
      let size = note.sizeThatFits(noteOffer)
      places.append(
        Place(origin: CGPoint(x: onOneLine ? width - size.width : 0, y: y), offer: noteOffer))
      y += size.height
    }
    return (places, CGSize(width: width, height: y))
  }
}
