import IsItLogic
import IsItModel
import SwiftUI

/// A page's glyph as the app gives it (SnowKit's `Glyphs`, which IsItUI doesn't link): the
/// whole template image, and for a glyph whose flakes drift, its still layer and its flakes.
public struct PageGlyph {
  public let band: SnowBand
  public let whole: Image
  public let still: Image?
  public let drift: Image?

  public init(band: SnowBand, whole: Image, layers: (still: Image, drift: Image)?) {
    self.band = band
    self.whole = whole
    still = layers?.still
    drift = layers?.drift
  }
}

/// The glyph, tinted by the page's ink (iOS build spec, section 10.2). Its flakes drift twice,
/// 3.2 s in all (`GlyphDrift`), on its first paint and when its band changes (`GlyphMotion`);
/// never with Reduce Motion, and never when `still` (a test's still screens). Decorative, as on
/// the website: VoiceOver skips it. Smart Invert inverts it with the page and the text, whose ink
/// it is drawn in: exempt alone, it would stay dark ink on the inverted, dark page
/// (Backgrounds.swift).
struct GlyphView: View {
  let glyph: PageGlyph
  let size: CGFloat
  let still: Bool

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var motion = GlyphMotion()
  /// When the drift began, while it runs.
  @State private var driftStart: Date?

  var body: some View {
    drawing
      .frame(width: size, height: size)
      // Its images are elements, which this removes: run 1's trees have no glyph. Hidden on a
      // view with no element of its own, as on a shape, it would make one (Backgrounds.swift).
      .accessibilityHidden(true)
      .onAppear { drawn() }
      .onChange(of: glyph.band) { drawn() }
      .onChange(of: reduceMotion) {
        if reduceMotion { driftStart = nil }
      }
      .task(id: driftStart) {
        guard driftStart != nil else { return }
        do {
          try await Task.sleep(nanoseconds: UInt64(GlyphDrift.seconds * 1_000_000_000))
        } catch {
          return
        }
        driftStart = nil
      }
  }

  /// The glyph whole, or its two layers with the flakes at the drift's pose for the frame.
  @ViewBuilder private var drawing: some View {
    if let still = glyph.still, let drift = glyph.drift {
      TimelineView(.animation(minimumInterval: nil, paused: driftStart == nil)) { context in
        let pose =
          driftStart.map { GlyphDrift.pose(at: context.date.timeIntervalSince($0)) }
          ?? GlyphDrift.Pose.rest
        let scale = Double(size) / GlyphDrift.viewBox
        ZStack {
          still
            .resizable()
            .scaledToFit()
          drift
            .resizable()
            .scaledToFit()
            .offset(x: CGFloat(pose.x * scale), y: CGFloat(pose.y * scale))
            .opacity(pose.opacity)
        }
      }
    } else {
      glyph.whole
        .resizable()
        .scaledToFit()
    }
  }

  /// The glyph has been drawn for its band: the drift starts when `GlyphMotion` says so.
  private func drawn() {
    if motion.drifts(glyph.band, still: still || reduceMotion) {
      driftStart = Date()
    }
  }
}
