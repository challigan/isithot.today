import IsItLogic
import SwiftUI

/// "Notification place" (iOS build spec, section 12.1), pushed on Settings' stack from
/// Settings → Notifications' place row: a content page with one card of the choices (the place
/// kept, when it isn't the one on screen; the place on screen; the phone's location, followed),
/// each a row with its icon, the one in use ticked and selected to VoiceOver. A choice of a place
/// goes back to Settings at once; "Use my location" asks for location only at its tap, and goes
/// back once the place follows the phone, so that why it found none can show here instead: that
/// line on a card, with Open Settings on a card of its own beneath while location access is off.
/// Everything shown is `NotificationPlacePage`'s; each tap goes to the model
/// (`NotificationActions`).
struct NotificationPlaceView: View {
  let page: NotificationPlacePage
  let actions: NotificationActions

  @Environment(\.dismiss) private var dismiss
  /// "Use my location" was tapped here, and the place doesn't follow the phone yet.
  @State private var locating = false

  var body: some View {
    SheetPage(title: page.title) {
      SheetCard {
        ForEach(Array(page.choices.enumerated()), id: \.element.id) { index, choice in
          if index > 0 {
            SheetDivider(afterIcon: true)
          }
          ChoiceRow(choice: choice) { choose(choice) }
        }
      }
      if let problem = page.problem {
        ReadingCard {
          Text(verbatim: problem.text)
            .paragraph()
            .accessibilityIdentifier(problem.id)
        }
        .padding(.top, 16)
      }
      if let row = page.openSettings, case .notification(let action) = row.action {
        SheetCard {
          Button {
            actions.perform(action)
          } label: {
            RowLabel(title: row.title, icon: row.icon, end: .leaves)
          }
          .buttonStyle(SheetRowStyle())
          .accessibilityIdentifier(row.id)
        }
        .padding(.top, 16)
      }
    }
    .onChange(of: following) { _, follows in
      guard locating, follows else { return }
      locating = false
      dismiss()
    }
    .task { actions.appeared() }
  }

  /// Whether the phone's location is the choice in use.
  private var following: Bool {
    page.choices.contains { $0.choice == .myLocation && $0.selected }
  }

  /// Hands the choice to the model. A place, or the one already in use, goes back to Settings at
  /// once; "Use my location" waits for the place to follow the phone.
  private func choose(_ choice: NotificationPlacePage.Choice) {
    actions.perform(.choose(choice.choice))
    if choice.choice == .myLocation, !choice.selected {
      locating = true
    } else {
      dismiss()
    }
  }
}

/// A choice of the place page: the whole row its button (`SheetRowStyle`), its icon, title and
/// note, and when it is the one in use a tick in `affordance`, which VoiceOver doesn't read, as
/// the row is selected to it instead. It takes no tap while it finds the phone.
private struct ChoiceRow: View {
  let choice: NotificationPlacePage.Choice
  let action: () -> Void

  @SurfaceTokens private var tokens

  var body: some View {
    Button(action: action) {
      HStack(spacing: SheetMetrics.iconGap) {
        RowLabel(title: choice.title, detail: choice.note, icon: choice.icon, end: .none)
        if choice.selected {
          Image(systemName: "checkmark")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(tokens.affordance)
            .accessibilityHidden(true)
        }
      }
    }
    .buttonStyle(SheetRowStyle())
    .disabled(choice.busy)
    .accessibilityAddTraits(choice.selected ? .isSelected : [])
    .accessibilityIdentifier(choice.id)
  }
}
