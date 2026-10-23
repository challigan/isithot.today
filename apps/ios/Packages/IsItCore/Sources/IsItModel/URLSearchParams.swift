/// JavaScript's `URLSearchParams`, as far as the TypeScript reference uses it to read and write
/// queries (the WHATWG URL standard's application/x-www-form-urlencoded parser and serializer),
/// and `encodeURIComponent`. Names are compared byte for byte, as JavaScript compares strings.
struct URLSearchParams {
  private var pairs: [(name: String, value: String)] = []

  init() {}

  /// `new URLSearchParams(query)`: one leading "?" dropped, then the pairs between "&"s, empty
  /// ones skipped, each split at its first "=" (none: an empty value), with "+" read as a space
  /// and the %-escapes decoded. A broken escape is kept as it is, and UTF-8 that doesn't decode
  /// becomes U+FFFD.
  init(_ query: String) {
    var bytes = Array(query.utf8)[...]
    if bytes.first == UInt8(ascii: "?") { bytes.removeFirst() }
    for pair in bytes.split(separator: UInt8(ascii: "&")) {
      if let equals = pair.firstIndex(of: UInt8(ascii: "=")) {
        pairs.append(
          (Self.decode(pair[..<equals]), Self.decode(pair[pair.index(after: equals)...])))
      } else {
        pairs.append((Self.decode(pair), ""))
      }
    }
  }

  /// `has(name)`
  func has(_ name: String) -> Bool {
    pairs.contains { Self.same($0.name, name) }
  }

  /// `get(name)`: the first value for `name`, or nil.
  func get(_ name: String) -> String? {
    pairs.first { Self.same($0.name, name) }?.value
  }

  /// `set(name, value)`: the first pair for `name` takes the value and the others go, or the pair
  /// is added at the end.
  mutating func set(_ name: String, _ value: String) {
    guard let first = pairs.firstIndex(where: { Self.same($0.name, name) }) else {
      pairs.append((name, value))
      return
    }
    pairs[first].value = value
    var index = pairs.index(after: first)
    while index < pairs.endIndex {
      if Self.same(pairs[index].name, name) {
        pairs.remove(at: index)
      } else {
        index = pairs.index(after: index)
      }
    }
  }

  /// `toString()`: each name and value as UTF-8, with letters, digits and `*-._` as they are, a
  /// space as "+", and every other byte as %XX.
  var string: String {
    pairs.map { Self.escape($0.name) + "=" + Self.escape($0.value) }.joined(separator: "&")
  }

  /// `encodeURIComponent(text)`: UTF-8, with letters, digits and ``-_.!~*'()`` as they are, and
  /// every other byte, a space too, as %XX.
  static func encodeURIComponent(_ text: String) -> String {
    escape(text) { byte in
      isAlphanumeric(byte) || "-_.!~*'()".utf8.contains(byte) ? .keep : .percent
    }
  }

  private enum Escape {
    case keep, plus, percent
  }

  private static func escape(_ text: String) -> String {
    escape(text) { byte in
      if isAlphanumeric(byte) || "*-._".utf8.contains(byte) { return .keep }
      return byte == UInt8(ascii: " ") ? .plus : .percent
    }
  }

  private static func escape(_ text: String, _ how: (UInt8) -> Escape) -> String {
    var out: [UInt8] = []
    out.reserveCapacity(text.utf8.count)
    for byte in text.utf8 {
      switch how(byte) {
      case .keep: out.append(byte)
      case .plus: out.append(UInt8(ascii: "+"))
      case .percent: out.append(contentsOf: [UInt8(ascii: "%"), hex(byte >> 4), hex(byte & 0xF)])
      }
    }
    return String(decoding: out, as: UTF8.self)
  }

  /// "+" as a space, %XX as its byte where XX is two hex digits, then UTF-8 (U+FFFD for what
  /// doesn't decode, and a byte order mark kept).
  private static func decode(_ bytes: ArraySlice<UInt8>) -> String {
    var out: [UInt8] = []
    out.reserveCapacity(bytes.count)
    var index = bytes.startIndex
    while index < bytes.endIndex {
      let byte = bytes[index]
      if byte == UInt8(ascii: "+") {
        out.append(UInt8(ascii: " "))
      } else if byte == UInt8(ascii: "%"), index + 2 < bytes.endIndex,
        let high = value(ofHex: bytes[index + 1]), let low = value(ofHex: bytes[index + 2])
      {
        out.append(high << 4 | low)
        index += 2
      } else {
        out.append(byte)
      }
      index += 1
    }
    return String(decoding: out, as: UTF8.self)
  }

  private static func same(_ a: String, _ b: String) -> Bool {
    a.utf8.elementsEqual(b.utf8)
  }

  private static func isAlphanumeric(_ byte: UInt8) -> Bool {
    switch byte {
    case UInt8(ascii: "0")...UInt8(ascii: "9"), UInt8(ascii: "A")...UInt8(ascii: "Z"),
      UInt8(ascii: "a")...UInt8(ascii: "z"):
      true
    default: false
    }
  }

  private static func hex(_ nibble: UInt8) -> UInt8 {
    nibble < 10 ? UInt8(ascii: "0") + nibble : UInt8(ascii: "A") + nibble - 10
  }

  private static func value(ofHex byte: UInt8) -> UInt8? {
    switch byte {
    case UInt8(ascii: "0")...UInt8(ascii: "9"): byte - UInt8(ascii: "0")
    case UInt8(ascii: "A")...UInt8(ascii: "F"): byte - UInt8(ascii: "A") + 10
    case UInt8(ascii: "a")...UInt8(ascii: "f"): byte - UInt8(ascii: "a") + 10
    default: nil
    }
  }
}
