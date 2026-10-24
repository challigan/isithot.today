import Foundation

/// The minute tick (iOS build spec, section 9.5) counted in the model's minutes. The home screen
/// draws the pages again as each minute begins, so the hour picked, Tomorrow from 6pm and the
/// stale state change on the minute they change at the place. The model's clock may run apart
/// from the system's (a Debug build started at a fixture's moment, or at `-now`), so the tick
/// can't be the system's own minutes: started at 5:59:30pm, the model reaches 6pm 30 seconds
/// later, while the system's next minute may be almost a minute away.
public enum MinuteTick {
  /// How far into the model's minute each tick is: a twentieth of a second, so that a tick never
  /// lands a hair before the minute it is for, where the clocks' arithmetic rounds.
  public static let lead: TimeInterval = 0.05

  /// A moment on the system's clock just after the model's clock read a whole minute: `system`
  /// less how far `model` (the model's time at that same moment) is into its minute, plus
  /// `lead`. A periodic schedule from it, every 60 seconds, ticks as each of the model's minutes
  /// begins. With the two clocks the same, as in the app, it is the start of the system's
  /// minute (and the lead).
  public static func anchor(model: Date, system: Date) -> Date {
    let into = model.timeIntervalSince1970.truncatingRemainder(dividingBy: 60)
    return system.addingTimeInterval(lead - (into < 0 ? into + 60 : into))
  }
}
