import IsItLogic
import IsItModel
import SwiftUI
import UIKit

/// The Settings sheet (iOS build spec, section 10.4) in the website's look (DECISIONS, "The
/// iPhone app in the website's look", step 6): the website's content pages' palette, fixed and
/// the same in both appearances, with the title on the page; the snow units on a card with the
/// website's cm | in pill; the privacy rows, Report an ad in the free version, About and Help, as
/// rows with icons on plum cards under their headings; and the version. A page that scrolls
/// (`SheetPage`), not a `Form`, whose cells the audit failed on PR #33's runs though they grew;
/// section 10.4's order and contents are kept, its native form and Dark Mode are not. Pages open
/// on the sheet's own stack (Your privacy, How it works, Credits and licences); willitsnow.today's
/// pages open in Safari and the emails in the mail app, through `openURL`, and with no mail app
/// the fallback sheet says where to write. Everything shown is the presenters'.
public struct SettingsView: View {
  let screen: SettingsScreen
  let privacy: YourPrivacy
  let actions: SettingsActions

  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  /// The mail fallback on screen, after an email no mail app could open.
  @State private var fallback: MailFallback?

  public init(screen: SettingsScreen, privacy: YourPrivacy, actions: SettingsActions) {
    self.screen = screen
    self.privacy = privacy
    self.actions = actions
  }

  public var body: some View {
    NavigationStack {
      SheetPage(title: screen.title) {
        UnitsCard(control: screen.units, setUnits: actions.setUnits)
        ForEach(screen.sections) { section in
          // A heading only for a section with one: Report an ad's has none, and follows closer.
          SheetSection(header: section.heading) {
            rows(section)
          }
          .padding(.top, section.heading == nil ? 16 : SheetMetrics.sectionGap)
        }
        if let version = screen.version {
          // One line on the page, so on the gradient (10.51:1 where it sits).
          Text(verbatim: version)
            .brandFont(.note)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("version")
            .padding(.top, SheetMetrics.sectionGap)
        }
      }
      .toolbar {
        SheetCloseButton(title: screen.close, identifier: "close-settings") {
          dismiss()
        }
      }
      .navigationDestination(for: SettingsPage.self) { page in
        destination(page)
      }
    }
    .sheetChrome()
    .sheet(item: $fallback) { fallback in
      MailFallbackView(fallback: fallback, copy: actions.copy)
    }
  }

  /// A section's rows, a hairline between each two: those it shows, "Privacy choices" only with
  /// Google's form to open.
  @ViewBuilder private func rows(_ section: SettingsScreen.Section) -> some View {
    let shown = section.rows.filter { row in
      guard case .privacyChoices = row.action else { return true }
      return actions.privacyChoices != nil
    }
    ForEach(Array(shown.enumerated()), id: \.element.id) { index, row in
      if index > 0 {
        SheetDivider(afterIcon: true)
      }
      rowView(row)
    }
  }

  /// A row as its action has it, the whole row a button at least `SheetMetrics.rowHeight` tall
  /// (`SheetRowStyle`), its icon leading and its end saying what it does: a page on the stack (a
  /// chevron), a web page or an email (an arrow out), or Google's form (neither).
  @ViewBuilder private func rowView(_ row: SettingsScreen.Row) -> some View {
    switch row.action {
    case .page(let page):
      NavigationLink(value: page) {
        RowLabel(title: row.title, icon: row.icon, end: .page)
      }
      .buttonStyle(SheetRowStyle())
      .accessibilityIdentifier(row.id)
    case .open(let url):
      Button {
        openURL(url)
      } label: {
        RowLabel(title: row.title, icon: row.icon, end: .leaves)
      }
      .buttonStyle(SheetRowStyle())
      .accessibilityIdentifier(row.id)
    case .mail(let draft):
      Button {
        send(draft)
      } label: {
        RowLabel(title: row.title, icon: row.icon, end: .leaves)
      }
      .buttonStyle(SheetRowStyle())
      .accessibilityIdentifier(row.id)
    case .reportAd:
      Button {
        send(actions.reportAd())
      } label: {
        RowLabel(title: row.title, icon: row.icon, end: .leaves)
      }
      .buttonStyle(SheetRowStyle())
      .accessibilityIdentifier(row.id)
    case .privacyChoices:
      if let privacyChoices = actions.privacyChoices {
        Button {
          privacyChoices()
        } label: {
          RowLabel(title: row.title, icon: row.icon, end: .none)
        }
        .buttonStyle(SheetRowStyle())
        .accessibilityIdentifier(row.id)
      }
    }
  }

  @ViewBuilder private func destination(_ page: SettingsPage) -> some View {
    switch page {
    case .yourPrivacy:
      YourPrivacyView(page: privacy, deleteMyData: actions.deleteMyData)
    case .howItWorks:
      HowItWorksView(page: HowItWorks())
    case .credits:
      CreditsView(page: CreditsPage(), notice: actions.notice)
    }
  }

  /// Opens `draft` in the mail app, or, when none can (section 10.7), the fallback sheet.
  private func send(_ draft: MailDraft) {
    guard let url = draft.url else {
      fallback = draft.fallback
      return
    }
    openURL(url) { accepted in
      if !accepted { fallback = draft.fallback }
    }
  }
}

/// The units' card: "Snow units" with its control (`UnitsRow`), then the footnote, which can
/// wrap, so it is on the card in `note` and `soft` (10.62:1), never on the page.
struct UnitsCard: View {
  let control: SettingsScreen.UnitsControl
  let setUnits: (Units) -> Void

  @SurfaceTokens private var tokens

  /// Spelt out, as `RowLabel`'s is.
  init(control: SettingsScreen.UnitsControl, setUnits: @escaping (Units) -> Void) {
    self.control = control
    self.setUnits = setUnits
  }

  var body: some View {
    SheetCard {
      UnitsRow(control: control, setUnits: setUnits)
      Text(verbatim: control.footnote)
        .brandFont(.note)
        .foregroundStyle(tokens.soft)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, SheetMetrics.rowInset)
        .padding(.bottom, 16)
    }
  }
}

/// "Snow units" with its cm | in control: the ruler, the label and the control on one line, or
/// at accessibility sizes, with no icon, the label over the control. VoiceOver reads the label,
/// then each choice; nothing is chosen before the first answer chose the units.
struct UnitsRow: View {
  let control: SettingsScreen.UnitsControl
  let setUnits: (Units) -> Void

  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    let stacked = typeSize.isAccessibilitySize
    let layout =
      stacked
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
      : AnyLayout(HStackLayout(alignment: .center, spacing: SheetMetrics.iconGap))
    layout {
      if !stacked {
        RowIcon(icon: control.icon)
      }
      Text(verbatim: control.label)
        .brandFont(.row)
        .fixedSize(horizontal: false, vertical: true)
      if !stacked {
        Spacer(minLength: 0)
      }
      UnitsSegments(control: control, setUnits: setUnits)
    }
    .sheetRow()
  }
}

/// The cm | in control, the website's `.units` pill sized for touch (`PillSegments`): the wash's
/// track on the card, the chosen unit on an ink thumb in the pill colour (11.54:1), the other in
/// ink on the track (10.00:1), each segment at least 56 by 44 and hugging its word. Not UIKit's
/// segmented control, which keeps its own type size as the text grows; these words grow with the
/// page's, so Settings' audit, which allows nothing, has nothing to allow. The thumb slides when
/// the model has saved the choice, not at the tap. It is still two buttons in a group, each
/// `.isSelected` when chosen, which the UI tests find as `units`, by their words.
struct UnitsSegments: View {
  let control: SettingsScreen.UnitsControl
  let setUnits: (Units) -> Void

  var body: some View {
    // Optional ids, so that before the first answer chose the units no segment is chosen.
    PillSegments(
      control.choices.map { PillSegment(id: Optional($0.units), title: $0.name) },
      selected: control.selected,
      widths: .hugging(minWidth: 56),
      role: .labelStrong,
      inset: 3
    ) { units in
      if let units { setUnits(units) }
    }
    // Never squeezed: at accessibility sizes it has its own line.
    .fixedSize()
    // The choices' group, which the UI tests find by it.
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("units")
  }
}

/// What shows when no mail app can open an email (section 10.7), in Settings' look: its title on
/// the page, where to write on a reading card, "Copy address" as the website's selected pill
/// (ink, its words in the pill colour, 11.54:1), and once it has copied, "Address copied." on the
/// page and to VoiceOver. A sheet of its own at full height, as a sheet opens by default: at the
/// medium detent iOS 26 draws a sheet as a card inset over Settings, scaled to 96%, with Settings
/// showing through its glass, which the audit found on PR #33's macOS run as clipped text, text
/// no element holds, and Close short of contrast. Close is trailing, as Settings' is. The
/// announcement is UIKit's: iOS 17's `AccessibilityNotification` is the Accessibility framework's,
/// which SwiftUI isn't known to re-export.
struct MailFallbackView: View {
  let fallback: MailFallback
  let copy: @MainActor (String) -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var copied = false

  var body: some View {
    NavigationStack {
      SheetPage(title: fallback.title) {
        ReadingCard {
          Text(verbatim: fallback.body)
            .paragraph()
            .accessibilityIdentifier("fallback-body")
        }
        PillButton(.wide, .primary) {
          copy(fallback.address)
          copied = true
          UIAccessibility.post(notification: .announcement, argument: fallback.copied)
        } label: {
          HStack(spacing: 10) {
            Image(systemName: "doc.on.doc")
              .font(.callout)
              .accessibilityHidden(true)
            Text(verbatim: fallback.copyAddress)
              .brandFont(.labelStrong)
          }
        }
        .accessibilityIdentifier("copy-address")
        .padding(.top, 24)
        if copied {
          // "Address copied.", not section 10.9's "Copied.": the audit found that one word
          // with its full stop "not human-readable" on PR #33's two macOS runs, with the
          // identifier `copied` in the card the sheet was then drawn as, and with this one at
          // full height; every label of more than one word passed (packages/mobile appCopy.ts).
          // One line on the page, beside a tick VoiceOver doesn't read.
          HStack(spacing: 10) {
            Image(systemName: "checkmark")
              .font(.callout)
              .accessibilityHidden(true)
            Text(verbatim: fallback.copied)
              .brandFont(.label)
              .fixedSize(horizontal: false, vertical: true)
              .accessibilityIdentifier("copy-confirmation")
          }
          .padding(.top, 14)
        }
      }
      .toolbar {
        SheetCloseButton(title: fallback.close, identifier: "close-fallback") {
          dismiss()
        }
      }
    }
    // A sheet of its own, so the content surface and its chrome are given again.
    .sheetChrome()
  }
}
