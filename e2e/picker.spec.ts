/**
 * The place picker. On phones it fills the screen, with the search at the top where an
 * on-screen keyboard cannot cover it, and only closes on purpose: Close, Escape (or the back
 * gesture), a choice, or "Use my location". A tap that only dismisses the keyboard lands on the
 * picker itself. From 640px up it is a centred card that a click outside also closes.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './helpers';

/** Search results for "Pla": enough places to scroll. */
const PLACES = Array.from({ length: 25 }, (_, i) => ({
  name: `Place ${i + 1}`,
  region: 'England',
  country: 'GB',
  countryName: 'United Kingdom',
  lat: 52 + i / 10,
  lon: -1.5,
}));

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  await page.locator('#place-btn').click();
  await expect(page.locator('#search')).toBeVisible();
  await expect(page.locator('#search-input')).toBeFocused();
}

test.describe('on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout');

  test('the picker fills the screen, with the search at the top', async ({ page }) => {
    await open(page);
    const vp = page.viewportSize()!;
    const box = (await page.locator('#search').boundingBox())!;
    expect([box.x, box.y, box.width, box.height].map(Math.round)).toEqual([
      0,
      0,
      vp.width,
      vp.height,
    ]);
    const input = (await page.locator('#search-input').boundingBox())!;
    expect(input.y + input.height).toBeLessThan(vp.height / 5);
    // Under the header row with its Close button, a comfortable target on a touch screen.
    const close = (await page.locator('#search-close').boundingBox())!;
    expect(close.y + close.height).toBeLessThanOrEqual(input.y);
    expect(close.width).toBeGreaterThanOrEqual(44);
    expect(close.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('#search-h')).toBeVisible();
    // "Use my location" comes first, then the results.
    const use = (await page.locator('#use-location').boundingBox())!;
    expect(use.y).toBeGreaterThan(input.y);
    await expect(page.locator('#search')).toHaveAttribute('aria-labelledby', 'search-h');
    await expect(page.locator('#search-results')).toHaveAttribute('aria-live', 'polite');
  });

  test('a tap where the backdrop was does not close it', async ({ page }) => {
    await open(page);
    await page.locator('#search-input').fill('Bris');
    await expect(page.getByRole('button', { name: /Bristol/ })).toBeVisible();
    const vp = page.viewportSize()!;
    // Low on the screen (where a bottom sheet's backdrop was) and in the empty space beside it.
    await page.touchscreen.tap(vp.width / 2, vp.height - 20);
    await page.touchscreen.tap(vp.width - 10, vp.height / 2);
    await expect(page.locator('#search')).toBeVisible();
    // What was typed is still there to choose from.
    await expect(page.locator('#search-input')).toHaveValue('Bris');
    await page.getByRole('button', { name: /Bristol/ }).click();
    await expect(page).toHaveURL(/\/in\/bristol-gb$/);
  });

  test('Close and Escape close it, and focus goes back to the place', async ({ page }) => {
    await open(page);
    await page.locator('#search-close').click();
    await expect(page.locator('#search')).toBeHidden();
    await expect(page.locator('#place-btn')).toBeFocused();

    await page.locator('#place-btn').click();
    await expect(page.locator('#search')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#search')).toBeHidden();
    await expect(page.locator('#place-btn')).toBeFocused();
  });

  test('the results scroll on their own, clear of a keyboard', async ({ page }) => {
    await page.route('**/api/v1/search**', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: PLACES }) }),
    );
    await open(page);
    await page.locator('#search-input').fill('Pla');
    await expect(page.locator('#search-results li')).toHaveCount(PLACES.length);
    const body = page.locator('#search-body');
    const sizes = await body.evaluate((el) => ({
      scroll: el.scrollHeight,
      client: el.clientHeight,
    }));
    expect(sizes.scroll).toBeGreaterThan(sizes.client);
    // Scrolled to the end, the last place rises into the top part of the screen, above where an
    // on-screen keyboard would be.
    await body.evaluate((el) => (el.scrollTop = el.scrollHeight));
    const vp = page.viewportSize()!;
    await expect
      .poll(async () => (await page.locator('#search-results li').last().boundingBox())!.y)
      .toBeLessThan(vp.height * 0.6);
    // The header and the search stay where they are.
    const input = (await page.locator('#search-input').boundingBox())!;
    expect(input.y + input.height).toBeLessThan(vp.height / 5);
  });

  test('a keyboard that shrinks the screen leaves the search in view', async ({ page }) => {
    // Android Chrome makes room for its keyboard by resizing the page, as iOS does in effect.
    await page.goto('/');
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      'content',
      /\binteractive-widget=resizes-content\b/,
    );
    await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
    // With the views brought in, so the scroller has a place to keep.
    await page.locator('#tab-week').click();
    await page.locator('#tab-today').click();
    await expect(page.locator('#tab-today')).toHaveAttribute('aria-selected', 'true');
    const resting = () =>
      page.locator('#views').evaluate((el) => Math.round(el.scrollLeft / el.clientWidth));
    await expect.poll(resting).toBe(1);
    await page.locator('#place-btn').click();
    await expect(page.locator('#search-input')).toBeFocused();
    const vp = page.viewportSize()!;
    const input = (await page.locator('#search-input').boundingBox())!;

    const keyboard = { width: vp.width, height: Math.round(vp.height * 0.55) };
    await page.setViewportSize(keyboard);
    // The picker takes the space left, with the search where it was.
    await expect
      .poll(async () => Math.round((await page.locator('#search').boundingBox())!.height))
      .toBe(keyboard.height);
    expect((await page.locator('#search-input').boundingBox())!.y).toBeCloseTo(input.y, 0);
    await page.locator('#search-input').fill('Bris');
    await expect(page.getByRole('button', { name: /Bristol/ })).toBeInViewport();

    // Keyboard down, picker closed: the page is on the view it was on.
    await page.setViewportSize(vp);
    await expect(page.locator('#search')).toBeVisible();
    await page.locator('#search-close').click();
    await expect(page.locator('#search')).toBeHidden();
    await expect(page.locator('#tab-today')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(resting).toBe(1);
  });

  test('the page behind keeps its place', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
    await page.evaluate(() => window.scrollTo(0, 150));
    await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBe(150);
    // Opened as a tap would, without scrolling the button into view first.
    await page.evaluate(() => document.getElementById('place-btn')!.click());
    await expect(page.locator('#search')).toBeVisible();
    await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');
    await page.locator('#search-close').click();
    await expect(page.locator('#search')).toBeHidden();
    expect(await page.evaluate(() => Math.round(scrollY))).toBe(150);
  });
});

test.describe('from 640px up', () => {
  test.skip(({ isMobile }) => isMobile, 'wide layout');

  test('the picker is a card that a click outside closes', async ({ page }) => {
    await open(page);
    const vp = page.viewportSize()!;
    const box = (await page.locator('#search').boundingBox())!;
    expect(box.width).toBeLessThan(vp.width / 2);
    expect(box.y).toBeGreaterThan(0);
    expect(Math.abs(box.x + box.width / 2 - vp.width / 2)).toBeLessThan(1);
    // A click inside the card leaves it open; one on the dimmed page closes it.
    await page.locator('#search-h').click();
    await expect(page.locator('#search')).toBeVisible();
    await page.mouse.click(10, vp.height - 10);
    await expect(page.locator('#search')).toBeHidden();
    await expect(page.locator('#place-btn')).toBeFocused();
  });
});

test('reopening keeps the search, ready to type over', async ({ page }) => {
  await open(page);
  await page.locator('#search-input').fill('Bris');
  await expect(page.getByRole('button', { name: /Bristol/ })).toBeVisible();
  await page.locator('#search-close').click();
  await expect(page.locator('#search')).toBeHidden();
  await page.locator('#place-btn').click();
  await expect(page.locator('#search-input')).toBeFocused();
  await expect(page.locator('#search-input')).toHaveValue('Bris');
  expect(
    await page
      .locator('#search-input')
      .evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]),
  ).toEqual([0, 4]);
  await expect(page.getByRole('button', { name: /Bristol/ })).toBeVisible();
});

test('Escape clears the search first, then closes the picker', async ({ page }) => {
  await open(page);
  await page.locator('#search-input').fill('Bris');
  await expect(page.getByRole('button', { name: /Bristol/ })).toBeVisible();
  // The first Escape only empties the field (the browser's own for a search field), so the
  // visitor can start again without losing the picker.
  await page.keyboard.press('Escape');
  await expect(page.locator('#search-input')).toHaveValue('');
  await expect(page.locator('#search')).toBeVisible();
  await expect(page.locator('#search-input')).toBeFocused();
  await expect(page.getByRole('button', { name: /Bristol/ })).toHaveCount(0);
  // The next one closes it.
  await page.keyboard.press('Escape');
  await expect(page.locator('#search')).toBeHidden();
  await expect(page.locator('#place-btn')).toBeFocused();
});

test('Enter chooses the first place', async ({ page }) => {
  await open(page);
  await page.locator('#search-input').fill('Bris');
  // Brisbane, then Bristol: the biggest first.
  const first = page.locator('#search-results button').first();
  await expect(first).toContainText('Brisbane');
  await page.locator('#search-input').press('Enter');
  await expect(page).toHaveURL(/\/in\/brisbane-au$/);
});
