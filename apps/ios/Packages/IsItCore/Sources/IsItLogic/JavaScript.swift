/// How the TypeScript reference writes what the ports must write the same way.
enum JavaScript {
  /// A number as JavaScript's `String(number)` writes it (ECMAScript Number::toString): the
  /// shortest digits that read back as the same number, which Swift's `description` finds too,
  /// laid out as JavaScript lays them out: "5", "0.9", "-2.5", "1e-7", "1e+21".
  static func string(_ number: Double) -> String {
    if number.isNaN { return "NaN" }
    if number.isInfinite { return number < 0 ? "-Infinity" : "Infinity" }
    if number == 0 { return "0" }
    let sign = number < 0 ? "-" : ""
    // Swift writes "5.0", "0.9", "1e-07" or "1.5e+16": the digits, and where the point goes.
    let text = number.magnitude.description
    let parts = text.split(separator: "e", maxSplits: 1)
    let exponent = parts.count > 1 ? Int(parts[1]) ?? 0 : 0
    let mantissa = parts[0].split(separator: ".", maxSplits: 1)
    let whole = String(mantissa[0])
    var digits = Array(whole + (mantissa.count > 1 ? String(mantissa[1]) : ""))
    // The number is 0.d1d2…dk × 10^n.
    var n = whole.count + exponent
    while digits.first == "0" {
      digits.removeFirst()
      n -= 1
    }
    while digits.last == "0" { digits.removeLast() }
    let k = digits.count
    let all = String(digits)
    if k <= n && n <= 21 {
      return sign + all + String(repeating: "0", count: n - k)
    }
    if 0 < n && n <= 21 {
      return sign + String(digits[..<n]) + "." + String(digits[n...])
    }
    if -6 < n && n <= 0 {
      return sign + "0." + String(repeating: "0", count: -n) + all
    }
    let power = n - 1
    let rest = k > 1 ? "." + String(digits[1...]) : ""
    return sign + String(digits[0]) + rest + "e" + (power < 0 ? "-" : "+") + String(power.magnitude)
  }
}
