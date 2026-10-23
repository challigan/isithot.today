import Foundation
import IsItModel

/// The home screen's top bar as plain values (iOS build spec, section 10.2): the place as a
/// button that opens the picker, the approximate-location line beneath it on the IP place, and
/// the Settings button. The same over every page.
public struct HomeTopBar: Sendable, Equatable {
  /// "Leeds", or "Finding you…" while the place isn't known yet, as on the website.
  public let place: String
  /// The place button for VoiceOver: "Place: Leeds. Change place.".
  public let placeLabel: String
  /// "Using approximate location.", on the approximate IP place only.
  public let approximate: String?
  /// "Use my location", beside `approximate`.
  public let useMyLocation: String?
  /// The gear's label, "Settings".
  public let settings: String

  /// The top bar for the place named `placeName` (the target's name, or the answer's), nil or
  /// empty while it isn't known; `approximate` on approximate IP location.
  public init(placeName: String?, approximate: Bool) {
    if let placeName, !placeName.isEmpty {
      place = placeName
      placeLabel = AppCopy.placeButtonLabel(place: placeName)
    } else {
      place = CoreCopy.locating
      placeLabel = CoreCopy.locating
    }
    self.approximate = approximate ? CoreCopy.approximate : nil
    useMyLocation = approximate ? CoreCopy.useMyLocation : nil
    settings = AppCopy.settings
  }
}
