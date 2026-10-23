import IsItUI
import SwiftUI

/// The skeleton's one screen: the answer, or the system's progress indicator until there is one.
struct HomeView: View {
  let model: AppModel

  var body: some View {
    if let response = model.response {
      AnswerSummary(response: response)
    } else {
      ProgressView()
    }
  }
}
