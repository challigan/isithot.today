// swift-tools-version:6.0
// IsItCore: the apps' API models (IsItModel) and their ports of the client rules (IsItLogic).
// Foundation only and no dependencies, so it builds and tests on Linux as well as for iOS.

import PackageDescription

let package = Package(
  name: "IsItCore",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "IsItModel", targets: ["IsItModel"]),
    .library(name: "IsItLogic", targets: ["IsItLogic"]),
  ],
  targets: [
    .target(name: "IsItModel"),
    .target(name: "IsItLogic", dependencies: ["IsItModel"]),
    // What pnpm mobile:generate writes for the tests (the fixtures and the golden vectors), with
    // their loaders: one copy that every test target reads. Not a product, so no app links it.
    .target(
      name: "IsItTestSupport",
      path: "Tests/IsItTestSupport",
      resources: [.copy("Resources/Fixtures"), .copy("Resources/Vectors")]
    ),
    .testTarget(name: "IsItModelTests", dependencies: ["IsItModel", "IsItTestSupport"]),
  ],
  swiftLanguageModes: [.v6]
)
