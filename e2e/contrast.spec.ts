/**
 * Text contrast as rendered, for every band of both topics (Hot and Wet) and every view, on the
 * phone and desktop projects. The
 * background is sampled behind each piece of text (gradient, glow and control backings
 * included) and the worst pixel counts. Targets are WCAG 2.2 AA: 3:1 for large text (24px, or
 * 18.66px bold), 4.5:1 for everything else.
 *
 * The glow is fixed to the screen, so each element is measured where it is read: text in the
 * first screen at the top of the page, anything lower when scrolled to the middle.
 */
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { BANDS, RAIN_BANDS } from '../packages/core/src/config';

interface Target {
  name: string;
  selector: string;
  /** Minimum ratio, or null to decide from the computed font size and weight. */
  min?: number;
}

const SHARED: Target[] = [
  { name: 'topic', selector: '#topic button[aria-pressed=false]' },
  { name: 'topic (pressed)', selector: '#topic button[aria-pressed=true]' },
  { name: 'tab', selector: '[role=tab][aria-selected=false]' },
  { name: 'tab (selected)', selector: '[role=tab][aria-selected=true]' },
  { name: 'place', selector: '#place' },
  { name: 'units', selector: '.units button' },
  { name: 'outbound links', selector: '#more' },
  { name: 'stale notice', selector: '#stale' },
  { name: 'place note', selector: '#place-note' },
  { name: 'nearby', selector: '#nearby' },
  { name: 'footer links', selector: '.site-footer nav a' },
  { name: 'credit', selector: '.site-footer .credit' },
];

const VIEW_TARGETS: Record<'today' | 'now' | 'week', Target[]> = {
  today: [
    { name: 'question', selector: '#question' },
    { name: 'answer', selector: '#answer' },
    { name: 'verdict', selector: '#verdict' },
    { name: 'detail', selector: '#detail' },
    { name: 'agreement', selector: '#agree' },
    { name: 'scale', selector: '#smin, #smax' },
    { name: 'model temperature', selector: '#list li .t' },
    { name: 'model name', selector: '#list li .n' },
    { name: 'limited notice', selector: '#limited' },
  ],
  now: [
    { name: 'question', selector: '#now-question' },
    { name: 'answer', selector: '#now-answer' },
    { name: 'verdict', selector: '#now-verdict' },
    { name: 'detail', selector: '#now-detail' },
    { name: 'heading', selector: '#now-h' },
    { name: 'hour temperature', selector: '#now-hours .t' },
    { name: 'hour', selector: '#now-hours .n' },
  ],
  week: [
    { name: 'question', selector: '#week-question' },
    { name: 'answer', selector: '#week-answer' },
    { name: 'verdict', selector: '#week-verdict' },
    { name: 'detail', selector: '#week-detail' },
    { name: 'heading', selector: '#week-h' },
    { name: 'day', selector: '#week-days .d' },
    { name: 'day temperature', selector: '#week-days .t' },
    { name: 'day band', selector: '#week-days .a' },
  ],
};

const DIALOG: Target[] = [
  { name: 'dialog heading', selector: '#search-h' },
  { name: 'dialog close', selector: '#search-close' },
  { name: 'dialog input', selector: '#search-input' },
  { name: 'use my location', selector: '#use-location' },
  { name: 'result name', selector: '#search-results button span:first-child' },
  { name: 'result detail', selector: '#search-results .sub' },
];

const lum = ([r, g, b]: number[]) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
};
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

interface Measured {
  name: string;
  /** Page-relative boxes of the text, and where to scroll to read it. */
  rects: Array<[number, number, number, number]>;
  scrollY: number;
  color: number[];
  alpha: number;
  min: number;
}

/** Text boxes, colours and targets for the visible elements of each target. */
async function locate(page: Page, targets: Target[]): Promise<Measured[]> {
  return page.evaluate((list) => {
    const vh = innerHeight;
    const out: Measured[] = [];
    for (const t of list) {
      document.querySelectorAll(t.selector).forEach((el, i) => {
        if (i >= 12 || el.closest('[hidden],[inert]')) return;
        // Behind an open modal dialog only the dialog is visible.
        const modal = document.querySelector('dialog[open]');
        if (modal && !modal.contains(el)) return;
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = [...range.getClientRects()]
          .filter((r) => r.width > 0 && r.height > 0)
          .map(
            (r) =>
              [r.x + scrollX, r.y + scrollY, r.width, r.height] as [number, number, number, number],
          );
        if (rects.length === 0) return;
        const style = getComputedStyle(el);
        let opacity = 1;
        for (let n: Element | null = el; n; n = n.parentElement) {
          opacity *= Number(getComputedStyle(n).opacity);
        }
        const rgba = style.color.match(/[\d.]+/g)!.map(Number);
        const size = parseFloat(style.fontSize);
        // WCAG's large text: 24px, or 18.66px at bold (700) or heavier.
        const large = size >= 24 || (Number(style.fontWeight) >= 700 && size >= 18.66);
        const top = Math.min(...rects.map((r) => r[1]));
        const bottom = Math.max(...rects.map((r) => r[1] + r[3]));
        const scrollTo = bottom <= vh ? 0 : Math.max(0, Math.round((top + bottom) / 2 - vh / 2));
        out.push({
          name: t.name,
          rects,
          scrollY: scrollTo,
          color: rgba.slice(0, 3),
          alpha: (rgba[3] ?? 1) * opacity,
          min: t.min ?? (large ? 3 : 4.5),
        });
      });
    }
    return out;
  }, targets);
}

/**
 * On phones the Hot | Wet toggle floats over the page, which scrolls under it: the page's text
 * is measured without it, and the toggle on its own.
 */
async function measure(page: Page, targets: Target[], label: string): Promise<string[]> {
  const floating = targets.filter((t) => t.selector.startsWith('#topic'));
  const fixed = await page
    .locator('#topic')
    .evaluate((el) => getComputedStyle(el).position === 'fixed');
  if (!fixed || floating.length === 0 || floating.length === targets.length) {
    return measureEach(page, targets, label);
  }
  const hide = await page.addStyleTag({ content: '#topic{visibility:hidden!important}' });
  const rest = targets.filter((t) => !floating.includes(t));
  const failures = await measureEach(page, rest, label);
  await hide.evaluate((el) => (el as HTMLElement).remove());
  return [...failures, ...(await measureEach(page, floating, label))];
}

async function measureEach(page: Page, targets: Target[], label: string): Promise<string[]> {
  const found = await locate(page, targets);
  const failures: string[] = [];
  const worst = new Map<string, number>();
  for (const y of [...new Set(found.map((m) => m.scrollY))]) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(80);
    const hide = await page.addStyleTag({
      content:
        '*,*::before,*::after{color:transparent!important;text-decoration-color:transparent!important;text-shadow:none!important;outline:none!important;caret-color:transparent!important} svg,.dot,.band,.track{visibility:hidden!important}',
    });
    const png = PNG.sync.read(await page.screenshot({ scale: 'css' }));
    await hide.evaluate((el) => (el as HTMLElement).remove());
    for (const m of found.filter((f) => f.scrollY === y)) {
      let low = Infinity;
      for (const [x0, y0, w, h] of m.rects) {
        for (let py = Math.floor(y0 - y); py < y0 - y + h; py += 2) {
          for (let px = Math.floor(x0); px < x0 + w; px += 2) {
            if (px < 0 || py < 0 || px >= png.width || py >= png.height) continue;
            const i = (py * png.width + px) * 4;
            const bg = [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
            const fg = m.color.map((c, j) => c * m.alpha + bg[j]! * (1 - m.alpha));
            low = Math.min(low, ratio(fg, bg));
          }
        }
      }
      worst.set(m.name, Math.min(worst.get(m.name) ?? Infinity, low));
      if (low < m.min) failures.push(`${m.name} ${low.toFixed(2)} < ${m.min}`);
      if (process.env.CONTRAST_REPORT && low < m.min)
        console.log(`FAIL ${label} ${m.name} ${low.toFixed(2)} < ${m.min}`);
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  if (process.env.CONTRAST_REPORT) {
    console.log(`${label} ${[...worst].map(([name, r]) => `${name}=${r.toFixed(1)}`).join(' ')}`);
  }
  return failures;
}

// A rain band's preview opens on Wet.
for (const band of [...BANDS, ...RAIN_BANDS]) {
  test(`text contrast meets WCAG AA: ${band}`, async ({ page }, info) => {
    await page.goto(`/?preview=1&band=${band}`);
    const topic = (RAIN_BANDS as readonly string[]).includes(band) ? 'wet' : 'hot';
    await expect(page.locator(`#topic [data-topic=${topic}]`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.evaluate(() => document.fonts.ready);
    // Settle the colour transitions, then keep them off while switching views.
    await page.waitForTimeout(1200);
    await page.addStyleTag({ content: '*,*::before{transition:none!important}' });
    // Text that only shows in some states (stale data, few models, location notes, nearby
    // places): show it with sample words so it is measured too.
    await page.evaluate(() => {
      for (const id of ['stale', 'limited', 'place-note', 'nearby']) {
        document.getElementById(id)!.hidden = false;
      }
      const note = document.getElementById('place-note')!;
      if (!note.textContent?.trim()) note.textContent = 'Using approximate location.';
      const nearby = document.getElementById('nearby-links')!;
      if (!nearby.textContent?.trim())
        nearby.innerHTML = '<a href="#">Gateshead</a>, <a href="#">Sunderland</a>';
    });
    const failures: string[] = [];
    for (const view of ['today', 'now', 'week'] as const) {
      await page.locator(`#tab-${view}`).click();
      // Wait for the scroller to come to rest on the view.
      await expect
        .poll(() =>
          page.evaluate((v) => {
            const el = document.getElementById('views')!;
            const index = ['now', 'today', 'week'].indexOf(v);
            return Math.abs(el.scrollLeft - index * el.clientWidth) < 1;
          }, view),
        )
        .toBe(true);
      await page.waitForTimeout(150);
      const label = `${info.project.name.padEnd(7)} ${band.padEnd(9)} ${view.padEnd(5)}`;
      const found = await measure(page, [...VIEW_TARGETS[view], ...SHARED], label);
      failures.push(...found.map((f) => `${view}: ${f}`));
    }
    // The search sheet, with results and with the "too short" status line.
    await page.locator('#place-btn').click();
    await page.locator('#search-input').fill('New');
    await expect(page.locator('#search-results .sub').first()).toBeVisible();
    const label = `${info.project.name.padEnd(7)} ${band.padEnd(9)} search`;
    failures.push(...(await measure(page, DIALOG, label)).map((f) => `search: ${f}`));
    await page.locator('#search-input').fill('N');
    await expect(page.locator('#search-results .status')).toBeVisible();
    const status = [{ name: 'search status', selector: '#search-results .status' }];
    failures.push(...(await measure(page, status, label)).map((f) => `search: ${f}`));
    expect([...new Set(failures)]).toEqual([]);
  });
}
