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
phase 6, the sheets behind the top bar, over every page: the place picker (6.1: search, "Use
my location", the recent places and the saved places) and Settings (6.2 and 6.3: the snow units,
the privacy rows, Report an ad, About and Help, the version, How it works, Credits and licences
and Your privacy's lines) (below, "Phase 6"); phase 7.1, the one-off purchase that takes the ads
away and turns the widgets on: a row at the end of the middle page, Settings' upgrade card with
Restore purchase, the upgrade page, StoreKit 2 behind a model tested on Linux, and the StoreKit
tests (below, "Phase 7.1: the purchase"); phase 7.2, the widgets: the small and medium Home Screen
widgets and three for the Lock Screen, locked until the purchase, each planned from the answer the
app saved or one it asks for itself (below, "Phase 7.2: the widgets"); phases 8.1 and 8.2,
notifications: Settings → Notifications and the Today card turn on a notification the evening
before (and on the day) snow is likely at a place, which the server sends, and Your privacy shows
what it keeps for them, and deletes it (below, "Phases 8.1 and 8.2: notifications"); and phase
8.3, the free version's ads:
Google's consent form, a banner under the pages and one at the end of each, and a full-screen ad
when a place is chosen, with Google's demo units until the release candidate (below, "Phase 8.3:
the ads"). The home screen is drawn in the website's look: its type, pills, tabs, grids and week
rows (below, "The home screen in the website's look"); so is the picker, in the band of the page
on screen (below, "6.1: the place picker"), and so are Settings and its pages, in the website's
content pages' palette (below, "6.2 and 6.3: Settings"). A Debug build can be answered by a
fixture or a stubbed network instead (below, "Debug hooks"). Everything else comes in later
phases.

## What is where

```
project.yml              XcodeGen 2.46.0 spec; WillItSnow.xcodeproj is generated beside it, never committed
Package.resolved         the pinned package versions, copied into the project by ci/xcodegen.sh
Configs/                 Base (every target), Team (Carl's team ID, not a secret), Snow (identifiers,
                         API origin, ad units), CI-Simulator (signed to run locally, for CI); generated:
                         Generated/Copy.xcconfig (the Info.plist's strings: the location purpose string)
Packages/IsItCore/       Foundation only, Swift 6 mode, tested on Linux: the API models; generated CoreCopy,
                         Questions, AppCopy, AppCredits, Constants, Keys, BrandFonts (every font's name),
                         Palettes (with Palettes.content, the app's own pages') and BrandColours (the
                         surfaces' shares and the content card); the ports, the
                         home screen's, the picker's and Settings' presenters, the notifications'
                         switches, place, server replies and registration, their Settings section,
                         place page and card, and where a tap opens (AlertSettings, DeviceReplies,
                         NotificationSettings, NotificationCard, NotificationRouter), the saved places'
                         rules (SavedPlaces), the glyph's drift, which
                         pages are light ink on dark, when an ad may show (AdRules), the purchase's
                         rule, state and pages (PurchaseRules, PurchaseState, UpgradePage), the
                         widget's faces, which answer it plans from and Bold Text's face (WidgetFace,
                         WidgetSource, BrandFace)
                         (IsItLogic); AppModel, its
                         API client, the launch and refresh rules, what VoiceOver is told, the clocks
                         and the minute tick, the picker's search and the location rules, the
                         notifications (NotificationsModel, with UserNotifications behind
                         NotificationPlatform and their three keys behind NotificationStore; the
                         devices calls; NotificationInbox and NotificationDispatch), the ads
                         (AdsModel, with Google's SDKs behind AdsPlatform), the purchase
                         (PurchaseModel, with StoreKit behind PurchasePlatform and unlock.v1 behind
                         UnlockStore), the widget's timeline (WidgetTimeline, with Deadline and
                         FetchGate) (IsItState); in
                         Tests/IsItTestSupport the fixtures (the search answers in Fixtures/Search) and
                         golden vectors with their loaders; in Tests/IsItLogicTests the ports' golden
                         tests and the guard that every vector file is ported (below); in
                         Tests/IsItStateTests AppModel with fakes, and the home screen drawn from it
Packages/IsItKit/        Apple only, Swift 5 mode: IsItServices (SharedStore, URLSessionTransport,
                         WidgetCenterReloader, RecentDefaults, SavedPlaceDefaults: AppModel's
                         services; AdDefaults, AdsModel's; SharedStore as UnlockStore and
                         StoreKitFacts, what StoreKit holds, read only: PurchaseModel's; SharedStore as
                         WidgetStore, StoreKitEntitlements, the widget's URLSession and
                         WidgetTimeline.live(in:), in WidgetServices: the widget's), IsItLocation
                         (CoreLocationService, the app's only), IsItAds (Google's SDKs: GoogleAds,
                         BannerSlot, TopViewController; the app's only), IsItPurchases (StoreKit 2:
                         StoreKitPurchases; the app's only),
                         IsItNotifications (UserNotificationsPlatform, NotificationDelegate,
                         NotificationDefaults: UserNotifications and the push token; the app's only),
                         IsItUI (the home screen: HomeShell, ViewSwitcher, HomePager and ForecastPageView
                         with its bodies and GlyphView, drawing IsItLogic's HomePage and HomeTopBar, with
                         HomeActions; the picker: PlacePickerView, drawing PlacePicker, with
                         PlacePickerActions and PickerChrome (SheetHeader, SearchBox, BoxTextField,
                         PlaceRow, StarButton); Settings: SettingsView and its pages, with SettingsActions,
                         the notifications' section and place page (NotificationsSection,
                         NotificationPlaceView, with NotificationActions) and the middle page's card
                         (NotificationCardView),
                         and SheetStyle, their parts (SheetPage, PageTitle, SheetSection, SheetCard,
                         RowLabel, ReadingCard, sheetChrome, SheetCloseButton, and SheetSwitchStyle, the
                         notifications' switch); the upgrade: UpgradeView
                         with RestoreRow, UpgradeSheetView, UpgradeRow (the home row) and
                         UpgradeActions; the parts every screen
                         shares, in the website's look: BrandType (TextRole,
                         the type scale, and brandFont), PageTheme (a surface's colours, Surface and
                         the tokens, BrandTokens), Backgrounds (PageBackground, SheetBackground),
                         Buttons (PillButton, IconPillButton, PressStyle, RowPressStyle, PinShape),
                         PillSegments, and Layouts (FlowLayout, EqualColumns, LimitedWidth,
                         OneLineWhenItFits, TopBarLayout); the ads' spaces, AdSpaces (AdBand,
                         AdBox)),
                         IsItWidgetUI (the widget's ForecastProvider, over WidgetTimeline, its entry and
                         entry view, every family's faces with the locked and stale ones, the dots and
                         PaletteBackground: topic-free, drawn with the glyphs and palettes the
                         extension gives, WidgetArt), SnowKit (Glyphs, Color(rgb:)
                         for the palettes, and the glyph catalogues, generated)
Apps/Snow/App/           WillItSnowApp (the services, the purchase, the ads, the notifications and their
                         inbox's handler, the scene's phases and the links), AppDelegate (the
                         notification centre's delegate and the push token's callbacks), LiveHooks
                         (the launch's later steps: the purchase, the ads and the notifications),
                         HomeView (the home screen, from the model, with the notifications card, the
                         upgrade row, the ads' band and boxes, and its three sheets), PickerSheet (the
                         place picker, from its model), SettingsSheet (Settings, from the model, with
                         Notifications), UpgradeSheet (the upgrade sheet), DebugHooks (every test and
                         debug hook, StoreKit's and the notifications' stand-ins among them)
Apps/Snow/Resources/     the app's Info.plist, entitlements and privacy manifest; Licences/ (the notices
                         Credits and licences shows in full, copied whole); generated: Assets.xcassets
                         (the app icon) and Fonts/ (the app's and the widget's: BricolageAnswer.ttf and
                         the text faces BricolageText-{Regular,Medium,SemiBold}.ttf)
Apps/Snow/StoreKit/      generated: Snow.storekit, the StoreKit configuration Xcode's Run action and the
                         StoreKit tests sell from (in no app bundle)
Apps/Snow/Widgets/       the widget extension (WillItSnowWidgets: five families, its timeline from
                         WidgetTimeline.live(in:)), its Info.plist (with the API origin), entitlements and
                         privacy manifest
Apps/Snow/Tests/         app-hosted unit tests: the App Group round trip through the widget's timeline
                         (V1), widget and glyph snapshots, the embedded widget's plist, fonts, glyphs and
                         manifest (WidgetBundleTests), what WidgetKit is given (WidgetProviderTests),
                         palette contrast, the brand fonts, the built Info.plist's purpose string, and
                         no StoreKit configuration in the app; the notifications' centre delegate, the
                         payload's way to the router, the permission's mapping and the push
                         environment (NotificationTests), no background modes and the privacy
                         manifest's device ID (InfoPlistTests)
Apps/Snow/StoreKitTests/ app-hosted SKTestSession tests of the purchase (PurchaseServiceTests), and
                         Snow.storekit against the copy (SnowStoreKitFileTests): the StoreKit plan
Apps/Snow/UITests/       FixtureLaunchTests (fixtures at their own moments, and a place nearby),
                         LaunchTests (the real launch over a stubbed network); HomeTests, OfflineTests and
                         HomeAuditTests (phase 5.4), which read what each screen should say from
                         Generated/HomeScreens.json (generated from page.json) through HomeScreens.swift;
                         PickerTests (the place picker over a stubbed network and location) and
                         SettingsTests (every row, the units, Report an ad's fallback, Your privacy),
                         with ScreenAudit.swift's audit; AdsTests (the ads, with Google's demo
                         units: the only tests launched without -noads 1); UpgradeTests (the
                         purchase, over StoreKit's stand-in); NotificationsTests (the notifications,
                         over their stand-in) and NotificationPermissionTests (the system's prompt, the
                         one test that meets it); each attaches its screens. DrawnText.swift
                         is every audit's contrast proof, on Generated/Surfaces.json (from
                         packages/mobile brandColours.ts). WidgetLinkTests opens each view a link
                         can name (view/week, view/today, view/now) and checks the page it lands on;
                         a locked widget's link, upgrade, is UpgradeTests'
TestPlans/               Unit, UI and StoreKit (the SKTestSession tests, on iOS 26.2)
ci/                      xcodegen.sh, simulator.sh, test.sh, push.sh (with banner.mjs, its waits), release-check.sh,
                         xcresult-summary.mjs, contact-sheet.mjs; for releases archive.sh, upload.sh and ExportOptions.plist
```

The release checks are in the repo's `scripts/`: `check-archive.sh`, with `swift-small-strings.mjs`
(below), and `asc-key.mjs` and `asc-notes.mjs` for the App Store Connect key and What to Test.

| Target                    | Bundle ID                      | Links                                                                                                                   |
| ------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `WillItSnow` (app)        | `today.willitsnow.app`         | IsItModel, IsItLogic, IsItState, IsItServices, IsItLocation, IsItUI, IsItAds, IsItPurchases, IsItNotifications, SnowKit |
| `WillItSnowWidgets`       | `today.willitsnow.app.widgets` | IsItModel, IsItLogic, IsItState, IsItServices, IsItWidgetUI, SnowKit                                                    |
| `WillItSnowTests`         | hosted by the app              | IsItModel, IsItLogic, IsItState, IsItServices, IsItUI, IsItWidgetUI, IsItNotifications, SnowKit                         |
| `WillItSnowStoreKitTests` | hosted by the app              | IsItModel, IsItLogic, IsItState, IsItServices, IsItPurchases                                                            |
| `WillItSnowUITests`       | drives the app                 |                                                                                                                         |

The widget never links IsItAds, IsItLocation, IsItPurchases or IsItNotifications (it reads the
purchase through IsItServices' `StoreKitFacts`, but never sells it). Both the app and the widget
have the App Group `group.today.willitsnow.app`; only the app has `aps-environment` and links
IsItNotifications. The name
under the icon is "will it snow?" (`CFBundleDisplayName`). Both bundle the fonts and list each in
`UIAppFonts`, since an extension can't load the app's fonts; only the app has an icon.

## Building on a Mac (Carl, optional)

CI builds and tests everything, so this is only for trying the app by hand.

1. Xcode 26.6, and XcodeGen: `brew install xcodegen`, then check `xcodegen --version` says
   2.46.0. If Homebrew has moved on, `ci/xcodegen.sh` downloads 2.46.0 itself.
2. `apps/ios/ci/xcodegen.sh`, then `open apps/ios/WillItSnow.xcodeproj`. Run the script again
   after every pull: the project is generated, never committed, so new files only appear then.
3. Choose the `WillItSnow` scheme and an iPhone 17 simulator, and run. With no fixture the app asks
   willitsnow.today for the answer by approximate IP location (the simulator's network is the
   Mac's). To see a fixture instead: Product, Scheme, Edit Scheme, Run, Arguments, and tick
   `-fixture aberdeen-snow` (or `leeds-dry`, or add `-fixture` with any other fixture's name,
   below). Then add the widget on the simulator's home screen: it is locked until you buy (below),
   then shows the server's answer for the app's place, which it asks for itself (below, "Phase 7.2:
   the widgets", "Trying it"). Tap Now, Today or This week, or swipe between them; pull a page down
   to ask again; a place under "Nearby:" loads in place. On any page, the place button opens the
   picker: search for a town, use your location (the simulator's, from Features, Location), or
   choose a recent place. The gear opens Settings. A Debug build is the free version, with Google's
   demo ads, after Google's consent form where one is required (the UK and the EEA); tick `-noads 1`
   to try it without them, or `-unlocked 1` for the paid version (below, "Phase 8.3: the ads").
   Settings' "No ads, widgets and more · £1.99", or the row at the end of the middle page, buys
   from Snow.storekit, Xcode's local stand-in for the App Store (below, "Phase 7.1: the purchase",
   "Trying it"). If Buy answers at once with nothing, or the page says the purchase isn't available,
   run on an iPhone 17 simulator with iOS 26.2 instead, or on your iPhone: StoreKit Test is reported
   broken on the iOS 26.3 to 26.5 simulators (below, "Settled", V2).
4. Product, Test runs the Unit test plan; pick UI from the test plan menu for the UI tests, and
   StoreKit for the purchase's SKTestSession tests, on an iPhone 17 simulator with iOS 26.2
   (below, "Settled"). If the simulator list has no iOS 26.2, Xcode, Settings, Components
   downloads it, as does `xcodebuild -downloadPlatform iOS -buildVersion 26.2`.
5. On your iPhone (Debug builds only): Xcode, Settings, Accounts needs your Apple Account, and
   the App IDs `today.willitsnow.app` and `today.willitsnow.app.widgets` need the App Group and,
   for the app, Push Notifications (section 24). Signing is automatic with team `MZPGUCY33H`.
   Uploads to TestFlight come from CI (next section); Xcode is only the last way, if CI's fail.
   To try notifications on the iPhone, run Debug, never Release: a Release build run from Xcode
   names the wrong push environment (below, "Phases 8.1 and 8.2: notifications", "Trying it").

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
   only for a release candidate, once the repository variables `ADMOB_APP_ID`, `ADMOB_BANNER_ID`,
   `ADMOB_PAGE_BANNER_ID` and `ADMOB_INTERSTITIAL_ID` are set (C15; docs/SETUP.md, section 5,
   "The apps' ads"). Without all four, well-formed, a `real` run stops at once and names them.
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
- **Archive checks**: both bundles have privacy manifests, each declaring coarse location, and the
  four fonts, each named in `UIAppFonts`; the widget has SnowKit's glyphs and the app's https API
  origin; the app has its icon; the widget links no Google Mobile Ads, no location code and
  no purchase code, nor notifications code; neither binary names any of the 28 debug hooks; the
  app's manifest declares the device ID (the push token) and its Info.plist registers for
  notifications in production; the three ad units are Google's
  demo ones (test) or yours (real); the app's `SKAdNetworkItems` hold Google's; the app and widget
  have the same version and build; `ITSAppUsesNonExemptEncryption` is false; no fixture and no
  StoreKit configuration is bundled, and the app doesn't link StoreKitTest. Each failure is named;
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
pnpm vitest run packages/mobile/test/swiftLayouts.test.ts    # no ViewThatFits where the audits look (8.1)
docker run --rm -v "$PWD/apps/ios":/w -w /w swift:6.3.3-noble \
  swift format lint --strict --recursive Packages Apps          # every Swift file, as CI lints it
docker run --rm -v "$PWD/apps/ios/Packages/IsItCore":/w -w /w swift:6.3.3-noble \
  bash -c 'apt-get update -qq && apt-get install -y -qq tzdata >/dev/null && swift test'
```

That `swift test` runs the vector guard too, which checks every vector file with its port
(below).

**The fonts.** `pnpm mobile:check` never needs Python: it checks each font by the recipe stamped
in it and its tables' checksums (`packages/mobile/src/exportFont.ts`). `pnpm mobile:generate` runs
`scripts/make-answer-font.py --ttf` or `scripts/make-text-fonts.py` only when one of its fonts is
missing or out of date, which needs python3 with fontTools 4.66.1 and brotli
(`pip install fonttools==4.66.1 brotli`; the agents' container has them). After changing the
answer woff2's instance or subset, build the woff2 first (the script with no arguments): `--ttf`
refuses to build a font that differs from it. After changing `make-text-fonts.py`, run it twice
with `--out` into two folders and `cmp` the files: its builds are byte for byte the same.

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
ran the `-network` stub's `reply(to:)` over the requests the picker's UI tests make. Phase 8.3
type-checked IsItAds, `AdDefaults`, IsItUI's `AdSpaces` and the app's files that use them, Debug
and Release, against the real IsItCore and stub `GoogleMobileAds` and `UserMessagingPlatform`
modules declaring what `GoogleAds` uses with the names Google's 13.11.0 and 3.1.0 headers give,
beside stub `UIKit` and `SwiftUI` modules with Apple's signatures; deliberate mistakes (a
misspelt delegate method, a missing `await`, a Release stub taken out) fail it. The UI tests
type-check against stubs of XCUITest. DECISIONS ("Ads in the iPhone app: three placements") says
what was checked and what only macOS can show.

Phase 7.1 did the same for the purchase (session scratchpad: iap-typecheck), Debug and Release:
IsItServices, IsItPurchases, IsItAds, the app's files and both test targets that use them (the
StoreKit plan's suite, and the Unit plan's AppGroupTests and InfoPlistTests), against the real
IsItCore and stub `StoreKit` and `StoreKitTest` modules declaring what the code uses with Apple's
signatures and isolation (`purchase(options:)` and `purchase(confirmIn:)` on the main actor, the
updates' iterator not `Sendable`). The stub marks `currentEntitlement(for:)` deprecated and iOS
18.2's and 18.4's APIs unavailable, and the manifest treats a deprecated call as an error, since
Linux ignores iOS availability. Most of IsItUI is compiled for real there, not as a facade (the
upgrade's views, `SheetStyle`, `SettingsView`, `HomePager` and the parts they draw with), against a
wider stub `SwiftUI`; only `ForecastPageView`, the home shell and the picker are signature-only.
Eighteen deliberate mistakes (a missing `await` on `finish`, `currentEntitlement(for:)` for the
loop, a Release stub taken out, a misspelt `PurchasePlatform` method, a missing `.restore` case
among them) each fail it, and two in IsItCore (a read that returns without waiting for the newer
one, step 5 without `purchaseHeard`) fail the tests written for them. The UI tests type-check
against the XCUITest stubs with `XCUIApplication.open(_:)` added (iap-uicheck). DECISIONS ("The
purchase in the iPhone app (phase 7.1)") says what was checked and what only macOS can show.

Phase 7.2 did the same for the widgets (session scratchpad: widgets-typecheck), Debug and Release:
IsItServices with `WidgetServices.swift`, IsItWidgetUI, IsItUI's `BrandType.swift`, SnowKit, the
extension's file, the app's own code and the Unit plan's widget tests (`WidgetSnapshotTests`,
`AppGroupTests`, `WidgetBundleTests`, `WidgetProviderTests`), against the real IsItCore and a stub
`WidgetKit` with Apple's shapes: `TimelineProvider`'s completions `@escaping @Sendable`,
`TimelineProviderContext` with no public initialiser (so no test can build one), an `Equatable`
`TimelineReloadPolicy`, and the environment's `widgetFamily` get-only (so a test that sets it fails
to compile, as on a Mac). Beside it are stub `os` (`Logger`), `CoreText` and XCTest attachment
modules, and a wider `SwiftUI` (`Link`, `Gauge`, `ViewThatFits`, `ImageRenderer`) in which `Color`
stays nonisolated, as Apple's is. Grep checks run with it: only `ForecastEntryView.swift` reads
WidgetKit's environment; nothing the widget's own code compiles (IsItWidgetUI, the extension,
IsItServices, SnowKit and IsItCore's widget files) calls `saveUnlock`, `AppStore.sync`, `purchase(`
or `Product.products`, or names complete file protection; every `getTimeline` and `getSnapshot`
path calls its completion. The widget also links the rest of IsItState, `PurchaseModel` and
`AdsModel` among it, which nothing in the widget calls. Fourteen deliberate mistakes each fail it (a
`Link` in the locked face, a test setting `\.widgetFamily`, `WidgetArt`'s closures or a provider's
completion without `@Sendable`, a snapshot path that never calls its completion, a gauge of `Int`s
among them), and eleven mutants of IsItCore's widget code each fail the test written for them.
`WidgetBundleTests`' factory test also ran on Linux, over a temporary folder for the App Group, and
fails for each of four mutants of `WidgetTimeline.live(in:)`: the group or the origin read from
`.main`, the default origin, a gate of its own.
`WidgetLinkTests` type-checks against the XCUITest stubs (widgets-uicheck). XcodeGen 2.46.0, built
here, generates the project with only the widget's and the unit tests' new IsItCore products
changed, and `ci/xcodegen.sh`'s plan check passes on it. DECISIONS ("The widgets in the iPhone app
(phase 7.2)") says what was checked and what only macOS can show.

Phases 8.1 and 8.2 did the same for the notifications (session scratchpad: alerts-typecheck and
alerts-uicheck), Debug and Release: IsItNotifications, IsItServices' `send`, IsItUI's new views
and Settings' new parts, the app's files (AppDelegate, LiveHooks, HomeView, SettingsSheet and
DebugHooks with its Release stubs) and NotificationTests, against the real IsItCore and a stub
`UserNotifications` module declaring what the code uses with Apple's signatures (the centre's
weak `delegate`, the `@Sendable` completion handlers, five authorisation statuses), an `os` stub,
and wider UIKit and SwiftUI stubs (the push registration, `Toggle` and `ToggleStyle`,
`ViewThatFits`, `inset(by:)`, the delegate adaptor). A second target builds IsItNotifications'
real files again in Swift 6 mode, where the delegate's shape is checked: Swift 5 minimal, the
app's mode, accepts a main-actor async `didReceive` without a word, and Swift 6 refuses it. Greps
check that every `-word` DebugHooks reads is in `check-archive.sh`'s lists, that the delegate has
no async method and no `@preconcurrency`, that no Linux test reads `NotificationInbox.shared`, that
no shipped Swift names a file-timestamp or boot-time API, and that every IsItUI file using
`.bolder` imports IsItLogic. Planted mistakes each fail it: the async `didReceive` under Swift 6, a
Release stub taken out, a transport without `send`, a misspelt `NotificationPlatform` method, a
hook missing from the archive check's lists, and in IsItCore's `swift test` a sync that doesn't
coalesce (`syncsCoalesce`) and a permission rule that deletes on "not determined"
(`notDeterminedForgetsOnThePhoneOnly`). The UI tests type-check against the XCUITest stubs with
`XCUIApplication(bundleIdentifier:)`, `alerts`, `waitForNonExistence(timeout:)` and the `.switch`
and `.toggle` element types added (alerts-uicheck), with two new checks there: the contrast proof
on a synthetic switch row, on and off in the content colours, refusing UIKit's green and grey
tracks, a grey knob, the hairline stroked over the track, the track's ink in the wrong share and
the row dimmed (SwitchCheck); and NotificationsTests' scrolling of Settings against a fake sheet,
with, since PR #43's first macOS run, its check that Settings is still at its top for an audit,
refusing a page scrolled more than half a point and never dragging (SheetScrollCheck). XcodeGen,
built on Linux as above, generates the project with IsItNotifications linked by the app and its
unit tests and not by the widget. DECISIONS ("The iPhone app's notifications (phases 8.1 and
8.2)") says what was checked and what only macOS can show.

Merged, the two phases' harnesses are one type-check and one UI check (session scratchpad:
merge-81's p78-typecheck and p78-uicheck), the notifications' with the widgets' and the tab-tap
fix's stubs added once each, which build the app, the widget, IsItNotifications in both language
modes, the StoreKit tests and the unit tests in Debug and Release, and all 15 UI test files, with
NotificationsTests' gear and place button run against fake apps whose touches the system cancels
(NotificationsCancelCheck).

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

| Vector file         | Ported by    | Swift                                                                                                              |
| ------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `grid.json`         | 3.2, done    | `GridRounding.round`                                                                                               |
| `target.json`       | 3.2, done    | `Target.key`, `Target(query:)`, `Target(search:)`                                                                  |
| `query.json`        | 3.2, done    | `TodayQuery.build`                                                                                                 |
| `placeTime.json`    | 3.3, done    | `PlaceTime.local(_:in:)`                                                                                           |
| `tomorrow.json`     | 3.3, done    | `MiddleDay.showsTomorrow`, `.defaultView`, `.label`                                                                |
| `freshness.json`    | 3.3, done    | `Freshness`                                                                                                        |
| `hours.json`        | 3.3, done    | `HourPicker.pick`, `UpdatedLine.text`                                                                              |
| `questions.json`    | 3.3, done    | `Questions.snow`                                                                                                   |
| `strip.json`        | 3.3, done    | `StripGeometry`                                                                                                    |
| `widget.json`       | 3.4, done    | `WidgetPlanner.entries`                                                                                            |
| `alerts.json`       | 3.4, 8.1     | `AlertSync.action`, `.body`, `.fingerprint`, `.firstPlace`, `.following`, `.setting`, `.syncReply`, `.testOutcome` |
| `links.json`        | 3.4, 7.2     | `DeepLink.parse`, `.route(payload:placeNow:)`, `.link`                                                             |
| `recent.json`       | 3.4, done    | `RecentPlaces`                                                                                                     |
| `page.json`         | 5.1, done    | `HomePage`, `Credits.parts`                                                                                        |
| `search.json`       | 6.1, done    | `PlaceSearch.input`, `.detail`                                                                                     |
| `saved.json`        | look 4, done | `SavedPlaces`                                                                                                      |
| `widgetSource.json` | 7.2          | `WidgetSource.reuses`, `.fallsBack`                                                                                |
| `widgetFace.json`   | 7.2          | `WidgetFace`                                                                                                       |

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
- **`RecentPlaces.adding(_:name:detail:to:max:)` and `.removing(_:from:)`** keep `recent.v1`'s
  `[RecentPlace]`, which is `Codable` as the client's JSON. Each place's `detail` (the line
  beneath its name) came with the saved places, in the website's look's step 4; older entries
  have none.

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
  only there: since phase 7.1 `PurchaseModel` writes it, through `UnlockStore`) and the saved
  answer; `MemoryState` stands in without an App Group.
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
  place.") until the answer names the place, then the place with the "Use my exact location"
  chip beneath it (before the website's look, the line "Using approximate location.", now the
  chip's VoiceOver hint). No picker, and no prompt.
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
  name until its answer arrives; links open in Safari. The place pill and "Use my exact
  location" open the place picker, and the gear Settings (phase 6, below).
- **The notice** (`AppCopy.slugGone`, when a city page's place has gone and the app fell back to
  approximate location) shows in the top bar, above the "Use my exact location" chip, until a
  place is chosen.

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
  forecasts expecting snow of those with data, `snowy` of `total`, drawn as dots until the
  website's look, and read "Tuesday, 2cm, snow, 4 of 6 forecasts expect snow", never a
  percentage). Its reference,
  packages/mobile `page.ts`, takes them from core (`viewDisplay`'s rows and their `sr`,
  `snowAgreementLine`, `WEEKDAYS`), and `page.json` holds the Swift to them case by case; the
  Swift words them with `AppCopy.percent`, `hourRowLabel`, `weekRowLabel`, `dayAgreement` and
  `dayAgreementOne` and `CoreCopy.weekdays`, which a vitest proves say what core says.
- **The switcher and the pager** (IsItUI): `ViewSwitcher`, a segmented picker of the pages'
  labels (the middle one "Tomorrow" from 6pm), which at accessibility text sizes becomes a row
  of buttons that wraps so no label is cut short (since the website's look, the website's tabs:
  below, "The home screen in the website's look"); and `HomePager`, the three pages side by side
  in a horizontal `ScrollView` paged with `.scrollTargetBehavior(.paging)` (and on iOS 17 only
  `.scrollPosition(id:)`, which reports the page it is on), each page the pager's own size,
  which a `GeometryReader` reads (since main's first macOS run: sized to the screen's safe area,
  the pages pushed the top bar under the status bar; DECISIONS, "The iPhone app's UI tests,
  after main's first macOS run"). The
  horizontal scroll view is `pager` to the UI tests, which read its edges, and an audit issue on
  it names it. Both are bound to `AppModel.view` (`$model.view` in `HomeView`), so a tap, a swipe, a widget's route
  (`.view`, which now sets the view) and the return after more than 30 minutes away (the view
  for the time of day) move both. Since PR #34's second full macOS run a change to the view moves
  the pages at once through the `ScrollViewReader`, and the scroll view reports through
  `.scrollPosition(id:)` into a position of its own, which places the pages at launch and which
  the app never writes (`PagerSync`). On iOS 18 only a swipe, as it comes to rest, sets the view,
  to the page it rests on (`PagerRest`, IsItLogic, held on Linux by `PagerRestTests`); a rest no
  finger led to, as at launch, changes nothing. On iOS 17, with no scroll phases, the page the
  scroll view reports sets it. Shared with the view, `.scrollPosition(id:)`'s
  setter most likely wrote Now back over a tap on Today (DECISIONS, "After #34's second full
  run"). The app opens on
  `MiddleDay.defaultView`, Today or Now from 6pm, once: from the saved answer it paints, or else
  from its first answer, unless the user or a route has chosen a view by then, as the website
  does; a place under "Nearby:", a place chosen in the picker (phase 6) and Retry answer on the
  view the user is on. Only the chosen view's page is in the accessibility tree, so VoiceOver and
  the UI tests read that one: the page on screen, except while a swipe is still moving, so
  `expectFits` and `tap(_:in:)` check its frame starts at the window's left edge.
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
`updated`, `notice`): `views` (the switcher, the tab bar; its tabs are buttons labelled as the
tabs read, "Now", "Today" or "Tomorrow", "This week"), `view-now`, `view-today` and `view-week`
(its tabs, at every size since the website's look; at accessibility sizes only before),
`page-now`, `page-today` and `page-week` (each page's scroll view, only the one on screen),
`hours-heading` and `hour-0` to `hour-5` (Now's cells), and `day-0` to `day-6` (the week's rows).
Phase 5.4 added `model-0` onwards (the middle page's models, each read as the model's name with
its amount as the value) and `approximate` (the top bar's notice; before the website's look,
"Using approximate location." too), its review `credits` (the footer's credits, a container of
their lines, the last on the page), and the website's look `week-heading` ("The week ahead"), with
`use-my-location` now the "Use my exact location" chip.

## Phase 5.4: the home screen's accessibility, and its UI tests

What section 16 asks of the home screen, proven where it can only be proven, on the simulator
(DECISIONS, "The iPhone app's home accessibility and its UI tests").

**What a page should say comes from the TypeScript.** `pnpm mobile:generate` writes
`Apps/Snow/UITests/Generated/HomeScreens.json` (packages/mobile `exportHomeScreens.ts`) from
page.json: for each screen a UI test opens, its fixture, the moment as `-now` takes it, how its
request went, the view it opens on (core `defaultView`), the top bar (`homeTopBar`, a reference new
in 5.4 for IsItLogic's `HomeTopBar`) and its three pages (`homePage`), exactly as page.json has
them; each page's band names the palette it is drawn in, which `Generated/Surfaces.json` gives
(below, "The contrast proof"). The screens are listed in `homeScreens` (packages/mobile `vectors.ts`), which adds each to
page.json, so the Swift on Linux is held to the same cases (`PageVectorTests`). The UI test bundle
carries the file (project.yml), and `HomeScreens.swift` reads it (`HomeScreen.named`) and compares
the screen with it, from one snapshot of the accessibility tree for each check (`ShownScreen`), in
which each identifier checked must be there once: `expect(page, in:)` checks the heading (the
question and the answer, with the place), the verdict and the detail, the agreement, the strip's
summary, each model's name and amount (`model-0`…), Now's rows (`hour-0`…) and the week's (`day-0`…)
as VoiceOver reads them, the week's heading, the Updated line, the offline, unavailable or stale
line and Retry, and that nothing else of them is there; `expect(topBar, in:)` the app's name
(`app-name`), the place pill's label, the notice (`approximate`), "Use my exact location" and
Settings. Nothing in a test types a page's words. A difference is reported and the test goes on
to the next; a screen that never comes stops it. A test waits for a page's heading the same way
(`awaitHeading`, `readHeading`): a snapshot at once, then four a second, until one heading, on
the page on screen, reads the page's words exactly; a read counts only if it ended by the
deadline, so one the app answers late fails the wait and says when it found the words, and the
failure is that last read's, with how many reads there were and how long the last took
(docs/DECISIONS.md, "What main's offline run showed": a predicate in an `XCTWaiter` had its only
query interrupted at the deadline, and failed having compared nothing). Every wait for the
heading reads this way, the launches' and the picker tests' too, and so does every other wait that
was a predicate in an `XCTWaiter`, in UpgradeTests, AdsTests, SettingsTests, PickerTests and
WidgetLinkTests (`readElement`, `ElementRead`): an element by its identifier exactly and its
query's type, the first match where the query was a `firstMatch` (level by level, the shallowest
first, as `firstMatch` walks the tree) and the only one where it wasn't, and gone only on a read of
an app it could read, each wait with its own timeout and condition
(docs/DECISIONS.md, "What PR #46's first macOS run showed": UpgradeTests' wait for the thanks had
its one evaluation cut off at the deadline, the thanks on screen since before it began). PickerTests
reads the keyboard up before each drag that should put it away, so its wait for the keyboard to go
can't pass on a read that couldn't see it. The `waitForExistence` calls stay: each ends with an
existence check that runs to its end and decides it, slow under load but never judged on no read.
The words come before the colours: a tab tap or an answer brings a page's heading at once, and the
home screen's background takes 0.9 s more to fade to the page's band. So once the heading has come,
`tap(_:in:)`, `launch(_:)` and `FixtureLaunchTests`' launch and taps also wait, for up to 10
seconds, for the colours (`awaitColours`), by the same rules and from snapshots too (`readUntil`,
`ThemeRead`), until the Debug readout `debug-theme` (below, "Debug hooks") reads the page's band
exactly ("none" for a page without an answer), which it does only once every fade is over. Colours
that never settle fail the test, naming the band and what the last read found. No screenshot or
audit after them catches the fade (docs/DECISIONS.md, "What PR #45's first macOS run showed"). Each
wait that passes is attached as `colour-wait` (the read it passed on, when that read began and
ended, what the first read found, and, after a tap, how long after the tap began the wait did),
failing nothing: after a tap that changes band, a first read less than 0.9 s after the tap should
find `fading`, which says the readout waits for the fade, as passing waits alone can't.

**The tests** (the UI test plan; `### UI:` in the `ios` job's log names each failure with its
file and line):

- `HomeTests`: `testAberdeenSnow`, `testDurhamTomorrow` and `testLeedsDry` open each fixture at
  its own moment with `-clock fixed`, check the top bar, that the place pill holds its name on one
  line at the standard size, under 44 points tall (`expectPlaceOnOneLine`; DECISIONS, "The place
  pill on one line, after #34 merged"), that the home screen fits the screen (`expectFits`: the
  app's name, the place button, the gear and the switcher within the window, the pager between the
  switcher and the window's bottom edge, and the page on screen starting under the switcher; not
  the page's bottom, as XCUITest may give its scroll view its content's frame, nor the status bar,
  whose frame XCUITest doesn't give, which the picker's and Settings' taps guard), that no element
  with neither an identifier nor a label sits under no labelled one (`expectNoBareElements`, which
  names its path: PR #33's runs had one, the page's background), the tabs and the page it opens on
  (Today, or Now from 6pm), then each page by its tab, then back from This week to Now by swiping
  and on again, each tab selected as it shows.
  `testDefaultViewEitherSideOf6pm` opens Durham at 5:59pm (Today; Now, Today, This week) and at
  6pm (Now; the middle tab Tomorrow).
  `testTheMiddleTabTurnsToTomorrowAt6pm` opens at 5:58pm with `-clock run` and waits up to three
  minutes for 6pm: the middle page turns to tomorrow where it is. `testNearbyLoadsInPlace` taps
  the first place under "Nearby:" and reads its answer, and the chosen place on the top bar;
  `testNearbyLoadsInPlaceOnThisWeek` does it from This week, which stays on screen, checking the
  place's element is its words' band, under 44 points, and tapping its line outside that band
  (IsItUI's `WordsButton`, which the places nearby are: a tap anywhere on
  the 44-point line acts, while the element, which VoiceOver outlines and the audit measures, is
  the band the words take, no shorter than 34 points, or the whole line for words narrower than
  44, as York and Perth are at Large). The two
  tests with a running clock (this flip, and `OfflineTests`' end of the saved answer's hours)
  start `RUNNING_LEAD_MS` (packages/mobile `vectors.ts`, two minutes) before their moment, so a
  slow launch can't pass it before the test has read the screen.
  `testASystemGestureCountsACancelledTouch` is the positive control for `debug-cancels` and the
  helper that reads it (below, "A gesture the simulator cancelled"), each gesture played through
  that helper: a drag up from the home indicator, which the go-home gesture takes, and should the
  helper not see the count rise a drag down from the top right corner, which Control Centre takes;
  within each, the home button then puts away whatever came and the app is brought back to the
  foreground. The helper's `gesture-cancelled` names the gesture that raised the count; neither
  raising it fails, saying the re-tap can't be relied on.
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
  `UICTContentSizeCategoryAccessibilityXL`; the test checks the switcher's tabs wrap onto a
  second line at AX3 and not at Large (`switcherWraps`), so the size reached the app, and that the home screen fits the screen at that size,
  `expectFits`, with no bare element, `expectNoBareElements`), with
  `performAccessibilityAudit(for:)` for every kind on every screenful, from
  the page's top to the end of its credits, in at most 20 screenfuls. Each screenful is audited
  in three calls (`AuditKinds`, `UITests/ScreenAudit.swift`): contrast, then element detection,
  hit regions, descriptions and traits, on the screen as attached, and an audit there that moves
  the page fails; then the Dynamic Type and clipped-text checks, which lay the app out at a
  smaller text size, where a page scrolled past that size's end comes back to it. (The first two
  were one call until PR #33's third macOS run, where it timed out once.) Each issue's element is noted where it was on the screenful, moved back with
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
  background at the element's centre (`PixelRange`, `SurfaceColours.expected`) and what the proof
  reads of it (`DrawnText`), except those in `HomeAuditTests.exceptions`, each with why it isn't a
  fault to fix: the credits' inline links (`hitRegion`), and contrast on any text element the
  contrast proof allows, as on every audited screen (`MeasuredContrast`, below). (The segmented
  control's own type size, `dynamicType`, was a third until the website's tabs replaced it; PR
  #33's contrast exception for the details and the places nearby alone became the proof for
  every text element after PR #34's first full run.) The issues allowed and any exception a test didn't need are attached
  (`home-<fixture>-<size>-allowed`) and listed in its failure. An issue on one of a Debug build's
  readouts (`debug-picker`, `debug-pickers`, `debug-cancels` and `debug-theme`: a point square at
  most, which a Release build hasn't, `DebugReadout`) is set apart, failing nothing, and listed in
  the times and `-allowed`, every audit's, the sheets' too. Each page's first screenful also
  attaches the app's element tree (`<page>-tree`). Each call goes through `runAudit`
  (ScreenAudit.swift), which times it and reads its issues once it is done, outside XCTest's
  deadline for the call, 15 seconds. One that doesn't finish in time ("Audit failed to complete
  in time", -56) isn't run again on the same screen, where on PR #34's runs on fdb3182 and c74aa22
  it stopped again: the screenful's other calls aren't made, the app's element tree is attached
  (`…-<k>-tree`), and once the app is in the foreground at the test's size, the page is moved 3 to
  12 points, the way with the wider band of moves first (up on a tie), so that it shows whole
  exactly the elements the screenful showed whole (`PageRoom`, checked again on a second snapshot),
  attached as `…-<k>-moved` and audited in all three calls as a screenful of its own, what the
  stopped screenful's calls done found dropped so that none is counted twice; should a call stop
  there too, the page is moved again, each time at least 3 points from every place a call
  stopped and aimed as far from them as the band allows (about 11 points on the first try), up to
  three tries (`…-<k>-moved-2`, `…-<k>-moved-3`); the next scroll starts from the one whose calls
  all finished. The stall follows the exact screen, to about a point: PR #38's second run's one
  move landed within half a point of two other runs' stops (DECISIONS, "After #34's fourth full
  run"). The times are attached (`home-<fixture>-<size>-audit-times`, a line a call, each place
  with where the credits were), and the slowest call and any that timed out are named in
  `-allowed`. A page that stops scrolling short of its end, an app that has left the foreground,
  an audit that can't run, or one that doesn't finish in time on every moved screenful or whose
  page can't be moved so, fails with where the page and its credits were
  on each screenful, and the page's frame on each (the scroll view's viewport, PR #33's run
  showed); a timeout with each attempt's error and time and where the credits were. A page that
  stops short, or never reaches its end, also says the page's whole frame and the window's,
  each drag (those that put the page back marked so), the page's four lowest elements and where
  a swipe by XCUITest's own gesture then moved the credits (a page at the end of its scroll range,
  or a drag it didn't take), and attaches the app's element tree as `<name>-tree-stopped`. For a
  new issue, fix the app, or, when it is proven not a fault, add it there with its reason and its
  evidence (DECISIONS, "The iPhone app's UI tests, after PR #33's second macOS run").

**A gesture the simulator cancelled.** On the CI simulator backboardd sometimes registers the
virtual touchscreen XCUITest plays a gesture through twice, drops the touch's lift and cancels the
touch as the touchscreen goes; the app, rightly, takes no action on a cancelled touch, and XCUITest
still calls the gesture delivered (DECISIONS, "What the simulator's log showed"). So the gestures
go through one helper, `cancelled(_:in:within:until:_:)` (HomeScreens.swift), which plays the
gesture and says whether `debug-cancels`, the Debug count of touches the system cancelled (below,
"Debug hooks"), rose meanwhile: read after the gesture, until what it brings has come or up to its
timeout, false with no readout, and attaching `gesture-cancelled` when it rose. Taps go through
`watchedTap`, built on it: it reads for up to 2 seconds or until `done`, what the tap brings, holds,
and plays the tap once more, itself watched, only when the count rose and `done` still doesn't
hold (for the place button, `again`: no picker open, as the readout says, its search box ending the
wait only while the readout can't be read). Each `done` is read from snapshots and is meant never to
be met by what was in the tree before the tap: a tab's or a place's heading (`tap(_:in:)`,
`FixtureLaunchTests`' `show`, the Nearby rows); Settings opened, as the gear still there and taking
a tap shows (`sheetClosed`), not by Close, which XCUITest may go on finding once an earlier Settings
has closed; a page's own title (`showsPage`), or for Back and Close the page gone (`lacksPage`),
never the page under a sheet, whose title stays in the tree; the Debug recorder holding the URL a
row opens; a licence's text holding that licence's own words; a row's or a line's new words (a test
notification's result, the notice); the button itself gone where the tap takes it away before the
server answers (the card's Turn on, and "Use my location" on the "Where you are" page, whose town
comes with the answer), and the card gone after Not now; a switch on; Restore purchase's result; the
outcome's line after Buy; the picker's readout no longer open after a place is chosen or Close; a
star's label turned; the keyboard after a tap on the search box, which the picker opens with nothing
focused. Since main's run on 1d643d3, where Report an ad's touch lost its lift (DECISIONS, "What
main's run on 1d643d3 showed"), every direct tap whose result can be read goes this way: in
`SettingsTests`, `UpgradeTests`, `PickerTests`, `AdsTests` and `NotificationsTests`,
`NotificationPermissionTests`' gear, switch and Your privacy, and the Nearby rows in `HomeTests` and
`FixtureLaunchTests`. Retry (`OfflineTests`, whose request fails again at once, so the count alone
tells) keeps its own call to the helper. A tap the app completed is never tapped again; a cancelled
touch never made one. Each is tapped again once at most, the second tap watched too. `scrollDown`'s
drag goes through the same helper and its `Drag` says whether its touch was cancelled, which every
drag list in a failure prints; `HomeAuditTests`, whose only tap is a tab's, plays a step's cancelled
drag once more before judging the page to scroll no further, and `restore` goes round again after
one, within its 12 drags. Their failures say what `debug-cancels` reads (`cancelsReport`): a
heading, a picker, a page or Settings that never came, a page that scrolls no further or an element
never brought on screen; so do some failures after other gestures. Every `gesture-cancelled` of the
UI plan is listed in the run's summary, with its test and the counts
(`xcresult-summary.mjs cancels`), so a tap played again shows in a passing run too, and a control
whose first touch is cancelled run after run shows as the fault it would be.

Not watched: the taps whose result can't be read (Buy in a cancelled purchase; Google's consent
form and full-screen ad, which have loops of their own; `AdsTests`' tap on a result, which may bring
a full-screen ad first; `PickerTests`' "Use my location" in `testUseMyLocationDenied`, whose line
the chip's tap has already brought), Allow in the system's notification prompt, which is
SpringBoard's and which the app's count can't see, and every swipe and press. A cancel among them
is never played again, and shows only in a failure that names the count, risen with no
`gesture-cancelled` attachment for it. Nor does the watch hold everywhere it is used: under the
picker's full-screen cover `debug-cancels` may not be read, and then a tap is not watched;
Delete's `done`, its row gone, depends on how XCUITest's tree shows a row under its menu. Each
fails as it did before the watch, naming the count. Only `SettingsTests`' own test methods were run
against a fake (on Linux, DECISIONS); the other suites' `done` conditions are type-checked only, and
the next macOS run is their first, but for those of `NotificationsTests`' taps on phase 8.4a's
screens, which ran against fakes, though rebuilt from the suite's helpers rather than run in its
test methods (NotifyTapCheck).

**The contact sheet** tiles every attachment in its names' order (`ci/contact-sheet.mjs`, five
screens to a row). `HomeAuditTests` attaches every screenful it audits as
`home-<fixture>-<n>-<size>-<m>-<tab>-<k>`: `home-aberdeen-snow-1-large-1-now-01`, `…-1-now-02`,
…, `…-1-large-2-today-01`, …, `…-1-large-3-this-week-01`, …, `…-2-ax3-1-now-01` and so on, then
durham-tomorrow (whose middle tab is `2-tomorrow`) and leeds-dry: eighteen pages top to bottom,
fixture by fixture, Large before AX3, each in the switcher's order, after the `app-…` and
`glyph-…` attachments and before the widgets'. A screenful audited again a few points away after
a call didn't finish in time follows its own, as `…-<k>-moved` (then `-moved-2`, `-moved-3`).
Phase 5's exit asks for these.

**On Linux** (`swift test` in IsItCore): `ClockTests.swift` (`FixedClock`: one moment, work for a
later time never runs, the model on it asks once; `MinuteTick.anchor`: each tick a twentieth of
a second into one of the model's minutes, whatever the clocks' offset, and Durham's next tick
from 5:59:30pm turning the page), `PaletteToneTests` (which pages are light ink on dark, so the
system's controls on them take the dark colour scheme) and `PageVectorTests` (the model lines'
names and amounts, and `HomeTopBar`).

## The home screen in the website's look

Carl asked for the app to look as close to the website as possible (DECISIONS, "The iPhone app
in the website's look", which has the why). Steps 1 and 2 brought the fonts, the colours and the
shared parts; step 3 draws the home screen with them, as the website draws the same answer at
402 points wide:

- **Type**: every word through `.brandFont(TextRole)` (BrandType.swift), Bricolage throughout,
  the answer word 0.3 of the page's width (`HomePager` passes `pageWidth` to `ForecastPageView`).
  A role's text is drawn at whole points, so each must come to different sizes at Medium and
  Large, or the audit finds it "partially unsupported" for Dynamic Type: no role is 14.4 with
  subheadline (14 at both), the `button` role gone, Close and Retry in `label` and a notice's
  project page in `labelStrong`, and `small` gone, the limited line and the week's bands in
  `line`, 15.2 (DECISIONS, "After #34's second full run").
- **The top bar** (`TopBarView`, HomeShell.swift): the app's name leading, "willitsnow.today" as
  the website's header shows it, which VoiceOver reads as its words, "Will it snow today"
  (`AppNameView`, `app-name`; `TextRole.appName` and `appNameEnd`; `AppCopy.appNameLabel`); the
  place in a pill with the website's pin (`PillButton`, `PinShape`) and the gear in a round chip
  (`IconPillButton`), trailing; beneath them a notice chip (`approximate`) and, on approximate IP
  location, the "Use my exact location" chip (`use-my-location`), whose VoiceOver hint is "Using
  approximate location.". When the three don't fit one line, the name and the gear share the
  first and the pill takes the next, leading, with the notes under it (`TopBarLayout`; DECISIONS,
  "The app's name back at the top left").
- **The switcher** (`ViewSwitcher`): the website's track and ink thumb (`PillSegments`) at
  standard sizes, chips that wrap at accessibility sizes, one tab bar (`views`) holding
  `view-now`, `view-today` and `view-week` at every size. The segmented `Picker` is gone, and
  with it `HomeAuditTests`' Dynamic Type exception.
- **The pages** (`ForecastPageView`, `PageBodies.swift`): the glyph at the question's top right
  (above it at accessibility sizes), in full ink; Today's models and Now's hours as the website's
  grid of values over names (`EqualColumns`, `ValueCell`, one element a cell); the week under
  "The week ahead" (`week-heading`) as rows of day, track and dot (`WeekTrack`, `WeekRow.left`),
  amount and band, the agreement spoken only; the footer in the website's type, Retry a bordered
  chip, the places nearby one run with commas (`AppCopy.listComma`), a hairline over the credits.
- **The presenters, TypeScript first**: `homeTopBar` (`approximate` only a notice,
  `useMyLocation` the chip's words) and `homePage` (`week.heading`, each row's `left`, from
  core's track from none to the snowiest day), ported as `HomeTopBar` and `HomePage`, with
  `StripGeometry.track` shared. `CoreCopy` gains `nextDays` and `useExactLocation`.

What changes for the UI tests: `HomeAuditTests` knows the text size reached the app by whether
the tabs wrap (`switcherWraps`), and allows two kinds of issue, not three; `HomeScreens.swift`
checks the week's heading. The rest read the regenerated `HomeScreens.json` unchanged.

## Phase 6: the place picker and Settings

The top bar's two sheets, built side by side and then connected (below, "How they meet").
DECISIONS has each one's choices ("The iPhone app's place picker", "The iPhone app's Settings")
and how they were put together ("The iPhone app's phase 6, put together").

### 6.1: the place picker

The full-screen sheet behind the top bar's place pill and its "Use my exact location" chip (spec
sections 4, 9.4 step 4, 10.3, 15.2 and 16). DECISIONS has the choices ("The
iPhone app's place picker").

- **The rules are in IsItCore, tested on Linux.** `PlaceSearch.input(_:)` and `.detail(_:)`
  (IsItLogic) are the ports of client `searchInput` and `resultDetail`, which the website's picker
  now uses too, checked against `search.json`: the text trimmed as JavaScript trims it, 2 letters or
  more counted in UTF-16 code units, and "England, United Kingdom" under "Leeds". `PlacePicker`
  (IsItLogic) is the sheet as plain values: the title, the prompt, the clear button's label, "Use my
  location" first (with "Finding you…", location access off and Open Settings, or no fix), the
  search's line (too short, no places, why it failed) or its results, and with nothing typed the
  recent places under "Recent". `PlacePickerModel` (IsItState, from `AppModel.makePicker()`) runs
  the search: 250 ms after the last keystroke (`Constants.Search.debounceMs`, on the model's clock,
  so the tests move it), each keystroke cancelling the wait and the request before it, only the
  newest answer shown, and the last results kept while the next search is out.
- **The picker is in the website's look** (the website's look, step 5; DECISIONS, "The iPhone
  app in the website's look"): the band of the page on screen, read from the model as the sheet
  draws (`PickerSheet`), so it follows a refresh, on the sheet surface (`SheetBackground`, every
  word in its ink and Bricolage, no cards, no hairlines, never Dark Mode). `PlacePickerView`
  draws the title row (`SheetHeader`: "Search for a place" and the website's Close pill,
  `picker-close`), the search box, then a `ScrollView` of rows made at once, not a `List`: "Use
  my location", its line and Open Settings, the search's line or its results, or with nothing
  typed Saved and Recent. Each place is a `PlaceRow` (the name, the line beneath in `soft`, the
  wash when pressed) with its `StarButton` (`star-<row>`), and a press-and-hold menu whose items
  are VoiceOver actions too: "Save {place}" and Delete on a recent place, "Remove {place} from
  saved places" on a saved one. After a star or a menu item, VoiceOver is told what it did
  ("Leeds deleted from recent places." after Delete). The parts are in PickerChrome.swift.
- **The search box is the app's own** (`SearchBox`, PickerChrome.swift): the website's box (the
  `field` tint, the 1.5-point `fieldBorder` edge, corners of 12) around `BoxTextField`, UIKit's
  `UITextField` in a representable, as tall as the box (at least 44, `sizeThatFits`) so its own
  element is too, in the `field` role's face scaled with `.body`, its prompt in `soft`, the
  keyboard's Search key choosing the first result, and while it holds text an ink xmark 44 points
  square ("Clear search") that keeps the keyboard up. Not the system's search (`.searchable`),
  whose own clear button, about 20 points square, the audit failed as too small to tap, and
  which SwiftUI can't resize or remove.
- **Choosing a place** is `AppModel.choose(_:name:)`: `place.v1`, the fetch in place
  (`select(_:)`, which saves the answer for the widgets and reloads them), the recent places
  (`recent.v1`, the last five, `RecentPlaces` with the `RecentDefaults` store in the app's own
  defaults), and phase 8's `syncAlerts` hook, which decides whether a notification place
  follows. A search result is `Target(search:)`: its city page's slug, or its point on the grid
  with what the search said. The sheet closes as the place is chosen, before its answer, and
  the answer comes on the view on screen, as a place under "Nearby:" does (phase 5.2): a place
  chosen from This week shows its week.
- **Saved places** (the website's look, step 4; DECISIONS, "Saved places") sit above Recent
  with nothing typed: at most ten (client `PLACES.savedMax`, `Constants.Places`), in the order
  saved with the newest last. The rules are client `saved.ts` (`isSaved`, `canSave`,
  `savePlace`, `unsavePlace`, `choosePlace`, `shownRecent`), ported as `SavedPlaces`
  (IsItLogic) and checked against `saved.json`: saving takes a place out of Recent, removing it
  puts it back on top of Recent (so one more tap on its star undoes it), choosing a saved place
  leaves both lists alone, and Recent never shows a saved place. Approximate IP location and the
  phone's own point are never saved: a device fix follows the phone, so its Recent row has no
  star. `PlacePicker` gives the Saved heading, its line when full and, since phase 8.4b, the line
  that says what a star and a bell do (`saved-line`, which replaced the hint with none saved),
  each saved place's bell (below, "Phase 8.4b"), each row's star (`Star`: its label and what VoiceOver is told after a tap) and a saved
  result's value; `PlacePickerModel.save(_:)`, `.unsave(_:)` and `.choose(saved:)` call
  `AppModel.save(_:)`, `.unsave(_:)` and `.choose(_:name:detail:)`. A star chooses nothing and
  asks the server nothing. Recent places now keep the line beneath their name (`detail`), so two
  Newcastles can be told apart.
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

**Where the picker's lists are kept**, both in the app's own defaults, as the client's JSON,
written whole after each change (the saved places first) and read leniently (anything that
isn't a list is none; bad entries, approximate IP location, repeats and, for saved places, the
phone's point and empty names are skipped; the list is cut to its most):

| Key              | What                                                  | Store (IsItServices) |
| ---------------- | ----------------------------------------------------- | -------------------- |
| `recent.v1`      | the last five places chosen, newest first, with lines | `RecentDefaults`     |
| `savedPlaces.v1` | up to ten saved places, the newest last, with lines   | `SavedPlaceDefaults` |

Neither is in the App Group: no widget reads them, as the widget follows the place on screen.
`-resetStore` forgets both.

**Its tests.** On Linux: `Tests/IsItStateTests/PlacePickerModelTests.swift` (the search's pause,
cancelling and failures, choosing a city and a point, the recent places, Use my location
granted, denied, refused, without a fix and tapped twice, the sheet closed or a place chosen
while the fix is out (the fix then chooses nothing), a launch that never asks, and saved
places: a result's star saving in place, a recent place moved to Saved and back, a full list,
a saved place chosen, both lists kept and read back), `AppModelTests.swift` (the two lists'
writes, saved places first), `Tests/IsItLogicTests/PlacePickerTests.swift` (the content, its
Saved section and stars, and `recent.v1`'s and `savedPlaces.v1`'s reading) and the
`search.json` and `saved.json` ports. On the macOS CI, `PickerTests` (UI plan), over `-network
ip-first-launch,leeds-dry` or `…,kathmandu-0545` and `-location`: too short and no results;
choosing Leeds (a city page) and Kathmandu (a point); a recent place kept across a relaunch with
its line, the box's clear button (44 by 44, "Clear search", back to the recent places with the
keyboard up), then the place deleted from its press-and-hold menu; a result's star saving it in
place (nothing chosen, the sheet open, the row's value "Saved"), kept across a relaunch, chosen
from Saved and still there, not under Recent; a recent place's star moving it to Saved, the
saved place's star bringing it back with the line under Saved (since phase 8.4b, its words for
none saved, and for a place saved without the purchase), and its menu's Remove; Use my location
denied, from the top bar's chip (tapped above it, on its line) and the picker's own row; Use my
location with a fix; and the accessibility audit of the sheet, with a recent place and location
access off, of its results with the keyboard put away by a drag, with saved and recent places at
Large and at AX3, and on a dark band (`-fixture aberdeen-snow`). Their screens are
`picker-no-results`, `picker-results`, `picker-recent`, `picker-location-denied`,
`picker-audit`, `picker-results-audit`, `picker-saved`, `picker-saved-ax3` and `picker-dark`.

### 6.2 and 6.3: Settings

The gear opens the Settings sheet (spec sections 10.4, 10.6 and 10.7) in the website's look:
the website's content pages' palette (`PageTheme.content`, core's `snow`), the same in Light and
Dark Mode, each page's title on the page in the answer's face, and rows with icons on plum cards
under their headings, on a page that scrolls (`SheetPage`, not a `Form`). As on the home screen,
IsItLogic makes the content as plain values (Linux-tested), IsItUI draws it, and the app connects
them in one file (`SettingsSheet.swift`). DECISIONS has the choices ("The iPhone app's Settings",
and its look in "The iPhone app in the website's look", step 6).

- **The rows, in order:** Snow units (cm | in, the footnote beneath: `UnitsSegments`, the website's
  cm | in pill, `PillSegments` on the card, two buttons at least 56 by 44 whose words grow with the
  text, the one chosen on the ink thumb and marked selected; not UIKit's segmented control, whose
  type size is fixed); since phase 7.1 the upgrade card, with no heading ("No ads, widgets and
  more" since phase 8.4b, with StoreKit's price once it has one, or the thanks once bought, then "Restore
  purchase": below, "Phase 7.1: the purchase"); Privacy ("Privacy choices", in the free version
  while Google's consent says its privacy options form is required, then "Your privacy", "Privacy
  policy"); "Report an ad", in the free version only; About ("How it works", "Credits and licences",
  "Terms"); Help ("Contact us", "Support"); and "Version 1.0 (112)" from the bundle.
  willitsnow.today's pages open in Safari and the emails in the mail app, through `openURL`; every
  address is `Constants.Site` (core `SITES.snow` and `CONTACT_EMAIL`).
- **Notifications** (phases 8.1 and 8.2) sit after the units, before the upgrade card, and Your
  privacy shows what the server keeps for them first, while registered, with "Turn off
  notifications and delete my data" (below, "Phases 8.1 and 8.2: notifications"). Nothing shows as
  a row that does nothing.
- **Privacy choices** (phase 8.3) is real: `SettingsSheet` passes
  `!model.unlocked && ads.privacyChoices` (`AdsModel`, from UMP's last answer) to
  `SettingsScreen` and to `YourPrivacy`, whose "See Privacy choices." follows the ads line while
  the row is there, and the row opens UMP's privacy options form over Settings
  (`AdsModel.openPrivacyChoices()`). Outside the UK and the EEA the form isn't required, so
  neither shows (below, "Phase 8.3: the ads").
- **IsItLogic:** `SettingsScreen(units:unlocked:privacyChoices:purchase:version:)` (the sections
  and rows, each with its action: a page, a web page, an email, Report an ad, Google's form,
  Restore purchase, or none for the thanks),
  each row's icon (`SettingsScreen.Icon`, one a row, the units' too), `AppVersion`, `MailDraft`
  (`contactUs()`, `reportAd(version:place:at:zone:)`, its `mailto:` URL
  encoded as `encodeURIComponent` encodes, and the `MailFallback` to show without a mail app),
  `HowItWorks()`, `CreditsPage()` and `YourPrivacy(adsOn:privacyChoices:kept:deleteStatus:)`
  (`kept` filled, and `deleteStatus` added, in phase 8.2).
- **IsItUI:** `SettingsView(screen:notifications:notificationPlace:privacy:upgrade:actions:)`
  (the notifications since phase 8.1), with the pages on its own stack
  (`YourPrivacyView`, `HowItWorksView`, `CreditsView`, `NoticeView`, since phase 7.1
  `UpgradeView`, and since phase 8.1 `NotificationPlaceView`) and `MailFallbackView`,
  built from SheetStyle.swift's parts. `sheetChrome()` puts a sheet on the content surface, its
  system parts in the dark scheme and ink. `SheetPage(title:)` scrolls over `PageBackground`
  with the content palette, under its `PageTitle` (the answer's face at 35, a heading,
  `page-title`); the navigation bar keeps its buttons and the title for VoiceOver and the back
  menu, but draws none. `SheetCloseButton` is the toolbar's xmark (`CloseLabel`), top right,
  tinted with the card colour, which iOS 26 draws as a plum glass circle. `SheetSection` is a
  heading over a `SheetCard` (opaque `card`, corners of 24); its rows are `RowLabel`s (the icon,
  dropped at accessibility sizes, the title in `row`, a detail in `note` and `soft`, a chevron
  for a page on the stack or an arrow out) in `SheetRowStyle` (the whole row at least 54 tall,
  washed while pressed), with a `SheetDivider` (a 22% hairline) between each two. How it works,
  Your privacy, the credits' models line and the fallback's words are paragraphs on a
  `ReadingCard`; Credits and licences gives each credit's words whole on a card, then each of
  its sources and licences as a row of its own that opens it, not as links inside the sentence.
  The privacy policy and a notice's project page are page buttons (`PillButton(.wide)` in the
  card colour), the project page's showing its URL underlined and labelled in words ("Bricolage
  Grotesque's project page", `CreditsPage.Notice.urlLabel`), the URL its value; "Copy address"
  is the primary pill (ink, its words in the pill colour). A notice's text is on a card in the
  system's monospaced footnote type, the one text not in Bricolage. The audit's Dynamic Type
  check failed a `Form`'s rows and headers that grew with the text, and passed a scroll view's
  text on screen or not (DECISIONS).
- **The colours** are the content surface's tokens (`BrandTokens`, step 2's
  `brandColours.test.ts`): ink on a card 14.20:1, `soft` 10.62, ink on the wash 10.00, the pill
  colour on ink 11.54. Only single lines sit on the gradient (titles, headings, the version,
  "Address copied."), 4.88:1 at the glow's centre and 7.32 under Increase Contrast, which drops
  the glow; anything that can wrap is on a card, as the audit has only passed such text on flat
  fills. Nothing follows Dark Mode, so the system colours `SheetColours` once corrected are gone
  with it.
- **The units** go through `AppModel.setUnits(_:)` (IsItState): kept in `units.v1`, the answer
  asked for again in them with what is on screen kept meanwhile, then the notifications' sync
  hook (phase 8), since a registration carries the units.
- **The notices** in `Apps/Snow/Resources/Licences/` are copied whole: Bricolage Grotesque's SIL
  OFL 1.1 from the font's npm package, and the two Google packages' LICENSE files at the pinned
  revisions. A vitest test holds each to its source (`packages/mobile/test/credits.test.ts`).

**On Linux:** `Tests/IsItLogicTests/SettingsScreenTests.swift`, `MailDraftTests.swift` and
`InfoPagesTests.swift` (every row and its action, the free and bought versions, the emails'
subject, body and encoded URL, the phone's time, How it works word for word with the
constants' numbers, the credits and their links, "The app's typeface.", Your privacy's lines,
each row's own icon, and no word naming another app, site or weather),
`Tests/IsItStateTests/UnitsTests.swift` (the units kept, asked for and
saved, the answer kept meanwhile, offline, the same units), and in packages/mobile the copy,
the credits, the constants, Your privacy against the website's privacy notice, every title drawn
in the answer's face inside its subset and its font's cmap (`titleFont.test.ts`), and the guard
that no Swift view or label is given a string literal (`swiftLiterals.test.ts`, below).

**On the macOS CI:** `SettingsTests` (UI plan), with `-openURLs`: the units switch (each unit
at least 44 by 44), the refetch in inches and the choice kept at the next launch; every row's URL
or page, each page known by its title on the page (`page(titled:in:)`, `page-title`), since the
bar draws none; Report an ad's and
Contact us's fallback with "Address copied."; Your privacy's lines; the version line; no word naming
another weather type on screen; and the accessibility audit on Settings, How it works,
Credits and licences, a licence in full, Your privacy and both fallbacks. The screens are
`app-settings`, `app-how-it-works`, `app-credits`, `app-notice`, `app-your-privacy`,
`app-report-ad-fallback` and `app-contact-us-fallback`. `testRowsOpenWhatTheySay` taps the two
emails after its pages' audits: the recorder's lines show the whole URL below the sheet's content,
and Report an ad's, 201 characters, would take most of the screen at the audit's largest sizes.

**The audits** (`PickerTests` and `SettingsTests`; `HomeAuditTests` has its own, with its
exceptions, above) go through `auditAccessibility(of:on:surface:)` (`UITests/ScreenAudit.swift`):
`performAccessibilityAudit(for:)` for every kind of issue, in the home audit's three calls
(`AuditKinds`: contrast; then element detection, hit regions, descriptions and traits; then
Dynamic Type and clipped text, the seven kinds the iOS SDK defines, each named rather than `.all`
less two), each issue noted once its call is done with its kind (named as `HomeAuditTests` names
it), its element's type, identifier, label and frame, and Apple's description, a contrast issue
with the screen's darkest and lightest pixels inside the element and what the proof reads of
it, then one failure that lists them all with the window's frame. The tests stop at their first
failure, so without it a run would show one issue a screen. Each audit first attaches the screen
as audited and the element tree (`audit-<screen>`, `audit-<screen>-tree`), and each call goes
through `runAudit`, as the home audit's do: timed (`audit-<screen>-times`), and, with no page to
move a few points as the home's audit does, run again once after a timeout, on the same screen,
only while the screen's elements are where they were as audited. Each test says
which surface its screen is (`auditAccessibility(of:on:surface:)`): the picker the sheet in the
band of the page it opened over (`HomeScreen.picker()`, from the screens `picker-leeds`,
`picker-first-launch` and `aberdeen-snow`), Settings, its pages and the mail fallback content.
Every issue is the app's to fix but one: contrast on a text element the proof allows, as on the
home screen, listed in the failure with why and attached as `audit-<screen>-allowed`. Settings' Close buttons (`close-settings`, `close-fallback`) are the
xmark with "Close" as their label (`CloseLabel`, IsItUI), not the word on screen, which a toolbar
draws at the bar's own type size and the audit failed for Dynamic Type; the picker, with no
toolbar, has the website's Close pill (`picker-close`), whose word scales with the text.

**The contrast proof** (`UITests/DrawnText.swift`; DECISIONS, "Contrast by measured pixels, after
#34's first full run"). Apple's contrast check fails Bricolage text whose pixels measure far above
4.5:1, so wherever it fails a text element (a static text, or a button or link with a label), on
every audited screen, the test judges the element by WCAG on the screenshot's own pixels instead,
and allows the issue only when they prove it (`MeasuredContrast.allows`). Each pixel of the frame
is classed against its surface's model at that point: one of the surface's fills (within 6 levels
a channel), one of its text colours (within 3: the ink, or soft on a flat fill), for a button or
link one of the lines it draws (its edge, a hairline, a chevron), a blend of two of those with a
pixel of each within 2 pixels (anti-aliasing; the screenshot is read a point round the frame for
these neighbours only), or none of them. It proves when the frame is whole on screen and at least
10 by 10 points, the text colours are on 1% of it or more, pixels of none are no more than 0.5% of
the frame nor 2% of its text pixels, and each text colour drawn on 9 pixels or more gives 4.5:1 or
more with each fill shown clear of what's drawn on it on 1% of the frame or more, measured on the
pixels. So it refuses an element whose text is dimmed, greyed, in another colour or over a fill
the surface hasn't (pixels of none over 0.5% of the frame or 2% of its text), one with no text
drawn, a tiny or off-screen frame, and a palette short of contrast. Only the tokens' text colours,
ink and soft, are measured; and as pixels are classed by colour alone, text drawn in exactly one
of the surface's own fill or line colours (the wash, the field, a chip, the card, the track, an
edge or a hairline) is taken for that fill or line, and isn't measured. Hit regions, Dynamic Type,
clipped text, descriptions, traits and element detection are never allowed. The surfaces come from
one source: packages/mobile `brandColours.ts` `SURFACES` (the page: the band's gradient and glow
and its opaque chips; the sheet: the band's pill fading towards g2, the wash and the field;
content: the content palette's gradient and glow, the plum cards and the units track), written
with every band's palette and the background models' numbers into `Generated/Surfaces.json`
(`surfacesJson`), whose sample colours the Swift reproduces before judging a pixel
(`SurfaceFile.bundled`), so the proof and the tokens can't part; `brandColours.test.ts` holds every
text pair the proof can allow to 4.5:1 on every band. Since phase 8.1 a switch or toggle with a
label is text to it too, its capsule one of the lines it draws: Settings' notification switches,
which the app draws itself in the content surface's own colours (`SheetSwitchStyle`), so the proof
can judge them as it judges a row, where UIKit's switch, its track and shadowed knob in colours no
surface has, could only have been refused.

### How they meet

- **One sheet at a time.** `HomeView` holds one `HomeSheet?`: `.picker(PickerRequest)` opens the
  picker as a full-screen cover, `.settings` Settings as a sheet, and each closes only itself
  (since phase 7.1, `.upgrade` the upgrade sheet, which shares Settings' presentation, so a link
  swaps one for the other).
  The place pill and the "Use my exact location" chip (with `locating`) open the
  picker; the gear opens Settings. The top bar is `HomeShell`'s, over the switcher and the
  pager, so all three open their sheets from every page. The picker wears the band of the page
  on screen and gives its own system controls the band's colour scheme, as `HomeShell` does;
  Settings wears the website's content palette whatever the band, and gives its own controls the
  dark scheme itself (`sheetChrome()`), since it is presented from outside `HomeShell`, whose
  scheme doesn't reach it. While
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
  the top bar's controls, the switcher, the pager and the page were (`homeGeometry`), and what
  `debug-cancels` reads; one whose touch the system cancelled is tapped once more (above, "A
  gesture the simulator cancelled").
  Phase 5.4's tests and phase 6's share the launch arguments (below, "Debug hooks"): `-network`
  takes a comma list of fixtures, or `off` or `unavailable`; `-clock fixed` and `-now` fix the
  moment; `-resetStore` forgets the recent and saved places too. Their identifiers differ, and
  the pager keeps only the page on screen in the accessibility tree, so the picker's and
  Settings' tests find one `heading` and one `verdict`, the page on screen's.

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
  decoding error's description, a Debug build's log line (`Logger`'s `debug`, read in Console,
  never shown: since phase 8.1, a notification whose payload routes nowhere), a bundle's file and
  folder names, Info.plist keys, SF Symbols' names, and three names: the `Accept` header,
  JavaScript's `Infinity` and the `Fallback` glyph folder. A test fails when one of those names is
  no longer used.

A word it finds belongs in packages/mobile `appCopy.ts` (then `pnpm mobile:generate`), not the
allowlist. What still passes is one lowercase word or a symbol alone outside any view (`let unit
= "cm"`), which can't be told from a key by its shape; given to a view, it fails. When phase 6 was
put together the Swift had no stray prose: every literal the guard flags is a crash's or a
decoding error's message, or one of the names above; and no literal is given to
`Text(verbatim:)`. Phase 5's pages, merged in after, passed it unchanged: their one new literal
of the kind is a bad `-clock`'s crash message.

## Phase 7.1: the purchase

The one-off purchase (spec sections 10.2 item 6, 10.4, 10.5 and 13): "No ads, widgets and more"
("Remove ads and add widgets" until phase 8.4b), £1.99, a non-consumable with Family Sharing on
(Q4), which takes all three ad placements away at once, from phase 7.2 turns the widgets on, and
from phase 8.4b unlocks the saved places' bells (below, "Phase 8.4b"). The words below are 8.4b's. Carl left the open questions
to the agents ("Whatever you think is best"); DECISIONS has each answer and why ("The purchase in
the iPhone app (phase 7.1)").

- **What shows.** In the free version, once StoreKit has given a price, a row at the end of the
  middle page, under Today and Tomorrow alike and only on a page with an answer: "No ads, widgets
  and notifications for saved places · £1.99" (`UpgradeRow`, `upgrade-row`), between the page's
  body and its footer, so never beside an ad (the box comes after the footer's links). Settings'
  upgrade card, first after the units, with no heading: "No ads, widgets and more · £1.99", or the
  same words without a price until StoreKit gives one (while it loads, offline, with nothing for
  sale yet, or with payments off), either way opening the upgrade page (`upgrade`); once bought,
  "Thank you. Ads are off, widgets are on and you can turn on notifications for saved places."
  (`thanks`, a line that takes no tap); and "Restore purchase" in every state (`restore`), its
  result beneath it. The upgrade page (`UpgradeView`), in Settings' look: the title, the three
  benefit lines (`upgrade-benefit-1` to `-3`, since phase 8.4b), what the purchase is, "Shared
  with your family through Family Sharing."
  when the product says it is shared, then a spinner while StoreKit hasn't answered
  (`upgrade-loading`), "Buy for £1.99", the primary pill (`buy`), or a line saying why it can't be
  bought (`upgrade-unavailable`: "The purchase isn't available right now. Try again later." or
  "In-app purchases are turned off on this iPhone."), or nothing once bought; the last outcome
  (`upgrade-outcome`: the thanks beside a seal, "Waiting for approval." for Ask to Buy, or
  StoreKit's own words for a failure; a cancel shows nothing); and Restore purchase as a row of a
  card (`sheet-restore`). Settings pushes the page on its own stack; the home row and
  `willitsnow://upgrade`, and since phase 8.4b a saved place's locked bell over the picker, open it
  as a sheet of its own (`UpgradeSheetView`, `close-upgrade`). No
  price is typed in the app: it is StoreKit's `displayPrice`.
- **At launch** (`PurchaseModel`, IsItState): step 2 listens to `Transaction.updates`, then reads
  `Transaction.currentEntitlements` whole and asks for the product; never `AppStore.sync()`, so
  nothing prompts at launch. Step 5 waits for that check, and for any read begun while it was out,
  before it decides on the ads (`launchEntitlement()`); an answer `PurchaseModel` gave meanwhile
  stands.
- **One answer, one writer.** It is owned when `PurchaseRules.owned` finds a verified, unrevoked
  transaction for the product, bought or shared through Family Sharing. The entitlements are read
  in turn: a read overtaken by a newer one is dropped, and whoever asked for it waits for the
  newer one; and each verified update heard is kept beside them until they show it, merged into
  every answer meanwhile, so a lagging read can't undo a purchase, a refund or a removal. Every
  answer is written to `unlock.v1` (`{ unlocked, checkedAt, productID }`) by `PurchaseModel`
  alone, through `UnlockStore` (`SharedStore` in the app; `StoredState` only reads it), the
  widgets reload when what it says changes, and `AppModel.purchaseChanged(owned:)` hears each
  change, so every view that reads `unlocked` follows at once. A transaction is finished only once
  an answer holding it has been kept.
- **Buying** is `purchase(confirmIn:)` in the app's scene, with Apple's own confirmation sheet.
  Verified: owned, and the thanks. Ask to Buy: "Waiting for approval.", and Buy stays (a parent's
  no sends nothing, so it is the only way to ask again); the approval comes through the updates.
  Unverified: no unlock, not finished, and StoreKit's words for the failed check. Cancelled:
  nothing. Failed: StoreKit's words.
- **Restore purchase**, from its rows only: `AppStore.sync()`, then the entitlements again,
  whatever it came to. Owned: "Purchase restored."; only a transaction StoreKit couldn't verify:
  StoreKit's words for that; none: "No purchase found for this Apple Account."; a cancelled
  sign-in: nothing; a failure: StoreKit's words. The row that was tapped says the result to
  VoiceOver, once (`RestoreRow`).
- **A refund or a Family Sharing removal** (the same transaction, revoked) locks at once: the home
  row and Report an ad come back, `unlock.v1` says so and the widgets reload; the ads wait for the
  next launch (spec 13). Someone who also bought it keeps it if the entitlements still show their
  own purchase; while a revoked update is ahead of them, they are read again each time the app
  becomes active, so it is back at the next foreground at the latest, or at once with Restore
  purchase.
- **The ads.** A purchase while the app runs stops all three placements for good this launch:
  `AppModel` calls `hooks.stopAds()` (once launch step 5 has started them; owned before it, step
  5 starts none, and a refund before step 5 leaves a free launch, with its ads), `AdsModel.stop()`
  calls off every banner load and retry, the full-screen ad and Mobile Ads' start if it hasn't
  come (a consent form already on screen stays until answered, then starts nothing), the band
  leaves the stack so the pages grow once, each box goes, and `GoogleAds.stop()` drops the banner
  views. `PickerSheet` asks for no full-screen ad once the purchase is owned. A Debug build's
  readout says `off`.
- **When the app becomes active**, the product is asked for again unless StoreKit has given it,
  and the entitlements while an update heard is still ahead of them; Settings and the page ask for
  the product as they appear too.
- **Offline**, `unlock.v1` is what the app paints with and what the widgets read; the launch's
  check reads StoreKit's own cache, which answers offline, and a reinstall on the same Apple
  Account answers from it too. The product doesn't load, so there is no home row, Settings' row
  has no price, and the page says the purchase isn't available right now.
- **IsItCore, tested on Linux:** IsItLogic's `PurchaseFact` (a transaction as plain values),
  `PurchaseRules` (`owned`, `merging`, `unseen`), `PurchaseState` (the product, the last buy and
  the last restore), `UpgradePage` (the page, and `homeRow`) and `SettingsScreen`'s upgrade card
  (`purchase:`, the rows `upgrade`, `thanks` and `restore`, their icons, `Row.detail` and `busy`,
  `SettingsPage.upgrade`); IsItState's `PurchaseModel`, behind `PurchasePlatform` (StoreKit) and
  `UnlockStore` (`MemoryUnlockStore` without an App Group), `AppModel.purchaseChanged(owned:)`,
  `AppHooks.stopAds()`, and `AdsModel.stop()` with its `off` phase.
- **IsItKit:** IsItServices' `StoreKitFacts` (each transaction as a `PurchaseFact`, and the
  entitlements: reading only, which the widget reads from 7.2) and `SharedStore` as
  `UnlockStore`; IsItPurchases' `StoreKitPurchases` (StoreKit 2 as `PurchasePlatform`: the
  listener, the product, buying, finishing and `AppStore.sync()`), which only the app links;
  `GoogleAds.stop()`; IsItUI's `UpgradeView` with `RestoreRow`, `UpgradeSheetView`, `UpgradeRow`
  and `UpgradeActions`, Settings' card and pushed page, three icons (`sparkles`, `checkmark.seal`,
  `arrow.clockwise`), and a slot on each page between its body and its footer (`HomePager`'s
  `pageCards`, `ForecastPageView`'s `cards`), which carries the row now and phase 8.1's
  notifications card above it.
- **The app:** `WillItSnowApp` makes `PurchaseModel` over `StoreKitPurchases` (or a Debug build's
  stand-in, below) and `unlock.v1`'s store, tells `AppModel` each change, asks it again as the
  scene becomes active, and takes links through `.onOpenURL` (`DeepLink.parse`, then
  `AppModel.open`, which keeps a link that comes before the launch has finished for step 7);
  `LiveHooks` fills steps 2 and 5's check, `stopAds()` and the `.upgrade` route; `HomeView` puts
  the row in the middle page's slot and opens the sheet, Settings and the upgrade sheet being one
  `.sheet(item:)`, so a link while Settings is open swaps them and one while the picker is open
  closes it; `SettingsSheet` gives Settings the card and the page; `UpgradeSheet.swift` is the
  sheet.
- **Snow.storekit** (`Apps/Snow/StoreKit/`) is written by `pnpm mobile:generate` from
  packages/mobile `purchase.ts` (`PURCHASE`: the product ID `today.willitsnow.app.unlock`, the
  reference name "Snow unlock", non-consumable, 1.99 in the GBR storefront in en_GB, Family Sharing)
  and `exportStoreKit.ts`, its display name and description from `APP_COPY` (`upgradeTitle`,
  `upgradeDescription`), in the form Xcode's StoreKit editor writes, so opening and saving it in
  Xcode changes nothing; the generator owns its folder. The same facts give
  `Constants.Purchase.productID` and `.displayPrice` ("£1.99", which only the Debug stand-in shows).
  It is in no shipped target: only the StoreKit tests' bundle holds it, as a resource, and the
  scheme's Run action names it; the release checks fail an app that bundles one.

**Its tests.** On Linux (`swift test` in IsItCore): `PurchaseRulesTests` (only shapes StoreKit
gives: at most one entitlement per non-consumable), `UpgradePageTests`, `SettingsScreenTests` and
`InfoPagesTests` (the card in every state, Your privacy's new purchases line), `PurchaseModelTests`
(48 tests in six suites, each under a one-minute limit, against `FakePurchasePlatform`, whose
calls are held and answered one by one, so each order of the launch's check, an update, a buy and
a restore is run, with the launch through `AppModel` too), `AppModelTests` (a purchase mid-session
stops the ads, one heard before step 5 stops nothing, so a refund after it still leaves a free
launch with its ads, a refund mid-session starts nothing, and step 5 never overwrites
`purchaseChanged`) and `AdsModelTests` (`stop()` at every point of the start, the banners, the
privacy options form and the full-screen ad). In packages/mobile: the copy, `storekit.test.ts` (Snow.storekit pinned whole,
and the writer giving its own output back), the constants, and the purchases line paired with the
website's privacy notice. On the macOS CI:

- **The StoreKit plan** (`TestPlans/StoreKit.xctestplan`; the `WillItSnowStoreKitTests` target,
  hosted by the app, as StoreKit Test needs): 17 `SKTestSession` tests over the real
  `StoreKitPurchases` and `PurchaseModel` (`PurchaseServiceTests`: the product and an unknown one,
  buying before the product loads, buying, a purchase made elsewhere arriving through the updates,
  Ask to Buy approved and declined, a refund while open and while closed, restore found, nothing,
  cancelled and failed, an unverified, a failed and a cancelled purchase, and the unlock in the
  App Group), and `SnowStoreKitFileTests` (the bundled file against the generated copy and
  constants). The configuration is the test bundle's own (`SKTestSession(contentsOf:)`), each
  test's listener is stopped in `tearDown`, and every buy and restore test first requires the
  product loaded (`readyModel()`), and the cancel test buys again once its simulated cancel is
  cleared, so a test environment that cancels every purchase fails rather than passing as a
  cancel. Simulated errors are cleared by `resetToDefaultState()`, never by
  `setSimulatedError(nil, forAPI:)`, which leaves every later purchase failing (docs/DECISIONS.md,
  "What PR #40's first macOS run showed"). setUp, once it has cleared the transactions, waits until
  StoreKit itself lists none of the app's (`untilStoreKitListsNothing`, which it records with how
  long it took), as storekitd forgets them a little after `clearTransactions()` returns, and a
  test that read them sooner started with the previous test's purchase; and each refund test
  refunds the transaction its own buy made, by the ID in the buy's result (docs/DECISIONS.md,
  "What PR #44's StoreKit run showed"). Each test logs the simulator's iOS version. It runs on an iPhone 17 with iOS 26.2
  (below, "Settled"), in a job of its own (`storekit`), with test timeouts on and 60 seconds a
  test (`ci/test.sh StoreKit`).
- **The Unit plan:** `AppGroupTests` writes `unlock.v1` through `saveUnlock(_:)`, and
  `InfoPlistTests` checks the app bundles no StoreKit configuration.
- **The UI plan** (iOS 26.5): `UpgradeTests`, 12 tests over StoreKit's stand-in (the row, the
  sheet and buying; Ask to Buy; a failed, an unverified and a cancelled purchase; buying on
  Settings' own stack; restore found, none and failed; the link; no product; the paid version),
  the sheet audited bought and not, attaching `app-upgrade` (the purchase's review screenshot
  until 7.3's), `app-upgrade-thanks` and `app-upgrade-unavailable`; `HomeAuditTests`' two cases
  for the row (leeds-dry's middle page at Large and AX3, `home-leeds-dry-upgrade-…`);
  `AdsTests.testBuyingTakesTheAdsAway` (Google's demo ads, then bought: `debug-ads` reads `off`,
  and the band, the boxes, the home row and Report an ad are gone, Privacy choices' going being
  `AdsStopTests`', as it never shows outside the EEA; it never skips, and says in
  `ads-after-purchase-unchecked` what it couldn't check when Google didn't answer); and
  `SettingsTests`, with the new purchases line.
- **Only Carl's TestFlight purchase shows** the App Store's side: the real product and price,
  Apple's sheet, a purchase with his own Apple Account, and the purchase back after a reinstall
  (docs/SETUP.md, "The app's purchase"); from 7.2, the widgets turning on.

**Trying it.** Cmd-R in Xcode buys from Snow.storekit (the scheme's Run action names it): the
product at £1.99, Apple's confirmation sheet and Restore purchase, with no App Store and no
account. If Buy answers at once with nothing, or the page says the purchase isn't available, run
on an iPhone 17 with iOS 26.2 (Xcode, Settings, Components, to download it) or on the iPhone
itself: StoreKit Test is reported broken on the iOS 26.3 to 26.5 simulators ("Settled", V2). Xcode's Debug → StoreKit → Manage Transactions approves an Ask to Buy, refunds and
deletes transactions without writing the file. A setting changed in Xcode's StoreKit editor
(Editor → Enable Ask to Buy, say) rewrites Snow.storekit, and `pnpm mobile:check` then fails: to
keep a setting, change `exportStoreKit.ts`; to try one, run `pnpm mobile:generate` afterwards,
which puts the file back. A launch with `-purchase`, `-restore` or `-unlocked` uses StoreKit's
stand-in instead and never asks StoreKit (below, "Debug hooks"): `-purchase pending`, say, shows
Ask to Buy's line with no parent.

## Phase 7.2: the widgets

The widgets (spec section 11): one kind, `SnowForecast`, in five families, the small and medium on
the Home Screen and the round, rectangular and inline ones on the Lock Screen, locked until the
purchase of phase 7.1, each planned from the answer the app saved or one it asks for itself, for
the place and units chosen in the app. Carl cut 7.3 (the upgrade page's live previews and the
composed widget screenshot) and 7.4 (the App Shortcut) to 1.1. DECISIONS has each decision and why
("The widgets in the iPhone app (phase 7.2)").

- **What shows.** Every family draws one face, `WidgetFace` (IsItLogic), as plain values. The
  gallery's sample, durham-tomorrow at 6:05pm, reads:
  - **Small** (StandBy shows it too): the place ("Durham"), the slot ("Today", or "Tomorrow" from
    6pm at the place), the glyph and the answer word ("Yes.") in the answer font, the band with the
    amount when it snows ("Snow · 4cm") or why not ("Too warm"), then one dot for each forecast
    with data, filled for each that expects snow and hollow for the rest. When the text is too big
    for all of it, the slot and the dots go first, then the place. With no middle day, the glyph
    alone and "Not available right now.".
  - **Medium:** the small's face on the left; on the right, Now ("Now", "No. Too warm for snow.")
    in up to two lines, then every day after the middle day that fits whole below it (all six,
    or the week's seven with no middle day, down to none), each its short name, a small glyph,
    its band and its dots; fewer at larger text sizes. No word is cut short: a band's label
    shrinks a little, then wraps at its words, and the dots go from every row at once where
    keeping them would cost a row. At the accessibility sizes Now takes the lines it needs,
    shrinking to half, and drops its "Now" before its words.
  - **Circular:** the system's capacity gauge, filled for the forecasts that expect snow of those
    with data, with the glyph in the middle; the glyph alone on the system's background without
    counts.
  - **Rectangular:** "Tomorrow · Yes.", "Snow · 4cm", "6 of 6 forecasts".
  - **Inline:** "Tomorrow: Snow".
  - **Locked** (`unlock.v1` says not bought, and StoreKit holds nothing verified): "Open the app to
    turn on widgets." with the nosnow glyph and palette, no price and no buy; a tap opens the
    upgrade sheet (`willitsnow://upgrade`). **Stale** (no answer for this place and units, or none
    with an hour to show): "No recent forecast. Open the app to refresh.", never an old hour; a
    tap opens Today. Neither has a `Link`.
  - **Taps:** one `widgetURL` a widget, `willitsnow://view/today` (the middle view, Today or
    Tomorrow), and the medium's right half is a `Link` to `willitsnow://view/week`. The links
    come from client `routeLink`, `DeepLink.link` in Swift, the inverse of `parseDeepLink`.
  - **VoiceOver:** each tap target is one element reading one sentence: "Durham. Tomorrow: Yes.
    Snow, 4cm. 6 of 6 forecasts expect snow." (the small, the medium's left half), the same
    without the place (rectangular), "Tomorrow: 6 of 6 forecasts expect snow." (circular), and on
    the medium's right half "Now: No. Too warm for snow." then each row as the app's week page
    reads it ("Friday, 8cm, heavy snow, 6 of 6 forecasts expect snow"). A "·" is shown, never
    read; the visible "Now" is hidden from VoiceOver, as its line already says it. No
    accessibility identifiers.
  - **Type:** the Home Screen families in Bricolage, on a scale of their own (`WidgetType`: the
    place, the slot, the answer, the detail, Now, the rows, the message), each relative to a text
    style, Large to AX5, a face up under Bold Text (`BrandFont.bolder`, the app's rule); no line
    shrinks under 11 points. The Lock Screen families in the system's text styles.
  - **Colour:** the band's palette, its gradient and glow as the app's pages draw them
    (`PaletteBackground`), in `containerBackground(for: .widget)` in every family and state,
    which WidgetKit removes wherever it doesn't draw it. The ink is the palette's in full colour
    with the palette behind it, and opaque white elsewhere (StandBy, CarPlay, a tinted or clear
    Home Screen, the Lock Screen), which WidgetKit tints or maps; the glyph and the answer word
    take the tint (`widgetAccentable()`). Hierarchy is by face and size, never by opacity.
  - **The gallery:** "Snow forecast", "Today's snow answer, then tomorrow's from 6pm.", and the
    sample in the small and medium, whatever the purchase; the placeholder is the same sample,
    which WidgetKit draws redacted. The sample is the TypeScript face, generated as JSON into
    `IsItModel/Generated/WidgetSample.swift` and decoded once (`WidgetFace.sample`).
- **The timeline** (`WidgetTimeline`, IsItState), each time WidgetKit asks (`plan(at:)`):
  1. StoreKit's entitlements are asked for first, beside everything else, and waited for 2 s at
     most (`Constants.Purchase.widgetCheckMs`).
  2. `unlock.v1` saying unlocked unlocks. Otherwise a verified, unrevoked transaction for the
     product does (`PurchaseRules.owned`), and anything else locks: one locked entry, no request.
  3. The saved answer, with no request, when it is for the place (`Target.key`, byte for byte) in
     the units chosen (any, while none is), saved under an hour ago (`WIDGET.reuseMinutes`) and not
     after now, with an hour still to show (`WidgetSource.reuses`).
  4. Otherwise one request, built as the app's (`APIClient.request(for:units:)`), one per query
     in the extension's process (`FetchGate.shared`), so widgets reloaded together ask once, and
     stopped at 12 s twice over: the widget's own `URLSession` limits the whole request
     (`timeoutIntervalForResource`), and `Deadline` stops waiting. What it fetched is saved for the
     app once, only while `place.v1` and `units.v1` still say what it asked for, and never over an
     answer for the place saved after it.
  5. If the request fails (offline, 429, an error, the limit): the saved answer only when it is for
     the same place and units, however old (`WidgetSource.fallsBack`), else the stale face. Never
     another place's answer under this place's name.
  6. `WidgetPlanner` plans the entries (now, each hour ahead, which brings 6pm and midnight, then
     stale at `usableUntil`) and the reload, and `WidgetFace` faces each entry.
  7. One log line (below, "The purchase in the widget").

  With no readable `unlock.v1` and the purchase in StoreKit, steps 3 to 5 are only the answer saved
  for the place, however old, else the stale face, and never a request: the flag is missing exactly
  when the App Group can't be read yet (before the phone's first unlock since it started), when the
  place reads as approximate IP location, and a request would show the network's town. Every
  state, and how it is left:

  | State                | Reached when                                                                                                  | Reload                                                                                          | Left by                                                                                                         |
  | -------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
  | ok                   | unlocked, and an answer with an hour now (reused, fetched or saved)                                           | 4 h after the answer was fetched, or at `usableUntil` if sooner; in an hour if both have passed | the next entry (each hour ahead, 6pm, midnight), the stale entry at `usableUntil`, the reload, the app's reload |
  | stale                | unlocked, and no answer for this place and units, none with an hour now, or past `usableUntil`                | in an hour                                                                                      | the reload, which asks again; the app's reload                                                                  |
  | locked               | `unlock.v1` says locked, and StoreKit holds nothing verified for the product, or is late                      | never                                                                                           | the app's reload when `unlock.v1` changes (a purchase, a restore, a family's share)                             |
  | locked, no flag      | no readable `unlock.v1`, and StoreKit holds nothing verified, or is late                                      | in an hour                                                                                      | the reload; the app's first check                                                                               |
  | ok or stale, no flag | no readable `unlock.v1`, and StoreKit holds the purchase: the saved answer for the place it reads, else stale | the planner's                                                                                   | the reload; the app's check, as `unlock.v1` from nothing to unlocked reloads                                    |

  The budget: a widget asks the server once every 4 hours (`WIDGET.refreshHours`) while the server
  answers, six times a day, and once an hour (`WIDGET.retryMinutes`) while it fails or has nothing
  usable, 24 times a day at most, against Apple's 40 to 70 reloads; the hours between are entries,
  not reloads, and several widgets on one phone share a request (one gate in a process) or the
  answer saved within the hour (across processes). The app adds no reload of its own: it already
  reloads every timeline after each answer it saves and each change of `unlock.v1`, and a place or
  units change is followed by its fetch, whose save reloads. The widget never reloads timelines
  itself.

- **The purchase in the widget** (decisions 1 to 3). The widget trusts what it can see, and never
  locks on its own: a verified entitlement it can see unlocks, but an empty, late, unverified or
  revoked answer never locks a phone whose `unlock.v1` says unlocked, as an empty answer may only
  mean the extension can't see the purchase (V3, below, "Settled"; 7.1's rule). Locking is the
  app's, through `unlock.v1`, which `PurchaseModel` rewrites after every check and follows with a
  reload of every timeline when it changes. StoreKit is asked on every timeline, even with the flag
  unlocked, when its answer changes nothing and is only logged, so a phone that has bought still
  says whether the extension sees the purchase; a payer's timeline waits for it only while it is
  slower than the answer, never more than 2 s. With no readable flag, as after a restart, a locked
  widget looks again within the hour instead of waiting for the app. A refund the app has locked can
  stay unlocked in the widget until its next reload, at most 4 hours, while StoreKit still shows the
  transaction. The log line, one a timeline at `.notice` in every build (TestFlight's are Release),
  worded by `WidgetTimeline.Plan.logLine` and tested on Linux, names no place, key, URL or
  transaction; one reads:

  ```
  family=small width=170 height=170 unlock=flag storekit=answered:1 source=reused entries=8 font=ok
  ```

- **IsItCore, tested on Linux:** IsItLogic's `WidgetSource` (`reuses`, `fallsBack`),
  `WidgetFace` (with `WidgetFace.sample`), `DeepLink.link(_:)`, `HomePage.spokenWeekDay` (a week
  row's sentence, shared with the app's week page) and `BrandFont.bolder` (moved from IsItUI, so
  the app and the widget step up by one rule); IsItState's `WidgetTimeline` (`plan(at:)`,
  `answer(at:)`, the fetch-or-saved half with no purchase check, `saved(at:)`, `sample(at:)`, the
  `WidgetStore` and `EntitlementReader` it reads through), `Deadline.value(within:_:)` (a value
  that must come in time, or nil, whatever the work does) and `FetchGate` (one request per query
  at a time; `callers(for:)` is the tests' only way to know a second caller has joined); and the
  generated `AppCopy` templates, `Constants.Purchase.widgetCheckMs` and `WidgetSample`.
- **IsItKit:** IsItServices' `WidgetServices.swift`: `SharedStore` as the widget's store, the
  same defaults and file the app writes (the answer saved `.atomic` with the default protection,
  never complete file protection, so the Lock Screen widgets can read it while the phone is
  locked); `StoreKitEntitlements` (`StoreKitFacts.entitlements()`, reading only);
  `URLSessionTransport.widgetSession()` (section 4's settings and the 12 s resource limit); and
  `WidgetTimeline.live(in:)`, the extension's factory: the App Group with no fallback, the
  bundle's `IsItAPIOrigin`, one session a process and the process's one gate. IsItWidgetUI, which
  now links IsItState: `ForecastProvider` (the placeholder and the gallery, the sample; any other
  snapshot, `saved(at:)`, with no request and no StoreKit; a timeline, `plan(at:)` and its log
  line; without the group, one stale entry; `ForecastProvider.timeline(_:)` maps a plan to what
  WidgetKit is given), `ForecastEntry`, `ForecastEntryView` (the only view that reads WidgetKit's
  environment, as a `WidgetLook`), `ForecastWidgetView(face:look:art:)` and
  `ForecastAnswerView(face:look:art:)`, which read none of it, so a snapshot or the app (7.3)
  draws them as the widget does, `WidgetLook`, `WidgetArt` (the glyphs and palettes as a value,
  given by the extension, so IsItWidgetUI stays topic-free, as IsItUI is), `PaletteBackground`,
  and the families' faces, the dots and the type scale, internal. `SavedAnswer.swift`, the
  skeleton's provider and view, is gone.
- **The extension** (`Apps/Snow/Widgets`): `WillItSnowWidgets.swift` is the bundle, the
  configuration (`SnowForecast`, the five families, the gallery's name and description from
  `AppCopy`, the snow art) and one call, `WidgetTimeline.live(in: .main)`. Its Info.plist names
  `IsItAPIOrigin` = `$(API_ORIGIN)`, the server the app asks (a Debug app's `-apiOrigin` never
  reaches it), and lists all four fonts in `UIAppFonts`; its privacy manifest declares Coarse
  Location, linked, not tracking, for App Functionality, as the app's does, since it sends the
  rounded place. Its entitlements are unchanged: the App Group only. It has no debug hook. The
  widget and the unit tests now link IsItLogic and IsItState as well (`project.yml`).
- **The words.** Nine templates in packages/mobile `appCopy.ts` (`widgetSlotAnswer`,
  `widgetSlotLine`, `widgetBandAmount` and its spoken twin, `widgetHeading`, `widgetSentence`,
  `widgetSentenceShort`, `widgetGauge`, `widgetNow`), filled only with core's and the server's
  words; no widget string names a price or a purchase. Every family's words are built by a
  TypeScript reference, packages/mobile `widgetFace.ts`, whose golden vectors (`widgetFace.json`,
  36 faces: every fixture's first entry, aberdeen-snow's whole timeline, durham-tomorrow either
  side of 6pm, locked, stale, a row without counts, no middle day, inches) `WidgetFace.swift` is
  checked against, as `page.ts` is for `HomePage`. The week's rows read the app's own
  `weekRowLabel` templates, so cut-list item 2 would remove two blocks (`WidgetFace.week`,
  `WeekRowView`) and no words.

**Its tests.** On Linux (`swift test` in IsItCore): the `widgetSource.json`, `widgetFace.json` and
`links.json` ports; `WidgetFaceTests` (no dots without forecasts, "1 of 6 forecasts expects snow.",
the locked and stale faces, every link parsing to its view, no "·" read, every sentence ending,
snow only once the answer's own words are taken out, the rows read as the app's week page reads
them), `WidgetSampleTests` (the sample is the face the Swift builds from the fixture) and
`BrandFaceTests`; `DeadlineTests`, `FetchGateTests` and `WidgetTimelineTests` (the purchase,
reuse, the request, the guarded save, the fallback, two widgets at once asking and saving once,
the query the app's, the place named as the app names it, the log line, the snapshot and the
sample), each suite under a one-minute limit and each `WidgetTimeline` with a `FetchGate` of its
own, as Swift Testing runs them in parallel. In packages/mobile: the copy, the face
(`widgetFace.test.ts`), the sample, the vectors, the client's `widgetReuses`, `widgetFallsBack`
and `routeLink`, `privacyApis.test.ts` (no shipped Swift names a file-timestamp or boot-time API,
spec 15.1), `widgetSizes.test.ts` (the snapshots' small and medium sizes, and the narrow medium's,
are the contrast gate's), and the widget's contrast gate in `brandColours.test.ts`: the ink passes
4.5:1 over the whole widget at the HIG's sizes for 430- and 393-wide iPhones, glow and all (the
lowest is maybesnow's small, 4.96). On the macOS CI:

- **The Unit plan:** `WidgetSnapshotTests` draws 110 tiles with `ImageRenderer` at 3x, each
  `ForecastWidgetView` faced by the real code: every band (durham-tomorrow's tomorrow re-banded in
  the test) in every family, the Home Screen families in full colour, accented and StandBy, the Lock
  Screen ones vibrant; locked and stale in every family and mode; ten fixture moments, and
  durham-tomorrow at 6:05pm on the Lock Screen; AX3; the gallery and the placeholder; the medium
  with its `Link`; and the medium with all six days after the middle day (`widget-medium-week-…`):
  at XXXL, in its `Link` at Large and XXXL, at the 393-wide size at both, and with "Snow possible"
  first at XXXL and 393-wide. They are named `widget-<family>-<case>-<mode>`, with `-xxxl` at XXXL,
  `-ax3` at AX3, `-narrow` at the 393-wide size and `-link` with the `Link` (say
  `widget-medium-snow-ok-full`, `widget-small-locked-accented`, `widget-medium-week-full-narrow`),
  at the HIG's sizes for 430-wide iPhones (small 170, medium 364 by 170, circular 76, rectangular
  172 by 76, inline 257 by 26; the narrow medium 338 by 158), and land on the contact sheet
  grouped by family. The accented, StandBy and vibrant tiles are approximations, over mid grey
  (0x8e8e93), black and 0x1c1c1e, since only WidgetKit draws the real ones; they are review
  artefacts, not pixel gates. `AppGroupTests` (V1) runs the real `WidgetTimeline` over the real App
  Group, with a server that never answers and StoreKit holding nothing: the answer the app saved is
  reused, each hour ahead then stale, locked until `unlock.v1` says otherwise, and another store
  version's file ignored. `WidgetBundleTests` opens the embedded appex: its `IsItAPIOrigin` the
  app's and https, its App Group, all four fonts listed, carried and named, SnowKit's glyph
  catalogue in it, its manifest's Coarse Location, a WidgetKit extension, and
  `WidgetTimeline.live(in:)` built from its own plist; and the factory over a plist of its own,
  naming another origin than the app's: its client asks that origin, its gate is `FetchGate.shared`,
  and without `IsItAppGroup` there is no timeline. `WidgetProviderTests`: a locked plan is never
  reloaded, an answer's reloads when its planner says, and every family and rendering mode has its
  look.
- **The UI plan:** `WidgetLinkTests` opens `willitsnow://view/week`, `view/today` and `view/now`
  as a tapped widget does, and checks each lands: the heading, the tab selected, and the page on
  screen (`pageOffScreen`). XCUITest can't add a widget to the Home Screen, so nothing tests the
  widget there.
- **The archive checks** (`archive-check`, and before each upload): both bundles carry all four
  fonts and name each in `UIAppFonts`, the widget carries SnowKit's glyphs at its top level, its
  `IsItAPIOrigin` is https and the app's, and its manifest declares Coarse Location.
- **Only Carl's iPhone shows** WidgetKit's own drawing (the tint, the glass, the removed
  backgrounds, the redaction), the extension's process (its fonts, its StoreKit, V3, its network
  and memory), the Lock Screen, StandBy and the gallery (docs/SETUP.md, "The app's widgets").

**Trying it.** Run the app once on the simulator (a widget shows in the gallery only once its app
has run), then touch and hold the Home Screen, tap Edit, then Add Widget, and search for "will it
snow". It is locked: buy with Cmd-R from Snow.storekit (above, "Phase 7.1: the purchase", "Trying
it"), which writes `unlock.v1` through the app's own `PurchaseModel`, and the widgets follow within
seconds. The widget's own StoreKit check sees nothing on the simulator, as Xcode's StoreKit
environment is the app's bundle's; and under `-uitest`, `-unlocked`, `-purchase` or `-restore`
StoreKit's stand-in never writes `unlock.v1`, so the widget stays locked. The widget asks the
server for the app's place itself, whatever fixture the app was launched with. Settings →
Developer → WidgetKit Developer Mode lifts the reload budget while trying it. Each timeline's line
is in Console.app on a Mac with the iPhone attached (choose the iPhone, press Start streaming, then
search `subsystem:today.willitsnow.app.widgets`, and remove and add a widget, or pull to refresh in
the app, for a new timeline), and on the simulator in
`xcrun simctl spawn booted log stream --predicate 'subsystem == "today.willitsnow.app.widgets"'`.

## Phases 8.1 and 8.2: notifications

Notifications in the app (spec sections 12.1 to 12.4, 10.2 item 5 and 10.6), on the server merged
before them (packages/server `devices.ts` and `alerts.ts`; DECISIONS, the "Notifications"
sections): a notification the evening before snow is likely at a place, and on the day, which
the server sends, free for everyone. One pull request in two commits: 8.1, everything but Your
privacy's live data; 8.2, what Your privacy shows is kept, and "Turn off notifications and delete
my data". Carl left the open points to the agents ("Whatever you think is best boss"); DECISIONS
has each answer and why ("The iPhone app's notifications (phases 8.1 and 8.2)"). Phase 8.4a
(below, "Phase 8.4a: notifications where you are") made the notification follow where you are,
never a place chosen or on screen; each part of this section it changed says so. Phase 8.4b
(below, "Phase 8.4b: notifications for saved places") added a bell on each saved place, with the
one-off purchase.

- **What shows: Settings → Notifications.** A card under "Notifications" (`notifications-heading`),
  between the units and the upgrade card, in Settings' own parts:
  - **The gate** has gone in phase 8.4a. 8.1 showed, at approximate location, "Choose a place for
    notifications: use your location or search for a town." with "Use my location" and "Search" in
    the switches' place. Where you are is always a place now, so the switches always show.
  - **The switches:** "Evening before (about 6pm)" and "On the day (about 7am)", each with its
    note, then "Also when snow is possible" only while one of them is on (`notify-evening`,
    `notify-morning`, `notify-possible`; value "0" or "1"). "Possible" can't be turned on alone
    and goes off with the second of the others, so `alerts.v2` says what the server holds. Each
    is a SwiftUI `Toggle` the app draws itself (`SheetSwitchStyle`): the whole row is one button,
    and the switch a capsule in the content surface's own colours, ink with a card knob when on,
    a hairline edge round the wash with a card knob when off. Not UIKit's switch: VoiceOver still
    reads the label, the note and on or off, and every pixel is one the contrast proof knows.
  - **Permission denied:** "Notifications are off for this app in Settings." (`notify-notice`),
    "Open Settings" first (`notify-open-settings`, iOS Settings' page for the app's
    notifications), and every switch off.
  - **Where you are** (`notify-here`), since phase 8.4a in the place row's stead: its town and how
    it was found, under the line that says what is kept (`notify-here-kept`), pushing the "Where you
    are" page (below, "Phase 8.4a"). 8.1's "Place" row (`notify-place`) and its "Notification place"
    page, with the place on screen to choose and "Follows your location each time you open the
    app.", have gone.
  - **The test row**, while evening or morning is on: "Send a test notification" (`notify-test`),
    its result its detail and value: "Sent. It should arrive in a few seconds."; "Our server
    isn't sending notifications yet, so nothing was sent." (production's dry run); "You can send
    3 test notifications an hour. Try again later."; "Nothing is sent from 9pm to 7am. Try again
    after 7am." (since phase 8.4b, judged by the iPhone's clock; 8.1's said "at the place");
    "Sent 2 test notifications. They should arrive in a few seconds." with a saved place's bell on
    (phase 8.4b); and "Couldn't send a test notification. Try again later." for anything else. One at a time; without a registration it syncs first.
  - **The status line** (`notify-status`): the server's own words for a place it refuses (400
    `bad_location`; since phase 8.4a, a set it couldn't locate), or "Couldn't save your
    notification choices. The app will try again when you next open it." for a change that
    didn't reach it. A failed heartbeat says nothing.
  - **The footer** ("These are forecasts, not official warnings. …", `notify-footer`), then, for a
    UK place, "Met Office warnings" (`notify-warnings`), which opens the Met Office's warnings page
    in Safari (`Constants.Outbound.metOfficeWarnings`). Since phase 8.4a, where you are is in the UK
    when the server's answer gives its country as GB (8.1 read a city slug's last part, a searched
    place's country, or for the phone's cell the answer on screen's).
- **What shows: the Today card** (`notification-card`), on the middle page (Today and Tomorrow
  alike), only with an answer, above the upgrade row, in the free and paid versions alike: a chip
  card with its line (`card-line`) and bordered chip buttons, side by side, wrapping onto the next
  line when one doesn't fit, as the footer's links do (`FlowLayout`: each button laid out once,
  never a `ViewThatFits` of copies, which failed the audits on PR #43's first macOS run). Since
  phase 8.4a it shows only while the screen shows where you are, in three kinds (below, "Phase
  8.4a"): the offer for where you are, with the line that says what is kept, "Turn on" and "Not
  now"; refused this session ("Notifications are off for this app in Settings.", "Open Settings" and
  "Not now"); and turned on this session ("Done. …", with no buttons, naming the town once the
  server has). 8.1's offer for the place on screen ("…likely here.") and its kind for approximate
  location ("Use my location", "Search") have gone. "Turn on" turns the evening notification on for
  where you are. The card goes for good after "Not now", after the first switch turned on anywhere,
  and after "Turn off notifications and delete my data"; it never shows while permission is denied
  unless this session's "Turn on" was refused, and once they are allowed in iOS Settings after that
  refusal it offers "Turn on" again. A line that comes after a tap is said to VoiceOver once.
- **What shows: Your privacy (8.2).** While registered, "What we keep for notifications" comes
  first, under the title (`kept-heading`), so the page's audit at its top sees it whole: "ID
  b8465956" (the registration ID's first 8 characters, enough for the server's `ALERTS_FORCE_IDS`),
  "Where you are: Leeds, Europe/London" (since phase 8.4a; 8.1's was "Leeds, Europe/London"), "Snow
  units: cm", then each switch on in its Settings words (`kept-line-<n>`), all from `alertSync.v2`
  (8.1's `alertSync.v1`). "Turn off notifications and delete my data" (`delete-my-data`) deletes the
  server's record with the token last sent, turns every switch off, forgets the place (since 8.4a,
  the phone's cell kept for where you are; since 8.4b, the saved places' bells) and puts the card
  away, then says "Notifications are off. We've deleted your notification token, places, units and
  choices." where the block was
  (`delete-status`, said to VoiceOver once). Offline it says "Couldn't reach our server, so nothing
  is deleted yet. The app will try again when you next open it." above the block, which stays, since
  the server still holds the record; the next sync deletes it, and the line then says it is done. No
  confirmation: turning notifications on again undoes it. The privacy line, and the website's
  notice, now name "your notification choices" among what the app keeps on the phone.
- **When it syncs** (`NotificationsModel`, IsItState), at spec 12.2's moments: launch step 6
  (`syncAlerts`, which hands the place on screen and its units to the model and returns at once, so
  a pending route never waits on a PUT), a place chosen in the picker and a change of units (the
  same hook), every `.active`, a token arriving, Settings or the place page appearing, and each
  change in Settings, the card or Your privacy. Each sync runs `AlertSync.action` against what
  `alertSync.v2` says the server holds: a PUT when the fingerprint differs or the last is 7 days old
  (the heartbeat); a DELETE when evening and morning are both off or the permission is denied;
  nothing while there is no token or no units yet (8.1 also waited for a place; phase 8.4a, below,
  has always one, and adds the hourly refresh while it is approximate and the wait after a set the
  server couldn't locate). Syncs are single-flight: a change made while a request is out is sent
  once it is answered, all such changes together. A 429 (the server's one write a minute) is tried
  once more at its `Retry-After`, or after 60 seconds without a usable one; a 204 to a PUT forgets
  the registration. After an offline first launch, whose step 6 had no units, they come with
  Settings' or the card's place on screen, and the first answer that chooses them (`AppModel.load`)
  syncs again.
- **What is kept**, in the app's own defaults (not the App Group), written only by
  `NotificationsModel`: since phase 8.4a `alerts.v2` and `alertSync.v2` (below, "Phase 8.4a"), where
  8.1 kept `alerts.v1`, `{ v: 1, prefs, place? }`, the switches and a place chosen and fixed or
  following the phone, and `alertSync.v1`, the version 1 registration; and `ui.alertCard`, whether
  the card was put away. `alertSync.v2` is the registration the server holds as the last PUT it
  answered made it (the units from what was sent, as the answer has none). Another version, 8.1's
  included, or anything unreadable, is "off, nothing kept". The token kept is only to name the
  server's record, for a DELETE or a test: a fresh token that differs is simply sent, and the old
  record isn't deleted, since on a phone restored from another's backup the old token is that
  phone's, still in use; Apple's 410 or the server's 90 days clean it up.
- **The place**, 8.1's (first turned on, the place on screen, chosen and fixed, or the phone's
  location, followed; approximate location never a place), has gone in phase 8.4a: notifications are
  for where you are (below).
- **Permission and the token.** Asked only at the first switch turned on, in Settings or by the
  card's "Turn on", with `[.alert, .sound, .providesAppNotificationSettings]` (the third adds the
  "Notification Settings" link to iOS Settings' page for the app, which opens Settings →
  Notifications). Read again at the start, as Settings or the place page appears, and at every
  `.active`. Found denied: every switch off, and the server's record deleted. Found "not
  determined" with a switch on or a registration kept (only a backup restored from another phone
  can do that): the switches off and the registration forgotten on the phone only, with no
  request, since its token isn't this phone's. A status iOS adds later counts as allowed, which
  changes nothing. `registerForRemoteNotifications()` runs at the start, at every `.active` and
  after the prompt is allowed, while a switch is on and the permission allows; no token yet is a
  resting state, never a spinner.
- **The centre's delegate** (`NotificationDelegate`, IsItNotifications) is a plain `NSObject`, not
  main-actor, with the completion-handler forms of `willPresent`, `didReceive` and
  `openSettingsFor`, never the async ones: an async `didReceive` on a type that isn't main-actor
  ends off the main thread and crashes a tap ("Call must be made on main thread"), and a
  main-actor one doesn't compile in Swift 6. Each copies the payload out as JSON `Data`, then in
  one main-actor task posts it and calls the system's completion handler there. In the
  foreground it shows the banner, the list and the sound, and the app refetches quietly.
  `AppDelegate`, through `@UIApplicationDelegateAdaptor`, sets it in
  `application(_:willFinishLaunchingWithOptions:)`, so a cold-start tap is never missed, and owns
  it, as the centre holds it weakly. It and the token's two callbacks post to
  `NotificationInbox.shared` (IsItState), which keeps every event, in order, until
  `WillItSnowApp.init` attaches the handler (`NotificationDispatch.handle`), so the order of
  `App.init` and the adaptor never matters.
- **The push environment.** A registration names its APNs environment from the Info.plist's
  `IsItPushEnvironment` = `$(PUSH_ENV)`: `sandbox` in Debug and `production` in Release
  (Snow.xcconfig), production when absent. `check-archive.sh` fails a Release archive that says
  anything else. The entitlements are unchanged: the App Store export's profile writes
  `aps-environment` production. **Run Debug, not Release, on a phone to test notifications**: a
  Release build run from Xcode is signed for the sandbox but says production, and the server
  deletes it at its first push (APNs answers `BadDeviceToken`).
- **Taps.** `NotificationRouter.route(json:now:zones:)` (IsItLogic) reads the payload's JSON with
  `DeepLink.route(payload:placeNow:)`, taking each known place's time zone by its `Target.key`:
  the registration's, then the answer on screen's. A place in neither is taken as current, as the
  client rule says. A payload that routes nowhere opens the app as usual, with one `Logger.debug`
  line in Debug builds, which holds none of the payload. A route goes through `AppModel.open(_:)`,
  which holds a cold-start tap until the launch has finished, then puts a `.place` route on
  screen itself: another place is chosen as the picker chooses one (`place.v1`, the recents, a
  fetch, the notifications' sync); the place on screen only gets its view; and a route with no
  view opens on the place's view for the time of day. A route that comes while the app is still
  away keeps its view over the return's reset (`routedWhileAway`: the shared commit's guard for
  `.view` routes, extended to `.place`). `willitsnow://settings/notifications` and iOS Settings'
  link open Settings.
- **IsItCore, tested on Linux:** IsItLogic's `AlertSwitch`, `AlertPlace`, `AlertSettings`
  (`alerts.v1`), `OnScreen` and `AlertSync.firstPlace`, `.following`, `.setting` and
  `.country(of:onScreen:)`; `DeviceResponse`, `DeviceIdentity`, `AlertRegistration`
  (`alertSync.v1`), `AlertSync.SyncReply` and `.TestOutcome` with `syncReply` and `testOutcome`, and
  `PushToken.hex`; the presenters `NotificationSettings` (from `NotificationsState`),
  `NotificationPlacePage` with `PlaceChoice`, `NotificationCard`, and Your privacy's
  `YourPrivacy.keptLines` and `.deleteStatus` (8.2); `NotificationRouter`; `SettingsScreen`'s eleven
  new icons, `SettingsPage.notificationPlace` and `Action.notification`; and `AppVersion.wire`.
  (Phase 8.4a replaced `AlertPlace`, `OnScreen`, `firstPlace`, `.following`,
  `.country(of:onScreen:)` and `PlaceChoice`: below.) IsItState's `NotificationsModel`, behind
  `NotificationPlatform` (the system) and `NotificationStore` (`MemoryNotificationStore` in the
  tests); `NotificationInbox` and `NotificationDispatch`; `APIClient.registerDevice`,
  `forgetDevice(token:)` and `testDevice(token:)` (`Accept` and `Content-Type: application/json`, 12
  seconds, and a thrown error is a failure, logged nowhere); `HTTPTransport.send`, with
  `HTTPMethod`, a request's body and a response's `Retry-After`; and AppModel's `.place` routes.
- **IsItNotifications** (IsItKit, the app's alone: the widget links IsItServices, and
  `registerForRemoteNotifications` is unavailable in an extension): `UserNotificationsPlatform`
  (the permission, asked only by `requestPermission()`, and the registration),
  `NotificationDelegate`, and `NotificationDefaults` (the three keys).
- **IsItUI and IsItServices:** `NotificationsSection`, `NotificationPlaceView` (its row was
  `NotificationPlaceRow`, `HereRowView` since phase 8.4a), `NotificationCardView` and
  `NotificationActions`; `SheetSwitchStyle`, `RowLabel`'s `value` and `SheetSection`'s `headerID`;
  `SettingsView` and `SettingsActions` taking the notifications; and `YourPrivacyView`'s kept block
  and delete line (8.2). `URLSessionTransport.send` sends a request's method and body and reads its
  `Retry-After`; `configuration()`, `session()` and `init(session:)` are unchanged.
- **The app:** `WillItSnowApp` makes `NotificationsModel` over `UserNotificationsPlatform` (or a
  Debug build's stand-in) and `NotificationDefaults`, attaches the inbox's handler, and calls
  `becameActive()` at every `.active`; `AppDelegate` is the only adaptor; `LiveHooks` fills step 6
  and the settings route; `HomeView` draws the card and opens every sheet through `present(_:)`,
  which, from one presentation to another, closes the first and opens the next once it has gone
  (`onDismiss`), so 8.1's Settings "Search" (gone in phase 8.4a) closed Settings and then opened the
  picker, never two presentations changing in one transaction; `SettingsSheet` builds the section,
  the place page and Your privacy from the model.
- **The words** are `AppCopy`'s, from packages/mobile `appCopy.ts`: new in 8.1
  `notifyPlaceTitle`, `notifyLocationDenied`, `notifyLocationUnavailable`, `testDryRun`,
  `testQuiet`, `notifyNotSaved` and `cardOn`; in 8.2 `keptID`, `keptPlace`, `keptUnits`,
  `deleteDone` and `deleteNotYet`, and `privacyForecast` changed; core's `yourLocation`
  (`CoreCopy`) and `MET_OFFICE_WARNINGS` (`Constants.Outbound.metOfficeWarnings`). `copy.test.ts`
  holds `testLimited` to the server's 3 tests an hour and `testQuiet` to its 409's words. Nothing
  a user reads says "alert", "warning" or "danger", the footer's "not official warnings" and the
  Met Office link apart.
- **The fixtures**, written by the server's own code (packages/mobile `deviceFixtures.ts`): the
  devices replies in `Fixtures/Devices` (`put-leeds`, `put-durham`, `put-device`, `put-kathmandu`,
  `put-bad-place`, `put-twice`, `delete`, the seven `test-*` answers and `rate-limited`) and the
  server's notification payloads in `Fixtures/Payloads` (`durham-evening`, `durham-old`,
  `malformed`, and `evening.apns` for `simctl push`). Their token is a fixture's, never a real one.
  Phase 8.4a removed `put-durham`, `put-device`, `put-kathmandu` and `put-bad-place`, which nothing
  read once Swift read version 2, and kept the rest byte for byte; the stub answers from the
  version 2 ones (below).

**Its tests.** On Linux (`swift test` in IsItCore): the five new ports of `alerts.json`;
`AlertRecordsTests` (the keys' round trips and defaults, every devices fixture mapped as the client
maps it, the token's hex, the country, the wire version); `NotificationSettingsTests`,
`NotificationCardTests` and `NotificationRouterTests`; `InfoPagesTests` (the kept lines and the
delete's words, 8.2); `NotificationsModelTests` (the launch, the switches, the place, the sync, the
test, the card and Your privacy, with a gate for each call in every race: a token during the
start, two taps asking once, a late fix, a delete while a PUT is out, one test at a time),
`NotificationInboxTests`, `NotificationDispatchTests`, `DevicesAPITests` and `AppModelTests`'
`.place` routes. In packages/mobile: the copy, the constants, the devices fixtures made again and
compared whole, every city slug ending in its country (the "UK places" rule), no 64-digit hex
literal in DebugHooks.swift, and the privacy line paired with the website's notice; packages/client
`alerts.test.ts` at 100% coverage; and the server's contract test, which reads its real replies
through `syncReply` and `testOutcome`. On the macOS CI:

- **The Unit plan:** `NotificationTests` (the centre's delegate set before the launch finishes,
  compared by name, since the test bundle holds its own copy of IsItNotifications' classes; the
  delegate's JSON reaching the router as the dictionary itself would; a payload JSON can't hold
  routing nowhere; every authorisation status, and one to come; the options; a Debug build in the
  sandbox) and `InfoPlistTests` (no background modes; the privacy manifest's Coarse Location and
  Device ID).
- **The UI plan** (as 8.1 left it; phase 8.4a re-pointed the gate's, the place page's and the card's
  tests and halved the card's audits, below): `NotificationsTests`, ten tests over the stand-in: the
  gate; turning on, the Met Office link, the test and, 8.2's, Your privacy's kept block and its
  delete; a refused permission; denied later, so deleted at the next launch; every test result; a
  change offline; the place page and "Use my location"; the card's "Turn on"; the card at
  approximate location, and "Not now" kept over a relaunch; and a cold-start tap's route to Durham,
  a malformed one and the settings link. They audit Settings at approximate location, on and denied,
  the place page and Your privacy registered, each at its top: Settings is checked to be where it
  opened (`expectSettingsAtItsTop`), as a scrolled sheet's faded, covered text fails the contrast
  check (PR #43's first macOS run, in DECISIONS). So no audit checks the contrast of the Met Office
  warnings row, under the Debug recorder at the top, or of the "on" state's footer, cut by the
  content's foot; that run's scrolled audits checked them whole and they passed.
  `NotificationPermissionTests.testTheSystemPromptAllows` is the one test that meets the system's
  prompt, through SpringBoard; it skips, never passes, when the simulator has already allowed them.
  `HomeAuditTests` gains four card cases (leeds-dry's card for a place and the first launch's for
  approximate location, each at Large and AX3). Every older UI test launches with the card hidden
  (`-uitest`), so their home screens and audits are as they were; their taps on Settings rows under
  the new card scroll first. The new tests' gear, place button and tabs go through the gesture
  helper as the older tests' do (above, "A gesture the simulator cancelled"), and a failure after a
  gesture names `debug-cancels`.
- **The banner** (`ci/push.sh`, after the UI plan, on its simulator, where
  NotificationPermissionTests allowed notifications): `simctl push` of `evening.apns` with the app
  open on Durham, then with it closed (`notification-banner-app`, `notification-banner-home`, in the
  attachments' `Push` folder). Nothing waits a guessed time (`ci/banner.mjs`): the step waits for
  the app's own line once its answer is on screen, which also gives the notification permission
  the app reads, and fails naming it when notifications aren't allowed (and, when the line never
  comes, says so and still makes both pushes); takes the screen at rest as its baseline once two
  screenshots in a row are the same; after each push takes screenshots one after another until one
  shows a banner, each printed with its time since the push; and, over the app, then until the
  banner's band is the baseline's again, before the app is closed. A banner, over the app or on the
  Home Screen alike, is a block of rows in the top quarter of the screen each changed across most of
  its width, at least 5% of the screen tall and ending above the quarter's foot: the app's redraw
  below never counts nor hides one, and a status bar's change, a row of icons or a screen dimmed
  all over never passes. Once the step ends, however it ends, the simulator's log of it is read
  (`log show` from the step's start, a warning if it can't be) into `Push/simulator.log`, and the
  app's standard output is kept as `Push/app-stdout.txt`. The step has its own 10-minute limit, so
  a hang in it fails it and leaves the uploads to run. This makes a miss name itself; it doesn't
  explain main's (DECISIONS, "What main's run on 1d643d3 showed").
- **Only Carl's phone shows** a real token and its PUT, APNs' delivery, a tap with the app
  force-quit, the Lock Screen, iOS Settings' "Notification Settings" link, a denial made in iOS
  Settings and a followed place moving (docs/SETUP.md, "The app's notifications (phases 8.1 and
  8.2)").

**Trying it.** On the simulator, a Debug build stands in for the system under `-uitest`,
`-notifications` or `-pushToken` (below, "Debug hooks"): `-notifications allow` (the prompt allows;
`deny` refuses), `-devices limited,quiet,dryrun,gone` for the test's answers in turn, `-route
durham-evening` for a cold-start tap, `-alertCard shown` for the card under `-uitest`, `-place
place=leeds-gb` to launch on a city (the card shows only where you are, so leave it out to see
the card), and `-location ask:53.8,-1.55` for location never asked until "Use my location" (phase
8.4a). Without them, a Debug build run on the iPhone registers a real token in the sandbox with
willitsnow.today: Settings → Notifications → "Evening before (about 6pm)" → Allow → "Send a test
notification" answers with the dry run's line while production sends nothing. For a real sandbox delivery the agents can give you a deploy preview that sends;
point the Debug build at it with `-apiOrigin` and the preview's URL (below, "Debug hooks"), and
the Push Notifications Console's delivery log (developer.apple.com) shows it. Run Debug, never
Release, on a phone (above, "The push environment").

## Phase 8.4a: notifications where you are

Phase 8.4a of "Notifications where you are, and for saved places", Carl's decision of 1 November
2026: the free notification follows where the phone is, never the place on screen. Where you are
is the phone's 0.05° cell while location access is allowed and the app has a fix, otherwise
approximate: a town the server locates from the connection of the registration itself, at every
PUT (the server's version 2 devices handler, merged before). 8.1's gate at approximate location
and its place choice have gone. Saved places' bells come in phase 8.4b, with the one-off purchase;
1.0 waits for them. DECISIONS has each decision and why ("The iPhone app's notifications where you
are (phase 8.4a)").

- **What changed for the user against 8.1:** turning a switch on always works, at approximate
  location too; the place is never the one on screen; Settings says how where you are was found,
  and names the town; the Today card shows only where you are, and names the town once it is on;
  Your privacy says "Where you are: Leeds, Europe/London".
- **Settings → Notifications** (`NotificationSettings`): the switches as before; under them, "Uses
  your location if you share it, otherwise a rough place from your internet connection, which we
  keep while notifications are on." (`notify-here-kept`); then "Where you are" (`notify-here`),
  its note how it was found ("Your location", "Approximate, from your internet connection", or
  "Not found yet" once the server couldn't locate it) and its value the town the server named,
  which VoiceOver reads only as its accessibility value (`RowLabel` hides the drawn town, so it is
  said once, after the title and note). No town shows before a reply, while nothing is on, or for
  a place the server has no name for (core's "Your location" is never shown as a town). It pushes
  the "Where you are" page. Then the test row, the status line (the server's own words after a
  400 `bad_location`), the footer (8.1's), and "Met Office warnings" while where you are is in the
  UK, by the `country` the server returned for it (so only while a notification is on).
- **The "Where you are" page** (`NotificationPlacePage`, `NotificationPlaceView`): how where you are
  is found, how often it moves and how long it is kept (`notify-place-about`); where you are, as
  Settings' row says it, as a line that takes no tap (`notify-place-here`); "Use my location"
  (`notify-place-my-location`) while location access was never asked, or this session's tap found no
  fix, which asks for location only at its tap, then takes one fix, and stays, busy and taking no
  tap, while it looks, though access is allowed by then; "Couldn't find your location. Try again."
  when no fix comes, and "Location access is off for this app in Settings." with Open Settings while
  it is off (`notify-place-problem`, `notify-place-open-settings`); nothing to do while it is
  allowed. Once a tap there has where you are follow the phone (its line changed), the page goes
  back to Settings by itself; access allowed alone isn't enough, as the fix comes after it. A line
  that comes after a tap is said to VoiceOver once.
- **The Today card** (`NotificationCard.card(_:)`): only while the screen shows where you are,
  approximate location or the phone's own point in where you are's cell, never a city's or a
  searched place's page, nor an older point of the phone's, a recent place's or a notification's
  (`NotificationsState.showsHere`, from `NotificationCard.showsHere(_:here:)`, which the model
  keeps in step with the place on screen and where you are). `AppModel` tells the notifications
  of every new place on screen, a place under "Nearby:" and a city gone for approximate location
  included (`select(_:)`, before its answer, and `failed`), so the card never stays on a city's
  page opened from the middle page. The offer, "Get a
  notification the evening before snow is likely where you are.", with the kept line beneath
  (`card-kept`), "Turn on" and "Not now"; "Turn on" turns "Evening before" on for where you are.
  Then "Done. You'll get a notification the evening before snow is likely where you are. You can
  change this in Settings.", and once the server has answered, "…likely near Leeds…", so a wrong
  approximate place shows to someone who never opens Settings; the line is said to VoiceOver once,
  and the town shown, not said again. The refused kind and the card's going for good are 8.1's.
- **Your privacy:** "Where you are: Leeds, Europe/London" (`AppCopy.keptHere`, from
  `alertSync.v2`'s reply; no line while the server has no place for where you are). "Turn off
  notifications and delete my data" also forgets the phone's cell and this launch's fix; the next
  fix brings the cell back.
- **Where you are, the rule** (client `herePlace`, ported as `AlertSync.here(access:fix:kept:)`):
  the phone's cell when location access is granted and there is a fix this launch, else the cell
  kept from an earlier launch; otherwise approximate. A fix that isn't the phone's own is ignored.
  Settings' kind is `AlertSync.hereKind(here:reply:refused:)` and its town
  `AlertSync.hereName(here:reply:)`, which names only a reply about the kind of place sent now.
- **When it moves** (`NotificationsModel`): the start and each return to the app read location
  access without asking and, while it is allowed, take one fix, whether or not a switch is on, so
  Settings' row stays true; the start takes none when the screen shows the phone's point in the
  cell kept (launch step 4 has just fixed it). A point of the phone's on screen in another cell
  (the picker's "Use my location", a recent place's, a notification's) is never a fix itself: it
  reads access again and asks for one, which decides, so an old point (Leeds from Recent while
  the phone is in Lapland, or the town a notification for the approximate place opens) never
  moves where you are. Every sync asked for while a fix is out waits for it (`fixFirst`), so the
  token registering brings, or a heartbeat or refresh due on a return, never sends where you are
  from before the fix and then meets the one-write-a-minute 429. Settings or the page appearing
  reads access again. Access not allowed, the kept cell and this launch's fix
  are dropped, so the next sync sends approximate and the server deletes the stored point. While
  where you are is approximate, the app registers again when it becomes active an hour or more
  after the last PUT (`Constants.Alerts.hereRefreshMinutes`, 60), as the server locates the
  connection afresh at each PUT; otherwise the weekly heartbeat. Nothing asks for location but
  "Use my location".
- **A set the server couldn't locate** (400 `bad_location`, `put-unlocated`): the server forgets
  the whole set; the app clears its registration, keeps the switches on, shows the server's words
  in the status line, and the row says "Not found yet". The same set isn't sent again until it
  changes or the app becomes active again. With every switch off there is no set, so nothing
  waits: a switch turned on again sends it at once.
- **The sync** (`AlertSync.action`, client `alertAction`), single-flight and coalesced with one
  retry after a 429, as 8.1's, on the version 2 body (`AlertSync.body`, client
  `registrationBody`):
  `{ v: 2, app, platform, env, token, units, appVersion, alerts, here, saved: [] }`, with `here`
  `{ source: 'ip' }` or the cell, `{ lat, lon, source: 'device' }`, and no `deviceTz`. No
  `needsPlace`: there is always a place. The reply (`DeviceResponse`) is
  `{ id, deviceTz, here, saved, refused?, alerts, seenAt }`, with `here`
  `{ name, timezone, query, country, follows }` or null; a version 1 reply fails. The router's
  zones (`zones`) come from `AlertSync.replyZones`, every place in the set.
- **The keys**, new, with no migration (decision 28): `alerts.v2`,
  `{ v: 2, prefs, here?: { lat, lon }, bells: [] }`, the switches and the phone's last cell, kept
  only while location access is allowed (`bells` stays empty until 8.4b); and `alertSync.v2`,
  `{ v: 2, fingerprint, at, token, env, units, response }`. `ui.alertCard` as before. An 8.1
  install updated to an 8.4 build reads nothing kept and starts with notifications off; Carl
  deletes 8.1's record from the 8.1 build first (docs/SETUP.md).
- **The words** (`AppCopy`, from packages/mobile `appCopy.ts`): new `notifyHere`,
  `notifyHereApprox`, `notifyHereUnknown`, `notifyHereKept`, `notifyHereAbout`, `cardOffer`,
  `cardOnNamed` and `keptHere`; changed `cardOn`, `notifyPlaceTitle` ("Where you are"),
  `notifyLocationUnavailable`, `privacyNotifications` and `locationPurpose`; gone `cardChosen`,
  `cardApprox`, `needsPlace`, `notifyPlace`, `notifyPlaceOnScreen`, `notifyFollows` and
  `notifyLocationTryAgain`. "Your location" is core's `yourLocation`. The constant is
  `Constants.Alerts.hereRefreshMinutes`.
- **The fixtures** (`Fixtures/Devices`), made by the server's version 2 handler, each a whole set:
  `put-here-ip` (approximate: Leeds, from the connection), `put-here-device` (the cell 53.8,
  -1.55: Leeds), `put-here-refresh` (approximate an hour later: Newcastle) and `put-unlocated`
  (the 400). 8.1's `put-leeds` (the registration the delete, the `test-*` answers and the two 429s
  are made after), `put-twice`, `delete`, `rate-limited` and the `test-*` answers stay byte for
  byte, and the stub passes 8.1's PUTs over; its other version 1 PUTs (`put-durham`, `put-device`,
  `put-kathmandu`, `put-bad-place`) went, as nothing read them.
- **The hooks** (below, "Debug hooks"), with no new name, so the Release stubs and
  `check-archive.sh` are unchanged: `-location ask:<lat>,<lon>`, location access never asked
  until something asks for it (the "Where you are" page's or the picker's "Use my location"),
  which the stand-in allows, then a fix there; before that no fix, as Core Location gives none.
  `-devices` answers a version 2 PUT with the fixture whose set equals the body's (an approximate
  body `put-here-ip`, the cell 53.8, -1.55 `put-here-device`), and any other set with
  `put-unlocated`'s 400; `-devices unlocated` answers every PUT with that 400 and goes with the
  test's names (`-devices unlocated,gone`). The default push token is `put-here-ip`'s.
- **What only macOS shows:** the new page's layout and its audit; the kept line among the switches
  and on the card at Large and AX3; the card on the where-you-are screen alone; the page going
  back to Settings by itself; the VoiceOver lines; the stub's sets and `-location ask:` in the
  app; and the Unit plan's four new `NotificationTests`. **What only Carl's phone shows:** a real
  IP location from a mobile network, the town it gives, "Allow Once" expiring, and the change to
  "Approximate…" when location is set back to Never (docs/SETUP.md, "Where you are (phase
  8.4a)").

**Its tests.** On Linux (`swift test` in IsItCore, 689 tests in 102 suites): the new ports of
`alerts.json` (`herePlace`, `hereKind`, `hereName`, `replyZones`, the version 2 body, reply and
`alertAction` with the hourly refresh and the refused set); `AlertRecordsTests` (the version 2
keys, and 8.1's reading as nothing kept); `NotificationsModelTests` for 8.4a: a switch at
approximate location registers ip, its body `put-here-ip`'s; access granted then revoked moves
from the phone's cell to approximate and drops the kept cell and the fix; the hourly refresh on
becoming active, not at 59 minutes, at 60 (`put-here-refresh`), never for the phone's own cell;
the refused set waits (`put-unlocated`); zones cover where you are and saved places; the card's
where-you-are flag and its "Done" line naming Leeds; "Use my location" asking only at the tap,
denied, and with no fix; the cell kept from an earlier launch standing in until a fix comes;
`NotificationSettingsTests` (the row's kinds before and after a reply, "Not found yet" only after
a 400 or `here: null`, an unnamed place with no value, the page's three states),
`NotificationCardTests`, `InfoPagesTests`, `NotificationRouterTests` and `DevicesAPITests`. On the
macOS CI:

- **The Unit plan:** `NotificationTests` checks `alerts.v2` and `alertSync.v2` (`put-here-ip`'s
  registration, nulls kept) round trip through `NotificationDefaults`, 8.1's version 1 data and
  anything unreadable read as nothing kept, and `removeAll()` forgets all three keys.
- **The UI plan,** re-pointed with no new test. `NotificationsTests`: the gate's test is
  `testTurningOnAtApproximateLocation` (Settings audited off at approximate location; the switch
  turned on asks for no location; the row reads "Approximate, from your internet connection" with
  "Leeds"; the kept line; Your privacy's "Where you are: Leeds, Europe/London"); the place
  choice's is `testWhereYouAre` ("Use my location" on the page, which goes back to Settings by
  itself, where the row reads "Your location" with "Leeds"; location off is left to Linux); the
  card's two are `testTheCardTurnsOn` (leeds-dry at approximate location: the offer, its kept
  line, "Done" naming Leeds) and `testTheCardOnlyWhereYouAre` (no card on Leeds's page with Leeds
  chosen; "Not now" for good); the rest read `notify-here` where they read `notify-place`. Every
  launch there stands in for Core Location with access never asked
  (`-location ask:53.8,-1.55`), so where you are is approximate until "Use my location", whatever
  the simulator's own settings. `HomeAuditTests` audits the card in two cases, not four: leeds-dry's
  middle page at approximate location, at Large and AX3 (the card that asked for a place has
  gone). Each wait reads snapshots (`readElement`), as since PR #46, and each tap whose result
  can be read is watched (`watchedTap`; above, "A gesture the simulator cancelled").
- **Iteration runs:** `ios.yml`'s `workflow_dispatch` input `only` (below, "CI") runs just the
  named tests, so a macOS round on a few failing tests needn't wait for the whole UI plan.

## Phase 8.4b: notifications for saved places

Phase 8.4b of "Notifications where you are, and for saved places": a bell beside the star on every
saved place turns that place's notifications on and off, with the one-off purchase, whose words
now say so ("No ads, widgets and more"). Where you are stays free (phase 8.4a, above). Carl chose
the purchase's words (option (a)) and that 1.0 waits for the bells; DECISIONS has each decision and
why ("The iPhone app's notifications for saved places (phase 8.4b)").

- **What changed for the user:** a saved place, under Saved or as a saved search result, has a
  bell beside its star. Without the purchase the bell has a small lock and opens the purchase's
  page over the search screen; bought there, the bell turns on by itself. With it, the bell turns
  that place's notifications on and off, the evening before and on the day as for where you are,
  with the same switches. The line under the saved places says what a star and a bell do.
  Settings → Notifications has "Saved places"; the test sends two notifications with a saved
  place's bell on; Your privacy lists each saved place with notifications and the iPhone's time
  zone. The purchase is "No ads, widgets and more", its page lists what it brings, and its thanks
  says the saved places' notifications can be turned on.
- **The bell** (`PlacePicker.Bell`, IsItLogic; `BellButton`, IsItUI's PickerChrome.swift): on
  every row whose star is filled, a saved row (`bell-saved-<key>`, `bell-saved-city:durham-gb`)
  or a saved result (`bell-result-<i>`), never a recent place or "Use my location". Its state is
  `AlertSync.bellState(on:unlocked:active:)` (client `bellState`): `locked` without the purchase
  (`bell` with a small `lock.fill` at its foot, hidden from VoiceOver, so from XCUITest too),
  `on` while its bell is kept on and something can be sent (`bell.fill`; `active` is a switch on
  and notifications not denied), otherwise `off` (`bell`). Its label says what a tap does: "Turn
  on notifications for Kathmandu, with the one-off purchase", "Turn on notifications for
  Kathmandu" or "Turn off notifications for Kathmandu"; it is also a saved row's second
  press-and-hold item and VoiceOver action, after Remove, and a saved result's only one. It is the
  star's twin: ink, at least 44 by 44 and growing with the text, washed while pressed, 8 points
  before the star. At accessibility text sizes a row with a bell moves its bell and star to their
  own line under the name, at the trailing edge, so "Rovaniemi" isn't cut mid-word; a row with a
  star alone keeps its layout.
- **What a tap does** (`PlacePickerModel.toggleBell(_:)`, then
  `NotificationsModel.toggleBell(_:unlocked:)`, client `tapBell`): without the purchase,
  `.needsPurchase`, which sets the picker model's `purchasing`, and `PickerSheet` opens the upgrade
  sheet (`UpgradeSheet`) over the picker, not over the home screen. With it, the system's prompt first if notifications were never asked
  (once for every tap meanwhile, shared with a switch's), then on (`.on`), on with "Evening
  before" when every switch was off (`.onWithHere`, which also puts the Today card away), off
  (`.off`), or `.denied` while notifications are off for the app. The picker says the outcome to
  VoiceOver once it is known, never at the tap: "Notifications on for Kathmandu.", "Evening
  notifications on for Kathmandu and where you are.", "Notifications off for Kathmandu.", or
  "Notifications are off for this app in Settings.", which also shows that line under the saved
  places with "Open Settings" (`bell-denied`, `bell-open-settings`), opening the app's
  notification settings. A bell chooses nothing, so it never brings the full-screen ad.
- **After the purchase sheet** (`purchaseSheetClosed(unlocked:)`): closed with the purchase owned,
  the bell that opened it turns on by itself and that is said; one already on underneath (kept
  from before a refund) is said to be on. Not owned, or the place unsaved meanwhile, nothing.
  `PlacePickerView` gives VoiceOver's focus back to that bell as the sheet closes
  (`purchaseOpen`, `@AccessibilityFocusState`).
- **The line under Saved** (`PlacePicker.savedLines`, client `savedLines`, `saved-line`), with
  nothing typed: nothing saved, "Tap the star beside a place to save it. Saved places can have
  notifications with the one-off purchase." (free) or "Tap the star beside a place to save it,
  then tap its bell to get notifications." (paid); places saved, "Tap a place's bell to get
  notifications for it, with the one-off purchase." (free) or "Tap a place's bell to get
  notifications for it." (paid, no bell on); none once paid with a bell on. With ten saved,
  `saved-full` first. `savedHint` ("Tap the star beside a place to save it here.") has gone.
- **The bells, kept** (`alerts.v2`'s `bells`, by `Target.key`, in saved order, at most
  `Constants.Alerts.savedPlacesMax`, 10): `NotificationsModel.savedChanged(_:)` keeps the bells of
  places still saved (`AlertSync.keptBells`, client `keptBells`) and remembers, in memory only,
  any it drops, so a place saved again before the app is closed gets its bell back; saved for the
  first time, its bell starts off. While nothing can be sent (every switch off, or notifications
  denied) the bells are kept and show off. Without the purchase they are kept and show locked.
  "Turn off notifications and delete my data" clears them and that memory.
- **The purchase, heard** (`NotificationsModel.unlockedChanged(_:)`): `AppModel` tells the
  notifications at launch step 5 and on every `purchaseChanged`, through the hook
  `AppHooks.unlockedChanged(_:)`, which `LiveHooks` forwards; the saved places through
  `AppHooks.savedChanged(_:)`, once as step 1 reads them and after each change kept. A refund or
  Family Sharing ending keeps the bells and sends no saved place, so the server deletes their
  records; a restore sends them again. Until StoreKit answers at launch, the bells are sent if the
  last reply had saved places (`AlertSync.ownsSaved`, client `ownsSaved`), so a launch never
  deletes and adds them again.
- **The sync** (`AlertSync.body`, client `registrationBody`): the version 2 body now carries the
  saved places with a bell on (`AlertSync.savedForBody`, client `savedForBody`), a city by its
  slug (`{ place: 'durham-gb' }`) and a searched place by its point and words, and the phone's
  zone (`deviceTz`, from a `deviceZone` seam, `TimeZone.current.identifier` by default) only with
  one, right after `appVersion`, so the body and its fingerprint match `alerts.json` byte for
  byte. `DevicesAPI` sends the body's own bytes, as `JSONEncoder` writes "/" as `\/`. The reply's
  `deviceTz` is never compared with the phone's: the server keeps the zone as its ICU names it
  (Asia/Katmandu for Asia/Kathmandu). A change of bell, saved place, purchase or zone sends again
  (client `alertAction`); every switch off, or notifications denied, deletes the whole set,
  whatever the bells say. At most three places new to the set are added a PUT; the server's 429
  (`put-capped`) is retried after its `Retry-After`, as 8.1's sync does. That 429 comes after the
  server stored where you are and the first three, a 503 after it stored the rest, and a reply
  lost may follow a set stored, so the model keeps the token of such a set, in memory, until a
  reply says what the server holds: with no registration kept, every switch off, notifications
  denied or the delete then sends the DELETE to it (client `alertAction`'s `unconfirmed`), and
  the delete says it is done only once that DELETE is answered.
- **Settings → Notifications** (`NotificationSettings.savedRow`, `SavedRowView`): "Saved places"
  (`notify-saved`) under "Where you are", its value its accessibility value alone, with the
  purchase as the rest of Settings and the search screen show it (`AppModel.unlocked`, passed in
  as `NotificationSettings(_:unlocked:)`; `ownsSaved` decides only what is sent): "With the
  one-off purchase" without the purchase, pushing the upgrade page on Settings' own stack; with
  it, "2 on" (the bells that show on) or "Off", asking the model for the picker
  (`requestPicker(locating: false)`): Settings closes and the picker opens (`HomeView`). No
  switch per place. The test with a saved place's bell on sends two, where you are's and the most
  recently saved place's with its bell on: "Sent 2 test notifications. They should arrive in a few
  seconds." (`testSentCount`, from the reply's `count`). Quiet hours are judged by the iPhone's
  clock: "Nothing is sent from 9pm to 7am. Try again after 7am." "Met Office warnings" shows while
  where you are, or a saved place with its bell on, is in the UK. The footer says saved places'
  notifications arrive silently from 9pm to 7am on the iPhone.
- **The upgrade page** (`UpgradePage.benefits`, `UpgradeView`): three lines first, each beside a
  checkmark hidden from VoiceOver (`upgrade-benefit-1` to `-3`): "No ads in the app", "Widgets for
  your home screen and lock screen", "Notifications for your saved places"; then "A one-off
  purchase. Notifications for where you are, and everything else, stay free."
- **Your privacy:** after "Where you are: Leeds, Europe/London", one line per saved place the
  server keeps, in the reply's order ("Durham, Europe/London", `keptPlace`), then "Your iPhone's
  time zone: Europe/London" (`keptDeviceZone`) only with one. The delete's line says "…token,
  places, units and choices."
- **The words** (`AppCopy`, from packages/mobile `appCopy.ts`): new `bellOn`, `bellOff`,
  `bellLocked`, `bellTurnedOn`, `bellTurnedOnWithHere`, `bellTurnedOff`, `placeUnsavedBellOff`
  ("Kathmandu removed from saved places. Its notifications are off."), `savedLineNoneFree`,
  `savedLineNonePaid`, `bellHint`, `bellHintLocked`, `notifySaved`, `notifySavedLocked`,
  `notifySavedOn`, `notifySavedOff`, `testSentCount`, `keptDeviceZone`, `upgradeNoAds`,
  `upgradeWidgets` and `upgradeSavedNotifications`; changed `upgradeTitle` ("No ads, widgets and
  more"), `upgradeSettings`, `upgradeRow` ("No ads, widgets and notifications for saved places ·
  £1.99"), `upgradeBody`, `thanks` ("Thank you. Ads are off, widgets are on and you can turn on
  notifications for saved places."), `upgradeDescription` ("No ads, widgets and saved-place
  notifications"), `testQuiet`, `notifyFooter`, `privacyNotifications` and `deleteDone`; gone
  `savedHint`. Snow.storekit carries the new name and description. The constant is
  `Constants.Alerts.savedPlacesMax`, held equal to `PLACES.savedMax`.
- **The fixtures** (`Fixtures/Devices`, `Fixtures/Payloads`), made by the server's handler from a
  fixed salt: `put-here-ip-durham`, `put-here-ip-kathmandu` and `put-here-ip-durham-kathmandu`
  (where you are approximate, with those bells on and the phone's zone), `put-refused` (a gone
  city page listed in `refused`), `put-capped` (four new places at once: the 429), `test-sent-two`
  (`{ sent: true, count: 2 }`), and the payloads `durham-saved-evening` and `durham-saved-passive`
  (a saved place's evening in its own thread, one silent).
- **The hooks** (below, "Debug hooks"): `-saved <query>[,<query>…]`, the saved places a test
  launches with, after `-resetStore`; and `-devices sent2`, the test answered with
  `test-sent-two`. The stub matches the sets with saved places, and answers `put-capped`'s set with
  its 429 every time. `check-archive.sh` looks for `-saved` in both binaries: 28 hooks now.
- **What only macOS shows:** the bell's look and its lock, the row at AX3 and AX5, the purchase
  sheet over the picker and the turn-on after it, VoiceOver's focus going back to the bell, what
  VoiceOver is told, the denied line's Open Settings, Settings' "Saved places" opening the picker,
  and the upgrade page's benefit lines. **What only Carl's phone shows:** a sandbox purchase from
  the bell, two notifications in two stacks, a saved place's notification arriving silently in
  the night, and a tap on one opening its place (docs/SETUP.md, "Saved places' notifications
  (phase 8.4b)").

**Its tests.** On Linux (`swift test` in IsItCore, 759 tests in 110 suites): the ports of
`alerts.json`'s new rules (`bellState`, `setBell`, `keptBells`, `ownsSaved`, `savedForBody`,
`tapBell`, `alertsActive`, `savedLines`, and the bodies with none, one, five and ten saved places);
`PlacePickerTests` (the bells' states, labels and badge on saved rows and saved results, the lines'
table, the words); `NotificationSettingsTests` (the saved row both ways, the UK by each place's
country, the row with the app's purchase before StoreKit answers); `UpgradePageTests`,
`InfoPagesTests`, `SettingsScreenTests`; `NotificationsModelTests` (a locked bell, the first bell's
prompt and evening, two taps while the prompt is out, bells shown off and kept, unsave and save
again, a refund and a restore, before StoreKit answers, the delete, `deviceTz` only with a saved
place, the cap's 429 and its retry, and a set the server may hold after a 429, a 503 or no answer
deleted with every switch off, notifications denied or the delete); `PlacePickerModelTests` (each
outcome said, nothing said for the purchase, the turn-on after it); `AppModelTests` (the two hooks);
`DevicesAPITests` (the body's own bytes). On the macOS CI, the UI plan:

- **`PickerTests.testTheBellJourney`** (free, `-purchase bought`): Kathmandu searched for and
  starred; its result's bell locked, read from its label; its tap opens the purchase over the
  picker; Buy, then Close: the bell is on by itself and the picker still on the results; under
  Saved, its bell on and no line; turned off, the line; unsaved, the line for none saved. Then a
  launch with `-unlocked 1 -saved <Kathmandu> -notifications denied`: the bell off, its tap shows
  `bell-denied`, and Open Settings records the app's notification settings.
- **`NotificationsTests.testSavedPlacesPaid`**
  (`-unlocked 1 -saved place=durham-gb -devices sent2`): "Saved places" says "Off" and opens the
  picker; Durham's bell turns on, with the
  evening; the picker audited with the bell on at Large; "1 on"; two tests sent; Your privacy's
  Durham and the iPhone's zone; the delete; "Off" again. `testTurningOnAtApproximateLocation`
  checks the free row's value and that it pushes the purchase's page.
- **The rest:** `testSavingAResult` and `testSavingARecentAndRemovingIt` read the line under
  Saved where they read the hint; the saved places' audits at Large and AX3 have Kathmandu's
  locked bell on screen, and the AX3 test adds one launch at AX5 with Rovaniemi saved
  (`picker-saved-ax5`, and the clipped-text audit). `UpgradeTests`, `AdsTests` and
  `SettingsTests` pin the new words, and `UpgradeTests` the benefit lines; `app-upgrade`, App
  Review's screenshot, is taken again with them. Every wait reads snapshots and every tap whose
  result can be read is watched, each with a `done` only its own result can meet.

## Phase 8.3: the ads

The free version's ads (spec section 14), as Carl widened phase 8.3: three placements, after
Google's consent. DECISIONS has the why ("Ads in the iPhone app: three placements").

- **What shows**, in the free version only, once Google's consent lets ads be requested: a band
  under the pages holding the home banner (an anchored adaptive banner, `ad-home`); a box after each
  page's footer holding that page's banner (an inline adaptive banner at most 250 tall,
  `ad-page-<view>`, asked for once the page has been on screen); and a full-screen ad as a place is
  chosen in the picker the place pill opened, only one already loaded, at most once every 5
  minutes, and never in the app's first run. The band and the box keep their space whether or not an ad comes, and
  VoiceOver reads each as "Advertisement".
- **The start** is launch step 5, which AppModel takes only when the purchase isn't owned:
  `LiveHooks.startAds()` calls `AdsModel.start(firstRun:)`, which returns at once and runs UMP's
  update, its consent form where one is required, then Mobile Ads, every ad rated G at most. A
  purchase made while the app runs stops them for good that launch (`AdsModel.stop()`; above,
  "Phase 7.1: the purchase").
  Settings shows "Privacy choices" while UMP says its privacy options form is required (above, "6.2
  and 6.3: Settings").
- **IsItCore, tested on Linux:** `AdRules` (IsItLogic: when a full-screen ad is due and still fresh,
  and the wait before a failed banner is asked for again) and `AdsModel` (IsItState: the start, the
  phase the views read, the home band's height, each banner's loads and retries, and the full-screen
  ad), with Google's SDKs behind `AdsPlatform` and the last full-screen ad's time behind `AdsStore`;
  and `Launch.firstRun`. Every number is `Constants.Ads` (client `ADS`).
- **IsItKit:** `GoogleAds` (IsItAds: the two SDKs as `AdsPlatform`; the units from the Info.plist,
  `AdUnits.fromInfoPlist`; UMP's debug geography, `ConsentGeography`), `BannerSlot` (IsItAds: a
  slot's banner on screen) and `TopViewController` (IsItAds: what the forms and the full-screen ad
  show over); `AdDefaults` (IsItServices: `ads.lastInterstitial` in the app's own defaults);
  `AdBand` and `AdBox` (IsItUI's AdSpaces.swift, which never imports Google). `HomePager` and
  `ForecastPageView` take what each page ends with (`pageEnd`, `end`).
- **The app:** `WillItSnowApp.init()` builds `GoogleAds`, `AdsModel` (on the system's clock always)
  and `LiveHooks`; `HomeView` draws the band under the pager and a box at each page's end while
  `!model.unlocked` and the ads are on, and tells the model the widths and the page on screen;
  `PickerSheet` closes through `ads.placeChosen { dismiss() }` when the place pill opened it;
  `SettingsSheet` passes Privacy choices.

**The units** are Info.plist keys, filled by Snow.xcconfig from `ADS_UNITS` (no unit is typed in
Swift):

| Info.plist key             | For                | `test`: Google's demo unit               | `real`: repository variable |
| -------------------------- | ------------------ | ---------------------------------------- | --------------------------- |
| `GADApplicationIdentifier` | the app            | `ca-app-pub-3940256099942544~1458002511` | `ADMOB_APP_ID`              |
| `IsItBannerUnitID`         | the home band      | `ca-app-pub-3940256099942544/2435281174` | `ADMOB_BANNER_ID`           |
| `IsItPageBannerUnitID`     | each page's end    | `ca-app-pub-3940256099942544/2435281174` | `ADMOB_PAGE_BANNER_ID`      |
| `IsItInterstitialUnitID`   | the full-screen ad | `ca-app-pub-3940256099942544/4411468910` | `ADMOB_INTERSTITIAL_ID`     |

With `test`, `check-archive.sh` requires each key's own demo unit, as above, not just any of
Google's: a banner unit under `IsItInterstitialUnitID` would load no full-screen ad while both
banners showed, which is what a phone shows when the ad isn't ready yet.

The Info.plist also lists `SKAdNetworkItems`: Google's 50 identifiers from
developers.google.com/admob/ios/3p-skadnetworks, copied by hand until `ios-nightly.yml` exists.
`check-archive.sh` checks all of it (above, "Releasing to TestFlight").

**Its tests.** On Linux: `AdRulesTests`, `AdsModelTests` (the start, the banners and the full-screen
ad, against `AdsFakes.swift`) and `FirstRunTests`. On the macOS CI every older UI test launches with
`-noads 1`, so its screens are the app's own, and `AdsTests` (UI plan) launches with Google's demo
units over the real network: the band under the pager and the box at a page's end (`ads-home-band`,
`ads-page-end`), the paid version with none, the consent form in the EEA and then Privacy choices
(`ads-consent-form`, `ads-privacy-choices`), the full-screen ad as a place is chosen, then none
within 5 minutes (`ads-full-screen`), and since phase 7.1 a purchase taking them all away
(`ads-after-purchase`, a test that never skips). Each other test skips, saying why, only when Google
didn't answer in time, which a Debug build's readout of the ads model tells it (`debug-ads`,
`debug-interstitial`, `debug-shown`); what is the app's fails. The full-screen test skips only when
the last read of `debug-interstitial` ended in time and found `none`; reads too slow to say fail.

**Trying it.** A Debug build run from Xcode is the free version, with Google's demo ads. `-noads 1`
runs it without them, `-unlocked 1` as the paid version, and on the simulator `-umpGeography eea`
or `other` puts UMP in the EEA or out of it (below, "Debug hooks"). The first run shows no
full-screen ad: choose places on a later launch.

## CI (`.github/workflows/ios.yml`)

| Job             | Runs on                     | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generated`     | ubuntu                      | `pnpm mobile:check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `swift-linux`   | ubuntu, `swift:6.3.3-noble` | every Swift file lints; IsItCore's tests pass (with `tzdata`), the vector guard included: every vector file checked by its port (above)                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ios`           | `macos-26`, Xcode 26.6      | the project generates; packages resolve to the pins; the app, widget and tests build for the iPhone 17 simulator (iOS 26.5), with the icon and glyph catalogues; the Unit plan passes, with its widget snapshots, and the UI plan but its screen audits (`ci/test.sh UI`); after the UI plan, `ci/push.sh` shows the notification banner over the app and on the Home Screen (`simctl push`); a Release build has no debug hooks, no fixtures, no StoreKit configuration and no StoreKitTest, and no ads, location or purchase code in the widget |
| `audits`        | `macos-26`, Xcode 26.6      | the UI plan's screen audits, `HomeAuditTests`, pass (`ci/test.sh Audit`), on an iPhone 17 simulator of their own, built as `ios` builds, within 90 minutes; beside `ios` since phase 8.4b's first run, where they took 33.4 of the UI plan's 78.4 minutes; a run where none of them ran fails (`xcresult-summary.mjs split`)                                                                                                                                                                                                                      |
| `archive-check` | `macos-26`, Xcode 26.6      | an unsigned Release archive for iPhones builds and passes `scripts/check-archive.sh` with ads test: the release job's archive checks, on every pull request, with no key                                                                                                                                                                                                                                                                                                                                                                          |
| `storekit`      | `macos-26`, Xcode 26.6      | the StoreKit plan passes on an iPhone 17 simulator with iOS 26.2 (downloaded if the runner lacks it), each test allowed 60 seconds, within 60 minutes; beside `ios`, not after its UI plan, which already takes most of that job's 120                                                                                                                                                                                                                                                                                                            |
| `contact-sheet` | ubuntu                      | tiles every attached screen and widget, `audits`' among them, and push.sh's two banner screenshots, into one PNG, whenever `ios` or `audits` uploaded attachments (failed tests included); skipped when both failed before their tests ran                                                                                                                                                                                                                                                                                                        |

**Iteration runs** (phase 8.4a): Actions → iOS → **Run workflow**, on a pull request's branch,
with `only` naming the tests to run as xcodebuild names them, Target/Class or Target/Class/method,
separated by commas (`WillItSnowUITests/NotificationsTests/testWhereYouAre,
WillItSnowUITests/HomeAuditTests/testLeedsDryWithTheNotificationCardAtAX3`). `ci/test.sh` reads it
as `ONLY_TESTING`: each plan runs only the named tests of its own targets (`-only-testing:`;
the `audits` job those in `HomeAuditTests`, the `ios` job the UI plan's others), a plan with none
of them says "not run" and runs nothing, and a name that isn't Target/Class[/method]
or names no plan's target stops the step, and a name of a plan's own that ran no test (a misspelt
class or method, which xcodebuild runs as nothing and passes) fails it once the plan has run,
naming it (`xcresult-summary.mjs ran`), so a misspelt name never passes.
The banner step is left out, as it needs NotificationPermissionTests to have allowed
notifications. The setup, the build, the Release check and the archive job still run. `only` left
empty is a whole run; pull-request and merge runs never read it, so they always run every plan
whole. From the container, `gh workflow run ios.yml --ref <branch> -f only=<names>` or the GitHub
MCP's `actions_run_trigger` start one. GitHub documents that a `workflow_dispatch` workflow must be
on the default branch, so until this file is on main a dispatch on the branch may be refused; the
first try shows whether it is.

No job needs a secret. The `ios` job pins `macos-26` (never `macos-latest`, never `-xlarge`) and
selects Xcode 26.6 explicitly. It may run for 120 minutes: PR #43's first run, with the widgets
and the notifications, took 85 of the 90 it had, and phase 8.4b's first took 103, before the
screen audits had their own job (`audits`, 90 minutes; docs/DECISIONS.md, "The screen audits in a
job of their own"). It caches `apps/ios/.spm` (the package
checkouts and Google's binary SDKs) on the hash of `Package.resolved`, and the XcodeGen zip,
whose SHA-256 is checked on every run. It uploads, for five days:

- `ios-results`: `Build.xcresult`, `Unit.xcresult`, `UI.xcresult`, and the JSON xcresulttool
  read from them;
- `audits-results` (the `audits` job's): `Build.xcresult`, `Audit.xcresult` and their JSON;
- `storekit-results` (the `storekit` job's): `Build.xcresult`, `StoreKit.xcresult` and their
  JSON;
- `ios-attachments`: the PNGs the tests attached, as `xcresulttool export attachments` writes
  them (each named by a UUID, its test's name for it in the folder's `manifest.json`), by test
  plan, and `review/app-upgrade.png`, the upgrade sheet's screenshot for App Review, copied there
  under that name (`ci/test.sh UI`; docs/SETUP.md, "The app's purchase"), and since phase 8.1
  `Push/`, the notification banner over the app and on the Home Screen (`ci/push.sh`,
  `notification-banner-app.png` and `notification-banner-home.png`), with the simulator's log of
  the step (`simulator.log`) and the app's standard output (`app-stdout.txt`);
- `audits-attachments` (the `audits` job's): `Audit/`, the screen audits' PNGs and their audit
  calls' times, as `ios-attachments` has the other plans' and the rest of the UI plan's;
- `contact-sheet`: `contact-sheet.png`, every attachment at true size (a third of the 3x pixels),
  named underneath;
- `package-resolved`: only when the committed file can't be used (below).

Each step's outcome goes to the run's summary page and to the job log: the build's errors and
warnings with file and line, each test plan's counts and every failure with its file and line,
each UI job's audit calls' times (`ios`'s for the sheets and the picker, `audits`' for the
screen audits), read from its attachments (the ten slowest and every call that
timed out, with the time a timeout took, which says roughly how long XCTest's deadline is), and
every touch the system cancelled in the app, with its test and what was played again
(`ci/test.sh`, using `ci/xcresult-summary.mjs`), the notification banner (`ci/push.sh`: shown,
or failed, with an error naming what wasn't seen, each screenshot's time since the push above it,
and the permission the app read), and the Release checks. xcbeautify also turns
compiler errors into annotations.

## How agents read CI results

The loop (spec section 17.1): batch the Swift changes, push, wait for `ios.yml`, read what
failed, fix, push again. Expect many round trips; T1 (`swift-linux`) answers in about 3
minutes, the macOS job in about 15.

**With the GitHub MCP tools** (they fetch on GitHub's side, so nothing is blocked):

1. `actions_list` for the workflow runs of `ios.yml` on the branch, newest first; then the run's
   jobs and their steps' conclusions (`actions_get`).
2. `get_job_logs` for a failed job (or only its failed steps). The step summaries are in the log
   as well: search for `### Build:`, `### Unit:`, `### UI:`, `### StoreKit:` (in the `storekit`
   job's log), `### Audit times:`, `### Notification banner:`, `### Release build:`,
   `### Archive, unsigned` and
   `### Archive checks:`. Each failure is a
   table row with the test, `File.swift:line` and the message, or for the archive checks a line
   naming the check.
3. Compiler errors are in the `Build for testing` step: `### Build: failed, N errors` and a row
   per error with its path from `apps/ios/` and line.
4. To run only the tests that failed (above, "CI", iteration runs): `actions_run_trigger` for
   `ios.yml` on the branch with the input `only`; its summary says `### UI: only …`, and a plan
   none of the names is in says `not run`.

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

## Glyphs, icon and fonts

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
  `Font.custom`. Settings' page titles are in it too: a subset of letters, digits and a little
  punctuation, so `packages/mobile`'s `titleFont.test.ts` holds every title to it.
- **Text faces:** `Apps/Snow/Resources/Fonts/BricolageText-{Regular,Medium,SemiBold}.ttf`, built
  by `scripts/make-text-fonts.py` from the website's variable font: static instances at wght 400,
  500 and 600 and opsz 16, each the latin and latin-ext subsets merged, so Łódź and Météo-France
  never fall back to SF Pro. Family "Bricolage Text", each named by its PostScript name.
- **`BrandFont`** (`IsItModel/Generated/BrandFonts.swift`) names all four for the Swift, with
  their files. Both Info.plists list every file in `UIAppFonts` (`packages/mobile`'s
  `appFonts.test.ts` checks them, and that `check-archive.sh` looks for the same four in both
  bundles); the app-hosted `BrandFontTests` checks each is registered under its PostScript name and
  that the text faces draw latin-ext, and `WidgetBundleTests` that the embedded widget carries and
  names all four. Every word of the home screen, the picker and Settings is in them, through
  `TextRole` (DECISIONS, "The iPhone app in the website's look"), and every word of the Home Screen
  widgets, through their own `WidgetType` (above, "Phase 7.2: the widgets").

## Debug hooks and Release builds

Every test and debug hook is in `Apps/Snow/App/DebugHooks.swift`, inside `#if DEBUG` (spec
section 9.8). A Release build compiles a stub with the same names that does nothing and names no
launch argument. So far there are these:

- `-uitest` turns UIKit's animations off (`UIView.setAnimationsEnabled(false)`), which leaves
  SwiftUI's own animations and transitions running: the home screen's background still fades
  between bands, which `debug-theme` reads (below). It keeps the glyphs' flakes still
  (`stillMotion()`), as `-now` does too; since phase 7.1 it also puts StoreKit's stand-in in
  StoreKit's place (below); and since PR #40 it counts the touches the system cancels, for
  `debug-cancels` (below);
- `-resetStore` forgets the place, the units, the saved answer, the recent and saved places and
  when the last full-screen ad showed, and since phase 8.1 the notifications' switches and place,
  their registration and the card's being put away (`alerts.v1`, `alertSync.v1`, `ui.alertCard`),
  before the model reads them, for a first launch (not
  `unlock.v1`, which only `PurchaseModel` writes, and which nothing reads under the stand-in);
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
- `-location <lat>,<lon>|ask:<lat>,<lon>|denied|unavailable` stands in for Core Location, so a UI
  test never sees the system's prompt: permission given and a fix there; permission never asked
  until something asks for it (the "Where you are" page's or the picker's "Use my location"),
  which the stand-in allows, then a fix there, and before that no fix, as Core Location gives
  none (`AskingLocation`, phase 8.4a, so NotificationsTests' where you are is approximate whatever
  the simulator's own settings); permission off; or permission given and no fix;
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
- `-openURLs record` (SettingsTests, PickerTests): each sheet, Settings and the picker, records each
  web page, email and Settings page it would open instead of leaving the app, and shows the last one
  below the sheet's content, on an opaque background in `subheadline`, so no row runs under it and
  its text follows every text size (`debug-opened`), with the units the last request to the server
  asked in (`debug-units`: `c`, `f`, or `none`); each line shows its label, then what it holds
  ("Units last asked for: f", `AppCopy.recorderLine`), held to its full height; its accessibility
  label is the label alone ("Last link opened", "Units last asked for") and its value the URL or
  the units, which the tests read; the URL wraps whole, so its height is taken from the
  content's, and no test audits a sheet over an email's lines; `-openURLs nomail` also refuses
  every `mailto:` URL, as a phone with no mail app does, so the fallback sheet shows. Any other
  value stops the app;
- `-noads 1` keeps the free version's ads from starting (`LiveHooks`): no consent form, band, box
  or full-screen ad, and nothing sent to Google, whose traffic the `-network` stub never covers.
  Every UI test's launch passes it but `AdsTests`'. Any other value stops the app;
- StoreKit's stand-in (`FakePurchases`, phase 7.1): under `-uitest`, `-unlocked`, `-purchase` or
  `-restore` the app never asks StoreKit, since XCUITest can't buy against Snow.storekit on the
  runner's simulator and Apple's confirmation sheet is the system's (DECISIONS, "The purchase in
  the iPhone app (phase 7.1)"). It answers at once from the arguments, nothing comes through the
  updates, and `unlock.v1` is kept in memory, so nothing a UI test does writes the App Group's.
  Without `-purchase` or `-restore` the App Store has no product, so every older UI test's home
  screens are as they were (no home row), and Settings shows "No ads, widgets and more" with
  no price, then Restore purchase;
- `-unlocked 0|1` says whether the purchase is owned, whatever `unlock.v1` says, from the model's
  first look at the store and in the stand-in's answers too, so the launch's check agrees: `1` is
  the paid version, with no ads, no Report an ad and no ads line, and the thanks in Settings. Any
  other value stops the app;
- `-purchase bought|pending|cancelled|failed|unverified` puts the product on sale at
  `Constants.Purchase.displayPrice`, with Family Sharing, and says what Buy comes to (`bought`,
  owned from then on, by default): Ask to Buy waiting, a cancel, a failure in
  `URLError(.notConnectedToInternet)`'s own words, or a purchase whose check failed, in the words
  of StoreKit's `VerificationError.invalidSignature`. Any other value, or none, stops the app;
- `-restore found|none|cancelled|failed` puts the product on sale too and says what Restore
  purchase comes to (`none` by default): `found` makes it owned, and `failed` has the same words
  as Buy's. Any other value, or none, stops the app;
- `-umpGeography eea|other` is UMP's debug geography: the EEA, where its consent form is
  required, or a region where none is. It takes effect on the simulator only: UMP keeps debug
  features to the simulator and to devices whose hashed IDs the app names, and the app names
  none, so on an iPhone UMP still goes by where the phone is. Either way UMP forgets the answer it
  kept at each such launch, so the form comes again. `-resetStore` leaves UMP's own answer alone.
  Any other value stops the app;
- the notifications' stand-in (`FakeNotifications`, phase 8.1): under `-uitest`, `-notifications`
  or `-pushToken` (`standsInForNotifications`) the app never asks the system's notification
  centre, nor gives it its delegate, unless `-notifications system`, so no UI test leaves a
  permission behind but the one that means to. The permission is as `-notifications` says, and
  registering posts the token `-pushToken` names to the inbox a moment later, as UIKit would;
- `-notifications allow|deny|authorized|denied|provisional|system`: not yet asked, with the prompt
  allowing (`allow`, the default) or refusing (`deny`), its answer then kept; that state from the
  start; or the real centre's permission and delegate (`system`, for NotificationPermissionTests
  and `ci/push.sh` only; the token is still the stand-in's). Any other value stops the app;
- `-pushToken <hex>|none|fail`: what registering gives: that token (lowercase hex, 64 to 200
  digits), none, as some devices give, or the failure; without it, the token of
  `Fixtures/Devices/put-here-ip.json` (8.1's `put-leeds.json` until phase 8.4a), so no real token
  is in the app or a test, and the devices stub knows it. Any other value stops the app;
- `-devices sent|sent2|dryrun|limited|quiet|gone|down[,…]|unlocated|offline`: the devices calls'
  answers under `-fixture` and `-network` (`DevicesStub`, from `Fixtures/Devices`, which the
  server's own code wrote). A version 2 PUT (phase 8.4a) with evening and morning off gets 204,
  as the server forgets the device; any other the reply of the version 2 `put-*` fixture the
  server answered with 200 whose set (where you are as sent, approximate or the phone's cell, and
  the saved places, cities by their slugs and searched places by their points and words) is the
  request's, with the switches it sent, 200: the fixtures are read in name order and 8.1's
  version 1 ones passed over, so an approximate body gets `put-here-ip` (Leeds), the cell 53.8,
  -1.55 `put-here-device`, and since phase 8.4b an approximate body with Durham's bell on
  `put-here-ip-durham`, with Kathmandu's (saved from `search-kathmandu`'s result)
  `put-here-ip-kathmandu`, and with both `put-here-ip-durham-kathmandu`. The set of a fixture the
  server answered with 429 (`put-capped`: four places new to the set at once) gets that 429 and
  its `Retry-After` each time it is sent, as no fixture holds the set the server stores after it.
  Any other set gets `put-unlocated`'s 400, as
  the server answers a set it can't locate (a body that doesn't decode, or isn't version 2, a 400
  with none). `unlocated` answers every PUT with that 400, beside the test's names
  (`-devices unlocated,gone`). A DELETE gets 204; and each test send the `test-*` fixture of the
  next of the other names in turn, the last repeating (`sent` by default), with its
  `Retry-After`; `sent2` is `test-sent-two`, two tests sent (where you are's and a saved
  place's, phase 8.4b). `offline`, given alone, fails every devices call with no connection. Neither
  transport tells the recorder of a devices request, which asks in no units. A name with no
  fixture stops the app;
- `-alertCard shown`: under `-uitest` the Today card reads as put away and putting it away writes
  nothing (`CardHidden`), so every older UI test's home screens, and so their audits, are as they
  were; `-alertCard shown` shows it, on a screen that shows where you are (phase 8.4a: never a
  city's page, so leave `-place` out). Any other value stops the app;
- `-place <query>`: after `-resetStore`, keeps that place (`Target(query:)`, a city's or a
  searched place's) as `place.v1`, so a test launches on it. A query that is no place, or
  approximate location's, stops the app;
- `-saved <query>[,<query>…]` (phase 8.4b): after `-resetStore`, keeps those places as the saved
  places (`savedPlaces.v1`), in that order, in place of any kept, so a test launches with a saved
  place's bell to tap. A searched place is named by its query's `name`
  (`lat=27.7&lon=85.3&source=search&name=Kathmandu&region=Bagmati%20Province&country=NP&geonameId=1283240&elevation=50`,
  the query `search-kathmandu`'s result saves, so its set is `put-here-ip-kathmandu`'s); a city
  by `&name=` when the query has one, otherwise as the bundled answer for its page names it
  (`place=durham-gb` is "Durham"). A query that is no place, approximate location's or the
  phone's own point, a place with no name, a place twice, or more than ten stops the app;
- `-route <name>` posts `Fixtures/Payloads/<name>.json`, the server's own payload, to the inbox as
  the tap that launched the app (`DebugHooks.route()`), through the same router and the same hold
  until the launch has finished. A name with no payload stops the app. A tap whose payload routes
  nowhere writes one `Logger.debug` line in Debug builds, with none of the payload
  (`DebugHooks.unrouted()`); Release's stub does nothing;
- the ads readout, which `AdsTests` reads: unless `-noads 1`, three clear one-point elements in the
  home screen's corner, `debug-ads` (the ads model's phase: `idle`, `asking`, `withheld`, `on`, or
  `off` once a purchase has stopped them), `debug-interstitial` (`ready` or `none`) and
  `debug-shown` (how many full-screen ads have shown and closed), so a test can tell Google not
  answering from the app failing;
- the picker's readout, which the UI tests read (its first two elements `PickerTests` and
  `AdsTests`, `debug-cancels` the gesture helper): under `-uitest`, ads or not, three clear
  one-point elements at the home screen's top right, outside what a sheet hides:
  `debug-picker`, `open` while the home screen has the picker open, `closing` once it has closed
  it but SwiftUI hasn't yet taken the picker's content off the screen (its `onDisappear`), then
  `closed`, as before any picker opened; and `debug-pickers`, how many times a picker's content
  has come on screen. A test notes the count before it taps the place button, waits for `open`
  with a higher count where the readout can be read under the picker, and judges the picker
  closed only by `closed` with a higher count than before, so the readout at rest never passes;
  not by XCUITest's tree, which on PR #38's and #39's runs went on finding a closed picker's search
  box for 10 and 15 seconds (DECISIONS, "Ads in the iPhone app: three placements"). It attaches
  `picker-closed-lag` when the tree still has the search box once the readout reads `closed`. The
  third, `debug-cancels`, is how many touches the system has cancelled in the app this launch,
  which the gesture helper reads (above, "A gesture the simulator cancelled"):
  `TouchWatch` exchanges `UIApplication.sendEvent(_:)` for a method that counts each touch the
  event holds in the cancelled phase and then calls the original with the same event, so the
  phases it reads are the system's (backboardd's cancel, a system gesture, deactivation), read
  before UIKit dispatches the event and before any recognizer sees it, and no event's delivery
  changes. It adds no recognizer and wraps no binding;
- the colours' readout, which the UI tests wait on (`awaitColours`): under `-uitest`, a clear
  one-point element at the top of the home screen, `debug-theme`, reading the page on screen's
  band (`none` without an answer) once every fade the background has begun is over and the last
  was to that page's colours, and `fading` until then. `HomeShell` (IsItUI, which names no Debug
  hook) tells the app each fade's theme as it begins and, from
  `Transaction.addAnimationCompletion(criteria: .removed)` on the background's own transaction,
  its end (`fades`, nil in a Release build and without `-uitest`). The app counts the fades under
  way (`ThemeFades`), so a theme left and come back to within 0.9 s reads `fading` until both
  fades are over, and the readout judges them in its own body, so it reads `fading` from the very
  update that changes the theme; a band that changes without changing the theme (a loading page,
  drawn as no snow, giving way to a dry answer) reads at once. `check-archive.sh` looks for its
  name in both binaries;
- the banner step's line (`answerShown`): under `-uitest -notifications system` only, once
  `debug-theme` reads the answer's band, one line on the app's standard output:
  `debug-notifications shown`, then the real centre's settings as the app reads them
  (`authorizationStatus`, `alertSetting` and `alertStyle`, each a word), written straight to the
  file `simctl launch --stdout` names, which `ci/push.sh` waits on. `check-archive.sh` looks for
  its name in both binaries;
- the unit tests' host: when the app only hosts the unit tests (XCTest's
  `XCTestConfigurationFilePath` in its environment), it doesn't launch (`AppModel.launch()`), so
  the hosted tests have the App Group to themselves, and its `PurchaseModel` never starts (its
  `becameActive()` does nothing before launch step 2), so the StoreKit tests' transactions are
  theirs alone, and its `NotificationsModel` never starts (nothing before step 6), so the host
  never asks the notification centre; a launch with `-fixture` or `-network` always launches.

A fixture name that doesn't exist or doesn't decode, a `-now` that isn't a moment, a `-clock`
that is neither `fixed` nor `run`, a `-location` that is none of its forms, or a saved answer
`-resetStore` can't remove stops the app, so a UI test can't pass on the wrong screen.

The fixtures are the ones `pnpm mobile:generate` writes for IsItCore's tests: 21 answers from
the real server (two with a block deleted), each with a `_fixture` note saying what it shows
(`durham-tomorrow`, `kathmandu-0545`, `london-dst-autumn-night`, `stale`, `old-forecast` and the
rest; the list is in `packages/mobile/src/fixtures.ts`), and since phase 8.1 the devices replies
(`Fixtures/Devices`) and the notification payloads (`Fixtures/Payloads`) the server's code made
(`packages/mobile/src/deviceFixtures.ts`). The app's Debug builds bundle that
folder; `EXCLUDED_SOURCE_FILE_NAMES = Fixtures` leaves it out of Release. The golden vectors
beside them (`Resources/Vectors`, the files section 7.4 lists, one case to a line) are for
IsItCore's tests only.
Debug builds may also keep the last answer in the app's own container when the App Group can't
open (`DebugHooks.storeFallback`, V1); Release can't. `ci/release-check.sh` builds Release on
every run and fails if a binary names a hook, a fixture or a StoreKit configuration is bundled,
the app links StoreKitTest, or the widget links Google Mobile Ads, the app's location code or its
purchase code (`StoreKitPurchases`; the widget links StoreKit itself, to read the purchase, from
7.2). `scripts/check-archive.sh` checks the unsigned Release archive on every run
(`archive-check`) and the signed one before each upload, for the 28 hooks of section 9.8 and
phases 8.1 and 8.4b (`-network`, `-location`, `-purchase`, `-restore`, `-notifications`,
`-devices`, `-place` and `-saved` among them, as short literals, and `FakePurchases`, `FakeNotifications` and
`DevicesStub`), the same three purchase checks, location code and notifications code in the
widget, the app's push environment (production) and its manifest's device ID, and the rest of
section 18.3's list. It looks for `-route` only where no letter follows
it, since Google's SDK, linked into the app, holds OpenSSL's name `sbgp-routerIdentifier`
(DECISIONS, "Ads in the iPhone app: three placements").

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

The early questions of spec section 26 that phases 0, 2, 7.1 and 7.2 settle, and one phase 7.1
adds. Phase 8.1 adds two of its own: the cold-start tap (`8.1`) and the banner from `simctl push`
(`8.1 banner`).

| #          | Question                                                                                                                                           | Status                                                                                                                                                                        | What settles it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Evidence so far                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1         | Do App Group defaults and the group container work in CI's simulator builds, signed to run locally?                                                | Pending CI                                                                                                                                                                    | `AppGroupTests` in the Unit plan (`ios` job): the group's container opens, its defaults round-trip, and the widget's timeline (`WidgetTimeline`, over the real group, as the extension opens it) reads the answer the app saved. If not, the Debug fallback is already there, and the test then also runs on Carl's device build.                                                                                                                                                                                                                                                                                                                                                     | None yet: needs the first `ios` run.                                                                                                                                                                                                                                                                                                                                                                                                              |
| V2         | Do UI tests on the runner use the scheme's StoreKit configuration (can `UpgradeTests` buy against Snow.storekit)?                                  | No, on the runner's iOS 26.5, from Apple's notes and developers' reports rather than a run of ours                                                                            | StoreKit Test doesn't connect to the simulator's test environment on iOS 26.3 to 26.5 (FB22500243, which Apple's iOS 26.6 notes list as fixed, and the image has no 26.6 simulator runtime), FB22237318 was still reported on 26.5 though its notes list it fixed, and the confirmation sheet is the system's either way. So the UI tests buy through StoreKit's stand-in (`FakePurchases`, `-purchase`, `-restore`), and the `SKTestSession` tests run hosted by the app, in the StoreKit plan, on iOS 26.2 (next row). Once the image has a simulator runtime with the fix, move the StoreKit plan to it, and try a UI test against Snow.storekit there.                            | Apple's iOS 26.5 and 26.6 release notes and an Apple engineer's forum answer (June 2026: "fixed for simulators starting with iOS 26.6"); forum reports that 26.3 to 26.5 simulators fail (purchases answer `.userCancelled` at once, the configuration isn't saved) and that 26.0 to 26.2 work; the runner image 20261013 has iOS 26.2, 26.4 and 26.5 simulators. Read 27 October 2026 (DECISIONS, "The purchase in the iPhone app (phase 7.1)"). |
| 7.1        | Do the `SKTestSession` tests pass on the runner's iOS 26.2 simulator?                                                                              | Pending CI                                                                                                                                                                    | The `storekit` job: `ci/simulator.sh 26.2` boots an iPhone 17 on iOS 26.2 (downloading the runtime once if the runner lacks it), and the StoreKit plan runs there, each test logging the iOS version, every buy and restore test first requiring the product loaded, and the cancel test buying again once its cancel is cleared, so a broken test environment fails rather than passes. If the image drops 26.2 (simulator.sh then stops with one error naming it) or 26.2 fails as 26.3 to 26.5 do: keep the suite and its plan, and run it on a Mac with iOS 26.2 (Carl's), or move it to a newer runtime with StoreKit Test fixed once the image has one; never skip it silently. | None yet: needs the first `storekit` run. The suite type-checks on Linux against stub StoreKit and StoreKitTest modules.                                                                                                                                                                                                                                                                                                                          |
| V3         | Does `Transaction.currentEntitlements` answer inside the widget extension?                                                                         | Open: only a device answers it (the Xcode StoreKit environment is the app's bundle ID's)                                                                                      | The timeline's log line, `storekit=answered:N` or `late`, asked on every timeline, so `answered:1` on a phone that has bought means the extension sees the purchase, in Console.app on a Mac with Carl's iPhone attached (docs/SETUP.md, "The app's widgets")                                                                                                                                                                                                                                                                                                                                                                                                                         | None yet. Either answer is safe: the widget trusts a verified entitlement it can see, never locks on an empty or late one, and waits at most 2 s.                                                                                                                                                                                                                                                                                                 |
| V4         | Do Foundation's time zones on Linux match core's `localDateTime` for every zone in the vectors?                                                    | Pending CI                                                                                                                                                                    | `placeTime.json` in `swift-linux` (phase 3.3). PR 0.1's Linux run decodes fixtures only, so it doesn't cover time zones.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | PR 3.3 in Docker (`swift:6.3.3` with `tzdata`), 23 October 2026: `PlaceTime.local(_:in:)`, a Gregorian calendar read at `secondsFromGMT(for:)`, falling back to UTC, passes all 75 `placeTime.json` cases: London across both clock changes, Kolkata (+5:30), Kathmandu (+5:45), Adelaide, Kiritimati (+14), Denver, `Etc/GMT+1`, `Etc/GMT+7`, UTC and two unknown zones. The earlier probe agreed.                                               |
| V7         | Do the generated SVG template glyphs render correctly?                                                                                             | Pending CI                                                                                                                                                                    | The contact sheet: `GlyphSnapshotTests` (Unit plan) draws each glyph from SnowKit's catalogue, whole and as its still and drift layers, in its band's ink on its gradient, without forcing template rendering. If they don't render as the website draws them, or show black, SnowKit switches to `Fallback/Glyphs.xcassets`, the same sets as PNGs: two lines in IsItKit's `Package.swift`.                                                                                                                                                                                                                                                                                          | resvg renders all 16 SVGs as the website draws them (the PNG fallback is its output). Core SVG is unproven until the first `ios` run.                                                                                                                                                                                                                                                                                                             |
| V11        | Do Google Mobile Ads 13.11.0 and UMP 3.1.0 resolve and cache through SPM on the runner? Is the demo app ID right? Does UMP's debug geography work? | Resolve and cache: pending CI. App ID and geography: settled on the simulator by 3f91596's run (the demo banner in the band under `other`, Google's consent form under `eea`) | The `ios` job's `Resolve packages` step (only the committed versions) and the `.spm` cache, whose hit or miss the run summary shows; the build then compiles IsItAds against both SDKs. Settled by the first green `ios` run and the cache hit on the run after it. The demo app ID and the debug geography: `AdsTests` (UI plan), whose band under `-umpGeography other` shows Mobile Ads started with the demo app ID, and whose consent form under `eea` shows the geography works on the simulator; each skips when Google doesn't answer, which settles nothing.                                                                                                                 | Only the pins so far: `swift package resolve` on Linux resolved both at their tags' revisions, which match `git ls-remote`, but stopped before the binary zips (dl.google.com is blocked here). The runner is the first to download, check and cache them. App ID and geography: none yet, as no run has started the ads; the Info.plist's app ID is Google's demo one (`check-archive.sh` checks it).                                            |
| V13        | Will `xcodebuild` run the iPhone-only app on an iPad simulator, in compatibility mode?                                                             | Pending CI                                                                                                                                                                    | `ipad-compat` in `ios-nightly.yml` (spec section 18.2), which is still to be written. If not: `simctl install`, then `simctl io` screenshots for an agent to review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | None yet.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 8.1        | Does a tap on a notification with the app force-quit open its place (`didReceive` on a cold start in a SwiftUI app)?                               | Settled: the tap opens the place (Carl's iPhone, 8 November 2026)                                                                                                             | Carl's check in docs/SETUP.md ("The app's notifications (phases 8.1 and 8.2)", the cold start): send a test, swipe the app away at once, then tap the banner. If the app opens on the home screen only, `AppDelegate` gains `application(_:configurationForConnecting:options:)`, posting `options.notificationResponse`'s payload, de-duplicated by the request's identifier (DECISIONS, "The iPhone app's notifications (phases 8.1 and 8.2)")                                                                                                                                                                                                                                      | Carl's iPhone, 8 November 2026, with the TestFlight build of 3 November: a test sent, the app swiped away at once, the banner tapped, and the app opened on the place. So `didReceive` fires on a cold start here, and the fallback isn't needed.                                                                                                                                                                                                 |
| 8.1 banner | Does `simctl push` show the banner on the runner's iOS 26.5 simulator?                                                                             | Shown on PR #43 (twice), #44, #45 and #46; missed on main's run on 1d643d3, why not yet known                                                                                 | `ci/push.sh` in the `ios` job, after the UI plan on its simulator, where NotificationPermissionTests allowed notifications: the banner over the app and on the Home Screen, each looked for in screenshots taken one after another against the screen at rest, every read timed from the push, with the permission the app reads and the simulator's log of the step kept. A miss is read from that log, never met with a longer wait or a skip                                                                                                                                                                                                                                       | Main's run on 1d643d3 saw no banner after either push, with the permission granted in the simulator's log, which ended before the step (DECISIONS, "What main's run on 1d643d3 showed"). Look at both shots on the contact sheet too                                                                                                                                                                                                              |

## Not here yet

Each comes with the phase that needs it, so nothing in the skeleton is dormant:

- the launch screen's `LaunchBackground` colour, from the palettes, which belongs in the
  generated `Assets.xcassets`;
- the upgrade page's live widget previews and the composed widget screenshot (7.3), and the App
  Shortcut (7.4): cut by Carl, for 1.1 (spec 23.3); 7.2 leaves each a few lines away (DECISIONS);
- the `ImageRenderer` snapshots of every page, band and text size in the Unit plan (spec
  sections 16 and 17.2, Large, XXXL and AX3): the pages scroll, and `ImageRenderer` doesn't draw
  a scroll view, so they wait for the page's content to be drawn apart from its scroll view;
  until then the UI tests' screens at Large and AX3 are the contact sheet's (phase 5.4);
- the rest of `SnowKit`;
- `FEATURE_UNLOCK` and `FEATURE_ADS` (spec section 9.8): the purchase (phase 7.1) and the ads
  (phase 8.3) are in, and no build leaves either out. `FEATURE_UNLOCK` is built, as a pull
  request of its own, only if the Paid Apps Agreement isn't Active by Mon 2 Nov, for spec 23.5's
  fallback (DECISIONS, "The purchase in the iPhone app (phase 7.1)");
- the Screenshots test plan and `ios-nightly.yml`, which is to keep `SKAdNetworkItems` current
  (copied by hand until then, phase 8.3);
- the release job's `rc-archive` artefact (spec section 21.2), with the release candidate;
- App Attest or DeviceCheck against junk registrations: Carl's decision before public launch
  (DECISIONS, "Notifications: the devices endpoints" and "The iPhone app's notifications (phases
  8.1 and 8.2)").
