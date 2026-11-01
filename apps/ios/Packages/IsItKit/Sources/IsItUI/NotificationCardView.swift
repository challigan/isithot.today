import IsItLogic
import SwiftUI
import UIKit

/// The Today card (spec 10.2, item 5): page content on the middle page, above the upgrade row,
/// never a screen before a prompt. A chip card (the page's opaque `chip`, corners of 24, padded
/// 18) with its line in `detail` and ink, then its buttons as bordered chips (`PillButton`, words
/// in `labelStrong`): side by side, or one under another when they don't fit, as at
/// accessibility sizes. Ink on the chip, and the border, are what the page surface's model
/// (`SURFACES.page`) holds, so the contrast proof can read every pixel of it. Top 28, bottom 0
/// (the upgrade row's own top 28 follows). One container (`notification-card`), its line a text
/// (`card-line`), each button its id. The line that comes after "Turn on" ("Done. …", or that
/// notifications are off for the app) is said to VoiceOver once, as Restore purchase's result
/// is.
public struct NotificationCardView: View {
  let card: NotificationCard
  let act: (NotificationCard.Action) -> Void

  @SurfaceTokens private var tokens
  /// "Turn on" was tapped here, and its line hasn't come yet.
  @State private var asked = false

  public init(card: NotificationCard, act: @escaping (NotificationCard.Action) -> Void) {
    self.card = card
    self.act = act
  }

  public var body: some View {
    let shape = RoundedRectangle(cornerRadius: SheetMetrics.cardRadius, style: .continuous)
    VStack(alignment: .leading, spacing: 14) {
      Text(verbatim: card.line)
        .paragraph()
        .accessibilityIdentifier("card-line")
      if !card.buttons.isEmpty {
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 10) {
            buttons
          }
          VStack(alignment: .leading, spacing: 10) {
            buttons
          }
        }
      }
    }
    .foregroundStyle(tokens.ink)
    .padding(18)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(tokens.chip, in: shape)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("notification-card")
    .padding(.top, 28)
    .onChange(of: card.line) { _, line in
      guard asked else { return }
      asked = false
      UIAccessibility.post(notification: .announcement, argument: line)
    }
  }

  /// The card's buttons, in order, each a bordered chip.
  private var buttons: some View {
    ForEach(card.buttons) { button in
      PillButton(.chip(minHeight: 44), .secondary, bordered: true) {
        if button.action == .turnOn { asked = true }
        act(button.action)
      } label: {
        Text(verbatim: button.title)
          .brandFont(.labelStrong)
      }
      .accessibilityIdentifier(button.id)
    }
  }
}
