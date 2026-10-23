import type { Page } from '@playwright/test';
import { SNOW_BANDS, SNOW_PALETTES, type SnowBand } from '../packages/core/src/config';
import { SNOW_ANSWERS, cityTitle, snowPageTitle } from '../packages/core/src/copy';
import { listed } from '../packages/core/src/places';
import type { TodayResponse } from '../packages/core/src/types';
import { SNOW_GLYPHS } from '../apps/web/src/lib/snowGlyphs';
import { CITIES, cityAt, expect, keepToday, test } from './helpers';

// The snow pages as a deploy preview or a local server serves them: under /snow. On
// willitsnow.today the edge function serves the same pages at the root (smoke.mjs checks that on
// the preview).
const CITY = '/snow/in/london-gb';
const CONTENT = ['about', 'privacy', 'cookies', 'terms', 'support'] as const;
/** The footer's links: the places page, then the content pages. */
const FOOTER = ['places', ...CONTENT] as const;
const SNOW_BRAND = 'willitsnow<span>.today</span>';
const ICON = '<link rel="icon" href="/snow/favicon.svg" type="image/svg+xml">';

/** The band the Today view shows, from the served HTML. */
function bandOf(html: string): SnowBand {
  const band = /id="view-today"[^>]*data-band="([a-z]+)"/.exec(html)?.[1] as SnowBand;
  expect(SNOW_BANDS).toContain(band);
  return band;
}

/** The answer the page was rendered from, which it carries for the browser. */
function dataOf(html: string): TodayResponse {
  const json = /<script type="application\/json" id="initial">(.*?)<\/script>/s.exec(html)?.[1];
  return JSON.parse(json!) as TodayResponse;
}

/** The page shows the snow band's answer, colours and icon in `view`. */
async function expectSnowBand(page: Page, view: 'today' | 'week' = 'today'): Promise<SnowBand> {
  const band = (await page.locator(`#view-${view}`).getAttribute('data-band')) as SnowBand;
  expect(SNOW_BANDS).toContain(band);
  await expect(page.locator(view === 'today' ? '#answer' : '#week-answer')).toHaveText(
    SNOW_ANSWERS[band],
  );
  const p = SNOW_PALETTES[band];
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = document.documentElement.style;
        return ['--g1', '--g2', '--g3', '--ink', '--pill', '--glow'].map((v) =>
          s.getPropertyValue(v).trim(),
        );
      }),
    )
    .toEqual([p.g1, p.g2, p.g3, p.ink, p.pill, p.glow]);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', p.g1);
  // Serialise the expected icon through the browser too, so markup style does not matter.
  const icon = await page.evaluate(
    ([id, markup]) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.innerHTML = markup;
      return { expected: svg.innerHTML, actual: document.getElementById(id)!.innerHTML };
    },
    [view === 'today' ? 'glyph' : 'week-glyph', SNOW_GLYPHS[band]] as const,
  );
  expect(icon.actual).toBe(icon.expected);
  return band;
}

/** The brand's text without the markup's line breaks. */
const brandText = async (page: Page) =>
  (await page.locator('.brand').textContent())!.replace(/\s+/g, '');

test.describe('willitsnow.today pages', () => {
  test('city pages are rendered snowy on the server', async ({ request }) => {
    // A city in its daytime, so the page opens on Today (evening pages: tomorrow.spec.ts).
    const city = await cityAt(request, '08:00', '16:00');
    const res = await request.get(`/snow/in/${city.slug}`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    const band = bandOf(html);
    const today = dataOf(html).snow!.days[0]!;
    expect(today.band).toBe(band);
    const p = SNOW_PALETTES[band];
    expect(html).toContain(
      `<html lang="en-GB" style="--g1:${p.g1};--g2:${p.g2};--g3:${p.g3};--ink:${p.ink};--pill:${p.pill};--glow:${p.glow};`,
    );
    // A stable title for search results; the share card carries today's answer.
    expect(html).toContain(`<title>${cityTitle(city.name, 'snow')}</title>`);
    const share = snowPageTitle({
      city: city.name,
      answer: SNOW_ANSWERS[band],
      band,
      reason: today.reason,
    });
    expect(html).toContain(`<meta property="og:title" content="${share}">`);
    const url = `https://willitsnow.today/in/${city.slug}`;
    expect(html).toContain(`<link rel="canonical" href="${url}">`);
    expect(html).toContain(`<meta property="og:url" content="${url}">`);
    expect(html).toContain(
      `<meta property="og:image" content="https://willitsnow.today/og/${city.slug}.png">`,
    );
    expect(html).toContain('<meta property="og:site_name" content="willitsnow.today">');
    expect(html).toContain(ICON);
    expect(html).toContain('<link rel="manifest" href="/snow/manifest.webmanifest">');
    // The heading is the question with its answer; "Maybe." is marked long, to be sized to fit.
    expect(html).toMatch(
      new RegExp(
        `<h1 class="heading" id="heading">\\s*<span class="question" id="question">\\s*Will it snow in ${city.name} today\\?\\s*</span>\\s*<span class="answer" id="answer"( data-long)?>\\s*(Yes|No|Maybe)\\.\\s*</span>\\s*</h1>`,
      ),
    );
    expect(html).toMatch(/<div class="wrap" id="app"[^>]* data-topic="snow"/);
    // Links are written for willitsnow.today, where the snow pages are at the root.
    expect(html).toContain('<a class="brand" id="brand" href="/">');
  });

  test('city pages open on the snow answer', async ({ page }) => {
    await keepToday(page);
    await page.goto(CITY);
    await expect(page.locator('#question')).toHaveText('Will it snow in London today?');
    await expectSnowBand(page);
    await expect(page.locator('#app')).toHaveAttribute('data-topic', 'snow');
    expect(await brandText(page)).toBe('willitsnow.today');
  });

  test('a city where it snows in every month answers Yes for the week', async ({
    page,
    request,
  }) => {
    // Reykjavik's synthetic forecasts are cold all year (e2e runs in every month).
    const data = (await (
      await request.get('/api/v1/today?place=reykjavik-is&units=c')
    ).json()) as TodayResponse;
    expect(data.snow!.week!.answer).toBe('Yes.');
    await page.goto('/snow/in/reykjavik-is');
    await page.locator('#tab-week').click();
    await expect(page.locator('#week-question')).toHaveText('Will it snow in Reykjavík this week?');
    const band = await expectSnowBand(page, 'week');
    expect(['snow', 'heavysnow', 'deepsnow']).toContain(band);
    await expect(page.locator('#week-days li .t').first()).toHaveText(/^[\d.]+cm$/);
  });

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('city pages still show the snow answer', async ({ page, request }) => {
      // The server's page as it is: a city in its daytime opens on Today.
      const city = await cityAt(request, '08:00', '16:00');
      await page.goto(`/snow/in/${city.slug}`);
      await expect(page.locator('#question')).toHaveText(`Will it snow in ${city.name} today?`);
      await expect(page.locator('#answer')).toBeVisible();
      await expectSnowBand(page);
    });
  });

  test('links stay on the snow pages when served under /snow', async ({ page }) => {
    await page.goto(CITY);
    await expect(page.locator('.brand')).toHaveAttribute('href', '/snow');
    const footer = page.locator('.site-footer nav a');
    await expect(footer).toHaveCount(FOOTER.length);
    for (const [i, name] of FOOTER.entries()) {
      await expect(footer.nth(i)).toHaveAttribute('href', `/snow/${name}`);
    }
    const nearby = page.locator('#nearby a');
    await expect(nearby).toHaveCount(8);
    for (const link of await nearby.all()) {
      await expect(link).toHaveAttribute('href', /^\/snow\/in\/[a-z0-9-]+$/);
    }
    // Other sites' links are left alone.
    await expect(page.locator('#out-0')).toHaveAttribute('href', /^https:\/\//);

    await footer.nth(1).click();
    await expect(page).toHaveURL(/\/snow\/about$/);
    expect(await brandText(page)).toBe('willitsnow.today');
    await expect(page.locator('.brand')).toHaveAttribute('href', '/snow');
    await expect(page.locator('main a[href="/snow/privacy"]')).toHaveCount(1);
  });

  test('a mistyped city redirects to its snow page', async ({ request }) => {
    const res = await request.get('/snow/in/London-GB', { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(new URL(res.headers().location!, 'http://x').pathname).toBe('/snow/in/london-gb');
  });

  test('OG images render as PNG', async ({ request }) => {
    for (const slug of ['london-gb', 'default']) {
      const res = await request.get(`/snow/og/${slug}.png`);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toBe('image/png');
      expect((await res.body()).subarray(1, 4).toString()).toBe('PNG');
    }
    expect((await request.get('/snow/og/atlantis-xx.png')).status()).toBe(404);
  });

  test('About, Privacy, Cookies, Terms and Support carry the snow brand', async ({ request }) => {
    for (const name of CONTENT) {
      const res = await request.get(`/snow/${name}`);
      expect(res.status(), name).toBe(200);
      const html = await res.text();
      expect(html).toContain(`<link rel="canonical" href="https://willitsnow.today/${name}">`);
      expect(html).toMatch(/<title>[^<]+ \| willitsnow\.today<\/title>/);
      expect(html).toContain(SNOW_BRAND);
      expect(html).toContain(ICON);
      // One service on four domains, the page's own first. Support is about the snow app alone.
      const service =
        'willitsnow.today, isithot.today, isitwet.today and isitwindy.today are one service';
      if (name === 'support') expect(html).not.toContain(service);
      else expect(html).toContain(service);
    }
    const about = await (await request.get('/snow/about')).text();
    expect(about).toContain('<h2>Will it snow?</h2>');
    // The site's own question comes first.
    expect(about.indexOf('<h2>Will it snow?</h2>')).toBeLessThan(
      about.indexOf('<h2>Is it wet?</h2>'),
    );
  });

  test('robots.txt and the sitemap name willitsnow.today', async ({ request }) => {
    const robots = await (await request.get('/snow/robots.txt')).text();
    expect(robots).toContain('Sitemap: https://willitsnow.today/sitemap.xml');
    const xml = await (await request.get('/snow/sitemap.xml')).text();
    // Home, About, places, support and every city page but those where it never snows.
    const shown = CITIES.filter((c) => listed(c, 'snow'));
    expect(shown.length).toBe(237);
    expect((xml.match(/<loc>/g) ?? []).length).toBe(4 + shown.length);
    expect(xml).toContain('<loc>https://willitsnow.today/places</loc>');
    expect(xml).toContain('<loc>https://willitsnow.today/support</loc>');
    expect(xml).toContain('<loc>https://willitsnow.today/in/london-gb</loc>');
    expect(xml).not.toContain('/in/singapore-sg<');
    expect(xml).not.toContain('isithot.today');
  });

  test('unknown pages are a snow 404', async ({ request, page }) => {
    for (const path of ['/snow/no-such-page', '/snow/in/atlantis-xx']) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(404);
      const html = await res.text();
      expect(html).toContain('<title>Not found | willitsnow.today</title>');
      expect(html).toContain(SNOW_BRAND);
      expect(html).toContain('<meta name="robots" content="noindex">');
      expect(html).toContain(ICON);
    }
    await page.goto('/snow/no-such-page');
    await expect(page.locator('.question')).toHaveText('Will it snow here?');
    await expect(page.locator('main a')).toHaveAttribute('href', '/snow');
  });
});
