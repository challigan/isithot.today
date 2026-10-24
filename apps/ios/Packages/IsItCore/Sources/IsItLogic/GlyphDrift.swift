import Foundation
import IsItModel

/// The glyph's flakes drifting, as the website's do (`global.css`, `.glyph .drift`): down and a
/// little sideways as they fade, then back in from just above, twice, 1.6 s a time with CSS's
/// `ease-in-out`, ending on the glyph at rest: 3.2 s in all (iOS build spec, section 10.2: twice,
/// under 5 s). The app draws the drift layer (SnowKit's `Glyphs.layers`) at `pose(at:)`, the
/// seconds since the drift began. The website staggers its flakes; the app's are one layer, so
/// they move together.
public enum GlyphDrift {
  /// Where the drift layer is, in the glyph's own units (`viewBox`), and how opaque.
  public struct Pose: Sendable, Equatable {
    public let x: Double
    public let y: Double
    public let opacity: Double

    public init(x: Double, y: Double, opacity: Double) {
      self.x = x
      self.y = y
      self.opacity = opacity
    }

    /// The glyph as it is at rest, whole.
    public static let rest = Pose(x: 0, y: 0, opacity: 1)
  }

  /// The glyphs' size in their own units: 120 by 120 (`snowGlyphs.ts`). A pose's offsets are in
  /// these, so a glyph drawn `size` points wide moves `x * size / viewBox` points.
  public static let viewBox = 120.0
  /// One drift, seconds (CSS `animation: drift 1.6s ease-in-out 2`).
  public static let cycleSeconds = 1.6
  /// How many times the flakes drift.
  public static let cycles = 2
  /// The whole drift, seconds: from then on the glyph is at rest.
  public static var seconds: Double { cycleSeconds * Double(cycles) }

  /// The keyframes of one drift, as fractions of it (`@keyframes drift`): at rest; at 45% down
  /// 6 and right 3, faded out; at 46% up 4 and left 2, still faded; and at rest again by the end.
  static let keyframes: [(at: Double, pose: Pose)] = [
    (0, .rest),
    (0.45, Pose(x: 3, y: 6, opacity: 0)),
    (0.46, Pose(x: -2, y: -4, opacity: 0)),
    (1, .rest),
  ]

  /// The drift layer's pose `elapsed` seconds after the drift began: at rest before it and from
  /// `seconds` on. Between two keyframes it eases as CSS eases each one (`ease-in-out`).
  public static func pose(at elapsed: Double) -> Pose {
    guard elapsed > 0, elapsed < seconds else { return .rest }
    let t = elapsed.truncatingRemainder(dividingBy: cycleSeconds) / cycleSeconds
    let next = keyframes.firstIndex { $0.at > t } ?? keyframes.count - 1
    let from = keyframes[next - 1]
    let to = keyframes[next]
    let eased = easeInOut((t - from.at) / (to.at - from.at))
    func mix(_ a: Double, _ b: Double) -> Double { a + (b - a) * eased }
    return Pose(
      x: mix(from.pose.x, to.pose.x),
      y: mix(from.pose.y, to.pose.y),
      opacity: mix(from.pose.opacity, to.pose.opacity)
    )
  }

  /// CSS's `ease-in-out`, `cubic-bezier(0.42, 0, 0.58, 1)`: how far along the change is, 0 to 1,
  /// `progress` of the way through its time. The curve's time is found by bisection, which is
  /// exact enough for a frame after 40 halvings.
  static func easeInOut(_ progress: Double) -> Double {
    let x = Swift.min(1, Swift.max(0, progress))
    func bezier(_ t: Double, _ p1: Double, _ p2: Double) -> Double {
      let u = 1 - t
      return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t
    }
    var low = 0.0
    var high = 1.0
    for _ in 0..<40 {
      let middle = (low + high) / 2
      if bezier(middle, 0.42, 0.58) < x { low = middle } else { high = middle }
    }
    return bezier((low + high) / 2, 0, 1)
  }
}

/// When a page's glyph drifts (iOS build spec, sections 10.2 and 16): on its first paint and when
/// its band changes, never with Reduce Motion, and never in a test launched at a set moment
/// (`-now`), whose screens are compared still. The page keeps one for its glyph and asks it each
/// time the glyph is drawn for a band.
public struct GlyphMotion: Sendable, Equatable {
  /// The band the glyph was last drawn for; nil before its first paint, or while there was none.
  private var band: SnowBand?

  public init() {}

  /// The glyph is drawn for `band` (nil without one: no answer to show): whether its flakes drift
  /// now. `still` is Reduce Motion, or a test's still screens: then they never do, and a later
  /// drawing of the same band doesn't either.
  public mutating func drifts(_ band: SnowBand?, still: Bool) -> Bool {
    defer { self.band = band }
    guard let band, !still else { return false }
    return band != self.band
  }
}
