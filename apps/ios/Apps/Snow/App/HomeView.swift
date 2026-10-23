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
/// app is open. The place and Settings buttons are here: the gear opens the Settings sheet
/// (`SettingsSheet`, phase 6.2); the picker's sheet comes with phase 6.1, and the switcher and
/// the pager of Now, Today and This week with phase 5.2.
struct HomeView: View {
  let model: AppModel

  /// Whether the Settings sheet is open (section 10.4).
  @State private var settingsOpen = false

  var body: some View {
    TimelineView(.everyMinute) { context in
      HomeContent(model: model, tick: context.date, openSettings: { settingsOpen = true })
    }
    .sheet(isPresented: $settingsOpen) {
      SettingsSheet(model: model)
    }
  }
}

/// The screen at one minute's tick. Its body reads the model, so it is drawn again whenever the
/// model changes as well as each minute, always at the model's clock.
private struct HomeContent: View {
  let model: AppModel
  /// The minute tick's date: a new one each minute, which draws the screen again.
  let tick: Date
  /// The gear: opens the Settings sheet.
  let openSettings: () -> Void

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

  /// What the screen's taps do: Retry asks again; a place under "Nearby:" loads in place;
  /// links open in Safari; the gear opens Settings; the place picker and "Use my location" wait
  /// for phase 6.1.
  private var actions: HomeActions {
    let model = model
    let openURL = openURL
    return HomeActions(
      retry: { Task { await model.refresh() } },
      openPlacePicker: {},
      openSettings: openSettings,
      useMyLocation: {},
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
