import IsItServices
import IsItWidgetUI
import SwiftUI
import WidgetKit

/// The widget extension (iOS build spec, section 11): one widget kind, `SnowForecast`. The
/// skeleton has the small family only, showing the answer the app saved in the App Group. It
/// links no ads code (never `IsItAds`).
@main
struct SnowWidgets: WidgetBundle {
  var body: some Widget {
    SnowForecastWidget()
  }
}

struct SnowForecastWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SnowForecast", provider: SavedAnswerProvider(store: Self.store)) {
      entry in
      SavedAnswerView(entry: entry)
        .containerBackground(.fill.tertiary, for: .widget)
    }
    .supportedFamilies([.systemSmall])
  }

  /// The App Group, or nil. No fallback: a container of the widget's own would never hold an
  /// answer, since only the app saves them.
  private static func store() -> SharedStore? {
    SharedStore.appGroupID().flatMap { SharedStore.open(appGroup: $0, fallback: false) }
  }
}
