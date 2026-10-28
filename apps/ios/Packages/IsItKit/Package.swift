// swift-tools-version:6.0
// IsItKit: the apps' Apple-only code (iOS build spec, section 9.3): the services, the location,
// the ads, the purchase, the views, the widget views and the snow topic's own code. Swift 5
// language mode in every target, with the minimal concurrency checking the apps build with; only
// IsItCore is in Swift 6 mode.
//
// The Google SDKs are pinned exactly, with the versions committed in apps/ios/Package.resolved.
// Only IsItAds imports them, and the widget extension never links IsItAds, IsItLocation or
// IsItPurchases.

import PackageDescription

let swift5: [SwiftSetting] = [.swiftLanguageMode(.v5)]

let package = Package(
  name: "IsItKit",
  platforms: [.iOS(.v17)],
  products: [
    .library(name: "IsItServices", targets: ["IsItServices"]),
    .library(name: "IsItLocation", targets: ["IsItLocation"]),
    .library(name: "IsItAds", targets: ["IsItAds"]),
    .library(name: "IsItPurchases", targets: ["IsItPurchases"]),
    .library(name: "IsItUI", targets: ["IsItUI"]),
    .library(name: "IsItWidgetUI", targets: ["IsItWidgetUI"]),
    .library(name: "SnowKit", targets: ["SnowKit"]),
  ],
  dependencies: [
    .package(path: "../IsItCore"),
    // The same URL Google Mobile Ads names for UMP, so SwiftPM sees one package.
    .package(
      url: "https://github.com/googleads/swift-package-manager-google-mobile-ads.git",
      exact: "13.11.0"
    ),
    .package(
      url: "https://github.com/googleads/swift-package-manager-google-user-messaging-platform.git",
      exact: "3.1.0"
    ),
  ],
  targets: [
    // The services behind AppModel's protocols (IsItState): URLSession, the App Group,
    // WidgetKit's reloads, the recent and saved places (IsItLogic's codecs), and what StoreKit
    // holds for the purchase (`StoreKitFacts`, reading only, which the widget may link).
    .target(
      name: "IsItServices",
      dependencies: [
        .product(name: "IsItModel", package: "IsItCore"),
        .product(name: "IsItLogic", package: "IsItCore"),
        .product(name: "IsItState", package: "IsItCore"),
      ],
      swiftSettings: swift5
    ),
    // The location service behind AppModel's `LocationService`: Core Location. A module of its
    // own, which only the app links, as with IsItAds: the widget links IsItServices, and no
    // location API may be in its binary (it has no purpose string, and asks for no location).
    .target(
      name: "IsItLocation",
      dependencies: [.product(name: "IsItState", package: "IsItCore")],
      swiftSettings: swift5
    ),
    // The free version's ads behind AdsModel's `AdsPlatform` (IsItState): Google's consent and
    // Mobile Ads SDKs, and the view that hosts their banners. Only the app links it.
    .target(
      name: "IsItAds",
      dependencies: [
        .product(name: "IsItModel", package: "IsItCore"),
        .product(name: "IsItState", package: "IsItCore"),
        .product(name: "GoogleMobileAds", package: "swift-package-manager-google-mobile-ads"),
        .product(
          name: "GoogleUserMessagingPlatform",
          package: "swift-package-manager-google-user-messaging-platform"
        ),
      ],
      swiftSettings: swift5
    ),
    // The one-off purchase (spec section 13): StoreKit 2's product, buying, Restore purchase and
    // the updates listener, behind PurchaseModel's `PurchasePlatform` (IsItState). Only the app
    // links it: a widget may read the purchase (IsItServices' `StoreKitFacts`) but never sell it
    // (App Review 4.4; spec 11.1).
    .target(
      name: "IsItPurchases",
      dependencies: [
        "IsItServices",
        .product(name: "IsItLogic", package: "IsItCore"),
        .product(name: "IsItState", package: "IsItCore"),
      ],
      swiftSettings: swift5
    ),
    // The app's screens, from plain values: IsItLogic's presenters (HomePage, HomeTopBar) and
    // the actions the app's model answers. Topic-free: the app gives each page its colours and
    // glyph (SnowKit), so the widget, which links SnowKit, never links the app's screens.
    .target(
      name: "IsItUI",
      dependencies: [
        .product(name: "IsItModel", package: "IsItCore"),
        .product(name: "IsItLogic", package: "IsItCore"),
      ],
      swiftSettings: swift5
    ),
    .target(
      name: "IsItWidgetUI",
      dependencies: [
        "IsItServices",
        .product(name: "IsItModel", package: "IsItCore"),
        .product(name: "IsItLogic", package: "IsItCore"),
      ],
      swiftSettings: swift5
    ),
    // The snow topic, linked by the app and the widget. Its glyphs are generated (pnpm
    // mobile:generate): Resources/Glyphs.xcassets as SVG, and Fallback/Glyphs.xcassets, the same
    // image sets as PNGs, built only if the SVGs don't render correctly (V7). To switch, process
    // Fallback/Glyphs.xcassets and exclude Resources instead.
    .target(
      name: "SnowKit",
      dependencies: [.product(name: "IsItModel", package: "IsItCore")],
      exclude: ["Fallback"],
      resources: [.process("Resources/Glyphs.xcassets")],
      swiftSettings: swift5
    ),
  ]
)
