import IsItLogic
import IsItModel
import IsItState
import IsItUI
import SwiftUI
import UIKit

/// Why the picker opened: the top bar's place pill, or its "Use my exact location" chip on
/// approximate location, which starts the location fix as the picker opens (permission is asked
/// at that tap).
/// Each opening is a request of its own.
struct PickerRequest: Identifiable, Equatable {
  let id = UUID()
  let locating: Bool
}

/// The place picker's sheet (iOS build spec, section 10.3): a picker model of its own
/// (`AppModel.makePicker(bells:announce:)`, IsItState) drawn by IsItUI's `PlacePickerView`, in the
/// colours of the page on screen (`theme`), read from the app's model in the body, so the picker
/// follows a refresh that changes the band while it is open. It closes when a place is chosen
/// (`finished`), and its search stops with it; the chosen place goes on loading on the home
/// screen. In the free
/// version a choice in the picker the place pill opened may first show the full-screen ad over
/// the picker (`AdsModel.placeChosen`), and the picker closes as the ad does: the pill's tap and
/// the choice are the two actions Google asks for before such an ad. The "Use my exact location"
/// chip's picker never shows one, as its fix chooses the place after that one tap, and a paid
/// session never asks for one, even when the purchase came after the ads had started (where
/// `AdsModel.stop()` makes it a no-op too). A star saves or removes a place and chooses nothing.
/// A Debug build notes the picker's content coming on screen and leaving it, for the UI tests'
/// readout of the picker (`DebugHooks.pickerReadout`).
///
/// Each saved place's bell (phase 8.4b, design 2.2) is `NotificationsModel`'s, which the picker's
/// model asks (`PickerBells`), and whose outcome it announces through UIKit's announcement here,
/// as the star's is. A locked bell opens the purchase's page as a sheet over the picker (decision
/// 8), not over the home screen, so a buyer stays where the bell was; when that sheet closes with
/// the purchase owned, the picker's model turns that bell on by itself
/// (`purchaseSheetClosed(unlocked:)`), and VoiceOver's focus goes back to it (`PlacePickerView`).
/// A bell chooses nothing, so it never brings the full-screen ad. "Open Settings" under a bell's
/// tap that met notifications off opens the app's notification settings, through the environment's
/// `openURL`, so a Debug build's recorder records it.
struct PickerSheet: View {
  let model: AppModel
  /// The free version's ads.
  let ads: AdsModel
  /// The purchase, whose page a locked bell opens over the picker.
  let purchases: PurchaseModel
  let request: PickerRequest
  @State private var picker: PlacePickerModel
  /// Whether the request's location fix has started, so it starts once.
  @State private var started = false
  /// Whether the purchase's page is open over the picker. The sheet's own, apart from the
  /// model's `purchasing`, which the model clears only once it has heard the sheet closed.
  @State private var buying = false

  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL

  init(
    model: AppModel, ads: AdsModel, purchases: PurchaseModel, notifications: NotificationsModel,
    request: PickerRequest
  ) {
    self.model = model
    self.ads = ads
    self.purchases = purchases
    self.request = request
    _picker = State(
      initialValue: model.makePicker(
        bells: notifications,
        announce: { UIAccessibility.post(notification: .announcement, argument: $0) }
      ))
  }

  /// The page on screen's colours, as the home screen draws it: the picker wears its band.
  private var theme: PageTheme {
    PageTheme(model.page(model.view, at: model.now).palette)
  }

  var body: some View {
    let picker = picker
    PlacePickerView(
      picker: picker.content,
      text: Binding(get: { picker.text }, set: { picker.type($0) }),
      theme: theme,
      purchaseOpen: buying,
      actions: PlacePickerActions(
        submit: { Task { await picker.submit() } },
        useMyLocation: { Task { await picker.useMyLocation() } },
        openSettings: {
          if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
        },
        openNotificationSettings: {
          if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
            openURL(url)
          }
        },
        choose: { result in Task { await picker.choose(result) } },
        chooseRecent: { place in Task { await picker.choose(place) } },
        chooseSaved: { place in Task { await picker.choose(saved: place) } },
        saveResult: { result in picker.save(result) },
        saveRecent: { place in picker.save(place) },
        unsave: { target in picker.unsave(target) },
        deleteRecent: { place in picker.remove(place) },
        toggleBell: { place in Task { await picker.toggleBell(place) } },
        close: { dismiss() }
      )
    )
    // A locked bell's tap: the purchase's page over the picker.
    .onChange(of: picker.purchasing) { _, place in
      if place != nil { buying = true }
    }
    .sheet(isPresented: $buying, onDismiss: purchaseClosed) {
      UpgradeSheet(model: model, purchases: purchases)
    }
    .onChange(of: picker.finished) { _, finished in
      guard finished else { return }
      if request.locating || model.unlocked {
        dismiss()
      } else {
        ads.placeChosen { dismiss() }
      }
    }
    .onAppear {
      DebugHooks.pickerAppeared()
      // Not in `.task`, which is cancelled as the sheet closes, and would cancel the fetch of
      // the place the fix chose with it.
      guard request.locating, !started else { return }
      started = true
      Task { await picker.useMyLocation() }
    }
    .onDisappear {
      DebugHooks.pickerDisappeared()
      picker.close()
    }
  }

  /// The purchase's page over the picker has closed: with the purchase now owned, the picker's
  /// model turns on the bell that opened it.
  private func purchaseClosed() {
    let picker = picker
    let unlocked = model.unlocked
    Task { await picker.purchaseSheetClosed(unlocked: unlocked) }
  }
}
