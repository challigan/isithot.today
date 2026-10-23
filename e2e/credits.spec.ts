/**
 * Credits and legal wording on all four sites (served here under '', /wet, /snow and /wind): every
 * page's footer carries the API's credits, with "Weather data by Open-Meteo.com" linked as
 * Open-Meteo's licence asks and both licences linked; About names the sources and licences; Privacy
 * gives the contact address and covers the app; Terms ask for fair use rather than non-commercial
 * use; Cookies say what declining consent means; Support gives the contact address and answers
 * about the snow app alone. The app's labels both quote are its own (APP_COPY), and so is the
 * name under its icon (Info.plist).
 */
import { readFileSync } from 'node:fs';
import { CONTACT_EMAIL, MODELS, SITES } from '../packages/core/src/config';
import { ATTRIBUTION } from '../packages/core/src/copy';
import { APP_COPY } from '../packages/mobile/src/appCopy';
import { expect, test } from './helpers';

const PREFIXES = ['', '/wet', '/snow', '/wind'];
const LICENCES = {
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
};

/** The name under the app's icon, as the widget gallery and iPhone Settings list it. */
const APP_NAME = /<key>CFBundleDisplayName<\/key>\s*<string>([^<]+)<\/string>/.exec(
  readFileSync(new URL('../apps/ios/Apps/Snow/Resources/Info.plist', import.meta.url), 'utf8'),
)![1]!;
/** "about 6pm", from the switch "Evening before (about 6pm)". */
const timeOf = (label: string): string => /\((about \d{1,2}[ap]m)\)$/.exec(label)![1]!;
const {
  settings,
  restore,
  widgetName,
  notifications,
  possible,
  notifyPlaceMyLocation,
  sendTest,
  yourPrivacy,
  deleteMyData,
  privacyChoices,
} = APP_COPY;

test('every page credits the data, with the sources and licences linked', async ({ page }) => {
  for (const path of [
    '/',
    '/wet',
    '/snow',
    '/wind',
    '/in/london-gb',
    '/snow/about',
    '/wind/about',
  ]) {
    await page.goto(path);
    const credit = page.locator('.site-footer .credit');
    for (const text of ATTRIBUTION) await expect(credit, path).toContainText(text);
    const link = (name: string) => credit.getByRole('link', { name, exact: true });
    await expect(link('Weather data by Open-Meteo.com'), path).toHaveAttribute(
      'href',
      'https://open-meteo.com/',
    );
    for (const [name, href] of Object.entries(LICENCES)) {
      await expect(link(name), path).toHaveAttribute('href', href);
    }
    await expect(link('NASA POWER'), path).toHaveAttribute('href', 'https://power.larc.nasa.gov/');
  }
});

test.describe('the legal pages', () => {
  for (const prefix of PREFIXES) {
    test(`About, Privacy, Terms, Cookies and Support on ${prefix || '/'}`, async ({ page }) => {
      await page.goto(`${prefix}/about`);
      const main = page.locator('main');
      await expect(main.getByRole('heading', { name: 'Data sources' })).toBeVisible();
      // Each model with the agency that runs it, from MODELS, so a dropped model drops out.
      const sources = main.locator('h2:text-is("Data sources") + p');
      await expect(sources).toContainText(`from ${MODELS.length} models run by ECMWF, NOAA (GFS),`);
      for (const { name } of MODELS) await expect(sources).toContainText(name);
      for (const agency of ['DWD', 'the Met Office', 'Environment and Climate Change Canada']) {
        await expect(sources).toContainText(agency);
      }
      await expect(sources).toContainText('We combine and modify them');
      for (const text of ATTRIBUTION.slice(0, 2)) await expect(main).toContainText(text);
      for (const [name, href] of Object.entries(LICENCES)) {
        await expect(main.getByRole('link', { name, exact: true }).first()).toHaveAttribute(
          'href',
          href,
        );
      }
      await expect(main).toContainText(
        '"There are no restrictions on the use, access, and/or download of data from the NASA POWER Project."',
      );

      await page.goto(`${prefix}/privacy`);
      await expect(main.getByRole('link', { name: CONTACT_EMAIL })).toHaveAttribute(
        'href',
        `mailto:${CONTACT_EMAIL}`,
      );
      await expect(main).not.toContainText('to be added');
      // The app's part of the notice, after the website's and before the rights that cover both.
      await expect(main.locator('h2')).toHaveText([
        'Location',
        'What stays on your device',
        'Who else processes data',
        'Our apps',
        'Your rights',
      ]);
      await expect(main.locator('h2:text-is("Our apps") + p')).toHaveText(
        'The willitsnow.today app for iPhone works like this website: it sends the place you ask about (a town, or your location rounded to about 5 km) and your units to our server to get the forecast. As on the website, until you choose a place it uses a rough location from your IP address, place searches go to Open-Meteo, and it keeps your place, units, recent places and last answer on your iPhone. It has no accounts.',
      );
      const items = main.locator('h2:text-is("Our apps") + p + ul > li');
      await expect(items).toHaveText([
        "Notifications. If you turn on notifications in the app, we keep your device's notification token for the app, the place you chose (a town, or a location rounded to about 5 km), its time zone, your units and which notifications you asked for, so we can tell you when snow is likely. " +
          "With them we keep an ID made from the token, the app's version, whether it is a developer build, when you turned notifications on and when the app last checked in with us. It checks in when you open it: at most once a week, unless you change something. " +
          'We delete all of this when you turn notifications off in the app, when Apple tells us the app is no longer installed, or 90 days after the app last checked in, so about 90 days after you last opened it. ' +
          "If you turn notifications off in your iPhone's Settings instead, we delete it the next time you open the app. " +
          'For a few days after each notification and each test, we also keep a note that it was sent, even once the rest is deleted, so a notification is never sent twice and tests keep to 3 an hour; it holds no token or place. ' +
          "Notifications are sent through Apple's push service. Our server and its storage are run by Netlify, in the United States. " +
          `In the app, ${settings} → ${yourPrivacy} shows the ID and the main things we keep, and "${deleteMyData}" deletes them.`,
        'Ads in the app. The free version shows ads from Google AdMob. ' +
          `In the UK and the EEA, Google's consent message asks for your choice first, and ${settings} → ${privacyChoices} lets you change it. ` +
          'Google may collect device identifiers, advertising data, usage and diagnostics, and an approximate location from your IP address. ' +
          "See Google's privacy policy. The one-off purchase turns the ads off.",
        'Purchases. Apple handles purchases. We never see your payment details.',
      ]);
      await expect(
        items.nth(1).getByRole('link', { name: "Google's privacy policy" }),
      ).toHaveAttribute('href', 'https://policies.google.com/privacy');
      // The rights cover the app too, where notifications keep something tied to a device.
      await expect(main.locator('h2:text-is("Your rights") + p')).toHaveText(
        'Under UK GDPR you can ask what we hold about you and ask us to delete it. The websites keep no personal data tied to you, so for them there is usually nothing to find. ' +
          `If you use notifications in the app, ${settings} → ${yourPrivacy} shows the main things we keep and "${deleteMyData}" deletes them, or you can email us the ID it shows. ` +
          `Contact: ${CONTACT_EMAIL}.`,
      );
      await expect(main).toContainText('This notice covers all four, and our iPhone app (below).');
      // The website's own paragraphs stay as they were.
      await expect(main).toContainText('There are no accounts and we do not sell personal data.');

      await page.goto(`${prefix}/terms`);
      await expect(main).not.toContainText('non-commercial');
      await expect(main).toContainText('Do not scrape them in bulk with automated tools');
      await expect(main).toContainText('nothing in these terms limits what those licences allow');

      await page.goto(`${prefix}/cookies`);
      await expect(main).not.toContainText('non-personalised advert');
      await expect(main).toContainText(
        'If you decline, Google shows a limited advert, which uses no cookies, or no advert at all.',
      );

      // Support, the App Store listing's Support URL, from every page's footer: the address, then
      // the four answers.
      await page.locator('.site-footer').getByRole('link', { name: 'Support' }).click();
      await expect(page).toHaveURL(new RegExp(`${prefix}/support$`));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Support');
      await expect(main.getByRole('link', { name: CONTACT_EMAIL })).toHaveAttribute(
        'href',
        `mailto:${CONTACT_EMAIL}`,
      );
      await expect(main.locator('h2')).toHaveText([
        'Contact us',
        'Restoring a purchase',
        'Adding a widget',
        "If a notification didn't come",
        'Turning notifications off and deleting your data',
        'Privacy and terms',
      ]);
      const answer = (heading: string) => main.locator(`h2:text-is("${heading}") + :is(p, ul)`);
      // Every answer in full, with the app's own words (APP_COPY) and name, so a label renamed in
      // the app fails here.
      await expect(answer('Restoring a purchase')).toHaveText(
        'The one-off purchase that removes the ads and adds the widgets belongs to your Apple Account. It normally comes back by itself on a new iPhone or after you reinstall the app. ' +
          `If it doesn't, open ${settings} in the app (the gear at the top right) and tap "${restore}". ` +
          "If no purchase is found, check that you're signed in with the Apple Account you bought it with. With Family Sharing, your family can restore it the same way.",
      );
      await expect(answer('Adding a widget')).toHaveText(
        'Widgets come with the one-off purchase, and show the place you chose in the app. ' +
          'On the Home Screen, touch and hold an empty part of it until the apps jiggle, then tap Edit and Add Widget (on iOS 17, tap + at the top left). ' +
          `Find "${APP_NAME}", choose "${widgetName}", swipe to pick a size and tap Add Widget. ` +
          'On the Lock Screen, touch and hold it, tap Customise, then Lock Screen. ' +
          `Tap the space below the time (or the date above it, for a one-line widget), find "${APP_NAME}" and choose "${widgetName}".`,
      );
      const notifyIn = `${settings} → ${notifications}`;
      await expect(answer("If a notification didn't come").locator('li')).toHaveText([
        "Snow wasn't likely enough. We send one only when most forecasts expect snow, " +
          `or when some do if you turned on "${possible}". Forecasts change, so a day that looked snowy may no longer be.`,
        // The times the app's switches give.
        `It isn't time yet. The evening notification comes at ${timeOf(APP_COPY.evening)} and the morning one at ${timeOf(APP_COPY.morning)}, ` +
          "in the place's own time, not your phone's. Each comes at most once a day. " +
          'If your iPhone was off or offline, Apple keeps the evening one until 9pm and the morning one until 11am, then drops it.',
        // iPhone Settings, named as such: the app's own is "the app's Settings".
        `Notifications are off on your iPhone. In your iPhone's Settings → Notifications, check that "${APP_NAME}" is allowed to send them, and that no Focus is holding them back.`,
        `It's for another place. Notifications are for the place in the app's ${notifyIn}, not the one on screen. ` +
          `"${notifyPlaceMyLocation}" moves it only when you open the app.`,
        // About: 90 days from the app's last check-in, which can be up to a week before it was
        // last opened.
        "The app hasn't been opened for about three months. Notifications then stop. Opening the app starts them again.",
      ]);
      await expect(main.locator(`h2:text-is("If a notification didn't come") + ul + p`)).toHaveText(
        `"${sendTest}" in the app's ${notifyIn} checks that they reach your iPhone. ` +
          'Tests, like notifications, are never sent between 9pm and 7am at the place, so try one in the daytime there.',
      );
      await expect(answer('Turning notifications off and deleting your data')).toHaveText(
        `In the app, open ${settings} → ${yourPrivacy} and tap "${deleteMyData}". ` +
          "That turns every notification off and deletes what we keep for them: your device's notification token and an ID made from it, the place, its time zone, your units, which notifications you chose, the app's version and whether it is a developer build, and when you turned notifications on and when the app last checked in with us. " +
          'Our notes that a notification or a test was sent, which hold no token or place, go a few days later. ' +
          'The same screen shows the ID and the main things we keep while notifications are on. ' +
          `Turning every notification off in the app's ${notifyIn} deletes it too. ` +
          "If you turn notifications off in your iPhone's Settings instead, we delete it the next time you open the app. " +
          'If you delete the app, we delete it when Apple tells us the app is no longer installed. ' +
          "Either way, it goes once the app hasn't been opened for about three months.",
      );
      // No postal address: the email is the contact (Q7).
      await expect(main).not.toContainText(/PO box|postcode|street/i);
      const terms = answer('Privacy and terms');
      await expect(
        terms.getByRole('link', { name: 'privacy notice', exact: true }),
      ).toHaveAttribute('href', `${prefix}/privacy`);
      await expect(terms.getByRole('link', { name: 'terms', exact: true })).toHaveAttribute(
        'href',
        `${prefix}/terms`,
      );
      // About the snow app alone: no other site or weather, whichever site serves it.
      const text = (await main.textContent())!;
      for (const { name } of Object.values(SITES)) {
        if (name !== SITES.snow.name) expect(text).not.toContain(name);
      }
      expect(text).not.toMatch(/\b(hot|heat|rain|wet|wind|windy)\b/i);
    });
  }
});
