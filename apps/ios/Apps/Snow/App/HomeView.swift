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
/// `willitsnow://upgrade`. Settings also opens from `willitsnow://settings/notifications` and iOS
/// Settings' link to the app's notification settings, and the picker from Settings →
/// Notifications' "Use my location" and "Search" and the notifications card's two. In the free
/// version, once the ads are on, the home banner's band sits under the pager and each page ends
/// with its ad box, and a place chosen in the picker the place pill opened may show the
/// full-screen ad (`AdsModel`).
struct HomeView: View {
  let model: AppModel
  /// The free version's ads.
  let ads: AdsModel
  /// Google's SDKs, whose banners the band and the page ends show.
  let google: GoogleAds
  /// The purchase: the home row, Settings' card and the upgrade sheet.
  let purchases: PurchaseModel
  /// The notifications: the middle page's card, Settings → Notifications and Your privacy.
  let notifications: NotificationsModel
  /// The sheet open over the home screen, if any.
  @State private var sheet: HomeSheet?
  /// The sheet to open once the one open has closed (`present(_:)`).
  @State private var pending: HomeSheet?

  var body: some View {
    let ticks = MinuteTick.anchor(model: model.now, system: Date())
    TimelineView(.periodic(from: ticks, by: 60)) { context in
      HomeContent(
        model: model, ads: ads, google: google, purchases: purchases,
        notifications: notifications, tick: context.date, covered: sheet != nil
      ) { present($0) }
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
    // other, which two `.sheet` modifiers can't; from one presentation to the other (Settings'
    // "Search" to the picker, a link while the picker is open), the first closes and the second
    // opens once it has gone (`present(_:)`).
    .fullScreenCover(item: $sheet.picker, onDismiss: presentPending) { request in
      PickerSheet(model: model, ads: ads, request: request)
        .debugRecorder()
    }
    .sheet(item: $sheet.card, onDismiss: presentPending) { card in
      switch card {
      case .settings:
        SettingsSheet(
          model: model, ads: ads, purchases: purchases, notifications: notifications
        )
        .debugRecorder()
      case .upgrade:
        UpgradeSheet(model: model, purchases: purchases)
      }
    }
    // `willitsnow://upgrade` (`LiveHooks.handle`), each time it comes.
    .onChange(of: purchases.sheetRequests) { _, _ in
      present(.upgrade)
    }
    // `willitsnow://settings/notifications` and iOS Settings' link, each time one comes.
    .onChange(of: notifications.settingsRequests) { _, _ in
      present(.settings)
    }
    // Settings → Notifications' "Use my location" or "Search".
    .onChange(of: notifications.pickerRequests) { _, _ in
      present(.picker(PickerRequest(locating: notifications.pickerLocating)))
    }
  }

  /// Opens `next`, which every request goes through: at once with nothing open, or between
  /// Settings and the upgrade sheet, which are one presentation; otherwise the one open closes
  /// first and `next` opens once it has gone (its `onDismiss`), as two presentations that change
  /// in one transaction can fail with nothing said.
  private func present(_ next: HomeSheet) {
    guard let open = sheet, !(open.isCard && next.isCard) else {
      sheet = next
      return
    }
    pending = next
    sheet = nil
  }

  /// The sheet waiting for the one open to close, now that it has.
  private func presentPending() {
    guard let next = pending else { return }
    pending = nil
    sheet = next
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

  /// Whether it is Settings or the upgrade sheet, which share one presentation.
  var isCard: Bool {
    switch self {
    case .picker: false
    case .settings, .upgrade: true
    }
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
/// The notifications card (section 10.2, item 5) and the upgrade row (item 6) are on the middle
/// page alone, under Today and Tomorrow alike, only on a page with an answer, as the box is, the
/// card above the row: the card while `NotificationCard` offers one (never once put away or a
/// notification is on), the row only in the free version once StoreKit has given the price it
/// names (`UpgradePage.homeRow`). They sit between the page's body and its footer, and the box
/// after the footer's links, so neither is ever beside or over an ad.
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
  let notifications: NotificationsModel
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
    let card = NotificationCard.card(notifications.state, onScreen: model.onScreen)
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
            // The middle page, under Today and Tomorrow alike, only with an answer, as the box:
            // the card, then the row.
            if view == .today, pages.first(where: { $0.view == view })?.footer != nil {
              if let card {
                NotificationCardView(card: card) { act($0) }
              }
              if let upgrade {
                UpgradeRow(title: upgrade) { open(.upgrade) }
              }
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

  /// What the notifications card's buttons do: "Turn on" turns the evening notification on for
  /// the place on screen (asking for permission); "Not now" puts the card away for good; "Use my
  /// location" and "Search" open the picker, as the top bar's do; "Open Settings" opens the
  /// app's notification settings in iOS Settings.
  private func act(_ action: NotificationCard.Action) {
    switch action {
    case .turnOn:
      let onScreen = model.onScreen
      Task { await notifications.turnOnFromCard(onScreen: onScreen) }
    case .notNow:
      notifications.dismissCard()
    case .useMyLocation:
      open(.picker(PickerRequest(locating: true)))
    case .search:
      open(.picker(PickerRequest(locating: false)))
    case .openSettings:
      if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
        openURL(url)
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

extension AppModel {
  /// The place on screen as the notifications take it: its target, name, country and units.
  var onScreen: OnScreen {
    OnScreen(target: target, name: placeName, country: response?.location.country, units: units)
  }
}
