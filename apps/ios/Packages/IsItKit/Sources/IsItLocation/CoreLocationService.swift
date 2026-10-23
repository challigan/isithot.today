import CoreLocation
import Foundation
import IsItState

/// The phone's location through Core Location (iOS build spec, sections 9.3, 9.4, 10.3 and
/// 15.2): When In Use permission, asked only by `requestAccess()`, which only "Use my location"
/// calls, at the tap; then one `requestLocation()` at `kCLLocationAccuracyKilometer`. The app
/// rounds the fix to the 0.05° grid itself (`Target.device(lat:lon:)`), so a phone with Precise
/// turned off in the prompt works the same. Nothing here keeps, logs or sends a coordinate.
///
/// Core Location calls its delegate on the thread that made the manager, the main thread here,
/// and everything it is told is kept and answered there. Only the app links this module: the
/// widget never asks for a location, so no location API is in its binary.
public final class CoreLocationService: NSObject, LocationService, CLLocationManagerDelegate,
  @unchecked Sendable
{
  private let manager: CLLocationManager
  /// Those waiting for the answer to the permission prompt.
  private var asking: [CheckedContinuation<LocationAccess, Never>] = []
  /// Those waiting for the fix that is out.
  private var locating: [CheckedContinuation<LocationFix, Never>] = []

  /// Make it on the main thread (the app's root does), where Core Location then calls the
  /// delegate.
  public override init() {
    manager = CLLocationManager()
    super.init()
    manager.desiredAccuracy = kCLLocationAccuracyKilometer
    manager.delegate = self
  }

  public func access() async -> LocationAccess {
    await MainActor.run { Self.access(self.manager.authorizationStatus) }
  }

  public func requestAccess() async -> LocationAccess {
    await withCheckedContinuation { continuation in
      Task { @MainActor in
        let now = Self.access(self.manager.authorizationStatus)
        guard now == .notDetermined else {
          continuation.resume(returning: now)
          return
        }
        self.asking.append(continuation)
        if self.asking.count == 1 { self.manager.requestWhenInUseAuthorization() }
      }
    }
  }

  public func fix() async -> LocationFix {
    await withCheckedContinuation { continuation in
      Task { @MainActor in
        guard Self.access(self.manager.authorizationStatus) == .granted else {
          continuation.resume(returning: .denied)
          return
        }
        self.locating.append(continuation)
        if self.locating.count == 1 { self.manager.requestLocation() }
      }
    }
  }

  // MARK: - CLLocationManagerDelegate, on the main thread

  public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let access = Self.access(manager.authorizationStatus)
    // Core Location says so when the manager is made too, before anything is answered.
    guard access != .notDetermined else { return }
    let waiting = asking
    asking = []
    for continuation in waiting { continuation.resume(returning: access) }
  }

  public func locationManager(
    _ manager: CLLocationManager,
    didUpdateLocations locations: [CLLocation]
  ) {
    guard let location = locations.last else { return }
    finish(
      .located(
        latitude: location.coordinate.latitude,
        longitude: location.coordinate.longitude
      ))
  }

  public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    finish((error as? CLError)?.code == .denied ? .denied : .unavailable)
  }

  private func finish(_ fix: LocationFix) {
    let waiting = locating
    locating = []
    for continuation in waiting { continuation.resume(returning: fix) }
  }

  /// Core Location's permission as the app reads it: restricted is as good as denied.
  private static func access(_ status: CLAuthorizationStatus) -> LocationAccess {
    switch status {
    case .notDetermined: .notDetermined
    case .authorizedWhenInUse, .authorizedAlways: .granted
    case .denied, .restricted: .denied
    @unknown default: .denied
    }
  }
}
