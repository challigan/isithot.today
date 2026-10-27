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
/// (`AppModel.makePicker()`, IsItState) drawn by IsItUI's `PlacePickerView`, in the colours of the
/// page on screen (`theme`), read from the app's model in the body, so the picker follows a
/// refresh that changes the band while it is open. It closes when a place is chosen (`finished`),
/// and its search stops with it; the chosen place goes on loading on the home screen. In the free
/// version a choice in the picker the place pill opened may first show the full-screen ad over
/// the picker (`AdsModel.placeChosen`), and the picker closes as the ad does: the pill's tap and
/// the choice are the two actions Google asks for before such an ad. The "Use my exact location"
/// chip's picker never shows one, as its fix chooses the place after that one tap. A star saves
/// or removes a place and chooses nothing. A Debug build notes the picker's content coming on
/// screen and leaving it, for the UI tests' readout of the picker (`DebugHooks.pickerReadout`).
struct PickerSheet: View {
  let model: AppModel
  /// The free version's ads.
  let ads: AdsModel
  let request: PickerRequest
  @State private var picker: PlacePickerModel
  /// Whether the request's location fix has started, so it starts once.
  @State private var started = false

  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL

  init(model: AppModel, ads: AdsModel, request: PickerRequest) {
    self.model = model
    self.ads = ads
    self.request = request
    _picker = State(initialValue: model.makePicker())
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
      actions: PlacePickerActions(
        submit: { Task { await picker.submit() } },
        useMyLocation: { Task { await picker.useMyLocation() } },
        openSettings: {
          if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
        },
        choose: { result in Task { await picker.choose(result) } },
        chooseRecent: { place in Task { await picker.choose(place) } },
        chooseSaved: { place in Task { await picker.choose(saved: place) } },
        saveResult: { result in picker.save(result) },
        saveRecent: { place in picker.save(place) },
        unsave: { target in picker.unsave(target) },
        deleteRecent: { place in picker.remove(place) },
        close: { dismiss() }
      )
    )
    .onChange(of: picker.finished) { _, finished in
      guard finished else { return }
      if request.locating {
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
}
