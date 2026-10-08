/**
 * From 6pm at the place the middle view answers for tomorrow and the page opens on Now; at
 * midnight it is Today again (core `showsTomorrow`, `defaultView`). Each test picks a city in the
 * part of its day it needs (helpers.ts `cityAt`), so the server renders the page for that time;
 * tests that cross 6pm or midnight start the browser's clock just before it.
 */
import type { Page } from '@playwright/test';
import { PALETTES, RAIN_PALETTES, type Band, type RainBand } from '../packages/core/src/config';
import {
  atLocal,
  cityAt,
  expect,
  localTime,
  pinLocalTime,
  setVisibility,
  startClock,
  test,
  toggle,
} from './helpers';

const HOUR = 60 * 60 * 1000;
const EVENING = ['18:15', '22:15'] as const;
const DAYTIME = ['10:00', '15:30'] as const;
const QUESTION = { hot: 'hot', wet: 'wet' } as const;

/**
 * The page shows `view`, with its tab selected: alone as the page arrives, or (once the views
 * have been brought in, as when the app moves to a view) scrolled to it with the others inert.
 */
async function expectOpenOn(page: Page, view: 'now' | 'today'): Promise<void> {
  const others = (['now', 'today', 'week'] as const).filter((v) => v !== view);
  await expect(page.locator(`#tab-${view}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(`#view-${view}`)).toBeVisible();
  await expect(page.locator(`#view-${view}`)).not.toHaveAttribute('inert', '');
  for (const other of others) {
    await expect(page.locator(`#tab-${other}`)).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator(`#view-${other}`)).toHaveAttribute('inert', '');
  }
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.getElementById('views')!;
        const open = [...el.querySelectorAll<HTMLElement>('.view')].filter((p) => !p.hidden);
        if (open.length === 1) return open[0]!.id;
        return ['view-now', 'view-today', 'view-week'][Math.round(el.scrollLeft / el.clientWidth)];
      }),
    )
    .toBe(`view-${view}`);
}

for (const topic of ['hot', 'wet'] as const) {
  const site = topic === 'wet' ? '/wet' : '';

  test(`${topic}: in the evening a city page opens on Now, with tomorrow in the middle`, async ({
    page,
    request,
  }) => {
    const city = await cityAt(request, ...EVENING);
    await page.goto(`${site}/in/${city.slug}`);
    await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByRole('tab')).toHaveText(['Now', 'Tomorrow', 'This week']);
    await expectOpenOn(page, 'now');
    // Now's answer is the page's main heading while it is the one on screen.
    await expect(page.locator('#now-answer')).toHaveAttribute('aria-level', '1');
    await expect(page.locator('#now-question')).toHaveText(
      `Is it ${QUESTION[topic]} in ${city.name} right now?`,
    );
    // The title is about today, whichever view is showing.
    await expect(page).toHaveTitle(new RegExp(`^Is it ${topic} in ${city.name} today\\? `));

    await page.locator('#tab-today').click();
    await expect(page.locator('#tab-today')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#question')).toHaveText(
      `Will it be ${QUESTION[topic]} in ${city.name} tomorrow?`,
    );
    const day = topic === 'wet' ? city.data.rain!.days[1]! : city.data.days[1]!;
    await expect(page.locator('#answer')).toHaveText(day.answer);
    await expect(page.locator('#verdict')).toHaveText(day.verdict);
    // Tomorrow's answer is about all of tomorrow, in the future tense.
    if (topic === 'hot') await expect(page.locator('#verdict')).toHaveText(/^\s*It'll /);
    await expect(page.locator('#detail')).not.toContainText(/still to come|rest of the day|today/i);
    await expect(page.locator('#view-live')).toHaveText(new RegExp(`^Tomorrow: ${day.answer} `));
    // The page wears tomorrow's colours.
    const palette =
      topic === 'wet' ? RAIN_PALETTES[day.band as RainBand] : PALETTES[day.band as Band];
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--g1')))
      .toBe(palette.g1);
  });
}

test('in the daytime a city page opens on Today', async ({ page, request }) => {
  const city = await cityAt(request, ...DAYTIME);
  await page.goto(`/in/${city.slug}`);
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByRole('tab')).toHaveText(['Now', 'Today', 'This week']);
  await expectOpenOn(page, 'today');
  await expect(page.locator('#question')).toHaveText(`Is it hot in ${city.name} today?`);
  await expect(page.locator('#answer')).toHaveText(city.data.days[0]!.answer);
  await expect(page.locator('#verdict')).toHaveText(/^\s*It's /);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('an evening page shows Now, with Tomorrow in the middle', async ({ page, request }) => {
    const city = await cityAt(request, ...EVENING);
    await page.goto(`/wet/in/${city.slug}`);
    await expect(page.getByRole('tab')).toHaveText(['Now', 'Tomorrow', 'This week']);
    await expectOpenOn(page, 'now');
    await expect(page.locator('#now-answer')).toHaveText(/^\s*(Yes|No|Maybe)\.\s*$/);
    await expect(page.locator('#now-answer')).toHaveAttribute('aria-level', '1');
    // Today's answer stays the h1 in the markup, answering for tomorrow behind its tab.
    await expect(page.locator('h1#answer')).toHaveText(city.data.rain!.days[1]!.answer);
    await expect(page.locator('#question')).toHaveText(`Will it be wet in ${city.name} tomorrow?`);
    // The page wears Now's colours.
    const band = (await page.locator('#view-now').getAttribute('data-band')) as RainBand;
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      'content',
      RAIN_PALETTES[band].g1,
    );
  });
});

test('at 6pm an open Today turns into Tomorrow where it is', async ({ page, request }) => {
  const city = await cityAt(request, ...DAYTIME);
  await pinLocalTime(page, city.tz, '17:58');
  await page.goto(`/in/${city.slug}`);
  await expect(page.locator('#answer')).toHaveText(city.data.days[0]!.answer);
  await expect(page.locator('#tab-today')).toHaveText('Today');
  await expectOpenOn(page, 'today');

  await page.clock.runFor('03:00');
  await expect(page.locator('#tab-today')).toHaveText('Tomorrow');
  await expect(page.locator('#question')).toHaveText(`Will it be hot in ${city.name} tomorrow?`);
  await expect(page.locator('#answer')).toHaveText(city.data.days[1]!.answer);
  await expect(page.locator('#verdict')).toHaveText(city.data.days[1]!.verdict);
  // Nobody is moved: the visitor is still on the middle view, alone.
  await expectOpenOn(page, 'today');
});

test('at midnight Tomorrow turns back into Today, with a fresh answer', async ({
  page,
  request,
}) => {
  const city = await cityAt(request, ...EVENING);
  const fresh: number[] = [];
  page.on('request', (r) => {
    const t = new URL(r.url()).searchParams.get('t');
    if (r.url().includes('/api/v1/today') && t) fresh.push(Number(t));
  });
  const { date } = localTime(city.tz);
  await pinLocalTime(page, city.tz, '23:56', date);
  await page.goto(`/in/${city.slug}`);
  await expect(page.locator('#tab-today')).toHaveText('Tomorrow');
  await expectOpenOn(page, 'now');

  await page.clock.runFor('10:00');
  await expect(page.locator('#tab-today')).toHaveText('Today');
  await expect(page.locator('#question')).toHaveText(`Is it hot in ${city.name} today?`);
  // Past midnight the page asks again for the new day, past the caches.
  const midnight = atLocal(city.tz, '23:56', date) + 4 * 60 * 1000;
  await expect.poll(() => fresh.some((t) => t >= Math.floor(midnight / HOUR))).toBe(true);
  // Still on Now: the change happens where the visitor is.
  await expectOpenOn(page, 'now');
});

test('back after half an hour away in the evening: the page’s own question, on Now', async ({
  page,
  request,
}) => {
  const city = await cityAt(request, ...EVENING);
  await startClock(page);
  await page.goto(`/wet/in/${city.slug}`);
  await expectOpenOn(page, 'now');
  await page.locator('#tab-week').click();
  await expect(page.locator('#tab-week')).toHaveAttribute('aria-selected', 'true');
  await toggle(page, 'hot').click();
  await expect(page.locator('#week-question')).toHaveText(`Is it hot in ${city.name} this week?`);

  await setVisibility(page, 'hidden');
  await page.clock.fastForward('31:00');
  await setVisibility(page, 'visible');
  await expect(page.locator('#tab-now')).toHaveAttribute('aria-selected', 'true');
  await expect(toggle(page, 'wet')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#brand')).toHaveText('isitwet.today');
  await expect(page.locator('#now-question')).toHaveText(`Is it wet in ${city.name} right now?`);
  await expect(page.locator('#tab-today')).toHaveText('Tomorrow');
});

test.describe('the home page in the evening', () => {
  // The approximate place, where it is 8pm.
  test.use({ ipHour: 20 });

  test('opens on Now, and its snapshot reopens there', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByRole('tab')).toHaveText(['Now', 'Tomorrow', 'This week']);
    await expectOpenOn(page, 'now');
    await expect(page.locator('#now-answer')).toHaveText(/^\s*(Yes|No|Almost)\.\s*$/);
    await expect(page.locator('#question')).toHaveText('Will it be hot tomorrow?');
    // The title is about today.
    await expect(page).toHaveTitle(/^(Yes|No|Almost)\. It's .+ \| isithot\.today$/);

    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('isithot:last') ?? '{}')))
      .toMatchObject({ slot: 'tomorrow', tz: expect.stringMatching(/^(UTC|Etc\/GMT[+-]\d+)$/) });
    await page.route('**/api/v1/today**', () => {
      // Never answer: the snapshot alone must paint the page.
    });
    await page.reload();
    await expect(page.locator('#app')).toHaveAttribute('data-restored', '1');
    await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('#tab-today')).toHaveText('Tomorrow');
    await expectOpenOn(page, 'now');
  });

  test('without a forecast for tomorrow the middle stays Today', async ({ page }) => {
    let tz = '';
    await page.route('**/api/v1/today**', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      tz = body.location.timezone;
      body.days = body.days.slice(0, 1);
      body.rain.days = body.rain.days.slice(0, 1);
      await route.fulfill({ response, json: body });
    });
    await page.goto('/');
    await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
    // It is the evening there.
    expect(localTime(tz).hour).toBeGreaterThanOrEqual(18);
    await expect(page.getByRole('tab')).toHaveText(['Now', 'Today', 'This week']);
    await expectOpenOn(page, 'today');
    await expect(page.locator('#question')).toHaveText('Is it hot today?');
  });
});

test('a home page snapshot from before 6pm is not painted after it', async ({ page, ipPlace }) => {
  // A visit at 5:58pm at the approximate place, which saves the page as it opens before 6pm.
  const at = await pinLocalTime(page, ipPlace.tz, '17:58');
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  await expectOpenOn(page, 'today');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('isithot:last') ?? '{}')))
    .toMatchObject({ slot: 'today', tz: ipPlace.tz, savedAt: expect.any(Number) });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('isithot:last')!));
  expect(saved.savedAt).toBeGreaterThanOrEqual(at);

  // From here the server never answers, so nothing is saved after 6pm.
  await page.route('**/api/v1/today**', () => {});
  await page.clock.runFor('03:00');
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'loading');
  await expect(page.locator('#app')).not.toHaveAttribute('data-restored', '1');
  await expect(page.locator('#answer')).toHaveText('Checking…');
});
