/**
 * Phone layout: the Hot | Wet toggle floats at the foot of the screen in thumb reach (from 640px
 * up it sits above the tabs), nothing scrolls sideways with large text on a narrow phone, and
 * long answers ("Maybe.", "Almost.") are sized to fit.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './helpers';

const PAGES = ['/', '/wet', '/in/london-gb'];

async function ready(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => document.fonts.ready);
}

/** The bottom of the footer's last line of text, in the viewport. */
const footerTextBottom = (page: Page) =>
  page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('.site-footer')!);
    return Math.max(...[...range.getClientRects()].map((r) => r.bottom));
  });

test.describe('the Hot | Wet toggle', () => {
  test('floats at the foot of a phone screen, clear of the footer', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'phone layout');
    const vp = page.viewportSize()!;
    for (const path of PAGES) {
      await ready(page, path);
      const topic = page.locator('#topic');
      await expect(topic).toHaveCSS('position', 'fixed');
      const box = (await topic.boundingBox())!;
      expect(box.x, path).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, path).toBeLessThanOrEqual(vp.width);
      expect(box.y + box.height, path).toBeLessThanOrEqual(vp.height);
      // Centred, at the foot of the screen.
      expect(Math.abs(box.x + box.width / 2 - vp.width / 2), path).toBeLessThan(1);
      expect(vp.height - (box.y + box.height), path).toBeLessThanOrEqual(40);
      // Below the tabs, which take its place under the header.
      const tabs = (await page.locator('#tabs').boundingBox())!;
      expect(box.y, path).toBeGreaterThan(tabs.y + tabs.height);

      // Scrolled to the end, the footer's last line sits above it, not under it.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect.poll(() => page.evaluate(() => Math.round(scrollY)), path).toBeGreaterThan(0);
      const end = (await topic.boundingBox())!;
      expect(end.y, path).toBeCloseTo(box.y, 0);
      expect(await footerTextBottom(page), path).toBeLessThanOrEqual(end.y);
    }
  });

  test('sits above the tabs from 640px up', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'wide layout');
    for (const path of PAGES) {
      await ready(page, path);
      const topic = page.locator('#topic');
      await expect(topic).toHaveCSS('position', 'relative');
      const box = (await topic.boundingBox())!;
      const tabs = (await page.locator('#tabs').boundingBox())!;
      expect(box.y + box.height, path).toBeLessThanOrEqual(tabs.y);
      expect(Math.abs(box.x + box.width / 2 - (tabs.x + tabs.width / 2)), path).toBeLessThan(1);
      // It scrolls away with the page.
      await page.evaluate(() => window.scrollTo(0, 200));
      await expect.poll(async () => (await topic.boundingBox())!.y, path).toBeLessThan(box.y);
    }
  });

  test('nothing scrolls sideways at 320px with 200% text', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of PAGES) {
      await ready(page, path);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), path)
        .toBeLessThanOrEqual(0);
      const box = (await page.locator('#topic').boundingBox())!;
      expect(box.x, path).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, path).toBeLessThanOrEqual(320);
      // Both halves of the toggle are still there to press.
      for (const t of ['hot', 'wet']) {
        const button = (await page.locator(`#topic [data-topic=${t}]`).boundingBox())!;
        expect(button.width, `${path} ${t}`).toBeGreaterThan(40);
        expect(button.x + button.width, `${path} ${t}`).toBeLessThanOrEqual(320);
      }
    }
  });
});

test.describe('long answers', () => {
  // Preview bands with each length of answer.
  const CASES = [
    { band: 'showers', answer: 'Maybe.', long: true },
    { band: 'warm', answer: 'Almost.', long: true },
    { band: 'hot', answer: 'Yes.', long: false },
  ];

  test('fit across a narrow phone with large text', async ({ page }) => {
    for (const { band, answer, long } of CASES) {
      for (const width of [320, 360, 412]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/?preview=1&band=${band}`);
        const el = page.locator('#answer');
        await expect(el).toHaveText(answer);
        // Sized to fit by its length: "Yes." and "No." keep the full size.
        if (long) await expect(el).toHaveAttribute('data-long', '');
        else await expect(el).not.toHaveAttribute('data-long');
        await page.evaluate(() => document.fonts.ready);
        for (const size of ['100%', '150%', '200%']) {
          await page.evaluate((s) => {
            document.documentElement.style.fontSize = s;
          }, size);
          // The answer's glyphs lie within the views, which clip anything wider.
          const fit = await page.evaluate(() => {
            const range = document.createRange();
            range.selectNodeContents(document.getElementById('answer')!);
            const text = range.getBoundingClientRect();
            const views = document.getElementById('views')!.getBoundingClientRect();
            return { over: Math.max(views.left - text.left, text.right - views.right) };
          });
          expect(fit.over, `${answer} at ${width}px, ${size} text`).toBeLessThanOrEqual(0.5);
        }
      }
    }
  });
});
