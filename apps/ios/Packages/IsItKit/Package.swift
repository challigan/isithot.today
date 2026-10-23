// swift-tools-version:6.0
// IsItKit: the apps' Apple-only code (iOS build spec, section 9.3): the services, the ads, the
// views, the widget views and the snow topic's own code. Swift 5 language mode in every target,
// with the minimal concurrency checking the apps build with; only IsItCore is in Swift 6 mode.
//
// The Google SDKs are pinned exactly, with the versions committed in apps/ios/Package.resolved.
// Only IsItAds imports them, and the widget extension never links IsItAds.

import PackageDescription

let swift5: [SwiftSetting] = [.swiftLanguageMode(.v5)]

let package = Package(
  name: "IsItKit",
  platforms: [.iOS(.v17)],
  products: [
    .library(name: "IsItServices", targets: ["IsItServices"]),
    .library(name: "IsItAds", targets: ["IsItAds"]),
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
    .target(
      name: "IsItServices",
      dependencies: [.product(name: "IsItModel", package: "IsItCore")],
      swiftSettings: swift5
    ),
    .target(
      name: "IsItAds",
      dependencies: [
        .product(name: "GoogleMobileAds", package: "swift-package-manager-google-mobile-ads"),
        .product(
          name: "GoogleUserMessagingPlatform",
          package: "swift-package-manager-google-user-messaging-platform"
        ),
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
      dependencies: ["IsItServices", .product(name: "IsItModel", package: "IsItCore")],
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
