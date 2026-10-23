import Foundation

/// The query strings the app sends, without the "?" (client `query.ts`). The same state always
/// makes the same string, so the app, its widgets and the website asking for a place share the
/// CDN's entry for it. Checked against `query.json`.
public enum TodayQuery {
  /// The query for `/api/v1/today` (client `todayQuery`), always in this order: the place,
  /// `units`, then `ahead`, the topics whose hours ahead the answer should carry, in core's
  /// order of topics and once each. "place=leeds-gb&units=c&ahead=snow" is the app's, and
  /// "place=leeds-gb&units=c" the website's. The apps never send `windUnits`, which the website
  /// puts between `units` and `ahead`, so the app has no way to.
  public static func build(_ target: Target, units: Units?, ahead: [Topic] = []) -> String {
    var params = URLSearchParams()
    switch target {
    case .ip:
      break
    case .city(let slug, _):
      params.set("place", slug)
    case .coords(let place):
      params.set("lat", JavaScriptNumber.string(place.lat))
      params.set("lon", JavaScriptNumber.string(place.lon))
      if let name = place.name, !name.isEmpty { params.set("name", name) }
      if let region = place.region, !region.isEmpty { params.set("region", region) }
      if let country = place.country, !country.isEmpty { params.set("country", country) }
      if let geonameId = place.geonameId, geonameId != 0 {
        params.set("geonameId", String(geonameId))
      }
      // The forecast is then for the place's own height (only a searched place has one).
      if let elevation = place.elevation {
        params.set("elevation", JavaScriptNumber.string(elevation))
      }
      params.set("source", place.source.rawValue)
    }
    if let units { params.set("units", units.rawValue) }
    let topics = Topic.allCases.filter { ahead.contains($0) }
    if !topics.isEmpty { params.set("ahead", topics.map(\.rawValue).joined(separator: ",")) }
    return params.string
  }

  /// The same query past the phone's and the CDN's caches, with a new address each hour (UTC)
  /// (client `freshQuery`): for an answer that is out of date already when it arrives.
  public static func fresh(_ query: String, now: Date) -> String {
    // The hours since 1970 (core HOUR is an hour in milliseconds).
    let hour = (now.timeIntervalSince1970 / 3600).rounded(.down)
    return (query.isEmpty ? "" : query + "&") + "t=" + JavaScriptNumber.string(hour)
  }

  /// The query for `/api/v1/search` (client `searchQuery`).
  public static func search(_ text: String) -> String {
    "q=" + URLSearchParams.encodeURIComponent(text)
  }
}
