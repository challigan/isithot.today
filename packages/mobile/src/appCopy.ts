/**
 * Every string the app says that the website doesn't (iOS build spec, section 10.9), and the one
 * place app copy lives: `pnpm mobile:generate` writes it into `AppCopy.swift`, and no Swift file
 * types a user-facing string of its own. Strings the website shares are core's (`CoreCopy`), and
 * the server words the answers.
 *
 * British English in sentence case. A `{name}` slot is filled by the app: in Swift each string
 * with slots is a function taking them, `AppCopy.placeButtonLabel(place:)`. The app never names
 * another app, website or weather type, and says "the app" for itself where the spec said
 * "willitsnow", since the name under the icon is "will it snow?" (Carl's Q2).
 */
export const APP_COPY = {
  // Home (10.2)
  placeButtonLabel: 'Place: {place}. Change place.',
  // The same button while no place is known, after what it shows (core's "Finding you…"), as
  // the website's place button reads it ("…, change location").
  placeButtonUnknown: '{status}, change place.',
  settings: 'Settings',
  // The app's name at the top left as VoiceOver reads it, its words: read as written, the
  // audit judged "willitsnow.today" not human-readable (DECISIONS, "The app's name back at the
  // top left").
  appNameLabel: 'Will it snow today',
  slugGone: 'That place is no longer available. Showing your approximate location.',
  offline: "You're offline. Showing the forecast from {time}.",
  staleApp: 'No recent forecast. Connect to the internet to refresh.',
  cardChosen: 'Get a notification the evening before snow is likely here.',
  cardApprox: 'Choose a place for notifications: use your location or search for a town.',
  turnOn: 'Turn on',
  notNow: 'Not now',
  search: 'Search',
  upgradeRow: 'No ads, plus widgets for your home and lock screen · {price}',
  // The page's question and answer as VoiceOver reads them, one heading with the place (10.2,
  // 16), and a row of the model list under the strip (10.2).
  headingLabel: '{place}. {question} {answer}',
  modelLine: '{name} · {value}',
  // After each place under "Nearby:" but the last, outside its underline, as the website joins
  // them (Views.astro, ", "): the space after it is the layout's.
  listComma: ',',
  // What VoiceOver is told when the page says something new (16): the heading, then the verdict,
  // as the website's live region holds and reads the two.
  announcement: '{heading} {verdict}',
  // Now's rows and the week's (10.2, 16). An hour's chance on screen ("60%"), and as VoiceOver
  // reads the row ("60% chance at 6pm", as the website's screen readers hear it); a day of the
  // week as VoiceOver reads it ("Tuesday, 2cm, snow, 4 of 6 forecasts expect snow"), without the
  // agreement for an answer from before the week's days had one. The agreement is core's
  // `snowAgreementLine`, which the server words for a day but not for the week's days.
  percent: '{value}%',
  hourRowLabel: '{chance} chance at {time}',
  weekRowLabel: '{day}, {amount}, {band}, {agreement}',
  weekRowLabelShort: '{day}, {amount}, {band}',
  dayAgreement: '{snowy} of {total} forecasts expect snow',
  dayAgreementOne: '{snowy} of {total} forecasts expects snow',

  // Place picker (10.3). The rest of its words are core's: the title ("Search for a place"),
  // the search box's prompt, "Use my location", "Finding you…", too short, no results, location
  // access off, and Close. The two here are for a search the phone couldn't send and a location
  // fix that found nothing with permission given: neither blames the forecasts.
  recent: 'Recent',
  // Saved places, above Recent with nothing typed: the heading (also a saved result's value, as
  // VoiceOver reads the row), the line with none saved yet, and the line once the list is full,
  // `max` being client `PLACES.savedMax`. A star saves or removes the place beside it: its
  // VoiceOver label, the same words in a row's press-and-hold menu, and what VoiceOver is told
  // after a tap. Recent's own menu forgets a place (`deleteRecent`), and VoiceOver is told so
  // (`placeDeleted`), as after a star: the row leaves the list with the focus on it.
  saved: 'Saved',
  savedHint: 'Tap the star beside a place to save it here.',
  savedFull: 'You can save up to {max} places. Remove one to save another.',
  savePlace: 'Save {place}',
  unsavePlace: 'Remove {place} from saved places',
  placeSaved: '{place} saved.',
  placeUnsaved: '{place} removed from saved places.',
  deleteRecent: 'Delete',
  placeDeleted: '{place} deleted from recent places.',
  // The search box is the app's own, not the system's search (`.searchable`), whose clear
  // button, about 20 points square, the accessibility audit failed as too small to tap on PR
  // #33's second macOS run, and which SwiftUI doesn't let the app change: this is its own clear
  // button's label, read by VoiceOver beside its icon.
  clearSearch: 'Clear search',
  searchOffline: "You're offline. Connect to the internet to search.",
  locationUnavailable: "Couldn't find your location. Search for a place instead.",
  // The location permission's purpose string (15.2), `NSLocationWhenInUseUsageDescription`, which
  // the app's Info.plist reads from the generated Configs/Generated/Copy.xcconfig.
  locationPurpose:
    'Your location shows whether it will snow where you are. It is rounded to about 5 km before ' +
    'it leaves your phone. If you turn on notifications for your location, that rounded location ' +
    'is kept so we can tell you when snow is likely.',

  // Upgrade (10.4, 10.5)
  upgradeTitle: 'Remove ads and add widgets',
  upgradeSettings: 'Remove ads and add widgets · {price}',
  upgradeBody:
    'A one-off purchase. No ads in the app, and widgets for your home screen and lock screen. ' +
    'Notifications and everything else stay free.',
  familySharing: 'Shared with your family through Family Sharing.',
  thanks: 'Thank you. Ads are off and widgets are on.',
  pending: 'Waiting for approval.',
  restore: 'Restore purchase',
  restored: 'Purchase restored.',
  nothingToRestore: 'No purchase found for this Apple Account.',

  // Settings (10.4) and notifications (12.1)
  unitsFootnote: 'Temperatures follow: cm with °C, inches with °F.',
  notifications: 'Notifications',
  evening: 'Evening before (about 6pm)',
  eveningNote: 'When snow is likely tomorrow.',
  morning: 'On the day (about 7am)',
  morningNote: 'When snow is likely today.',
  possible: 'Also when snow is possible',
  possibleNote: 'When some forecasts expect snow, but not most.',
  notifyPlace: 'Place',
  notifyPlaceOnScreen: 'Use the place on screen: {place}',
  notifyPlaceMyLocation: 'Use my location',
  notifyFollows: 'Follows your location each time you open the app.',
  needsPlace: 'Choose a place for notifications: use your location or search for a town.',
  sendTest: 'Send a test notification',
  testSent: 'Sent. It should arrive in a few seconds.',
  testLimited: 'You can send 3 test notifications an hour. Try again later.',
  testFailed: "Couldn't send a test notification. Try again later.",
  notifyFooter:
    'These are forecasts, not official warnings. Times are at the place. Open the app at least ' +
    'every few months to keep notifications on.',
  notifyDenied: 'Notifications are off for this app in Settings.',
  openSettings: 'Open Settings',

  // Settings' sections (10.4): the headings of the privacy, about and help rows.
  settingsPrivacy: 'Privacy',
  settingsAbout: 'About',
  settingsHelp: 'Help',

  // Privacy (10.4, 10.6). Your privacy's lines say what the website's privacy notice says ("Our
  // apps", PrivacyBody.astro), as the notifications server stores and deletes it
  // (packages/server devices.ts): a town, or a location rounded to about 5 km; until a place is
  // chosen, a rough one from the connection; the token with an ID made from it, the place and
  // its zone, the units, the switches, and a few details more (the app's version, when it last
  // checked in), deleted when notifications go off in the app, when Apple says the app is gone,
  // or about 90 days after the app was last opened (it checks in at most weekly), and after
  // notifications go off in iPhone Settings, at the next open; the run's and the test button's
  // notes, keyed by the ID with no token or place, go a few days later, at the run's cleanup:
  // sent/ (a notification sent), test/ (a test sent) and judged/ (a registration a run judged
  // with nothing to send, in a zone it left unfinished, so the next run skips it: "some forecast
  // checks that found nothing to send"). Searches go to Open-Meteo, and the phone keeps the place,
  // units, recent and saved places and last answer, none of which leaves it but the place chosen
  // (phase 8 adds the notification choices to both this line and the notice's). "See Privacy choices." follows the ads line only while that row is
  // in Settings.
  privacyChoices: 'Privacy choices',
  yourPrivacy: 'Your privacy',
  privacyPolicy: 'Privacy policy',
  privacyForecast:
    'To get the forecast, the app sends the place (a town, or your location rounded to about ' +
    '5 km) and your units to our server. Until you choose a place, our server estimates a rough ' +
    'one from your internet connection. Place names you search for go to Open-Meteo, our ' +
    'forecast provider, to find matching places. The app keeps your place, units, recent and ' +
    'saved places and the last forecast on your iPhone.',
  privacyNotifications:
    "Only while notifications are on, we keep your device's notification token, an ID made from " +
    'it, the place, its time zone, your units and which notifications you chose, with a few ' +
    "details such as the app's version and when it last checked in. We delete them when you turn " +
    'notifications off in the app, when Apple tells us the app is no longer installed, or about ' +
    "90 days after you last open it. If you turn notifications off in your iPhone's Settings " +
    'instead, we delete them the next time you open the app. For a few days after each ' +
    'notification and each test, and after some forecast checks that found nothing to send, we ' +
    'also keep a note of it, even once the rest is deleted. It holds no token or place.',
  privacyAds: 'In the free version, Google shows the ads and may collect device and usage data.',
  seePrivacyChoices: 'See Privacy choices.',
  privacyPurchases: 'Apple handles purchases. We never see your payment details.',
  privacyAccounts: 'There are no accounts.',
  keptForNotifications: 'What we keep for notifications',
  deleteMyData: 'Turn off notifications and delete my data',

  // Report an ad (10.7)
  reportAd: 'Report an ad',
  reportAdSubject: 'Report an ad (willitsnow.today {version})',
  reportAdMail: 'Time: {time}\nPlace: {place}\nWhat was wrong with the ad:\n',
  reportAdBody: 'Email {email} with a screenshot of the ad and the time you saw it.',
  copyAddress: 'Copy address',
  // Not section 10.9's "Copied.": one word with a full stop was "not human-readable" to the
  // accessibility audit on PR #33's two macOS runs, whatever its identifier and its sheet, where
  // every label of more than one word passed. On screen and as VoiceOver's announcement.
  copied: 'Address copied.',

  // About and help (10.4, 10.6). Contact us opens an email; with no mail app, a sheet says where
  // to write instead, as Report an ad's does (the support page's words).
  credits: 'Credits and licences',
  terms: 'Terms',
  contactUs: 'Contact us',
  contactUsBody:
    'Email {email}. Tell us what happened, and the version number at the end of Settings.',
  support: 'Support',
  version: 'Version {version} ({build})',

  // How it works (10.6): the About page's snow section and its location and data paragraphs,
  // rewritten for the app, without the paragraph about the four sites. The numbers are slots
  // the app fills from the generated constants (core SNOW and MODELS), so the text can't drift
  // from the judging; the agencies are the credits' list (AppCredits.modelAgencies).
  howIntro:
    'The app answers one question: will it snow where you are? Here is how it gets from a pile ' +
    'of forecasts to one answer.',
  howAnswer: 'The answer',
  howModels:
    'We ask {count} forecast models how much snow they expect, hour by hour, as a depth of fresh ' +
    'snow: {depth} cm for every 10 mm of water, the usual ratio. A model expects snow when it ' +
    'forecasts at least {day} cm for the day. For a shorter stretch, like the rest of an ' +
    'evening, less is enough: {hour} cm for each hour that is left.',
  howChance:
    'The share of models expecting snow is the chance. When {likely}% or more of them do, the ' +
    'answer is yes; from {maybe}%, it is maybe. How much snow comes from the middle forecast ' +
    '(the median).',
  howWarm:
    'In an hour warmer than {warm}°C, nothing counts as snow, whatever a model says. When the ' +
    'answer is no, it says why, with the lowest temperature expected.',
  howWeek:
    "The week's answer is yes when any day brings snow. Where long-term climate records cover " +
    'the place, we also say whether snow is rare or common there at this time of year, and ' +
    'compare the week with normal. Snow depends so much on height that we only do this where the ' +
    "records' 50 km grid cell is within {height} m of the place's height. Amounts are fresh " +
    'snowfall, not what will be lying on the ground: some of it may melt as it lands.',
  howLocation: 'Your location',
  howLocationBody:
    'Until you choose a place, the app uses an approximate location from your internet ' +
    "connection. If you allow it, your phone's location is used instead, rounded to about 5 km " +
    'before it leaves your phone. You can also search for any place.',
  howData: 'Data sources',
  forecastModels:
    'The forecasts come from {count} models run by {agencies}. We combine and modify them: the ' +
    "blended figures and the answers are our own work, not the weather services'.",
  howEstimates:
    'Forecasts are estimates. For anything that matters, check your national weather service.',

  // Credits and licences (10.6): the two headings. The credits themselves are core's and
  // credits.ts's (AppCredits), and the licences' full texts are bundled files.
  creditsData: 'Forecasts and data',
  creditsSoftware: 'Typeface and software',
  // A notice's project link, as VoiceOver and the audit read it ("Bricolage Grotesque's project
  // page"); the screen shows the URL, its value. A URL as a label was "not human-readable" to the
  // audit on PR #33's second macOS run.
  noticeProjectPage: "{name}'s project page",

  // The Debug recorder's two lines (`-openURLs`, DebugHooks.swift), in Debug builds only, for the
  // UI tests: their labels, whose values are the last URL the app would have opened and the
  // units the last request asked in. A URL as a label was "not human-readable" to the audit on PR
  // #33's second macOS run. On screen each line is its label, then its value (`recorderLine`):
  // the value alone ("none", "f") under the longer label "Units last asked for" was "Text
  // clipped" on its third.
  recorderOpened: 'Last link opened',
  recorderUnits: 'Units last asked for',
  recorderLine: '{name}: {value}',

  // Widgets (11)
  widgetName: 'Snow forecast',
  widgetDescription: "Today's snow answer, then tomorrow's from 6pm.",
  widgetLocked: 'Open the app to turn on widgets.',
  widgetStale: 'No recent forecast. Open the app to refresh.',
  agreementShort: '{snowy} of {total} forecasts',

  // The App Shortcut (11.5). `{app}` is App Shortcuts' own token for the app's name. Not in
  // AppCopy.swift: see APP_INTENT_KEYS.
  intentTitle: 'Will it snow tomorrow?',
  intentPhrase: 'Will it snow tomorrow in {app}?',
} as const;

export type AppCopyKey = keyof typeof APP_COPY;

/**
 * The strings the app's Info.plist carries, by the build setting it reads each from: Info.plist
 * names `$(LOCATION_PURPOSE)`, which `Configs/Generated/Copy.xcconfig` sets (`exportConfigCopy.ts`).
 * They are in `AppCopy.swift` too, so a test of the built app can hold its Info.plist to them.
 */
export const INFO_PLIST_SETTINGS: Readonly<Record<string, AppCopyKey>> = {
  LOCATION_PURPOSE: 'locationPurpose',
};

/**
 * The strings App Intents reads when the app is built, not when it runs: the intent's `title`,
 * a `LocalizedStringResource` literal in the intent's own declaration, and the App Shortcut's
 * phrase, an `AppShortcutPhrase` literal with `{app}` written as `\(.applicationName)`. No
 * `String` constant or function can become either, so `AppCopy.swift` leaves them out, and the
 * phase that builds the intent (spec 11.5) generates them as those literals from here.
 */
export const APP_INTENT_KEYS: readonly AppCopyKey[] = ['intentTitle', 'intentPhrase'];
