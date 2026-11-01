import Foundation
import IsItLogic
import SwiftUI
import WidgetKit

/// The widget's view of an entry, and the only view that reads WidgetKit's environment: the
/// family, the rendering mode and whether the background is drawn, as a `WidgetLook` for
/// `ForecastWidgetView`. Its band's palette goes in the container background in every family
/// and state, which WidgetKit removes wherever it doesn't draw it (never made unremovable, or
/// StandBy's gallery leaves the widget out), and its one `widgetURL` is the face's link: Today,
/// or the upgrade when locked.
public struct ForecastEntryView: View {
  public let entry: ForecastEntry
  public let art: WidgetArt

  @Environment(\.widgetFamily) private var family
  @Environment(\.widgetRenderingMode) private var mode
  @Environment(\.showsWidgetContainerBackground) private var showsBackground

  public init(entry: ForecastEntry, art: WidgetArt) {
    self.entry = entry
    self.art = art
  }

  public var body: some View {
    ForecastWidgetView(
      face: entry.face,
      look: WidgetLook(
        family: family, mode: mode, showsBackground: showsBackground, interactive: true),
      art: art
    )
    .containerBackground(for: .widget) {
      PaletteBackground(palette: art.palette(entry.face.band))
    }
    .widgetURL(URL(string: entry.face.link))
  }
}
