#!/usr/bin/env node
/**
 * Worst-case WCAG contrast for every palette (Hot, Wet, Snow and Wind) at the places text is read,
 * worked out from the colours alone so a palette can be tuned before the page exists. The real test
 * is e2e/contrast.spec.ts, which measures the rendered page. Small text needs 4.5:1; this asks for
 * 4.6 to leave room for antialiasing and the gradient's dithering.
 *
 * Positions (see apps/web/src/styles/global.css):
 * - g1, g2: page text at the gradient's two ends.
 * - glow: page text at the glow's centre (88% 6%), over the gradient a little way down from g1.
 * - control: text on a control (pill colour at 85%) at the glow's centre, the worst spot.
 * - selected: pill-coloured text on an ink-filled control (selected tab, unit and topic).
 * - units: an unselected unit (85% opacity) on a control at the glow's centre.
 * - detail: the faintest page text (90% opacity: detail, model names) on g1 or g2.
 * - sheet: the search sheet (pill fading 15% towards g2): result details at 90% opacity, and
 *   typed text on the input's 8% ink tint.
 *
 * Wet, Snow and Wind are held to every column. Hot was tuned on the rendered page before this
 * script, and its glow and detail columns are shown for comparison only (marked * when low): on Hot
 * no page text sits at the glow's centre, nor faint text at the very ends of the gradient.
 *
 * Run: node scripts/palette-contrast.mjs
 */
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../packages/core/src/config.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  write: false,
  logLevel: 'error',
});
const { PALETTES, RAIN_PALETTES, SNOW_PALETTES, WIND_PALETTES } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const MIN = 4.6;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** Source-over in sRGB, as browsers composite: `a` of `top` over `bottom`. */
const over = (top, a, bottom) => top.map((c, i) => c * a + bottom[i] * (1 - a));
const lum = (c) => {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** Text of colour `fg` at opacity `a` on `bg`, as the e2e test measures it. */
const text = (fg, bg, a = 1) => ratio(over(fg, a, bg), bg);

/**
 * The gradient under the glow's centre: 13% of the way from g1 to g2 on a phone, about 28% on a
 * desktop. Every point up to 35% is checked.
 */
const UNDER_GLOW = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35];

function check(p) {
  const [g1, g2, g3, ink, pill] = [p.g1, p.g2, p.g3, p.ink, p.pill].map(rgb);
  const glows = UNDER_GLOW.map((t) => over(g3, parseFloat(p.glow) / 100, over(g2, t, g1)));
  const controls = [g1, g2, ...glows].map((bg) => over(pill, 0.85, bg));
  return {
    g1: text(ink, g1),
    g2: text(ink, g2),
    glow: Math.min(...glows.map((bg) => text(ink, bg))),
    control: Math.min(...controls.map((bg) => text(ink, bg))),
    selected: text(pill, ink),
    units: Math.min(...controls.map((bg) => text(ink, bg, 0.85))),
    detail: Math.min(text(ink, g1, 0.9), text(ink, g2, 0.9)),
    sheet: Math.min(
      ...[pill, over(pill, 0.85, g2)].flatMap((bg) => [
        text(ink, bg, 0.9),
        text(ink, over(ink, 0.08, bg)),
      ]),
    ),
  };
}

/** Columns Hot is not held to (see above). */
const HOT_ADVISORY = new Set(['glow', 'detail']);

let failed = false;
let advisory = false;
for (const [topic, palettes] of [
  ['Hot', PALETTES],
  ['Wet', RAIN_PALETTES],
  ['Snow', SNOW_PALETTES],
  ['Wind', WIND_PALETTES],
]) {
  const keys = Object.keys(check(Object.values(palettes)[0]));
  console.log(`${topic.padEnd(10)}${keys.map((k) => k.padStart(9)).join('')}`);
  for (const [band, p] of Object.entries(palettes)) {
    const cells = Object.entries(check(p)).map(([key, v]) => {
      const held = topic !== 'Hot' || !HOT_ADVISORY.has(key);
      const mark = v >= MIN ? ' ' : held ? '!' : '*';
      failed ||= mark === '!';
      advisory ||= mark === '*';
      return `${mark}${v.toFixed(2)}`.padStart(9);
    });
    console.log(`${band.padEnd(10)}${cells.join('')}`);
  }
  console.log('');
}
if (advisory) console.log(`* under ${MIN}:1 where Hot places no text (for comparison).`);
if (failed) {
  console.log(`! under ${MIN}:1.`);
  process.exitCode = 1;
} else {
  console.log(`Every value held to ${MIN}:1 passes.`);
}
