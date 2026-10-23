/// JavaScript's own arithmetic, where the TypeScript reference relies on it: how it writes a
/// number (`String(n)`), `Math.round`, and `Number(x.toFixed(digits))`. The ports use these, so a
/// key, a query, a rounded coordinate, the strip's amounts and a registration's fingerprint come
/// out exactly as the TypeScript's. `package`, so IsItLogic's ports share this one copy without
/// it becoming the apps' API.
package enum JavaScriptNumber {
  /// `String(n)` (ECMAScript Number::toString): the shortest digits that read back as `n`,
  /// written out from 1e-6 up to 1e21 and with an exponent outside that ("1e-7", "1.5e+21"), and
  /// "0" for -0. Swift's `description` would write "53.0" and "1e-07".
  package static func string(_ n: Double) -> String {
    if n.isNaN { return "NaN" }
    if n == 0 { return "0" }
    if n < 0 { return "-" + string(-n) }
    if n.isInfinite { return "Infinity" }
    let (digits, point) = shortestDigits(n)
    let count = digits.count
    if count <= point && point <= 21 {
      return digits + String(repeating: "0", count: point - count)
    }
    if 0 < point && point <= 21 {
      return String(digits.prefix(point)) + "." + String(digits.dropFirst(point))
    }
    if -6 < point && point <= 0 {
      return "0." + String(repeating: "0", count: -point) + digits
    }
    let exponent = point - 1
    let mantissa =
      count == 1 ? digits : String(digits.prefix(1)) + "." + String(digits.dropFirst())
    return mantissa + (exponent < 0 ? "e-" : "e+") + String(exponent.magnitude)
  }

  /// `Math.round`: the nearest whole number, and of two the one towards +∞, so -2.5 gives -2
  /// (where `rounded()` gives -3) and 0.49999999999999994 gives 0 (where
  /// `(x + 0.5).rounded(.down)` gives 1). `x` less its floor is exact from 1 up and from -1 down,
  /// and between them is never wrong about the half.
  package static func round(_ x: Double) -> Double {
    let down = x.rounded(.down)
    let nearest = x - down >= 0.5 ? down + 1 : down
    // As JavaScript, -0 for anything from -0.5 up to -0.
    return nearest == 0 ? Double(signOf: x, magnitudeOf: 0) : nearest
  }

  /// `Number(x.toFixed(digits))`: `x` to `digits` decimal places (rounding its exact value, half
  /// away from zero, as `toFixed` does), read back as the nearest double. `digits` is at most 22,
  /// the most decimals `String(n)` writes.
  package static func fixed(_ x: Double, digits: Int) -> Double {
    // toFixed writes NaN, the infinities and anything from 1e21 up as String(x) does, which reads
    // back as x; and zero as "0.00", which reads back as +0.
    guard x.isFinite, x.magnitude < 1e21, (0...22).contains(digits) else { return x }
    if x == 0 { return 0 }
    // |x| is significand × 2^exponent, with a whole significand under 2^53.
    let significand = x.significandBitPattern | (x.isNormal ? 1 << 52 : 0)
    let exponent = (x.isNormal ? Int(x.exponent) : -1022) - 52
    // When |x| × 10^digits is whole, toFixed writes x exactly.
    let shift = -(exponent + digits)
    if shift <= 0 { return x }
    // Otherwise toFixed writes n / 10^digits, n = round(|x| × 10^digits), halves up: n is
    // (significand × 5^digits + 2^(shift - 1)) >> shift, in 128 bits, since significand ×
    // 5^digits is under 2^53 × 5^22 < 2^105.
    var power: UInt64 = 1
    for _ in 0..<digits { power *= 5 }
    let product = significand.multipliedFullWidth(by: power)
    let n: UInt64
    if shift > 105 {
      n = 0
    } else {
      var high = product.high
      var low = product.low
      let half = shift - 1
      if half < 64 {
        let (sum, carried) = low.addingReportingOverflow(1 << half)
        low = sum
        if carried { high += 1 }
      } else {
        high += 1 << (half - 64)
      }
      if shift >= 64 {
        n = high >> (shift - 64)
      } else {
        // n is 2^64 or more, so it reads back as x (below).
        guard high >> shift == 0 else { return x }
        n = high << (64 - shift) | low >> shift
      }
    }
    // When n is 2^53 or more, 2^exponent is over 10^-digits, so n / 10^digits is nearer to |x|
    // than half the gap to the next double, and reads back as x.
    guard n < 1 << 53 else { return x }
    var scale = 1.0
    for _ in 0..<digits { scale *= 10 }
    // n and 10^digits are exact, so the division is the double nearest to n / 10^digits, as
    // reading the decimal back is. "-0.00" reads back as -0.
    let magnitude = Double(n) / scale
    return x < 0 ? -magnitude : magnitude
  }

  /// The shortest decimal digits that read back as `n` (finite and above zero), without leading
  /// or trailing zeros, and where the point goes: `n` is 0.digits × 10^point. Swift's
  /// `description` finds the same digits as JavaScript does (the shortest, and of those the
  /// closest), written as "53.8", "105.0", "1e-07" or "1.5e+22".
  private static func shortestDigits(_ n: Double) -> (digits: String, point: Int) {
    let text = n.description
    let parts = text.split(separator: "e", maxSplits: 1)
    let mantissa = parts[0].split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
    let whole = mantissa[0]
    let fraction = mantissa.count == 2 ? mantissa[1] : ""
    var digits = Substring(whole + fraction)
    var point = whole.count + (parts.count == 2 ? Int(parts[1]) ?? 0 : 0)
    while digits.first == "0" {
      digits.removeFirst()
      point -= 1
    }
    while digits.last == "0" {
      digits.removeLast()
    }
    return (String(digits), point)
  }
}
