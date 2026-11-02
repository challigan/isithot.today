import Foundation
import IsItModel

/// A notification's tap, from its payload's JSON (`NotificationDelegate.json(_:)`), to where the
/// app opens (section 12.3).
public enum NotificationRouter {
  /// `DeepLink.route(payload:placeNow:)` for the payload `json`, with the place's date and time
  /// now from `zones`, the time zone identifiers of the places the app knows, by `Target.key`
  /// (the registration's place, then the answer on screen's). A place in neither is taken as
  /// current, as the client rule says. Nil for no JSON, JSON that isn't an object, or a payload
  /// the rule refuses: the app opens as usual.
  public static func route(json: Data?, now: Date, zones: [String: String]) -> DeepLink.Route? {
    guard let json, let payload = try? JSONSerialization.jsonObject(with: json) else {
      return nil
    }
    return DeepLink.route(payload: payload) { target in
      zones[target.key].map { PlaceTime.local(now, in: $0) }
    }
  }
}
