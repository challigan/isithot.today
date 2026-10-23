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
/// app is open. The place button and the approximate line's "Use my location" open the place
/// picker, a full-screen sheet (phase 6.1, `PickerSheet`); the Settings sheet comes with phase
/// 6.2, and the switcher and the pager of Now, Today and This week with phase 5.2.
struct HomeView: View {
  let model: AppModel
  /// The place picker, while it is open.
  @State private var picker: PickerRequest?

  var body: some View {
    TimelineView(.everyMinute) { context in
      HomeContent(model: model, tick: context.date) { locating in
        picker = PickerRequest(locating: locating)
      }
    }
    // Outside the page's colours: the sheet follows the system's, and Dark Mode.
    .fullScreenCover(item: $picker) { request in
      PickerSheet(model: model, request: request)
    }
  }
}

/// The screen at one minute's tick. Its body reads the model, so it is drawn again whenever the
/// model changes as well as each minute, always at the model's clock.
private struct HomeContent: View {
  let model: AppModel
  /// The minute tick's date: a new one each minute, which draws the screen again.
  let tick: Date
  /// Opens the place picker; with `true`, starting "Use my location".
  let openPicker: (Bool) -> Void

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
  /// my location" opens it finding the phone's place; a place under "Nearby:" loads in place;
  /// links open in Safari; Settings waits for phase 6.2.
  private var actions: HomeActions {
    let model = model
    let openURL = openURL
    let openPicker = openPicker
    return HomeActions(
      retry: { Task { await model.refresh() } },
      openPlacePicker: { openPicker(false) },
      openSettings: {},
      useMyLocation: { openPicker(true) },
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
