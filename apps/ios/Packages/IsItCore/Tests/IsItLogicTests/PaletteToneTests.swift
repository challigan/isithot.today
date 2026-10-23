import Foundation
import IsItLogic
import IsItModel
import Testing

/// Which pages are dark under light ink, so that the system's controls on them take the dark
/// colour scheme and keep their text's contrast (iOS build spec, sections 10.1 and 16).
@Suite("Light ink on a dark page")
struct PaletteToneTests {
  @Test("the snow bands are white on purple; no snow and a few flakes are dark on light")
  func bands() {
    let light = SnowBand.allCases.filter { Palettes.snow($0).inkIsLight }
    #expect(Set(light) == [.maybesnow, .snow, .heavysnow, .deepsnow])
    #expect(!Palettes.snow(.unknown).inkIsLight)
  }

  @Test("both ends of every gradient agree with the ink")
  func bothEnds() {
    for band in SnowBand.allCases {
      let palette = Palettes.snow(band)
      let ink = Palette.relativeLuminance(palette.ink)
      #expect((ink > Palette.relativeLuminance(palette.g2)) == palette.inkIsLight, "\(band)")
    }
  }

  @Test("relative luminance: black, white and an sRGB grey")
  func luminance() {
    #expect(Palette.relativeLuminance(0x000000) == 0)
    #expect(abs(Palette.relativeLuminance(0xffffff) - 1) < 1e-12)
    // #777777 is 0.184, WCAG's own worked example of a mid grey.
    #expect(abs(Palette.relativeLuminance(0x777777) - 0.184) < 0.001)
  }
}
