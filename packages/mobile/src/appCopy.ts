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

  // Place picker (10.3). The rest of its words are core's: the title ("Search for a place"),
  // the search box's prompt, "Use my location", "Finding you…", too short, no results, location
  // access off, and Close. The two here are for a search the phone couldn't send and a location
  // fix that found nothing with permission given: neither blames the forecasts.
  recent: 'Recent',
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
  // notifications go off in iPhone Settings, at the next open. "See Privacy choices." follows
  // the ads line only while that row is in Settings.
  privacyChoices: 'Privacy choices',
  yourPrivacy: 'Your privacy',
  privacyPolicy: 'Privacy policy',
  privacyForecast:
    'To get the forecast, the app sends the place (a town, or your location rounded to about ' +
    '5 km) and your units to our server. Until you choose a place, our server estimates a rough ' +
    'one from your internet connection.',
  privacyNotifications:
    "Only while notifications are on, we keep your device's notification token, an ID made from " +
    'it, the place, its time zone, your units and which notifications you chose, with a few ' +
    "details such as the app's version and when it last checked in. We delete them when you turn " +
    'notifications off in the app, when Apple tells us the app is no longer installed, or about ' +
    "90 days after you last open it. If you turn notifications off in your iPhone's Settings " +
    'instead, we delete them the next time you open the app.',
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
  copied: 'Copied.',

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
