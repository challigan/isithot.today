import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { fileURLToPath } from 'node:url';

const prototype = new URL(
  `file://${fileURLToPath(new URL('../reference/prototype.html', import.meta.url))}`,
);
const BANDS = ['freezing', 'cold', 'mild', 'warm', 'hot', 'scorching'] as const;

async function mainShot(page: Page): Promise<PNG> {
  await page.evaluate(() => document.fonts.ready);
  // Let the colour transitions and entrance animation finish.
  await page.waitForTimeout(1200);
  return PNG.sync.read(await page.locator('main').screenshot({ animations: 'disabled' }));
}

function crop(png: PNG, width: number, height: number): PNG {
  const out = new PNG({ width, height });
  PNG.bitblt(png, out, 0, 0, width, height, 0, 0);
  return out;
}

test.describe('matches the approved prototype', () => {
  for (const band of BANDS) {
    test(band, async ({ page }, info) => {
      await page.goto(prototype.toString());
      await page.locator(`#chips button[data-key="${band}"]`).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      const expected = await mainShot(page);

      await page.goto(`/?preview=1&band=${band}`);
      const actual = await mainShot(page);

      const width = Math.min(expected.width, actual.width);
      const height = Math.min(expected.height, actual.height);
      const a = crop(expected, width, height);
      const b = crop(actual, width, height);
      const diff = new PNG({ width, height });
      const changed = pixelmatch(a.data, b.data, diff.data, width, height, { threshold: 0.2 });
      const ratio = changed / (width * height);
      await info.attach(`${band}-diff.png`, {
        body: PNG.sync.write(diff),
        contentType: 'image/png',
      });
      expect(Math.abs(expected.height - actual.height), 'main height').toBeLessThan(40);
      expect(ratio, `${(ratio * 100).toFixed(2)}% of pixels differ`).toBeLessThan(0.03);
    });
  }
});
