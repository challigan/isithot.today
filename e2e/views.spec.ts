import { expect, test, type Page } from '@playwright/test';
import { PALETTES, type Band } from '../packages/core/src/config';

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
    await expect
      .poll(async () => Math.abs((await heights()).views - (await heights()).week))
      .toBeLessThan(1);
    await page.locator('#tab-today').click();
    await expectView(page, 'today');
    await expect
      .poll(async () => Math.abs((await heights()).views - (await heights()).today))
      .toBeLessThan(1);
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

  test('a sideways trackpad swipe changes the view on a desktop', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'trackpad swipes are a desktop gesture');
    await ready(page);
    const box = (await page.locator('#views').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    // The first sideways movement brings the other views in; the next one moves past halfway.
    await page.mouse.wheel(30, 0);
    await expect(page.locator('#view-week')).toBeVisible();
    await page.mouse.wheel(500, 0);
    await expectView(page, 'week');
  });

  test('every load opens on Today', async ({ page }) => {
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

  test('the place note never covers the tabs', async ({ page }) => {
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await ready(page);
      const note = page.locator('#place-note');
      await expect(note).toBeVisible();
      const a = (await note.boundingBox())!;
      const b = (await page.locator('#tabs').boundingBox())!;
      expect(a.y + a.height, `note above tabs at ${width}px`).toBeLessThanOrEqual(b.y);
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
    await page.clock.install();
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
