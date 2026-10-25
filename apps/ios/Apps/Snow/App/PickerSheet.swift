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
/// (`AppModel.makePicker()`, IsItState) drawn by IsItUI's `PlacePickerView`. It closes when a
/// place is chosen (`finished`), and its search stops with it; the chosen place goes on loading
/// on the home screen.
struct PickerSheet: View {
  let request: PickerRequest
  @State private var picker: PlacePickerModel
  /// Whether the request's location fix has started, so it starts once.
  @State private var started = false

  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL

  init(model: AppModel, request: PickerRequest) {
    self.request = request
    _picker = State(initialValue: model.makePicker())
  }

  var body: some View {
    let picker = picker
    PlacePickerView(
      picker: picker.content,
      text: Binding(get: { picker.text }, set: { picker.type($0) }),
      actions: PlacePickerActions(
        submit: { Task { await picker.submit() } },
        useMyLocation: { Task { await picker.useMyLocation() } },
        openSettings: {
          if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
        },
        choose: { result in Task { await picker.choose(result) } },
        chooseRecent: { place in Task { await picker.choose(place) } },
        removeRecent: { picker.remove($0) },
        close: { dismiss() }
      )
    )
    .onChange(of: picker.finished) { _, finished in
      if finished { dismiss() }
    }
    .onAppear {
      // Not in `.task`, which is cancelled as the sheet closes, and would cancel the fetch of
      // the place the fix chose with it.
      guard request.locating, !started else { return }
      started = true
      Task { await picker.useMyLocation() }
    }
    .onDisappear { picker.close() }
  }
}
