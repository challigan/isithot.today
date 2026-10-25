import IsItModel

/// Where the home screen's pager (IsItUI's `HomePager`) has come to rest: the view whose page is
/// under the middle of what it shows. Its pages lie side by side in `views`' order, each `width`
/// wide, `contentWidth` in all; `midX` is the middle of what the scroll view shows, along them
/// (its visible rect's, in its content's coordinates). Pulled past either end, the end page.
///
/// Nil, so the selection stays as it is, when there is nothing to follow: no width, no finite
/// middle, no pages, or content narrower than the pages side by side, as before they are laid
/// out, or a page's own vertical scroll view would be should its phases ever reach the pager's
/// (its content one page wide, its middle always over Now's).
public enum PagerRest {
  public static func view(
    midX: Double,
    width: Double,
    contentWidth: Double,
    views: [AppView]
  ) -> AppView? {
    // Half a point short of the pages' width allowed, as a width read back on a 3x screen may
    // round.
    guard width > 0, width.isFinite, let last = views.indices.last,
      contentWidth >= width * Double(views.count) - 0.5
    else { return nil }
    let place = (midX / width).rounded(.down)
    guard place.isFinite else { return nil }
    // Clamped before converting, so no finite but enormous value can trap `Int(_:)`.
    return views[Int(min(max(place, 0), Double(last)))]
  }
}
