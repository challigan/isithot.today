import Foundation

/// An optional block of the answer that the app can do without (`snow`, `snow.now`, `snow.week`,
/// `snow.ahead`, `links`, `updated`, `nearby`): absent, `null` or malformed, it decodes as `nil`
/// rather than failing the whole response (iOS build spec, section 4).
@propertyWrapper
public struct Lenient<Value> {
  public var wrappedValue: Value?

  public init(wrappedValue: Value?) {
    self.wrappedValue = wrappedValue
  }
}

extension Lenient: Sendable where Value: Sendable {}
extension Lenient: Equatable where Value: Equatable {}

extension Lenient: Decodable where Value: Decodable {
  public init(from decoder: any Decoder) throws {
    wrappedValue = try? decoder.singleValueContainer().decode(Value.self)
  }
}

extension Lenient: Encodable where Value: Encodable {
  public func encode(to encoder: any Encoder) throws {
    var container = encoder.singleValueContainer()
    try container.encode(wrappedValue)
  }
}

extension KeyedDecodingContainer {
  /// A missing key is `nil` too, where a plain property wrapper would throw `keyNotFound`.
  public func decode<Value: Decodable>(
    _ type: Lenient<Value>.Type,
    forKey key: Key
  ) throws -> Lenient<Value> {
    Lenient(wrappedValue: try? decodeIfPresent(Value.self, forKey: key))
  }
}

extension KeyedEncodingContainer {
  /// Leaves the key out for `nil`, as the server does.
  public mutating func encode<Value: Encodable>(_ value: Lenient<Value>, forKey key: Key) throws {
    try encodeIfPresent(value.wrappedValue, forKey: key)
  }
}

/// A string the server may add values to: one the app doesn't know yet decodes as `unknown`,
/// rather than failing the response.
public protocol UnknownDecodable: Decodable, RawRepresentable where RawValue == String {
  static var unknown: Self { get }
}

extension UnknownDecodable {
  public init(from decoder: any Decoder) throws {
    let raw = try decoder.singleValueContainer().decode(String.self)
    self = Self(rawValue: raw) ?? .unknown
  }
}
