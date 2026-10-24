import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItUI
import SnowKit
import SwiftUI
import UIKit

/// The home screen (iOS build spec, section 10.2): the top bar, the switcher and the pager of
/// Now, Today (Tomorrow from 6pm) and This week, each made by the app's model from its state
/// (`AppModel.topBar`, `AppModel.page(_:at:)`, IsItLogic's presenters) and drawn by IsItUI from
/// those plain values and the actions. Only this file knows the model. The minute tick (section
/// 9.5) draws the pages again as each of the model's minutes begins, at the model's clock, so the
/// hour picked, Tomorrow from 6pm and the stale state follow the time while the app is open. Its
/// minutes are the model's (`MinuteTick`): the system's own in the app, and a Debug build's clock
/// started at `-now` turns the page on its own minute too. The place and Settings buttons are
/// here; their sheets come with phase 6.
struct HomeView: View {
  let model: AppModel

  var body: some View {
    let ticks = MinuteTick.anchor(model: model.now, system: Date())
    TimelineView(.periodic(from: ticks, by: 60)) { context in
      HomeContent(model: model, tick: context.date)
    }
  }
}

/// The screen at one minute's tick. Its body reads the model, so it is drawn again whenever the
/// model changes as well as each minute, always at the model's clock. The switcher and the
/// pager share the model's view (`$model.view`), so a tap, a swipe, a route and the return
/// after a long time away all move both. When the page on screen says something new
/// (`Announcements`, IsItState), VoiceOver hears its heading once (section 16).
private struct HomeContent: View {
  @Bindable var model: AppModel
  /// The minute tick's date: a new one each minute, which draws the screen again.
  let tick: Date

  @Environment(\.openURL) private var openURL
  @State private var announcements = Announcements()

  var body: some View {
    let now = model.now
    let pages = AppView.allCases.map { model.page($0, at: now) }
    let shown = pages.first { $0.view == model.view } ?? pages[1]
    HomeShell(topBar: model.topBar, theme: PageTheme(shown.palette), actions: actions) {
      VStack(spacing: 0) {
        ViewSwitcher(pages: pages, selection: $model.view)
        HomePager(
          pages: pages.map { page in
            PageContent(
              page: page,
              theme: PageTheme(page.palette),
              glyph: page.band.map { band in
                PageGlyph(band: band, whole: Glyphs.image(band), layers: Glyphs.layers(band))
              }
            )
          },
          selection: $model.view,
          still: DebugHooks.stillMotion(),
          actions: actions,
          // Pull to refresh (section 10.2), on every page, keeping what is on screen.
          refresh: { [model] in await model.refresh() }
        )
      }
    }
    .onChange(of: shown, initial: true) { _, page in
      if let heading = announcements.drawn(page) {
        UIAccessibility.post(notification: .announcement, argument: heading)
      }
    }
  }

  /// What the screen's taps do: Retry asks again; a place under "Nearby:" loads in place;
  /// links open in Safari; the place picker, Settings and "Use my location" wait for phase 6.
  private var actions: HomeActions {
    let model = model
    let openURL = openURL
    return HomeActions(
      retry: { Task { await model.refresh() } },
      openPlacePicker: {},
      openSettings: {},
      useMyLocation: {},
      openLink: { openURL($0) },
      selectNearby: { city in
        Task { await model.select(.city(slug: city.slug, name: city.name)) }
      }
    )
  }
}

extension PageTheme {
  /// A band's palette as a page's colours, dark for light ink, so that the system's controls on
  /// the page keep their contrast.
  init(_ palette: IsItModel.Palette) {
    self.init(
      g1: Color(rgb: palette.g1),
      g2: Color(rgb: palette.g2),
      g3: Color(rgb: palette.g3),
      glow: palette.glow,
      ink: Color(rgb: palette.ink),
      dark: palette.inkIsLight
    )
  }
}
