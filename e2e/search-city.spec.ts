import type { TodayResponse } from '../packages/core/src/types';
import { expect, keepToday, test } from './helpers';

test('search for a city with a page navigates to it', async ({ page }) => {
  // Bristol's page opens on Today until 6pm there.
  await keepToday(page);
  await page.goto('/');
  await expect(page.locator('#answer')).toHaveText(/\.$/);
  await page.locator('#place-btn').click();
  const dialog = page.locator('#search');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#search-input')).toBeFocused();
  await page.locator('#search-input').fill('Bris');
  await page.getByRole('button', { name: /Bristol/ }).click();
  await expect(page).toHaveURL(/\/in\/bristol-gb$/);
  await expect(page.locator('#question')).toHaveText('Is it hot in Bristol today?');
  await expect(page.locator('#place')).toHaveText('Bristol');
});

test('a city search from a wet city page stays on the wet site', async ({ page }) => {
  await keepToday(page);
  await page.goto('/wet/in/london-gb');
  await expect(page.locator('#answer')).toHaveText(/^\s*(Yes|No|Maybe)\.\s*$/);
  await page.locator('#place-btn').click();
  await page.locator('#search-input').fill('Bris');
  await page.getByRole('button', { name: /Bristol/ }).click();
  await expect(page).toHaveURL(/\/wet\/in\/bristol-gb$/);
  await expect(page.locator('#question')).toHaveText('Is it wet in Bristol today?');
  await expect(page.locator('#app')).toHaveAttribute('data-topic', 'wet');
});

test('a city search from a snow city page stays on the snow site', async ({ page }) => {
  await keepToday(page);
  await page.goto('/snow/in/london-gb');
  await expect(page.locator('#answer')).toHaveText(/^\s*(Yes|No|Maybe)\.\s*$/);
  await page.locator('#place-btn').click();
  await page.locator('#search-input').fill('Bris');
  await page.getByRole('button', { name: /Bristol/ }).click();
  await expect(page).toHaveURL(/\/snow\/in\/bristol-gb$/);
  await expect(page.locator('#question')).toHaveText('Will it snow in Bristol today?');
  await expect(page.locator('#app')).toHaveAttribute('data-topic', 'snow');
});

test('search sheet closes on Escape', async ({ page }) => {
  await page.goto('/');
  await page.locator('#place-btn').click();
  await expect(page.locator('#search')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#search')).toBeHidden();
});

test('a searched place without a page gets a shareable URL', async ({ page }) => {
  await page.route('**/api/v1/search**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            name: 'Hexham',
            region: 'England',
            country: 'GB',
            countryName: 'United Kingdom',
            lat: 54.97,
            lon: -2.1,
          },
        ],
      }),
    }),
  );
  await page.goto('/');
  await page.locator('#place-btn').click();
  await page.locator('#search-input').fill('Hex');
  await page.getByRole('button', { name: /Hexham/ }).click();
  await expect(page).toHaveURL(/\/\?lat=54\.95&lon=-2\.1&name=Hexham$/);
  await expect(page.locator('#place')).toHaveText('Hexham');
});

test('a searched place is forecast for its height, after a reload too', async ({ page }) => {
  await page.route('**/api/v1/search**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            name: 'Hexham',
            region: 'England',
            country: 'GB',
            countryName: 'United Kingdom',
            lat: 54.97,
            lon: -2.1,
            elevation: 50,
          },
        ],
      }),
    }),
  );
  const calls: URL[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/today')) calls.push(new URL(r.url()));
  });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  // Approximate (IP) locations never send a height.
  expect(calls.map((u) => u.searchParams.get('elevation'))).toEqual([null]);
  await page.locator('#place-btn').click();
  await page.locator('#search-input').fill('Hex');
  const answer = page.waitForResponse((r) => r.url().includes('elevation=50'));
  await page.getByRole('button', { name: /Hexham/ }).click();
  const body = (await (await answer).json()) as TodayResponse;
  expect(body.location.elevation).toBe(50);
  const asked = calls.at(-1)!;
  expect(asked.searchParams.get('source')).toBe('search');
  expect(asked.searchParams.get('elevation')).toBe('50');
  await expect(page.locator('#place')).toHaveText('Hexham');
  // The address carries the height, so a reload or a shared link asks for the same forecast.
  await expect(page).toHaveURL(/\/\?lat=54\.95&lon=-2\.1&name=Hexham&elevation=50$/);
  calls.length = 0;
  await page.reload();
  await expect(page.locator('#place')).toHaveText('Hexham');
  await page.waitForLoadState('networkidle');
  expect(calls.map((u) => u.searchParams.get('elevation'))).toEqual(['50']);

  // The remembered place has it too: the head script's early request asks for it, and the app
  // takes that answer rather than asking again.
  calls.length = 0;
  await page.goto('/');
  await expect(page.locator('#place')).toHaveText('Hexham');
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  await page.waitForLoadState('networkidle');
  expect(calls.map((u) => u.searchParams.get('elevation'))).toEqual(['50']);
});

test('city pages are server-rendered with the real answer', async ({ page, request }) => {
  const res = await request.get('/in/newcastle-upon-tyne-gb');
  expect(res.status()).toBe(200);
  const html = await res.text();
  // A stable title for search results; the share card carries the answer.
  expect(html).toContain(
    '<title>Is it hot in Newcastle today? Hour by hour from 8 forecasts | isithot.today</title>',
  );
  expect(html).toMatch(
    /<meta property="og:title" content="Is it hot in Newcastle today\? (Yes|No|Almost)\. -?\d+° \| isithot\.today">/,
  );
  expect(html).toContain('<link rel="canonical" href="');
  expect(html).toContain('/og/newcastle-upon-tyne-gb.png');
  // The heading is the question with its answer; "Almost." is marked long, to be sized to fit.
  expect(html).toMatch(
    /<h1 class="heading" id="heading">\s*<span class="question" id="question">\s*(Is it hot in Newcastle today\?|Will it be hot in Newcastle tomorrow\?)\s*<\/span>\s*<span class="answer" id="answer"( data-long)?>\s*(Yes|No|Almost)\.\s*<\/span>\s*<\/h1>/,
  );

  await keepToday(page);
  await page.goto('/in/newcastle-upon-tyne-gb');
  await expect(page.locator('#question')).toHaveText('Is it hot in Newcastle today?');
  await expect(page.locator('#nearby a')).toHaveCount(8);
  const bbc = page.locator('#out-0');
  await expect(bbc).toHaveAttribute('href', 'https://www.bbc.co.uk/weather/2641673');
});

test('unknown city pages 404', async ({ request }) => {
  const res = await request.get('/in/atlantis-xx');
  expect(res.status()).toBe(404);
});

test('sitemap lists home, about, places and every city page', async ({ request }) => {
  const xml = await (await request.get('/sitemap.xml')).text();
  expect((xml.match(/<loc>/g) ?? []).length).toBe(303);
  expect(xml).toContain('<loc>https://isithot.today/places</loc>');
  expect(xml).toContain('/in/newcastle-upon-tyne-gb</loc>');
  // Google ignores both, and nothing knows when a page last changed.
  expect(xml).not.toMatch(/<(changefreq|priority|lastmod)>/);
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain('Allow: /');
});

test('OG images render as PNG', async ({ request }) => {
  const res = await request.get('/og/newcastle-upon-tyne-gb.png');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/png');
  const body = await res.body();
  expect(body.subarray(1, 4).toString()).toBe('PNG');
});
