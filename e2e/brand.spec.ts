/**
 * The header names the site of the question on screen, and links to it: on a page of one site
 * with another question showing, it reads (and goes to) that question's site. So do the tab's
 * icons and the home page's title. Locally every site shares one host, the others under their
 * prefixes, /wet and /snow (domains.spec.ts covers the real hosts).
 */
import type { Page } from '@playwright/test';
import { SITES, TOPICS, type Topic } from '../packages/core/src/config';
import { question } from '../packages/core/src/copy';
import { expect, keepToday, literal, test, toggle } from './helpers';

/** The header, the tab's icons and (on home pages) the title's site, for one site. */
async function expectSite(page: Page, site: Topic, home: boolean): Promise<void> {
  const { name, prefix } = SITES[site];
  const brand = page.locator('#brand');
  await expect(brand).toHaveText(name);
  await expect(brand).toHaveAttribute('href', prefix || '/');
  const icons = prefix;
  await expect(page.locator('link[rel="icon"]')).toHaveCount(2);
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute(
    'href',
    `${icons}/favicon.svg`,
  );
  await expect(page.locator('link[rel="icon"]').last()).toHaveAttribute(
    'href',
    `${icons}/favicon.ico`,
  );
  if (home) await expect(page).toHaveTitle(new RegExp(` \\| ${literal(name)}$`));
}

for (const own of TOPICS) {
  for (const path of [SITES[own].prefix || '/', `${SITES[own].prefix}/in/london-gb`]) {
    test(`the header follows the toggle on ${path}`, async ({ page, ipPlace }) => {
      const home = !path.includes('/in/');
      // A home page's title answers for today, as the page does until 6pm.
      if (home) await keepToday(page, ipPlace.tz);
      await page.goto(path);
      await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
      await expectSite(page, own, home);

      for (const other of TOPICS.filter((t) => t !== own)) {
        await toggle(page, other).click();
        await expectSite(page, other, home);
        if (home) {
          // The home page's title answers the question on screen, for its site.
          const answer = (await page.locator('#answer').textContent())!.trim();
          const verdict = (await page.locator('#verdict').textContent())!.trim();
          await expect(page).toHaveTitle(`${answer} ${verdict} | ${SITES[other].name}`);
        } else {
          // A city's title is the topic's own, as on its site's page.
          const asked = literal(question('London', 'today', other));
          await expect(page).toHaveTitle(
            new RegExp(`^${asked} .+ \\| ${literal(SITES[other].name)}$`),
          );
        }

        await toggle(page, own).click();
        await expectSite(page, own, home);
      }
    });
  }
}

test('the brand opens the other site’s home page', async ({ page, ipPlace }) => {
  // That home page opens on Today until 6pm at the approximate place.
  await keepToday(page, ipPlace.tz);
  await page.goto('/in/london-gb');
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  await toggle(page, 'wet').click();
  await page.locator('#brand').click();
  await expect(page).toHaveURL(/\/wet$/);
  // Answered, not just the question the page arrives with.
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#question')).toHaveText('Is it wet today?');
  await expect(page.locator('#brand')).toHaveText('isitwet.today');
});

test('the brand opens the snow site’s home page from another site', async ({ page, ipPlace }) => {
  await keepToday(page, ipPlace.tz);
  await page.goto('/wet/in/london-gb');
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  await toggle(page, 'snow').click();
  await page.locator('#brand').click();
  await expect(page).toHaveURL(/\/snow$/);
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#question')).toHaveText('Will it snow today?');
  await expect(page.locator('#brand')).toHaveText('willitsnow.today');
});
