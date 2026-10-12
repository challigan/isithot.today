import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { fileURLToPath } from 'node:url';
import { PALETTES } from '../packages/core/src/config';
import { GLYPHS } from '../apps/web/src/lib/view';

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
      // Pages open on Today alone; Now and This week join the scroller on first use.
      await expect(page.locator('#view-now')).toBeHidden();
      await expect(page.locator('#view-week')).toBeHidden();
      // The topic toggle, the tab bar, the UV line and the "Updated" line are new since the
      // prototype: take them out of the layout for the comparison.
      await page.addStyleTag({ content: '#topic,#tabs,#uv,#updated{display:none!important}' });
      const actual = await mainShot(page);
      const palette = PALETTES[band];
      const vars = await page.evaluate(() => {
        const s = document.documentElement.style;
        return ['--g1', '--g2', '--g3', '--ink', '--glow'].map((v) => s.getPropertyValue(v).trim());
      });
      expect(vars).toEqual([palette.g1, palette.g2, palette.g3, palette.ink, palette.glow]);
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', palette.g1);
      // Serialise the expected icon through the browser too, so markup style does not matter.
      const icon = await page.evaluate((markup) => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.innerHTML = markup;
        return { expected: svg.innerHTML, actual: document.getElementById('glyph')!.innerHTML };
      }, GLYPHS[band]);
      expect(icon.actual).toBe(icon.expected);

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
      // Text rasterisation differs a little between machines (about 1-2% locally, 3-4% on CI
      // runners), so the pixel check is a backstop; the band's own colours and icon are asserted
      // directly above, which catches the regressions that matter.
      expect(ratio, `${(ratio * 100).toFixed(2)}% of pixels differ`).toBeLessThan(0.05);
    });
  }
});
