import Testing

@testable import IsItLogic

/// The strip words amounts as JavaScript's `String(number)` does ("5cm", "0.9in"). Each text
/// here is what Node prints for `String(n)`.
@Suite("Numbers are written as JavaScript writes them")
struct JavaScriptNumberTests {
  @Test(
    "the shortest digits, laid out as JavaScript lays them out",
    arguments: [
      (5.0, "5"),
      (0.9, "0.9"),
      (-2.5, "-2.5"),
      (1e-7, "1e-7"),
      (1.5e-7, "1.5e-7"),
      (0.000_001, "0.000001"),
      (0.000_001_5, "0.0000015"),
      (0.000_01, "0.00001"),
      (1e21, "1e+21"),
      (1e20, "100000000000000000000"),
      (1.5e16, "15000000000000000"),
      (123.456, "123.456"),
      (26.200_000_000_000_003, "26.200000000000003"),
      (0.1 + 0.2, "0.30000000000000004"),
      (-0.0, "0"),
      (9_007_199_254_740_992, "9007199254740992"),
      (Double.leastNonzeroMagnitude, "5e-324"),
      (1.797_693_134_862_315_7e308, "1.7976931348623157e+308"),
      (12_345_678.9, "12345678.9"),
    ]
  )
  func string(_ number: Double, _ text: String) {
    #expect(JavaScript.string(number) == text)
  }

  @Test("NaN and the infinities")
  func special() {
    #expect(JavaScript.string(.nan) == "NaN")
    #expect(JavaScript.string(.infinity) == "Infinity")
    #expect(JavaScript.string(-.infinity) == "-Infinity")
  }
}
