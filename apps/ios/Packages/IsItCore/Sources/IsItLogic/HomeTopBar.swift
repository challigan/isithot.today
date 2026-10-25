import Foundation
import IsItModel

/// The home screen's top bar as plain values (iOS build spec, section 10.2), in the website's
/// arrangement (DECISIONS, "The iPhone app in the website's look"): the place as a pill that opens
/// the picker, the Settings button beside it, and beneath them on the IP place the website's
/// "Use my exact location" chip, with a notice above it while there is one. The same over every
/// page. The port of packages/mobile `homeTopBar` (`page.ts`), checked against `page.json`.
public struct HomeTopBar: Sendable, Equatable {
  /// "Leeds", or "Finding you…" while the place isn't known yet, as on the website.
  public let place: String
  /// The place button for VoiceOver: "Place: Leeds. Change place.", or while the place isn't
  /// known, "Finding you…, change place.", so it always says what the button does.
  public let placeLabel: String
  /// A notice to tell the user about the place, while there is one ("That place is no longer
  /// available. Showing your approximate location."), above the chip on approximate location or
  /// on its own on another place. The plain "Using approximate location." isn't shown: it is the
  /// chip's VoiceOver hint (`CoreCopy.approximate`), as the website shows the chip alone.
  public let approximate: String?
  /// "Use my exact location", the chip on the approximate IP place only.
  public let useMyLocation: String?
  /// The gear's label, "Settings".
  public let settings: String

  /// The top bar for the place named `placeName` (the target's name, or the answer's), nil or
  /// empty while it isn't known; `approximate` on approximate IP location. `notice` is a line
  /// to tell the user about the place (`AppCopy.slugGone`).
  public init(placeName: String?, approximate: Bool, notice: String? = nil) {
    if let placeName, !placeName.isEmpty {
      place = placeName
      placeLabel = AppCopy.placeButtonLabel(place: placeName)
    } else {
      place = CoreCopy.locating
      placeLabel = AppCopy.placeButtonUnknown(status: CoreCopy.locating)
    }
    self.approximate = notice
    useMyLocation = approximate ? CoreCopy.useExactLocation : nil
    settings = AppCopy.settings
  }
}
