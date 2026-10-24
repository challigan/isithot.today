import Foundation
import IsItLogic
import IsItModel

/// What VoiceOver is told when the answer on screen changes (iOS build spec, sections 9.5 and
/// 16): once, with the page's heading and its verdict ("Durham. Will it snow tomorrow? Yes. It'll
/// snow."), as the website's live region, which holds the two (`#live`, aria-atomic), tells a
/// screen reader. The home screen hands it the page on screen each time it draws one (each
/// minute's tick, and each change of the model) and posts what it returns as an announcement.
public struct Announcements: Sendable, Equatable {
  /// The page on screen when it was last drawn: its view, what it says, and whether it was
  /// checking (the loading state, with no answer yet).
  private struct Heard: Sendable, Equatable {
    let view: AppView
    let said: String
    let checking: Bool
  }

  private var heard: Heard?

  public init() {}

  /// The page on screen has been drawn: what to announce, or nil. Nothing for the first page
  /// drawn, which VoiceOver reads as it comes; nothing for the same heading and verdict again (a
  /// minute's tick, or a refresh, that changed nothing they say); nothing for another view after
  /// an answer (the user moved to it, a route or the return after a long time away chose it, and
  /// VoiceOver reads it from there); and nothing while the page is checking, since "Checking…" is
  /// not an answer. Otherwise the new heading and verdict, once: the answer arriving after the
  /// loading state (on whichever view it opens), a refresh's new answer or its failure with
  /// nothing to show, the hour picked changing the answer or the verdict, Tomorrow from 6pm, or
  /// no recent forecast once the answer's hours run out.
  ///
  /// Under a sheet (`covered`: Settings or the picker open over the pages, which are then out of
  /// the accessibility tree) nothing is said, so VoiceOver never speaks a hidden page over the
  /// sheet; the page is still noted as heard, so nothing from under the sheet is said late once
  /// it closes (VoiceOver reads the page from there), and the next change after it is.
  public mutating func drawn(_ page: HomePage, covered: Bool = false) -> String? {
    let now = Heard(view: page.view, said: Self.said(page), checking: page.state == .loading)
    defer { heard = now }
    guard !covered, let last = heard, !now.checking, last.view == now.view || last.checking,
      !last.said.utf8.elementsEqual(now.said.utf8)
    else { return nil }
    return now.said
  }

  /// What a page says to VoiceOver as it changes: its heading, then its verdict when it has one.
  private static func said(_ page: HomePage) -> String {
    guard let verdict = page.verdict else { return page.headingLabel }
    return AppCopy.announcement(heading: page.headingLabel, verdict: verdict)
  }
}
