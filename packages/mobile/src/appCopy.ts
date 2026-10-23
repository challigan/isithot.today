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

  // Place picker (10.3)
  recent: 'Recent',

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

  // Privacy (10.4, 10.6)
  privacyChoices: 'Privacy choices',
  yourPrivacy: 'Your privacy',
  privacyPolicy: 'Privacy policy',
  privacyForecast:
    'To get the forecast, the app sends the place (rounded to about 5 km) and your units to our ' +
    'server.',
  privacyNotifications:
    "Only while notifications are on, we keep your device's notification token, the place, its " +
    'time zone, your units and which notifications you chose. We delete them when you turn ' +
    'notifications off, when Apple tells us the app is gone, or 90 days after you last open the ' +
    'app.',
  privacyAds:
    'In the free version, Google shows the ads and may collect device and usage data. See ' +
    'Privacy choices.',
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

  // About and help (10.4, 10.6)
  credits: 'Credits and licences',
  terms: 'Terms',
  contactUs: 'Contact us',
  support: 'Support',
  version: 'Version {version} ({build})',

  // Widgets (11)
  widgetName: 'Snow forecast',
  widgetDescription: "Today's snow answer, then tomorrow's from 6pm.",
  widgetLocked: 'Open the app to turn on widgets.',
  widgetStale: 'No recent forecast. Open the app to refresh.',
  agreementShort: '{snowy} of {total} forecasts',

  // The App Shortcut (11.5). `{app}` is App Shortcuts' own token for the app's name.
  intentTitle: 'Will it snow tomorrow?',
  intentPhrase: 'Will it snow tomorrow in {app}?',
} as const;

export type AppCopyKey = keyof typeof APP_COPY;
