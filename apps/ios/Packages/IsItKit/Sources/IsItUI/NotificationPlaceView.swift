import IsItLogic
import SwiftUI
import UIKit

/// "Where you are" (design 2.1), pushed on Settings' stack from Settings → Notifications' "Where
/// you are" row: a content page that says how where you are is found, how often it moves and how
/// long it is kept, on a reading card (`notify-place-about`); then a card with where you are now,
/// as Settings' row says it (`notify-place-here`: the town and how it was found, a line that
/// takes no tap), and while location access was never asked, or this session's tap found no fix,
/// "Use my location" under it (`notify-place-my-location`), which asks for location only at its
/// tap and takes no tap while it finds the phone. Why it found none on a card of its own
/// (`notify-place-problem`), and while location access is off for the app, Open Settings on a
/// card beneath (`notify-place-open-settings`). No place is chosen here. Once "Use my location",
/// tapped here, has where you are follow the phone (its row changed, with nothing left to do),
/// the page goes back to Settings, whose row then says so, as 8.1's place page did; access
/// allowed is not enough, as the fix comes after it. A tap that found no fix, or met access
/// turned off, stays, its line shown here and said to VoiceOver once. Everything shown is
/// `NotificationPlacePage`'s; each tap goes to the model (`NotificationActions`).
struct NotificationPlaceView: View {
  let page: NotificationPlacePage
  let actions: NotificationActions

  @Environment(\.dismiss) private var dismiss
  /// Where you are as this page showed it when "Use my location" was tapped here, until what the
  /// tap came to shows.
  @State private var tapped: NotificationSettings.HereRow?

  var body: some View {
    SheetPage(title: page.title) {
      ReadingCard {
        Text(verbatim: page.about.text)
          .paragraph()
          .accessibilityIdentifier(page.about.id)
      }
      SheetCard {
        HereLine(row: page.place)
        if let row = page.useMyLocation, case .notification(let action) = row.action {
          SheetDivider(afterIcon: true)
          Button {
            tapped = page.place
            actions.perform(action)
          } label: {
            RowLabel(title: row.title, icon: row.icon, end: .none)
          }
          .buttonStyle(SheetRowStyle())
          .disabled(row.busy)
          .accessibilityIdentifier(row.id)
        }
      }
      .padding(.top, 16)
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
    .onChange(of: page) { before, now in
      guard let tapped else { return }
      if let problem = now.problem, problem != before.problem {
        UIAccessibility.post(notification: .announcement, argument: problem.text)
      }
      guard now.useMyLocation == nil, now.problem == nil, now.place != tapped else { return }
      self.tapped = nil
      dismiss()
    }
    .task { actions.appeared() }
  }
}

/// Where you are on its page, as Settings' row says it but taking no tap: its icon, its title,
/// how it was found as its note, and the town as its value. One element to VoiceOver: its title
/// and note together as its label, and the town as its value alone (`RowLabel` hides the drawn
/// one), as the row's is, so it is said once.
private struct HereLine: View {
  let row: NotificationSettings.HereRow

  var body: some View {
    RowLabel(title: row.title, detail: row.note, icon: row.icon, end: .none, value: row.value)
      .sheetRow()
      .accessibilityElement(children: .combine)
      .accessibilityValue(Text(verbatim: row.value ?? ""))
      .accessibilityIdentifier(row.id)
  }
}
