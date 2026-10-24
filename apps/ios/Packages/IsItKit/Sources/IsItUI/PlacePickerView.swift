import IsItLogic
import IsItModel
import SwiftUI

/// What the place picker asks the app to do (iOS build spec, section 10.3). The picker keeps no
/// state of its own but the search box's text, which the app's model holds through `text`.
public struct PlacePickerActions {
  /// The keyboard's Search key: the first result.
  public var submit: () -> Void
  /// "Use my location".
  public var useMyLocation: () -> Void
  /// "Open Settings", while location access is off: the app's page in Settings.
  public var openSettings: () -> Void
  /// A search result.
  public var choose: (SearchResult) -> Void
  /// A recent place.
  public var chooseRecent: (RecentPlace) -> Void
  /// A recent place swiped away.
  public var removeRecent: (RecentPlace) -> Void
  /// Close.
  public var close: () -> Void

  public init(
    submit: @escaping () -> Void,
    useMyLocation: @escaping () -> Void,
    openSettings: @escaping () -> Void,
    choose: @escaping (SearchResult) -> Void,
    chooseRecent: @escaping (RecentPlace) -> Void,
    removeRecent: @escaping (RecentPlace) -> Void,
    close: @escaping () -> Void
  ) {
    self.submit = submit
    self.useMyLocation = useMyLocation
    self.openSettings = openSettings
    self.choose = choose
    self.chooseRecent = chooseRecent
    self.removeRecent = removeRecent
    self.close = close
  }
}

/// The place picker, a full-screen sheet (iOS build spec, section 10.3), drawn from IsItLogic's
/// `PlacePicker`: the search box in the navigation bar ("Town or city"), "Use my location" as
/// the first row, then the search's line or its results ("Leeds", with "England, United
/// Kingdom" beneath), or with nothing typed, the recent places under "Recent", each of which can
/// be swiped away. A native `List`, so it follows Dark Mode, Dynamic Type and the system's
/// accessibility settings; its secondary lines and its tint are `SheetStyle`'s, which meet WCAG
/// AA where the system's light ones don't.
public struct PlacePickerView: View {
  let picker: PlacePicker
  @Binding var text: String
  let actions: PlacePickerActions

  public init(picker: PlacePicker, text: Binding<String>, actions: PlacePickerActions) {
    self.picker = picker
    _text = text
    self.actions = actions
  }

  public var body: some View {
    NavigationStack {
      List {
        Section {
          locationRow
        }
        if let status = picker.status {
          Section {
            Text(verbatim: status)
              .foregroundStyle(SheetStyle.secondary)
              .accessibilityIdentifier("search-status")
          }
        }
        if !picker.results.isEmpty {
          Section {
            ForEach(picker.results) { row in
              Button {
                actions.choose(row.result)
              } label: {
                PlaceRowLabel(name: row.name, detail: row.detail)
              }
              .accessibilityIdentifier("result-\(row.id)")
            }
          }
        }
        if let heading = picker.recentHeading {
          Section {
            ForEach(picker.recents) { row in
              Button {
                actions.chooseRecent(row.place)
              } label: {
                PlaceRowLabel(name: row.name, detail: nil)
              }
              .accessibilityIdentifier("recent-\(row.id)")
            }
            .onDelete { offsets in
              let places = offsets.map { picker.recents[$0].place }
              for place in places { actions.removeRecent(place) }
            }
          } header: {
            // As written: section headers are capitalised otherwise.
            Text(verbatim: heading)
              .textCase(nil)
              .foregroundStyle(SheetStyle.secondary)
              .accessibilityIdentifier("recent-heading")
          }
        }
      }
      .listStyle(.insetGrouped)
      // A drag on the list puts the keyboard away, so the results under it can be read and the
      // audit reads them with it down; with the default, a drag on the results left the keyboard
      // up on PR #33's macOS run. The list bounces however short it is, so the drag is a scroll.
      .scrollDismissesKeyboard(.immediately)
      .scrollBounceBehavior(.always)
      .navigationTitle(Text(verbatim: picker.title))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button {
            actions.close()
          } label: {
            Text(verbatim: picker.close)
          }
          .accessibilityIdentifier("picker-close")
        }
      }
      .searchable(
        text: $text,
        placement: .navigationBarDrawer(displayMode: .always),
        prompt: Text(verbatim: picker.prompt)
      )
      .textInputAutocapitalization(.words)
      .autocorrectionDisabled()
      .onSubmit(of: .search) { actions.submit() }
    }
    // Use my location, Open Settings and Close: the system's blue gives 3.59:1 on the list's
    // background (`SheetStyle`).
    .tint(SheetStyle.accent)
  }

  /// "Use my location", with the line beneath it while the fix is out or when it came to
  /// nothing, and "Open Settings" while location access is off. The title wraps beside its icon
  /// as the other rows' text does: as a `Label`'s title, the picker's only one, it was the one text
  /// the audit expected to be clipped at larger sizes on PR #33's macOS run.
  @ViewBuilder private var locationRow: some View {
    let row = picker.location
    Button {
      actions.useMyLocation()
    } label: {
      HStack {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
          Image(systemName: "location.fill")
            .accessibilityHidden(true)
          Text(verbatim: row.title)
            .fixedSize(horizontal: false, vertical: true)
        }
        if row.busy {
          Spacer(minLength: 8)
          ProgressView()
        }
      }
    }
    .disabled(row.busy)
    .accessibilityIdentifier("picker-use-my-location")
    if let detail = row.detail {
      Text(verbatim: detail)
        .font(.subheadline)
        .foregroundStyle(SheetStyle.secondary)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("location-detail")
    }
    if let openSettings = row.openSettings {
      Button {
        actions.openSettings()
      } label: {
        Text(verbatim: openSettings)
      }
      .accessibilityIdentifier("open-settings")
    }
  }
}

/// A place's row: its name, and the region and country beneath when known. Read as one
/// element, the name first.
private struct PlaceRowLabel: View {
  let name: String
  let detail: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(verbatim: name)
        .foregroundStyle(.primary)
      if let detail {
        Text(verbatim: detail)
          .font(.subheadline)
          .foregroundStyle(SheetStyle.secondary)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentShape(Rectangle())
  }
}
