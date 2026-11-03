import IsItLogic
import IsItModel
import SwiftUI
import UIKit

/// What the place picker asks the app to do (iOS build spec, section 10.3; design 2.2). The picker
/// keeps no state of its own but the search box's text, which the app's model holds through
/// `text`, and which bell to give VoiceOver's focus back to once the purchase it opened closes.
public struct PlacePickerActions {
  /// The keyboard's Search key: the first result.
  public var submit: () -> Void
  /// "Use my location".
  public var useMyLocation: () -> Void
  /// "Open Settings", while location access is off: the app's page in Settings.
  public var openSettings: () -> Void
  /// "Open Settings" under a bell's tap that met notifications off for the app (phase 8.4b,
  /// `bell-open-settings`): the app's notification settings in Settings.
  public var openNotificationSettings: () -> Void
  /// A search result.
  public var choose: (SearchResult) -> Void
  /// A recent place.
  public var chooseRecent: (RecentPlace) -> Void
  /// A saved place.
  public var chooseSaved: (SavedPlace) -> Void
  /// A result's empty star: saves it, choosing nothing.
  public var saveResult: (SearchResult) -> Void
  /// A recent place's empty star, or "Save {place}" in its menu: it moves to Saved.
  public var saveRecent: (RecentPlace) -> Void
  /// A filled star, or "Remove {place} from saved places" in a saved place's menu: it goes back
  /// on top of Recent.
  public var unsave: (Target) -> Void
  /// "Delete" in a recent place's menu: it is forgotten.
  public var deleteRecent: (RecentPlace) -> Void
  /// A saved place's bell, or its label in the place's menu (phase 8.4b): its notifications on or
  /// off, or, without the purchase, the purchase's page over the picker. Nothing is chosen.
  public var toggleBell: (SavedPlace) -> Void
  /// Close.
  public var close: () -> Void

  public init(
    submit: @escaping () -> Void,
    useMyLocation: @escaping () -> Void,
    openSettings: @escaping () -> Void,
    openNotificationSettings: @escaping () -> Void,
    choose: @escaping (SearchResult) -> Void,
    chooseRecent: @escaping (RecentPlace) -> Void,
    chooseSaved: @escaping (SavedPlace) -> Void,
    saveResult: @escaping (SearchResult) -> Void,
    saveRecent: @escaping (RecentPlace) -> Void,
    unsave: @escaping (Target) -> Void,
    deleteRecent: @escaping (RecentPlace) -> Void,
    toggleBell: @escaping (SavedPlace) -> Void,
    close: @escaping () -> Void
  ) {
    self.submit = submit
    self.useMyLocation = useMyLocation
    self.openSettings = openSettings
    self.openNotificationSettings = openNotificationSettings
    self.choose = choose
    self.chooseRecent = chooseRecent
    self.chooseSaved = chooseSaved
    self.saveResult = saveResult
    self.saveRecent = saveRecent
    self.unsave = unsave
    self.deleteRecent = deleteRecent
    self.toggleBell = toggleBell
    self.close = close
  }
}

/// The place picker, a full-screen sheet in the website's look (`SearchSheet.astro`; DECISIONS,
/// "The iPhone app in the website's look", step 5), drawn from IsItLogic's `PlacePicker` on the
/// sheet surface: the band of the page on screen (`theme`), the website's `.sheet` gradient
/// (`SheetBackground`), every word in its ink and Bricolage, no cards and no hairlines. The title
/// row with its Close pill (`SheetHeader`) and the search box (`SearchBox`) stay put; beneath them
/// a page of rows scrolls: "Use my location", the search's line or its results, or with nothing
/// typed, the saved places under "Saved" and the recent places under "Recent", each place with
/// its star (PickerChrome.swift), and each saved place, a saved row or a saved result, with its
/// bell beside the star (phase 8.4b, design 2.2); then under the saved places the line that says
/// what a star and a bell do (`saved-line`, design 2.3), and once a bell's tap met notifications
/// off for the app, that line with Open Settings (`bell-denied`, `bell-open-settings`).
///
/// A locked bell asks the app for the purchase's page, which it opens over the picker
/// (`purchaseOpen`); once that closes, VoiceOver's focus goes back to the bell that opened it,
/// which the app's model has turned on meanwhile if the purchase was made there (decision 8).
///
/// A `ScrollView` and a `VStack`, every row made at once, not a `List`: a lazy container's text
/// was "partially unsupported" by the audit's Dynamic Type check though it grew (PR #33's runs),
/// and the saved places make the list longer than any the audit passed. So there are no swipes:
/// a recent place is saved by its star or its press-and-hold menu and forgotten by Delete there,
/// a saved place removed by its star or its menu, each item a VoiceOver action as well. The
/// keyboard stays down as the sheet opens, so Saved and Recent show whole, and a drag on the rows
/// puts it away. It follows the band if it changes while open, fading in 0.9 s as the pages do
/// (at once under Reduce Motion), and never Dark Mode: the system's parts on it (the status bar,
/// the keyboard, the spinner, the menus) take the band's colour scheme.
public struct PlacePickerView: View {
  let picker: PlacePicker
  @Binding var text: String
  let theme: PageTheme
  /// Whether the purchase's page is open over the picker, which a locked bell opened.
  let purchaseOpen: Bool
  let actions: PlacePickerActions

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  /// The bell VoiceOver's focus is on, or is to go to, by its identifier.
  @AccessibilityFocusState private var focusedBell: String?
  /// The identifier of the locked bell last tapped, whose purchase's page may be open: focus goes
  /// back to it as that page closes.
  @State private var lockedBell: String?

  public init(
    picker: PlacePicker, text: Binding<String>, theme: PageTheme, purchaseOpen: Bool = false,
    actions: PlacePickerActions
  ) {
    self.picker = picker
    _text = text
    self.theme = theme
    self.purchaseOpen = purchaseOpen
    self.actions = actions
  }

  public var body: some View {
    VStack(spacing: 0) {
      SheetHeader(title: picker.title, close: picker.close, action: actions.close)
      // Above the rows, not in a `safeAreaInset`, so no row runs under it (the Debug recorder's
      // lesson, DebugHooks.swift).
      SearchBox(text: $text, prompt: picker.prompt, clear: picker.clear, submit: actions.submit)
        .padding(.top, 12)
      ScrollView {
        rows
          .padding(.top, 12)
          .padding(.bottom, 24)
      }
      // A drag on the rows puts the keyboard away, so the results under it can be read and the
      // audit reads them with it down; with the default, a drag on the results left the keyboard
      // up on PR #33's macOS run. The rows bounce however few they are, so the drag is a scroll.
      .scrollDismissesKeyboard(.immediately)
      .scrollBounceBehavior(.always)
    }
    // The purchase's page has closed over the picker: VoiceOver's focus goes back to the bell
    // that opened it, which says what a tap now does.
    .onChange(of: purchaseOpen) { wasOpen, open in
      guard wasOpen, !open, let bell = lockedBell else { return }
      lockedBell = nil
      focusedBell = bell
    }
    .padding(.horizontal, 16)
    .padding(.top, 12)
    .foregroundStyle(theme.ink)
    .tint(theme.ink)
    .animation(fade, value: theme)
    .environment(\.colorScheme, theme.controls)
    .environment(\.pageTheme, theme)
    .environment(\.surface, .sheet)
    .background {
      ZStack {
        SheetBackground(theme: theme)
          .id(theme)
          .transition(.opacity)
      }
      .animation(fade, value: theme)
      // Decoration with no accessibility element, and no accessibility modifier here or in
      // `SheetBackground`: one on views without an element makes one (Backgrounds.swift).
    }
  }

  /// The band's cross-fade, none under Reduce Motion.
  private var fade: Animation? {
    reduceMotion ? nil : .easeInOut(duration: 0.9)
  }

  /// A change that moves a row between Saved and Recent, animated as the system animates one,
  /// at once under Reduce Motion.
  private func moving(_ change: () -> Void) {
    withAnimation(reduceMotion ? nil : .default, change)
  }

  /// A row's menu item and VoiceOver action: `run`, then VoiceOver told `words`, as after a star
  /// (`StarButton`), since the row moves or goes with the focus on it. Only here: the star posts
  /// its own, and runs the same `save` and `remove`, which post nothing.
  private func announcing(_ words: String, _ run: @escaping () -> Void) -> () -> Void {
    {
      run()
      UIAccessibility.post(notification: .announcement, argument: words)
    }
  }

  /// What a tap on `bell`, on the row identified as `row`, or its menu item, does: asks the app,
  /// which turns its notifications on or off, or, locked, opens the purchase's page over the
  /// picker, remembering the bell for the focus to come back to. Nothing is announced here: the
  /// app's model says what the tap came to once it knows (`BellButton`).
  private func tapping(_ bell: PlacePicker.Bell, row: String) -> () -> Void {
    {
      if bell.state == .locked { lockedBell = PlaceRow.bellIdentifier(row) }
      actions.toggleBell(bell.place)
    }
  }

  /// "Use my location", then the search's line, its results, or the saved and recent places;
  /// then, once a bell's tap met notifications off, that line, under the results while typing
  /// and under the saved places' lines otherwise.
  private var rows: some View {
    VStack(alignment: .leading, spacing: 0) {
      locationRows
      if let status = picker.status {
        PickerLine(text: status, identifier: "search-status")
      }
      ForEach(picker.results) { row in
        let identifier = "result-\(row.id)"
        PlaceRow(
          name: row.name,
          detail: row.detail,
          value: row.value,
          identifier: identifier,
          bell: row.bell,
          star: row.star,
          // A saved result's one item, its bell's; none for any other.
          menu: row.bell.map { [RowAction(label: $0.label, run: tapping($0, row: identifier))] }
            ?? [],
          bellFocus: $focusedBell,
          choose: { actions.choose(row.result) },
          toggleBell: { if let bell = row.bell { tapping(bell, row: identifier)() } },
          toggleStar: {
            // In place: the sheet stays open on the same results.
            if row.star?.saved == true {
              actions.unsave(Target(search: row.result))
            } else {
              actions.saveResult(row.result)
            }
          }
        )
      }
      savedRows
      bellDeniedRows
      recentRows
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  /// "Use my location", the website's first row: semibold, no icon, washed while pressed, with an
  /// ink spinner while the fix is out (when a second tap does nothing); then its line ("Finding
  /// you…", location access off, no fix) and, while access is off, "Open Settings", drawn as the
  /// pages draw a link.
  @ViewBuilder private var locationRows: some View {
    let row = picker.location
    Button(action: actions.useMyLocation) {
      HStack(spacing: 8) {
        Text(verbatim: row.title)
          .brandFont(.labelStrong)
          .fixedSize(horizontal: false, vertical: true)
        Spacer(minLength: 0)
        if row.busy {
          ProgressView()
        }
      }
      .padding(.horizontal, 8)
      .padding(.vertical, 10.4)
      .frame(maxWidth: .infinity, minHeight: HitTarget.minimum, alignment: .leading)
      .contentShape(Rectangle())
    }
    .buttonStyle(RowPressStyle(cornerRadius: 9.6))
    .disabled(row.busy)
    .accessibilityIdentifier("picker-use-my-location")
    if let detail = row.detail {
      PickerLine(text: detail, identifier: "location-detail")
    }
    if let openSettings = row.openSettings {
      WordsButton(action: actions.openSettings) {
        Text(verbatim: openSettings)
          .underline()
          .brandFont(.labelStrong)
      }
      .accessibilityIdentifier("open-settings")
      .padding(.horizontal, 8)
    }
  }

  /// With nothing typed, "Saved" and the saved places, each removed by its filled star or its
  /// menu's first item, and each with its bell, its menu's second item; the line once the list is
  /// full, then the line that says what a star and a bell do (design 2.3), whichever there are.
  @ViewBuilder private var savedRows: some View {
    if let heading = picker.savedHeading {
      PickerHeading(text: heading, identifier: "saved-heading")
    }
    ForEach(picker.saved) { row in
      let identifier = "saved-\(row.id)"
      let remove = { moving { actions.unsave(row.place.target) } }
      let bell = tapping(row.bell, row: identifier)
      PlaceRow(
        name: row.name,
        detail: row.detail,
        value: nil,
        identifier: identifier,
        bell: row.bell,
        star: row.star,
        menu: [
          RowAction(label: row.star.label, run: announcing(row.star.announcement, remove)),
          RowAction(label: row.bell.label, run: bell),
        ],
        bellFocus: $focusedBell,
        choose: { actions.chooseSaved(row.place) },
        toggleBell: bell,
        toggleStar: remove
      )
    }
    if let full = picker.savedFull {
      PickerLine(text: full, identifier: "saved-full")
    }
    if let line = picker.savedLine {
      PickerLine(text: line, identifier: "saved-line")
    }
  }

  /// Once a bell's tap met notifications off for the app in iOS Settings: "Notifications are off
  /// for this app in Settings.", then "Open Settings", drawn as the location's is, which opens
  /// the app's notification settings.
  @ViewBuilder private var bellDeniedRows: some View {
    if let denied = picker.bellDenied {
      PickerLine(text: denied.text, identifier: "bell-denied")
      WordsButton(action: actions.openNotificationSettings) {
        Text(verbatim: denied.openSettings)
          .underline()
          .brandFont(.labelStrong)
      }
      .accessibilityIdentifier("bell-open-settings")
      .padding(.horizontal, 8)
    }
  }

  /// With nothing typed and some to show, "Recent" and the recent places, each saved by its empty
  /// star or its menu, and forgotten by Delete in its menu.
  @ViewBuilder private var recentRows: some View {
    if let heading = picker.recentHeading {
      PickerHeading(text: heading, identifier: "recent-heading")
    }
    ForEach(picker.recents) { row in
      let save = { moving { actions.saveRecent(row.place) } }
      let delete = RowAction(
        label: picker.deleteRecent, destructive: true,
        run: announcing(row.deleted) { moving { actions.deleteRecent(row.place) } })
      PlaceRow(
        name: row.name,
        detail: row.detail,
        value: nil,
        identifier: "recent-\(row.id)",
        star: row.star,
        menu: row.star.map {
          [RowAction(label: $0.label, run: announcing($0.announcement, save)), delete]
        } ?? [delete],
        bellFocus: $focusedBell,
        choose: { actions.chooseRecent(row.place) },
        toggleStar: save
      )
    }
  }
}

/// A heading over a list of places, "Saved" or "Recent", as written (no capitals), with the
/// header trait so the rotor moves between the lists.
private struct PickerHeading: View {
  let text: String
  let identifier: String

  var body: some View {
    Text(verbatim: text)
      .brandFont(.heading)
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityAddTraits(.isHeader)
      .accessibilityIdentifier(identifier)
      .padding(.horizontal, 8)
      .padding(.top, 16)
      .padding(.bottom, 4)
  }
}

/// A line of words in place of rows, the website's `.status`: the search's line, the location's,
/// the saved places' full line and their line (`saved-line`), and a bell's tap's with
/// notifications off.
private struct PickerLine: View {
  let text: String
  let identifier: String

  var body: some View {
    Text(verbatim: text)
      .brandFont(.line)
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityIdentifier(identifier)
      .padding(.horizontal, 8)
      .padding(.vertical, 10.4)
  }
}
