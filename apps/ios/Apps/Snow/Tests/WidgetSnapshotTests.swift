import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItWidgetUI
import SnowKit
import SwiftUI
import UIKit
import WidgetKit
import XCTest

/// The widget in every family, band and state, drawn with `ImageRenderer` at 3x and attached to
/// the result bundle for the contact sheet (iOS build spec, sections 11.4 and 18.1): phase 7's
/// "every family × band × state". Each tile is the view the extension draws,
/// `ForecastWidgetView`, given its look as plain values (`WidgetLook`, as the entry view reads
/// them from WidgetKit's environment, which a test can't set), the snow topic's art, and a face
/// the real code plans and words (`WidgetPlanner`, `WidgetFace`). WidgetKit's own drawing isn't
/// here: `containerBackground` draws nothing outside a widget, so each tile draws its backdrop
/// itself, padded as WidgetKit's margins pad the Home Screen's families and clipped to the
/// widget's shape. The accented, StandBy and vibrant tiles are approximations: WidgetKit tints,
/// removes and maps what is drawn there, over a mid grey, black and a Lock Screen's dark grey
/// here. Review artefacts, not pixel comparisons: the checks are that each tile draws something
/// over its backdrop, at its family's size and 3x. The contrast gate is packages/mobile's
/// brandColours.ts, which judges the small and the medium at the sizes drawn here
/// (widgetSizes.test.ts).
final class WidgetSnapshotTests: XCTestCase {
  /// Where a tile is drawn, as WidgetKit draws a widget there, and the end of the tile's name.
  private enum Mode: String {
    /// The Home Screen in full colour: the palette behind, and its ink.
    case full
    /// A tinted or clear Home Screen: no palette, and white ink, which WidgetKit tints.
    case accented
    /// StandBy: full colour with the background removed, on black.
    case standby
    /// The Lock Screen, the only way iPhone draws its families: no palette, and white ink.
    case vibrant

    var fullColour: Bool { self == .full || self == .standby }
    var showsBackground: Bool { self == .full }

    var rendering: WidgetRenderingMode {
      switch self {
      case .full, .standby: .fullColor
      case .accented: .accented
      case .vibrant: .vibrant
      }
    }
  }

  /// A day re-banded for `testEveryBandInEveryFamily`: the answer the server gives its band, its
  /// amount in centimetres, and how many of the six forecasts expect snow.
  private struct Banded {
    let band: SnowBand
    let answer: String
    let amount: Double
    let snowy: Int
  }

  private static let banded = [
    Banded(band: .nosnow, answer: "No.", amount: 0, snowy: 0),
    Banded(band: .flakes, answer: "No.", amount: 0.2, snowy: 0),
    Banded(band: .maybesnow, answer: "Maybe.", amount: 0.5, snowy: 3),
    Banded(band: .snow, answer: "Yes.", amount: 4, snowy: 6),
    Banded(band: .heavysnow, answer: "Yes.", amount: 12, snowy: 6),
    Banded(band: .deepsnow, answer: "Yes.", amount: 25, snowy: 6),
  ]

  /// Real answers at real moments: each fixture as it was fetched, and durham-tomorrow six minutes
  /// before 6pm as well as after, when the widget moves on to tomorrow.
  private static let moments: [(name: String, fixture: String, early: TimeInterval)] = [
    ("aberdeen-snow", "aberdeen-snow", 0),
    ("leeds-dry", "leeds-dry", 0),
    ("reykjavik-mixed", "reykjavik-mixed", 0),
    ("shrewsbury-maybe", "shrewsbury-maybe", 0),
    ("denver-f", "denver-f", 0),
    ("limited", "limited", 0),
    ("no-now", "no-now", 0),
    ("no-week", "no-week", 0),
    ("durham-tomorrow-1759", "durham-tomorrow", 6 * 60),
    ("durham-tomorrow-1805", "durham-tomorrow", 0),
  ]

  /// The snow topic's glyphs and palettes, as the extension gives them.
  private static let art = WidgetArt(glyph: { Glyphs.image($0) }, palette: { Palettes.snow($0) })

  /// The margins WidgetKit gives the Home Screen families' content.
  private static let margin: CGFloat = 16
  private static let scale: CGFloat = 3

  /// Each of the six bands, durham-tomorrow's tomorrow re-banded and planned at 6:05pm: the small
  /// and the medium in full colour, accented and StandBy, and the Lock Screen's three in vibrant.
  @MainActor
  func testEveryBandInEveryFamily() throws {
    for day in Self.banded {
      let response = try durhamTomorrow(day)
      let face = try firstFace(response, at: response.updatedAt)
      XCTAssertEqual(face.band, day.band)
      XCTAssertEqual(face.answer, day.answer)
      for family in WidgetLook.Family.allCases {
        for mode in Self.modes(family) {
          try attach(face, as: "\(day.band.rawValue)-ok", in: family, mode)
        }
      }
    }
  }

  /// The locked and the stale face, in every family and each of its modes.
  @MainActor
  func testLockedAndStale() throws {
    for state in [WidgetEntry.State.locked, .stale] {
      let face = try firstFace(nil, at: Date(), unlocked: state == .stale)
      XCTAssertEqual(face.state, state)
      for family in WidgetLook.Family.allCases {
        for mode in Self.modes(family) {
          try attach(face, as: state.rawValue, in: family, mode)
        }
      }
    }
  }

  /// The real answers, small and medium, in full colour; and durham-tomorrow at 6:05pm in the
  /// Lock Screen's three as well, the inputs of the composed widget screenshot (phase 7.3).
  @MainActor
  func testFixtures() throws {
    for moment in Self.moments {
      let response = try TestFixtures.response(moment.fixture)
      let face = try firstFace(response, at: response.updatedAt.addingTimeInterval(-moment.early))
      XCTAssertEqual(face.state, .ok, moment.name)
      for family in [WidgetLook.Family.small, .medium] {
        try attach(face, as: moment.name, in: family, .full)
      }
    }
    let durham = try TestFixtures.response("durham-tomorrow")
    let tomorrow = try firstFace(durham, at: durham.updatedAt)
    for family in [WidgetLook.Family.circular, .rectangular, .inline] {
      try attach(tomorrow, as: "durham-tomorrow-1805", in: family, .vibrant)
    }
  }

  /// The small and the medium at AX3, an accessibility size, with snow and with none.
  @MainActor
  func testTextSizes() throws {
    for day in Self.banded where day.band == .snow || day.band == .nosnow {
      let response = try durhamTomorrow(day)
      let face = try firstFace(response, at: response.updatedAt)
      for family in [WidgetLook.Family.small, .medium] {
        try attach(
          face, as: "\(day.band.rawValue)-ok", in: family, .full, textSize: .accessibility3)
      }
    }
  }

  /// The gallery's sample, small and medium, and the placeholder: the sample as WidgetKit masks
  /// it while the widget loads.
  @MainActor
  func testGallery() throws {
    let sample = WidgetTimeline.sample(at: Date()).face
    XCTAssertEqual(sample, WidgetFace.sample)
    XCTAssertEqual(sample.state, .ok)
    try attach(sample, as: "gallery", in: .small, .full)
    try attach(sample, as: "gallery", in: .medium, .full)
    try attach(sample, as: "placeholder", in: .small, .full, redacted: true)
  }

  /// The snow medium with its right half a `Link` to the week, as the widget draws it, where
  /// every other tile has none: whether `ImageRenderer` draws the link's label, or the
  /// placeholder it draws for a view Core Animation composites (Apple, `ImageRenderer`).
  @MainActor
  func testTheMediumsLink() throws {
    let snow = try XCTUnwrap(Self.banded.first { $0.band == .snow })
    let response = try durhamTomorrow(snow)
    let face = try firstFace(response, at: response.updatedAt)
    try attach(face, as: "snow-ok", in: .medium, .full, interactive: true)
  }

  // MARK: - Private

  /// durham-tomorrow with its tomorrow (`snow.days[1]`), the day the widget shows from 6pm,
  /// re-banded in its JSON as the server words `day`'s band: its label, or for no snow its
  /// reason's, too warm.
  private func durhamTomorrow(_ day: Banded) throws -> TodayResponse {
    let url = try XCTUnwrap(
      Bundle(for: WidgetSnapshotTests.self).url(
        forResource: "durham-tomorrow",
        withExtension: "json",
        subdirectory: "Fixtures"
      ),
      "No Fixtures/durham-tomorrow.json in the test bundle"
    )
    let read = try JSONSerialization.jsonObject(with: Data(contentsOf: url))
    var json = try XCTUnwrap(read as? [String: Any])
    var snow = try XCTUnwrap(json["snow"] as? [String: Any])
    var days = try XCTUnwrap(snow["days"] as? [[String: Any]])
    let warm = day.band == .nosnow
    days[1]["band"] = day.band.rawValue
    days[1]["answer"] = day.answer
    days[1]["bandLabel"] = try XCTUnwrap(
      warm ? CoreCopy.snowReasonLabel(.warm) : CoreCopy.snowBandLabel(day.band))
    days[1]["reason"] = warm ? SnowReason.warm.rawValue as Any : NSNull()
    days[1]["amount"] = day.amount
    days[1]["snowy"] = day.snowy
    days[1]["total"] = 6
    snow["days"] = days
    json["snow"] = snow
    return try TodayResponse.decode(from: JSONSerialization.data(withJSONObject: json))
  }

  /// The face `response` shows at `now`, planned and worded by the widget's own code: the first
  /// entry, in the answer's unit. Without an answer, the stale face, or the locked one when not
  /// `unlocked`.
  private func firstFace(
    _ response: TodayResponse?,
    at now: Date,
    unlocked: Bool = true
  ) throws -> WidgetFace {
    let plan = WidgetPlanner.entries(
      response, fetchedAt: response?.updatedAt ?? now, now: now, unlocked: unlocked)
    let entry = try XCTUnwrap(plan.entries.first, "The planner planned nothing")
    return WidgetFace(entry, unit: response?.snow?.unit ?? .cm)
  }

  /// Draws `face` in `family` and `mode` and attaches it as `widget-<family>-<name>-<mode>`, with
  /// `-ax3` at that size and `-link` with the medium's link, in the contact sheet's alphabet, so
  /// the tiles sort by family. `redacted` masks it as WidgetKit's placeholder does.
  @MainActor
  private func attach(
    _ face: WidgetFace,
    as name: String,
    in family: WidgetLook.Family,
    _ mode: Mode,
    textSize: DynamicTypeSize = .large,
    interactive: Bool = false,
    redacted: Bool = false
  ) throws {
    let tile =
      "widget-\(family.rawValue)-\(name)-\(mode.rawValue)"
      + (textSize == .large ? "" : "-ax3") + (interactive ? "-link" : "")
    let look = WidgetLook(
      family: family, fullColour: mode.fullColour, showsBackground: mode.showsBackground,
      interactive: interactive)
    let widget = ForecastWidgetView(face: face, look: look, art: Self.art)
      .redacted(reason: redacted ? .placeholder : [])
      .padding(Self.onHomeScreen(family) ? Self.margin : 0)
    let image = try render(widget, in: family, mode, band: face.band, textSize: textSize)
    XCTAssertEqual(image.size, Self.size(family), tile)
    XCTAssertEqual(image.scale, Self.scale, tile)
    let png = try XCTUnwrap(image.pngData(), "No PNG for \(tile)")
    let backdrop = try render(Color.clear, in: family, mode, band: face.band, textSize: textSize)
    XCTAssertNotEqual(png, backdrop.pngData(), "\(tile) drew nothing over its backdrop")

    // PNG, as the contact sheet reads it.
    let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
    attachment.name = tile
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  /// `content` as a widget of `family` frames it: at its size, over `mode`'s backdrop in `band`'s
  /// palette, clipped to the widget's shape, in `mode`'s rendering mode and at `textSize`, drawn
  /// at 3x and proposed the family's size.
  @MainActor
  private func render<Content: View>(
    _ content: Content,
    in family: WidgetLook.Family,
    _ mode: Mode,
    band: SnowBand,
    textSize: DynamicTypeSize
  ) throws -> UIImage {
    let size = Self.size(family)
    let tile =
      content
      .frame(width: size.width, height: size.height)
      .background { Self.backdrop(mode, band: band) }
      .clipShape(Self.shape(family))
      .environment(\.widgetRenderingMode, mode.rendering)
      .environment(\.dynamicTypeSize, textSize)
    let renderer = ImageRenderer(content: tile)
    renderer.scale = Self.scale
    renderer.proposedSize = ProposedViewSize(size)
    return try XCTUnwrap(renderer.uiImage, "ImageRenderer drew nothing")
  }

  /// Each family's size in points, the HIG's for 430-wide iPhones: the small and the medium are
  /// brandColours.ts's `WIDGET_SIZES`, the rects the contrast gate judges, which
  /// widgetSizes.test.ts holds these to.
  private static func size(_ family: WidgetLook.Family) -> CGSize {
    switch family {
    case .small: CGSize(width: 170, height: 170)
    case .medium: CGSize(width: 364, height: 170)
    case .circular: CGSize(width: 76, height: 76)
    case .rectangular: CGSize(width: 172, height: 76)
    case .inline: CGSize(width: 257, height: 26)
    }
  }

  /// The Home Screen's families, which WidgetKit's margins pad; the Lock Screen's draw to their
  /// edges.
  private static func onHomeScreen(_ family: WidgetLook.Family) -> Bool {
    family == .small || family == .medium
  }

  /// The modes a family is drawn in: the Home Screen's in full colour, accented and StandBy, and
  /// the Lock Screen's in vibrant.
  private static func modes(_ family: WidgetLook.Family) -> [Mode] {
    onHomeScreen(family) ? [.full, .accented, .standby] : [.vibrant]
  }

  /// The widget's shape: the Home Screen's continuous corners, the circle, and the Lock Screen's
  /// small corners.
  @MainActor
  private static func shape(_ family: WidgetLook.Family) -> AnyShape {
    switch family {
    case .small, .medium: AnyShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    case .circular: AnyShape(Circle())
    case .rectangular, .inline: AnyShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
  }

  /// What a widget is drawn over in `mode`: the palette itself in full colour, as
  /// `containerBackground` would draw it; otherwise the glass, the night and the Lock Screen,
  /// approximated.
  @MainActor
  @ViewBuilder
  private static func backdrop(_ mode: Mode, band: SnowBand) -> some View {
    switch mode {
    case .full: PaletteBackground(palette: Palettes.snow(band))
    case .accented: Color(rgb: 0x8e8e93)
    case .standby: Color.black
    case .vibrant: Color(rgb: 0x1c1c1e)
    }
  }
}
