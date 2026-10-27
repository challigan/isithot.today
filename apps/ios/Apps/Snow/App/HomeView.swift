import Foundation
import IsItAds
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
/// started at `-now` turns the page on its own minute too. The top bar, over every page, opens
/// two of the sheets (`HomeSheet`), one at a time: the place pill, and on approximate location the
/// "Use my exact location" chip, the place picker, full screen (section 10.3, `PickerSheet`);
/// the gear, Settings (section 10.4, `SettingsSheet`). The third, the upgrade sheet (section
/// 10.5, `UpgradeSheet`), opens from the middle page's upgrade row in the free version, and from
/// `willitsnow://upgrade`. In the free version, once the ads are on, the home banner's band sits
/// under the pager and each page ends with its ad box, and a place chosen in the picker the place
/// pill opened may show the full-screen ad (`AdsModel`).
struct HomeView: View {
  let model: AppModel
  /// The free version's ads.
  let ads: AdsModel
  /// Google's SDKs, whose banners the band and the page ends show.
  let google: GoogleAds
  /// The purchase: the home row, Settings' card and the upgrade sheet.
  let purchases: PurchaseModel
  /// The sheet open over the home screen, if any.
  @State private var sheet: HomeSheet?

  var body: some View {
    let ticks = MinuteTick.anchor(model: model.now, system: Date())
    TimelineView(.periodic(from: ticks, by: 60)) { context in
      HomeContent(
        model: model, ads: ads, google: google, purchases: purchases, tick: context.date,
        covered: sheet != nil
      ) { sheet = $0 }
      // Under a sheet, the pages are out of the accessibility tree, as VoiceOver already
      // treats what is under a modal sheet: the sheets' audits read the sheet alone, and the
      // pages' own audits are HomeAuditTests'. Nor are their changes announced (`covered`).
      .accessibilityHidden(sheet != nil)
    }
    // A Debug build's readout of the picker for the UI tests (`DebugHooks.pickerReadout`): at the
    // top right of the safe area, clear of the gear, out of the pages and their minute's redraw,
    // and out of what a sheet hides, so it is read as the picker closes. None in a Release build.
    .overlay(alignment: .topTrailing) {
      DebugHooks.pickerReadout(open: sheet.picker != nil)
    }
    // The picker wears the band of the page on screen, which `PickerSheet` reads from the model
    // in its own body, so it follows a refresh while open and never follows Dark Mode, as the
    // pages don't (the sheet surface, IsItUI's PlacePickerView). Settings wears the website's
    // content pages' palette whatever the band, and doesn't follow Dark Mode either (the content
    // surface, IsItUI's SettingsView). Both are under the Debug recorder (`debugRecorder()`,
    // DebugHooks.swift), so under `-openURLs` every URL either would open is recorded instead,
    // the picker's Open Settings as well as Settings' rows. A Release build draws them as they
    // are. The upgrade sheet wears Settings' look and opens no URL. Settings and the upgrade
    // sheet are one presentation (`card`), so a link while Settings is open swaps one for the
    // other, which two `.sheet` modifiers can't; a link while the picker is open closes it as the
    // upgrade sheet opens.
    .fullScreenCover(item: $sheet.picker) { request in
      PickerSheet(model: model, ads: ads, request: request)
        .debugRecorder()
    }
    .sheet(item: $sheet.card) { card in
      switch card {
      case .settings:
        SettingsSheet(model: model, ads: ads, purchases: purchases)
          .debugRecorder()
      case .upgrade:
        UpgradeSheet(model: model, purchases: purchases)
      }
    }
    // `willitsnow://upgrade` (`LiveHooks.handle`), each time it comes.
    .onChange(of: purchases.sheetRequests) { _, _ in
      sheet = .upgrade
    }
  }
}

/// The sheets the home screen opens, one at a time: the place picker (with why it opened),
/// Settings, and the upgrade sheet.
enum HomeSheet: Equatable {
  case picker(PickerRequest)
  case settings
  case upgrade

  /// The sheets that share one presentation: Settings and the upgrade sheet.
  enum Card: String, Identifiable {
    case settings
    case upgrade

    var id: String { rawValue }
  }
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

  /// Settings or the upgrade sheet, while one is open. Set to nil, as the sheet does when it
  /// closes, it closes that sheet only.
  fileprivate var card: HomeSheet.Card? {
    get {
      switch self {
      case .settings?: .settings
      case .upgrade?: .upgrade
      case .picker?, nil: nil
      }
    }
    set {
      switch newValue {
      case .settings: self = .settings
      case .upgrade: self = .upgrade
      case nil:
        if card != nil { self = nil }
      }
    }
  }
}

/// The screen at one minute's tick. Its body reads the model, so it is drawn again whenever the
/// model changes as well as each minute, always at the model's clock. The switcher and the
/// pager share the model's view (`$model.view`), so a tap, a swipe, a route and the return
/// after a long time away all move both. When the page on screen says something new
/// (`Announcements`, IsItState), VoiceOver hears its heading once (section 16), unless a sheet
/// covers the pages: then nothing is said, then or once it closes, as the pages are out of the
/// accessibility tree under it (the 6pm flip, or a quiet refresh's new answer, behind Settings).
///
/// The upgrade row (section 10.2, item 6) is on the middle page alone, under Today and Tomorrow
/// alike, only on a page with an answer, as the box is, and only in the free version once StoreKit
/// has given the price it names (`UpgradePage.homeRow`). It sits between the page's body and its
/// footer, and the box after the footer's links, so the row is never beside or over an ad.
///
/// The ads take their spaces only in the free version and once they are on: the home banner's
/// band, as tall as Google says the banner is at the screen's width, under the pager in the
/// stack rather than in a safe-area inset over the pages, so the pages end at its top and nothing
/// scrolls under the ad; and the box at the end of each page with an answer. The ads hear the
/// widths these are laid out at and the page on screen, and load each banner once they know both.
private struct HomeContent: View {
  @Bindable var model: AppModel
  let ads: AdsModel
  let google: GoogleAds
  let purchases: PurchaseModel
  /// The minute tick's date: a new one each minute, which draws the screen again.
  let tick: Date
  /// Whether a sheet is open over the pages.
  let covered: Bool
  /// Opens a sheet: the place picker, Settings, or the upgrade sheet.
  let open: (HomeSheet) -> Void

  @Environment(\.openURL) private var openURL
  @State private var announcements = Announcements()

  var body: some View {
    let now = model.now
    let pages = AppView.allCases.map { model.page($0, at: now) }
    let shown = pages.first { $0.view == model.view } ?? pages[1]
    // The page on screen's colours, which the top bar and the switcher wear over every page.
    let theme = PageTheme(shown.palette)
    let adsShown = !model.unlocked && ads.phase == .on
    let upgrade = UpgradePage.homeRow(unlocked: model.unlocked, purchase: purchases.state)
    HomeShell(topBar: model.topBar, theme: theme, actions: actions) {
      VStack(spacing: 0) {
        ViewSwitcher(pages: pages, selection: $model.view, theme: theme)
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
          refresh: { [model] in await model.refresh() },
          pageCards: { view in
            // The middle page, under Today and Tomorrow alike, only with an answer, as the box.
            if view == .today, let upgrade,
              pages.first(where: { $0.view == view })?.footer != nil
            {
              UpgradeRow(title: upgrade) { open(.upgrade) }
            }
          },
          pageEnd: { view in
            // Only on a page with an answer (its footer shows): never under "Checking…" or an
            // error, as Google allows no ads on a screen without content.
            if adsShown, pages.first(where: { $0.view == view })?.footer != nil {
              AdBox(id: "ad-page-\(view.rawValue)") {
                BannerSlot(ads: google, slot: .pageEnd(view))
              }
              .onGeometryChange(for: Double.self) { proxy in
                Double(proxy.size.width)
              } action: { width in
                ads.pageEndWidth(view, width)
              }
            }
          }
        )
        if adsShown, let height = ads.homeBannerHeight {
          AdBand(height: height, id: "ad-home") {
            BannerSlot(ads: google, slot: .home)
          }
        }
      }
      .onGeometryChange(for: Double.self) { proxy in
        Double(proxy.size.width)
      } action: { width in
        ads.homeWidth(width)
      }
    }
    // A Debug build's readout of the ads for AdsTests (`DebugHooks.adsReadout`): in the corner
    // over the home screen, out of the pages, so nothing moves; none under `-noads 1` or in a
    // Release build.
    .overlay(alignment: .topLeading) {
      DebugHooks.adsReadout(ads)
    }
    .onChange(of: model.view, initial: true) { _, view in
      ads.shown(view)
    }
    .onChange(of: shown, initial: true) { _, page in
      if let heading = announcements.drawn(page, covered: covered) {
        UIAccessibility.post(notification: .announcement, argument: heading)
      }
    }
  }

  /// What the screen's taps do: Retry asks again; the place pill opens the picker, and "Use my
  /// exact location" opens it finding the phone's place; the gear opens Settings; a place under
  /// "Nearby:" loads in place; links open in Safari. A place under "Nearby:" never brings the
  /// full-screen ad: its tap is a single action, and Google allows at most one such ad for every
  /// two (DECISIONS, "Ads in the iPhone app: three placements").
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
