import IsItLogic
import SwiftUI
import WidgetKit

/// The circular Lock Screen family: with an agreement, the system's capacity gauge, filled for
/// the models expecting snow of those with data, the glyph at its centre (the style draws
/// `currentValueLabel` there, and hides the label); without one, and when locked or stale, the
/// glyph on the system's accessory background. The Lock Screen draws it vibrant, in the system's
/// own type. One element reading the face's gauge sentence (the message when locked or stale).
struct CircularFace: View {
  let face: WidgetFace
  let art: WidgetArt

  var body: some View {
    Group {
      if let agreement = face.agreement {
        Gauge(value: Double(agreement.snowy), in: 0...Double(agreement.total)) {
          Text(verbatim: face.slot)
        } currentValueLabel: {
          GlyphMark(band: face.band, art: art, size: 20)
        }
        .gaugeStyle(.accessoryCircularCapacity)
      } else {
        ZStack {
          AccessoryWidgetBackground()
          GlyphMark(band: face.band, art: art, size: 26)
        }
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(face.spokenGauge)
  }
}

/// The rectangular Lock Screen family, in the system's text styles: "Tomorrow · Yes.", the
/// detail, and "6 of 6 forecasts" when the face has an agreement; the first two scale to fit
/// their line, the third never (12 points at Large, and the HIG's floor is 11). Locked and
/// stale: the message. One element reading the face's short sentence (the message when locked
/// or stale).
struct RectangularFace: View {
  let face: WidgetFace

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if face.state == .ok {
        Text(verbatim: face.slotAnswer)
          .font(.headline)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
        Text(verbatim: face.detail)
          .font(.body)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
        if !face.agreementShort.isEmpty {
          Text(verbatim: face.agreementShort)
            .font(.caption)
            .lineLimit(1)
        }
      } else {
        Text(verbatim: face.message)
          .font(.headline)
          .lineLimit(3)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(face.spokenShort)
  }
}
