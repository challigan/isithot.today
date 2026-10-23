import type { Page } from '@playwright/test';
import { WIND_BANDS, WIND_PALETTES, type WindBand } from '../packages/core/src/config';
import { WIND_ANSWERS, cityTitle, windPageTitle } from '../packages/core/src/copy';
import { previewResponse } from '../packages/core/src/preview';
import { listed } from '../packages/core/src/places';
import type { TodayResponse } from '../packages/core/src/types';
import { WIND_GLYPHS } from '../apps/web/src/lib/windGlyphs';
import { CITIES, cityAt, expect, keepToday, test, toggle } from './helpers';

// The wind pages as a deploy preview or a local server serves them: under /wind. On
// isitwindy.today the edge function serves the same pages at the root (smoke.mjs checks that on
// the preview).
const CITY = '/wind/in/london-gb';
const CONTENT = ['about', 'privacy', 'cookies', 'terms', 'support'] as const;
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
    // More stormy days than are named: all of them, never three that read as the only ones.
    expect(data.wind!.week!.verdict).toBe('A windy week, storm-force winds all week.');
    await page.goto('/wind/in/reykjavik-is');
    await page.locator('#tab-week').click();
    await expect(page.locator('#week-question')).toHaveText(
      'Will it be windy in Reykjavík this week?',
    );
    await expect(page.locator('#week-answer')).toHaveText('Yes.');
    await expect(page.locator('#week-verdict')).toHaveText(data.wind!.week!.verdict);
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
    await expect(footer).toHaveCount(FOOTER.length);
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

  test('About, Privacy, Cookies, Terms and Support carry the wind brand', async ({ request }) => {
    for (const name of CONTENT) {
      const res = await request.get(`/wind/${name}`);
      expect(res.status(), name).toBe(200);
      const html = await res.text();
      expect(html).toContain(`<link rel="canonical" href="https://isitwindy.today/${name}">`);
      expect(html).toMatch(/<title>[^<]+ \| isitwindy\.today<\/title>/);
      expect(html).toContain(WIND_BRAND);
      expect(html).toContain(ICON);
      // One service on four domains, the page's own first. Support is about the snow app alone.
      const service =
        'isitwindy.today, isithot.today, isitwet.today and willitsnow.today are one service';
      if (name === 'support') expect(html).not.toContain(service);
      else expect(html).toContain(service);
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
    // Which way the arrows point, and when there is no direction, from WIND.direction.
    expect(about.replace(/\s+/g, ' ')).toContain(
      "so a wind from the south-west (SW) points north-east. When the middle of the forecasts' " +
        'winds is under 5 mph (8 km/h), or the forecasts point different ways',
    );
    expect(about).toContain('These sites do not issue warnings.');
    // Six models, each with the agency that runs it; MET Norway and JMA are gone.
    expect(about).toContain('from 6 models run by ECMWF, NOAA (GFS), DWD (ICON),');
    expect(about).not.toMatch(/MET Norway|JMA/);
  });

  test('robots.txt and the sitemap name isitwindy.today', async ({ request }) => {
    const robots = await (await request.get('/wind/robots.txt')).text();
    expect(robots).toContain('Sitemap: https://isitwindy.today/sitemap.xml');
    const xml = await (await request.get('/wind/sitemap.xml')).text();
    // Home, About, places, support and every city page: the wind blows everywhere.
    const shown = CITIES.filter((c) => listed(c, 'wind'));
    expect(shown.length).toBe(CITIES.length);
    expect((xml.match(/<loc>/g) ?? []).length).toBe(4 + shown.length);
    expect(xml).toContain('<loc>https://isitwindy.today/places</loc>');
    expect(xml).toContain('<loc>https://isitwindy.today/support</loc>');
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

test.describe('where the wind blows from', () => {
  /** The turn of each arrow in a part of the page, degrees. */
  const turns = (page: Page, selector: string) =>
    page
      .locator(`${selector} .arrow path`)
      .evaluateAll((paths) =>
        paths.map((p) => Number(/^rotate\((\d+) 12 12\)$/.exec(p.getAttribute('transform')!)![1])),
      );

  test('Now and each row show an arrow and the compass point, and say it in words', async ({
    page,
  }) => {
    // The preview's windy sample: from the south-west, veering to the west by evening.
    const wind = previewResponse('windy').wind!;
    const now = wind.now!;
    await page.goto('/wind?preview=1&band=windy');
    await expect(page.locator('#detail')).toHaveText(wind.days[0]!.detail);
    await expect(page.locator('#detail')).toHaveText(
      'Gusts up to 35mph from the south-west, wind up to 17mph. Windiest around 2pm.',
    );
    await page.locator('#tab-now').click();
    await expect(page.locator('#now-detail')).toHaveText(
      'Wind 15mph from the south-west, gusts 32mph right now. Easing off by about 9pm.',
    );
    // The line under it: the arrow points where the wind goes (from 227° it goes to 47°), with
    // the letters beside it; screen readers have heard it in the detail, so it is hidden from them.
    const line = page.locator('#now-dir');
    await expect(line).toBeVisible();
    await expect(line).toHaveText('SW');
    await expect(line).toHaveAttribute('aria-hidden', 'true');
    expect(now.direction!.degrees).toBe(227);
    expect(await turns(page, '#now-dir')).toEqual([47]);
    // Each row: the arrow and letters for everyone, the words for screen readers.
    const rows = page.locator('#now-hours li');
    await expect(rows).toHaveCount(6);
    await expect(page.locator('#now-hours .w')).toHaveText(
      now.hours.map((h) => h.direction!.compass),
    );
    await expect(page.locator('#now-hours .w').first()).toHaveAttribute('aria-hidden', 'true');
    expect(await turns(page, '#now-hours')).toEqual(
      now.hours.map((h) => (h.direction!.degrees + 180) % 360),
    );
    await expect(page.locator('#now-hours .sr-only').first()).toHaveText(
      `Gusts up to ${now.hours[0]!.gust}mph from ${now.hours[0]!.label}, wind from the south-west`,
    );
    await expect(page.locator('#now-hours .sr-only').last()).toHaveText(/, wind from the west$/);
    // Never on the week, nor as an arrow on Today.
    await expect(page.locator('#view-today .arrow, #view-week .arrow')).toHaveCount(0);
  });

  test('a variable direction is left out, and its rows keep their place', async ({ page }) => {
    // The calm sample's light air has no direction to name.
    await page.goto('/wind?preview=1&band=calm');
    await expect(page.locator('#detail')).toHaveText(
      'Light winds, gusts up to 7mph. Calmer than usual for June.',
    );
    await page.locator('#tab-now').click();
    await expect(page.locator('#now-detail')).toHaveText(
      'Wind 2mph, gusts 6mph right now. Light winds for the next 12 hours.',
    );
    await expect(page.locator('#now-dir')).toBeHidden();
    await expect(page.locator('#now-hours .w')).toHaveCount(6);
    await expect(page.locator('#now-hours .arrow')).toHaveCount(0);
    await expect(page.locator('#now-hours .sr-only').first()).toHaveText(
      /^Gusts up to \d+mph from \d+(am|pm)$/,
    );
    // The empty line still holds its height, so every row is as tall as one with a direction.
    const heights = await page
      .locator('#now-hours .w')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(Math.min(...heights)).toBeGreaterThan(10);
    // A windy sample, one switch away, shows it again.
    await page.locator('#preview [data-band=windy]').click();
    await expect(page.locator('#now-dir')).toHaveText('SW');
  });

  test("Reykjavík's storm comes from the north-east, on the server's page and in the browser", async ({
    page,
    request,
  }) => {
    const html = await (await request.get('/wind/in/reykjavik-is')).text();
    expect(html).toMatch(
      /<p class="dir hold" id="now-dir" aria-hidden="true"><svg class="arrow"[^>]*><path [^>]*transform="rotate\(2[1-3]\d 12 12\)"\/><\/svg><span>NE<\/span><\/p>/,
    );
    expect(html).toContain(', wind from the north-east</span>');
    await page.goto('/wind/in/reykjavik-is');
    await page.locator('#tab-now').click();
    await expect(page.locator('#now-detail')).toHaveText(/^\s*Wind \d+km\/h from the north-east, /);
    await expect(page.locator('#now-dir')).toHaveText('NE');
    // Pointing south-west, where the storm goes.
    for (const turn of await turns(page, '#view-now')) {
      expect(turn).toBeGreaterThanOrEqual(213);
      expect(turn).toBeLessThanOrEqual(237);
    }
    await expect(page.locator('#detail')).toHaveText(
      /^\s*Gusts up to \d+km\/h from the north-east, /,
    );
  });

  test('the other topics show no direction', async ({ page }) => {
    await page.goto('/wind?preview=1&band=windy');
    await page.locator('#tab-now').click();
    await expect(page.locator('#now-dir')).toBeVisible();
    for (const topic of ['hot', 'wet', 'snow'] as const) {
      await toggle(page, topic).click();
      await expect(page.locator('main')).toHaveAttribute('data-topic', topic);
      await expect(page.locator('#now-dir')).toBeHidden();
      await expect(page.locator('#now-hours li')).toHaveCount(6);
      await expect(page.locator('#now-hours .w, #now-hours .arrow')).toHaveCount(0);
      await expect(page.locator('#now-detail')).not.toHaveText(/ from the /);
    }
    await toggle(page, 'wind').click();
    await expect(page.locator('#now-dir')).toHaveText('SW');
  });
});
