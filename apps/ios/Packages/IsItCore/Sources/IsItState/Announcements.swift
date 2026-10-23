import Foundation
import IsItLogic
import IsItModel

/// What VoiceOver is told when the answer on screen changes (iOS build spec, sections 9.5 and
/// 16): once, with the page's new heading ("Durham. Will it snow tomorrow? Yes."), as the
/// website's live region tells a screen reader. The home screen hands it the page on screen each
/// time it draws one (each minute's tick, and each change of the model) and posts what it returns
/// as an announcement.
public struct Announcements: Sendable, Equatable {
  /// The page on screen when it was last drawn: its view and its heading.
  private struct Heard: Sendable, Equatable {
    let view: AppView
    let heading: String
  }

  private var heard: Heard?

  public init() {}

  /// The page on screen has been drawn: the heading to announce, or nil. Nothing for the first
  /// page drawn, which VoiceOver reads as it comes; nothing for the same heading again (a minute's
  /// tick, or a refresh, that changed nothing the heading says); nothing for another view (the
  /// user moved to it, or the return after a long time away chose it, and VoiceOver reads it from
  /// there); and nothing while the page is checking, since "Checking…" is not an answer.
  /// Otherwise the new heading, once: the answer arriving after the loading state, a refresh's
  /// new answer or its failure with nothing to show, the hour picked changing the answer,
  /// Tomorrow from 6pm, or no recent forecast once the answer's hours run out.
  public mutating func drawn(_ page: HomePage) -> String? {
    let now = Heard(view: page.view, heading: page.headingLabel)
    defer { heard = now }
    guard let last = heard, last.view == now.view, page.state != .loading,
      !last.heading.utf8.elementsEqual(now.heading.utf8)
    else { return nil }
    return now.heading
  }
}
