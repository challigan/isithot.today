import XCTest

// The UI tests' contrast proof (DECISIONS, "Contrast by measured pixels, after #34's first full
// run"): where Apple's contrast check fails a text element, the test judges it by WCAG on the
// screenshot's own pixels instead, on every audited screen. On PR #34's first full macOS run
// every failure of the UI tests was that check failing Bricolage text whose pixels measure 8.8
// to 14.4:1 (the picker's Close, "Use my location", its rows, its title and its lines; the home's
// "Want the full picture?" and a verdict; How it works' title, 7.37:1), where the same kinds of
// text in the system font had passed on main. The issue is allowed only when the pixels prove
// the element is text drawn in its surface's own colours over its surface's own fills, giving
// 4.5:1 or more (`DrawnText`); every other issue, and every other kind, still fails.
//
// The surfaces come from one source: packages/mobile brandColours.ts `SURFACES`, written into
// `Generated/Surfaces.json` by `pnpm mobile:generate` with every band's palette, the background
// models' numbers and the colours TypeScript worked out at sample points, which this model
// reproduces before it judges a pixel (`SurfaceFile.bundled`).

/// Which of the app's three surfaces a screen is drawn on, and in which band's palette: a page of
/// the home screen in its band, the place picker in the band of the page it opened over, or
/// content (Settings and every page it opens), whose palette is fixed. Each test knows its own:
/// the page's band from `HomeScreens.json`, nil for a page with none, which draws as the file's
/// `unknownBand`.
enum ScreenSurface: CustomStringConvertible {
  case page(band: String?)
  case sheet(band: String?)
  case content

  /// Its surface's name in `Surfaces.json`.
  var name: String {
    switch self {
    case .page: "page"
    case .sheet: "sheet"
    case .content: "content"
    }
  }

  var description: String {
    switch self {
    case .page(let band): "the page in \(band ?? "no band")"
    case .sheet(let band): "the sheet in \(band ?? "no band")"
    case .content: "content"
    }
  }
}

/// `Generated/Surfaces.json`, as packages/mobile brandColours.ts `surfacesJson` writes it.
struct SurfaceFile: Decodable {
  /// The screen TypeScript sampled the surfaces on, in points.
  struct Screen: Decodable {
    let width: Double
    let height: Double
  }

  /// The backgrounds' numbers (brandColours.ts `BACKGROUND_MODEL`), each a fraction of the
  /// window: the gradient's line from `from` to `to`; the page's glow, centred at `glowCentre`
  /// and gone at `glowReach` of the way to the farthest corner; and how much g2 the sheet takes
  /// at its end.
  struct Background: Decodable {
    let from: [Double]
    let to: [Double]
    let glowCentre: [Double]
    let glowReach: Double
    let sheetEnd: Double
  }

  /// A band's colours, each `#rrggbb`, and its glow's opacity at the centre, 0 to 1.
  struct Palette: Decodable {
    let g1: String
    let g2: String
    let g3: String
    let glow: Double
    let ink: String
    let pill: String
  }

  /// A flat fill: `colour` ("ink", "pill" or `#rrggbb`) at `share` over `over`.
  struct Fill: Decodable {
    let name: String
    let colour: String
    let share: Double
    let over: String
  }

  /// The ink at `share` over each fill named in `on`.
  struct Ink: Decodable {
    let name: String
    let share: Double
    let on: [String]
  }

  /// A surface: its background's model ("page" or "sheet"), its fixed band (content's), its
  /// fills, the colours its text is drawn in, and the lines a button of it draws.
  struct Surface: Decodable {
    let background: String
    let band: String?
    let fills: [Fill]
    let texts: [Ink]
    let marks: [Ink]
  }

  /// Every colour a surface lays at a point, as TypeScript worked it out, each `#rrggbb`, keyed
  /// by fill, or `<ink>/<fill>`.
  struct Sample: Decodable {
    let surface: String
    let band: String
    let x: Double
    let y: Double
    let fills: [String: String]
    let texts: [String: String]
    let marks: [String: String]
  }

  let screen: Screen
  let background: Background
  /// The least contrast allowed: WCAG AA for body text, 4.5:1, for every text.
  let minimum: Double
  /// The band a page with none draws as.
  let unknownBand: String
  let palettes: [String: Palette]
  let surfaces: [String: Surface]
  let samples: [Sample]

  /// The file from the UI test bundle, once this model has worked out every sample as
  /// TypeScript did; throws, with each that differs, when it hasn't, so the proof never judges
  /// pixels by a model that isn't brandColours.ts's.
  static func bundled() throws -> SurfaceFile {
    guard
      let url = Bundle(for: SurfaceToken.self).url(forResource: "Surfaces", withExtension: "json")
    else { throw HomeScreenError("The UI tests have no Surfaces.json") }
    let file = try JSONDecoder().decode(SurfaceFile.self, from: Data(contentsOf: url))
    let wrong = file.mismatches()
    guard wrong.isEmpty else {
      throw HomeScreenError(
        "The UI tests' surfaces don't work out as brandColours.ts's: "
          + wrong.joined(separator: "; "))
    }
    return file
  }

  /// The colours `surface` is drawn in, on a window at `window`; throws for a band or surface
  /// the file hasn't, or a colour it can't read.
  func colours(_ surface: ScreenSurface, window: CGRect) throws -> SurfaceColours {
    guard let model = surfaces[surface.name] else {
      throw HomeScreenError("Surfaces.json has no surface \(surface.name)")
    }
    let band: String
    switch surface {
    case .page(let shown), .sheet(let shown): band = shown ?? unknownBand
    case .content: band = model.band ?? unknownBand
    }
    guard let palette = palettes[band] else {
      throw HomeScreenError("Surfaces.json has no palette for \(band)")
    }
    return try SurfaceColours(
      surface.name, model, palette, background: background, window: window, minimum: minimum)
  }

  /// Each sample this model works out otherwise than TypeScript did, as "where: what".
  func mismatches() -> [String] {
    let window = CGRect(x: 0, y: 0, width: screen.width, height: screen.height)
    var wrong: [String] = []
    for sample in samples {
      let at = "\(sample.surface) in \(sample.band) at (\(sample.x), \(sample.y))"
      guard let model = surfaces[sample.surface], let palette = palettes[sample.band],
        let colours = try? SurfaceColours(
          sample.surface, model, palette, background: background, window: window,
          minimum: minimum)
      else {
        wrong.append("\(at): can't be worked out")
        continue
      }
      let laid = colours.laid(at: CGPoint(x: sample.x, y: sample.y))
      let found = [laid.fills, laid.texts, laid.marks].map { layers in
        Dictionary(layers.map { ($0.key, $0.colour.description) }) { first, _ in first }
      }
      for (expected, worked) in zip([sample.fills, sample.texts, sample.marks], found)
      where expected != worked {
        wrong.append("\(at): \(worked), where TypeScript has \(expected)")
      }
    }
    return wrong
  }
}

private final class SurfaceToken {}

/// One surface's colours on one screen, read once from `Surfaces.json`: its fills, text colours
/// and marks in its palette, and its background's model on the window at `window`.
struct SurfaceColours {
  /// A colour laid: its kind's name ("background", "ink", "border"), its key in the file
  /// ("soft/wash"), and the colour.
  struct Layer {
    let name: String
    let key: String
    let colour: RGB
  }

  /// Everything a surface lays at one point.
  struct Laid {
    let fills: [Layer]
    let texts: [Layer]
    let marks: [Layer]
  }

  /// "page", "sheet" or "content".
  let name: String
  let window: CGRect
  /// The least contrast its text must give.
  let minimum: Double
  private let model: SurfaceFile.Surface
  private let background: SurfaceFile.Background
  private let g1: RGB
  private let g2: RGB
  private let g3: RGB
  private let glow: Double
  let ink: RGB
  private let pill: RGB
  /// Each fill's fixed colour, or nil for the palette's ink or pill.
  private let fillColours: [RGB?]

  init(
    _ name: String,
    _ model: SurfaceFile.Surface,
    _ palette: SurfaceFile.Palette,
    background: SurfaceFile.Background,
    window: CGRect,
    minimum: Double
  ) throws {
    func colour(_ hex: String) throws -> RGB {
      guard let rgb = RGB(hex: hex) else { throw HomeScreenError("Not a #rrggbb colour: \(hex)") }
      return rgb
    }
    guard background.from.count == 2, background.to.count == 2, background.glowCentre.count == 2
    else { throw HomeScreenError("Surfaces.json's background has no point where it needs one") }
    var laid = ["background"]
    var fillColours: [RGB?] = []
    for fill in model.fills {
      guard laid.contains(fill.over) else {
        throw HomeScreenError("\(name)'s \(fill.name) is over \(fill.over), not laid before it")
      }
      fillColours.append(
        fill.colour == "ink" || fill.colour == "pill" ? nil : try colour(fill.colour))
      laid.append(fill.name)
    }
    for ink in model.texts + model.marks {
      for fill in ink.on where !laid.contains(fill) {
        throw HomeScreenError("\(name)'s \(ink.name) is on \(fill), which it doesn't lay")
      }
    }
    self.name = name
    self.model = model
    self.background = background
    self.window = window
    self.minimum = minimum
    g1 = try colour(palette.g1)
    g2 = try colour(palette.g2)
    g3 = try colour(palette.g3)
    glow = palette.glow
    ink = try colour(palette.ink)
    pill = try colour(palette.pill)
    self.fillColours = fillColours
  }

  /// Whether the ink is the light one, white on the dark bands.
  var lightInk: Bool { ink.luminance > 0.5 }

  /// The background at `point` on screen, as `PageBackground` or `SheetBackground` draws it over
  /// the window, worked out as brandColours.ts `pageAt` and `sheetAt` do, operation for
  /// operation, so each mix rounds the same way.
  func background(at point: CGPoint) -> RGB {
    let (width, height) = (Double(window.width), Double(window.height))
    let (x, y) = (Double(point.x - window.minX), Double(point.y - window.minY))
    let (x0, y0) = (background.from[0] * width, background.from[1] * height)
    let dx = (background.to[0] - background.from[0]) * width
    let dy = (background.to[1] - background.from[1]) * height
    let along = min(max(((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy), 0), 1)
    guard model.background == "page" else {
      return pill.mixed(with: pill.mixed(with: g2, by: background.sheetEnd), by: along)
    }
    let base = g1.mixed(with: g2, by: along)
    let (cx, cy) = (background.glowCentre[0] * width, background.glowCentre[1] * height)
    let (across, down) = (max(cx, width - cx), max(cy, height - cy))
    let radius = (across * across + down * down).squareRoot() * background.glowReach
    let fade = max(0, 1 - ((x - cx) * (x - cx) + (y - cy) * (y - cy)).squareRoot() / radius)
    return base.mixed(with: g3, by: glow * fade)
  }

  /// Everything the surface lays at `point` on screen.
  func laid(at point: CGPoint) -> Laid {
    laid(over: background(at: point))
  }

  /// Everything the surface lays where its background is `under`: each fill is its colour at
  /// its share over the background or a fill before it, and each text colour and mark the ink at
  /// its share over each fill it may sit on, as brandColours.ts `surfaceAt` lays them.
  func laid(over under: RGB) -> Laid {
    var fills = [Layer(name: "background", key: "background", colour: under)]
    for (fill, fixed) in zip(model.fills, fillColours) {
      let below = fills.first { $0.name == fill.over }?.colour ?? under
      let top = fixed ?? (fill.colour == "ink" ? ink : pill)
      fills.append(
        Layer(name: fill.name, key: fill.name, colour: below.mixed(with: top, by: fill.share)))
    }
    func inks(_ list: [SurfaceFile.Ink]) -> [Layer] {
      list.flatMap { each in
        each.on.compactMap { name in
          fills.first { $0.name == name }.map { fill in
            Layer(
              name: each.name, key: "\(each.name)/\(name)",
              colour: fill.colour.mixed(with: ink, by: each.share))
          }
        }
      }
    }
    return Laid(fills: fills, texts: inks(model.texts), marks: inks(model.marks))
  }

  /// "the content's ink #ffffff on about #763e8e, its background, at its centre, 7.37:1", for an
  /// element at `frame`.
  func expected(in frame: CGRect) -> String {
    let background = background(at: CGPoint(x: frame.midX, y: frame.midY))
    return "the \(name)'s ink \(ink) on about \(background), its background, at its centre, "
      + ratio(ink.contrast(with: background))
  }
}

/// What a screenshot shows inside a text element's frame, judged by WCAG against its surface's
/// own colours, and whether that proves the text gives 4.5:1 or more wherever it is.
///
/// Each pixel is, by the surface's model at its own point: one of its **fills** (within 6 levels
/// a channel: the background, a chip, a card, the wash, the field); one of its **text** colours
/// (within 3: its ink, or soft, the ink at 85% on a flat fill); for a button or link, one of the
/// **marks** it draws (within 3: its edge, a hairline, a chevron); an **edge**, a blend of two of
/// those colours (within 6 of the line between them) with a pixel of each within 2 pixels, in the
/// frame or the point round it read with it, as a glyph's anti-aliasing is; or **other**: none of
/// them. It proves when its frame is whole on the screen and at least a short line's size (10 by
/// 10 points); the text colours are on 1% of its pixels or more; other pixels are no more than
/// 0.5% of them, nor 2% of the text colours' pixels; and each text colour drawn on 9 pixels or
/// more gives `minimum` or more with each fill shown clear of what is drawn on it (no pixel but a
/// fill's within 2) on 1% of the frame or more, measured on the pixels: the text pixel nearest the
/// fill in luminance against the fill pixel nearest the text.
///
/// So it refuses an element whose text is dimmed, greyed, in another colour or over a fill the
/// surface hasn't (other pixels over 0.5% of the frame or 2% of its text), one with no text drawn,
/// a frame empty, tiny or off the screen, and a palette short of contrast. Only the tokens' text
/// colours, ink and soft, are measured; and as pixels are classed by colour alone, text drawn in
/// exactly one of the surface's own fill or line colours (the wash, the field, a chip, the card,
/// the track, an edge or a hairline) is taken for that fill or line, and isn't measured. On PR
/// #34's first full run, all 28 contrast issues proved (the text on 2.5 to 25.6% of their pixels,
/// other pixels 0.03% of them and 0.18% of their text's at the most, 5.55:1 at the least); and the
/// same pixels dimmed to 50, 60 or 70%, in a lighter grey, over another fill, with no ink, or on
/// another band, a dimmed copy of a row's words, or of a few letters of them, beside them, a few
/// of its letters dimmed in place, and the website's ink-at-10% Retry fill on maybesnow, 4.03:1
/// where it was drawn, all failed it (the Linux harness's checks).
struct DrawnText: CustomStringConvertible {
  /// The smallest frame that holds a line of the smallest text the app draws (12.8 points at
  /// Large), each way, in points.
  static let smallest: CGFloat = 10
  /// The least share of the frame's pixels in a text colour: "Use my location", a row 370 points
  /// wide, has its words and icon on 2.5%.
  static let leastText = 0.01
  /// The most other pixels: the run's 28 issues had 0.03% at the most, and a dimmed copy of "Use
  /// my location"'s words beside them made 3.17%.
  static let mostOther = 0.005
  /// The most other pixels as a share of the text colours' pixels, as the frame's share alone
  /// lets a sparse frame through: "Use my location" has its words on 2.5% of its row, so 0.5% of
  /// it is a sixth of its words. On PR #34's first full run the 28 issues had other pixels at no
  /// more than 0.18% of their text pixels, while one letter's width of "Use my location" dimmed
  /// to 50% in place made 5 to 6%.
  static let mostOtherOfText = 0.02
  /// How near a fill a pixel is to be that fill, and a blend to the line between two colours, in
  /// levels a channel: the background models land within 2 of the screenshot's gradients.
  static let fillLevels = 6
  /// How near a text colour or a mark a pixel is to be it.
  static let inkLevels = 3
  /// How far, in pixels, a blend's two colours or a fill's clear space reach.
  static let reach = 2

  /// Each fill's, text colour's and mark's share of the frame's pixels, by name, in the order
  /// the surface lays them; then the edges' and the others'.
  private(set) var fills: [(name: String, share: Double)] = []
  private(set) var texts: [(name: String, share: Double)] = []
  private(set) var marks: [(name: String, share: Double)] = []
  private(set) var edges = 0.0
  private(set) var others = 0.0
  /// The text colours' share of the frame's pixels.
  private(set) var textShare = 0.0
  /// The least contrast of a text colour drawn with a fill shown clear of it, and which pair.
  private(set) var least: (ratio: Double, text: String, fill: String)?
  /// Why the pixels don't prove the text; nil when they do.
  private(set) var refusal: String?

  /// Whether the pixels prove the frame holds text in its surface's own colours, giving the
  /// surface's minimum contrast or more wherever it is.
  var proves: Bool { refusal == nil }

  /// Of `pixels`, the screenshot inside `frame` and up to a point round it (nil: it can't be
  /// read), on `surface`; `withMarks` for a button or link, whose own edge or chevron may be in
  /// its frame. The pixels round the frame (`margin`) are only neighbours, for a blend at the
  /// frame's edge whose second colour lies just outside it, as Close's pill fills its frame and
  /// its edge meets the sheet there (without them, 0.42% of Close's pixels on PR #34's first full
  /// run were none of the sheet's colours): only the frame's own pixels are counted and
  /// measured.
  init(_ pixels: ScreenPixels?, in frame: CGRect, on surface: SurfaceColours, withMarks: Bool) {
    guard !frame.isNull, frame.width >= Self.smallest, frame.height >= Self.smallest else {
      let size = frame.isNull ? "none" : "\(frame.width) by \(frame.height) points"
      refusal =
        "its frame, \(size), is smaller than a line of text (\(Self.smallest) by "
        + "\(Self.smallest) points at the least)"
      return
    }
    guard surface.window.insetBy(dx: -0.5, dy: -0.5).contains(frame) else {
      refusal = "its frame isn't whole on the screen, the window at \(surface.window)"
      return
    }
    guard let pixels, pixels.width > 0, pixels.height > 0,
      pixels.rgba.count >= pixels.width * pixels.height * 4
    else {
      refusal = "the screenshot can't be read there"
      return
    }
    judge(pixels, frame: frame, on: surface, withMarks: withMarks)
  }

  /// How far round an element's frame to read the screenshot for its proof: a point, three
  /// pixels on a 3x screen, more than `reach`.
  static let margin: CGFloat = 1

  /// The frame to read the screenshot in for an element at `frame`: `margin` round it.
  static func reading(_ frame: CGRect) -> CGRect {
    frame.isNull ? frame : frame.insetBy(dx: -margin, dy: -margin)
  }

  /// What a pixel can be: a fill, a text colour or a mark.
  private enum Role {
    case fill
    case text
    case mark
  }

  /// The darkest and lightest pixels of a kind, by luminance, and how many there are.
  private struct Extremes {
    var count = 0
    var darkest: (colour: RGB, luminance: Double)?
    var lightest: (colour: RGB, luminance: Double)?

    mutating func add(_ pixel: RGB) {
      count += 1
      let luminance = pixel.luminance
      if darkest == nil || luminance < darkest!.luminance { darkest = (pixel, luminance) }
      if lightest == nil || luminance > lightest!.luminance { lightest = (pixel, luminance) }
    }
  }

  /// The kind of `pixel` where the surface lays `laid`: the first fill it is within
  /// `fillLevels` of, else the first text colour, else the first mark, within `inkLevels`; -1
  /// for none. Loops, not closures, as it runs on every pixel.
  private static func kind(
    of pixel: RGB,
    in laid: SurfaceColours.Laid,
    fills: [Int],
    texts: [Int],
    marks: [Int]
  ) -> Int {
    for i in fills.indices where pixel.within(fillLevels, of: laid.fills[i].colour) {
      return fills[i]
    }
    for i in texts.indices where pixel.within(inkLevels, of: laid.texts[i].colour) {
      return texts[i]
    }
    for i in marks.indices where pixel.within(inkLevels, of: laid.marks[i].colour) {
      return marks[i]
    }
    return -1
  }

  private mutating func judge(
    _ pixels: ScreenPixels,
    frame: CGRect,
    on surface: SurfaceColours,
    withMarks: Bool
  ) {
    let (width, height) = (pixels.width, pixels.height)
    // The pixels whose centres are inside the frame, the only ones counted.
    let columns = (0..<width).map { frame.minX...frame.maxX ~= pixels.point($0, 0).x }
    let rows = (0..<height).map { frame.minY...frame.maxY ~= pixels.point(0, $0).y }
    let inside = { (at: Int) in columns[at % width] && rows[at / width] }
    let total = columns.filter { $0 }.count * rows.filter { $0 }.count
    guard total > 0 else {
      refusal = "the screenshot can't be read there"
      return
    }
    // The kinds, by role and name, in the order the surface lays them; and each layer's kind, by
    // its place among the layers, which is the same wherever the surface lays them.
    let sample = surface.laid(at: pixels.point(0, 0))
    var kinds: [(role: Role, name: String)] = []
    func indexes(of layers: [SurfaceColours.Layer], as role: Role) -> [Int] {
      layers.map { layer in
        if let found = kinds.firstIndex(where: { $0.role == role && $0.name == layer.name }) {
          return found
        }
        kinds.append((role, layer.name))
        return kinds.count - 1
      }
    }
    let fillKinds = indexes(of: sample.fills, as: .fill)
    let textKinds = indexes(of: sample.texts, as: .text)
    let markKinds = withMarks ? indexes(of: sample.marks, as: .mark) : []
    // Each pixel's kind, or -1 for none of them. The surface's colours at a pixel follow from
    // its background alone, which neighbours mostly share, so they are worked out again only
    // where it changes: a UI test's build is unoptimised, and a frame can be 400,000 pixels.
    var part = [Int](repeating: -1, count: width * height)
    var unmatched: [Int] = []
    var under = surface.background(at: pixels.point(0, 0))
    var laid = surface.laid(over: under)
    for y in 0..<height {
      for x in 0..<width {
        let background = surface.background(at: pixels.point(x, y))
        if background != under {
          under = background
          laid = surface.laid(over: under)
        }
        let at = y * width + x
        part[at] = Self.kind(
          of: pixels.pixel(x, y), in: laid, fills: fillKinds, texts: textKinds, marks: markKinds)
        if part[at] < 0 { unmatched.append(at) }
      }
    }
    // A pixel of none inside the frame is an edge when it blends two colours laid there whose
    // kinds both have a pixel within reach, as a glyph's anti-aliasing blends its ink with the
    // fill beside it; other when it doesn't.
    var edgeCount = 0
    var otherCount = 0
    for at in unmatched where inside(at) {
      let (x, y) = (at % width, at / width)
      var near = Set<Int>()
      for ny in max(0, y - Self.reach)...min(height - 1, y + Self.reach) {
        for nx in max(0, x - Self.reach)...min(width - 1, x + Self.reach) {
          let kind = part[ny * width + nx]
          if kind >= 0 { near.insert(kind) }
        }
      }
      let there = surface.laid(at: pixels.point(x, y))
      let layers =
        Array(zip(fillKinds, there.fills.map(\.colour)))
        + Array(zip(textKinds, there.texts.map(\.colour)))
        + Array(zip(markKinds, there.marks.map(\.colour)))
      let pixel = pixels.pixel(x, y)
      var blend = false
      search: for (i, a) in layers.enumerated() where near.contains(a.0) {
        for b in layers[(i + 1)...] where b.0 != a.0 && near.contains(b.0) {
          if pixel.between(a.1, b.1, within: Self.fillLevels) {
            blend = true
            break search
          }
        }
      }
      if blend { edgeCount += 1 } else { otherCount += 1 }
    }
    // A fill pixel is clear when nothing but fills is within reach: the fill as drawn, not a
    // glyph's fringe that lands within its levels.
    let isFill = part.map { $0 >= 0 && kinds[$0].role == .fill }
    var across = [Bool](repeating: false, count: part.count)
    for at in part.indices where !isFill[at] {
      let (x, y) = (at % width, at / width)
      for nx in max(0, x - Self.reach)...min(width - 1, x + Self.reach) {
        across[y * width + nx] = true
      }
    }
    var crowded = [Bool](repeating: false, count: part.count)
    for at in part.indices where across[at] {
      let (x, y) = (at % width, at / width)
      for ny in max(0, y - Self.reach)...min(height - 1, y + Self.reach) {
        crowded[ny * width + x] = true
      }
    }
    var counts = [Int](repeating: 0, count: kinds.count)
    var extremes = [Extremes](repeating: Extremes(), count: kinds.count)
    for at in part.indices where part[at] >= 0 && inside(at) {
      let kind = part[at]
      counts[kind] += 1
      if kinds[kind].role == .text || (kinds[kind].role == .fill && !crowded[at]) {
        extremes[kind].add(pixels.pixel(at % width, at / width))
      }
    }
    func shares(_ role: Role) -> [(name: String, share: Double)] {
      kinds.indices.filter { kinds[$0].role == role }.map {
        (kinds[$0].name, Double(counts[$0]) / Double(total))
      }
    }
    fills = shares(.fill)
    texts = shares(.text)
    marks = shares(.mark)
    edges = Double(edgeCount) / Double(total)
    others = Double(otherCount) / Double(total)
    textShare = texts.reduce(0) { $0 + $1.share }
    // Each text colour drawn, 9 pixels (a point) or more, against each fill shown clear of what
    // is drawn on it on 1% of the frame or more, from their pixels.
    for t in kinds.indices where kinds[t].role == .text && extremes[t].count >= 9 {
      for f in kinds.indices where kinds[f].role == .fill {
        guard Double(extremes[f].count) >= Double(total) * 0.01,
          let textDark = extremes[t].darkest, let textLight = extremes[t].lightest,
          let fillDark = extremes[f].darkest, let fillLight = extremes[f].lightest
        else { continue }
        let worst =
          textLight.luminance > fillLight.luminance
          ? textDark.colour.contrast(with: fillLight.colour)
          : textLight.colour.contrast(with: fillDark.colour)
        if least.map({ worst < $0.ratio }) ?? true {
          least = (worst, kinds[t].name, kinds[f].name)
        }
      }
    }
    refusal = refusal(minimum: surface.minimum)
  }

  /// Why the shares and contrast don't prove the text, or nil.
  private func refusal(minimum: Double) -> String? {
    if textShare < Self.leastText {
      return "its surface's text colours are on \(percent(textShare)) of its pixels, under "
        + "\(percent(Self.leastText)): no text is drawn in them"
    }
    if others > Self.mostOther || others > Self.mostOtherOfText * textShare {
      return "\(percent(others, places: 2)) of its pixels are none of its surface's colours, "
        + "nor a blend of two beside them: over \(percent(Self.mostOther, places: 2)) of its "
        + "frame or \(percent(Self.mostOtherOfText)) of its text"
    }
    guard let least else { return "none of its surface's fills shows clear of what is on it" }
    if least.ratio < minimum {
      return "its \(least.text) on the \(least.fill) gives \(ratio(least.ratio)), under "
        + ratio(minimum)
    }
    return nil
  }

  var description: String {
    guard !fills.isEmpty else { return "the text drawn isn't proven: \(refusal ?? "unread")" }
    func list(_ shares: [(name: String, share: Double)]) -> String {
      let drawn = shares.filter { $0.share > 0 }
      return drawn.isEmpty
        ? "none" : drawn.map { "\($0.name) \(percent($0.share))" }.joined(separator: ", ")
    }
    var text = "its pixels: text in \(list(texts)); fills \(list(fills))"
    if !marks.isEmpty { text += "; marks \(list(marks))" }
    text += "; edges \(percent(edges)); none of its colours \(percent(others, places: 2))"
    if let least {
      text += "; the least, its \(least.text) on the \(least.fill), \(ratio(least.ratio))"
    }
    return text + (refusal.map { "; not proven: \($0)" } ?? "; proven")
  }
}

/// A share as a failure says it: "2.5%", or to `places` decimals.
func percent(_ share: Double, places: Int = 1) -> String {
  String(format: "%.\(places)f%%", share * 100)
}

/// The contrast issue every audit allows, on every screen (DECISIONS, "Contrast by measured
/// pixels, after #34's first full run"): one on a text element, a static text or a button or link
/// with a label, whose screenshot's pixels prove it is text drawn in its surface's own colours over
/// its own fills at 4.5:1 or more (`DrawnText`). No other kind is: hit regions, Dynamic Type,
/// clipped text, descriptions, traits and element detection still fail.
enum MeasuredContrast {
  /// Whether `element` is text: a static text, or a button or link with a label, icons included
  /// (the gear, the stars, clear-search), each held to 4.5:1.
  static func isText(_ element: AuditedElement) -> Bool {
    guard let type = element.type, !element.label.isEmpty else { return false }
    return [.staticText, .button, .link].contains(type)
  }

  /// Whether a button or link, which may draw its own edge or chevron in its frame.
  static func drawsMarks(_ type: XCUIElement.ElementType?) -> Bool {
    type == .button || type == .link
  }

  /// Whether the audit's contrast issue on `element` is allowed: text, with the proof.
  static func allows(_ element: AuditedElement) -> Bool {
    isText(element) && element.drawn?.proves == true
  }

  static let why =
    "text drawn in its surface's own colours over its own fills, which the screenshot's pixels "
    + "show giving 4.5:1 or more by WCAG: Apple's check failed such Bricolage text, measured at "
    + "7.37:1 to 14.4:1, on every screen of PR #34's first full macOS run, where the same kinds "
    + "of text in the system font had passed on main"
}
