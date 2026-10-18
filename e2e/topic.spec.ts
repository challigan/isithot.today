/**
 * Hot | Wet | Snow | Wind: each site opens on its own question, and the toggle answers the others
 * in place from the same response.
 */
import type { Page } from '@playwright/test';
import {
  PALETTES,
  RAIN_PALETTES,
  SNOW_PALETTES,
  TOPICS,
  WIND_PALETTES,
  type Band,
  type RainBand,
  type SnowBand,
  type Topic,
  type WindBand,
} from '../packages/core/src/config';
import { RAIN_GLYPHS } from '../apps/web/src/lib/wetGlyphs';
import { SNOW_GLYPHS } from '../apps/web/src/lib/snowGlyphs';
import { WIND_GLYPHS } from '../apps/web/src/lib/windGlyphs';
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
const WIND_ANSWERS = /^(Yes\.|No\.|A bit\.)$/;
const WIND_WEEK_ANSWERS = /^(Yes\.|No\.|A bit\.|Partly\.)$/;
const HOUR = 60 * 60 * 1000;

/** Each site's answers to Today's question, by the path's prefix. */
const ANSWERS: Array<[string, RegExp]> = [
  ['/wet', WET_ANSWERS],
  ['/snow', SNOW_ANSWERS],
  ['/wind', WIND_ANSWERS],
];

async function ready(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(page.locator('#answer')).toHaveText(
    ANSWERS.find(([prefix]) => path.startsWith(prefix))?.[1] ?? HOT_ANSWERS,
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

test.describe('Hot | Wet | Snow | Wind', () => {
  test('each site opens on its own question', async ({ page, request, ipPlace }) => {
    // The wet home page asks its question before any script runs.
    const html = await (await request.get('/wet')).text();
    expect(html).toMatch(/<span class="question" id="question">\s*Is it wet today\?\s*</);
    expect(html).toContain('<link rel="canonical" href="https://isitwet.today/"');

    await keepToday(page, ipPlace.tz);
    await ready(page, '/');
    await expectTopic(page, 'hot');
    await expect(page.getByRole('group', { name: 'Forecast type' })).toBeVisible();
    await expect(page.locator('#question')).toHaveText('Is it hot today?');
    await expect(page.locator('[data-units]')).toHaveText(['°C', '°F']);
    await expect(page.getByRole('group', { name: 'Temperature units' })).toBeVisible();
    // The title asks the question and never gives the answer.
    await expect(page).toHaveTitle('Is it hot today? | isithot.today');

    await ready(page, '/wet');
    await expectTopic(page, 'wet');
    await expect(page.locator('#question')).toHaveText('Is it wet today?');
    await expect(page.locator('#verdict')).not.toBeEmpty();
    await expect(page.locator('#agree')).toHaveText(/^\d of \d forecasts expects? rain$/);
    await expect(page.locator('[data-units]')).toHaveText(['mm', 'in']);
    await expect(page.getByRole('group', { name: 'Rain units' })).toBeVisible();
    await expect(page).toHaveTitle('Is it wet today? | isitwet.today');
    const today = (await band(page, 'today')) as RainBand;
    await expect.poll(() => g1(page)).toBe(RAIN_PALETTES[today].g1);

    const snow = await (await request.get('/snow')).text();
    expect(snow).toMatch(/<span class="question" id="question">\s*Will it snow today\?\s*</);
    expect(snow).toContain('<link rel="canonical" href="https://willitsnow.today/"');
    await ready(page, '/snow');
    await expectTopic(page, 'snow');
    await expect(page.locator('#question')).toHaveText('Will it snow today?');
    await expect(page.locator('#verdict')).not.toBeEmpty();
    await expect(page.locator('#agree')).toHaveText(/^\d of \d forecasts expects? snow$/);
    await expect(page.locator('[data-units]')).toHaveText(['cm', 'in']);
    await expect(page.getByRole('group', { name: 'Snow units' })).toBeVisible();
    await expect(page).toHaveTitle('Will it snow today? | willitsnow.today');
    const snowToday = (await band(page, 'today')) as SnowBand;
    await expect.poll(() => g1(page)).toBe(SNOW_PALETTES[snowToday].g1);

    const wind = await (await request.get('/wind')).text();
    expect(wind).toMatch(/<span class="question" id="question">\s*Is it windy today\?\s*</);
    expect(wind).toContain('<link rel="canonical" href="https://isitwindy.today/"');
    // Wind's own units, unchosen until the answer says which the place uses.
    expect(wind).toMatch(/<div class="pill units" role="group" aria-label="Wind units">/);
    await ready(page, '/wind');
    await expectTopic(page, 'wind');
    await expect(page.locator('#question')).toHaveText('Is it windy today?');
    await expect(page.locator('#verdict')).not.toBeEmpty();
    await expect(page.locator('#agree')).toHaveText(
      /^\d of \d forecasts says? (light winds|breezy|windy|very windy|gales|storm force)$/,
    );
    await expect(page.locator('[data-units]')).toHaveText(['mph', 'km/h']);
    await expect(page.getByRole('group', { name: 'Wind units' })).toBeVisible();
    await expect(page.locator('[data-units][aria-pressed=true]')).toHaveCount(1);
    await expect(page).toHaveTitle('Is it windy today? | isitwindy.today');
    const windToday = (await band(page, 'today')) as WindBand;
    await expect.poll(() => g1(page)).toBe(WIND_PALETTES[windToday].g1);
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
    // The home page's title asks the question on screen and names its site, as the header does.
    await expect(page).toHaveTitle('Is it wet today? | isitwet.today');

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
    await expect(page).toHaveTitle('Will it snow today? | willitsnow.today');

    await toggle(page, 'wind').click();
    await expectTopic(page, 'wind');
    // Still on This week, now answering "Will it be windy?" in every view.
    await expect(page.locator('#tab-week')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#view-week')).not.toHaveAttribute('inert', '');
    await expect(page.locator('#week-question')).toHaveText('Will it be windy this week?');
    await expect(page.locator('#week-answer')).toHaveText(WIND_WEEK_ANSWERS);
    await expect(page.locator('#week-days li')).toHaveCount(7);
    await expect(page.locator('#week-days li .t').first()).toHaveText(/^\d+(mph|km\/h)$/);
    await expect(page.locator('#question')).toHaveText('Is it windy today?');
    await expect(page.locator('#now-question')).toHaveText('Is it windy right now?');
    await expect(page.locator('#now-h')).toHaveText('Gusts, next 12 hours');
    const windWeek = (await band(page, 'week')) as WindBand;
    expect(Object.keys(WIND_PALETTES)).toContain(windWeek);
    await expect.poll(() => g1(page)).toBe(WIND_PALETTES[windWeek].g1);
    await expectGlyph(page, 'week-glyph', WIND_GLYPHS[windWeek]);
    await expect(page.locator('[data-units]')).toHaveText(['mph', 'km/h']);
    await expect(page.getByRole('group', { name: 'Wind units' })).toBeVisible();
    await expect(page).toHaveTitle('Is it windy today? | isitwindy.today');
    // The UV line is Hot's alone.
    await expect(page.locator('#uv')).toHaveAttribute('hidden', '');

    await toggle(page, 'hot').click();
    await expectTopic(page, 'hot');
    await expect(page.locator('#tab-week')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#week-question')).toHaveText('Is it hot this week?');
    await expect(page.locator('#week-answer')).toHaveText(HOT_ANSWERS);
    await expect.poll(() => g1(page)).toBe(PALETTES[(await band(page, 'week')) as Band].g1);
    await expect(page.locator('[data-units]')).toHaveText(['°C', '°F']);
    await expect(page).toHaveTitle('Is it hot today? | isithot.today');
    // Every answer comes in the one response.
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

  test('the wind blows a few times, then rests', async ({ page }) => {
    // Wind lines (every band from breezy), the flag, the trees and the torn leaves.
    for (const [band, part, rounds] of [
      ['windy', 'gust', '3'],
      ['breezy', 'flap', '4'],
      ['verywindy', 'sway', '3'],
      ['gale', 'blow', '3'],
    ] as const) {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto(`/?preview=1&band=${band}`);
      const moving = page.locator(`#glyph .${part}`).first();
      await expect(moving).toHaveCSS('animation-name', part);
      await expect(moving).toHaveCSS('animation-iteration-count', rounds);
      // All done within 4.2 seconds, delays included.
      const ends = await page.locator('#glyph [class]').evaluateAll((els) =>
        els.map((el) => {
          const style = getComputedStyle(el);
          const s = (v: string) => parseFloat(v) * (v.endsWith('ms') ? 0.001 : 1);
          return (
            s(style.animationDelay) + s(style.animationDuration) * +style.animationIterationCount
          );
        }),
      );
      expect(Math.max(...ends), band).toBeLessThanOrEqual(4.2);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(moving).toHaveCSS('animation-name', 'none');
    }
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
    await page.keyboard.press('Tab');
    await expect(toggle(page, 'wind')).toBeFocused();
    await page.keyboard.press('Enter');
    await expectTopic(page, 'wind');
    await expect(page.locator('#question')).toHaveText('Is it windy today?');
    await expect(toggle(page, 'wind')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
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

    await ready(page, '/wind');
    await toggle(page, 'snow').click();
    await expectTopic(page, 'snow');
    await page.reload();
    await expect(page.locator('#answer')).toHaveText(WIND_ANSWERS);
    await expectTopic(page, 'wind');
    await expect(page.locator('#question')).toHaveText('Is it windy today?');
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

  test('back after half an hour away on /wind: Wind again, on Today', async ({ page, ipPlace }) => {
    await startClock(page, todayTime(ipPlace.tz));
    await ready(page, '/wind');
    await page.locator('#tab-week').click();
    await expect(page.locator('#tab-week')).toHaveAttribute('aria-selected', 'true');
    await toggle(page, 'hot').click();
    await expect(page.locator('#week-question')).toHaveText('Is it hot this week?');
    await expect(page.locator('#brand')).toHaveText('isithot.today');

    await setVisibility(page, 'hidden');
    await page.clock.fastForward('31:00');
    await setVisibility(page, 'visible');
    await expectTopic(page, 'wind');
    await expect(page.locator('#brand')).toHaveText('isitwindy.today');
    await expect(page.locator('#tab-today')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#question')).toHaveText('Is it windy today?');
    await expect(page.locator('#answer')).toHaveText(WIND_ANSWERS);
    await expect
      .poll(() => g1(page))
      .toBe(WIND_PALETTES[(await band(page, 'today')) as WindBand].g1);
  });

  // Rain, snow and wind are all judged hour by hour.
  for (const [block, path, answers, spoken] of [
    ['rain', '/wet', WET_ANSWERS, /^\d+% chance at \d+(am|pm)$/],
    ['snow', '/snow', SNOW_ANSWERS, /^\d+% chance at \d+(am|pm)$/],
    ['wind', '/wind', WIND_ANSWERS, /^Gusts up to \d+(mph|km\/h) from \d+(am|pm)$/],
  ] as const) {
    test(`${block} "now" keeps up with the clock without asking the server`, async ({ page }) => {
      await startClock(page);
      await ready(page, path);
      await page.locator('#tab-now').click();
      await expect(page.locator('#now-answer')).toHaveText(answers);
      await expect(page.locator('#now-hours li')).toHaveCount(6);
      await expect(page.locator('#now-hours .sr-only').first()).toHaveText(spoken);
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
      // Today's rain, snow and wind are for the rest of the day from when they were worked out,
      // so they hold until the next hour.
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
        // The page counts the app's requests for today's answer itself, from when the app asks
        // until it has read the answer. (Playwright hears of a request only once the browser has it
        // on its way, by when the page's clock may have run on minutes, past the app's quiet
        // refetch of an answer still to come.) Of each request for a fresh answer the page keeps
        // the time on its clock it was made at, and when the server worked the answer out.
        type Requests = { pending: number; fresh: Array<{ at: number; from: string }> };
        await page.addInitScript(() => {
          const requests: Requests = { pending: 0, fresh: [] };
          (window as unknown as { __requests: Requests }).__requests = requests;
          const get = window.fetch.bind(window);
          window.fetch = async (input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            if (!url.includes('/api/v1/today')) return get(input, init);
            requests.pending++;
            const entry = url.includes('t=') ? { at: Date.now(), from: '' } : null;
            if (entry) requests.fresh.push(entry);
            let response: Response;
            try {
              response = await get(input, init);
            } catch (e) {
              requests.pending--;
              throw e;
            }
            // The answer is in once the app has read it: it reads every one, an error too (and the
            // page's own early request, as its first), and keeps it (`hold`) before the page does
            // anything else. One without today's rain leaves `from` empty.
            const json = response.json.bind(response);
            response.json = () =>
              json()
                .then((body: { rain?: { days: Array<{ from: string }> } | null }) => {
                  if (entry) entry.from = body.rain?.days[0]?.from ?? '';
                  return body;
                })
                .finally(() => requests.pending--);
            return response;
          };
        });
        const requests = () =>
          page.evaluate(() => (window as unknown as { __requests: Requests }).__requests);
        // The page's count starts again with each document, so the browser's own count of
        // requests for a fresh answer, from any document, checks that it saw them all.
        let browserFresh = 0;
        page.on('request', (r) => {
          if (r.url().includes('/api/v1/today') && r.url().includes('t=')) browserFresh++;
        });
        // A device clock 70 minutes fast: today's rain always looks an hour old to it (and late in
        // the evening, today's answer looks like yesterday's).
        await startClock(page, serverNow() + 70 * 60 * 1000);
        await ready(page, '/wet');
        // An hour on the page's clock, a minute at a time, each answer in before the next minute.
        // (The server's clock hardly moves meanwhile, so its hour is the same throughout.)
        for (let minute = 1; minute <= 60; minute++) {
          await page.clock.runFor(60 * 1000);
          await expect.poll(async () => (await requests()).pending).toBe(0);
        }
        // The page's clock runs on by itself from here: look at the hour just run, with how long
        // the server had left of its hour when it answered each.
        const asked = (await requests()).fresh.map(({ at, from }) => {
          const made = Date.parse(from);
          return { at, left: Math.ceil(made / HOUR) * HOUR - made };
        });
        // The out-of-date rain is asked for again, past the caches, and each time answered, all
        // from the one page. (Every answer is in, so the browser has reported every request.)
        expect(asked.length).toBeGreaterThanOrEqual(1);
        await expect.poll(() => browserFresh, 'requests the browser made').toBe(asked.length);
        for (const [i, { left }] of asked.entries()) {
          expect(left, `answer ${i + 1} of ${asked.length}`).toBeGreaterThanOrEqual(0);
        }
        // But never sooner than the server could have a newer hour: once it was out of date when it
        // arrived, an answer is kept for as long as the server had left of its hour. (Asking every
        // few minutes would make a clock an hour fast ask forever.) Measured on the page's clock,
        // from asking to asking again.
        for (let i = 1; i < asked.length; i++) {
          const gap = asked[i]!.at - asked[i - 1]!.at;
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
    await expect(page).toHaveTitle(
      'Is it wet in Bristol today? Rain hour by hour from 6 forecasts | isitwet.today',
    );
    await page.locator('#place-btn').click();
    await page.locator('#search-input').fill('Hex');
    await page.getByRole('button', { name: /Hexham/ }).click();
    await expect(page).toHaveURL(/\/wet\?lat=54\.95&lon=-2\.1&name=Hexham&country=GB$/);
    await expect(page.locator('#place')).toHaveText('Hexham');
    await expectTopic(page, 'wet');
  });

  test('each site restores its own last answer', async ({ page, ipPlace }) => {
    await keepToday(page, ipPlace.tz);
    await ready(page, '/wind');
    const wind = (await page.locator('#answer').textContent())!.trim();
    const windVerdict = (await page.locator('#verdict').textContent())!.trim();
    await page.waitForTimeout(300);
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
    await toggle(page, 'wind').click();
    await page.locator('[data-units="kmh"]').click();
    await expect(page.locator('[data-units="kmh"]')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(500);
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

    await page.goto('/wind');
    await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
    await expectTopic(page, 'wind');
    await expect(page.locator('#question')).toHaveText('Is it windy today?');
    await expect(page.locator('#answer')).toHaveText(wind);
    await expect(page.locator('#verdict')).toHaveText(windVerdict);
  });

  for (const [topic, path, key, asked] of [
    ['wet', '/wet', 'isitwet:last', 'Is it wet today?'],
    ['snow', '/snow', 'willitsnow:last', 'Will it snow today?'],
    ['wind', '/wind', 'isitwindy:last', 'Is it windy today?'],
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

test.describe('Wind', () => {
  test('a wind band preview opens on Wind, with chips for the question on screen', async ({
    page,
  }) => {
    await page.goto('/?preview=1&band=storm');
    await expectTopic(page, 'wind');
    await expect(page.locator('#question')).toHaveText('Is it windy today?');
    await expect(page.locator('#answer')).toHaveText('Yes.');
    await expect.poll(() => g1(page)).toBe(WIND_PALETTES.storm.g1);
    const chips = page.getByRole('group', { name: 'Preview each kind of day' }).locator('button');
    await expect(chips).toHaveText([
      'Light winds',
      'Breezy',
      'Windy',
      'Very windy',
      'Gale',
      'Storm',
    ]);
    await expect(chips.filter({ hasText: 'Storm' })).toHaveAttribute('aria-pressed', 'true');
    // Each sample shows its band in every view.
    for (const view of ['now', 'week'] as const) {
      expect(await band(page, view)).toBe('storm');
    }
    // A UK sample's storm links to the Met Office's warnings, never words one of its own.
    const link = page.locator('#warnings a');
    await expect(link).toBeVisible();
    await expect(link).toHaveText('Met Office warnings');
    await expect(link).toHaveAttribute(
      'href',
      'https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings',
    );
    await expect(page.locator('main')).not.toContainText(/warning(?! *s\b)|alert|danger/i);

    await chips.filter({ hasText: 'Breezy' }).click();
    await expect(page.locator('#answer')).toHaveText('A bit.');
    await expect(page.locator('#answer')).toHaveAttribute('data-long', '');
    await expect.poll(() => g1(page)).toBe(WIND_PALETTES.breezy.g1);
    await expect(page.locator('#warnings')).toBeHidden();
    for (const view of ['now', 'week'] as const) {
      expect(await band(page, view)).toBe('breezy');
    }

    // Every band, in every view, with its own icon and colours.
    for (const [i, windBand] of (
      ['calm', 'breezy', 'windy', 'verywindy', 'gale', 'storm'] as const
    ).entries()) {
      await chips.nth(i).click();
      await expect(chips.nth(i)).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => band(page, 'today')).toBe(windBand);
      await expectGlyph(page, 'glyph', WIND_GLYPHS[windBand]);
      await expect.poll(() => g1(page)).toBe(WIND_PALETTES[windBand].g1);
    }

    await toggle(page, 'hot').click();
    await expect(chips).toHaveText(['Freezing', 'Cold', 'Mild', 'Warm', 'Hot', 'Scorching']);
    await expect(page.locator('#question')).toHaveText('Is it hot today?');
    await expect(page.locator('#warnings')).toBeHidden();
  });

  test('the wind units switch between mph and km/h, apart from °C and °F', async ({ page }) => {
    // London's and Leeds's pages open on Today until 6pm there.
    await keepToday(page);
    const calls: URL[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/today')) calls.push(new URL(r.url()));
    });
    const city = async (path: string) => {
      await page.goto(path);
      await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
    };
    await city('/wind/in/london-gb');
    // A UK city in mph, its own unit; °C stays the temperature setting.
    await expect(page.locator('[data-units="mph"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#detail')).toContainText(/\d+mph/);
    await expect(page.locator('#list li .t').first()).toHaveText(/^\d+mph$/);
    await expect(page.locator('#smax')).toHaveText(/^\s*\d+mph\s*$/);

    await page.locator('[data-units="kmh"]').click();
    await expect(page.locator('[data-units="kmh"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-units="mph"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#detail')).toContainText(/\d+km\/h/);
    await expect(page.locator('#list li .t').first()).toHaveText(/^\d+km\/h$/);
    await expect(page.locator('#week-days li .t').first()).toHaveText(/^\d+km\/h$/);
    expect(calls.at(-1)!.searchParams.get('windUnits')).toBe('kmh');
    expect(calls.at(-1)!.searchParams.get('units')).toBe('c');

    // Hot keeps °C, unchanged by the wind setting.
    await toggle(page, 'hot').click();
    await expect(page.locator('[data-units]')).toHaveText(['°C', '°F']);
    await expect(page.locator('[data-units="c"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#detail')).toContainText('°');

    // Remembered: the next page asks in km/h from the start, and a city page made in mph asks
    // again quietly.
    calls.length = 0;
    await city('/wind/in/leeds-gb');
    await expect(page.locator('[data-units="kmh"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#list li .t').first()).toHaveText(/^\d+km\/h$/);
    expect(calls.map((u) => u.searchParams.get('windUnits'))).toEqual(['kmh']);
    calls.length = 0;
    await ready(page, '/wind');
    await expect(page.locator('[data-units="kmh"]')).toHaveAttribute('aria-pressed', 'true');
    // The early request in the page's head asked in km/h too, and the app used it.
    expect(calls.map((u) => u.searchParams.get('windUnits'))).toEqual(['kmh']);
  });

  test('a place where it storms all year answers Yes in every view', async ({ page, request }) => {
    // Reykjavík's synthetic forecasts have a storm every hour (e2e runs at any time of year).
    const data = (await (await request.get('/api/v1/today?place=reykjavik-is&units=c')).json()) as {
      wind: { unit: string; days: Array<{ band: string }>; week: { answer: string } };
    };
    expect(data.wind.unit).toBe('kmh');
    expect(data.wind.days[0]!.band).toBe('storm');
    expect(data.wind.week.answer).toBe('Yes.');
    // Today's and tomorrow's answers alike, whichever the middle view shows.
    await page.goto('/wind/in/reykjavik-is');
    await expect(page.locator('#answer')).toHaveText('Yes.');
    await expect(page.locator('#verdict')).toHaveText('Storm-force winds.');
    await expect(page.locator('#list li .t').first()).toHaveText(/^\d+km\/h$/);
    // Not a UK place: no link to the Met Office's warnings.
    await expect(page.locator('#warnings')).toBeHidden();
    await page.locator('#tab-week').click();
    await expect(page.locator('#week-answer')).toHaveText('Yes.');
    expect(await band(page, 'week')).toBe('storm');
  });
});
