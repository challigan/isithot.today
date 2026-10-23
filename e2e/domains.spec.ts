/**
 * The real sites: isithot.today, isitwet.today, willitsnow.today and isitwindy.today are four
 * domains, each with its own storage and its own location permission, so whatever crosses between
 * them goes in the address. All four hosts are served here from the e2e server, with the edge
 * function's routing applied to pages (netlify/edge-functions/lib/route.ts: isitwet.today pages
 * come from /wet, willitsnow.today pages from /snow, isitwindy.today pages from /wind), except on
 * the paths it never runs for (its `excludedPath`). Its redirects (www, another site's prefix) are
 * covered by netlify/test/route.test.ts.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { route } from '../netlify/edge-functions/lib/route';
import { config as edge } from '../netlify/edge-functions/topic';
import { expect, prepare, test, toggle } from './helpers';

const HOT = 'https://isithot.today';
const WET = 'https://isitwet.today';
const SNOW = 'https://willitsnow.today';
const WIND = 'https://isitwindy.today';

/** Whether Netlify runs the edge function for a path: its `path` patterns, less `excludedPath`. */
function routed(pathname: string): boolean {
  const matches = (pattern: string) =>
    new RegExp(`^${pattern.replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`).test(pathname);
  return matches(edge.path) && !edge.excludedPath.some(matches);
}

/** A browser where every site is served by the e2e server at `local`. */
async function allSites(
  browser: Browser,
  local: string,
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<BrowserContext> {
  const context = await browser.newContext(options);
  await prepare(context);
  await context.route(/^https:\/\/(isithot|isitwet|willitsnow|isitwindy)\.today\//, async (r) => {
    const request = r.request();
    const url = new URL(request.url());
    let path = `${url.pathname}${url.search}`;
    if (request.resourceType() === 'document' && routed(url.pathname)) {
      const to = route({
        host: url.hostname,
        pathname: url.pathname,
        search: url.search,
        preview: false,
        headers: new Headers(),
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

async function ready(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
}

test('the device location crosses to the other site in the address', async ({
  browser,
  baseURL,
}) => {
  // Edinburgh, with permission given on isithot.today only, as after its prompt.
  const context = await allSites(browser, baseURL!, {
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
  const context = await allSites(browser, baseURL!);
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
  // So does the introduction under the answer, which now says what isitwet.today answers.
  const intro = page.locator('.intro');
  await expect(intro.locator('p').first()).toContainText('isitwet.today answers one question');
  await expect(intro.getByRole('link', { name: 'How it works' })).toHaveAttribute(
    'href',
    `${WET}/about?units=f`,
  );
  await expect(intro.locator('.place-list a').first()).toHaveAttribute(
    'href',
    `${WET}/in/london-gb?units=f`,
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
  const context = await allSites(browser, baseURL!);
  const page = await context.newPage();
  await ready(page, `${WET}/in/london-gb`);
  await page.locator('[data-units="f"]').click();
  await expect(page.locator('[data-units="f"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#brand')).toHaveAttribute('href', '/');
  await expect(page.locator('#nearby-links a').first()).toHaveAttribute('href', /^\/in\/[a-z-]+$/);
  await context.close();
});

test('the device location crosses to willitsnow.today in the address', async ({
  browser,
  baseURL,
}) => {
  // Edinburgh, with permission given on isitwet.today only.
  const context = await allSites(browser, baseURL!, {
    geolocation: { latitude: 55.95, longitude: -3.19 },
  });
  await context.grantPermissions(['geolocation'], { origin: WET });
  const page = await context.newPage();
  await ready(page, `${WET}/in/london-gb`);
  await toggle(page, 'snow').click();
  await page.locator('#place-btn').click();
  await page.locator('#use-location').click();
  await expect(page).toHaveURL(`${SNOW}/`);
  await expect(page.locator('#place')).toHaveText('Edinburgh');
  await expect(page.locator('#app')).toHaveAttribute('data-topic', 'snow');
  expect(await stored(page, 'isithot:place')).toMatchObject({
    kind: 'coords',
    source: 'device',
    lat: 55.95,
    lon: -3.2,
  });
  await ready(page, `${SNOW}/`);
  await expect(page.locator('#place')).toHaveText('Edinburgh');
  await context.close();
});

test('units cross with links to and from willitsnow.today', async ({ browser, baseURL }) => {
  const context = await allSites(browser, baseURL!);
  const page = await context.newPage();
  await ready(page, `${HOT}/`);
  await page.locator('[data-units="f"]').click();
  await expect(page.locator('[data-units="f"]')).toHaveAttribute('aria-pressed', 'true');
  await toggle(page, 'snow').click();
  // With Snow showing, the header and the places nearby go to willitsnow.today, with the units.
  await expect(page.locator('#brand')).toHaveAttribute('href', `${SNOW}/?units=f`);
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute(
    'href',
    `${SNOW}/favicon.svg`,
  );
  const nearby = page.locator('#nearby-links a').first();
  await expect(nearby).toHaveAttribute(
    'href',
    /^https:\/\/willitsnow\.today\/in\/[a-z-]+\?units=f$/,
  );
  await nearby.click();
  await expect(page).toHaveURL(/^https:\/\/willitsnow\.today\/in\/[a-z-]+$/);
  await expect(page.locator('[data-units="f"]')).toHaveText('in');
  await expect(page.locator('[data-units="f"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#week-days li .t').first()).toHaveText(/^[\d.]+in$/);
  expect(await stored(page, 'isithot:units')).toBe('f');
  await expect(page.locator('#brand')).toHaveAttribute('href', '/');

  // On to the third site: a city chosen with Wet showing goes to isitwet.today.
  await toggle(page, 'wet').click();
  await expect(page.locator('#brand')).toHaveAttribute('href', `${WET}/?units=f`);
  await page.locator('#place-btn').click();
  await page.locator('#search-input').fill('Bris');
  await page
    .locator('#search-results')
    .getByRole('button', { name: /Bristol/ })
    .click();
  await expect(page).toHaveURL(`${WET}/in/bristol-gb`);
  await expect(page.locator('[data-units="f"]')).toHaveAttribute('aria-pressed', 'true');
  await context.close();
});

test('a city page links to the same city on the other domains, and to its places page', async ({
  browser,
  baseURL,
}) => {
  const context = await allSites(browser, baseURL!);
  const page = await context.newPage();
  await ready(page, `${HOT}/in/london-gb`);
  // Real links to the other sites' own domains; the places page is on this one.
  await expect(page.locator('#also a[data-site=wet]')).toHaveAttribute(
    'href',
    `${WET}/in/london-gb`,
  );
  await expect(page.locator('#also a[data-site=snow]')).toHaveAttribute(
    'href',
    `${SNOW}/in/london-gb`,
  );
  await expect(page.locator('#also a[data-site=wind]')).toHaveAttribute(
    'href',
    `${WIND}/in/london-gb`,
  );
  await expect(page.locator('#also').getByRole('link', { name: 'All places' })).toHaveAttribute(
    'href',
    '/places',
  );
  // Chosen units go with them, as with Nearby.
  await page.locator('[data-units="f"]').click();
  await expect(page.locator('#also a[data-site=wet]')).toHaveAttribute(
    'href',
    `${WET}/in/london-gb?units=f`,
  );
  await page.locator('#also a[data-site=wet]').click();
  await expect(page).toHaveURL(`${WET}/in/london-gb`);
  await expect(page.locator('[data-units="f"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#also a[data-site=hot]')).toHaveAttribute(
    'href',
    `${HOT}/in/london-gb?units=f`,
  );

  // Each domain serves its own places page at /places, linking to its own city pages.
  await page.locator('#also').getByRole('link', { name: 'All places' }).click();
  await expect(page).toHaveURL(`${WET}/places`);
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', `${WET}/places`);
  await expect(page.getByRole('link', { name: 'Leeds', exact: true })).toHaveAttribute(
    'href',
    '/in/leeds-gb',
  );
  await page.goto(`${SNOW}/places`);
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', `${SNOW}/places`);
  await expect(page.getByRole('link', { name: 'Oslo', exact: true })).toHaveAttribute(
    'href',
    '/in/oslo-no',
  );
  await context.close();
});

test('the device location crosses to isitwindy.today in the address', async ({
  browser,
  baseURL,
}) => {
  // Edinburgh, with permission given on willitsnow.today only.
  const context = await allSites(browser, baseURL!, {
    geolocation: { latitude: 55.95, longitude: -3.19 },
  });
  await context.grantPermissions(['geolocation'], { origin: SNOW });
  const page = await context.newPage();
  await ready(page, `${SNOW}/in/london-gb`);
  await toggle(page, 'wind').click();
  await page.locator('#place-btn').click();
  await page.locator('#use-location').click();
  await expect(page).toHaveURL(`${WIND}/`);
  await expect(page.locator('#place')).toHaveText('Edinburgh');
  await expect(page.locator('#app')).toHaveAttribute('data-topic', 'wind');
  expect(await stored(page, 'isithot:place')).toMatchObject({
    kind: 'coords',
    source: 'device',
    lat: 55.95,
    lon: -3.2,
  });
  // Edinburgh's wind is in mph, the UK's unit, without a choice made.
  await expect(page.locator('[data-units="mph"]')).toHaveAttribute('aria-pressed', 'true');
  await context.close();
});

test('wind units cross with links to and from isitwindy.today, apart from °C and °F', async ({
  browser,
  baseURL,
}) => {
  const context = await allSites(browser, baseURL!);
  const page = await context.newPage();
  await ready(page, `${HOT}/in/london-gb`);
  await toggle(page, 'wind').click();
  // London's wind is in mph; the pill sets wind's own units.
  await expect(page.locator('.units')).toHaveAttribute('aria-label', 'Wind units');
  await expect(page.locator('[data-units]')).toHaveText(['mph', 'km/h']);
  await expect(page.locator('[data-units="mph"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-units="kmh"]').click();
  await expect(page.locator('[data-units="kmh"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#week-days li .t').first()).toHaveText(/^\d+km\/h$/);
  expect(await stored(page, 'isithot:windUnits')).toBe('kmh');
  expect(await stored(page, 'isithot:units')).toBeNull();
  // The header, the places nearby and the other sites' pages carry it to isitwindy.today.
  await expect(page.locator('#brand')).toHaveAttribute('href', `${WIND}/?windUnits=kmh`);
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute(
    'href',
    `${WIND}/favicon.svg`,
  );
  await expect(page.locator('#also a[data-site=wind]')).toHaveAttribute(
    'href',
    `${WIND}/in/london-gb?windUnits=kmh`,
  );
  const nearby = page.locator('#nearby-links a').first();
  await expect(nearby).toHaveAttribute(
    'href',
    /^https:\/\/isitwindy\.today\/in\/[a-z-]+\?windUnits=kmh$/,
  );
  await nearby.click();
  // The page there stores it and takes it out of the address. The page was made in mph (a UK
  // city's), so it asks again quietly in km/h.
  await expect(page).toHaveURL(/^https:\/\/isitwindy\.today\/in\/[a-z-]+$/);
  await expect(page.locator('[data-units="kmh"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#week-days li .t').first()).toHaveText(/^\d+km\/h$/);
  expect(await stored(page, 'isithot:windUnits')).toBe('kmh');

  // Temperatures keep their own setting: °C for a UK city, with nothing chosen.
  await toggle(page, 'hot').click();
  await expect(page.locator('.units')).toHaveAttribute('aria-label', 'Temperature units');
  await expect(page.locator('[data-units]')).toHaveText(['°C', '°F']);
  await expect(page.locator('[data-units="c"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-units="f"]').click();
  await expect(page.locator('[data-units="f"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#brand')).toHaveAttribute('href', `${HOT}/?units=f&windUnits=kmh`);
  await page.locator('#brand').click();
  await expect(page).toHaveURL(`${HOT}/`);
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  expect(await stored(page, 'isithot:units')).toBe('f');
  expect(await stored(page, 'isithot:windUnits')).toBe('kmh');
  await toggle(page, 'wind').click();
  await expect(page.locator('[data-units="kmh"]')).toHaveAttribute('aria-pressed', 'true');
  await context.close();
});

test("the apps' app-ads.txt is the same file on every domain", async ({ browser, baseURL }) => {
  const context = await allSites(browser, baseURL!);
  const page = await context.newPage();
  for (const site of [HOT, WET, SNOW, WIND]) {
    const res = await page.goto(`${site}/app-ads.txt`);
    expect(res!.status()).toBe(200);
    expect(res!.headers()['content-type']).toBe('text/plain; charset=utf-8');
    // From PUBLIC_ADMOB_PUBLISHER_ID, which the e2e server sets (playwright.config.ts).
    expect(await res!.text()).toBe('google.com, pub-3940256099942544, DIRECT, f08c47fec0942fa0\n');
  }
  await context.close();
});

test("the app's listing addresses: willitsnow.today/support and /privacy", async ({
  browser,
  baseURL,
}) => {
  const context = await allSites(browser, baseURL!);
  const page = await context.newPage();
  // App Store Connect's Support URL and Privacy Policy URL, on the snow site's own domain.
  for (const [path, heading] of [
    ['/support', 'Support'],
    ['/privacy', 'Privacy'],
  ] as const) {
    const res = await page.goto(`${SNOW}${path}`);
    expect(res!.status(), path).toBe(200);
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', `${SNOW}${path}`);
    await expect(page.locator('.brand')).toHaveText('willitsnow.today');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
  }
  await expect(page.getByRole('heading', { name: 'Our apps' })).toBeVisible();
  // The support page's links stay on willitsnow.today, where its pages are at the root.
  await page.goBack();
  await expect(page).toHaveURL(`${SNOW}/support`);
  await expect(page.locator('main a[href^="mailto:"]')).toHaveCount(1);
  await page.locator('main').getByRole('link', { name: 'terms', exact: true }).click();
  await expect(page).toHaveURL(`${SNOW}/terms`);
  await expect(page.locator('.brand')).toHaveText('willitsnow.today');
  await context.close();
});
