import IsItModel
import IsItServices
import IsItState
import IsItWidgetUI
import SnowKit
import SwiftUI
import WidgetKit

/// The widget extension (iOS build spec, section 11): one kind, `SnowForecast`, in five
/// families. It links no ads SDK and no location or purchase module (IsItAds, IsItLocation,
/// IsItPurchases), and never sells: IsItState's `AdsModel` and `PurchaseModel` come with it, and
/// nothing here calls them.
@main
struct SnowWidgets: WidgetBundle {
  var body: some Widget {
    SnowForecastWidget()
  }
}

struct SnowForecastWidget: Widget {
  /// The snow topic's glyphs and palettes, which IsItWidgetUI draws every family with.
  static let art = WidgetArt(glyph: { Glyphs.image($0) }, palette: { Palettes.snow($0) })

  var body: some WidgetConfiguration {
    StaticConfiguration(
      kind: "SnowForecast",
      provider: ForecastProvider(timeline: { SnowForecastWidget.timeline() })
    ) {
      ForecastEntryView(entry: $0, art: Self.art)
    }
    .configurationDisplayName(AppCopy.widgetName)
    .description(AppCopy.widgetDescription)
    .supportedFamilies([
      .systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline,
    ])
  }

  /// The timeline from this bundle's Info.plist, by IsItServices' factory, which the app's unit
  /// tests run against the embedded extension's; nil without the group. Nonisolated, as the
  /// provider calls it off the main actor (`Widget` is main-actor).
  nonisolated static func timeline() -> WidgetTimeline? {
    WidgetTimeline.live(in: .main)
  }
}
