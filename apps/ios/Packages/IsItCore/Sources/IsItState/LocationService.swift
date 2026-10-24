import Foundation
import IsItLogic
import IsItModel

/// Whether the app may use the phone's location (Core Location's When In Use permission).
public enum LocationAccess: Sendable, Equatable {
  /// Never asked: the system's prompt can still be shown.
  case notDetermined
  /// Denied, or restricted (parental controls, a profile, or Location Services off).
  case denied
  /// When In Use, precise or approximate.
  case granted
}

/// One location fix, as Core Location gave it. The coordinates are the device's own: they are
/// rounded to the forecast grid (`Target.device(lat:lon:)`) before anything keeps or sends them,
/// and nothing logs them.
public enum LocationFix: Sendable, Equatable {
  case located(latitude: Double, longitude: Double)
  /// Permission went while the fix was out.
  case denied
  /// No fix came: no signal, or Core Location's error.
  case unavailable
}

/// The phone's location (iOS build spec, sections 9.3, 9.4 and 10.3): `CoreLocationService`
/// (IsItServices) in the app, at about 1 km (`kCLLocationAccuracyKilometer`); a Debug build's
/// `-location` stand-in, so the UI tests never see the system's prompt; a fake in the tests.
public protocol LocationService: Sendable {
  /// Whether the app may use the location now. Never asks.
  func access() async -> LocationAccess
  /// Asks for When In Use permission with the system's prompt when it was never asked, and
  /// gives the answer; otherwise what was answered before, without asking. Only "Use my
  /// location" calls it, at the tap (nothing prompts on first launch).
  func requestAccess() async -> LocationAccess
  /// One fix, when permission is granted. Never asks.
  func fix() async -> LocationFix
}

/// No location at all, as if permission were off: for previews, and the tests that don't use
/// one.
public struct NoLocation: LocationService {
  public init() {}

  public func access() async -> LocationAccess { .denied }

  public func requestAccess() async -> LocationAccess { .denied }

  public func fix() async -> LocationFix { .denied }
}

/// What "Use my location" came to (`AppModel.locate()`).
public enum LocationOutcome: Sendable, Equatable {
  /// The device's place, rounded to the 0.05° grid.
  case located(Target)
  /// Permission is off, so the picker says so, with "Open Settings".
  case denied
  /// Permission is on, but no fix came.
  case unavailable
}
