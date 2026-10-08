import type { Page } from '@playwright/test';
import { PALETTES, type Band } from '../packages/core/src/config';
import { DAYTIME, expect, keepToday, startClock, test } from './helpers';

const ANSWERS = /^(Yes\.|No\.|Almost\.)$/;
const VIEWS = ['now', 'today', 'week'] as const;
type View = (typeof VIEWS)[number];

async function ready(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(page.locator('#answer')).toHaveText(ANSWERS);
}

/** The view the scroller rests on, from its scroll position. */
const restingView = (page: Page) =>
  page.evaluate(() => {
    const el = document.getElementById('views')!;
    if (document.getElementById('view-now')!.hidden) return 'today';
    const index = Math.round(el.scrollLeft / el.clientWidth);
    return ['now', 'today', 'week'][index];
  });

async function expectView(page: Page, view: View): Promise<void> {
  await expect.poll(() => restingView(page)).toBe(view);
  await expect(page.locator(`#tab-${view}`)).toHaveAttribute('aria-selected', 'true');
  for (const other of VIEWS.filter((v) => v !== view)) {
    await expect(page.locator(`#tab-${other}`)).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator(`#view-${other}`)).toHaveAttribute('inert', '');
  }
  await expect(page.locator(`#view-${view}`)).not.toHaveAttribute('inert', '');
  // The page wears the colours of the view on screen.
  const band = (await page.locator(`#view-${view}`).getAttribute('data-band')) as Band;
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--g1')))
    .toBe(PALETTES[band].g1);
}

/**
 * A real touch swipe (Chromium only), so scroll snapping and axis locking are exercised.
 * `hold` keeps the finger still before lifting it, so the swipe ends without a fling.
 */
async function swipe(page: Page, dx: number, dy = 0, hold = 0): Promise<void> {
  const box = (await page.locator('#views').boundingBox())!;
  // Start so the whole swipe stays on the screen.
  const x = box.x + box.width / 2 - dx / 2;
  const y = box.y + Math.min(box.height / 2, 300);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (dx * i) / 12, y: y + (dy * i) / 12 }],
    });
    await page.waitForTimeout(16);
  }
  if (hold) await page.waitForTimeout(hold);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test.describe('Now | Today | This week', () => {
  test.describe('on a home page in its daytime', () => {
    // These open on Today and then show Now's answer, so the browser keeps the server's clock
    // (no `keepToday`): the approximate place is where it is late morning.
    test.use({ ipHour: DAYTIME });

    test('opens on Today with the other views hidden, from one request', async ({ page }) => {
      const calls: string[] = [];
      page.on('request', (r) => {
        if (r.url().includes('/api/v1/today')) calls.push(r.url());
      });
      await ready(page);
      await expect(page.getByRole('tablist', { name: 'Forecast period' })).toBeVisible();
      await expect(page.getByRole('tab')).toHaveText(['Now', 'Today', 'This week']);
      await expect(page.locator('#tab-today')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#view-now')).toBeHidden();
      await expect(page.locator('#view-week')).toBeHidden();
      await expect(page.locator('h1')).toHaveCount(1);

      await page.locator('#tab-week').click();
      await expectView(page, 'week');
      await expect(page.locator('#week-answer')).toHaveText(ANSWERS);
      await expect(page.locator('#week-question')).toHaveText('Is it hot this week?');
      await expect(page.locator('#week-days li')).toHaveCount(7);
      await expect(page.locator('#week-days li').first().locator('.d')).toHaveText('Today');

      await page.locator('#tab-now').click();
      await expectView(page, 'now');
      await expect(page.locator('#now-answer')).toHaveText(ANSWERS);
      await expect(page.locator('#now-question')).toHaveText('Is it hot right now?');
      await expect(page.locator('#now-detail')).toHaveText(/^-?\d+° now, feels like -?\d+°\. /);
      await expect(page.locator('#now-hours li')).toHaveCount(6);
      // Screen readers hear the answer of the view they moved to.
      await expect(page.locator('#view-live')).toHaveText(/^Now: (Yes|No|Almost)\. /);

      await page.locator('#tab-today').click();
      await expectView(page, 'today');
      // Switching views never asks the server again.
      expect(calls).toHaveLength(1);
    });

    test('arrow keys move between tabs, and Tab goes into the view', async ({ page }) => {
      await ready(page);
      await page.locator('#tab-today').focus();
      await page.keyboard.press('ArrowRight');
      await expectView(page, 'week');
      await expect(page.locator('#tab-week')).toBeFocused();
      await page.keyboard.press('Home');
      await expectView(page, 'now');
      await expect(page.locator('#tab-now')).toBeFocused();
      await page.keyboard.press('End');
      await expectView(page, 'week');
      await page.keyboard.press('ArrowLeft');
      await expectView(page, 'today');
      await page.keyboard.press('Tab');
      await expect(page.locator('#view-today')).toBeFocused();
    });

    test('swipes change the view on a phone', async ({ page }, info) => {
      test.skip(info.project.name !== 'phone', 'touch swipes need a touch screen');
      await ready(page);
      await swipe(page, -260);
      await expectView(page, 'week');
      await swipe(page, 260);
      await expectView(page, 'today');
      await swipe(page, 260);
      await expectView(page, 'now');
      // A short drag that stops before letting go springs back. (A quick short flick moves on
      // to the next view, as native carousels do; its timing is the browser's, so not tested.)
      await swipe(page, -60, 0, 400);
      await expectView(page, 'now');
      // A mostly vertical swipe scrolls the page, not the views.
      await swipe(page, -40, -260);
      await expectView(page, 'now');
      expect(await page.evaluate(() => scrollY)).toBeGreaterThan(100);
    });
  });

  test('focus follows into the new view when the arrow keys scroll it', async ({ page }) => {
    await ready(page);
    // Bring the other views in, then return to Today and put focus in its panel.
    await page.locator('#tab-week').click();
    await expectView(page, 'week');
    await page.locator('#tab-today').click();
    await expectView(page, 'today');
    await page.locator('#view-today').focus();
    await page.keyboard.press('ArrowRight');
    await expectView(page, 'week');
    // Focus moved with the view instead of falling back to the page.
    await expect(page.locator('#view-week')).toBeFocused();
  });

  test('announcements never read hidden placeholder text', async ({ page }) => {
    await page.route('**/api/v1/today**', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'upstream_unavailable', message: 'down' } }),
      }),
    );
    await page.goto('/');
    await expect(page.locator('#retry')).toBeVisible();
    await page.locator('#tab-week').click();
    await expect(page.locator('#view-live')).toHaveText(
      'This week: Forecasts are unavailable right now. Try again in a few minutes.',
    );
    // Retry is offered whichever view is showing.
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('#week-answer')).toHaveText(/Forecasts are unavailable/);
  });

  test('the scroller takes the height of the view on screen', async ({ page }) => {
    await ready(page);
    const heights = () =>
      page.evaluate(() => ({
        views: document.getElementById('views')!.getBoundingClientRect().height,
        today: document.getElementById('view-today')!.getBoundingClientRect().height,
        week: document.getElementById('view-week')!.getBoundingClientRect().height,
      }));
    await page.locator('#tab-week').click();
    await expectView(page, 'week');
    // Never shorter than Today, so what is below the views does not move up on every switch.
    await expect
      .poll(async () => {
        const h = await heights();
        return Math.abs(h.views - Math.max(h.week, h.today));
      })
      .toBeLessThan(1);
    await page.locator('#tab-today').click();
    await expectView(page, 'today');
    await expect
      .poll(async () => Math.abs((await heights()).views - (await heights()).today))
      .toBeLessThan(1);
  });

  test('the content stays put when switching views', async ({ page }) => {
    // A screen taller than the page, with This week taller than Today (as it is when the
    // week's summary runs long, or few models answer for today).
    await page.setViewportSize({ width: page.viewportSize()!.width, height: 1600 });
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = '#view-week .ahead { padding-bottom: 40rem }';
        document.head.append(style);
      });
    });
    await ready(page);
    const tops = () =>
      page.evaluate(() => {
        const views = document.getElementById('views')!;
        const panel = [...views.querySelectorAll<HTMLElement>('.view')].find((p) => !p.inert)!;
        return {
          tabs: Math.round(document.getElementById('tabs')!.getBoundingClientRect().top),
          question: Math.round(panel.querySelector('.question')!.getBoundingClientRect().top),
        };
      });
    const today = await tops();
    for (const view of ['week', 'now', 'today'] as const) {
      await page.locator(`#tab-${view}`).click();
      await expectView(page, view);
      await expect.poll(tops, `${view} lines up with Today`).toEqual(today);
    }
  });

  test('a sideways trackpad swipe changes the view on a desktop', async ({
    page,
    ipPlace,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'trackpad swipes are a desktop gesture');
    await keepToday(page, ipPlace.tz);
    await ready(page);
    const box = (await page.locator('#views').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    // The first sideways movement brings the other views in; the next one moves past halfway.
    await page.mouse.wheel(30, 0);
    await expect(page.locator('#view-week')).toBeVisible();
    await page.mouse.wheel(500, 0);
    await expectView(page, 'week');
  });

  test('every load opens on Today', async ({ page, ipPlace }) => {
    await keepToday(page, ipPlace.tz);
    await ready(page);
    await page.locator('#tab-week').click();
    await expectView(page, 'week');
    await page.reload();
    await expect(page.locator('#answer')).toHaveText(ANSWERS);
    await expect(page.locator('#tab-today')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#view-week')).toBeHidden();
  });

  test('city pages render every view on the server', async ({ page }) => {
    await page.goto('/in/london-gb');
    await expect(page.locator('#now-question')).toHaveText('Is it hot in London right now?', {
      useInnerText: false,
    });
    await expect(page.locator('#week-question')).toHaveText('Is it hot in London this week?');
    const html = await page.content();
    expect(html).toContain('id="week-days"');
    await page.locator('#tab-week').click();
    await expectView(page, 'week');
    await expect(page.locator('#week-days li')).toHaveCount(7);
  });

  test('the place note never covers the topic toggle or the tabs', async ({ page }) => {
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await ready(page);
      const note = page.locator('#place-note');
      await expect(note).toBeVisible();
      const a = (await note.boundingBox())!;
      const toggle = (await page.locator('#topic').boundingBox())!;
      const tabs = (await page.locator('#tabs').boundingBox())!;
      if (width < 640) {
        // Phones: the toggle floats at the foot of the screen and the tabs take its place.
        expect(a.y + a.height, `note above the tabs at ${width}px`).toBeLessThanOrEqual(tabs.y);
        expect(toggle.y, `toggle below the tabs at ${width}px`).toBeGreaterThan(
          tabs.y + tabs.height,
        );
      } else {
        expect(a.y + a.height, `note above the toggle at ${width}px`).toBeLessThanOrEqual(toggle.y);
        expect(toggle.y + toggle.height, `toggle above the tabs at ${width}px`).toBeLessThanOrEqual(
          tabs.y,
        );
      }
    }
  });

  test('the page does not shift while it loads', async ({ page }) => {
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
    await ready(page);
    await page.waitForTimeout(1500);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.02);
  });

  test('"now" keeps up with the clock without asking the server', async ({ page }) => {
    await startClock(page);
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/today')) calls.push(r.url());
    });
    await ready(page);
    await page.locator('#tab-now').click();
    await expectView(page, 'now');
    const before = await page.locator('#now-hours li .n').first().textContent();
    await page.clock.runFor(61 * 60 * 1000);
    const after = await page.locator('#now-hours li .n').first().textContent();
    // An hour on, the list starts an hour later. (Past local midnight the app fetches the
    // new day instead, which is also right.)
    expect(after !== before || calls.length > 1).toBe(true);
  });
});
