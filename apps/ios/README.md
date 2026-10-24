# will it snow? for iPhone

The native SwiftUI app for willitsnow.today, built from the iOS build spec. This is the skeleton
(phase 0, PRs 0.1 to 0.4): the project, the app and its widget, both entitlements, the debug
hooks, their tests, the CI that builds and runs them, and the release job that signs the app and
uploads it to TestFlight; with phase 2.3's generated assets: the snow glyphs, the app icon and
the answer font; phase 5.1, the skeleton TestFlight build: the app fetches the answer for
its place (approximate IP location until one is chosen, so the first launch shows the phone's
own place with no picker), keeps it current, saves it in the App Group, where the widget reads
it, and draws it on the home screen's top bar and Today page (below, "Phase 5.1"); phases 5.2
and 5.3: the switcher and the pager of Now, Today (Tomorrow from 6pm) and This week, with Now's
next hours and the week's days, the 6pm flip at the minute's tick, the glyph's drift, changes
announced once to VoiceOver, and every text size up to AX5 (below, "Phases 5.2 and 5.3"); phase
5.4, the home screen's accessibility proven by UI tests: every page of three fixtures read as
VoiceOver hears it against the TypeScript's words, the offline and failure states, the
accessibility audits at Large and AX3, and every page on the contact sheet (below, "Phase 5.4");
and phase 6, the sheets behind the top bar, over every page: the place picker (6.1: search, "Use
my location" and the recent places) and Settings (6.2 and 6.3: the snow units, the privacy rows,
Report an ad, About and Help, the version, How it works, Credits and licences and Your privacy's
lines) (below, "Phase 6"). A Debug build can be answered by a fixture or a stubbed network
instead (below, "Debug hooks"). Everything else comes in later phases.

## What is where

```
project.yml              XcodeGen 2.46.0 spec; WillItSnow.xcodeproj is generated beside it, never committed
Package.resolved         the pinned package versions, copied into the project by ci/xcodegen.sh
Configs/                 Base (every target), Team (Carl's team ID, not a secret), Snow (identifiers,
                         API origin, ad units), CI-Simulator (signed to run locally, for CI); generated:
                         Generated/Copy.xcconfig (the Info.plist's strings: the location purpose string)
Packages/IsItCore/       Foundation only, Swift 6 mode, tested on Linux: the API models; generated CoreCopy,
                         Questions, AppCopy, AppCredits, Constants, Keys and Palettes; the ports, the
                         home screen's, the picker's and Settings' presenters, the glyph's drift, which
                         pages are light ink on dark and the sheets' colours (IsItLogic); AppModel, its
                         API client, the launch and refresh rules, what VoiceOver is told, the clocks
                         and the minute tick, the picker's search and the location rules (IsItState); in
                         Tests/IsItTestSupport the fixtures (the search answers in Fixtures/Search) and
                         golden vectors with their loaders; in Tests/IsItLogicTests the ports' golden
                         tests and the guard that every vector file is ported (below); in
                         Tests/IsItStateTests AppModel with fakes, and the home screen drawn from it
Packages/IsItKit/        Apple only, Swift 5 mode: IsItServices (SharedStore, URLSessionTransport,
                         WidgetCenterReloader, RecentDefaults: AppModel's services), IsItLocation
                         (CoreLocationService, the app's only), IsItAds (Google's SDKs),
                         IsItUI (the home screen: HomeShell, ViewSwitcher, HomePager and ForecastPageView
                         with its bodies and GlyphView, drawing IsItLogic's HomePage and HomeTopBar, with
                         HomeActions; the picker: PlacePickerView, drawing PlacePicker, with
                         PlacePickerActions; Settings: SettingsView and its pages, with SettingsActions;
                         SheetStyle, both sheets' colours at WCAG AA),
                         IsItWidgetUI (the widget's entry, provider, view), SnowKit (Glyphs, Color(rgb:)
                         for the palettes, and the glyph catalogues, generated)
Apps/Snow/App/           WillItSnowApp (the services and the scene's phases), HomeView (the home screen,
                         from the model, and its two sheets), PickerSheet (the place picker, from its
                         model), SettingsSheet (Settings, from the model), DebugHooks (every test and
                         debug hook)
Apps/Snow/Resources/     the app's Info.plist, entitlements and privacy manifest; Licences/ (the notices
                         Credits and licences shows in full, copied whole); generated: Assets.xcassets
                         (the app icon) and Fonts/BricolageAnswer.ttf (the app's and the widget's)
Apps/Snow/Widgets/       the widget extension, its Info.plist, entitlements and privacy manifest
Apps/Snow/Tests/         app-hosted unit tests: the App Group round trip (V1), widget and glyph snapshots,
                         palette contrast, the answer font, the built Info.plist's purpose string
Apps/Snow/UITests/       FixtureLaunchTests (fixtures at their own moments, and a place nearby),
                         LaunchTests (the real launch over a stubbed network); HomeTests, OfflineTests and
                         HomeAuditTests (phase 5.4), which read what each screen should say from
                         Generated/HomeScreens.json (generated from page.json) through HomeScreens.swift;
                         PickerTests (the place picker over a stubbed network and location) and
                         SettingsTests (every row, the units, Report an ad's fallback, Your privacy),
                         with ScreenAudit.swift's audit; each attaches its screens
TestPlans/               Unit and UI
ci/                      xcodegen.sh, simulator.sh, test.sh, release-check.sh, xcresult-summary.mjs, contact-sheet.mjs;
                         for releases archive.sh, upload.sh and ExportOptions.plist
```

The release checks are in the repo's `scripts/`: `check-archive.sh`, with `swift-small-strings.mjs`
(below), and `asc-key.mjs` and `asc-notes.mjs` for the App Store Connect key and What to Test.

| Target              | Bundle ID                      | Links                                                                                 |
| ------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| `WillItSnow` (app)  | `today.willitsnow.app`         | IsItModel, IsItLogic, IsItState, IsItServices, IsItLocation, IsItUI, IsItAds, SnowKit |
| `WillItSnowWidgets` | `today.willitsnow.app.widgets` | IsItModel, IsItServices, IsItWidgetUI, SnowKit                                        |
| `WillItSnowTests`   | hosted by the app              | IsItModel, IsItServices, IsItUI, IsItWidgetUI, SnowKit                                |
| `WillItSnowUITests` | drives the app                 |                                                                                       |

The widget never links IsItAds or IsItLocation. Both the app and the widget have the App Group
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
   Tap Now, Today or This week, or swipe between them; pull a page down to ask again; a place
   under "Nearby:" loads in place. On any page, the place button opens the picker: search for a
   town, use your location (the simulator's, from Features, Location), or choose a recent
   place. The gear opens Settings.
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
  icon; the widget links no Google Mobile Ads and no location code;
  neither binary names any of the 15 debug hooks; the ad units are Google's demo ones (test) or
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
pnpm vitest run packages/mobile/test/swiftLiterals.test.ts   # no words typed in the Swift (phase 6, below)
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
set that exists. `swift package dump-package` in IsItKit checks its manifest. Phase 6.1 did the
same for IsItServices, IsItLocation and `DebugHooks.swift` (Debug and Release), with a stub
`CoreLocation` module declaring the API `CoreLocationService` uses with Apple's signatures, and
ran the `-network` stub's `reply(to:)` over the requests the picker's UI tests make.

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
| `search.json`    | 6.1, done | `PlaceSearch.input`, `.detail`                      |

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
  6pm and the stale state follow the clock while the app is open. Only the middle page was
  drawn in 5.1, whatever `model.view` said; since phases 5.2 and 5.3 the pager draws all three
  and binds it (below).
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
  name until its answer arrives; links open in Safari. The place button and "Use my location"
  open the place picker, and the gear Settings (phase 6, below).
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

## Phases 5.2 and 5.3: the pages, the switcher and the pager

What 5.1 had not already brought (DECISIONS, "The iPhone app's pages, switcher and pager"): 5.1
brought forward the minute's tick, pull to refresh, the footer and the loading and error states.

- **Now and This week** (spec section 10.2) come from the same presenter, `HomePage`, which now
  has `hours` (Now: "Chance of snow, next 12 hours" and up to six `HourRow`s, "6pm" and "60%",
  each read "60% chance at 6pm") and `week` (a `WeekRow` a day: "Tue", "2cm", "Snow", the
  forecasts expecting snow of those with data, `snowy` of `total`, drawn as dots, and read
  "Tuesday, 2cm, snow, 4 of 6 forecasts expect snow", never a percentage). Its reference,
  packages/mobile `page.ts`, takes them from core (`viewDisplay`'s rows and their `sr`,
  `snowAgreementLine`, `WEEKDAYS`), and `page.json` holds the Swift to them case by case; the
  Swift words them with `AppCopy.percent`, `hourRowLabel`, `weekRowLabel`, `dayAgreement` and
  `dayAgreementOne` and `CoreCopy.weekdays`, which a vitest proves say what core says.
- **The switcher and the pager** (IsItUI): `ViewSwitcher`, a segmented picker of the pages'
  labels (the middle one "Tomorrow" from 6pm), which at accessibility text sizes becomes a row
  of buttons that wraps so no label is cut short; and `HomePager`, the three pages side by side
  in a horizontal `ScrollView` paged with `.scrollTargetBehavior(.paging)` and
  `.scrollPosition(id:)`, each page the pager's own size, which a `GeometryReader` reads (since
  main's first macOS run: sized to the screen's safe area, the pages pushed the top bar under the
  status bar; DECISIONS, "The iPhone app's UI tests, after main's first macOS run"). The
  horizontal scroll view is `pager` to the UI tests, which read its edges, and an audit issue on
  it names it. Both are bound to `AppModel.view` (`$model.view` in `HomeView`), so a tap, a swipe, a widget's route
  (`.view`, which now sets the view) and the return after more than 30 minutes away (the view
  for the time of day) move both. The app opens on
  `MiddleDay.defaultView`, Today or Now from 6pm, once: from the saved answer it paints, or else
  from its first answer, unless the user or a route has chosen a view by then, as the website
  does; a place under "Nearby:", a place chosen in the picker (phase 6) and Retry answer on the
  view the user is on. Only the page on screen is in the accessibility tree, so VoiceOver and
  the UI tests read that one.
- **The 6pm flip** needs nothing new: the minute's tick draws every page at the model's clock,
  so at 6pm at the place the middle tab reads Tomorrow and shows `snow.days[1]`, with no request.
  `FlipTests` (IsItStateTests) prove it at 5:59pm and 6pm in Durham (GMT), minute by minute in
  London's evening, and in Kathmandu (UTC+5:45).
- **The glyph's drift**: `GlyphView` (IsItUI) draws SnowKit's two layers and moves the flakes
  as the website's CSS does, twice in 3.2 s (`GlyphDrift`, IsItLogic), on first paint and when
  the band changes (`GlyphMotion`); never with Reduce Motion, and never under `-now` or `-uitest`
  (`DebugHooks.stillMotion()`).
- **VoiceOver hears a change once**: `Announcements` (IsItState) takes the page on screen each
  time it is drawn and gives its heading and verdict (`AppCopy.announcement`, as the website's
  live region holds the two) when they say something new on the same view (a refresh's new
  answer, the hour picked changing the answer or the verdict, Tomorrow from 6pm, no recent
  forecast), or after "Checking…" on whichever view the answer opens; nothing on a tick that
  changed nothing, on moving to another view, or while checking. `HomeView` posts it
  (`UIAccessibility.post(notification: .announcement, …)`).
- **Text sizes up to AX5**: every text wraps rather than truncating, the answer word shrinks to
  fit its line rather than breaking, the pages scroll, and Now's rows and the week's stack at
  accessibility sizes, as the model list already did.

**Tests.** On Linux: `PageVectorTests` (every row's strings, code unit for code unit),
`HomePageTests` (the spec's examples, and an answer saved before the week's days had their
agreement), `GlyphDriftTests`, `MinuteTickTests.swift` (`FlipTests` and `AnnouncementTests`:
each announcement once, and only then) and `AppModelTests` (a route to a view). On the macOS CI:
`FixtureLaunchTests`, whose Durham tests now open on Now and tap Tomorrow, and
`testSwitcherAndSwipe`, which taps the tabs and swipes, attaching `app-aberdeen-snow-now` and
`app-aberdeen-snow-week` for the contact sheet.

**Accessibility identifiers** for phase 5.4's tests, besides 5.1's (`place`, `settings`,
`use-my-location`, `heading`, `verdict`, `detail`, `agreement`, `strip`, `limited`, `retry`,
`updated`, `notice`): `views` (the switcher; its segments are buttons labelled as the tabs read,
"Now", "Today" or "Tomorrow", "This week"), `view-now`, `view-today` and `view-week` (its buttons
at accessibility sizes), `page-now`, `page-today` and `page-week` (each page's scroll view, only
the one on screen), `hours-heading` and `hour-0` to `hour-5` (Now's rows), and `day-0` to
`day-6` (the week's rows). Phase 5.4 added `model-0` onwards (the middle page's model list, each
read as the model's name with its amount as the value) and `approximate` (the top bar's
"Using approximate location." or the notice in its place), and its review `credits` (the
footer's credits, a container of their lines, the last on the page).

## Phase 5.4: the home screen's accessibility, and its UI tests

What section 16 asks of the home screen, proven where it can only be proven, on the simulator
(DECISIONS, "The iPhone app's home accessibility and its UI tests").

**What a page should say comes from the TypeScript.** `pnpm mobile:generate` writes
`Apps/Snow/UITests/Generated/HomeScreens.json` (packages/mobile `exportHomeScreens.ts`) from
page.json: for each screen a UI test opens, its fixture, the moment as `-now` takes it, how its
request went, the view it opens on (core `defaultView`), the top bar (`homeTopBar`, a reference new
in 5.4 for IsItLogic's `HomeTopBar`) and its three pages (`homePage`), exactly as page.json has
them, and beside the screens each band's palette (`homePalettes`), which the home audit's
contrast failures read the screen's pixels against. The screens are listed in `homeScreens` (packages/mobile `vectors.ts`), which adds each to
page.json, so the Swift on Linux is held to the same cases (`PageVectorTests`). The UI test bundle
carries the file (project.yml), and `HomeScreens.swift` reads it (`HomeScreen.named`) and compares
the screen with it, from one snapshot of the accessibility tree for each check (`ShownScreen`), in
which each identifier checked must be there once: `expect(page, in:)` checks the heading (the
question and the answer, with the place), the verdict and the detail, the agreement, the strip's
summary, each model's name and amount (`model-0`…), Now's rows (`hour-0`…) and the week's (`day-0`…)
as VoiceOver reads them, the Updated line, the offline, unavailable or stale line and Retry, and
that nothing else of them is there; `expect(topBar, in:)` the place button's label, the approximate
line (`approximate`), "Use my location" and Settings. Nothing in a test types a page's words. A
difference is reported and the test goes on to the next; a screen that never comes stops it.

**The tests** (the UI test plan; `### UI:` in the `ios` job's log names each failure with its
file and line):

- `HomeTests`: `testAberdeenSnow`, `testDurhamTomorrow` and `testLeedsDry` open each fixture at
  its own moment with `-clock fixed`, check the top bar, that the home screen fits the screen
  (`expectFits`: the place button, the gear and the switcher within the window, the pager
  between the switcher and the window's bottom edge, and the page on screen starting under the
  switcher; not the page's bottom, as XCUITest may give its scroll view its content's frame,
  nor the status bar, whose frame XCUITest doesn't give, which the picker's and Settings' taps
  guard), the tabs and the page it opens on (Today, or Now from 6pm), then each page by its tab, then back
  from This week to Now by swiping and on again, each tab selected as it shows.
  `testDefaultViewEitherSideOf6pm` opens Durham at 5:59pm (Today; Now, Today, This week) and at
  6pm (Now; the middle tab Tomorrow).
  `testTheMiddleTabTurnsToTomorrowAt6pm` opens at 5:58pm with `-clock run` and waits up to three
  minutes for 6pm: the middle page turns to tomorrow where it is. `testNearbyLoadsInPlace` taps
  the first place under "Nearby:" and reads its answer, and the chosen place on the top bar;
  `testNearbyLoadsInPlaceOnThisWeek` does it from This week, which stays on screen. The two
  tests with a running clock (this flip, and `OfflineTests`' end of the saved answer's hours)
  start `RUNNING_LEAD_MS` (packages/mobile `vectors.ts`, two minutes) before their moment, so a
  slow launch can't pass it before the test has read the screen.
- `OfflineTests`: each first saves aberdeen-snow from its fixture, then opens again over the
  app's own transport with the network stubbed. `testOfflineAnHourOnShowsThatHour` (`-network
off` at 10:30am): the 10am hour on Now and Today, and the offline line on every page.
  `testPastItsLastHourNoRecentForecastOnEveryPage` (`-network off`, two minutes before
  `usableUntil`, clock running): the answer with the offline line, then no recent forecast on
  Now, the middle page and the week. `testOfflineWithNothingSaved`: no recent forecast and Retry
  on every page. `testAFailureOverTheAnswerKeepsItWithRetry` (`-network unavailable`, a quarter
  of an hour on): the answer stays on every page, with "Forecasts are unavailable…" and Retry,
  and stays when Retry fails again.
- `HomeAuditTests` (spec 17.2's `AccessibilityAuditTests` for the home screen): each page of the
  three fixtures at Large and at AX3 (`-UIPreferredContentSizeCategoryName` with
  `UICTContentSizeCategoryAccessibilityXL`; the test checks the switcher is buttons at AX3 and not
  at Large, so the size reached the app, and that the home screen fits the screen at that size,
  `expectFits`), with `performAccessibilityAudit(for:)` for every kind on every screenful, from
  the page's top to the end of its credits, in at most 20 screenfuls. Each screenful is audited
  in two calls (`AuditKinds`, `UITests/ScreenAudit.swift`): every kind but two on the screen as
  attached, and an audit that moves the page there fails; then the Dynamic Type and clipped-text
  checks, which lay the app out at a smaller text size, where a page scrolled past that size's end
  comes back to it. Each issue's element is noted where it was on the screenful, moved back with
  the credits, and the page is dragged back to where the screenful had it before the next scroll
  (`restore`; on PR #33's macOS run, with one call, every AX3 page went back to that end before
  each drag and failed "scrolls no further"). The page on screen is the part of its
  frame a user sees, within the window and below the switcher, whether the frame XCUITest gives
  the page's scroll view is its viewport or its content. Each scroll brings the first element
  the screen doesn't show whole to the top of that part (a drag in the page's left margin, clear
  of the home indicator, read from one snapshot of the page), and an issue on an element the
  screenful cuts at its edge, or doesn't show, is judged on a screenful that shows it whole (an audit
  measures what the screen has where the element is: on PR #31's macOS run, the answer failed
  contrast on every screenful that had scrolled it off the top). Every issue fails the test, once
  per fixture and size, listing each with its page and screenful, kind (`contrast`, `hitRegion`,
  `dynamicType`, …), Apple's descriptions and the element's type, identifier, label and frame on
  the screenful (with where it was once the audit had moved the page, and the part of the page on
  screen, for one no screenful showed whole), a contrast issue with the screenful's darkest and
  lightest pixels inside the element and the contrast between them, beside the page's ink and its
  background at the element's centre (`PixelRange`, `PageColours`), except those in
  `HomeAuditTests.exceptions`, each with why it isn't a fault to fix: the segmented control's own
  type size (`dynamicType`; section 10.2's segmented picker, buttons that scale at accessibility
  sizes) and the credits' inline links (`hitRegion`). The log names an exception a test didn't
  need. A page that stops scrolling short of its end, an app that has left the foreground or an
  audit that can't run fails with where the page and its credits were on each screenful, and the
  page's frame on each (the scroll view's viewport, PR #33's run showed). A page
  that stops short, or never reaches its end, also says the page's whole frame and the window's,
  each drag (those that put the page back marked so), the page's four lowest elements and where
  a swipe by XCUITest's own gesture then moved the credits (a page at the end of its scroll range,
  or a drag it didn't take), and attaches the app's element tree as `<name>-tree`. For a new
  issue, fix the app, or, when it isn't a fault, add it there with its reason. The three Large
  tests may fail still on the home's text buttons' contrast and five two-line details, which the
  log couldn't explain: read their pixels in the next log before changing the app for them
  (DECISIONS, "The iPhone app's UI tests, after PR #33's macOS run").

**The contact sheet** tiles every attachment in its names' order (`ci/contact-sheet.mjs`, five
screens to a row). `HomeAuditTests` attaches every screenful it audits as
`home-<fixture>-<n>-<size>-<m>-<tab>-<k>`: `home-aberdeen-snow-1-large-1-now-01`, `…-1-now-02`,
…, `…-1-large-2-today-01`, …, `…-1-large-3-this-week-01`, …, `…-2-ax3-1-now-01` and so on, then
durham-tomorrow (whose middle tab is `2-tomorrow`) and leeds-dry: eighteen pages top to bottom,
fixture by fixture, Large before AX3, each in the switcher's order, after the `app-…` and
`glyph-…` attachments and before the widgets'. Phase 5's exit asks for these.

**On Linux** (`swift test` in IsItCore): `ClockTests.swift` (`FixedClock`: one moment, work for a
later time never runs, the model on it asks once; `MinuteTick.anchor`: each tick a twentieth of
a second into one of the model's minutes, whatever the clocks' offset, and Durham's next tick
from 5:59:30pm turning the page), `PaletteToneTests` (which pages are light ink on dark, so the
system's controls on them take the dark colour scheme) and `PageVectorTests` (the model lines'
names and amounts, and `HomeTopBar`).

## Phase 6: the place picker and Settings

The top bar's two sheets, built side by side and then connected (below, "How they meet").
DECISIONS has each one's choices ("The iPhone app's place picker", "The iPhone app's Settings")
and how they were put together ("The iPhone app's phase 6, put together").

### 6.1: the place picker

The full-screen sheet behind the top bar's place button and the approximate line's "Use my
location" (spec sections 4, 9.4 step 4, 10.3, 15.2 and 16). DECISIONS has the choices ("The
iPhone app's place picker").

- **The rules are in IsItCore, tested on Linux.** `PlaceSearch.input(_:)` and `.detail(_:)`
  (IsItLogic) are the ports of client `searchInput` and `resultDetail`, which the website's
  picker now uses too, checked against `search.json`: the text trimmed as JavaScript trims it,
  2 letters or more counted in UTF-16 code units, and "England, United Kingdom" under "Leeds".
  `PlacePicker` (IsItLogic) is the sheet as plain values: the title, the prompt, "Use my
  location" first (with "Finding you…", location access off and Open Settings, or no fix), the
  search's line (too short, no places, why it failed) or its results, and with nothing typed
  the recent places under "Recent". `PlacePickerModel` (IsItState, from `AppModel.makePicker()`)
  runs the search: 250 ms after the last keystroke (`Constants.Search.debounceMs`, on the
  model's clock, so the tests move it), each keystroke cancelling the wait and the request
  before it, only the newest answer shown, and the last results kept while the next search is
  out.
- **Choosing a place** is `AppModel.choose(_:name:)`: `place.v1`, the fetch in place
  (`select(_:)`, which saves the answer for the widgets and reloads them), the recent places
  (`recent.v1`, the last five, `RecentPlaces` with the `RecentDefaults` store in the app's own
  defaults), and phase 8's `syncAlerts` hook, which decides whether a notification place
  follows. A search result is `Target(search:)`: its city page's slug, or its point on the grid
  with what the search said. The sheet closes as the place is chosen, before its answer, and
  the answer comes on the view on screen, as a place under "Nearby:" does (phase 5.2): a place
  chosen from This week shows its week.
- **The location** is `LocationService` (IsItState) in `AppEnvironment`, which replaces
  `AppHooks.locate`: `CoreLocationService` in IsItLocation, an IsItKit module the app links and
  the widget never does. "Use my location" asks for When In Use permission only at that tap and
  only if never asked, takes one fix at `kCLLocationAccuracyKilometer`, and rounds it to the
  0.05° grid (`Target.device(lat:lon:)`); launch step 4 takes a fix only when permission is
  already granted. Denied or restricted, the row says "Location access is off. Search for a
  place instead." with Open Settings. The device's place joins the recent places under its
  answer's name.
- **The purpose string** is `AppCopy.locationPurpose` (section 15.2), which the generator
  writes into `Configs/Generated/Copy.xcconfig` as `LOCATION_PURPOSE`; Snow.xcconfig includes it
  and Info.plist reads `$(LOCATION_PURPOSE)`. `InfoPlistTests` (Unit plan) checks the built
  app's string is the copy. The app's privacy manifest now declares coarse location (section
  15.1).

**Its tests.** On Linux: `Tests/IsItStateTests/PlacePickerModelTests.swift` (the search's pause,
cancelling and failures, choosing a city and a point, the recent places, Use my location
granted, denied, refused, without a fix and tapped twice, the sheet closed or a place chosen
while the fix is out (the fix then chooses nothing), and a launch that never asks),
`Tests/IsItLogicTests/PlacePickerTests.swift` (the content and `recent.v1`'s reading) and the
`search.json` port. On the macOS CI, `PickerTests` (UI plan), over `-network
ip-first-launch,leeds-dry` or `…,kathmandu-0545` and `-location`: too short and no results;
choosing Leeds (a city page) and Kathmandu (a point); a recent place kept across a relaunch, then
swiped away; Use my location denied, from the approximate line and the picker's own row; Use my
location with a fix; and the accessibility audit of the sheet, with a recent place and location
access off, and of its results with the keyboard put away by a drag. Their screens are
`picker-no-results`, `picker-results`, `picker-recent`, `picker-location-denied`,
`picker-audit` and `picker-results-audit`.

### 6.2 and 6.3: Settings

The gear opens the Settings sheet (spec sections 10.4, 10.6 and 10.7), a native `Form` in system
materials. As on the home screen, IsItLogic makes the content as plain values (Linux-tested),
IsItUI draws it, and the app connects them in one file (`SettingsSheet.swift`). DECISIONS has
the choices ("The iPhone app's Settings").

- **The rows, in order:** Snow units (cm | in, the footnote beneath: `UnitsSegments`, a
  segmented control drawn as two buttons whose labels grow with the text, the one chosen marked
  selected; not UIKit's segmented control, whose type size is fixed); Privacy ("Your privacy",
  "Privacy policy"); "Report an ad", in the free version only; About ("How it works", "Credits
  and licences", "Terms"); Help ("Contact us", "Support"); and "Version 1.0 (112)" from the
  bundle. willitsnow.today's pages open in Safari and the emails in the mail app, through
  `openURL`; every address is `Constants.Site` (core `SITES.snow` and `CONTACT_EMAIL`).
- **Not yet, by design:** the Notifications section (phase 8 puts it after the units), the
  upgrade row and "Restore purchase" (phase 7, after it), "Privacy choices" (phase 8, while the
  ads are on and Google's form is required) and, in Your privacy, what is kept for notifications
  with "Turn off notifications and delete my data" (phase 8). None shows as a row that does
  nothing; `SettingsScreen` and `YourPrivacy` already take the flags and lines they need, and
  `SettingsActions` the two actions, nil until then.
- **IsItLogic:** `SettingsScreen(units:unlocked:privacyChoices:version:)` (the sections and
  rows, each with its action: a page, a web page, an email, Report an ad, Google's form),
  `AppVersion`, `MailDraft` (`contactUs()`, `reportAd(version:place:at:zone:)`, its `mailto:` URL
  encoded as `encodeURIComponent` encodes, and the `MailFallback` to show without a mail app),
  `HowItWorks()`, `CreditsPage()` and `YourPrivacy(adsOn:privacyChoices:kept:)`.
- **IsItUI:** `SettingsView(screen:privacy:actions:)`, with the pages on its own stack
  (`YourPrivacyView`, `HowItWorksView`, `CreditsView`, `NoticeView`) and `MailFallbackView`.
  Credits and licences gives each credit's words whole, then each of its sources and licences
  as a row of its own that opens it, not as links inside the sentence; a notice's project link
  is 44 points tall.
- **The sheets' colours** (the picker's too) are the system's but where those fall short of
  WCAG AA's 4.5:1 for text under 18 points in the light appearance: `SheetStyle` (IsItUI) draws
  the headers, footers and secondary lines in `SheetColours.secondaryLight` (5.36:1 on a grouped
  list's background, where the system's secondary label gives 3.28:1) and tints the buttons,
  links and toolbar items with the system's blue as Increase Contrast draws it (the default
  gives 3.59:1 there), from IsItLogic's `SheetColours`, which `SheetColoursTests` holds to it on
  Linux. The dark appearance keeps the system's secondary label, which passes.
- **The units** go through `AppModel.setUnits(_:)` (IsItState): kept in `units.v1`, the answer
  asked for again in them with what is on screen kept meanwhile, then the notifications' sync
  hook (phase 8), since a registration carries the units.
- **The notices** in `Apps/Snow/Resources/Licences/` are copied whole: Bricolage Grotesque's SIL
  OFL 1.1 from the font's npm package, and the two Google packages' LICENSE files at the pinned
  revisions. A vitest test holds each to its source (`packages/mobile/test/credits.test.ts`).

**On Linux:** `Tests/IsItLogicTests/SettingsScreenTests.swift`, `MailDraftTests.swift` and
`InfoPagesTests.swift` (every row and its action, the free and bought versions, the emails'
subject, body and encoded URL, the phone's time, How it works word for word with the
constants' numbers, the credits and their links, Your privacy's lines, and no word naming another
app, site or weather), `SheetColoursTests.swift` (the sheets' colours on each system background),
`Tests/IsItStateTests/UnitsTests.swift` (the units kept, asked for and
saved, the answer kept meanwhile, offline, the same units), and in packages/mobile the copy,
the credits, the constants, Your privacy against the website's privacy notice, and the guard
that no Swift view or label is given a string literal (`swiftLiterals.test.ts`, below).

**On the macOS CI:** `SettingsTests` (UI plan), with `-openURLs`: the units switch, the refetch
in inches and the choice kept at the next launch; every row's URL or page; Report an ad's and
Contact us's fallback with "Copied."; Your privacy's lines; the version line; no word naming
another weather type on screen; and the accessibility audit on Settings, How it works,
Credits and licences, a licence in full, Your privacy and both fallbacks. The screens are
`app-settings`, `app-how-it-works`, `app-credits`, `app-notice`, `app-your-privacy`,
`app-report-ad-fallback` and `app-contact-us-fallback`. `testRowsOpenWhatTheySay` taps the two
emails after its pages' audits: the recorder's lines show the whole URL below the sheet's content,
and Report an ad's, 201 characters, would take most of the screen at the audit's largest sizes.

**The audits** (`PickerTests` and `SettingsTests`; `HomeAuditTests` has its own, with its
exceptions, above) go through `auditAccessibility(of:on:)` (`UITests/ScreenAudit.swift`):
`performAccessibilityAudit(for:)` for every kind of issue, in the home audit's two calls
(`AuditKinds`: contrast, element detection, hit regions, descriptions and traits, then Dynamic
Type and clipped text, the seven kinds the iOS SDK defines, each named rather than `.all` less
two), with a handler that notes each issue with its kind (named as `HomeAuditTests`
names it), its element's type, identifier, label and frame, and Apple's description, a contrast
issue with the screen's darkest and lightest pixels inside the element, then one failure that
lists them all with the window's frame. The tests stop at their first failure, so without it a
run would show one issue a screen. Nothing is allowed: every issue is the app's to fix. The
sheets' Close buttons (`picker-close`, `close-settings`, `close-fallback`) are the xmark with
"Close" as their label (`CloseLabel`, IsItUI), not the word on screen, which a toolbar draws at
the bar's own type size and the audit failed for Dynamic Type.

### How they meet

- **One sheet at a time.** `HomeView` holds one `HomeSheet?`: `.picker(PickerRequest)` opens the
  picker as a full-screen cover, `.settings` Settings as a sheet, and each closes only itself.
  The place button and the approximate line's "Use my location" (with `locating`) open the
  picker; the gear opens Settings. The top bar is `HomeShell`'s, over the switcher and the
  pager, so all three open their sheets from every page. Both sheets follow the system's
  colours, not the page's: they are presented from outside `HomeShell`, so the dark colour
  scheme it gives the system's controls on a dark page (phase 5.4) doesn't reach them. While
  one is open, the home screen under it is out of the accessibility tree, as VoiceOver already
  treats it, so the sheets' audits read only the sheet, and its changes (the 6pm flip, a quiet
  refresh's new answer) aren't announced over the sheet, then or once it closes
  (`Announcements.drawn(_:covered:)`).
- **One view.** Choosing a place (`AppModel.choose(_:name:)`, through `select(_:)`) keeps the
  view on screen, as a place under "Nearby:" does; only the first answer shown, before anything
  chose a view, opens on the view for the time of day (`AppModelViewTests`: a place chosen from
  This week stays there, and one chosen after a failed launch, before any move, opens on the
  evening's Now).
- **One Debug recorder.** `HomeView` applies `debugRecorder()` to both sheets where it presents
  them, so under `-openURLs` the picker's Open Settings is recorded as Settings' rows are.
- **One search stub.** `-fixture` and `-network` answer the picker's searches alike, from the
  search fixtures (`SearchStub`, below).
- **The tests.** `PickerTests` and `SettingsTests` launch the same app; the picker's Open
  Settings is read from the recorder (`testOpenSettingsOpensTheAppsPage`), as Settings' rows are.
  When a tap on the place button or the gear opens nothing, the failure says where the window,
  the top bar's controls, the switcher, the pager and the page were (`homeGeometry`).
  Phase 5.4's tests and phase 6's share the launch arguments (below, "Debug hooks"): `-network`
  takes a comma list of fixtures, or `off` or `unavailable`; `-clock fixed` and `-now` fix the
  moment; `-resetStore` forgets the recent places too. Their identifiers differ, and the pager
  keeps only the page on screen in the accessibility tree, so the picker's and Settings' tests
  find one `heading` and one `verdict`, the page on screen's.

### No words typed in the Swift (phase 6's exit)

Every word on screen and every accessibility label comes from the generated copy (`CoreCopy`,
`AppCopy`, `AppCredits`, `Constants`), the presenters built on it, or the server's answer (spec
section 10 and Appendix D). `packages/mobile/test/swiftLiterals.test.ts`, a vitest test that runs
on Linux with the rest (`pnpm test`, and CI's `check` job), holds the Swift to that with two
guards:

- **No view or modifier is given a literal** (6.2's): `Text("…")`, `Button("…")`,
  `.navigationTitle("…")`, `.accessibilityLabel("…")`, a `prompt:` or `title:` with words of its
  own, whatever the literal says. `Text(verbatim:)` with data passes; given a literal, the second
  guard fails it.
- **No literal looks like prose**, anywhere in the Swift that ships: every `.swift` file under
  `apps/ios` but the generated folders (the copy itself, which the TypeScript's tests check), the
  test targets (`Apps/Snow/Tests`, `Apps/Snow/UITests`, each package's `Tests`: their words are
  what they expect on screen) and build output. packages/mobile `swiftLiterals.ts` reads every
  literal, with Swift's comments, raw and multi-line literals and interpolations, and the call
  and argument label each one belongs to. A literal with a letter in it is words when a view or
  label is given it, whatever its shape: `Text(verbatim: "in")`, `Text(verbatim: "\(depth) cm")`,
  `.accessibilityLabel(Text(verbatim: "close"))`, a `prompt:`, `title:` or `message:`, UIKit's
  announcement. Anywhere else a literal is prose when it has two words or more, one word set
  beside other text with a space (`"ID \(prefix)"`, `"ID " + prefix`), or one capitalised word
  ("Settings", "Version {} ({})") or a word that ends a sentence; keys, identifiers, paths, URL
  pieces (`"/api/v1/search?"`, `"mailto:"`) and format specifiers have no words in that sense.
- **The allowlist** is in the test, each entry with why it is never shown: accessibility
  identifiers, a crash's message (`fatalError` and its kin: DebugHooks' bad launch arguments), a
  decoding error's description, a bundle's file and folder names, Info.plist keys, SF Symbols'
  names, and three names: the `Accept` header, JavaScript's `Infinity` and the `Fallback` glyph
  folder. A test fails when one of those names is no longer used.

A word it finds belongs in packages/mobile `appCopy.ts` (then `pnpm mobile:generate`), not the
allowlist. What still passes is one lowercase word or a symbol alone outside any view (`let unit
= "cm"`), which can't be told from a key by its shape; given to a view, it fails. When phase 6 was
put together the Swift had no stray prose: every literal the guard flags is a crash's or a
decoding error's message, or one of the names above; and no literal is given to
`Text(verbatim:)`. Phase 5's pages, merged in after, passed it unchanged: their one new literal
of the kind is a bad `-clock`'s crash message.

## CI (`.github/workflows/ios.yml`)

| Job             | Runs on                     | What it proves                                                                                                                                                                                                                                                                         |
| --------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generated`     | ubuntu                      | `pnpm mobile:check`                                                                                                                                                                                                                                                                    |
| `swift-linux`   | ubuntu, `swift:6.3.3-noble` | every Swift file lints; IsItCore's tests pass (with `tzdata`), the vector guard included: every vector file checked by its port (above)                                                                                                                                                |
| `ios`           | `macos-26`, Xcode 26.6      | the project generates; packages resolve to the pins; the app, widget and tests build for the iPhone 17 simulator (iOS 26.5), with the icon and glyph catalogues; the Unit and UI plans pass; a Release build has no debug hooks, no fixtures and no ads or location code in the widget |
| `archive-check` | `macos-26`, Xcode 26.6      | an unsigned Release archive for iPhones builds and passes `scripts/check-archive.sh` with ads test: the release job's archive checks, on every pull request, with no key                                                                                                               |
| `contact-sheet` | ubuntu                      | tiles every attached screen and widget into one PNG, whenever `ios` uploaded attachments (failed tests included); skipped when `ios` failed before its tests ran                                                                                                                       |

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

- `-uitest` turns animations off, and keeps the glyphs' flakes still (`stillMotion()`), as
  `-now` does too;
- `-resetStore` forgets the place, the units, the saved answer and the recent places before the
  model reads them, for a first launch (not `unlock.v1`, which only StoreKit's code writes);
  every UI test's first launch passes it;
- `-fixture <name>` answers every request for an answer with that fixture (a transport of its
  own), after forgetting the saved answer, so the launch fetches it rather than painting an
  earlier one; it is then saved in the App Group for the widget, as any answer is. The picker's
  searches are answered as under `-network` (`SearchStub`: a search fixture for its own query,
  a 404 for any other);
- `-network <name>[,<name>…]` keeps the app's own `URLSessionTransport`, with section 4's
  settings, and stubs the network beneath it (`URLProtocolStub`, section 9.8's URLProtocol stub):
  the request for approximate IP location (`/api/v1/today` with `ahead=snow`, and `units` or `t`,
  but no place) gets the first fixture; a request for another named fixture's own place (its
  `_fixture.query`: a city by its slug, coordinates by their point on the grid, whether searched
  or the device's) gets that fixture; the picker's `/api/v1/search` gets the search fixture asked
  with the same query (`Fixtures/Search`: `search-leeds`, `search-kathmandu`, `search-none`); any
  other place a 400, and another path or search a 404, so an answer on screen means the app asked
  for the right place. Nothing is forgotten, so a relaunch paints and reuses what was saved.
  `-network off` has no connection (`URLError.notConnectedToInternet`);
- `-network unavailable` answers every request, searches too, as the server does when it can't
  get the forecasts: 503 with `upstream_unavailable` and core's message, over the app's own
  transport as `-network off` is (phase 5.4, for a failure over a saved answer);
- `-location <lat>,<lon>|denied|unavailable` stands in for Core Location, so a UI test never
  sees the system's prompt: permission given and a fix there; permission off; or permission
  given and no fix;
- with `-fixture` or `-network <name>[,<name>…]`, the model's clock starts at the (first)
  fixture's own moment
  (`_fixture.now`) and runs on (`SystemClock(startingAt:)`), so on any day the fixture shows the
  state it was made for: the hour picked, Tomorrow from 6pm at the place, no recent forecast for
  `old-forecast`. `-now <iso>` starts it at that moment instead. `-clock fixed` keeps it at that
  moment (or the launch's own, without either), so nothing changes or falls due while a test
  reads the screen (`FixedClock`, IsItState): no quiet refresh, no retry. The picker's pause
  after typing still runs, on the system's clock (`AppEnvironment.waits`, `DebugHooks.waits()`),
  so the picker searches at a fixed moment too. `-clock run`, the default, runs on. The minute tick
  counts the model's minutes (`MinuteTick`), so a clock started at 5:59:30pm turns the middle
  tab to Tomorrow 30 seconds later, not at the system's next minute;
- `-apiOrigin <url>` asks a deploy preview's API instead of willitsnow.today's (spec section 4);
- `-openURLs record` (SettingsTests, PickerTests): each sheet, Settings and the picker, records
  each web page, email and Settings page it would open instead of leaving the app, and shows
  the last one below the sheet's content, on an opaque background in `subheadline`, so no row
  runs under it and its text follows every text size
  (`debug-opened`), with the units the last request to the server asked in (`debug-units`: `c`,
  `f`, or `none`); the URL wraps whole, so its height is taken from the content's, and no test
  audits a sheet over an email's lines; `-openURLs nomail` also refuses every `mailto:` URL, as a
  phone with no mail app does, so the fallback sheet shows. Any other value stops the app;
- the unit tests' host: when the app only hosts the unit tests (XCTest's
  `XCTestConfigurationFilePath` in its environment), it doesn't launch (`AppModel.launch()`), so
  the hosted tests have the App Group to themselves; a launch with `-fixture` or `-network`
  always launches.

A fixture name that doesn't exist or doesn't decode, a `-now` that isn't a moment, a `-clock`
that is neither `fixed` nor `run`, a `-location` that is none of its forms, or a saved answer
`-resetStore` can't remove stops the app, so a UI test can't pass on the wrong screen.

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
Mobile Ads or the app's location code. `scripts/check-archive.sh` checks the unsigned Release
archive on every run (`archive-check`) and the signed one before each upload, for the hooks of
section 9.8 (`-network` and `-location` among them, as short literals), location code in the
widget, and the rest of section 18.3's list.

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
- the `ImageRenderer` snapshots of every page, band and text size in the Unit plan (spec
  sections 16 and 17.2, Large, XXXL and AX3): the pages scroll, and `ImageRenderer` doesn't draw
  a scroll view, so they wait for the page's content to be drawn apart from its scroll view;
  until then the UI tests' screens at Large and AX3 are the contact sheet's (phase 5.4);
- in Settings, the notifications section (phase 8), the upgrade and "Restore purchase" (phase
  7), "Privacy choices" and the data kept for notifications with its delete button (phase 8);
- the rest of `SnowKit`, StoreKit (`Snow.storekit`), notifications (the picker and the units
  call phase 8's `syncAlerts` hook), `AdsService` and the banner, `SKAdNetworkItems`, the push
  token in the app's privacy manifest, and coarse location in the widget's (phase 7, when the
  widget fetches);
- `FEATURE_UNLOCK` and `FEATURE_ADS` (spec section 9.8), with the purchase and the ads;
- the Screenshots test plan and `ios-nightly.yml`;
- the release job's `rc-archive` artefact (spec section 21.2), with the release candidate.
