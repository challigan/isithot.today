/**
 * The header names the site of the question on screen, and links to it: on a page of one site
 * with the other question showing, it reads (and goes to) the other site. So do the tab's icons
 * and the home page's title. Locally both sites share one host, the wet one under /wet
 * (domains.spec.ts covers the real hosts).
 */
import type { Page } from '@playwright/test';
import { expect, keepToday, test, toggle } from './helpers';

/** The header, the tab's icons and (on home pages) the title's site, for one site. */
async function expectSite(page: Page, site: 'hot' | 'wet', home: boolean): Promise<void> {
  const name = site === 'hot' ? 'isithot.today' : 'isitwet.today';
  const brand = page.locator('#brand');
  await expect(brand).toHaveText(name);
  await expect(brand).toHaveAttribute('href', site === 'hot' ? '/' : '/wet');
  const icons = site === 'hot' ? '' : '/wet';
  await expect(page.locator('link[rel="icon"]')).toHaveCount(2);
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute(
    'href',
    `${icons}/favicon.svg`,
  );
  await expect(page.locator('link[rel="icon"]').last()).toHaveAttribute(
    'href',
    `${icons}/favicon.ico`,
  );
  if (home) await expect(page).toHaveTitle(new RegExp(` \\| ${name.replace('.', '\\.')}$`));
}

for (const [path, own] of [
  ['/', 'hot'],
  ['/wet', 'wet'],
  ['/in/london-gb', 'hot'],
  ['/wet/in/london-gb', 'wet'],
] as const) {
  test(`the header follows the toggle on ${path}`, async ({ page, ipPlace }) => {
    const home = !path.includes('/in/');
    const other = own === 'hot' ? 'wet' : 'hot';
    // A home page's title answers for today, as the page does until 6pm.
    if (home) await keepToday(page, ipPlace.tz);
    await page.goto(path);
    await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
    await expectSite(page, own, home);

    await toggle(page, other).click();
    await expectSite(page, other, home);
    if (home) {
      // The home page's title answers the question on screen, for its site.
      const answer = (await page.locator('#answer').textContent())!.trim();
      const verdict = (await page.locator('#verdict').textContent())!.trim();
      const site = other === 'hot' ? 'isithot.today' : 'isitwet.today';
      await expect(page).toHaveTitle(`${answer} ${verdict} | ${site}`);
    } else {
      // A city's title is the topic's own, as on its site's page.
      await expect(page).toHaveTitle(
        new RegExp(`^Is it ${other} in London today\\? .+ \\| isit${other}\\.today$`),
      );
    }

    await toggle(page, own).click();
    await expectSite(page, own, home);
  });
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
