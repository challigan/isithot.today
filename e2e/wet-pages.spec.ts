import type { Page } from '@playwright/test';
import { RAIN_BANDS, RAIN_PALETTES, type RainBand } from '../packages/core/src/config';
import { RAIN_ANSWERS, cityTitle, wetPageTitle } from '../packages/core/src/copy';
import type { TodayResponse } from '../packages/core/src/types';
import { RAIN_GLYPHS } from '../apps/web/src/lib/wetGlyphs';
import { cityAt, expect, keepToday, test } from './helpers';

// The wet pages as a deploy preview or a local server serves them: under /wet. On isitwet.today
// the edge function serves the same pages at the root (smoke.mjs checks that on the preview).
const CITY = '/wet/in/london-gb';
const CONTENT = ['about', 'privacy', 'cookies', 'terms'] as const;
/** The footer's links: the places page, then the content pages. */
const FOOTER = ['places', ...CONTENT] as const;
const WET_BRAND = 'isitwet<span>.today</span>';

/** The band the Today view shows, from the served HTML. */
function bandOf(html: string): RainBand {
  const band = /id="view-today"[^>]*data-band="([a-z]+)"/.exec(html)?.[1] as RainBand;
  expect(RAIN_BANDS).toContain(band);
  return band;
}

/** The answer the page was rendered from, which it carries for the browser. */
function dataOf(html: string): TodayResponse {
  const json = /<script type="application\/json" id="initial">(.*?)<\/script>/s.exec(html)?.[1];
  return JSON.parse(json!) as TodayResponse;
}

/** The page shows the rain band's answer, colours and icon. */
async function expectRainBand(page: Page): Promise<void> {
  const band = (await page.locator('#view-today').getAttribute('data-band')) as RainBand;
  expect(RAIN_BANDS).toContain(band);
  await expect(page.locator('#answer')).toHaveText(RAIN_ANSWERS[band]);
  const p = RAIN_PALETTES[band];
  const vars = await page.evaluate(() => {
    const s = document.documentElement.style;
    return ['--g1', '--g2', '--g3', '--ink', '--pill', '--glow'].map((v) =>
      s.getPropertyValue(v).trim(),
    );
  });
  expect(vars).toEqual([p.g1, p.g2, p.g3, p.ink, p.pill, p.glow]);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', p.g1);
  // Serialise the expected icon through the browser too, so markup style does not matter.
  const icon = await page.evaluate((markup) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.innerHTML = markup;
    return { expected: svg.innerHTML, actual: document.getElementById('glyph')!.innerHTML };
  }, RAIN_GLYPHS[band]);
  expect(icon.actual).toBe(icon.expected);
}

/** The brand's text without the markup's line breaks. */
const brandText = async (page: Page) =>
  (await page.locator('.brand').textContent())!.replace(/\s+/g, '');

test.describe('isitwet.today pages', () => {
  test('city pages are rendered wet on the server', async ({ request }) => {
    // A city in its daytime, so the page opens on Today (evening pages: tomorrow.spec.ts).
    const city = await cityAt(request, '08:00', '16:00');
    const res = await request.get(`/wet/in/${city.slug}`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    const band = bandOf(html);
    const today = dataOf(html).rain!.days[0]!;
    expect(today.band).toBe(band);
    const p = RAIN_PALETTES[band];
    expect(html).toContain(
      `<html lang="en-GB" style="--g1:${p.g1};--g2:${p.g2};--g3:${p.g3};--ink:${p.ink};--pill:${p.pill};--glow:${p.glow};`,
    );
    // A stable title for search results; the share card carries today's answer.
    expect(html).toContain(`<title>${cityTitle(city.name, 'wet')}</title>`);
    const share = wetPageTitle({
      city: city.name,
      answer: RAIN_ANSWERS[band],
      band,
      snow: today.snow,
    });
    expect(html).toContain(`<meta property="og:title" content="${share}">`);
    const url = `https://isitwet.today/in/${city.slug}`;
    expect(html).toContain(`<link rel="canonical" href="${url}">`);
    expect(html).toContain(`<meta property="og:url" content="${url}">`);
    expect(html).toContain(
      `<meta property="og:image" content="https://isitwet.today/og/${city.slug}.png">`,
    );
    expect(html).toContain('<meta property="og:site_name" content="isitwet.today">');
    expect(html).toContain('<link rel="icon" href="/wet/favicon.svg" type="image/svg+xml">');
    expect(html).toContain('<link rel="manifest" href="/wet/manifest.webmanifest">');
    // The heading is the question with its answer; "Maybe." is marked long, to be sized to fit.
    expect(html).toMatch(
      new RegExp(
        `<h1 class="heading" id="heading">\\s*<span class="question" id="question">\\s*Is it wet in ${city.name} today\\?\\s*</span>\\s*<span class="answer" id="answer"( data-long)?>\\s*(Yes|No|Maybe)\\.\\s*</span>\\s*</h1>`,
      ),
    );
    expect(html).toMatch(/<div class="wrap" id="app"[^>]* data-topic="wet"/);
    // Links are written for isitwet.today, where the wet pages are at the root.
    expect(html).toContain('<a class="brand" id="brand" href="/">');
  });

  test('city pages open on the rain answer', async ({ page }) => {
    await keepToday(page);
    await page.goto(CITY);
    await expect(page.locator('#question')).toHaveText('Is it wet in London today?');
    await expectRainBand(page);
    await expect(page.locator('#app')).toHaveAttribute('data-topic', 'wet');
    expect(await brandText(page)).toBe('isitwet.today');
  });

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('city pages still show the rain answer', async ({ page, request }) => {
      // The server's page as it is: a city in its daytime opens on Today.
      const city = await cityAt(request, '08:00', '16:00');
      await page.goto(`/wet/in/${city.slug}`);
      await expect(page.locator('#question')).toHaveText(`Is it wet in ${city.name} today?`);
      await expect(page.locator('#answer')).toBeVisible();
      await expectRainBand(page);
    });
  });

  test('links stay on the wet pages when served under /wet', async ({ page }) => {
    await page.goto(CITY);
    await expect(page.locator('.brand')).toHaveAttribute('href', '/wet');
    const footer = page.locator('.site-footer nav a');
    await expect(footer).toHaveCount(5);
    for (const [i, name] of FOOTER.entries()) {
      await expect(footer.nth(i)).toHaveAttribute('href', `/wet/${name}`);
    }
    const nearby = page.locator('#nearby a');
    await expect(nearby).toHaveCount(8);
    for (const link of await nearby.all()) {
      await expect(link).toHaveAttribute('href', /^\/wet\/in\/[a-z0-9-]+$/);
    }
    // Other sites' links are left alone.
    await expect(page.locator('#out-0')).toHaveAttribute('href', /^https:\/\//);

    await footer.nth(1).click();
    await expect(page).toHaveURL(/\/wet\/about$/);
    expect(await brandText(page)).toBe('isitwet.today');
    await expect(page.locator('.brand')).toHaveAttribute('href', '/wet');
    await expect(page.locator('main a[href="/wet/privacy"]')).toHaveCount(1);
  });

  test('a mistyped city redirects to its wet page', async ({ request }) => {
    const res = await request.get('/wet/in/London-GB', { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(new URL(res.headers().location!, 'http://x').pathname).toBe('/wet/in/london-gb');
  });

  test('OG images render as PNG', async ({ request }) => {
    for (const slug of ['london-gb', 'default']) {
      const res = await request.get(`/wet/og/${slug}.png`);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toBe('image/png');
      expect((await res.body()).subarray(1, 4).toString()).toBe('PNG');
    }
    expect((await request.get('/wet/og/atlantis-xx.png')).status()).toBe(404);
  });

  test('About, Privacy, Cookies and Terms carry the wet brand', async ({ request }) => {
    for (const name of CONTENT) {
      const res = await request.get(`/wet/${name}`);
      expect(res.status(), name).toBe(200);
      const html = await res.text();
      expect(html).toContain(`<link rel="canonical" href="https://isitwet.today/${name}">`);
      expect(html).toMatch(/<title>[^<]+ \| isitwet\.today<\/title>/);
      expect(html).toContain(WET_BRAND);
      expect(html).toContain('<link rel="icon" href="/wet/favicon.svg" type="image/svg+xml">');
      // One service on four domains, the page's own first.
      expect(html).toContain(
        'isitwet.today, isithot.today, willitsnow.today and isitwindy.today are one service',
      );
    }
    const about = await (await request.get('/wet/about')).text();
    expect(about).toContain('<h2>Is it wet?</h2>');
  });

  test('unknown pages are a wet 404', async ({ request, page }) => {
    for (const path of ['/wet/no-such-page', '/wet/in/atlantis-xx']) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(404);
      const html = await res.text();
      expect(html).toContain('<title>Not found | isitwet.today</title>');
      expect(html).toContain(WET_BRAND);
      expect(html).toContain('<meta name="robots" content="noindex">');
      expect(html).toContain('<link rel="icon" href="/wet/favicon.svg" type="image/svg+xml">');
    }
    await page.goto('/wet/no-such-page');
    await expect(page.locator('.question')).toHaveText('Is it wet here?');
    await expect(page.locator('main a')).toHaveAttribute('href', '/wet');
  });
});

test.describe('isithot.today pages are unchanged', () => {
  test('city pages', async ({ request, page }) => {
    const html = await (await request.get('/in/london-gb')).text();
    expect(html).toContain('<link rel="canonical" href="https://isithot.today/in/london-gb">');
    expect(html).toContain(
      '<meta property="og:image" content="https://isithot.today/og/london-gb.png">',
    );
    expect(html).toContain('<meta property="og:site_name" content="isithot.today">');
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(html).toMatch(/<title>Is it hot in London today\? /);
    expect(html).toMatch(/<div class="wrap" id="app"[^>]* data-topic="hot"/);

    await keepToday(page);
    await page.goto('/in/london-gb');
    await expect(page.locator('#question')).toHaveText('Is it hot in London today?');
    await expect(page.locator('.brand')).toHaveAttribute('href', '/');
    await expect(page.locator('.site-footer nav a').first()).toHaveAttribute('href', '/places');
    await expect(page.locator('.site-footer nav a').nth(1)).toHaveAttribute('href', '/about');
    expect(await brandText(page)).toBe('isithot.today');
  });

  test('a mistyped city redirects without /wet', async ({ request }) => {
    const res = await request.get('/in/London-GB', { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(new URL(res.headers().location!, 'http://x').pathname).toBe('/in/london-gb');
  });

  test('content pages and the 404', async ({ request }) => {
    for (const name of CONTENT) {
      const html = await (await request.get(`/${name}`)).text();
      expect(html).toContain(`<link rel="canonical" href="https://isithot.today/${name}">`);
      expect(html).toMatch(/<title>[^<]+ \| isithot\.today<\/title>/);
      expect(html).toContain('isithot<span>.today</span>');
      expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    }
    const about = await (await request.get('/about')).text();
    expect(about).toContain('<h2>Is it wet?</h2>');
    const missing = await request.get('/no-such-page');
    expect(missing.status()).toBe(404);
    const html = await missing.text();
    expect(html).toContain('<title>Not found | isithot.today</title>');
    expect(html).toContain('isithot<span>.today</span>');
  });
});
