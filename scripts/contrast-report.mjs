#!/usr/bin/env node
/**
 * Measures text contrast as rendered, per band, on phone and desktop widths. The background
 * is sampled behind each piece of text (gradient and glow included), and the worst pixel is
 * reported. Run against a dev server or deploy:
 *
 *   node scripts/contrast-report.mjs http://127.0.0.1:4321
 *
 * Uses the ?preview=1 sample days. Targets (spec): 3:1 for the answer and verdict, 4.5:1 for
 * detail and footer text.
 */
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

const base = (process.argv[2] ?? 'http://127.0.0.1:4321').replace(/\/$/, '');
const local = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(local) ? { executablePath: local } : {});

const TARGETS = {
  question: ['#question', 4.5],
  answer: ['#answer', 3],
  verdict: ['#verdict', 3],
  detail: ['#detail', 4.5],
  agree: ['#agree', 4.5],
  model: ['#list li:not(.out) .t', 4.5],
  place: ['#place', 4.5],
  more: ['#more', 4.5],
  footer: ['.site-footer nav a', 4.5],
};

const lum = ([r, g, b]) => {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

let failures = 0;
for (const [width, height] of [
  [390, 844],
  [1280, 900],
]) {
  const page = await browser.newPage({ viewport: { width, height } });
  for (const band of ['freezing', 'cold', 'mild', 'warm', 'hot', 'scorching']) {
    await page.goto(`${base}/?preview=1&band=${band}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const boxes = await page.evaluate((targets) => {
      const out = {};
      for (const [name, [selector]] of Object.entries(targets)) {
        const el = document.querySelector(selector);
        if (!el || el.closest('[hidden]')) continue;
        const range = document.createRange();
        range.selectNodeContents(el);
        let opacity = 1;
        for (let n = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
        const rgba = getComputedStyle(el)
          .color.match(/[\d.]+/g)
          .map(Number);
        out[name] = {
          rects: [...range.getClientRects()].map((r) => [
            r.x + scrollX,
            r.y + scrollY,
            r.width,
            r.height,
          ]),
          color: rgba.slice(0, 3),
          alpha: (rgba[3] ?? 1) * opacity,
        };
      }
      return out;
    }, TARGETS);
    await page.addStyleTag({
      content:
        '*{color:transparent!important;text-decoration-color:transparent!important} svg,.dot,.band{visibility:hidden!important}',
    });
    const png = PNG.sync.read(await page.screenshot({ fullPage: true }));
    const cells = [];
    for (const [name, t] of Object.entries(boxes)) {
      let worst = Infinity;
      for (const [x0, y0, w, h] of t.rects) {
        for (let y = Math.floor(y0); y < y0 + h; y += 2) {
          for (let x = Math.floor(x0); x < x0 + w; x += 2) {
            if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
            const i = (y * png.width + x) * 4;
            const bg = [png.data[i], png.data[i + 1], png.data[i + 2]];
            const fg = t.color.map((c, j) => c * t.alpha + bg[j] * (1 - t.alpha));
            worst = Math.min(worst, ratio(fg, bg));
          }
        }
      }
      const ok = worst >= TARGETS[name][1];
      if (!ok) failures++;
      cells.push(`${name}=${worst.toFixed(1)}${ok ? '' : '!'}`);
    }
    console.log(`${String(width).padStart(4)} ${band.padEnd(9)} ${cells.join(' ')}`);
  }
  await page.close();
}
await browser.close();
console.log(`\n${failures} text/band/width combinations below target (marked !)`);
