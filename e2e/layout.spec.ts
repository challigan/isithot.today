/**
 * Phone layout: the Hot | Wet | Snow | Wind toggle floats at the foot of the screen in thumb reach
 * (from 640px up it sits above the tabs), its four buttons keep their icons and words inside them
 * at any width and text size, nothing scrolls sideways with large text on a narrow phone, long
 * answers ("Maybe.", "Almost.", "A bit.") are sized to fit, and so is the hot views' UV line.
 */
import type { Page } from '@playwright/test';
import { TOPICS } from '../packages/core/src/config';
import { expect, test } from './helpers';

const PAGES = ['/', '/wet', '/snow', '/wind', '/in/london-gb', '/wind/in/london-gb'];

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

test.describe('the Hot | Wet | Snow | Wind toggle', () => {
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
      // Every button of the toggle is still there to press (at this size each icon sits over its
      // word, as on a phone's tab bar).
      for (const t of TOPICS) {
        const button = (await page.locator(`#topic [data-topic=${t}]`).boundingBox())!;
        expect(button.width, `${path} ${t}`).toBeGreaterThan(40);
        expect(button.x + button.width, `${path} ${t}`).toBeLessThanOrEqual(320);
      }
    }
  });

  test('keeps every icon and word inside its button, at any width and text size', async ({
    page,
  }, info) => {
    const widths = info.project.name === 'phone' ? [320, 360, 375, 414, 430] : [640, 1280];
    await ready(page, '/wind');
    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      for (const size of ['100%', '125%', '150%', '175%', '200%']) {
        await page.evaluate((s) => {
          document.documentElement.style.fontSize = s;
        }, size);
        const label = `${width}px, ${size} text`;
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), label)
          .toBeLessThanOrEqual(0);
        const fit = await page.evaluate(() => {
          const pill = document.getElementById('topic')!.getBoundingClientRect();
          const over: string[] = [];
          for (const b of document.querySelectorAll<HTMLElement>('#topic button')) {
            const box = b.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(b);
            // The word: the button's text without the icon.
            const text = [...range.getClientRects()].filter((r) => r.height > 0 && r.width > 0);
            const icon = b.querySelector('svg')!;
            const parts = getComputedStyle(icon).display === 'none' ? [] : [icon];
            const rects = [...text, ...parts.map((p) => p.getBoundingClientRect())];
            for (const r of rects) {
              const out = Math.max(box.left - r.left, r.right - box.right, box.top - r.top);
              if (out > 0.5 || r.bottom - box.bottom > 0.5) over.push(b.dataset.topic!);
            }
            if (box.left < pill.left - 0.5 || box.right > pill.right + 0.5) over.push('pill');
          }
          return { over, left: pill.left, right: pill.right };
        });
        expect(fit.over, label).toEqual([]);
        expect(fit.left, label).toBeGreaterThanOrEqual(0);
        expect(fit.right, label).toBeLessThanOrEqual(width);
      }
    }
  });
});

test.describe("wind's questions", () => {
  test('stay clear of the icon on a narrow phone', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/wind?preview=1&band=windy');
    await page.evaluate(() => document.fonts.ready);
    for (const view of ['today', 'now', 'week'] as const) {
      await page.locator(`#tab-${view}`).click();
      const id = view === 'today' ? '' : `${view}-`;
      await expect(page.locator(`#${id}question`)).toBeVisible();
      // "Will it be windy this week?" wraps before the icon rather than running under it.
      const gap = await page.evaluate((prefix) => {
        const range = document.createRange();
        range.selectNodeContents(document.getElementById(`${prefix}question`)!);
        const text = range.getBoundingClientRect();
        const glyph = document.getElementById(`${prefix}glyph`)!.getBoundingClientRect();
        return { right: text.right, max: glyph.left + glyph.width * 0.1 };
      }, id);
      expect(gap.right, view).toBeLessThanOrEqual(gap.max);
    }
  });
});

test.describe('long answers', () => {
  // Preview bands with each length of answer.
  const CASES = [
    { band: 'showers', answer: 'Maybe.', long: true },
    { band: 'warm', answer: 'Almost.', long: true },
    { band: 'breezy', answer: 'A bit.', long: true },
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

test.describe('the UV line', () => {
  test('fits a narrow phone with large text, on Today and Now', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    // The longest lines: "UV 8 · Very high, highest around 1pm", "UV 11 · Extreme, …".
    for (const band of ['hot', 'scorching']) {
      await page.goto(`/?preview=1&band=${band}`);
      await expect(page.locator('#uv')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      for (const [view, id] of [
        ['today', 'uv'],
        ['now', 'now-uv'],
      ] as const) {
        await page.locator(`#tab-${view}`).click();
        await expect(page.locator(`#${id}`)).toBeVisible();
        // The line's words and its icon lie within the view's gutters.
        const over = () =>
          page.evaluate((lineId) => {
            const line = document.getElementById(lineId)!;
            const view = line.closest<HTMLElement>('.view')!;
            const box = view.getBoundingClientRect();
            const style = getComputedStyle(view);
            const left = box.left + parseFloat(style.paddingLeft);
            const right = box.right - parseFloat(style.paddingRight);
            const range = document.createRange();
            range.selectNodeContents(line.querySelector('[aria-hidden=true]:not(svg)')!);
            const text = range.getBoundingClientRect();
            const icon = line.querySelector('svg')!.getBoundingClientRect();
            return Math.max(left - icon.left, left - text.left, text.right - right);
          }, id);
        await expect.poll(over, `${band} ${view}`).toBeLessThanOrEqual(0.5);
      }
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), band)
        .toBeLessThanOrEqual(0);
    }
  });
});
