import IsItLogic
import IsItModel
import Testing

/// Bold Text's one rule, which the app's text and the widget's both follow (`BrandFont.bolder`).
@Suite("The brand's faces under Bold Text")
struct BrandFaceTests {
  @Test("Regular steps up to Medium and Medium to SemiBold; SemiBold and the answer's face stay")
  func bolder() {
    #expect(BrandFont.textRegular.bolder == .textMedium)
    #expect(BrandFont.textMedium.bolder == .textSemiBold)
    #expect(BrandFont.textSemiBold.bolder == .textSemiBold)
    #expect(BrandFont.answer.bolder == .answer)
    #expect(
      BrandFont.allCases.map(\.bolder) == [.textMedium, .textSemiBold, .textSemiBold, .answer])
  }
}
