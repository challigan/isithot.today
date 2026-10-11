import { expect, keepToday, prepare, test } from './helpers';

const ANSWERS = /^(Yes\.|No\.|Almost\.)$/;

test.describe('home page', () => {
  test('answers from approximate location without asking for permission', async ({
    page,
    ipPlace,
  }) => {
    // Today's answer: in the place's evening the page would open on Now, with tomorrow's.
    await keepToday(page, ipPlace.tz);
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/today')) calls.push(r.url());
    });
    await page.goto('/');
    const answer = page.locator('#answer');
    await expect(answer).toHaveText(ANSWERS);
    // The head script starts the request early and the app reuses it.
    expect(calls).toHaveLength(1);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('#live')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#verdict')).toHaveText(/^It's /);
    await expect(page.locator('#detail')).toContainText('High of');
    await expect(page.locator('#agree')).toHaveText(/\d of \d forecasts agree within 2°/);
    await expect(page.locator('#list li')).toHaveCount(8);
    await expect(page.locator('#strip .dot')).toHaveCount(8);
    await expect(page.locator('#strip-summary')).toContainText('Forecasts range from');
    // No permission prompt on first load: a quiet link instead.
    await expect(page.getByRole('button', { name: 'Use my exact location' })).toBeVisible();
    for (const link of await page.locator('#more a').all()) {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener');
    }
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      'content',
      /^#[0-9a-f]{6}$/,
    );
  });

  test('location denied keeps the approximate location', async ({ page }) => {
    // Simulate the visitor tapping "Block" on the browser prompt.
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_ok, fail) =>
        fail?.({
          code: 1,
          message: 'User denied Geolocation',
          PERMISSION_DENIED: 1,
        } as GeolocationPositionError);
    });
    await page.goto('/');
    await expect(page.locator('#answer')).toHaveText(ANSWERS);
    await page.getByRole('button', { name: 'Use my exact location' }).click();
    await expect(page.locator('#place-note')).toContainText('Using approximate location.');
    await page.locator('#place-note').getByRole('button', { name: 'Change' }).click();
    await expect(page.locator('#search')).toBeVisible();
  });

  test('upgrades to device location when permission is already granted', async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: { latitude: 52.4862, longitude: -1.8904 },
    });
    await prepare(context);
    const page = await context.newPage();
    const requests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/today')) requests.push(r.url());
    });
    await page.goto('/');
    await expect(page.locator('#place')).toHaveText('Birmingham');
    expect(requests.some((u) => u.includes('lat=52.5') && u.includes('lon=-1.9'))).toBe(true);
    // A device location has no known height: the forecast keeps Open-Meteo's.
    expect(requests.filter((u) => u.includes('elevation='))).toEqual([]);
    await expect(page.locator('#place-note')).toBeHidden();
    await context.close();
  });

  test('switches units and remembers the choice', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#answer')).toHaveText(ANSWERS);
    await page.locator('[data-units="f"]').click();
    await expect(page.locator('[data-units="f"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#agree')).toHaveText(/within 4°/);
    await page.reload();
    await expect(page.locator('[data-units="f"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#agree')).toHaveText(/within 4°/);
  });

  test('shows an error with Retry when forecasts are unavailable', async ({ page }) => {
    let fail = true;
    await page.route('**/api/v1/today**', async (route) => {
      if (fail) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'upstream_unavailable', message: 'down' } }),
        });
      } else {
        await route.continue();
      }
    });
    await page.goto('/');
    await expect(page.locator('#answer')).toHaveText(
      'Forecasts are unavailable right now. Try again in a few minutes.',
    );
    const retry = page.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();
    fail = false;
    await retry.click();
    await expect(page.locator('#answer')).toHaveText(ANSWERS);
    await expect(retry).toBeHidden();
  });

  test('shows the last answer instantly on a return visit', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#answer')).toHaveText(ANSWERS);
    const first = await page.locator('#answer').textContent();
    await page.waitForTimeout(300);
    await page.route('**/api/v1/today**', () => {
      // Never answer: the page must not need the network to show something.
    });
    await page.reload();
    await expect(page.locator('#answer')).toHaveText(first!);
    await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  });

  test('a saved answer from an earlier hour is brought up to date with one request', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#answer')).toHaveText(ANSWERS);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('isithot:last') !== null))
      .toBe(true);
    // As if saved 50 minutes ago, in the previous hour: today's rain in it is out of date.
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('isithot:last')!);
      const from = Date.parse(saved.data.rain.days[0].from) - 60 * 60 * 1000;
      saved.data.rain.days[0].from = new Date(from).toISOString();
      saved.savedAt = Date.now() - 50 * 60 * 1000;
      localStorage.setItem('isithot:last', JSON.stringify(saved));
    });
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/today')) calls.push(r.url());
    });
    await page.reload();
    await expect(page.locator('#app')).toHaveAttribute('data-restored', '1');
    await expect(page.locator('#answer')).toHaveText(ANSWERS);
    await page.waitForLoadState('networkidle');
    // The page's own early request is new, so it brings the answer up to date by itself.
    expect(calls).toHaveLength(1);
  });
});
