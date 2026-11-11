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
  notifyHere,
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
      // The app's part of the notice, after the website's (its adverts last: the disclosures
      // AdSense requires) and before the rights that cover both.
      await expect(main.locator('h2')).toHaveText([
        'Location',
        'What stays on your device',
        'Who else processes data',
        'Adverts on the websites',
        'Our apps',
        'Your rights',
      ]);
      await expect(main.locator('h2:text-is("Our apps") + p')).toHaveText(
        'The willitsnow.today app for iPhone works like this website: it sends the place you ask about (a town, or your location rounded to about 5 km) and your units to our server to get the forecast. As on the website, until you choose a place it uses a rough location from your IP address, place searches go to Open-Meteo, and it keeps your place, units, recent and saved places, your notification choices and last answer on your iPhone. It has no accounts.',
      );
      const items = main.locator('h2:text-is("Our apps") + p + ul > li');
      await expect(items).toHaveText([
        // Every place a phone has notifications for, and its check-ins: hourly while where it is
        // comes from its connection (DECISIONS, "Notifications: several places on one phone").
        "Notifications. If you turn on notifications in the app, so we can tell you when snow is likely, we keep your device's notification token for the app, your units, which notifications you asked for and the places you get notifications for, with their time zones: " +
          "where you are (your location rounded to about 5 km or, if you haven't shared it, a rough place estimated from your IP address, but not the address itself) and any saved places you turned notifications on for. " +
          // Only a saved place's record holds the phone's zone (decisions 16 and 21).
          "While you have those, we also keep your iPhone's time zone. " +
          "With all of this we keep an ID made from the token, the app's version, whether it is a developer build, when you turned notifications on and when the app last checked in with us. " +
          'It checks in when you open it: at most once an hour while it uses a rough place from your internet connection, otherwise at most once a week, unless you change something. ' +
          'We delete all of this when you turn notifications off in the app, when Apple tells us the app is no longer installed, or 90 days after the app last checked in, so about 90 days after you last opened it. ' +
          "If you turn notifications off in your iPhone's Settings instead, we delete it the next time you open the app. " +
          'For a few days after each notification and each test, and after some forecast checks that found nothing to send, we also keep a note of it, even once the rest is deleted, so nothing is sent or checked twice and tests keep to 3 an hour; it holds no token or place. ' +
          "Notifications are sent through Apple's push service. Our server and its storage are run by Netlify, in the United States. " +
          `In the app, ${settings} → ${yourPrivacy} shows the ID and the main things we keep, and "${deleteMyData}" deletes them.`,
        'Ads in the app. The free version shows ads from Google AdMob. ' +
          `In the UK and the EEA, Google's consent message asks for your choice first, and ${settings} → ${privacyChoices} lets you change it. ` +
          'Google may collect device identifiers, advertising data, usage and diagnostics, and an approximate location from your IP address. ' +
          "See Google's privacy policy. The app keeps on your iPhone when it last showed a full-screen ad, so it shows one at most every 5 minutes. " +
          'The one-off purchase turns the ads off.',
        "Purchases. Apple handles purchases. We never see your payment details. The app keeps a note on your iPhone of whether you've made the one-off purchase.",
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
        // Phase 8.4b: the purchase names saved places' notifications, as its display name does.
        'The one-off purchase that removes the ads, adds the widgets and adds notifications for saved places belongs to your Apple Account. It normally comes back by itself on a new iPhone or after you reinstall the app. ' +
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
        // The times the app's switches give, at each place, one a day for each (design 2.9);
        // and Apple keeps one notification for an app that is offline (decision 37).
        `It isn't time yet. The evening notification comes at ${timeOf(APP_COPY.evening)} and the morning one at ${timeOf(APP_COPY.morning)}, ` +
          "in the place's own time, not your phone's. Each comes at most once a day for each place. " +
          'If your iPhone was off or offline, Apple keeps the evening one until 9pm and the morning one until 11am, then drops it. ' +
          'Apple keeps only one at a time, so with several places you may get only one of them.',
        // iPhone Settings, named as such: the app's own is "the app's Settings".
        `Notifications are off on your iPhone. In your iPhone's Settings → Notifications, check that "${APP_NAME}" is allowed to send them, and that no Focus is holding them back.`,
        // Since phase 8.4a the free notification follows where you are, never the place on
        // screen, and Settings names it under its own row; since 8.4b saved places with a bell on
        // have them too (decision 6), in Your privacy's words, so the line is true on its own.
        "It's for another place. Notifications are for where you are and any saved places you turned them on for, " +
          'not whichever place is on screen. ' +
          'Where you are is your location if you share it with the app, otherwise a rough place from your internet connection. ' +
          `It moves only when you open the app. The app's ${notifyIn} shows it, under "${notifyHere}".`,
        // Phase 8.4b: every other place is a saved one, with the purchase, silent in the phone's
        // night (design 2.10, decision 21).
        "It's for a saved place. Notifications for saved places come with the one-off purchase, and each saved place's bell turns them on. " +
          'From 9pm to 7am on your iPhone they arrive silently, in Notification Centre.',
        // About: 90 days from the app's last check-in, which can be up to a week before it was
        // last opened.
        "The app hasn't been opened for about three months. Notifications then stop. Opening the app starts them again.",
      ]);
      await expect(main.locator(`h2:text-is("If a notification didn't come") + ul + p`)).toHaveText(
        // By the phone's clock with a saved place, at where you are without (decision 25).
        `"${sendTest}" in the app's ${notifyIn} checks that they reach your iPhone. ` +
          'Tests are never sent between 9pm and 7am, so try one in the daytime.',
      );
      await expect(answer('Turning notifications off and deleting your data')).toHaveText(
        `In the app, open ${settings} → ${yourPrivacy} and tap "${deleteMyData}". ` +
          // Every place, and the iPhone's zone a saved place's record keeps (design 2.8, 3.11).
          "That turns every notification off and deletes what we keep for them: your device's notification token and an ID made from it, the places you get notifications for and their time zones, your iPhone's time zone if you had notifications on for a saved place, your units, which notifications you chose, the app's version and whether it is a developer build, and when you turned notifications on and when the app last checked in with us. " +
          'Our notes of notifications, tests and forecast checks, which hold no token or place, go a few days later. ' +
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
