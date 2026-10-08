/**
 * The real sites: isithot.today and isitwet.today are two domains, each with its own storage and
 * its own location permission, so whatever crosses between them goes in the address. Both hosts
 * are served here from the e2e server, with the edge function's routing applied to pages
 * (netlify/edge-functions/lib/route.ts: isitwet.today pages come from /wet).
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { route } from '../netlify/edge-functions/lib/route';
import { expect, prepare, test } from './helpers';

const HOT = 'https://isithot.today';
const WET = 'https://isitwet.today';

/** A browser where both sites are served by the e2e server at `local`. */
async function bothSites(
  browser: Browser,
  local: string,
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<BrowserContext> {
  const context = await browser.newContext(options);
  await prepare(context);
  await context.route(/^https:\/\/isit(hot|wet)\.today\//, async (r) => {
    const request = r.request();
    const url = new URL(request.url());
    let path = `${url.pathname}${url.search}`;
    if (request.resourceType() === 'document') {
      const to = route({
        host: url.hostname,
        pathname: url.pathname,
        search: url.search,
        preview: false,
        header: null,
      });
      if (to.kind === 'redirect') {
        return r.fulfill({ status: to.status, headers: { location: to.to } });
      }
      if (to.kind === 'rewrite') path = to.to;
    }
    await r.fulfill({ response: await r.fetch({ url: `${local}${path}` }) });
  });
  return context;
}

const stored = (page: Page, key: string) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key);

const toggle = (page: Page, topic: 'hot' | 'wet') => page.locator(`#topic [data-topic=${topic}]`);

async function ready(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
}

test('the device location crosses to the other site in the address', async ({
  browser,
  baseURL,
}) => {
  // Edinburgh, with permission given on isithot.today only, as after its prompt.
  const context = await bothSites(browser, baseURL!, {
    geolocation: { latitude: 55.95, longitude: -3.19 },
  });
  await context.grantPermissions(['geolocation'], { origin: HOT });
  const page = await context.newPage();
  await ready(page, `${HOT}/in/london-gb`);
  await toggle(page, 'wet').click();
  await page.locator('#place-btn').click();
  await page.locator('#use-location').click();
  // Home on isitwet.today, with the place, which then leaves the address.
  await expect(page).toHaveURL(`${WET}/`);
  await expect(page.locator('#place')).toHaveText('Edinburgh');
  await expect(page.locator('#app')).toHaveAttribute('data-topic', 'wet');
  // Remembered there, so the next visit to isitwet.today starts from it.
  expect(await stored(page, 'isithot:place')).toMatchObject({
    kind: 'coords',
    source: 'device',
    lat: 55.95,
    lon: -3.2,
  });
  await ready(page, `${WET}/`);
  await expect(page.locator('#place')).toHaveText('Edinburgh');
  await context.close();
});

test('units cross with links to the other site', async ({ browser, baseURL }) => {
  const context = await bothSites(browser, baseURL!);
  const page = await context.newPage();
  await ready(page, `${HOT}/`);
  await page.locator('[data-units="f"]').click();
  await expect(page.locator('[data-units="f"]')).toHaveAttribute('aria-pressed', 'true');
  await toggle(page, 'wet').click();
  // With Wet showing, the header and the places nearby go to isitwet.today, carrying the units.
  await expect(page.locator('#brand')).toHaveAttribute('href', `${WET}/?units=f`);
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute(
    'href',
    `${WET}/favicon.svg`,
  );
  const nearby = page.locator('#nearby-links a').first();
  await expect(nearby).toHaveAttribute('href', /^https:\/\/isitwet\.today\/in\/[a-z-]+\?units=f$/);
  await nearby.click();
  // The page there stores them and takes them out of the address.
  await expect(page).toHaveURL(/^https:\/\/isitwet\.today\/in\/[a-z-]+$/);
  await expect(page.locator('[data-units="f"]')).toHaveText('in');
  await expect(page.locator('[data-units="f"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#week-days li .t').first()).toHaveText(/^[\d.]+in$/);
  expect(await stored(page, 'isithot:units')).toBe('f');

  // Back the other way: a city chosen with Hot showing goes to isithot.today.
  await toggle(page, 'hot').click();
  await expect(page.locator('#brand')).toHaveAttribute('href', `${HOT}/?units=f`);
  await page.locator('#place-btn').click();
  await page.locator('#search-input').fill('Bris');
  await page
    .locator('#search-results')
    .getByRole('button', { name: /Bristol/ })
    .click();
  await expect(page).toHaveURL(`${HOT}/in/bristol-gb`);
  await expect(page.locator('[data-units="f"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#brand')).toHaveAttribute('href', '/');
  await context.close();
});

test('links within one site stay as they are', async ({ browser, baseURL }) => {
  const context = await bothSites(browser, baseURL!);
  const page = await context.newPage();
  await ready(page, `${WET}/in/london-gb`);
  await page.locator('[data-units="f"]').click();
  await expect(page.locator('[data-units="f"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#brand')).toHaveAttribute('href', '/');
  await expect(page.locator('#nearby-links a').first()).toHaveAttribute('href', /^\/in\/[a-z-]+$/);
  await context.close();
});
