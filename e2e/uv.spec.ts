/**
 * The UV index on the hot views: a line under the detail on Today (or Tomorrow) and on Now, no
 * line on Now at night, and none on Wet and Snow. Home pages answer for the approximate place,
 * on the equator (helpers.ts `ipPlaceAt`), where the UV index is above 0 all day and 0 all night.
 */
import { BANDS } from '../packages/core/src/config';
import { UV_LEVEL_LABELS } from '../packages/core/src/copy';
import type { ApiUvDay, TodayResponse } from '../packages/core/src/types';
import { DAYTIME, cityAt, expect, test, toggle } from './helpers';

const LEVELS = Object.values(UV_LEVEL_LABELS);
const NOW_LINE = new RegExp(`^UV [1-9]\\d* · (${LEVELS.join('|')}) now$`);
const NOW_SPOKEN = new RegExp(`^UV index [1-9]\\d*, (${LEVELS.join('|').toLowerCase()})$`);

/** What Today (or Tomorrow) shows for a day's UV index, and what screen readers hear. */
function dayLine(uv: ApiUvDay): { text: string; sr: string; level: string } {
  const level = UV_LEVEL_LABELS[uv.level];
  return {
    text: `UV ${uv.max} · ${level}, highest around ${uv.peak}`,
    sr: `UV index ${uv.max}, ${level.toLowerCase()}, highest around ${uv.peak}`,
    level,
  };
}

/** The line's words as seen (the screen reader's words are a sibling). */
const seen = (id: string) => `#${id}-line > [aria-hidden=true]`;
const spoken = (id: string) => `#${id}-line > .sr-only`;

test.describe('in the daytime', () => {
  // Today opens first and Now answers, on the browser's own clock.
  test.use({ ipHour: DAYTIME });

  test('hot Today and Now show the UV index', async ({ page }) => {
    const response = page.waitForResponse((r) => r.url().includes('/api/v1/today'));
    await page.goto('/');
    const data = (await (await response).json()) as TodayResponse;
    await expect(page.locator('#tab-today')).toHaveAttribute('aria-selected', 'true');
    const line = dayLine(data.days[0]!.uv!);
    await expect(page.locator('#uv')).toBeVisible();
    await expect(page.locator(seen('uv'))).toHaveText(line.text);
    // The level's word is the emphasis; screen readers hear the line without the dot.
    await expect(page.locator('#uv b')).toHaveText(line.level);
    await expect(page.locator(spoken('uv'))).toHaveText(line.sr);

    await page.locator('#tab-now').click();
    await expect(page.locator('#now-uv')).toBeVisible();
    await expect(page.locator(seen('now-uv'))).toHaveText(NOW_LINE);
    await expect(page.locator(spoken('now-uv'))).toHaveText(NOW_SPOKEN);
  });

  test('Wet and Snow have no UV line', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#uv')).toBeVisible();
    await expect(page.locator('#now-uv')).not.toHaveAttribute('hidden');
    for (const topic of ['wet', 'snow'] as const) {
      await toggle(page, topic).click();
      await expect(toggle(page, topic)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#uv')).toBeHidden();
      await expect(page.locator('#uv')).toHaveAttribute('hidden', '');
      await expect(page.locator('#now-uv')).toHaveAttribute('hidden', '');
    }
    await toggle(page, 'hot').click();
    await expect(page.locator('#uv')).toBeVisible();

    // Nor do the wet and snow sites' own pages.
    for (const path of ['/wet', '/snow']) {
      await page.goto(path);
      await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
      await expect(page.locator('#uv')).toHaveAttribute('hidden', '');
      await expect(page.locator('#now-uv')).toHaveAttribute('hidden', '');
    }
  });
});

test.describe('at night', () => {
  // The page opens on Now, with Tomorrow in the middle.
  test.use({ ipHour: 22 });

  test('Now has no UV line, and Tomorrow has its own', async ({ page }) => {
    const response = page.waitForResponse((r) => r.url().includes('/api/v1/today'));
    await page.goto('/');
    const data = (await (await response).json()) as TodayResponse;
    await expect(page.locator('#tab-now')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#now-answer')).toHaveText(/^(Yes|No|Almost)\.$/);
    await expect(page.locator('#now-uv')).toHaveAttribute('hidden', '');
    await expect(page.locator('#now-uv')).toBeHidden();

    await page.locator('#tab-today').click();
    await expect(page.locator('#tab-today')).toHaveText('Tomorrow');
    await expect(page.locator(seen('uv'))).toHaveText(dayLine(data.days[1]!.uv!).text);
  });
});

test('city pages have the UV line in their own markup', async ({ request }) => {
  const city = await cityAt(request, '08:00', '16:00');
  const html = await (await request.get(`/in/${city.slug}`)).text();
  const uv = city.data.days[0]!.uv!;
  if (uv.max > 0) {
    const line = dayLine(uv);
    expect(html).toContain('<p class="uv hold" id="uv">');
    expect(html).toContain(line.text.replace(line.level, `<b>${line.level}</b>`));
    expect(html).toContain(`<span class="sr-only">${line.sr}</span>`);
  } else {
    // A day without sun to speak of (in a polar winter) has no line.
    expect(html).toContain('<p class="uv hold" id="uv" hidden>');
  }
  // The wet page for the same city has none.
  const wet = await (await request.get(`/wet/in/${city.slug}`)).text();
  expect(wet).toContain('<p class="uv hold" id="uv" hidden>');
});

test('every hot preview sample has a UV line, with all five levels between them', async ({
  page,
}) => {
  await page.goto(`/?preview=1&band=${BANDS[0]}`);
  const levels = new Set<string>();
  for (const band of BANDS) {
    await page.locator(`#preview [data-band=${band}]`).click();
    await expect(page.locator(`#preview [data-band=${band}]`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('#uv')).toBeVisible();
    await expect(page.locator('#now-uv')).not.toHaveAttribute('hidden');
    await expect(page.locator(seen('now-uv'))).toHaveText(NOW_LINE);
    levels.add((await page.locator('#uv b').textContent())!);
  }
  expect([...levels].sort()).toEqual([...LEVELS].sort());
});
