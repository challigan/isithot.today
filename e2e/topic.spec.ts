/**
 * Hot | Wet | Snow: each site opens on its own question, and the toggle answers the others in
 * place from the same response.
 */
import type { Page } from '@playwright/test';
import {
  PALETTES,
  RAIN_PALETTES,
  SNOW_PALETTES,
  TOPICS,
  type Band,
  type RainBand,
  type SnowBand,
  type Topic,
} from '../packages/core/src/config';
import { RAIN_GLYPHS } from '../apps/web/src/lib/wetGlyphs';
import { SNOW_GLYPHS } from '../apps/web/src/lib/snowGlyphs';
import {
  DAYTIME,
  expect,
  keepToday,
  serverNow,
  setVisibility,
  startClock,
  test,
  todayTime,
  toggle,
} from './helpers';

const HOT_ANSWERS = /^(Yes\.|No\.|Almost\.)$/;
const WET_ANSWERS = /^(Yes\.|No\.|Maybe\.)$/;
const WET_WEEK_ANSWERS = /^(Yes\.|No\.|Maybe\.|Partly\.)$/;
const SNOW_ANSWERS = /^(Yes\.|No\.|Maybe\.)$/;
const HOUR = 60 * 60 * 1000;

async function ready(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(page.locator('#answer')).toHaveText(
    path.startsWith('/wet') ? WET_ANSWERS : path.startsWith('/snow') ? SNOW_ANSWERS : HOT_ANSWERS,
  );
}

async function expectTopic(page: Page, topic: Topic): Promise<void> {
  await expect(toggle(page, topic)).toHaveAttribute('aria-pressed', 'true');
  for (const other of TOPICS.filter((t) => t !== topic)) {
    await expect(toggle(page, other)).toHaveAttribute('aria-pressed', 'false');
  }
}

/** The icon is `markup`, serialised through the browser so markup style does not matter. */
async function expectGlyph(page: Page, id: string, markup: string): Promise<void> {
  const icon = await page.evaluate(
    ([el, m]) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.innerHTML = m;
      return { expected: svg.innerHTML, actual: document.getElementById(el)!.innerHTML };
    },
    [id, markup] as const,
  );
  expect(icon.actual).toBe(icon.expected);
}

/** The page's gradient colour, which follows the band of the view on screen. */
const g1 = (page: Page) =>
  page.evaluate(() => document.documentElement.style.getPropertyValue('--g1'));

const band = async (page: Page, view: 'now' | 'today' | 'week') =>
  (await page.locator(`#view-${view}`).getAttribute('data-band')) as string;

test.describe('Hot | Wet | Snow', () => {
  test('each site opens on its own question', async ({ page, request, ipPlace }) => {
    // The wet home page asks its question before any script runs.
    const html = await (await request.get('/wet')).text();
    expect(html).toMatch(/<p class="question" id="question">\s*Is it wet today\?\s*</);
    expect(html).toContain('<link rel="canonical" href="https://isitwet.today/"');

    await keepToday(page, ipPlace.tz);
    await ready(page, '/');
    await expectTopic(page, 'hot');
    await expect(page.getByRole('group', { name: 'Forecast type' })).toBeVisible();
    await expect(page.locator('#question')).toHaveText('Is it hot today?');
    await expect(page.locator('[data-units]')).toHaveText(['°C', '°F']);
    await expect(page.getByRole('group', { name: 'Temperature units' })).toBeVisible();
    await expect(page).toHaveTitle(/^(Yes|No|Almost)\. .+ \| isithot\.today$/);

    await ready(page, '/wet');
    await expectTopic(page, 'wet');
    await expect(page.locator('#question')).toHaveText('Is it wet today?');
    await expect(page.locator('#verdict')).not.toBeEmpty();
    await expect(page.locator('#agree')).toHaveText(/^\d of \d forecasts expects? rain$/);
    await expect(page.locator('[data-units]')).toHaveText(['mm', 'in']);
    await expect(page.getByRole('group', { name: 'Rain units' })).toBeVisible();
    await expect(page).toHaveTitle(/^(Yes|No|Maybe)\. .+ \| isitwet\.today$/);
    const today = (await band(page, 'today')) as RainBand;
    await expect.poll(() => g1(page)).toBe(RAIN_PALETTES[today].g1);

    const snow = await (await request.get('/snow')).text();
    expect(snow).toMatch(/<p class="question" id="question">\s*Will it snow today\?\s*</);
    expect(snow).toContain('<link rel="canonical" href="https://willitsnow.today/"');
    await ready(page, '/snow');
    await expectTopic(page, 'snow');
    await expect(page.locator('#question')).toHaveText('Will it snow today?');
    await expect(page.locator('#verdict')).not.toBeEmpty();
    await expect(page.locator('#agree')).toHaveText(/^\d of \d forecasts expects? snow$/);
    await expect(page.locator('[data-units]')).toHaveText(['cm', 'in']);
    await expect(page.getByRole('group', { name: 'Snow units' })).toBeVisible();
    await expect(page).toHaveTitle(/^(Yes|No|Maybe)\. .+ \| willitsnow\.today$/);
    const snowToday = (await band(page, 'today')) as SnowBand;
    await expect.poll(() => g1(page)).toBe(SNOW_PALETTES[snowToday].g1);
  });

  test('the wet home page does not shift while it loads', async ({ page }) => {
    // The width of most phones, where "mm | in" and "Finding you…" only just fit beside the name.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as Array<
          PerformanceEntry & { value: number; hadRecentInput: boolean }
        >) {
          if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await ready(page, '/wet');
    await page.waitForTimeout(1500);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.02);
  });

  test('the toggle answers the other question in place, on the same view', async ({
    page,
    ipPlace,
  }) => {
    await keepToday(page, ipPlace.tz);
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/today')) calls.push(r.url());
    });
    await ready(page, '/');
    await page.locator('#tab-week').click();
    await expect(page.locator('#tab-week')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#week-question')).toHaveText('Is it hot this week?');

    await toggle(page, 'wet').click();
    await expectTopic(page, 'wet');
    // Still on This week, now answering "Is it wet?" in every view.
    await expect(page.locator('#tab-week')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#view-week')).not.toHaveAttribute('inert', '');
    await expect(page.locator('#week-question')).toHaveText('Is it wet this week?');
    await expect(page.locator('#week-answer')).toHaveText(WET_WEEK_ANSWERS);
    await expect(page.locator('#week-days li')).toHaveCount(7);
    await expect(page.locator('#week-days li .t').first()).toHaveText(/^[\d.]+mm$/);
    await expect(page.locator('#question')).toHaveText('Is it wet today?');
    await expect(page.locator('#now-question')).toHaveText('Is it wet right now?');
    await expect(page.locator('#now-h')).toHaveText('Chance of rain, next 12 hours');
    const week = (await band(page, 'week')) as RainBand;
    expect(Object.keys(RAIN_PALETTES)).toContain(week);
    await expect.poll(() => g1(page)).toBe(RAIN_PALETTES[week].g1);
    // The icon is the rain band's.
    await expectGlyph(page, 'week-glyph', RAIN_GLYPHS[week]);
    await expect(page.locator('[data-units]')).toHaveText(['mm', 'in']);
    await expect(page.getByRole('group', { name: 'Rain units' })).toBeVisible();
    const answer = await page.locator('#answer').textContent();
    const verdict = await page.locator('#verdict').textContent();
    // The home page names the site of the question on screen, as the header does.
    await expect(page).toHaveTitle(`${answer!.trim()} ${verdict!.trim()} | isitwet.today`);

    await toggle(page, 'snow').click();
    await expectTopic(page, 'snow');
    // Still on This week, now answering "Will it snow?" in every view.
    await expect(page.locator('#tab-week')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#view-week')).not.toHaveAttribute('inert', '');
    await expect(page.locator('#week-question')).toHaveText('Will it snow this week?');
    await expect(page.locator('#week-answer')).toHaveText(SNOW_ANSWERS);
    await expect(page.locator('#week-days li')).toHaveCount(7);
    await expect(page.locator('#week-days li .t').first()).toHaveText(/^[\d.]+cm$/);
    await expect(page.locator('#question')).toHaveText('Will it snow today?');
    await expect(page.locator('#now-question')).toHaveText('Is it snowing right now?');
    await expect(page.locator('#now-h')).toHaveText('Chance of snow, next 12 hours');
    const snowWeek = (await band(page, 'week')) as SnowBand;
    expect(Object.keys(SNOW_PALETTES)).toContain(snowWeek);
    await expect.poll(() => g1(page)).toBe(SNOW_PALETTES[snowWeek].g1);
    await expectGlyph(page, 'week-glyph', SNOW_GLYPHS[snowWeek]);
    await expect(page.locator('[data-units]')).toHaveText(['cm', 'in']);
    await expect(page.getByRole('group', { name: 'Snow units' })).toBeVisible();
    const snowAnswer = await page.locator('#answer').textContent();
    const snowVerdict = await page.locator('#verdict').textContent();
    await expect(page).toHaveTitle(
      `${snowAnswer!.trim()} ${snowVerdict!.trim()} | willitsnow.today`,
    );

    await toggle(page, 'hot').click();
    await expectTopic(page, 'hot');
    await expect(page.locator('#tab-week')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#week-question')).toHaveText('Is it hot this week?');
    await expect(page.locator('#week-answer')).toHaveText(HOT_ANSWERS);
    await expect.poll(() => g1(page)).toBe(PALETTES[(await band(page, 'week')) as Band].g1);
    await expect(page.locator('[data-units]')).toHaveText(['°C', '°F']);
    await expect(page).toHaveTitle(/^(Yes|No|Almost)\. .+ \| isithot\.today$/);
    // Both answers come in the one response.
    expect(calls).toHaveLength(1);
  });

  test('rain falls a few times, then rests', async ({ page }) => {
    await page.goto('/?preview=1&band=rain');
    const fall = page.locator('#glyph .fall').first();
    await expect(fall).toHaveCSS('animation-name', 'fall');
    await expect(fall).toHaveCSS('animation-iteration-count', '3');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(fall).toHaveCSS('animation-name', 'none');
  });

  test('snow drifts down twice, then rests', async ({ page }) => {
    await page.goto('/?preview=1&band=snow');
    const drift = page.locator('#glyph .drift').first();
    await expect(drift).toHaveCSS('animation-name', 'drift');
    await expect(drift).toHaveCSS('animation-iteration-count', '2');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(drift).toHaveCSS('animation-name', 'none');
  });

  test('works from the keyboard, and focus stays on the toggle', async ({ page, ipPlace }) => {
    await keepToday(page, ipPlace.tz);
    await ready(page, '/');
    await page.locator('[data-units="f"]').focus();
    // Tab on from the header controls (past the location note) to the toggle.
    for (let i = 0; i < 4; i++) {
      if (await toggle(page, 'hot').evaluate((b) => b === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(toggle(page, 'hot')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(toggle(page, 'wet')).toBeFocused();
    await page.keyboard.press('Space');
    await expectTopic(page, 'wet');
    await expect(page.locator('#question')).toHaveText('Is it wet today?');
    await expect(toggle(page, 'wet')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(toggle(page, 'snow')).toBeFocused();
    await page.keyboard.press('Space');
    await expectTopic(page, 'snow');
    await expect(page.locator('#question')).toHaveText('Will it snow today?');
    await expect(toggle(page, 'snow')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(toggle(page, 'wet')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(toggle(page, 'hot')).toBeFocused();
    await page.keyboard.press('Enter');
    await expectTopic(page, 'hot');
    await expect(page.locator('#question')).toHaveText('Is it hot today?');
    await expect(toggle(page, 'hot')).toBeFocused();
  });

  test('a switch is announced once', async ({ page, ipPlace }) => {
    await keepToday(page, ipPlace.tz);
    await ready(page, '/');
    await page.waitForTimeout(600);
    // Record each change to text inside a live region that is speaking at the time.
    await page.evaluate(() => {
      const heard: string[] = [];
      (window as unknown as { __heard: string[] }).__heard = heard;
      new MutationObserver((records) => {
        const regions = new Set<string>();
        for (const r of records) {
          const node = r.target instanceof Element ? r.target : r.target.parentElement;
          const region = node?.closest('[aria-live]');
          if (region && region.getAttribute('aria-live') !== 'off') regions.add(region.id);
        }
        heard.push(...regions);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await toggle(page, 'wet').click();
    await expect(page.locator('#view-live')).toHaveText(
      /^Is it wet today\? (Yes|No|Maybe)\. \S.*\.$/,
    );
    await page.waitForTimeout(600);
    const answer = (await page.locator('#answer').textContent())!.trim();
    const verdict = (await page.locator('#verdict').textContent())!.trim();
    await expect(page.locator('#view-live')).toHaveText(`Is it wet today? ${answer} ${verdict}`);
    expect(await page.evaluate(() => (window as unknown as { __heard: string[] }).__heard)).toEqual(
      ['view-live'],
    );
    // Today's own live region speaks again for the next answer.
    await expect(page.locator('#live')).toHaveAttribute('aria-live', 'polite');
  });

  test('a reload opens on the page’s own question', async ({ page, ipPlace }) => {
    await keepToday(page, ipPlace.tz);
    await ready(page, '/');
    await toggle(page, 'wet').click();
    await expectTopic(page, 'wet');
    await page.reload();
    await expect(page.locator('#answer')).toHaveText(HOT_ANSWERS);
    await expectTopic(page, 'hot');
    await expect(page.locator('#question')).toHaveText('Is it hot today?');

    await ready(page, '/wet');
    await toggle(page, 'hot').click();
    await expectTopic(page, 'hot');
    await page.reload();
    await expect(page.locator('#answer')).toHaveText(WET_ANSWERS);
    await expectTopic(page, 'wet');
    await expect(page.locator('#question')).toHaveText('Is it wet today?');

    await ready(page, '/snow');
    await toggle(page, 'wet').click();
    await expectTopic(page, 'wet');
    await page.reload();
    await expect(page.locator('#answer')).toHaveText(SNOW_ANSWERS);
    await expectTopic(page, 'snow');
    await expect(page.locator('#question')).toHaveText('Will it snow today?');
  });

  test('back after half an hour away: the page’s own question, on Today', async ({
    page,
    ipPlace,
  }) => {
    // Kept on Today across the half hour (the evening's return: tomorrow.spec.ts).
    await startClock(page, todayTime(ipPlace.tz));
    await ready(page, '/wet');
    await page.locator('#tab-week').click();
    await expect(page.locator('#tab-week')).toHaveAttribute('aria-selected', 'true');
    await toggle(page, 'hot').click();
    await expect(page.locator('#week-question')).toHaveText('Is it hot this week?');
    await expect(page.locator('#brand')).toHaveText('isithot.today');

    await setVisibility(page, 'hidden');
    await page.clock.fastForward('31:00');
    await setVisibility(page, 'visible');
    await expectTopic(page, 'wet');
    // The header goes back to the page's own site too.
    await expect(page.locator('#brand')).toHaveText('isitwet.today');
    await expect(page.locator('#tab-today')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#question')).toHaveText('Is it wet today?');
    await expect(page.locator('#answer')).toHaveText(WET_ANSWERS);
    await expect
      .poll(() => g1(page))
      .toBe(RAIN_PALETTES[(await band(page, 'today')) as RainBand].g1);
  });

  test('back after half an hour away on /snow: Snow again, on Today', async ({ page, ipPlace }) => {
    await startClock(page, todayTime(ipPlace.tz));
    await ready(page, '/snow');
    await page.locator('#tab-week').click();
    await expect(page.locator('#tab-week')).toHaveAttribute('aria-selected', 'true');
    await toggle(page, 'wet').click();
    await expect(page.locator('#week-question')).toHaveText('Is it wet this week?');
    await expect(page.locator('#brand')).toHaveText('isitwet.today');

    await setVisibility(page, 'hidden');
    await page.clock.fastForward('31:00');
    await setVisibility(page, 'visible');
    await expectTopic(page, 'snow');
    await expect(page.locator('#brand')).toHaveText('willitsnow.today');
    await expect(page.locator('#tab-today')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#question')).toHaveText('Will it snow today?');
    await expect(page.locator('#answer')).toHaveText(SNOW_ANSWERS);
    await expect
      .poll(() => g1(page))
      .toBe(SNOW_PALETTES[(await band(page, 'today')) as SnowBand].g1);
  });

  // Rain and snow are both judged hour by hour.
  for (const [block, path, answers] of [
    ['rain', '/wet', WET_ANSWERS],
    ['snow', '/snow', SNOW_ANSWERS],
  ] as const) {
    test(`${block} "now" keeps up with the clock without asking the server`, async ({ page }) => {
      await startClock(page);
      await ready(page, path);
      await page.locator('#tab-now').click();
      await expect(page.locator('#now-answer')).toHaveText(answers);
      await expect(page.locator('#now-hours li')).toHaveCount(6);
      await expect(page.locator('#now-hours .sr-only').first()).toHaveText(
        /^\d+% chance at \d+(am|pm)$/,
      );
      const first = () => page.locator('#now-hours li .n').first().textContent();
      const before = await first();
      // From here the server never answers: whatever changes is worked out in the page.
      await page.route('**/api/v1/today**', () => {});
      await page.clock.runFor(61 * 60 * 1000);
      await expect.poll(first).not.toBe(before);
      await expect(page.locator('#now-answer')).toHaveText(answers);
    });

    test(`asks again once today’s ${block} is an hour old`, async ({ page }) => {
      await startClock(page);
      const calls: string[] = [];
      page.on('request', (r) => {
        if (r.url().includes('/api/v1/today')) calls.push(r.url());
      });
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/v1/today')),
        ready(page, path),
      ]);
      const body = (await response.json()) as Record<
        typeof block,
        { days: Array<{ from: string }> }
      >;
      // Today's rain and snow are for the rest of the day from when they were worked out, so they
      // hold until the next hour.
      const until = Math.floor(Date.parse(body[block].days[0]!.from) / HOUR) * HOUR + HOUR;
      const now = await page.evaluate(() => Date.now());
      expect(calls).toHaveLength(1);
      if (until - now > 3 * 60 * 1000) {
        await page.clock.runFor(until - now - 2 * 60 * 1000);
        expect(calls).toHaveLength(1);
      }
      await page.clock.runFor(3 * 60 * 1000);
      await expect.poll(() => calls.length).toBe(2);
      // Past the browser and CDN caches, with an address that changes each hour.
      expect(calls[1]).toMatch(/[?&]t=\d+$/);
      await expect(page.locator('#answer')).toHaveText(answers);
      // At most one quiet refetch every few minutes.
      await page.clock.runFor(2 * 60 * 1000);
      expect(calls).toHaveLength(2);
    });
  }

  // In the daytime the clock is only ahead of the server's hour. At 11pm at the place it is past
  // midnight too, ahead of the server's day: the server's next hour is its midnight, and the
  // page must wait for it there as well.
  for (const [when, ipHour] of [
    ['in the daytime', DAYTIME],
    ['late in the evening', 23],
  ] as const) {
    test.describe(when, () => {
      test.use({ ipHour });

      test('a clock running fast waits for the server’s next hour to ask again', async ({
        page,
      }) => {
        // Routing turns off the browser's cache, whose entries would otherwise expire in real time.
        await page.route('**/api/v1/today**', (route) => route.continue());
        // Each request for a fresh answer: the minute on the page's clock it was made in, and how
        // long the server had left of its hour when it answered.
        const fresh: Array<{ minute: number; left: number }> = [];
        let minute = 0;
        let pending = 0;
        page.on('request', (r) => {
          if (!r.url().includes('/api/v1/today')) return;
          pending++;
          if (!r.url().includes('t=')) return;
          const entry = { minute, left: -1 };
          fresh.push(entry);
          // (A request still on its way when the test ends is not waited for.)
          r.response()
            .then(async (response) => {
              const body = (await response!.json()) as { rain: { days: Array<{ from: string }> } };
              const from = Date.parse(body.rain.days[0]!.from);
              entry.left = Math.ceil(from / HOUR) * HOUR - from;
            })
            .catch(() => {});
        });
        const done = (r: { url(): string }) => {
          if (r.url().includes('/api/v1/today')) pending--;
        };
        page.on('requestfinished', done);
        page.on('requestfailed', done);
        // A device clock 70 minutes fast: today's rain always looks an hour old to it (and late in
        // the evening, today's answer looks like yesterday's).
        await startClock(page, serverNow() + 70 * 60 * 1000);
        await ready(page, '/wet');
        // An hour on the page's clock, a minute at a time, each answer in before the next minute.
        // (The server's clock hardly moves meanwhile, so its hour is the same throughout.)
        for (minute = 1; minute <= 60; minute++) {
          await page.clock.runFor(60 * 1000);
          await expect.poll(() => pending).toBe(0);
        }
        // The page's clock runs on by itself from here: look at the hour just run.
        const asked = fresh.slice();
        await expect.poll(() => asked.every((f) => f.left >= 0)).toBe(true);
        // The out-of-date rain is asked for again, past the caches.
        expect(asked.length).toBeGreaterThanOrEqual(1);
        // But never sooner than the server could have a newer hour: once it was out of date when it
        // arrived, an answer is kept for as long as the server had left of its hour. (Asking every
        // few minutes would make a clock an hour fast ask forever.)
        for (let i = 1; i < asked.length; i++) {
          const gap = (asked[i]!.minute - asked[i - 1]!.minute + 1) * 60 * 1000;
          expect(gap, `request ${i + 1} of ${asked.length}`).toBeGreaterThanOrEqual(
            asked[i - 1]!.left,
          );
        }
      });
    });
  }

  test('place links go to the site of the question on screen', async ({ page }) => {
    // Locally every site shares one host, with the wet pages under /wet and the snow ones under
    // /snow.
    await ready(page, '/wet');
    const nearby = page.locator('#nearby-links a');
    await expect(nearby.first()).toHaveAttribute('href', /^\/wet\/in\/[a-z-]+$/);
    await page.locator('#place-btn').click();
    await page.locator('#search-input').fill('Bris');
    await page
      .locator('#search-results')
      .getByRole('button', { name: /Bristol/ })
      .click();
    await expect(page).toHaveURL(/\/wet\/in\/bristol-gb$/);

    await ready(page, '/');
    await expect(nearby.first()).toHaveAttribute('href', /^\/in\/[a-z-]+$/);
    await toggle(page, 'wet').click();
    await expect(nearby.first()).toHaveAttribute('href', /^\/wet\/in\/[a-z-]+$/);
    await page.locator('#place-btn').click();
    await page.locator('#search-input').fill('Bris');
    await page
      .locator('#search-results')
      .getByRole('button', { name: /Bristol/ })
      .click();
    await expect(page).toHaveURL(/\/wet\/in\/bristol-gb$/);

    await ready(page, '/snow');
    await expect(nearby.first()).toHaveAttribute('href', /^\/snow\/in\/[a-z-]+$/);
    await toggle(page, 'hot').click();
    await expect(nearby.first()).toHaveAttribute('href', /^\/in\/[a-z-]+$/);
    await toggle(page, 'snow').click();
    await expect(nearby.first()).toHaveAttribute('href', /^\/snow\/in\/[a-z-]+$/);
    await page.locator('#place-btn').click();
    await page.locator('#search-input').fill('Bris');
    await page
      .locator('#search-results')
      .getByRole('button', { name: /Bristol/ })
      .click();
    await expect(page).toHaveURL(/\/snow\/in\/bristol-gb$/);
  });

  test('a search from a city page keeps the question on screen', async ({ page }) => {
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
    // Bristol's page opens on Today until 6pm there.
    await keepToday(page);
    await page.goto('/in/bristol-gb');
    await expect(page.locator('#answer')).toHaveText(/^\s*(Yes|No|Almost)\.\s*$/);
    await toggle(page, 'wet').click();
    await expect(page.locator('#question')).toHaveText('Is it wet in Bristol today?');
    await expect(page).toHaveTitle(/^Is it wet in Bristol today\? .+ \| isitwet\.today$/);
    await page.locator('#place-btn').click();
    await page.locator('#search-input').fill('Hex');
    await page.getByRole('button', { name: /Hexham/ }).click();
    await expect(page).toHaveURL(/\/wet\?lat=54\.95&lon=-2\.1&name=Hexham$/);
    await expect(page.locator('#place')).toHaveText('Hexham');
    await expectTopic(page, 'wet');
  });

  test('each site restores its own last answer', async ({ page, ipPlace }) => {
    await keepToday(page, ipPlace.tz);
    await ready(page, '/snow');
    const snow = (await page.locator('#answer').textContent())!.trim();
    const snowVerdict = (await page.locator('#verdict').textContent())!.trim();
    await page.waitForTimeout(300);
    await ready(page, '/wet');
    const wet = (await page.locator('#answer').textContent())!.trim();
    const wetVerdict = (await page.locator('#verdict').textContent())!.trim();
    await page.waitForTimeout(300);
    await ready(page, '/');
    const hot = (await page.locator('#answer').textContent())!.trim();
    const hotVerdict = (await page.locator('#verdict').textContent())!.trim();
    await page.waitForTimeout(300);
    // Showing another question never overwrites the page's own snapshot, or that site's.
    await toggle(page, 'wet').click();
    await page.locator('[data-units="f"]').click();
    await expect(page.locator('[data-units="f"]')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(500);
    await toggle(page, 'snow').click();
    await page.locator('[data-units="c"]').click();
    await toggle(page, 'hot').click();
    await page.waitForTimeout(300);

    await page.route('**/api/v1/today**', () => {
      // Never answer: the pages must not need the network to show something.
    });
    await page.goto('/wet');
    await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
    await expectTopic(page, 'wet');
    await expect(page.locator('#question')).toHaveText('Is it wet today?');
    await expect(page.locator('#answer')).toHaveText(wet);
    await expect(page.locator('#verdict')).toHaveText(wetVerdict);

    await page.goto('/');
    await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
    await expectTopic(page, 'hot');
    await expect(page.locator('#question')).toHaveText('Is it hot today?');
    await expect(page.locator('#answer')).toHaveText(hot);
    await expect(page.locator('#verdict')).toHaveText(hotVerdict);

    await page.goto('/snow');
    await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
    await expectTopic(page, 'snow');
    await expect(page.locator('#question')).toHaveText('Will it snow today?');
    await expect(page.locator('#answer')).toHaveText(snow);
    await expect(page.locator('#verdict')).toHaveText(snowVerdict);
  });

  for (const [topic, path, key, asked] of [
    ['wet', '/wet', 'isitwet:last', 'Is it wet today?'],
    ['snow', '/snow', 'willitsnow:last', 'Will it snow today?'],
  ] as const) {
    test(`a ${topic} snapshot is not shown past its hour`, async ({ page }) => {
      await ready(page, path);
      await page.waitForTimeout(300);
      const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
      // Saved until the next hour after today's answer was worked out (on the page's clock).
      const now = await page.evaluate(() => Date.now());
      expect(saved.until).toBeGreaterThan(now);
      expect(saved.until - now).toBeLessThanOrEqual(HOUR);
      // An hour on, the snapshot is out of date.
      await page.evaluate(
        ([k, s]) => localStorage.setItem(k, JSON.stringify({ ...s, until: Date.now() - 1 })),
        [key, saved] as const,
      );
      await page.route('**/api/v1/today**', () => {});
      await page.goto(path);
      await expect(page.locator('#app')).toHaveAttribute('data-state', 'loading');
      await expect(page.locator('#answer')).toHaveText('Checking…');
      await expect(page.locator('#question')).toHaveText(asked);
    });
  }

  test('a rain band preview opens on Wet, with chips for the question on screen', async ({
    page,
  }) => {
    await page.goto('/?preview=1&band=drenched');
    await expectTopic(page, 'wet');
    await expect(page.locator('#question')).toHaveText('Is it wet today?');
    await expect(page.locator('#answer')).toHaveText('Yes.');
    await expect.poll(() => g1(page)).toBe(RAIN_PALETTES.drenched.g1);
    const chips = page.getByRole('group', { name: 'Preview each kind of day' }).locator('button');
    await expect(chips).toHaveText([
      'Dry',
      'Mostly dry',
      'Showers',
      'Rain',
      'Heavy rain',
      'Washout',
    ]);
    await expect(chips.filter({ hasText: 'Washout' })).toHaveAttribute('aria-pressed', 'true');

    await chips.filter({ hasText: 'Showers' }).click();
    await expect(page.locator('#answer')).toHaveText('Maybe.');
    await expect.poll(() => g1(page)).toBe(RAIN_PALETTES.showers.g1);
    await expect(chips.filter({ hasText: 'Showers' })).toHaveAttribute('aria-pressed', 'true');

    await toggle(page, 'hot').click();
    await expect(chips).toHaveText(['Freezing', 'Cold', 'Mild', 'Warm', 'Hot', 'Scorching']);
    // A showery sample day is a mild one.
    await expect(chips.filter({ hasText: 'Mild' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#question')).toHaveText('Is it hot today?');
  });

  test('a snow band preview opens on Snow, with chips for the question on screen', async ({
    page,
  }) => {
    await page.goto('/?preview=1&band=deepsnow');
    await expectTopic(page, 'snow');
    await expect(page.locator('#question')).toHaveText('Will it snow today?');
    await expect(page.locator('#answer')).toHaveText('Yes.');
    await expect.poll(() => g1(page)).toBe(SNOW_PALETTES.deepsnow.g1);
    const chips = page.getByRole('group', { name: 'Preview each kind of day' }).locator('button');
    await expect(chips).toHaveText([
      'No snow',
      'A few flakes',
      'Snow possible',
      'Snow',
      'Heavy snow',
      'Deep snow',
    ]);
    await expect(chips.filter({ hasText: 'Deep snow' })).toHaveAttribute('aria-pressed', 'true');
    // Each sample shows its band in every view.
    for (const view of ['now', 'week'] as const) {
      expect(await band(page, view)).toBe('deepsnow');
    }

    await chips.filter({ hasText: 'Snow possible' }).click();
    await expect(page.locator('#answer')).toHaveText('Maybe.');
    await expect.poll(() => g1(page)).toBe(SNOW_PALETTES.maybesnow.g1);
    await expect(chips.filter({ hasText: 'Snow possible' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await toggle(page, 'hot').click();
    await expect(chips).toHaveText(['Freezing', 'Cold', 'Mild', 'Warm', 'Hot', 'Scorching']);
    // A sample day where snow is possible is a freezing one.
    await expect(chips.filter({ hasText: 'Freezing' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#question')).toHaveText('Is it hot today?');
    await toggle(page, 'wet').click();
    await expect(chips).toHaveCount(6);
    await expect(chips.filter({ hasText: 'Showers' })).toHaveAttribute('aria-pressed', 'true');
  });
});
