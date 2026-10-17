import type { Page } from '@playwright/test';
import { WIND_BANDS, WIND_PALETTES, type WindBand } from '../packages/core/src/config';
import { WIND_ANSWERS, cityTitle, windPageTitle } from '../packages/core/src/copy';
import { listed } from '../packages/core/src/places';
import type { TodayResponse } from '../packages/core/src/types';
import { WIND_GLYPHS } from '../apps/web/src/lib/windGlyphs';
import { CITIES, cityAt, expect, keepToday, test } from './helpers';

// The wind pages as a deploy preview or a local server serves them: under /wind. On
// isitwindy.today the edge function serves the same pages at the root (smoke.mjs checks that on
// the preview).
const CITY = '/wind/in/london-gb';
const CONTENT = ['about', 'privacy', 'cookies', 'terms'] as const;
/** The footer's links: the places page, then the content pages. */
const FOOTER = ['places', ...CONTENT] as const;
const WIND_BRAND = 'isitwindy<span>.today</span>';
const ICON = '<link rel="icon" href="/wind/favicon.svg" type="image/svg+xml">';

/** The band the Today view shows, from the served HTML. */
function bandOf(html: string): WindBand {
  const band = /id="view-today"[^>]*data-band="([a-z]+)"/.exec(html)?.[1] as WindBand;
  expect(WIND_BANDS).toContain(band);
  return band;
}

/** The answer the page was rendered from, which it carries for the browser. */
function dataOf(html: string): TodayResponse {
  const json = /<script type="application\/json" id="initial">(.*?)<\/script>/s.exec(html)?.[1];
  return JSON.parse(json!) as TodayResponse;
}

/** The page shows the wind band's answer, colours and icon in `view`. */
async function expectWindBand(page: Page, view: 'today' | 'week' = 'today'): Promise<WindBand> {
  const band = (await page.locator(`#view-${view}`).getAttribute('data-band')) as WindBand;
  expect(WIND_BANDS).toContain(band);
  if (view === 'today') await expect(page.locator('#answer')).toHaveText(WIND_ANSWERS[band]);
  const p = WIND_PALETTES[band];
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
    [view === 'today' ? 'glyph' : 'week-glyph', WIND_GLYPHS[band]] as const,
  );
  expect(icon.actual).toBe(icon.expected);
  return band;
}

/** The brand's text without the markup's line breaks. */
const brandText = async (page: Page) =>
  (await page.locator('.brand').textContent())!.replace(/\s+/g, '');

test.describe('isitwindy.today pages', () => {
  test('city pages are rendered windy on the server', async ({ request }) => {
    // A city in its daytime, so the page opens on Today (evening pages: tomorrow.spec.ts).
    const city = await cityAt(request, '08:00', '16:00');
    const res = await request.get(`/wind/in/${city.slug}`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    const band = bandOf(html);
    const data = dataOf(html);
    const today = data.wind!.days[0]!;
    expect(today.band).toBe(band);
    const p = WIND_PALETTES[band];
    expect(html).toContain(
      `<html lang="en-GB" style="--g1:${p.g1};--g2:${p.g2};--g3:${p.g3};--ink:${p.ink};--pill:${p.pill};--glow:${p.glow};`,
    );
    // A stable title for search results; the share card carries today's answer.
    expect(html).toContain(`<title>${cityTitle(city.name, 'wind')}</title>`);
    const share = windPageTitle({
      city: city.name,
      answer: WIND_ANSWERS[band],
      band,
      still: today.still,
    });
    expect(html).toContain(`<meta property="og:title" content="${share}">`);
    const url = `https://isitwindy.today/in/${city.slug}`;
    expect(html).toContain(`<link rel="canonical" href="${url}">`);
    expect(html).toContain(`<meta property="og:url" content="${url}">`);
    expect(html).toContain(
      `<meta property="og:image" content="https://isitwindy.today/og/${city.slug}.png">`,
    );
    expect(html).toContain('<meta property="og:site_name" content="isitwindy.today">');
    expect(html).toContain(ICON);
    expect(html).toContain('<link rel="manifest" href="/wind/manifest.webmanifest">');
    // The heading is the question with its answer; "A bit." is marked long, to be sized to fit.
    expect(html).toMatch(
      new RegExp(
        `<h1 class="heading" id="heading">\\s*<span class="question" id="question">\\s*Is it windy in ${city.name} today\\?\\s*</span>\\s*<span class="answer" id="answer"( data-long)?>\\s*(Yes|No|A bit)\\.\\s*</span>\\s*</h1>`,
      ),
    );
    expect(html).toMatch(/<div class="wrap" id="app"[^>]* data-topic="wind"/);
    // The wind units pill, in the unit the page was made in (the city's country's).
    expect(html).toMatch(
      new RegExp(
        `<button type="button" data-units="${data.wind!.unit}" aria-pressed="true">\\s*(mph|km/h)\\s*</button>`,
      ),
    );
    // Links are written for isitwindy.today, where the wind pages are at the root.
    expect(html).toContain('<a class="brand" id="brand" href="/">');
  });

  test('a city page is in its country’s wind unit: mph in the UK, km/h in France', async ({
    request,
  }) => {
    for (const [slug, unit, text] of [
      ['london-gb', 'mph', /\d+mph/],
      ['paris-fr', 'kmh', /\d+km\/h/],
    ] as const) {
      const html = await (await request.get(`/wind/in/${slug}`)).text();
      expect(dataOf(html).wind!.unit, slug).toBe(unit);
      expect(html, slug).toMatch(new RegExp(`data-units="${unit}" aria-pressed="true"`));
      expect(html, slug).toMatch(
        new RegExp(`<p class="detail hold" id="detail">[^<]*${text.source}`),
      );
    }
  });

  test('city pages open on the wind answer', async ({ page }) => {
    await keepToday(page);
    await page.goto(CITY);
    await expect(page.locator('#question')).toHaveText('Is it windy in London today?');
    await expectWindBand(page);
    await expect(page.locator('#app')).toHaveAttribute('data-topic', 'wind');
    expect(await brandText(page)).toBe('isitwindy.today');
    // Each forecast's strongest gust, one row per model.
    await expect(page.locator('#list li .t').first()).toHaveText(/^\d+mph$/);
    await expect(page.locator('#agree')).toHaveText(/^\d of \d forecasts says? /);
    // The UV line is Hot's alone.
    await expect(page.locator('#uv')).toHaveAttribute('hidden', '');
  });

  test('a stormy city answers Yes all week, without a UK warnings link', async ({
    page,
    request,
  }) => {
    // Reykjavík's synthetic forecasts have a storm every hour (e2e runs in every month).
    const data = (await (
      await request.get('/api/v1/today?place=reykjavik-is&units=c')
    ).json()) as TodayResponse;
    expect(data.wind!.week!.answer).toBe('Yes.');
    await page.goto('/wind/in/reykjavik-is');
    await page.locator('#tab-week').click();
    await expect(page.locator('#week-question')).toHaveText(
      'Will it be windy in Reykjavík this week?',
    );
    await expect(page.locator('#week-answer')).toHaveText('Yes.');
    const band = await expectWindBand(page, 'week');
    expect(band).toBe('storm');
    await expect(page.locator('#week-days li .t').first()).toHaveText(/^\d+km\/h$/);
    await expect(page.locator('#warnings')).toHaveAttribute('hidden', '');
  });

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('city pages still show the wind answer', async ({ page, request }) => {
      // The server's page as it is: a city in its daytime opens on Today.
      const city = await cityAt(request, '08:00', '16:00');
      await page.goto(`/wind/in/${city.slug}`);
      await expect(page.locator('#question')).toHaveText(`Is it windy in ${city.name} today?`);
      await expect(page.locator('#answer')).toBeVisible();
      await expectWindBand(page);
    });
  });

  test('links stay on the wind pages when served under /wind', async ({ page }) => {
    await page.goto(CITY);
    await expect(page.locator('.brand')).toHaveAttribute('href', '/wind');
    const footer = page.locator('.site-footer nav a');
    await expect(footer).toHaveCount(5);
    for (const [i, name] of FOOTER.entries()) {
      await expect(footer.nth(i)).toHaveAttribute('href', `/wind/${name}`);
    }
    const nearby = page.locator('#nearby a');
    await expect(nearby).toHaveCount(8);
    for (const link of await nearby.all()) {
      await expect(link).toHaveAttribute('href', /^\/wind\/in\/[a-z0-9-]+$/);
    }
    // Other sites' links are left alone.
    await expect(page.locator('#out-0')).toHaveAttribute('href', /^https:\/\//);

    await footer.nth(1).click();
    await expect(page).toHaveURL(/\/wind\/about$/);
    expect(await brandText(page)).toBe('isitwindy.today');
    await expect(page.locator('.brand')).toHaveAttribute('href', '/wind');
    await expect(page.locator('main a[href="/wind/privacy"]')).toHaveCount(1);
  });

  test('a mistyped city redirects to its wind page', async ({ request }) => {
    const res = await request.get('/wind/in/London-GB', { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(new URL(res.headers().location!, 'http://x').pathname).toBe('/wind/in/london-gb');
  });

  test('OG images render as PNG', async ({ request }) => {
    for (const slug of ['london-gb', 'default']) {
      const res = await request.get(`/wind/og/${slug}.png`);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toBe('image/png');
      expect((await res.body()).subarray(1, 4).toString()).toBe('PNG');
    }
    expect((await request.get('/wind/og/atlantis-xx.png')).status()).toBe(404);
  });

  test('About, Privacy, Cookies and Terms carry the wind brand', async ({ request }) => {
    for (const name of CONTENT) {
      const res = await request.get(`/wind/${name}`);
      expect(res.status(), name).toBe(200);
      const html = await res.text();
      expect(html).toContain(`<link rel="canonical" href="https://isitwindy.today/${name}">`);
      expect(html).toMatch(/<title>[^<]+ \| isitwindy\.today<\/title>/);
      expect(html).toContain(WIND_BRAND);
      expect(html).toContain(ICON);
      // One service on four domains, the page's own first.
      expect(html).toContain(
        'isitwindy.today, isithot.today, isitwet.today and willitsnow.today are one service',
      );
    }
    const about = await (await request.get('/wind/about')).text();
    expect(about).toContain('<h2>Is it windy?</h2>');
    // The site's own question comes first.
    expect(about.indexOf('<h2>Is it windy?</h2>')).toBeLessThan(
      about.indexOf('<h2>Several forecasts, one answer</h2>'),
    );
    // The bands in both units, from WIND; never a warning of its own.
    expect(about).toContain('Breezy from a wind of 13 mph (21 km/h) or gusts of 20 mph (32 km/h).');
    expect(about).toContain('Gale from a wind of 39 mph (62 km/h) or gusts of 50 mph (80 km/h).');
    expect(about).toContain('Storm from a wind of 55 mph (88 km/h) or gusts of 70 mph (112 km/h).');
    expect(about).toContain('between 7am and 9pm');
    expect(about).toContain('These sites do not issue warnings.');
    // Six models, each with the agency that runs it; MET Norway and JMA are gone.
    expect(about).toContain('from 6 models run by ECMWF, NOAA (GFS), DWD (ICON),');
    expect(about).not.toMatch(/MET Norway|JMA/);
  });

  test('robots.txt and the sitemap name isitwindy.today', async ({ request }) => {
    const robots = await (await request.get('/wind/robots.txt')).text();
    expect(robots).toContain('Sitemap: https://isitwindy.today/sitemap.xml');
    const xml = await (await request.get('/wind/sitemap.xml')).text();
    // Home, About, places and every city page: the wind blows everywhere.
    const shown = CITIES.filter((c) => listed(c, 'wind'));
    expect(shown.length).toBe(CITIES.length);
    expect((xml.match(/<loc>/g) ?? []).length).toBe(3 + shown.length);
    expect(xml).toContain('<loc>https://isitwindy.today/places</loc>');
    expect(xml).toContain('<loc>https://isitwindy.today/in/london-gb</loc>');
    expect(xml).toContain('<loc>https://isitwindy.today/in/singapore-sg</loc>');
    expect(xml).not.toContain('isithot.today');
  });

  test('the icons and manifest are the wind site’s own', async ({ request }) => {
    const manifest = (await (await request.get('/wind/manifest.webmanifest')).json()) as {
      name: string;
      theme_color: string;
      icons: Array<{ src: string }>;
    };
    expect(manifest.name).toBe('Is it windy today?');
    expect(manifest.theme_color).toBe(WIND_PALETTES.windy.g1);
    for (const { src } of manifest.icons) {
      expect(src).toMatch(/^\/wind\/icons\//);
      expect((await request.get(src)).status(), src).toBe(200);
    }
    for (const file of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png']) {
      expect((await request.get(`/wind/${file}`)).status(), file).toBe(200);
    }
  });

  test('unknown pages are a wind 404', async ({ request, page }) => {
    for (const path of ['/wind/no-such-page', '/wind/in/atlantis-xx']) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(404);
      const html = await res.text();
      expect(html).toContain('<title>Not found | isitwindy.today</title>');
      expect(html).toContain(WIND_BRAND);
      expect(html).toContain('<meta name="robots" content="noindex">');
      expect(html).toContain(ICON);
    }
    await page.goto('/wind/no-such-page');
    await expect(page.locator('.question')).toHaveText('Is it windy here?');
    await expect(page.locator('main a')).toHaveAttribute('href', '/wind');
  });
});
