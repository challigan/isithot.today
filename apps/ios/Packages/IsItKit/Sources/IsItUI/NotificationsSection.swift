import IsItLogic
import SwiftUI

/// Settings → Notifications (iOS build spec, section 12.1), between the units and the upgrade
/// card, in Settings' own parts: its heading (`notifications-heading`), then one card holding,
/// in order, the notice (the gate's line at approximate location, or that notifications are off
/// for the app), the items (each switch, the place, which pushes the place page, and the rows
/// that act: the gate's "Use my location" and "Search", Open Settings, and the test with its
/// result), the status line, the footer, and for a UK place "Met Office warnings", which opens in
/// Safari. Every line that can wrap is on the card, never the page. Everything shown is
/// `NotificationSettings`'; the views keep no state, and hand each tap to the model
/// (`NotificationActions`). The permission is read again as the section appears, so a change
/// made in iOS Settings shows when Settings opens.
struct NotificationsSection: View {
  let settings: NotificationSettings
  let actions: NotificationActions

  @Environment(\.openURL) private var openURL

  var body: some View {
    SheetSection(header: settings.heading, headerID: "notifications-heading") {
      if let notice = settings.notice {
        Text(verbatim: notice.text)
          .paragraph()
          .padding(.horizontal, SheetMetrics.rowInset)
          .padding(.vertical, 16)
          .accessibilityIdentifier(notice.id)
        SheetDivider()
      }
      ForEach(Array(settings.items.enumerated()), id: \.element.id) { index, item in
        if index > 0 {
          SheetDivider(afterIcon: true)
        }
        itemView(item)
      }
      if let status = settings.status {
        SheetDivider()
        CardFootnote(line: status)
      }
      SheetDivider()
      CardFootnote(line: settings.footer)
      if let warnings = settings.warnings, case .open(let url) = warnings.action {
        SheetDivider()
        Button {
          openURL(url)
        } label: {
          RowLabel(title: warnings.title, icon: warnings.icon, end: .leaves)
        }
        .buttonStyle(SheetRowStyle())
        .accessibilityIdentifier(warnings.id)
      }
    }
    .task { actions.appeared() }
  }

  /// An item as its kind has it: a switch, the place's row, or a row that acts.
  @ViewBuilder private func itemView(_ item: NotificationSettings.Item) -> some View {
    switch item {
    case .toggle(let row):
      SwitchRow(row: row, set: actions.setSwitch)
    case .place(let row):
      NotificationPlaceRow(row: row)
    case .row(let row):
      actionRow(row)
    }
  }

  /// A row that acts: the test is Restore purchase's kind of row (`RestoreRow`), its result its
  /// detail and value, said once when it comes, taking no tap while it sends; the gate's two have
  /// no end, as they open the picker over Settings' place; Open Settings leaves the app.
  @ViewBuilder private func actionRow(_ row: SettingsScreen.Row) -> some View {
    switch row.action {
    case .notification(.sendTest):
      RestoreRow(row: row) { actions.perform(.sendTest) }
    case .notification(let action):
      Button {
        actions.perform(action)
      } label: {
        RowLabel(title: row.title, icon: row.icon, end: Self.end(of: action))
      }
      .buttonStyle(SheetRowStyle())
      .accessibilityIdentifier(row.id)
    default:
      EmptyView()
    }
  }

  /// Open Settings leaves the app (an arrow out); the rest stay in it (no end).
  private static func end(of action: SettingsScreen.NotificationAction) -> RowEnd {
    switch action {
    case .openNotificationSettings, .openLocationSettings: .leaves
    case .sendTest, .useMyLocation, .search, .choose: .none
    }
  }
}

/// A notification switch: a Toggle in the app's own style (`SheetSwitchStyle`), not UIKit's
/// switch. VoiceOver reads its title, its note and on or off; XCUITest finds it by its
/// identifier, with the value "0" or "1", and a tap at its centre turns it over, since the whole
/// row is its button. The binding's setter only asks the model; the switch shows what the model
/// then holds, so a refused permission leaves it off.
struct SwitchRow: View {
  let row: NotificationSettings.Switch
  let set: (AlertSwitch, Bool) -> Void

  var body: some View {
    Toggle(isOn: Binding(get: { row.isOn }, set: { @MainActor in set(row.kind, $0) })) {
      RowLabel(title: row.title, detail: row.note, icon: row.icon, end: .none)
    }
    .toggleStyle(SheetSwitchStyle())
    .accessibilityIdentifier(row.id)
  }
}

/// The notification place's row: its title, the place's name as its value ("Leeds", or "Your
/// location" while it follows the phone, with that note beneath), and a chevron, pushing the
/// place page on Settings' stack. The value is its accessibility value too, which the UI tests
/// read.
struct NotificationPlaceRow: View {
  let row: NotificationSettings.PlaceRow

  var body: some View {
    NavigationLink(value: SettingsPage.notificationPlace) {
      RowLabel(title: row.title, detail: row.note, icon: row.icon, end: .page, value: row.value)
    }
    .buttonStyle(SheetRowStyle())
    .accessibilityValue(Text(verbatim: row.value ?? ""))
    .accessibilityIdentifier(row.id)
  }
}

/// A line under a card's rows (the status line, the footer), as the units' footnote is: `note`
/// in `soft`, wrapping, 18 in from the card's sides.
private struct CardFootnote: View {
  let line: NotificationSettings.Line

  @SurfaceTokens private var tokens

  var body: some View {
    Text(verbatim: line.text)
      .brandFont(.note)
      .foregroundStyle(tokens.soft)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.horizontal, SheetMetrics.rowInset)
      .padding(.vertical, 16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityIdentifier(line.id)
  }
}

extension NotificationSettings.Item {
  /// The item's accessibility identifier, which tells the items apart.
  fileprivate var id: String {
    switch self {
    case .toggle(let row): row.id
    case .place(let row): row.id
    case .row(let row): row.id
    }
  }
}
