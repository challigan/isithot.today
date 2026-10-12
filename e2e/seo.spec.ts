/**
 * What search engines see, on all three sites (served here under '', /wet and /snow): home pages
 * that keep their loading placeholder out of snippets and say what the site does, a places page
 * per site, city pages that link on (nearby, the same city on the other sites, the places page),
 * titles that never carry the answer, the "Updated" line, headings that hold the question and its
 * answer, valid structured data, and snow pages kept out of search where it never snows
 * (core `listed`). The real domains' routing of the same links is in domains.spec.ts.
 */
import type { Page } from '@playwright/test';
import { LINKS, MODELS, SITES, TOPICS, sitePath, type Topic } from '../packages/core/src/config';
import {
  COPY,
  DEFAULT_TITLES,
  cityDescription,
  cityTitle,
  intro,
  placesIntro,
  question,
  updatedTime,
} from '../packages/core/src/copy';
import { listed, snowless } from '../packages/core/src/places';
import type { TodayResponse } from '../packages/core/src/types';
import { CITIES, cityAt, expect, keepToday, startClock, test } from './helpers';

const prefix = (topic: Topic) => SITES[topic].prefix;
const home = (topic: Topic) => prefix(topic) || '/';
const NAMES = new Map(CITIES.map((c) => [c.slug, c.name]));

/** Every JSON-LD block in a page, parsed: one that is not valid JSON fails the test. */
function structuredData(html: string): Array<Record<string, unknown>> {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(
    (m) => JSON.parse(m[1]!) as Record<string, unknown>,
  );
}

/** A BreadcrumbList's steps, checked for shape: numbered from 1, each a name and an address. */
function breadcrumbs(data: Record<string, unknown>): Array<[string, string]> {
  expect(data['@context']).toBe('https://schema.org');
  expect(data['@type']).toBe('BreadcrumbList');
  const items = data.itemListElement as Array<Record<string, unknown>>;
  return items.map((item, i) => {
    expect(item).toMatchObject({ '@type': 'ListItem', position: i + 1 });
    return [item.name as string, item.item as string];
  });
}

const attr = (html: string, pattern: RegExp) => pattern.exec(html)?.[1];

/** The answer the city page was rendered from, which it carries for the browser. */
async function initial(page: Page): Promise<TodayResponse> {
  return JSON.parse((await page.locator('#initial').textContent())!) as TodayResponse;
}

test.describe('home pages', () => {
  for (const topic of TOPICS) {
    test(`${home(topic)}: a stable title, the site's name and its introduction`, async ({
      request,
    }) => {
      const html = await (await request.get(home(topic))).text();
      expect(html).toContain(`<title>${DEFAULT_TITLES[topic]}</title>`);
      // The answer is the visitor's own, worked out in the browser: never in the served page.
      expect(html).toMatch(/<span class="answer" id="answer"( data-long)?>\s*Checking…\s*<\/span>/);
      // The views, placeholder and all, are kept out of search snippets.
      expect(html).toContain('<div class="views" id="views" data-nosnippet>');

      const data = structuredData(html);
      expect(data).toEqual([
        {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: SITES[topic].name,
          alternateName: question(null, 'today', topic),
          url: `${SITES[topic].url}/`,
          inLanguage: 'en-GB',
        },
      ]);
    });
  }

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    for (const topic of TOPICS) {
      test(`${home(topic)}: the placeholder is only ever inside data-nosnippet`, async ({
        page,
      }) => {
        await page.goto(home(topic));
        await expect(page.locator('#answer')).toHaveText('Checking…');
        const outside = await page.evaluate(() => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const found: string[] = [];
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const text = n.textContent ?? '';
            // The placeholder's made-up values: "00°", "0pm", "September", "Checking…".
            if (!/\b0+°|\b0+(am|pm|mm|cm|%)|September|Checking…/.test(text)) continue;
            if (n.parentElement?.closest('script, [data-nosnippet]')) continue;
            found.push(text.trim());
          }
          return found;
        });
        expect(outside).toEqual([]);
      });

      test(`${home(topic)}: an introduction and popular places below the answer`, async ({
        page,
      }) => {
        await page.goto(home(topic));
        const { heading, text } = intro(topic);
        const section = page.getByRole('region', { name: heading });
        await expect(section).toBeVisible();
        await expect(section.locator('p').first()).toHaveText(`${text} ${COPY.howItWorks}`);
        await expect(section).toContainText(`${MODELS.length} forecast models`);
        await expect(section.getByRole('link', { name: COPY.howItWorks })).toHaveAttribute(
          'href',
          '/about',
        );
        // About 20 UK city pages, then the places page.
        const popular = section.locator('.place-list a');
        await expect(popular).toHaveCount(LINKS.popular.length);
        expect(LINKS.popular.length).toBeGreaterThanOrEqual(18);
        for (const [i, slug] of LINKS.popular.entries()) {
          await expect(popular.nth(i)).toHaveAttribute('href', `/in/${slug}`);
          await expect(popular.nth(i)).toHaveText(NAMES.get(slug)!);
        }
        await expect(section.getByRole('link', { name: COPY.allPlaces })).toHaveAttribute(
          'href',
          '/places',
        );
        // Under the views and outside the page's main part, so the answer comes first.
        await expect(page.locator('main .intro')).toHaveCount(0);
        const views = (await page.locator('#views').boundingBox())!;
        const box = (await section.boundingBox())!;
        expect(box.y).toBeGreaterThan(views.y + views.height);
      });
    }
  });

  for (const topic of TOPICS) {
    test(`${home(topic)}: the answered page keeps its title, says when it was updated, and links on`, async ({
      page,
      ipPlace,
    }) => {
      await keepToday(page, ipPlace.tz);
      const answer = page.waitForResponse((r) => r.url().includes('/api/v1/today'));
      await page.goto(home(topic));
      const data = (await (await answer).json()) as TodayResponse;
      await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
      await expect(page).toHaveTitle(DEFAULT_TITLES[topic]);
      // The answer for a crawler's own location stays out of snippets too.
      await expect(page.locator('#views')).toHaveAttribute('data-nosnippet', '');
      await expect(page.locator('#updated')).toBeVisible();
      await expect(page.locator('#updated time')).toHaveAttribute('datetime', data.updatedAt);
      await expect(page.locator('#updated')).toHaveText(
        `Updated ${updatedTime(data.updatedAt, data.location.timezone, data.days[0]!.date)}`,
      );
      // The links stay on the site where it is served under its prefix (here, and on previews).
      const block = page.locator('.intro');
      await expect(block.getByRole('link', { name: COPY.allPlaces })).toHaveAttribute(
        'href',
        `${prefix(topic)}/places`,
      );
      await expect(block.locator('.place-list a').first()).toHaveAttribute(
        'href',
        `${prefix(topic)}/in/london-gb`,
      );
      // At the end of the page the footer is clear of the phone's floating Hot | Wet | Snow pill.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.locator('.site-footer').getByRole('link', { name: 'Places' }).click();
      await expect(page).toHaveURL(new RegExp(`${prefix(topic)}/places$`));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(COPY.places);
    });
  }
});

test.describe('places pages', () => {
  for (const topic of TOPICS) {
    test(`${prefix(topic)}/places lists every city page the site lists`, async ({
      page,
      request,
    }) => {
      const res = await request.get(`${prefix(topic)}/places`);
      expect(res.status()).toBe(200);
      const html = await res.text();
      const { name, url } = SITES[topic];
      expect(html).toContain(`<title>Places | ${name}</title>`);
      expect(html).toContain(`<link rel="canonical" href="${url}/places">`);
      expect(html).toContain(`<meta name="description" content="${placesIntro(topic)}">`);
      expect(html).not.toContain('<meta name="robots"');
      const [trail, ...rest] = structuredData(html);
      expect(rest).toEqual([]);
      expect(breadcrumbs(trail!)).toEqual([
        [name, `${url}/`],
        ['Places', `${url}/places`],
      ]);
      // In the site's sitemap.
      const xml = await (await request.get(`${prefix(topic)}/sitemap.xml`)).text();
      expect(xml).toContain(`<loc>${url}/places</loc>`);

      await page.goto(`${prefix(topic)}/places`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Places');
      await expect(page.getByRole('heading', { level: 2 })).toHaveText([
        'United Kingdom',
        'Around the world',
      ]);
      // The UK by nation first, then the world by country, A to Z.
      const groups = await page.getByRole('heading', { level: 3 }).allTextContents();
      expect(groups.slice(0, 4)).toEqual(['England', 'Scotland', 'Wales', 'Northern Ireland']);
      const countries = groups.slice(4);
      expect(countries).toEqual([...countries].sort((a, b) => a.localeCompare(b, 'en-GB')));
      expect(countries).toContain('Spain');

      // Every city page the site lists, each once, on the site's own pages.
      const shown = CITIES.filter((c) => listed(c, topic));
      const hrefs = await page
        .locator('.place-list a')
        .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
      expect(hrefs.sort()).toEqual(shown.map((c) => `${prefix(topic)}/in/${c.slug}`).sort());
      const note = page.getByText(COPY.snowlessNote);
      if (shown.length < CITIES.length) await expect(note).toBeVisible();
      else await expect(note).toHaveCount(0);
      await page.getByRole('link', { name: 'Edinburgh', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${prefix(topic)}/in/edinburgh-gb$`));
      await expect(page.locator('#question, #now-question').first()).toContainText('Edinburgh');
    });
  }

  test('nothing scrolls sideways at 320px with 200% text', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const topic of TOPICS) {
      await page.goto(`${prefix(topic)}/places`);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
        .toBeLessThanOrEqual(0);
    }
  });
});

test.describe('city pages', () => {
  for (const topic of TOPICS) {
    test(`${prefix(topic)}/in/london-gb: stable title, share card, breadcrumbs and links on`, async ({
      page,
      request,
    }) => {
      const html = await (await request.get(`${prefix(topic)}/in/london-gb`)).text();
      const { name, url } = SITES[topic];
      const title = cityTitle('London', topic);
      expect(title).toMatch(new RegExp(`forecasts \\| ${name.replace('.', '\\.')}$`));
      expect(html).toContain(`<title>${title}</title>`);
      expect(html).toContain(
        `<meta name="description" content="${cityDescription('London', topic)}">`,
      );
      // Share cards keep today's answer, as the page does.
      expect(attr(html, /<meta property="og:title" content="([^"]*)">/)).toMatch(
        new RegExp(
          `^${question('London', 'today', topic).replace('?', '\\?')} (Yes|No|Almost|Maybe)\\. `,
        ),
      );
      expect(html).not.toContain('<meta name="robots"');
      const [trail, ...rest] = structuredData(html);
      expect(rest).toEqual([]);
      expect(breadcrumbs(trail!)).toEqual([
        [name, `${url}/`],
        ['Places', `${url}/places`],
        ['London', `${url}/in/london-gb`],
      ]);
      // The same city on the other two sites, as real links to their own domains.
      for (const other of TOPICS.filter((t) => t !== topic)) {
        expect(html).toContain(
          `<a href="${SITES[other].url}/in/london-gb" data-site="${other}" data-path="/in/london-gb">${question('London', 'today', other)}</a>`,
        );
      }
      expect(html).toContain(`<a href="/places">${COPY.allPlaces}</a>`);

      await keepToday(page);
      await page.goto(`${prefix(topic)}/in/london-gb`);
      const data = await initial(page);
      // Eight nearby city pages, nearest first.
      const nearby = page.locator('#nearby a');
      await expect(nearby).toHaveCount(LINKS.nearby);
      await expect(nearby).toHaveText(data.nearby!.map((c) => c.name));
      // Here (as on a deploy preview) the other sites' pages are on this host.
      const also = page.locator('#also a');
      await expect(also).toHaveText([
        ...TOPICS.filter((t) => t !== topic).map((t) => question('London', 'today', t)),
        COPY.allPlaces,
      ]);
      for (const other of TOPICS.filter((t) => t !== topic)) {
        await expect(page.locator(`#also a[data-site=${other}]`)).toHaveAttribute(
          'href',
          sitePath(other, '/in/london-gb', 'localhost'),
        );
      }
      await expect(page.getByRole('link', { name: COPY.allPlaces })).toHaveAttribute(
        'href',
        `${prefix(topic)}/places`,
      );
      const other = TOPICS.find((t) => t !== topic)!;
      await page.locator(`#also a[data-site=${other}]`).click();
      await expect(page.locator('#app')).toHaveAttribute('data-topic', other);
      await expect(page).toHaveTitle(cityTitle('London', other));
    });
  }

  test('the Updated line says when the forecast was fetched, and keeps up', async ({ page }) => {
    await keepToday(page);
    await page.goto('/in/london-gb');
    const data = await initial(page);
    const updated = page.locator('#updated');
    await expect(updated).toBeVisible();
    const time = updated.locator('time');
    await expect(time).toHaveAttribute('datetime', data.updatedAt);
    const text = updatedTime(data.updatedAt, data.location.timezone, data.days[0]!.date);
    // London's own zone: BST or GMT.
    expect(text).toMatch(/^\d{1,2}:\d\d[ap]m (BST|GMT)$/);
    await expect(updated).toHaveText(`Updated ${text}`);

    // A newer forecast (here, one fetched ten minutes earlier) is shown when the page refreshes.
    const fetched = new Date(Date.parse(data.updatedAt) - 10 * 60 * 1000).toISOString();
    await page.route('**/api/v1/today**', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as TodayResponse;
      await route.fulfill({ response, json: { ...body, updatedAt: fetched } });
    });
    await page.locator('[data-units="f"]').click();
    await expect(time).toHaveAttribute('datetime', fetched);
    await expect(updated).toHaveText(
      `Updated ${updatedTime(fetched, data.location.timezone, data.days[0]!.date)}`,
    );
  });

  test('headings hold the question and its answer, one h1 a page', async ({ page, request }) => {
    // A city in its daytime: the page opens on Today.
    const city = await cityAt(request, '10:00', '15:30');
    await page.goto(`/in/${city.slug}`);
    await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText(`Is it hot in ${city.name} today? ${city.data.days[0]!.answer}`);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1#heading > #question + #answer')).toHaveCount(1);
    for (const view of ['now', 'week']) {
      await expect(
        page.locator(`h2#${view}-heading > #${view}-question + #${view}-answer`),
      ).toHaveCount(1);
    }
    // An answer that arrives or changes is read out with its question and verdict.
    await expect(
      page.locator('#live[aria-live=polite][aria-atomic=true] > h1 + #verdict'),
    ).toHaveCount(1);

    // The view on screen has the page's main heading.
    await page.locator('#tab-week').click();
    await expect(page.locator('#week-heading')).toHaveAttribute('aria-level', '1');
    await expect(page.locator('#week-heading')).toHaveText(
      new RegExp(`^\\s*Is it hot in ${city.name} this week\\?\\s+(Yes|No|Almost)\\.\\s*$`),
    );
    await page.locator('#tab-now').click();
    await expect(page.locator('#now-heading')).toHaveAttribute('aria-level', '1');
    await expect(page.locator('#week-heading')).not.toHaveAttribute('aria-level');
    await expect(page.locator('#now-heading')).toHaveText(
      new RegExp(`^\\s*Is it hot in ${city.name} right now\\?\\s+(Yes|No|Almost)\\.\\s*$`),
    );
  });

  test('the minute-by-minute update never touches the announced heading', async ({
    page,
    request,
  }) => {
    const city = await cityAt(request, '10:00', '15:00');
    await startClock(page);
    await page.goto(`/in/${city.slug}`);
    await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
    await page.evaluate(() => {
      const counts = { live: 0, now: 0 };
      (window as unknown as { __counts: typeof counts }).__counts = counts;
      const watch = (id: string, key: keyof typeof counts) =>
        new MutationObserver((list) => (counts[key] += list.length)).observe(
          document.getElementById(id)!,
          { subtree: true, childList: true, characterData: true },
        );
      watch('live', 'live');
      watch('now-hours', 'now');
    });
    await page.clock.runFor('03:00');
    const counts = await page.evaluate(
      () => (window as unknown as { __counts: { live: number; now: number } }).__counts,
    );
    // Now was worked out again each minute; Today's question and answer stayed as they were.
    expect(counts.now).toBeGreaterThan(0);
    expect(counts.live).toBe(0);
  });
});

test.describe('snow pages where it never snows', () => {
  const out = CITIES.filter((c) => !listed(c, 'snow'));

  test('the rule: within 30° of the equator, below 3,000 m', () => {
    expect(out.length).toBe(63);
    for (const c of CITIES) {
      const low = Math.abs(c.lat) < 30 && (c.elevation ?? 0) < 3000;
      expect(snowless(c), c.slug).toBe(low);
    }
  });

  test('are kept out of search, and still answer', async ({ request }) => {
    const robots = '<meta name="robots" content="noindex">';
    const singapore = await request.get('/snow/in/singapore-sg');
    expect(singapore.status()).toBe(200);
    const html = await singapore.text();
    expect(html).toContain(robots);
    expect(html).toContain('<title>Will it snow in Singapore today?');
    // Its hot and wet pages, and snow pages where it can snow, are for search engines.
    for (const path of ['/in/singapore-sg', '/wet/in/singapore-sg', '/snow/in/london-gb']) {
      expect(await (await request.get(path)).text(), path).not.toContain(robots);
    }
    // Neither the snow sitemap nor the snow places page lists them; the others list everyone.
    const sitemap = await (await request.get('/snow/sitemap.xml')).text();
    const places = await (await request.get('/snow/places')).text();
    for (const c of out) {
      expect(sitemap).not.toContain(`/in/${c.slug}<`);
      expect(places).not.toContain(`/in/${c.slug}"`);
    }
    for (const t of ['', '/wet']) {
      const xml = await (await request.get(`${t}/sitemap.xml`)).text();
      expect(xml).toContain('/in/singapore-sg<');
    }
    // Nor do the other sites' pages for them link to it.
    const hot = await (await request.get('/in/singapore-sg')).text();
    expect(hot).not.toContain('data-site="snow"');
    expect(hot).toContain('data-site="wet"');
  });
});
