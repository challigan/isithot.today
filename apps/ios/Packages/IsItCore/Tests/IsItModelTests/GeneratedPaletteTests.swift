import Foundation
import IsItModel
import Testing

/// The band palettes pnpm mobile:generate writes into IsItModel (iOS build spec, sections 10.1
/// and 16), checked on Linux as the app's `PaletteTests` checks them on iOS: every band's ink
/// meets WCAG AA for body text on both ends of its gradient, and the ratios the generator wrote
/// are what the colours give. With them, the content palette and the shares the app's surfaces
/// mix them by (`BrandColours.swift`), whose every pair packages/mobile's brandColours.test.ts
/// measures on every band.
@Suite("Palettes: the bands' colours")
struct GeneratedPaletteTests {
  @Test(
    "every ink meets AA for body text on both ends of its gradient", arguments: SnowBand.allCases)
  func bodyText(_ band: SnowBand) {
    let palette = Palettes.snow(band)
    #expect(palette.inkOnG1 >= 4.5)
    #expect(palette.inkOnG2 >= 4.5)
    #expect(contrast(palette.ink, palette.g1) >= 4.5)
    #expect(contrast(palette.ink, palette.g2) >= 4.5)
  }

  @Test("the ratios written are the colours' own, rounded down", arguments: SnowBand.allCases)
  func ratios(_ band: SnowBand) {
    let palette = Palettes.snow(band)
    for (ratio, written) in [
      (contrast(palette.ink, palette.g1), palette.inkOnG1),
      (contrast(palette.ink, palette.g2), palette.inkOnG2),
    ] {
      #expect(written <= ratio + 1e-9)
      #expect(ratio - written < 0.01)
    }
  }

  @Test("a band the app doesn't know draws as nosnow")
  func unknown() {
    #expect(Palettes.snow(.unknown) == Palettes.snow(.nosnow))
    #expect(Palettes.snow(.snow) == Palettes.Snow.snow)
    #expect(Palettes.snow(.nosnow).ink == 0x341a3c)
  }
}

@Suite("Brand colours: the content palette and the surfaces' shares")
struct GeneratedBrandColourTests {
  @Test("the app's own pages wear snow's palette, the website's content pages'")
  func content() {
    #expect(Palettes.content == Palettes.Snow.snow)
    #expect(Palettes.content.ink == 0xffffff)
  }

  @Test("the content card is the pill a quarter of the way to black, opaque, under ink at AA")
  func card() {
    let pill = Palettes.content.pill
    let toBlack = [pill >> 16, pill >> 8, pill].map { channel -> UInt32 in
      UInt32((Double(channel & 0xff) * (1 - BrandShares.card)).rounded())
    }
    #expect(BrandColours.contentCard == toBlack[0] << 16 | toBlack[1] << 8 | toBlack[2])
    #expect(BrandColours.contentCard == 0x401a4f)
    #expect(contrast(Palettes.content.ink, BrandColours.contentCard) >= 14.2)
  }

  @Test("the shares, with Increase Contrast's lines heavier than the hairline and the border")
  func shares() {
    let shares = [
      BrandShares.chip, BrandShares.soft, BrandShares.wash, BrandShares.field,
      BrandShares.fieldBorder, BrandShares.border, BrandShares.hairline,
      BrandShares.increasedLine, BrandShares.affordance, BrandShares.card, BrandShares.sheetEnd,
    ]
    #expect(shares == [0.85, 0.85, 0.12, 0.08, 0.55, 0.28, 0.22, 0.4, 0.7, 0.25, 0.15])
    #expect(BrandShares.increasedLine > BrandShares.hairline)
    #expect(BrandShares.increasedLine > BrandShares.border)
  }
}

/// WCAG 2's contrast ratio between two 0xRRGGBB colours, worked out as packages/mobile does.
private func contrast(_ a: UInt32, _ b: UInt32) -> Double {
  func luminance(_ rgb: UInt32) -> Double {
    let channels = [rgb >> 16, rgb >> 8, rgb].map { channel -> Double in
      let value = Double(channel & 0xff) / 255
      return value <= 0.039_28 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  let (x, y) = (luminance(a), luminance(b))
  return (max(x, y) + 0.05) / (min(x, y) + 0.05)
}
