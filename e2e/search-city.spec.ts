import { expect, test } from '@playwright/test';

test('search for a city with a page navigates to it', async ({ page }) => {
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
  await page.goto('/wet/in/london-gb');
  await expect(page.locator('#answer')).toHaveText(/^\s*(Yes|No|Maybe)\.\s*$/);
  await page.locator('#place-btn').click();
  await page.locator('#search-input').fill('Bris');
  await page.getByRole('button', { name: /Bristol/ }).click();
  await expect(page).toHaveURL(/\/wet\/in\/bristol-gb$/);
  await expect(page.locator('#question')).toHaveText('Is it wet in Bristol today?');
  await expect(page.locator('#app')).toHaveAttribute('data-topic', 'wet');
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

test('city pages are server-rendered with the real answer', async ({ page, request }) => {
  const res = await request.get('/in/newcastle-upon-tyne-gb');
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toMatch(
    /<title>Is it hot in Newcastle today\? (Yes|No|Almost)\. -?\d+° \| isithot\.today<\/title>/,
  );
  expect(html).toContain('<link rel="canonical" href="');
  expect(html).toContain('/og/newcastle-upon-tyne-gb.png');
  expect(html).toMatch(/<h1 class="answer" id="answer">\s*(Yes|No|Almost)\.\s*<\/h1>/);

  await page.goto('/in/newcastle-upon-tyne-gb');
  await expect(page.locator('#question')).toHaveText('Is it hot in Newcastle today?');
  await expect(page.locator('#nearby a')).toHaveCount(4);
  const bbc = page.locator('#out-0');
  await expect(bbc).toHaveAttribute('href', 'https://www.bbc.co.uk/weather/2641673');
});

test('unknown city pages 404', async ({ request }) => {
  const res = await request.get('/in/atlantis-xx');
  expect(res.status()).toBe(404);
});

test('sitemap lists home, about and every city page', async ({ request }) => {
  const xml = await (await request.get('/sitemap.xml')).text();
  expect((xml.match(/<loc>/g) ?? []).length).toBe(302);
  expect(xml).toContain('/in/newcastle-upon-tyne-gb</loc>');
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
