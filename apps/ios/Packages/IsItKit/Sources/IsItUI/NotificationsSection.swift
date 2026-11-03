import IsItLogic
import SwiftUI

/// Settings → Notifications (design 2.4), between the units and the upgrade card, in Settings'
/// own parts: its heading (`notifications-heading`), then one card holding, in order, the notice
/// (that notifications are off for the app), the items (Open Settings while they are; each
/// switch; the line that says what is kept for where you are (`notify-here-kept`); "Where you
/// are", its town and how it was found, which pushes its page (`notify-here`); "Saved places",
/// how many saved places' bells are on, which opens the search screen where the bells are, or
/// without the purchase what it takes, which pushes the purchase's page (`notify-saved`, phase
/// 8.4b); and the test with its result), the status line, the footer, and while where you are or
/// a saved place with its bell on is in the UK "Met Office warnings", which opens in Safari. Every line that can wrap is on the card, never the page.
/// Everything shown is `NotificationSettings`'; the views keep no state, and hand each tap to the
/// model (`NotificationActions`). The permission is read again as the section appears, so a
/// change made in iOS Settings shows when Settings opens.
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
          SheetDivider(afterIcon: Self.afterIcon(settings.items[index - 1], item))
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

  /// An item as its kind has it: a switch, the kept line, "Where you are", "Saved places", or a
  /// row that acts.
  @ViewBuilder private func itemView(_ item: NotificationSettings.Item) -> some View {
    switch item {
    case .toggle(let row):
      SwitchRow(row: row, set: actions.setSwitch)
    case .line(let line):
      CardFootnote(line: line)
    case .here(let row):
      HereRowView(row: row)
    case .savedRow(let row):
      SavedRowView(row: row, perform: actions.perform)
    case .row(let row):
      actionRow(row)
    }
  }

  /// The hairline between two items: past the icons' column between two rows with icons; from
  /// the card's inset where either is the kept line, whose words start there.
  private static func afterIcon(
    _ before: NotificationSettings.Item, _ item: NotificationSettings.Item
  ) -> Bool {
    switch (before, item) {
    case (.line, _), (_, .line): false
    default: true
    }
  }

  /// A row that acts: the test is Restore purchase's kind of row (`RestoreRow`), its result its
  /// detail and value, said once when it comes, taking no tap while it sends; Open Settings
  /// leaves the app.
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

  /// Open Settings leaves the app (an arrow out); "Saved places" opens the search screen (a
  /// chevron, as `SavedRowView` draws it); the rest stay where they are (no end).
  private static func end(of action: SettingsScreen.NotificationAction) -> RowEnd {
    switch action {
    case .openNotificationSettings, .openLocationSettings: .leaves
    case .savedPlaces: .page
    case .sendTest, .useMyLocation: .none
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

/// "Where you are" (`notify-here`): its title, how it was found as its note ("Your location",
/// "Approximate, from your internet connection" or "Not found yet"), the town the server named as
/// its value ("Leeds", none before it has), and a chevron, pushing the "Where you are" page on
/// Settings' stack. The town is its accessibility value alone (`RowLabel` hides the drawn one),
/// which the UI tests read, so VoiceOver says it once, after the label's title and note.
struct HereRowView: View {
  let row: NotificationSettings.HereRow

  var body: some View {
    NavigationLink(value: SettingsPage.notificationPlace) {
      RowLabel(title: row.title, detail: row.note, icon: row.icon, end: .page, value: row.value)
    }
    .buttonStyle(SheetRowStyle())
    .accessibilityValue(Text(verbatim: row.value ?? ""))
    .accessibilityIdentifier(row.id)
  }
}

/// "Saved places" (`notify-saved`, phase 8.4b; design 2.4, decision 13): its title, its value
/// ("2 on", "Off", or "With the one-off purchase") and a chevron. With the purchase it opens the
/// search screen, where each saved place's bell is (Settings closes, then the picker opens:
/// `.notification(.savedPlaces)`); without it, it pushes the purchase's page on Settings' stack, as
/// the upgrade row does (`.page(.upgrade)`). The value is its accessibility value alone
/// (`RowLabel` hides the drawn one), which the UI tests read, so VoiceOver says it once.
struct SavedRowView: View {
  let row: NotificationSettings.SavedRow
  let perform: (SettingsScreen.NotificationAction) -> Void

  var body: some View {
    link
      .buttonStyle(SheetRowStyle())
      .accessibilityValue(Text(verbatim: row.value))
      .accessibilityIdentifier(row.id)
  }

  /// The row as its action has it: a page pushed on Settings' stack, or the model asked.
  @ViewBuilder private var link: some View {
    switch row.action {
    case .page(let page):
      NavigationLink(value: page) { label }
    case .notification(let action):
      Button {
        perform(action)
      } label: {
        label
      }
    default:
      label
    }
  }

  private var label: some View {
    RowLabel(title: row.title, icon: row.icon, end: .page, value: row.value)
  }
}

/// A line of words on a card (the kept line among the items, the status line, the footer), as
/// the units' footnote is: `note` in `soft`, wrapping, 18 in from the card's sides.
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
    case .line(let line): line.id
    case .here(let row): row.id
    case .savedRow(let row): row.id
    case .row(let row): row.id
    }
  }
}
