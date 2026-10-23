# will it snow? for iPhone

The native SwiftUI app for willitsnow.today, built from the iOS build spec. This is the skeleton
(phase 0, PRs 0.1 to 0.4): the project, the app and its widget, both entitlements, the debug
hooks, their tests, the CI that builds and runs them, and the release job that signs the app and
uploads it to TestFlight; with phase 2.3's generated assets: the snow glyphs, the app icon and
the answer font; and phase 5.1, the skeleton TestFlight build: the app fetches the answer for
its place (approximate IP location until one is chosen, so the first launch shows the phone's
own place with no picker), keeps it current, saves it in the App Group, where the widget reads
it, and draws it on the home screen's top bar and Today page (below, "Phase 5.1"). A Debug build
can be answered by a fixture or a stubbed network instead (below, "Debug hooks"). Everything else
comes in later phases.

## What is where

```
project.yml              XcodeGen 2.46.0 spec; WillItSnow.xcodeproj is generated beside it, never committed
Package.resolved         the pinned package versions, copied into the project by ci/xcodegen.sh
Configs/                 Base (every target), Team (Carl's team ID, not a secret), Snow (identifiers,
                         API origin, ad units), CI-Simulator (signed to run locally, for CI)
Packages/IsItCore/       Foundation only, Swift 6 mode, tested on Linux: the API models; generated CoreCopy,
                         Questions, AppCopy, Constants, Keys and Palettes; the ports and the home screen's
                         presenters (IsItLogic); AppModel, its API client and the launch and refresh rules
                         (IsItState); in Tests/IsItTestSupport the fixtures and golden vectors with their
                         loaders; in Tests/IsItLogicTests the ports' golden tests and the guard that every
                         vector file is ported (below); in Tests/IsItStateTests AppModel with fakes, and
                         the home screen drawn from it
Packages/IsItKit/        Apple only, Swift 5 mode: IsItServices (SharedStore, URLSessionTransport,
                         WidgetCenterReloader: AppModel's services), IsItAds (Google's SDKs),
                         IsItUI (the home screen: HomeShell and ForecastPageView, drawing IsItLogic's
                         HomePage and HomeTopBar, with HomeActions), IsItWidgetUI (the widget's entry,
                         provider, view), SnowKit (Glyphs, Color(rgb:) for the palettes, and the glyph
                         catalogues, generated)
Apps/Snow/App/           WillItSnowApp (the services and the scene's phases), HomeView (the home screen,
                         from the model), DebugHooks (every test and debug hook)
Apps/Snow/Resources/     the app's Info.plist, entitlements and privacy manifest; generated: Assets.xcassets
                         (the app icon) and Fonts/BricolageAnswer.ttf (the app's and the widget's)
Apps/Snow/Widgets/       the widget extension, its Info.plist, entitlements and privacy manifest
Apps/Snow/Tests/         app-hosted unit tests: the App Group round trip (V1), widget and glyph snapshots,
                         palette contrast, the answer font
Apps/Snow/UITests/       FixtureLaunchTests (fixtures at their own moments, and a place nearby) and
                         LaunchTests (the real launch over a stubbed network); both attach the screens
TestPlans/               Unit and UI
ci/                      xcodegen.sh, simulator.sh, test.sh, release-check.sh, xcresult-summary.mjs, contact-sheet.mjs;
                         for releases archive.sh, upload.sh and ExportOptions.plist
```

The release checks are in the repo's `scripts/`: `check-archive.sh`, with `swift-small-strings.mjs`
(below), and `asc-key.mjs` and `asc-notes.mjs` for the App Store Connect key and What to Test.

| Target              | Bundle ID                      | Links                                                                   |
| ------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| `WillItSnow` (app)  | `today.willitsnow.app`         | IsItModel, IsItLogic, IsItState, IsItServices, IsItUI, IsItAds, SnowKit |
| `WillItSnowWidgets` | `today.willitsnow.app.widgets` | IsItModel, IsItServices, IsItWidgetUI, SnowKit                          |
| `WillItSnowTests`   | hosted by the app              | IsItModel, IsItServices, IsItUI, IsItWidgetUI, SnowKit                  |
| `WillItSnowUITests` | drives the app                 |                                                                         |

The widget never links IsItAds. Both the app and the widget have the App Group
`group.today.willitsnow.app`; only the app has `aps-environment`. The name under the icon is
"will it snow?" (`CFBundleDisplayName`). Both bundle the answer font and list it in `UIAppFonts`,
since an extension can't load the app's fonts; only the app has an icon.

## Building on a Mac (Carl, optional)

CI builds and tests everything, so this is only for trying the app by hand.

1. Xcode 26.6, and XcodeGen: `brew install xcodegen`, then check `xcodegen --version` says
   2.46.0. If Homebrew has moved on, `ci/xcodegen.sh` downloads 2.46.0 itself.
2. `apps/ios/ci/xcodegen.sh`, then `open apps/ios/WillItSnow.xcodeproj`. Run the script again
   after every pull: the project is generated, never committed, so new files only appear then.
3. Choose the `WillItSnow` scheme and an iPhone 17 simulator, and run. With no fixture the
   app asks willitsnow.today for the answer by approximate IP location (the simulator's network
   is the Mac's). To see a fixture instead: Product, Scheme, Edit Scheme, Run, Arguments, and
   tick `-fixture aberdeen-snow` (or `leeds-dry`, or add `-fixture` with any other fixture's
   name, below). Then add the widget on the simulator's home screen: it shows the same answer.
   Pull the page down to ask again; a place under "Nearby:" loads in place. The place and
   Settings buttons and "Use my location" do nothing until phase 6 brings their sheets.
4. Product, Test runs the Unit test plan; pick UI from the test plan menu for the UI tests.
5. On your iPhone (Debug builds only): Xcode, Settings, Accounts needs your Apple Account, and
   the App IDs `today.willitsnow.app` and `today.willitsnow.app.widgets` need the App Group and,
   for the app, Push Notifications (section 24). Signing is automatic with team `MZPGUCY33H`.
   Uploads to TestFlight come from CI (next section); Xcode is only the last way, if CI's fail.

## Releasing to TestFlight (Carl)

`.github/workflows/ios-release.yml` builds the app for the App Store, checks it, signs it through
App Store Connect with the team key in the `testflight` environment, and uploads it to
TestFlight. It runs only when you start it, and only from `main`.

1. On GitHub: **Actions**, then **iOS release** on the left, then **Run workflow** on the right.
2. Leave **Use workflow from** on `main`. Any other branch or tag fails at once.
3. **build**: `testflight` (the default) signs, checks and uploads. `unsigned` only builds and
   checks an unsigned Release archive, with no key and no approval: a way to try a build before
   anything is signed.
4. **ads**: `test`, Google's demo units, for every build before the release candidate. `real`
   only for a release candidate, once the repository variables `ADMOB_APP_ID` and
   `ADMOB_BANNER_ID` are set (C15).
5. **notes** (optional): what testers should try. It becomes the build's What to Test in
   TestFlight.
6. **Run workflow**. Within a minute the run waits for you: open it, press **Review
   deployments**, tick `testflight`, then **Approve and deploy**. GitHub emails you too. Until
   you approve, the job hasn't started, and nothing can read the key.
7. About half an hour later the build is in App Store Connect. TestFlight on your iPhone shows it
   to the internal group once Apple has processed it, usually 5 to 30 minutes more.

Two settings of the environment (Settings, Environments, `testflight`) matter: you as required
reviewer, with **Prevent self-review** off, since you start and approve your own runs; and
**Deployment branches and tags** limited to `main`, so a workflow edited on another branch can't
reach the key.

**The run's summary** (the run's page, under the jobs) shows, in order:

- **TestFlight build N**: the build number (100 + the run number), the commit, the ad units, your
  notes and the Xcode version;
- **Archive, signed, ads test**: whether it built, and each compiler error or warning with its
  file and line;
- **Archive checks**: both bundles have privacy manifests and the answer font; the app has its
  icon; the widget links no Google Mobile Ads;
  neither binary names any of the 13 debug hooks; the ad units are Google's demo ones (test) or
  yours (real); the app and widget have the same version and build; `ITSAppUsesNonExemptEncryption`
  is false; no fixture is bundled. Each failure is named;
- **Export**: the `.ipa` and its size;
- **Signed app checks**: the app gets notifications in production, both have the App Group, the
  widget doesn't get notifications, and neither is debuggable;
- **Upload**: which tool sent it (altool, then xcodebuild, then fastlane, each only if the one
  before failed), or App Store Connect's reason for refusing the build;
- **What to test**: set, or why not, in which case type it in App Store Connect.

An `unsigned` run's summary has the build number, the archive and its checks.

**If it fails**, the summary says at which step. What a first run may meet:

| Step              | What it says                                                           | What to do                                                                                                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Archive, signed   | Your team has no devices from which to generate a provisioning profile | Automatic signing signs the archive for development first, and Apple wants one registered iPhone for that. Add yours under Certificates, Identifiers & Profiles, Devices (Finder shows its UDID when it is plugged into your Mac), then run again. |
| Archive or Export | Cloud signing permission error, or a 401 or 403                        | The key must be a Team key with the Admin role (C12). **App Store Connect check** (`asc-check.yml`) tests the key alone.                                                                                                                           |
| Upload            | ITMS-90022, ITMS-90713 or another missing icon                         | The app has had its icon since phase 2.3, and the archive checks fail without it, so App Store Connect wants something more of the icon set: an agent fixes the generator (`packages/mobile/src/exportIcon.ts`).                                   |
| Upload            | The bundle version must be higher                                      | A re-run keeps its run's build number. Start a new run instead.                                                                                                                                                                                    |
| Archive checks    | the check that failed                                                  | An agent fixes the app (or the check) in a pull request.                                                                                                                                                                                           |

Each signed run may add an Apple Development certificate to the team, since the runner keeps no
keychain between runs. If they pile up under Certificates, revoke the old ones; TestFlight builds
don't depend on them.

## Checking on Linux (agents)

There is no Xcode here, so iOS code is only compiled on GitHub's macOS runners. What runs here:

```sh
pnpm mobile:check                     # the Swift, fixtures, vectors, glyphs, icon and font are as generated
docker run --rm -v "$PWD/apps/ios":/w -w /w swift:6.3.3-noble \
  swift format lint --strict --recursive Packages Apps          # every Swift file, as CI lints it
docker run --rm -v "$PWD/apps/ios/Packages/IsItCore":/w -w /w swift:6.3.3-noble \
  bash -c 'apt-get update -qq && apt-get install -y -qq tzdata >/dev/null && swift test'
```

That `swift test` runs the vector guard too, which checks every vector file with its port
(below).

**The answer font.** `pnpm mobile:check` never needs Python: it checks the font by the recipe
stamped in it (`packages/mobile/src/exportFont.ts`). `pnpm mobile:generate` runs
`scripts/make-answer-font.py --ttf` only when the font is out of date, which needs python3 with
fontTools 4.66.1 and brotli (`pip install fonttools==4.66.1 brotli`; the agents' container has
them). After changing the woff2's instance or subset, build the woff2 first (the script with no
arguments): `--ttf` refuses to build a font that differs from it.

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
`containerURL(forSecurityApplicationGroupIdentifier:)`, which Linux's Foundation lacks. So were
IsItServices and `DebugHooks.swift`, built twice (with `DEBUG` defined, and without, as Release),
in Swift 5 mode, with `import FoundationNetworking` added to copies of the files (URLSession and
`URLProtocol` live there on Linux) and stub `UIKit` and `WidgetKit` modules declaring the one
call each makes (`UIView.setAnimationsEnabled(_:)`, `WidgetCenter.shared.reloadAllTimelines()`),
beside a copy of `WillItSnowApp.environment()`. SnowKit's
`Glyphs` was, against a stub `SwiftUI` module declaring `Image(decorative:bundle:)` as SwiftUI
does, with the glyph catalogue copied in as a resource and a test that every band names an image
set that exists. `swift package dump-package` in IsItKit checks its manifest.

## Porting against the golden vectors (phase 3)

Every rule the app shares with the website is ported from the TypeScript and checked against its
vector file, case by case (spec sections 7.4 and 9.2). IsItCore's `IsItLogicTests` target holds
every port's golden test, IsItModel's (3.2) as well as IsItLogic's, so that one guard sees them
all: `VectorCoverageTests` (spec section 19, phase 3's exit) has a test case for each vector file
pnpm mobile:generate writes, which loads the file and runs its port. It fails for a file whose
port is still nil in `Tests/IsItLogicTests/PortedVectors.swift`, for a generated file that isn't
listed there, and for a port that doesn't read the cases of every function in its file.

To port a file:

1. Write the Swift (in IsItLogic, or IsItModel for 3.2's).
2. In a test file of its own in `Tests/IsItLogicTests`, define its port, checking every case of
   every function in the file; for `grid.json`, say:

   ```swift
   extension VectorPort {
     static let grid = VectorPort { file in
       struct Rounding: Decodable, Sendable {
         let value: Double
         let step: Double
       }
       try file.compare("roundToGrid", input: Rounding.self, output: Double.self) {
         GridRounding.round($0.value, step: $0.step)
       }
     }
   }
   ```

   `file.compare` runs the port on each case and, on a mismatch, names the file, the case's
   index and its input, with both values. It compares with `==` and then `sameText`, every
   string in the two code unit for code unit, as JavaScript compares strings (Swift's `==` takes
   canonically equivalent text as equal). Where an output needs more than that (an answer named
   by its path in the fixture, say), run your own expectations over the cases with
   `file.forEachCase(_:input:output:decoder:_:)`, which notes each case it runs on; the guard
   fails a function with a case no check ran on, so reading the cases with `file.cases` checks
   none. `Fixtures.decode(_:at:in:decoder:)` reads a path such as `snow.days.1` back from the
   fixture, with `ApiJSON.decoder()` for the API's types.

   A test file that calls `file.compare` imports Testing, whose `#_sourceLocation` is its
   default argument. For a case naming a fixture, `FixtureAnswers` (in
   `Tests/IsItLogicTests/FixtureAnswers.swift`) decodes each answer once per check; give the
   case's input type `fixture` and `without` (`FixtureCase`, or `FixtureAt` and `FixtureOnly`)
   and call `answers(input)`, so a case that takes blocks out of its fixture (`in.without`, for
   the rules' fallbacks: a field, a list's item such as `snow.days.1`, or every item, as in
   `now.series.*`) is answered without them, as `vectors.ts` answered it.

3. In `PortedVectors.swift`, change the file's `port: nil` to the port (`port: .grid`).

**Every file is ported** (3.2, 3.3 and 3.4), so `swift test` passes in IsItCore, the guard
included. Until the last port landed it failed, with one issue for each file not yet ported; on
23 October 2026 that was all 13, each marked done here as its port landed:

| Vector file      | Ported by | Swift                                               |
| ---------------- | --------- | --------------------------------------------------- |
| `grid.json`      | 3.2, done | `GridRounding.round`                                |
| `target.json`    | 3.2, done | `Target.key`, `Target(query:)`, `Target(search:)`   |
| `query.json`     | 3.2, done | `TodayQuery.build`                                  |
| `placeTime.json` | 3.3, done | `PlaceTime.local(_:in:)`                            |
| `tomorrow.json`  | 3.3, done | `MiddleDay.showsTomorrow`, `.defaultView`, `.label` |
| `freshness.json` | 3.3, done | `Freshness`                                         |
| `hours.json`     | 3.3, done | `HourPicker.pick`, `UpdatedLine.text`               |
| `questions.json` | 3.3, done | `Questions.snow`                                    |
| `strip.json`     | 3.3, done | `StripGeometry`                                     |
| `widget.json`    | 3.4, done | `WidgetPlanner.entries`                             |
| `alerts.json`    | 3.4, done | `AlertSync.action`, `.body`, `.fingerprint`         |
| `links.json`     | 3.4, done | `DeepLink.parse`, `.route(payload:placeNow:)`       |
| `recent.json`    | 3.4, done | `RecentPlaces`                                      |
| `page.json`      | 5.1, done | `HomePage`, `Credits.parts`                         |

While a file was still to port, `ios.yml`'s `swift-linux` job failed at its Test step, and the
jobs that need it (`ios`, `archive-check`, and so `contact-sheet`) didn't run. A new vector file
fails the guard the same way until its port is listed.

What the ports share (DECISIONS, "The iPhone app's clock rules" and "The iPhone app's IsItCore,
put together"):

- **Moments are `Date`,** in and out, and the rules count them in whole milliseconds inside,
  as the TypeScript does: `Date(epochMs:)` and `.epochMs` (IsItModel) convert, `Date.hourMs` is
  core's `HOUR`, and the vectors' moments are epoch milliseconds.
- **JavaScript's arithmetic is one copy,** `JavaScriptNumber` in IsItModel (`package`, so
  IsItLogic shares it): `String(n)` for keys, queries, the strip's amounts and fingerprints, and
  `Math.round` and `toFixed` for the grid.
- **The clock rules read more than snow.** `Freshness` and `MiddleDay.showsTomorrow` read the
  hot answer's days and Now and the rain answer's today and Now, as the client does, so
  `TodayResponse` decodes their moments and dates (`hotDays`, `hotNow`, `rain`) and snow's Now
  its series' hours, leniently. Nothing else of the hot and rain answers is decoded.
- **`HourPicker.pick(_:at:)` and `MiddleDay(_:picked:at:)`** are what the widget planner (3.4)
  builds on, with `Freshness.usableUntil(_:)`.

What 3.4's ports give the app (DECISIONS, "The iPhone app's widget plan, notification sync,
links and recent places"):

- **`WidgetPlanner.entries(_:fetchedAt:now:unlocked:placeName:)`** gives a `WidgetPlan`: the
  entries (`WidgetEntry`, whose `date` is the timeline entry's) and `reloadAt`, `.never` or
  `.after(Date)`, WidgetKit's reload policy.
- **`AlertSync.action(...)`** says `put`, `delete`, `none`, `needsPlace` or `needsToken`;
  `AlertSync.body(...)` is the `PUT /api/v1/devices` body (`RegistrationBody`, `Codable`), and
  `AlertSync.fingerprint(_:)` what `alertSync.v1` keeps of it, with `AlertSync.Sent`.
- **`DeepLink.parse(_:)`** reads a willitsnow:// link (a `String` or a `URL`), and
  **`DeepLink.route(payload:placeNow:)`** a notification's `userInfo`, given the place's time
  now as `PlaceTime.local(_:in:)` gives it; a place route's view is nil for the place's view for
  the time of day.
- **`RecentPlaces.adding(_:name:to:max:)` and `.removing(_:from:)`** keep `recent.v1`'s
  `[RecentPlace]`, which is `Codable` as the client's JSON.

## Phase 5.1: the data, the launch and the home screen

PR 5.1 came in two halves, built side by side and then connected: the data and the launch, and
the Today page. DECISIONS has each half's choices, and how they were connected ("The iPhone app's
data and launch", "The iPhone app's Today page" and "The iPhone app's home screen, connected").

### The data and the launch

`IsItState`, in IsItCore, is the app's state and its one request, with every decision about them
pure and tested on Linux (`Tests/IsItStateTests`); IsItServices fills its protocols on iOS (spec
sections 4 and 9.4 to 9.6).

- **`AppModel`** (`@MainActor @Observable`) holds the place, the units, the answer on screen
  and when it was fetched, the phase (loading, ready, offline, or an error: rate limited, or
  with the server's code and message), the holds, the unlock, the view on screen, a one-off notice and a pending
  route. `init(environment:)` is step 1 of the launch: it reads what is stored and paints the
  saved answer at once when it is for the place and still has an hour to show. `launch()` runs
  steps 2 to 7 once; `refresh()` is pull to refresh and "Try again"; `didEnterBackground()` and
  `willEnterForeground()` follow the scene's phase; `select(_:)` loads a place under "Nearby:"
  in place; `now` is its clock's time, and `topBar` and `page(_:at:)` what the home screen
  draws (below); `answer(at:)` and `offlineLine(at:)` say the same of the answer, and a test
  holds the page to them.
- **`AppEnvironment`** gives it `APIClient` (over an `HTTPTransport`), an `AppClock` (the time,
  and work at a time: `SystemClock`, which a Debug build can start at a fixture's moment), a `StoredState`, a `WidgetReloader`, the later phases' `AppHooks`
  (`NoHooks` until phases 6, 7 and 8 fill them: the entitlement check, the location fix, the
  ads, the notifications and routes) and the random jitter.
- **The decisions** are `Launch` (paint, reuse under 10 minutes, the launch's fetch), `Refresh`
  (how to ask again, the hourly refresh with 0 to 90 s of jitter, the retry after a failure,
  and the return to the foreground) and `AnswerState` (the picked hour, the stale state past
  `usableUntil`, offline or the error with nothing saved, and the footer's offline line).
- **`APIClient`** builds `TodayQuery.build`'s query with `ahead=snow` (byte for byte the query
  vectors'), decodes `TodayResponse` and maps failures to `FetchError`: offline for
  `URLError.notConnectedToInternet` and its kin (`APIClient.offlineCodes`), rate limited for 429,
  and failed otherwise, with the status and the `ApiError` code and message when the server sent
  them. It never logs, and a `FetchError` never carries the URL.
- **What is stored**: `SavedToday` (IsItModel) is the codec of `today.v1.json`,
  `{ v, savedAt, key, response }`, which is ignored when `v` is another store version;
  `StoredUnlock` reads `unlock.v1`.
  `SharedStore` is the App Group's `StoredState`: `place.v1`, `units.v1`, `unlock.v1` (read
  only) and the saved answer; `MemoryState` stands in without an App Group.
- **Apple only, and so proven only by CI's macOS jobs**: `URLSessionTransport` (section 4's
  settings), `SharedStore`'s defaults, `WidgetCenterReloader`, the app's wiring in
  `WillItSnowApp.swift` and the debug hooks. IsItServices and the widget's provider were
  type-checked on Linux against stubs of WidgetKit and `containerURL` (above).

### The home screen

The top bar and the Today page (spec section 10.2), drawn from plain values:

- **IsItLogic makes the content** (Linux-tested): `HomePage(_:view:at:phase:message:placeName:)`
  gives a page's state, band and palette, question, answer, the heading VoiceOver reads with the
  place, verdict and detail, the middle page's agreement, strip, model list and limited line,
  Retry, and the footer (the Updated line, the offline, unavailable or stale line, the links out,
  the places nearby and the credits in pieces with their links);
  `HomeTopBar(placeName:approximate:notice:)` the top bar. Its
  reference is packages/mobile `page.ts`, made of core's and the client's rules, and `page.json`
  checks it case by case (the table above).
- **IsItUI draws it:** `HomeShell(topBar:theme:actions:content:)` (the background of the page on
  screen and the top bar over the pages), `ForecastPageView(page:theme:glyph:actions:)` (one page),
  `PageTheme` (a page's colours) and `HomeActions` (retry, open the place picker, open Settings,
  use my location, open a link, select a nearby place). IsItUI doesn't know the app's model, and
  doesn't link SnowKit: the app gives each page its theme (`PageTheme(palette)`, with SnowKit's
  `Color(rgb:)`) and glyph (`Glyphs.image`).
- **The app connects them** in `HomeView.swift` alone (next).

### How they meet

- **The root** (`WillItSnowApp.swift`) makes `AppModel` with the production `AppEnvironment`:
  `APIClient` over `URLSessionTransport` at `API_ORIGIN`, `SystemClock`, the App Group's
  `SharedStore` (a Debug build falls back to its own container, any other build to
  `MemoryState`), `WidgetCenterReloader` and `NoHooks`. The model paints the saved answer as it
  is made (step 1); `.task` runs `launch()` (steps 2 to 7, spec section 9.4), and the scene's
  phase calls `didEnterBackground()` and `willEnterForeground()`.
- **The first launch** has no `place.v1`, so the target is approximate IP location: the app asks
  `/api/v1/today?ahead=snow`, the server places the phone and chooses the units, which the app
  then keeps. The top bar shows "Finding you…" (which VoiceOver reads as "Finding you…, change
  place.") until the answer names the place, then the place with "Using approximate location."
  beneath it. No picker, and no prompt.
- **The home screen** (`HomeView.swift`) draws `model.topBar`, and the Today page at the
  model's clock (`model.page(.today, at: model.now)`), with IsItUI's `HomeShell` and
  `ForecastPageView`, inside a `TimelineView(.everyMinute)`, so the hour picked, Tomorrow from
  6pm and the stale state follow the clock while the app is open. Only the middle page is drawn in 5.1, whatever `model.view`
  says; phase 5.2's pager binds it.
- **The states**, as `HomePage` gives them from the model's phase (spec sections 4, 9.5 and
  10.2): loading ("Checking…"); ready; an error with nothing saved (the server's message, or
  `CoreCopy.unavailable` without one, and Retry); offline with nothing saved ("No recent
  forecast. Connect to the internet to refresh." and Retry); rate limited (429) with nothing
  saved ("Too many requests. Try again in a minute." and Retry); offline with an answer (the
  answer, and "You're offline. Showing the forecast from …" in the footer); an error with an
  answer (the answer stays, with "Forecasts are unavailable right now…" and Retry under the
  footer's Updated line); rate limited with an answer (the answer, quietly: the model asks again
  a minute later, and never says it is offline); and past `usableUntil`, no recent forecast,
  never the old hour.
- **The actions:** Retry calls `refresh()`; pulling the page down (`.refreshable`, on the page's
  scroll view) calls it too, keeping what is on screen; a place under "Nearby:" calls
  `select(.city(slug:name:))`, which keeps it as the place and shows the loading state under its
  name until its answer arrives; links open in Safari. The place picker, Settings and "Use my
  location" do nothing until phase 6.
- **The notice** (`AppCopy.slugGone`, when a city page's place has gone and the app fell back to
  approximate location) takes the approximate line's place in the top bar until a place is
  chosen.

### Reading 5.1's tests

**On Linux** (`swift test` in IsItCore; each test's name says what it proves):

- `Tests/IsItStateTests/AppModelTests.swift`, `LaunchTests.swift`, `RefreshTests.swift` and
  `APIClientTests.swift`: the launch order, the refresh rules and the request, with a fake
  server, clock, store, widgets and hooks (`Fakes.swift`'s `Harness`).
- `Tests/IsItStateTests/HomeScreenTests.swift`: what the home screen draws from the model. "The
  home screen, from the model" goes through the first launch with nothing stored (asked by IP,
  then "Leeds" on approximate location), an error then Retry, offline with and without a saved
  answer, past `usableUntil`, an error over an answer, a 429 with and without one, and the
  server's message with nothing saved; it also holds the page to `AnswerState` for every
  fixture at its own moment, a millisecond before `usableUntil` and at it, in each phase (a 400
  with its message, a bodiless 500 and a 429 among them). "A nearby place, loaded in place"
  covers `select(_:)`: the request, the
  place kept, the loading state under the new name meanwhile (never the last answer), offline,
  the same place again, and the notice going. "The system's clock" proves that a clock started
  at another moment schedules by its own time, ahead or behind.
- `Tests/IsItLogicTests/HomePageTests.swift` and `PageVectorTests.swift`: the page's content,
  against `page.json` (the TypeScript in packages/mobile `page.ts`).

**On the macOS CI** (the UI test plan; `### UI:` in the `ios` job's log names each failure with
its file and line, and the contact sheet shows the screens each test attached):

- `FixtureLaunchTests`: `-uitest -resetStore -fixture <name>`, each launch from a clean store (so
  no test sees the place another left), every request answered with that fixture, the model's
  clock started at the fixture's moment. aberdeen-snow, leeds-dry, durham-tomorrow (Tomorrow
  from 6pm) and old-forecast (no recent forecast; it waits for the Updated line, as it has no
  verdict) read the place button, the one heading and the verdict; `testNearbyLoadsInPlace` taps
  "Dundee" under "Nearby:" and waits for "Dundee. Will it snow today? Yes." (the fixture's server
  answers every place alike).
- `LaunchTests`: no fixture hook. The app's own client, URLSession transport and store run, with
  only the network stubbed (`-network`): `ip-first-launch` answers the request for approximate IP
  location and nothing else. `testFirstLaunchShowsTheApproximatePlace` (`-resetStore`) proves the
  first launch asks by IP and shows Leeds on approximate location;
  `testOfflineRelaunchKeepsTheSavedAnswer` launches, then relaunches with `-network off` and
  `-now` 15 minutes on, and reads the saved answer and the offline line;
  `testOfflineWithNothingSaved` reads "No recent forecast…" and Retry. Their screens are
  `app-first-launch`, `app-offline-saved` and `app-offline-nothing`.

## CI (`.github/workflows/ios.yml`)

| Job             | Runs on                     | What it proves                                                                                                                                                                                                                                                             |
| --------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generated`     | ubuntu                      | `pnpm mobile:check`                                                                                                                                                                                                                                                        |
| `swift-linux`   | ubuntu, `swift:6.3.3-noble` | every Swift file lints; IsItCore's tests pass (with `tzdata`), the vector guard included: every vector file checked by its port (above)                                                                                                                                    |
| `ios`           | `macos-26`, Xcode 26.6      | the project generates; packages resolve to the pins; the app, widget and tests build for the iPhone 17 simulator (iOS 26.5), with the icon and glyph catalogues; the Unit and UI plans pass; a Release build has no debug hooks, no fixtures and no ads code in the widget |
| `archive-check` | `macos-26`, Xcode 26.6      | an unsigned Release archive for iPhones builds and passes `scripts/check-archive.sh` with ads test: the release job's archive checks, on every pull request, with no key                                                                                                   |
| `contact-sheet` | ubuntu                      | tiles every attached screen and widget into one PNG, whenever `ios` uploaded attachments (failed tests included); skipped when `ios` failed before its tests ran                                                                                                           |

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
   as well: search for `### Build:`, `### Unit:`, `### UI:`, `### Release build:`,
   `### Archive, unsigned` and `### Archive checks:`. Each failure is a table row with the test,
   `File.swift:line` and the message, or for the archive checks a line naming the check.
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

## Glyphs, icon and answer font

`pnpm mobile:generate` writes all three from the website (spec section 7.1); never edit them.

- **Glyphs:** `Packages/IsItKit/Sources/SnowKit/Resources/Glyphs.xcassets`, from
  `apps/web/src/lib/snowGlyphs.ts`. Template images in SVG: `Glyphs.image(band)` is the whole
  glyph, tinted by the foreground style, and `Glyphs.layers(band)` its still part and its flakes,
  for the drift. `SnowKit/Fallback/Glyphs.xcassets` has the same sets as PNGs, built only if the
  SVGs fail (V7, below).
- **App icon:** `Apps/Snow/Resources/Assets.xcassets/AppIcon.appiconset`, from
  `apps/web/public/snow/favicon.svg`: `any.png`, `dark.png` and `tinted.png`, each 1024×1024 with
  no alpha channel. Xcode makes every size from them. Carl approves it (Q9): open the three PNGs
  in the pull request.
- **Answer font:** `Apps/Snow/Resources/Fonts/BricolageAnswer.ttf`, the website's answer font
  (`apps/web/src/fonts/bricolage-answer.woff2`) as TrueType, named `BricolageAnswer` for
  `Font.custom`.

## Debug hooks and Release builds

Every test and debug hook is in `Apps/Snow/App/DebugHooks.swift`, inside `#if DEBUG` (spec
section 9.8). A Release build compiles a stub with the same names that does nothing and names no
launch argument. So far there are these:

- `-uitest` turns animations off;
- `-resetStore` forgets the place, the units and the saved answer before the model reads them,
  for a first launch (not `unlock.v1`, which only StoreKit's code writes); every UI test's first
  launch passes it;
- `-fixture <name>` answers every request with that fixture (a transport of its own), after
  forgetting the saved answer, so the launch fetches it rather than painting an earlier one; it
  is then saved in the App Group for the widget, as any answer is;
- `-network <name>` keeps the app's own `URLSessionTransport`, with section 4's settings, and
  stubs the network beneath it (`URLProtocolStub`, section 9.8's URLProtocol stub): the request
  for approximate IP location (`/api/v1/today` with `ahead=snow`, and `units` or `t`, but no
  place) gets that fixture, a request for any other place a 400, and another path a 404, so an
  answer on screen means the app asked for the right place. Nothing is forgotten, so a relaunch
  paints and reuses what was saved. `-network off` has no connection
  (`URLError.notConnectedToInternet`);
- with `-fixture` or `-network <name>`, the model's clock starts at the fixture's own moment
  (`_fixture.now`) and runs on (`SystemClock(startingAt:)`), so on any day the fixture shows the
  state it was made for: the hour picked, Tomorrow from 6pm at the place, no recent forecast for
  `old-forecast`. `-now <iso>` starts it at that moment instead. Spec 9.8's `-clock fixed` comes
  with phase 5.4; the clock always runs;
- `-apiOrigin <url>` asks a deploy preview's API instead of willitsnow.today's (spec section 4);
- the unit tests' host: when the app only hosts the unit tests (XCTest's
  `XCTestConfigurationFilePath` in its environment), it doesn't launch (`AppModel.launch()`), so
  the hosted tests have the App Group to themselves; a launch with `-fixture` or `-network`
  always launches.

A fixture name that doesn't exist or doesn't decode, a `-now` that isn't a moment, or a saved
answer `-resetStore` can't remove stops the app, so a UI test can't pass on the wrong screen.

The fixtures are the ones `pnpm mobile:generate` writes for IsItCore's tests: 21 answers from
the real server (two with a block deleted), each with a `_fixture` note saying what it shows
(`durham-tomorrow`, `kathmandu-0545`, `london-dst-autumn-night`, `stale`, `old-forecast` and the
rest; the list is in `packages/mobile/src/fixtures.ts`). The app's Debug builds bundle that
folder; `EXCLUDED_SOURCE_FILE_NAMES = Fixtures` leaves it out of Release. The golden vectors
beside them (`Resources/Vectors`, the files section 7.4 lists, one case to a line) are for
IsItCore's tests only.
Debug builds may also keep the last answer in the app's own container when the App Group can't
open (`DebugHooks.storeFallback`, V1); Release can't. `ci/release-check.sh` builds Release on
every run and fails if a binary names a hook, a fixture is bundled, or the widget links Google
Mobile Ads. `scripts/check-archive.sh` checks the unsigned Release archive on every run
(`archive-check`) and the signed one before each upload, for the hooks of section 9.8 (`-network`
among them, as a short literal) and the rest of section 18.3's list.

**Short literals.** strings(1) can't find a hook's name in an optimised build: Swift keeps a
string of 15 bytes or fewer inside the value, and the compiler builds such a literal in registers
with `movz` and `movk`, 16 bits at a time, so `-uitest` never appears as text in the binary.
Every hook's name is that short. `scripts/swift-small-strings.mjs` rebuilds those literals from
the arm64 instructions, and both checks look in its output as well as in strings'. The compiler
can spread a literal's instructions among others' and build its two halves apart, so the reader
follows each register for up to 64 instructions, and `check-archive.sh` matches a hook of 8 bytes
or more by its first 8 (docs/DECISIONS.md). A literal stored as data (in an array, say) is still
found by strings.

## Settled

The early questions of spec section 26 that phases 0 and 2 settle.

| #   | Question                                                                                                                                           | Status                                                       | What settles it                                                                                                                                                                                                                                                                                                                                                                              | Evidence so far                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | Do App Group defaults and the group container work in CI's simulator builds, signed to run locally?                                                | Pending CI                                                   | `AppGroupTests` in the Unit plan (`ios` job): the group's container opens, its defaults round-trip, and the widget's provider reads the answer the app saved. If not, the Debug fallback is already there, and the test then also runs on Carl's device build.                                                                                                                               | None yet: needs the first `ios` run.                                                                                                                                                                                                                                                                                                                                                                |
| V4  | Do Foundation's time zones on Linux match core's `localDateTime` for every zone in the vectors?                                                    | Pending CI                                                   | `placeTime.json` in `swift-linux` (phase 3.3). PR 0.1's Linux run decodes fixtures only, so it doesn't cover time zones.                                                                                                                                                                                                                                                                     | PR 3.3 in Docker (`swift:6.3.3` with `tzdata`), 23 October 2026: `PlaceTime.local(_:in:)`, a Gregorian calendar read at `secondsFromGMT(for:)`, falling back to UTC, passes all 75 `placeTime.json` cases: London across both clock changes, Kolkata (+5:30), Kathmandu (+5:45), Adelaide, Kiritimati (+14), Denver, `Etc/GMT+1`, `Etc/GMT+7`, UTC and two unknown zones. The earlier probe agreed. |
| V7  | Do the generated SVG template glyphs render correctly?                                                                                             | Pending CI                                                   | The contact sheet: `GlyphSnapshotTests` (Unit plan) draws each glyph from SnowKit's catalogue, whole and as its still and drift layers, in its band's ink on its gradient, without forcing template rendering. If they don't render as the website draws them, or show black, SnowKit switches to `Fallback/Glyphs.xcassets`, the same sets as PNGs: two lines in IsItKit's `Package.swift`. | resvg renders all 16 SVGs as the website draws them (the PNG fallback is its output). Core SVG is unproven until the first `ios` run.                                                                                                                                                                                                                                                               |
| V11 | Do Google Mobile Ads 13.11.0 and UMP 3.1.0 resolve and cache through SPM on the runner? Is the demo app ID right? Does UMP's debug geography work? | Resolve and cache: pending CI. App ID and geography: phase 8 | The `ios` job's `Resolve packages` step (only the committed versions) and the `.spm` cache, whose hit or miss the run summary shows; the build then compiles IsItAds against both SDKs. Settled by the first green `ios` run and the cache hit on the run after it.                                                                                                                          | Only the pins so far: `swift package resolve` on Linux resolved both at their tags' revisions, which match `git ls-remote`, but stopped before the binary zips (dl.google.com is blocked here). The runner is the first to download, check and cache them.                                                                                                                                          |
| V13 | Will `xcodebuild` run the iPhone-only app on an iPad simulator, in compatibility mode?                                                             | Pending CI                                                   | `ipad-compat` in `ios-nightly.yml` (spec section 18.2), which is still to be written. If not: `simctl install`, then `simctl io` screenshots for an agent to review.                                                                                                                                                                                                                         | None yet.                                                                                                                                                                                                                                                                                                                                                                                           |

## Not here yet

Each comes with the phase that needs it, so nothing in the skeleton is dormant:

- the launch screen's `LaunchBackground` colour, from the palettes, which belongs in the
  generated `Assets.xcassets`; the widget's gallery name and description (`AppCopy.widgetName`,
  `AppCopy.widgetDescription`);
- the widget planner in the widget (ported in phase 3, used in phase 7), so the skeleton's
  widget shows one entry, whatever the hour: it may show an answer past its hours until the app
  saves another;
- the switcher and the pager of Now, Today and This week, with the Now and week bodies (phase
  5.2); the announcement when the picked hour changes the answer, `-clock fixed` and the home
  screen's audits (5.4); the sheets behind the place and Settings buttons and "Use my location"
  (phase 6), which do nothing until then;
- the rest of `SnowKit`, location, StoreKit (`Snow.storekit`), notifications, `AdsService` and the
  banner, `SKAdNetworkItems`, and the privacy manifests' collected data types (coarse location,
  the push token);
- `FEATURE_UNLOCK` and `FEATURE_ADS` (spec section 9.8), with the purchase and the ads;
- the Screenshots test plan and `ios-nightly.yml`;
- the release job's `rc-archive` artefact (spec section 21.2), with the release candidate.
