import Foundation
import IsItModel

/// What the home screen asks the app to do (iOS build spec, section 10.2). The screen keeps no
/// state of its own: it draws the presenters' values (`HomePage`, `HomeTopBar`) and hands each
/// tap to the app's model through these.
public struct HomeActions {
  /// Ask for the answer again: Retry, in the error state or under the footer's line.
  public var retry: () -> Void
  /// The place pill: open the place picker.
  public var openPlacePicker: () -> Void
  /// The gear: open Settings.
  public var openSettings: () -> Void
  /// "Use my exact location", the chip on approximate location: open the picker finding the
  /// phone's place.
  public var useMyLocation: () -> Void
  /// A link out (BBC Weather, the Met Office, AccuWeather) or a credit's: open it in Safari.
  public var openLink: (URL) -> Void
  /// A place under "Nearby:": load its answer in place, with no navigation.
  public var selectNearby: (NearbyCity) -> Void

  public init(
    retry: @escaping () -> Void,
    openPlacePicker: @escaping () -> Void,
    openSettings: @escaping () -> Void,
    useMyLocation: @escaping () -> Void,
    openLink: @escaping (URL) -> Void,
    selectNearby: @escaping (NearbyCity) -> Void
  ) {
    self.retry = retry
    self.openPlacePicker = openPlacePicker
    self.openSettings = openSettings
    self.useMyLocation = useMyLocation
    self.openLink = openLink
    self.selectNearby = selectNearby
  }
}
