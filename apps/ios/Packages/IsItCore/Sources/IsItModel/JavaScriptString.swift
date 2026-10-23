/// What the ported rules need of JavaScript's strings, done as JavaScript does them: one copy,
/// shared with IsItLogic (`package`), as `JavaScriptNumber` is for its numbers.
package enum JavaScriptString {
  /// `text.trim()`: without the white space (ECMAScript WhiteSpace, the space separators among
  /// it) and line terminators at either end. Not Swift's `whitespacesAndNewlines`, which has
  /// U+0085 and not U+FEFF.
  package static func trimmed(_ text: String) -> String {
    let scalars = text.unicodeScalars
    guard let first = scalars.firstIndex(where: { !isSpace($0) }),
      let last = scalars.lastIndex(where: { !isSpace($0) })
    else { return "" }
    return String(scalars[first...last])
  }

  /// `text.length`: its UTF-16 code units, so a letter outside the Basic Multilingual Plane, or
  /// one written with a combining mark, counts as two.
  package static func length(_ text: String) -> Int {
    text.utf16.count
  }

  /// White space or a line terminator, as `trim` takes them off.
  private static func isSpace(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.value {
    case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0xFEFF, 0x2028, 0x2029: true
    default: scalar.properties.generalCategory == .spaceSeparator
    }
  }
}
