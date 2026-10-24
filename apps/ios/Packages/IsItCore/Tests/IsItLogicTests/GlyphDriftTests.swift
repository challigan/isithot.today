import Foundation
import IsItLogic
import IsItModel
import Testing

/// `GlyphMotion` as a page keeps it, in a class so that `#expect` can ask it.
final class Glyph {
  private var motion = GlyphMotion()

  func drifts(_ band: SnowBand?, still: Bool) -> Bool {
    motion.drifts(band, still: still)
  }
}

/// The glyph's drift (iOS build spec, section 10.2), as the website's CSS has it: twice, under
/// 5 s in all, ending at rest; and when it starts.
@Suite("The glyph's drift")
struct GlyphDriftTests {
  /// Whether two poses are the same to a thousandth.
  func near(_ a: GlyphDrift.Pose, _ b: GlyphDrift.Pose) -> Bool {
    abs(a.x - b.x) < 0.001 && abs(a.y - b.y) < 0.001 && abs(a.opacity - b.opacity) < 0.001
  }

  @Test("twice, 1.6 s each, 3.2 s in all: under 5 s")
  func timing() {
    #expect(GlyphDrift.cycles == 2)
    #expect(GlyphDrift.cycleSeconds == 1.6)
    #expect(abs(GlyphDrift.seconds - 3.2) < 1e-9)
    #expect(GlyphDrift.seconds < 5)
    #expect(GlyphDrift.viewBox == 120)
  }

  @Test("at rest before, at the start, at the end of each drift and after")
  func rest() {
    for elapsed in [-1, 0, GlyphDrift.cycleSeconds, GlyphDrift.seconds, 3.5, 60] {
      #expect(near(GlyphDrift.pose(at: elapsed), .rest), "\(elapsed) s")
    }
    #expect(GlyphDrift.pose(at: 0) == .rest)
    #expect(GlyphDrift.pose(at: GlyphDrift.seconds) == .rest)
    // Just before the end it is almost back.
    let last = GlyphDrift.pose(at: GlyphDrift.seconds - 0.001)
    #expect(last.opacity > 0.99 && abs(last.x) < 0.01 && abs(last.y) < 0.01)
  }

  @Test("the website's keyframes: down and right as it fades, then in from above, twice")
  func keyframes() {
    let cycle = GlyphDrift.cycleSeconds
    for start in [0, cycle] {
      #expect(near(GlyphDrift.pose(at: start + 0.45 * cycle), .init(x: 3, y: 6, opacity: 0)))
      #expect(near(GlyphDrift.pose(at: start + 0.46 * cycle), .init(x: -2, y: -4, opacity: 0)))
      // Halfway to 45%, ease-in-out is halfway too: the curve is symmetric.
      #expect(
        near(GlyphDrift.pose(at: start + 0.225 * cycle), .init(x: 1.5, y: 3, opacity: 0.5)))
      // Easing in: slower than linear early on.
      let early = GlyphDrift.pose(at: start + 0.045 * cycle)
      #expect(early.y > 0 && early.y < 0.6)
      #expect(early.opacity < 1 && early.opacity > 0.9)
    }
  }

  @Test("down as it fades: the flakes only move one way, then back")
  func monotonic() {
    let cycle = GlyphDrift.cycleSeconds
    var last = GlyphDrift.pose(at: 0)
    for step in 1...45 {
      let pose = GlyphDrift.pose(at: Double(step) / 100 * cycle)
      #expect(pose.y >= last.y && pose.opacity <= last.opacity, "at \(step)%")
      last = pose
    }
    last = GlyphDrift.pose(at: 0.46 * cycle)
    for step in 47...99 {
      let pose = GlyphDrift.pose(at: Double(step) / 100 * cycle)
      #expect(pose.y >= last.y && pose.opacity >= last.opacity, "at \(step)%")
      last = pose
    }
  }

  @Test("it drifts on first paint and when the band changes, never when still")
  func when() {
    let motion = Glyph()
    #expect(motion.drifts(.snow, still: false))
    // Drawn again each minute: still.
    #expect(!motion.drifts(.snow, still: false))
    #expect(!motion.drifts(.snow, still: false))
    #expect(motion.drifts(.heavysnow, still: false))
    #expect(!motion.drifts(.heavysnow, still: false))
    // No glyph while checking a new place, then its own: a first paint again.
    #expect(!motion.drifts(nil, still: false))
    #expect(motion.drifts(.heavysnow, still: false))

    // Loading first, then the answer's glyph.
    let loading = Glyph()
    #expect(!loading.drifts(nil, still: false))
    #expect(loading.drifts(.flakes, still: false))

    // With Reduce Motion, or a test's still screens, never; nor later for the same band.
    let still = Glyph()
    #expect(!still.drifts(.snow, still: true))
    #expect(!still.drifts(.heavysnow, still: true))
    #expect(!still.drifts(.heavysnow, still: false))
    #expect(still.drifts(.snow, still: false))
  }
}
