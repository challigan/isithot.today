/**
 * Credits and legal wording on all four sites (served here under '', /wet, /snow and /wind): every
 * page's footer carries the API's credits, with "Weather data by Open-Meteo.com" linked as
 * Open-Meteo's licence asks and both licences linked; About names the sources and licences; Privacy
 * gives the contact address and covers the app; Terms ask for fair use rather than non-commercial
 * use; Cookies say what declining consent means; Support gives the contact address and answers
 * about the snow app alone.
 */
import { CONTACT_EMAIL, MODELS, SITES } from '../packages/core/src/config';
import { ATTRIBUTION } from '../packages/core/src/copy';
import { expect, test } from './helpers';

const PREFIXES = ['', '/wet', '/snow', '/wind'];
const LICENCES = {
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
};

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
        'The willitsnow.today app for iPhone works like this website: it sends the place you ask about (a town, or your location rounded to about 5 km) and your units to our server to get the forecast. It has no accounts.',
      );
      const items = main.locator('h2:text-is("Our apps") + p + ul > li');
      await expect(items.locator('strong')).toHaveText([
        'Notifications.',
        'Ads in the app.',
        'Purchases.',
      ]);
      await expect(items.nth(0)).toContainText(
        'We delete them when you turn notifications off, when Apple tells us the app is no longer installed, or 90 days after you last opened the app.',
      );
      await expect(items.nth(0)).toContainText(
        'In the app, Settings → Your privacy shows what we keep, and "Turn off notifications and delete my data" deletes it.',
      );
      await expect(items.nth(1)).toContainText(
        'The free version shows ads from Google AdMob. In the UK and the EEA,',
      );
      await expect(
        items.nth(1).getByRole('link', { name: "Google's privacy policy" }),
      ).toHaveAttribute('href', 'https://policies.google.com/privacy');
      await expect(items.nth(2)).toHaveText(
        'Purchases. Apple handles purchases. We never see your payment details.',
      );
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
      await expect(answer('Restoring a purchase')).toContainText('tap "Restore purchase"');
      await expect(answer('Adding a widget')).toContainText(
        'Widgets come with the one-off purchase',
      );
      await expect(answer('Adding a widget')).toContainText('Snow forecast');
      await expect(answer("If a notification didn't come").locator('li strong')).toHaveText([
        "Snow wasn't likely enough.",
        "It isn't time yet.",
        'Notifications are off on your iPhone.',
        "It's for another place.",
        "The app hasn't been opened for 90 days.",
      ]);
      await expect(answer('Turning notifications off and deleting your data')).toContainText(
        'In the app, open Settings → Your privacy and tap "Turn off notifications and delete my data".',
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
