import IsItLogic
import SwiftUI
import UIKit

/// The upgrade page (spec 10.5) in Settings' look, on the content surface, every part one the
/// audits already pass in Settings and the mail fallback: the title on the page; what the
/// purchase is, and Family Sharing once the product says it is shared, on a reading card; then
/// what can be done: a spinner while StoreKit hasn't answered, "Buy for £1.99" as the primary
/// pill (ink, its words in the pill colour, as "Copy address"), a card saying why it can't be
/// bought, or, once owned, nothing; the last outcome on a card, the thanks beside a seal; and
/// Restore purchase as a row of a card, as in Settings, its result beneath it. No price is typed
/// anywhere: it is StoreKit's, in `UpgradePage`. Settings pushes it on its own stack; the home
/// row and `willitsnow://upgrade` open it as a sheet of its own (`UpgradeSheetView`).
///
/// The page asks for the product again as it appears, and lets a failure's line and the restore
/// result go as it leaves (`UpgradeActions`). Its outcome is announced here, as it changes: one
/// upgrade page is on screen at a time, since Settings and the upgrade sheet are one
/// presentation. The restore result is announced by the `RestoreRow` that was tapped, so a
/// restore from the page pushed over Settings, whose own card shows the same result, is
/// announced once. The announcements are UIKit's, as the mail fallback's is.
struct UpgradeView: View {
  let page: UpgradePage
  let actions: UpgradeActions

  @SurfaceTokens private var tokens

  /// Spelt out, as `RowLabel`'s is.
  init(page: UpgradePage, actions: UpgradeActions) {
    self.page = page
    self.actions = actions
  }

  var body: some View {
    SheetPage(title: page.title) {
      ReadingCard {
        Text(verbatim: page.body)
          .paragraph()
          .accessibilityIdentifier("upgrade-body")
        if let familySharing = page.familySharing {
          Text(verbatim: familySharing)
            .paragraph()
            .accessibilityIdentifier("family-sharing")
        }
      }
      // Phase 7.3: the live widget previews go here, between what the purchase is and buying it.
      buying
      if let outcome = page.outcome {
        outcomeCard(outcome)
          .padding(.top, 14)
      }
      SheetCard {
        RestoreRow(row: page.restore, restore: actions.restore)
      }
      .padding(.top, SheetMetrics.sectionGap)
    }
    .task {
      actions.appeared()
    }
    .onDisappear {
      actions.disappeared()
    }
    .onChange(of: page.outcome) { _, outcome in
      if let outcome {
        UIAccessibility.post(notification: .announcement, argument: outcome)
      }
    }
  }

  /// Owned: nothing to buy, and the outcome is the thanks.
  private var owned: Bool {
    if case .none = page.buying { return true }
    return false
  }

  /// What can be done, 24 below the card: a spinner, in ink, while StoreKit hasn't answered; Buy,
  /// which takes no second tap while StoreKit's purchase is under way, its spinner then in the
  /// pill colour, as its words are; why it can't be bought, on a card; or, owned, nothing.
  @ViewBuilder private var buying: some View {
    switch page.buying {
    case .loading:
      ProgressView()
        .tint(tokens.ink)
        .frame(maxWidth: .infinity)
        .accessibilityIdentifier("upgrade-loading")
        .padding(.top, 24)
    case .button(let title, let busy):
      PillButton(.wide, .primary) {
        actions.buy()
      } label: {
        HStack(spacing: 10) {
          Text(verbatim: title)
            .brandFont(.labelStrong)
          if busy {
            ProgressView()
              .tint(tokens.selectedWords)
          }
        }
      }
      .disabled(busy)
      .accessibilityIdentifier("buy")
      .padding(.top, 24)
    case .line(let line):
      ReadingCard {
        Text(verbatim: line)
          .paragraph()
          .accessibilityIdentifier("upgrade-unavailable")
      }
      .padding(.top, 24)
    case .none:
      EmptyView()
    }
  }

  /// The last outcome on a reading card: once owned the thanks, beside a seal VoiceOver doesn't
  /// read; Ask to Buy's line while it waits; or StoreKit's own words for what went wrong.
  private func outcomeCard(_ outcome: String) -> some View {
    ReadingCard {
      HStack(alignment: .firstTextBaseline, spacing: 10) {
        if owned {
          Image(systemName: "checkmark.seal")
            .font(.body)
            .accessibilityHidden(true)
        }
        Text(verbatim: outcome)
          .paragraph()
          .accessibilityIdentifier("upgrade-outcome")
      }
    }
  }
}

/// Restore purchase as a row of a card, on the upgrade page and on Settings' upgrade card: the
/// whole row a button (`SheetRowStyle`), its icon leading and no end, as it neither opens a page
/// nor leaves the app, taking no tap while it restores. Its result is its detail line, beneath
/// the title, and its accessibility value, which the UI tests read; the title alone is its label.
/// Only the row that was tapped says the result to VoiceOver when it comes, so Settings' row and
/// the page's, showing the same result, never both speak.
struct RestoreRow: View {
  let row: SettingsScreen.Row
  let restore: () -> Void

  /// This row was tapped, and the restore it asked for hasn't finished.
  @State private var asked = false

  /// Spelt out, as `RowLabel`'s is.
  init(row: SettingsScreen.Row, restore: @escaping () -> Void) {
    self.row = row
    self.restore = restore
  }

  var body: some View {
    Button {
      asked = true
      restore()
    } label: {
      RowLabel(title: row.title, detail: row.detail, icon: row.icon, end: .none)
    }
    .buttonStyle(SheetRowStyle())
    .disabled(row.busy)
    .accessibilityLabel(Text(verbatim: row.title))
    .accessibilityValue(Text(verbatim: row.detail ?? ""))
    .accessibilityIdentifier(row.id)
    .onChange(of: row) { before, now in
      // The restore is over, or its result came with no restoring seen between: the result, if
      // there is one (a cancelled sign-in has none), is said once.
      guard asked, !now.busy, before.busy || now.detail != before.detail else { return }
      asked = false
      if let detail = now.detail {
        UIAccessibility.post(notification: .announcement, argument: detail)
      }
    }
  }
}

/// The upgrade page as a sheet of its own, from the home row and `willitsnow://upgrade`: the page
/// on its own stack, with Close at the top right (`close-upgrade`), at full height as the mail
/// fallback is. Settings pushes the same page on its own stack instead, so the page is never a
/// sheet over a sheet.
public struct UpgradeSheetView: View {
  let page: UpgradePage
  let actions: UpgradeActions

  @Environment(\.dismiss) private var dismiss

  public init(page: UpgradePage, actions: UpgradeActions) {
    self.page = page
    self.actions = actions
  }

  public var body: some View {
    NavigationStack {
      UpgradeView(page: page, actions: actions)
        .toolbar {
          SheetCloseButton(title: page.close, identifier: "close-upgrade") {
            dismiss()
          }
        }
    }
    // A sheet of its own, so the content surface and its chrome are given again.
    .sheetChrome()
  }
}
