import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItUI
import SnowKit
import SwiftUI

/// The home screen (iOS build spec, section 10.2): the top bar over the Today page, both made by
/// IsItLogic's presenters (`HomeTopBar`, `HomePage`) from the answer on screen and drawn by IsItUI
/// from those plain values and the actions. Only this file knows the app's model. For now that is
/// the skeleton's, which shows the answer it is launched with; phase 5.1's data half brings the
/// model that fetches, with its clock, phase, place and actions, and connecting it changes this
/// file alone. The place and Settings buttons are here; their sheets come with phase 6.
struct HomeView: View {
  let model: AppModel

  @Environment(\.openURL) private var openURL

  var body: some View {
    let response = model.response
    let page = HomePage(
      response,
      view: .today,
      at: DebugHooks.launchMoment ?? Date(),
      phase: response == nil ? .loading : .ready
    )
    let topBar = HomeTopBar(
      placeName: response?.location.name,
      approximate: response?.location.source == .ip
    )
    let theme = PageTheme(page.palette)
    HomeShell(topBar: topBar, theme: theme, actions: actions) {
      ForecastPageView(
        page: page,
        theme: theme,
        glyph: page.band.map { Glyphs.image($0) },
        actions: actions
      )
    }
  }

  /// What the screen's taps do, as far as the skeleton can: links open in Safari; the rest wait
  /// for the model that fetches (phase 5.1's data half) and for the sheets (phase 6).
  private var actions: HomeActions {
    let openURL = openURL
    return HomeActions(
      retry: {},
      openPlacePicker: {},
      openSettings: {},
      useMyLocation: {},
      openLink: { openURL($0) },
      selectNearby: { _ in }
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
