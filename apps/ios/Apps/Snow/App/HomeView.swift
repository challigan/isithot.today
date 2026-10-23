import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItUI
import SnowKit
import SwiftUI

/// The home screen (iOS build spec, section 10.2): the top bar over the Today page, both made by
/// the app's model from its state (`AppModel.topBar`, `AppModel.page(_:at:)`, IsItLogic's
/// presenters) and drawn by IsItUI from those plain values and the actions. Only this file knows
/// the model. The minute tick (section 9.5) draws the page again each minute at the model's
/// clock, so the hour picked, Tomorrow from 6pm and the stale state follow the time while the
/// app is open. The top bar's two buttons open the two sheets (`HomeSheet`), one at a time: the
/// place button, and the approximate line's "Use my location", the place picker, full screen
/// (section 10.3, `PickerSheet`); the gear, Settings (section 10.4, `SettingsSheet`). The
/// switcher and the pager of Now, Today and This week come with phase 5.2.
struct HomeView: View {
  let model: AppModel
  /// The sheet open over the home screen, if any.
  @State private var sheet: HomeSheet?

  var body: some View {
    TimelineView(.everyMinute) { context in
      HomeContent(model: model, tick: context.date) { sheet = $0 }
    }
    // Both sheets are drawn outside the page's colours, so they follow the system's, and Dark
    // Mode; and both under the Debug recorder (`debugRecorder()`, DebugHooks.swift), so under
    // `-openURLs` every URL either would open is recorded instead, the picker's Open Settings
    // as well as Settings' rows. A Release build draws them as they are.
    .fullScreenCover(item: $sheet.picker) { request in
      PickerSheet(model: model, request: request)
        .debugRecorder()
    }
    .sheet(isPresented: $sheet.settings) {
      SettingsSheet(model: model)
        .debugRecorder()
    }
  }
}

/// The sheets the home screen opens, one at a time: the place picker (with why it opened) and
/// Settings.
enum HomeSheet: Equatable {
  case picker(PickerRequest)
  case settings
}

extension Optional where Wrapped == HomeSheet {
  /// The picker's request while the picker is open. Set to nil, as the sheet does when it
  /// closes, it closes the picker only.
  fileprivate var picker: PickerRequest? {
    get {
      guard case .picker(let request)? = self else { return nil }
      return request
    }
    set {
      if let newValue {
        self = .picker(newValue)
      } else if case .picker? = self {
        self = nil
      }
    }
  }

  /// Whether Settings is open. Set to false, as the sheet does when it closes, it closes
  /// Settings only.
  fileprivate var settings: Bool {
    get { self == .settings }
    set {
      if newValue {
        self = .settings
      } else if self == .settings {
        self = nil
      }
    }
  }
}

/// The screen at one minute's tick. Its body reads the model, so it is drawn again whenever the
/// model changes as well as each minute, always at the model's clock.
private struct HomeContent: View {
  let model: AppModel
  /// The minute tick's date: a new one each minute, which draws the screen again.
  let tick: Date
  /// Opens a sheet: the place picker, or Settings.
  let open: (HomeSheet) -> Void

  @Environment(\.openURL) private var openURL

  var body: some View {
    let page = model.page(.today, at: model.now)
    let theme = PageTheme(page.palette)
    HomeShell(topBar: model.topBar, theme: theme, actions: actions) {
      ForecastPageView(
        page: page,
        theme: theme,
        glyph: page.band.map { Glyphs.image($0) },
        actions: actions
      )
      // Pull to refresh (section 10.2), on the page's scroll view, keeping what is on screen.
      .refreshable { await model.refresh() }
    }
  }

  /// What the screen's taps do: Retry asks again; the place button opens the picker, and "Use
  /// my location" opens it finding the phone's place; the gear opens Settings; a place under
  /// "Nearby:" loads in place; links open in Safari.
  private var actions: HomeActions {
    let model = model
    let openURL = openURL
    let open = open
    return HomeActions(
      retry: { Task { await model.refresh() } },
      openPlacePicker: { open(.picker(PickerRequest(locating: false))) },
      openSettings: { open(.settings) },
      useMyLocation: { open(.picker(PickerRequest(locating: true))) },
      openLink: { openURL($0) },
      selectNearby: { city in
        Task { await model.select(.city(slug: city.slug, name: city.name)) }
      }
    )
  }
}

extension PageTheme {
  /// A band's palette as a page's colours.
  init(_ palette: IsItModel.Palette) {
    self.init(
      g1: Color(rgb: palette.g1),
      g2: Color(rgb: palette.g2),
      g3: Color(rgb: palette.g3),
      glow: palette.glow,
      ink: Color(rgb: palette.ink)
    )
  }
}
