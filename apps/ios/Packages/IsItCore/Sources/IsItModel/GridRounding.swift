/// Core `roundToGrid`: a coordinate (or a height) to the nearest multiple of a step, as the
/// server and the website round it, so the app asks for the same grid cell, and so shares the
/// same cached answers. Checked against `grid.json`.
public enum GridRounding {
  /// `value` to the nearest multiple of `step`, halves up (JavaScript's `Math.round`, so -0.025
  /// on the 0.05 grid is 0, not -0.05), then written to the step's decimals and read back
  /// (`toFixed`), so there is no float noise (0.3, not 0.30000000000000004), and never -0.
  public static func round(_ value: Double, step: Double) -> Double {
    let rounded = JavaScriptNumber.fixed(
      JavaScriptNumber.round(value / step) * step,
      digits: decimals(of: step)
    )
    return rounded == 0 ? 0 : rounded
  }

  /// How many decimals `step` has as JavaScript writes it (core `decimalsOf`): 2 for 0.05, and
  /// for a step written with an exponent, what follows its point ("1e-7" has none).
  private static func decimals(of step: Double) -> Int {
    let text = JavaScriptNumber.string(step)
    guard let point = text.firstIndex(of: ".") else { return 0 }
    return text.distance(from: point, to: text.endIndex) - 1
  }
}
