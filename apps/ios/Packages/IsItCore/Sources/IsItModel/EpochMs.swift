import Foundation

extension Date {
  /// The moment `epochMs` milliseconds after 1 January 1970 UTC: how the API's hourly series,
  /// the client's rules and the golden vectors give moments.
  public init(epochMs: Int) {
    self.init(timeIntervalSince1970: Double(epochMs) / 1000)
  }

  /// The moment in whole epoch milliseconds, to the nearest, as the TypeScript counts time. A
  /// moment made from whole milliseconds reads back as exactly those, so the rules ported from
  /// the TypeScript compare and add moments exactly as it does.
  public var epochMs: Int {
    Int((timeIntervalSince1970 * 1000).rounded())
  }
}
