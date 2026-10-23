# will it snow? for iPhone

The native SwiftUI app for willitsnow.today, built from the iOS build spec. This is the skeleton
(phase 0, PRs 0.1 to 0.3): the project, the app and its widget, both entitlements, the debug
hooks, their tests and the CI that builds and runs them. The app shows a fixture when a Debug
build is launched with `-fixture <name>`, and the widget shows the answer the app saved in the
App Group. Fetching, the real home screen and everything else come in later phases.

## What is where

```
project.yml              XcodeGen 2.46.0 spec; WillItSnow.xcodeproj is generated beside it, never committed
Package.resolved         the pinned package versions, copied into the project by ci/xcodegen.sh
Configs/                 Base (every target), Team (Carl's team ID, not a secret), Snow (identifiers,
                         API origin, ad units), CI-Simulator (signed to run locally, for CI)
Packages/IsItCore/       Foundation only, Swift 6 mode, tested on Linux: the API models, generated Keys
Packages/IsItKit/        Apple only, Swift 5 mode: IsItServices (SharedStore), IsItAds (Google's SDKs),
                         IsItUI (the skeleton's answer view), IsItWidgetUI (the widget's entry, provider, view)
Apps/Snow/App/           WillItSnowApp, AppModel, HomeView, DebugHooks (every test and debug hook)
Apps/Snow/Resources/     the app's Info.plist, entitlements and privacy manifest
Apps/Snow/Widgets/       the widget extension, its Info.plist, entitlements and privacy manifest
Apps/Snow/Tests/         app-hosted unit tests: the App Group round trip (V1), widget snapshots
Apps/Snow/UITests/       launches each fixture and attaches the screen
TestPlans/               Unit and UI
ci/                      xcodegen.sh, simulator.sh, test.sh, release-check.sh, xcresult-summary.mjs, contact-sheet.mjs
```

| Target              | Bundle ID                      | Links                                    |
| ------------------- | ------------------------------ | ---------------------------------------- |
| `WillItSnow` (app)  | `today.willitsnow.app`         | IsItModel, IsItServices, IsItUI, IsItAds |
| `WillItSnowWidgets` | `today.willitsnow.app.widgets` | IsItModel, IsItServices, IsItWidgetUI    |
| `WillItSnowTests`   | hosted by the app              | IsItModel, IsItServices, IsItWidgetUI    |
| `WillItSnowUITests` | drives the app                 |                                          |

The widget never links IsItAds. Both the app and the widget have the App Group
`group.today.willitsnow.app`; only the app has `aps-environment`. The name under the icon is
"will it snow?" (`CFBundleDisplayName`).

## Building on a Mac (Carl, optional)

CI builds and tests everything, so this is only for trying the app by hand.

1. Xcode 26.6, and XcodeGen: `brew install xcodegen`, then check `xcodegen --version` says
   2.46.0. If Homebrew has moved on, `ci/xcodegen.sh` downloads 2.46.0 itself.
2. `apps/ios/ci/xcodegen.sh`, then `open apps/ios/WillItSnow.xcodeproj`. Run the script again
   after every pull: the project is generated, never committed, so new files only appear then.
3. Choose the `WillItSnow` scheme and an iPhone 17 simulator, and run. With no fixture the
   app shows only a progress indicator, since it doesn't fetch yet. To see an answer: Product,
   Scheme, Edit Scheme, Run, Arguments, and tick `-fixture aberdeen-snow` (or `leeds-dry`). Then
   add the widget on the simulator's home screen: it shows the same answer.
4. Product, Test runs the Unit test plan; pick UI from the test plan menu for the UI tests.
5. On your iPhone (Debug builds only): Xcode, Settings, Accounts needs your Apple Account, and
   the App IDs `today.willitsnow.app` and `today.willitsnow.app.widgets` need the App Group and,
   for the app, Push Notifications (section 24). Signing is automatic with team `MZPGUCY33H`.
   Uploads to TestFlight come from CI, never from here.

## Checking on Linux (agents)

There is no Xcode here, so iOS code is only compiled on GitHub's macOS runners. What runs here:

```sh
pnpm mobile:check                     # Keys.swift and the fixtures are what packages/mobile writes
docker run --rm -v "$PWD/apps/ios":/w -w /w swift:6.3.3-noble \
  swift format lint --strict --recursive Packages Apps          # every Swift file, as CI lints it
docker run --rm -v "$PWD/apps/ios/Packages/IsItCore":/w -w /w swift:6.3.3-noble \
  bash -c 'apt-get update -qq && apt-get install -y -qq tzdata >/dev/null && swift test'
```

**XcodeGen on Linux.** XcodeGen is a Swift package and builds on Linux, so `project.yml` can be
checked here. Build 2.46.0 once (`git clone --branch 2.46.0
https://github.com/yonaskolb/XcodeGen`, then `swift build -c release --product xcodegen` in the
Swift container with the clone mounted at `/src`). Run it from the same mount, so it finds its
setting presets in `/src/SettingPresets`, and with `USER` set, which it needs:
`docker run --rm -e USER=agent -v <clone>:/src:ro -v "$PWD/apps/ios":/p -w /p
swift:6.3.3-noble /src/.build/release/xcodegen generate --spec project.yml`. The generated
`project.pbxproj` then shows each target's sources, links and settings. The output is the same
from any folder, and as on a Mac.

**Test plans.** A test plan names each target by its object ID in the project. XcodeGen derives
the IDs from the project's and the target's names only, so they never change unless a target is
renamed. `ci/xcodegen.sh` checks every plan against the generated project and names any that
drifted, with the right ID. For a new test target, generate the project as above and copy its
ID from `project.pbxproj` (`<ID> /* <name> */ = { isa = PBXNativeTarget;`).

IsItKit can't be built here (SwiftUI, WidgetKit and Google's binary SDKs), but plain-Foundation
parts can be type-checked in a scratch package: `SharedStore` was, with a stub for
`containerURL(forSecurityApplicationGroupIdentifier:)`, which Linux's Foundation lacks.

## CI (`.github/workflows/ios.yml`)

| Job             | Runs on                     | What it proves                                                                                                                                                                                                                         |
| --------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generated`     | ubuntu                      | `pnpm mobile:check`                                                                                                                                                                                                                    |
| `swift-linux`   | ubuntu, `swift:6.3.3-noble` | every Swift file lints; IsItCore's tests pass (with `tzdata`)                                                                                                                                                                          |
| `ios`           | `macos-26`, Xcode 26.6      | the project generates; packages resolve to the pins; the app, widget and tests build for the iPhone 17 simulator (iOS 26.5); the Unit and UI plans pass; a Release build has no debug hooks, no fixtures and no ads code in the widget |
| `contact-sheet` | ubuntu                      | tiles every attached screen and widget into one PNG                                                                                                                                                                                    |

No job needs a secret. The `ios` job pins `macos-26` (never `macos-latest`, never `-xlarge`) and
selects Xcode 26.6 explicitly. It caches `apps/ios/.spm` (the package checkouts and Google's
binary SDKs) on the hash of `Package.resolved`, and the XcodeGen zip, whose SHA-256 is checked
on every run. It uploads, for five days:

- `ios-results`: `Build.xcresult`, `Unit.xcresult`, `UI.xcresult`, and the JSON xcresulttool
  read from them;
- `ios-attachments`: the PNGs the tests attached, as `xcresulttool export attachments` writes
  them, by test plan;
- `contact-sheet`: `contact-sheet.png`, every attachment at true size (a third of the 3x pixels),
  named underneath;
- `package-resolved`: only when the committed file can't be used (below).

Each step's outcome goes to the run's summary page and to the job log: the build's errors and
warnings with file and line, each test plan's counts and every failure with its file and line
(`ci/test.sh`, using `ci/xcresult-summary.mjs`), and the Release checks. xcbeautify also turns
compiler errors into annotations.

## How agents read CI results

The loop (spec section 17.1): batch the Swift changes, push, wait for `ios.yml`, read what
failed, fix, push again. Expect many round trips; T1 (`swift-linux`) answers in about 3
minutes, the macOS job in about 15.

**With the GitHub MCP tools** (they fetch on GitHub's side, so nothing is blocked):

1. `actions_list` for the workflow runs of `ios.yml` on the branch, newest first; then the run's
   jobs and their steps' conclusions (`actions_get`).
2. `get_job_logs` for a failed job (or only its failed steps). The step summaries are in the log
   as well: search for `### Build:`, `### Unit:`, `### UI:` and `### Release build:`. Each
   failure is a table row with the test, `File.swift:line` and the message.
3. Compiler errors are in the `Build for testing` step: `### Build: failed, N errors` and a row
   per error with its path from `apps/ios/` and line.

**With api.github.com** (from the container, which reaches it):

- `GET /repos/challigan/isithot.today/actions/runs?branch=<branch>` for the run,
  `GET …/actions/runs/<run>/jobs` for the jobs and steps, and
  `GET …/check-runs/<job>/annotations` for the compiler's errors and warnings with file and line
  (GitHub keeps at most 10 errors and 10 warnings a step as annotations; the summary has them
  all).

**Artefacts and raw logs** (the contact sheet, result bundles): GitHub serves these from Azure
blob storage (`productionresultssa*.blob.core.windows.net`), which this environment's network
policy denies (checked 23 October 2026). So `gh run download -n contact-sheet` and the logs
endpoint fail from the container. To read the contact sheet here, Carl adds that host under
Allowed domains in the environment's network access settings. Until then, the text results
above say everything but what the screens look like, and Carl can open the artefact from the
run page.

## Package.resolved

`apps/ios/Package.resolved` pins Google Mobile Ads 13.11.0 (`d1fa1f5…`) and UMP 3.1.0
(`13b248e…`), the exact versions `Packages/IsItKit/Package.swift` names. It was made on Linux:
github.com is reachable, and SwiftPM writes the file before it downloads the binary SDKs from
dl.google.com (blocked here; CI downloads them and checks their checksums, which are in
Google's manifests):

```sh
docker run --rm -v "$PWD/apps/ios/Packages":/p -w /p/IsItKit swift:6.3.3-noble swift package resolve
cp apps/ios/Packages/IsItKit/Package.resolved apps/ios/Package.resolved   # that copy is gitignored
```

The run fails at the download, but the file is complete. In the agents' container, pass the
proxy through (`--network host`, `HTTPS_PROXY`, and the CA bundle as `SSL_CERT_FILE` and
`GIT_SSL_CAINFO`).

Its `originHash` is the SHA-256 of IsItKit's `Package.swift`. Xcode would compute another for the
project, but the builds pass `-disableAutomaticPackageResolution`, which uses the file as a lock
file and only checks that the pins satisfy the manifests; the hash is compared only when
resolution is automatic (SwiftPM 6.3.3, `Workspace+Dependencies.swift`). So a hash that differs
doesn't fail CI, and Xcode on a Mac just rewrites its own copy inside the generated project.

**To change a pin:** edit the exact version in IsItKit's `Package.swift`, resolve again as above,
copy the file, and commit both. The cache key follows the file.

**If CI can't use the committed file**, the `Resolve packages` step fails and the next step
resolves afresh, prints `diff -u` of the committed file against Xcode's in the log, and uploads
Xcode's as the `package-resolved` artefact. The next agent:

1. reads that diff in the log of the step "Keep the Package.resolved Xcode writes";
2. checks the pins in it are still exactly the versions `Package.swift` names (a different
   version means the manifest is wrong, not the file);
3. writes Xcode's version into `apps/ios/Package.resolved` (from the artefact if it can be
   downloaded, otherwise from the diff, which is short JSON);
4. commits it, and pushes; `Resolve packages` must then pass.

## Debug hooks and Release builds

Every test and debug hook is in `Apps/Snow/App/DebugHooks.swift`, inside `#if DEBUG` (spec
section 9.8). A Release build compiles a stub with the same names that does nothing and names no
launch argument. So far there are two:

- `-uitest` turns animations off;
- `-fixture <name>` shows that fixture as if just fetched, and saves it in the App Group for the
  widget. A name with no fixture stops the app, so a UI test can't pass on the wrong screen.

The fixtures are the ones `pnpm mobile:generate` writes for IsItCore's tests. The app's Debug
builds bundle that folder; `EXCLUDED_SOURCE_FILE_NAMES = Fixtures` leaves it out of Release.
Debug builds may also keep the last answer in the app's own container when the App Group can't
open (`DebugHooks.storeFallback`, V1); Release can't. `ci/release-check.sh` builds Release on
every run and fails if a binary names a hook, a fixture is bundled, or the widget links Google
Mobile Ads. Phase 0.4's `scripts/check-archive.sh` checks the signed archive the same way, and
more.

## Settled

The early questions of spec section 26 that phase 0 settles.

| #   | Question                                                                                                                                           | Status                                                         | What settles it                                                                                                                                                                                                                                                | Evidence so far                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | Do App Group defaults and the group container work in CI's simulator builds, signed to run locally?                                                | Pending CI                                                     | `AppGroupTests` in the Unit plan (`ios` job): the group's container opens, its defaults round-trip, and the widget's provider reads the answer the app saved. If not, the Debug fallback is already there, and the test then also runs on Carl's device build. | None yet: needs the first `ios` run.                                                                                                                                                                                                                                                                                                                                                                |
| V4  | Do Foundation's time zones on Linux match core's `localDateTime` for every zone in the vectors?                                                    | Pending CI                                                     | `placeTime.json` in `swift-linux` (phase 3.3). PR 0.1's Linux run decodes fixtures only, so it doesn't cover time zones.                                                                                                                                       | A local probe on 23 October 2026 (`swift:6.3.3` with `tzdata`, Docker): a Gregorian calendar in `TimeZone(identifier:)`, falling back to UTC, matched core's `localDateTime` in all 126 cases: London, Kolkata (+5:30), Kathmandu (+5:45), Adelaide, Kiritimati (+14), Denver, Reykjavík, `Etc/GMT-5` and an unknown zone, at 14 instants across both UK clock changes and Adelaide's and Denver's. |
| V11 | Do Google Mobile Ads 13.11.0 and UMP 3.1.0 resolve and cache through SPM on the runner? Is the demo app ID right? Does UMP's debug geography work? | Resolve: yes. Cache: pending CI. App ID and geography: phase 8 | The `ios` job's `Resolve packages` step (only the committed versions) and the `.spm` cache, whose hit or miss the run summary shows; the build then compiles IsItAds against both SDKs.                                                                        | `swift package resolve` on Linux resolved both exact pins at their tags' revisions, which match `git ls-remote`. The binary zips couldn't be fetched here (dl.google.com is blocked), so CI is the first to download them.                                                                                                                                                                          |
| V13 | Will `xcodebuild` run the iPhone-only app on an iPad simulator, in compatibility mode?                                                             | Pending CI                                                     | `ipad-compat` in `ios-nightly.yml` (spec section 18.2), which is still to be written. If not: `simctl install`, then `simctl io` screenshots for an agent to review.                                                                                           | None yet.                                                                                                                                                                                                                                                                                                                                                                                           |

## Not here yet

Each comes with the phase that needs it, so nothing in the skeleton is dormant:

- the generated copy, constants, palettes, glyphs, app icon (`ASSETCATALOG_COMPILER_APPICON_NAME`
  is empty until then) and the answer font (phase 2); the launch screen's `LaunchBackground`
  colour, which needs the palettes;
- the target keys, freshness, hour picker and widget planner (phase 3), so the skeleton's widget
  shows one entry and never goes stale: the only answer it can find is a Debug fixture;
- `SnowKit`, `APIClient`, location, StoreKit (`Snow.storekit`), notifications, `AdsService` and the
  banner, `SKAdNetworkItems`, and the privacy manifests' collected data types (coarse location,
  the push token);
- `FEATURE_UNLOCK` and `FEATURE_ADS` (spec section 9.8), with the purchase and the ads;
- the Screenshots test plan, `ios-nightly.yml` and `ios-release.yml`.
