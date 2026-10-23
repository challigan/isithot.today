import Foundation

/// Temperature units: the answer's, and the app's setting (`units.v1`).
public enum Units: String, Codable, Sendable, CaseIterable {
  case c
  case f
}

/// Snow depths: centimetres with °C, inches with °F.
public enum SnowUnit: String, Codable, Sendable, CaseIterable {
  case cm
  case `in`
}

/// What the API answers about (core `Topic`), in core's order (`TOPICS`), which is the order
/// `TodayQuery.build` writes `ahead` in. The snow app asks only about `snow`.
public enum Topic: String, Codable, Sendable, CaseIterable {
  case hot, wet, snow, wind
}

/// The three views, left to right (core `View`): Now, Today (Tomorrow from 6pm) and This week.
/// The raw values are core's, as deep links and the saved last view write them.
public enum AppView: String, Codable, Sendable, CaseIterable {
  case now, today, week
}

/// How snowy, from none to deep (core `SnowBand`). A band the app doesn't know yet is `unknown`,
/// which draws as `nosnow`.
public enum SnowBand: String, Codable, Sendable, CaseIterable, UnknownDecodable {
  case nosnow, flakes, maybesnow, snow, heavysnow, deepsnow, unknown
}

/// Why a day or an hour without snow has none (core `SnowReason`).
public enum SnowReason: String, Codable, Sendable, CaseIterable, UnknownDecodable {
  case warm, rain, dry, unknown
}

/// Whether enough forecasts cover the window (core `Confidence`).
public enum Confidence: String, Codable, Sendable, CaseIterable, UnknownDecodable {
  case good, limited, unknown
}

/// Where the place came from: the device, approximate IP location, a search or a city page.
public enum LocationSource: String, Codable, Sendable, CaseIterable, UnknownDecodable {
  case device, ip, search, city, unknown
}
