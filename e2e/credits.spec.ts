/**
 * Credits and legal wording on all three sites (served here under '', /wet and /snow): every
 * page's footer carries the API's credits, with "Weather data by Open-Meteo.com" linked as
 * Open-Meteo's licence asks and both licences linked; About names the sources and licences; Terms
 * ask for fair use rather than non-commercial use; Cookies say what declining consent means.
 */
import { MODELS } from '../packages/core/src/config';
import { ATTRIBUTION } from '../packages/core/src/copy';
import { expect, test } from './helpers';

const PREFIXES = ['', '/wet', '/snow'];
const LICENCES = {
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
};

test('every page credits the data, with the sources and licences linked', async ({ page }) => {
  for (const path of ['/', '/wet', '/snow', '/in/london-gb', '/snow/about']) {
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
    test(`About, Terms and Cookies on ${prefix || '/'}`, async ({ page }) => {
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

      await page.goto(`${prefix}/terms`);
      await expect(main).not.toContainText('non-commercial');
      await expect(main).toContainText('Do not scrape them in bulk with automated tools');
      await expect(main).toContainText('nothing in these terms limits what those licences allow');

      await page.goto(`${prefix}/cookies`);
      await expect(main).not.toContainText('non-personalised advert');
      await expect(main).toContainText(
        'If you decline, Google shows a limited advert, which uses no cookies, or no advert at all.',
      );
    });
  }
});
