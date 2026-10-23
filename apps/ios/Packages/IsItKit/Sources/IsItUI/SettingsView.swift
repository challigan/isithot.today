import IsItLogic
import IsItModel
import SwiftUI

/// The Settings sheet (iOS build spec, section 10.4): a native form, in system materials that
/// follow Dark Mode, with the snow units, the privacy rows, Report an ad in the free version,
/// About and Help, and the version. Pages open on the sheet's own stack (Your privacy, How it
/// works, Credits and licences); willitsnow.today's pages open in Safari and the emails in the
/// mail app, through `openURL`, and with no mail app the fallback sheet says where to write.
/// Everything shown is the presenters'.
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
      Form {
        Section {
          UnitsRow(control: screen.units, setUnits: actions.setUnits)
        } footer: {
          Text(verbatim: screen.units.footnote)
        }
        ForEach(screen.sections) { section in
          Section {
            ForEach(section.rows) { row in
              rowView(row)
            }
          } header: {
            if let heading = section.heading {
              Text(verbatim: heading)
            }
          }
        }
        if let version = screen.version {
          Section {
            Text(verbatim: version)
              .accessibilityIdentifier("version")
          }
        }
      }
      .navigationTitle(Text(verbatim: screen.title))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button {
            dismiss()
          } label: {
            Text(verbatim: screen.close)
          }
          .accessibilityIdentifier("close-settings")
        }
      }
      .navigationDestination(for: SettingsPage.self) { page in
        destination(page)
      }
    }
    .sheet(item: $fallback) { fallback in
      MailFallbackView(fallback: fallback, copy: actions.copy)
    }
  }

  /// A row as its action has it: a page on the stack, a web page or an email (each marked as
  /// leaving the app), or Google's form.
  @ViewBuilder private func rowView(_ row: SettingsScreen.Row) -> some View {
    switch row.action {
    case .page(let page):
      NavigationLink(value: page) {
        Text(verbatim: row.title)
      }
      .accessibilityIdentifier(row.id)
    case .open(let url):
      Button {
        openURL(url)
      } label: {
        LeavingRow(title: row.title)
      }
      .accessibilityIdentifier(row.id)
    case .mail(let draft):
      Button {
        send(draft)
      } label: {
        LeavingRow(title: row.title)
      }
      .accessibilityIdentifier(row.id)
    case .reportAd:
      Button {
        send(actions.reportAd())
      } label: {
        LeavingRow(title: row.title)
      }
      .accessibilityIdentifier(row.id)
    case .privacyChoices:
      if let privacyChoices = actions.privacyChoices {
        Button {
          privacyChoices()
        } label: {
          Text(verbatim: row.title)
        }
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

/// "Snow units" with its cm | in control, side by side, or one over the other at accessibility
/// sizes. VoiceOver reads the control by the label; nothing is chosen before the first answer
/// chose the units.
struct UnitsRow: View {
  let control: SettingsScreen.UnitsControl
  let setUnits: (Units) -> Void

  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    let stacked = typeSize.isAccessibilitySize
    let layout =
      stacked
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
      : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
    layout {
      Text(verbatim: control.label)
        .accessibilityHidden(true)
      if !stacked {
        Spacer(minLength: 0)
      }
      Picker(selection: selection) {
        ForEach(control.choices) { choice in
          Text(verbatim: choice.name)
            .tag(Optional(choice.units))
        }
      } label: {
        Text(verbatim: control.label)
      }
      .pickerStyle(.segmented)
      .fixedSize()
      .accessibilityLabel(Text(verbatim: control.label))
      .accessibilityIdentifier("units")
    }
  }

  private var selection: Binding<Units?> {
    Binding(
      get: { control.selected },
      set: { units in
        if let units { setUnits(units) }
      }
    )
  }
}

/// A row that leaves the app, for Safari or the mail app: its title, and an arrow out that
/// VoiceOver doesn't read.
struct LeavingRow: View {
  let title: String

  var body: some View {
    HStack(spacing: 8) {
      Text(verbatim: title)
      Spacer(minLength: 0)
      Image(systemName: "arrow.up.forward")
        .font(.footnote.weight(.semibold))
        .foregroundStyle(.secondary)
        .accessibilityHidden(true)
    }
    .contentShape(Rectangle())
  }
}

/// What shows when no mail app can open an email (section 10.7): where to write, and "Copy
/// address", which says "Copied." once it has, on screen and to VoiceOver.
struct MailFallbackView: View {
  let fallback: MailFallback
  let copy: @MainActor (String) -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var copied = false

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text(verbatim: fallback.body)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("fallback-body")
          Button {
            copy(fallback.address)
            copied = true
            AccessibilityNotification.Announcement(fallback.copied).post()
          } label: {
            Text(verbatim: fallback.copyAddress)
          }
          .buttonStyle(.borderedProminent)
          .accessibilityIdentifier("copy-address")
          if copied {
            Text(verbatim: fallback.copied)
              .accessibilityIdentifier("copied")
          }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .navigationTitle(Text(verbatim: fallback.title))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button {
            dismiss()
          } label: {
            Text(verbatim: fallback.close)
          }
          .accessibilityIdentifier("close-fallback")
        }
      }
    }
    .presentationDetents([.medium, .large])
  }
}
