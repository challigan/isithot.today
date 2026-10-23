import Foundation
import IsItLogic
import IsItModel

/// How the app's last fetch went (iOS build spec, section 9.4).
public enum AppPhase: Sendable, Equatable {
  /// Fetching, with nothing to show yet.
  case loading
  /// The last fetch worked, or the saved answer was recent enough to keep.
  case ready
  /// The last fetch couldn't reach the server; what was saved is kept.
  case offline
  /// The last fetch failed otherwise, rate limited (429) among them; what was saved is kept.
  case error(FetchError)

  /// The phase a failed fetch leaves: offline for no connection; an error otherwise. A 429 is
  /// an error, never "offline": the phone is connected, so the app asks again as it does
  /// offline (`Refresh.retry`, as section 5.6 says), but says so only with nothing to show, in
  /// core's words for it, and over an answer says nothing (section 4's "retry quietly").
  public init(_ failure: FetchError) {
    switch failure {
    case .offline: self = .offline
    case .rateLimited, .failed: self = .error(failure)
    }
  }

  /// The server's own message for the last fetch's failure (its `ApiError`), which the page
  /// says when it has no answer to show; nil without one, and in every other phase.
  public var serverMessage: String? {
    guard case .error(.failed(_, _, let message?)) = self, !message.isEmpty else { return nil }
    return message
  }
}

extension HomePage.Phase {
  /// How the last fetch went, as the home page's presenter takes it: a 429 as `limited`, which
  /// the page keeps quiet over an answer; any other error as `error`, whose server's message
  /// `AppPhase.serverMessage` gives.
  public init(_ phase: AppPhase) {
    switch phase {
    case .loading: self = .loading
    case .ready: self = .ready
    case .offline: self = .offline
    case .error(.rateLimited): self = .limited
    case .error: self = .error
    }
  }
}

/// What the answer views show at a moment (iOS build spec, section 9.5): the hour picked from
/// the answer, the stale state once it has none, or why there is no answer.
public enum AnswerState: Sendable, Equatable {
  /// No answer yet, and fetching one.
  case loading
  /// The hour to show (`HourPicker.pick`): the answer's own, or one of its hours ahead.
  case answer(PickedHour)
  /// An answer, but none of its hours is current any more (`Freshness.usableUntil` has
  /// passed): Now, the middle view and the week say there is no recent forecast
  /// (`AppCopy.staleApp`), never an old hour.
  case stale
  /// No answer, and no connection: `AppCopy.staleApp`.
  case offline
  /// No answer, and the fetch failed: `FetchError.message`, with a way to try again.
  case error(FetchError)

  /// What to show at `now`, with `response` the answer on screen and `phase` how the last
  /// fetch went. Offline, an answer keeps showing its picked hour until `usableUntil`, then the
  /// stale state.
  public static func at(_ now: Date, response: TodayResponse?, phase: AppPhase) -> AnswerState {
    if let response {
      return HourPicker.pick(response, at: now).map(AnswerState.answer) ?? .stale
    }
    switch phase {
    case .loading, .ready: return .loading
    case .offline: return .offline
    case .error(let failure): return .error(failure)
    }
  }

  /// The footer's line while offline with an answer on screen: "You're offline. Showing the
  /// forecast from 9:05am GMT." (`AppCopy.offline`, with `UpdatedLine` at `now`). Nil when
  /// online, with no answer, or for an answer without `updated`.
  public static func offlineLine(
    _ response: TodayResponse?,
    phase: AppPhase,
    at now: Date
  ) -> String? {
    guard phase == .offline, let response, let time = UpdatedLine.text(for: response, at: now)
    else { return nil }
    return AppCopy.offline(time: time)
  }
}
