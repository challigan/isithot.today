import IsItModel
import SwiftUI

/// The skeleton's home: the place and the rest of today's snow answer, all worded by the server.
/// Phase 5 replaces it with the pages, the answer header and the rest (iOS build spec, 10.2).
public struct AnswerSummary: View {
  public let response: TodayResponse

  public init(response: TodayResponse) {
    self.response = response
  }

  public var body: some View {
    VStack(spacing: 16) {
      Text(verbatim: response.location.name)
        .font(.title2.weight(.semibold))
        .accessibilityIdentifier("place")
      if let day = response.snow?.days.first {
        Text(verbatim: day.answer)
          .font(.largeTitle.weight(.bold))
          .accessibilityIdentifier("answer")
        Text(verbatim: day.verdict)
          .font(.title3)
          .accessibilityIdentifier("verdict")
        Text(verbatim: day.detail)
        Text(verbatim: day.agreementText)
          .font(.footnote)
      }
    }
    .multilineTextAlignment(.center)
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
