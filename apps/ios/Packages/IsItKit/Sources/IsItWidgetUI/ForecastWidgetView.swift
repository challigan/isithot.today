import IsItLogic
import SwiftUI
import WidgetKit

/// A face in its family (iOS build spec, section 11.1), from plain values: the answer's face for
/// an ok entry, the message's for a locked or stale one. Reads nothing of WidgetKit's
/// environment, so a snapshot and the app (7.3) draw it as the widget does. The ink is the
/// palette's only in full colour with the palette behind, and otherwise opaque white
/// (`WidgetLook`); the background is the entry view's (`PaletteBackground`), or the snapshot's.
public struct ForecastWidgetView: View {
  public let face: WidgetFace
  public let look: WidgetLook
  public let art: WidgetArt

  public init(face: WidgetFace, look: WidgetLook, art: WidgetArt) {
    self.face = face
    self.look = look
    self.art = art
  }

  public var body: some View {
    family
      .foregroundStyle(look.ink(face.band, in: art))
  }

  @ViewBuilder private var family: some View {
    switch look.family {
    case .small:
      if face.state == .ok {
        ForecastAnswerView(face: face, look: look, art: art)
      } else {
        MessageFace(face: face, art: art)
      }
    case .medium:
      if face.state == .ok {
        ForecastMediumView(face: face, look: look, art: art)
      } else {
        MessageFace(face: face, art: art)
      }
    case .circular:
      CircularFace(face: face, art: art)
    case .rectangular:
      RectangularFace(face: face)
    case .inline:
      // One row of the system's own text, no image: what it says is what VoiceOver reads.
      Text(verbatim: face.inline)
    }
  }
}
