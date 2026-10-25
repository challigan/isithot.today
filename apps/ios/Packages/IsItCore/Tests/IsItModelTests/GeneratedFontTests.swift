import IsItModel
import Testing

// The fonts' names pnpm mobile:generate writes (packages/mobile exportFont.ts): every face the
// app and the widget register, by the PostScript name `Font.custom` asks for, and its file, as
// both Info.plists' `UIAppFonts` list it (packages/mobile appFonts.test.ts).

@Suite("BrandFont: the app's fonts")
struct GeneratedFontTests {
  @Test("the three text faces, then the answer word's, by PostScript name")
  func names() {
    #expect(
      BrandFont.allCases.map(\.rawValue) == [
        "BricolageText-Regular", "BricolageText-Medium", "BricolageText-SemiBold",
        "BricolageAnswer",
      ])
    #expect(BrandFont(rawValue: "BricolageAnswer") == .answer)
  }

  @Test("each one's file is its name, as UIAppFonts lists it")
  func files() {
    #expect(
      BrandFont.allCases.map(\.file) == [
        "BricolageText-Regular.ttf", "BricolageText-Medium.ttf", "BricolageText-SemiBold.ttf",
        "BricolageAnswer.ttf",
      ])
  }
}
