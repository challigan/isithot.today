import Foundation
import IsItLogic
import Testing

/// The sheets' own colours (`SheetColours`, which IsItUI's `SheetStyle` draws), held to WCAG AA
/// for text under 18 points (iOS build spec, section 16) on every system background a sheet's
/// text sits on; and the system's own, which they stand in for where those fall short.
@Suite("Sheet colours: WCAG AA on the system's backgrounds")
struct SheetColoursTests {
  @Test("secondary text in the light appearance meets 4.5:1 on a grouped list and its rows")
  func secondary() {
    for background in SheetColours.lightBackgrounds {
      #expect(SheetColours.contrast(SheetColours.secondaryLight, background) >= 4.5)
    }
    #expect(ratio(SheetColours.secondaryLight, 0xf2f2f7) == 5.36)
  }

  @Test("the tint meets 4.5:1 in both appearances, and under a prominent button's white label")
  func accent() {
    for background in SheetColours.lightBackgrounds {
      #expect(SheetColours.contrast(SheetColours.accentLight, background) >= 4.5)
    }
    for background in SheetColours.darkBackgrounds {
      #expect(SheetColours.contrast(SheetColours.accentDark, background) >= 4.5)
    }
    // `SheetStyle.filled`: the light tint, in both appearances, under white.
    #expect(ratio(0xffffff, SheetColours.accentLight) == 7.56)
    // The dark tint couldn't be the fill too.
    #expect(SheetColours.contrast(0xffffff, SheetColours.accentDark) < 4.5)
  }

  @Test("the system's light secondary label and blue fall short; its dark secondary label passes")
  func system() {
    let lightSecondary = SheetColours.lightBackgrounds.map {
      SheetColours.contrast(over($0, 0x3c3c43, 0.6), $0)
    }
    #expect(lightSecondary.allSatisfy { $0 < 4.5 })
    #expect(ratio(over(0xf2f2f7, 0x3c3c43, 0.6), 0xf2f2f7) == 3.28)
    let lightBlue = SheetColours.lightBackgrounds.map { SheetColours.contrast(0x007aff, $0) }
    #expect(lightBlue.allSatisfy { $0 < 4.5 })
    #expect(SheetColours.contrast(0x0a84ff, 0x2c2c2e) < 4.5)
    // Which is why SheetStyle keeps the system's secondary label in the dark appearance.
    for background in SheetColours.darkBackgrounds {
      #expect(SheetColours.contrast(over(background, 0xebebf5, 0.6), background) >= 4.5)
    }
  }

  @Test("the ratio is WCAG 2's")
  func contrast() {
    #expect(abs(SheetColours.contrast(0x000000, 0xffffff) - 21) < 1e-9)
    #expect(abs(SheetColours.contrast(0xffffff, 0x000000) - 21) < 1e-9)
    #expect(SheetColours.contrast(0x777777, 0x777777) == 1)
    #expect(ratio(0x767676, 0xffffff) == 4.54)
  }
}

/// The contrast of `a` and `b`, rounded down to two decimals, as packages/mobile writes ratios.
private func ratio(_ a: UInt32, _ b: UInt32) -> Double {
  (SheetColours.contrast(a, b) * 100 + 1e-9).rounded(.down) / 100
}

/// `colour` at `alpha` over `background`, each channel rounded, as the screen blends the
/// system's translucent label colours.
private func over(_ background: UInt32, _ colour: UInt32, _ alpha: Double) -> UInt32 {
  [16, 8, 0].reduce(UInt32(0)) { blended, shift in
    let under = Double((background >> UInt32(shift)) & 0xff)
    let above = Double((colour >> UInt32(shift)) & 0xff)
    return blended | UInt32((under + alpha * (above - under)).rounded()) << UInt32(shift)
  }
}
