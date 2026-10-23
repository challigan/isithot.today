// swift-tools-version:6.0
// IsItCore: the apps' API models (IsItModel), their ports of the client rules (IsItLogic), and
// the app's state with its fetch and launch rules (IsItState). Foundation (and Observation) only,
// and no dependencies, so it builds and tests on Linux as well as for iOS.

import PackageDescription

let package = Package(
  name: "IsItCore",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "IsItModel", targets: ["IsItModel"]),
    .library(name: "IsItLogic", targets: ["IsItLogic"]),
    .library(name: "IsItState", targets: ["IsItState"]),
  ],
  targets: [
    .target(name: "IsItModel"),
    .target(name: "IsItLogic", dependencies: ["IsItModel"]),
    // The app's state (AppModel), its API client and the launch and refresh rules (phase 5),
    // with the services behind protocols (AppEnvironment) that IsItServices fills on iOS.
    .target(name: "IsItState", dependencies: ["IsItLogic", "IsItModel"]),
    // What pnpm mobile:generate writes for the tests (the fixtures and the golden vectors), with
    // their loaders: one copy that every test target reads. Not a product, so no app links it.
    .target(
      name: "IsItTestSupport",
      path: "Tests/IsItTestSupport",
      resources: [.copy("Resources/Fixtures"), .copy("Resources/Vectors")]
    ),
    .testTarget(name: "IsItModelTests", dependencies: ["IsItModel", "IsItTestSupport"]),
    // The ports' golden tests (phase 3): each vector file checked by the ports of its functions,
    // IsItModel's (3.2) as well as IsItLogic's, and the guard that every file is (PortedVectors).
    .testTarget(
      name: "IsItLogicTests",
      dependencies: ["IsItLogic", "IsItModel", "IsItTestSupport"]
    ),
    // AppModel's launch order and refresh rules, the client and the decisions, with fakes.
    .testTarget(
      name: "IsItStateTests",
      dependencies: ["IsItState", "IsItLogic", "IsItModel", "IsItTestSupport"]
    ),
  ],
  swiftLanguageModes: [.v6]
)
