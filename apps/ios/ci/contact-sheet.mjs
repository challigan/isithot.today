#!/usr/bin/env node
/**
 * The contact sheet (iOS build spec, section 18.1): every PNG the iOS tests attached, tiled into
 * one image with its name under it, so an agent or Carl sees a run's screens and widgets at a
 * glance. It reads the folders `xcresulttool export attachments` writes, taking the names from
 * their manifest.json when there is one. A review artefact, never a pixel gate.
 *
 *   node apps/ios/ci/contact-sheet.mjs <folder>... --out contact-sheet.png [--title <text>]
 *
 * The tests attach at 3x, so every image is drawn at a third of its size (true points, the same
 * scale for all, so a widget sits beside a screen at its real size), rows wrap at 2400 pixels,
 * and the labels use a 5×7 pixel font built in here, so no system font is needed.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import pngjs from 'pngjs';

const { PNG } = pngjs;

export const DEFAULTS = {
  scale: 1 / 3,
  maxWidth: 2400,
  gap: 24,
  /** The font's pixels are drawn this many pixels square. */
  textScale: 2,
  background: [0x1f, 0x23, 0x28],
  ink: [0xe6, 0xed, 0xf3],
};

// Each glyph is 7 rows of 5; letters are drawn as capitals.
const GLYPHS = {
  a: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  b: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  c: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  d: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  e: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  f: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  g: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  h: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  i: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  j: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  k: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  l: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  m: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  n: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  o: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  p: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  r: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  s: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  t: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  u: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  v: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  w: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  x: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  _: ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '/': ['.....', '....#', '...#.', '..#..', '.#...', '#....', '.....'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
};
export const FONT = Object.freeze(GLYPHS);

/** One glyph is 5 pixels and a gap wide, and 7 tall, before `textScale`. */
export function textSize(text, textScale = DEFAULTS.textScale) {
  return { width: Math.max(0, text.length * 6 - 1) * textScale, height: 7 * textScale };
}

/** Draws `text` into `png` with its top left at (x, y); a character it lacks is drawn as "?". */
export function drawText(png, text, x, y, color = DEFAULTS.ink, textScale = DEFAULTS.textScale) {
  [...text.toLowerCase()].forEach((ch, i) => {
    const glyph = GLYPHS[ch] ?? GLYPHS['?'];
    glyph.forEach((row, gy) => {
      [...row].forEach((bit, gx) => {
        if (bit !== '#') return;
        const left = x + (i * 6 + gx) * textScale;
        const top = y + gy * textScale;
        for (let dy = 0; dy < textScale; dy++) {
          for (let dx = 0; dx < textScale; dx++) setPixel(png, left + dx, top + dy, color);
        }
      });
    });
  });
}

function setPixel(png, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (y * png.width + x) * 4;
  png.data[i] = r;
  png.data[i + 1] = g;
  png.data[i + 2] = b;
  png.data[i + 3] = 255;
}

/** A blank image filled with `color`, opaque. */
export function blank(width, height, [r, g, b] = DEFAULTS.background) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 255;
  }
  return png;
}

/**
 * `png` resized by `scale`, never up: each pixel is the average of the source pixels it covers,
 * weighted by their alpha, so a transparent corner doesn't darken the edge it meets.
 */
export function downscale(png, scale) {
  const s = Math.min(1, scale);
  const width = Math.max(1, Math.round(png.width * s));
  const height = Math.max(1, Math.round(png.height * s));
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * png.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * png.height) / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * png.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * png.width) / width));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * png.width + sx) * 4;
          const alpha = png.data[i + 3];
          r += png.data[i] * alpha;
          g += png.data[i + 1] * alpha;
          b += png.data[i + 2] * alpha;
          a += alpha;
        }
      }
      const o = (y * width + x) * 4;
      const n = (y1 - y0) * (x1 - x0);
      out.data[o] = a ? Math.round(r / a) : 0;
      out.data[o + 1] = a ? Math.round(g / a) : 0;
      out.data[o + 2] = a ? Math.round(b / a) : 0;
      out.data[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/** Draws `src` onto `dst` with its top left at (x, y), over what is there. */
export function composite(dst, src, x, y) {
  for (let sy = 0; sy < src.height; sy++) {
    for (let sx = 0; sx < src.width; sx++) {
      const dx = x + sx;
      const dy = y + sy;
      if (dx < 0 || dy < 0 || dx >= dst.width || dy >= dst.height) continue;
      const s = (sy * src.width + sx) * 4;
      const d = (dy * dst.width + dx) * 4;
      const alpha = src.data[s + 3] / 255;
      for (let c = 0; c < 3; c++) {
        dst.data[d + c] = Math.round(src.data[s + c] * alpha + dst.data[d + c] * (1 - alpha));
      }
      dst.data[d + 3] = 255;
    }
  }
}

/**
 * Where each cell goes: left to right, wrapping before a cell would pass `maxWidth`, each row as
 * tall as its tallest cell. Cells are `{ width, height }`; the result adds `x` and `y`, and the
 * whole sheet's size.
 */
export function layout(cells, { maxWidth = DEFAULTS.maxWidth, gap = DEFAULTS.gap, top = 0 } = {}) {
  const placed = [];
  let x = gap;
  let y = top + gap;
  let rowHeight = 0;
  let width = 0;
  for (const cell of cells) {
    if (x > gap && x + cell.width + gap > maxWidth) {
      x = gap;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    placed.push({ ...cell, x, y });
    x += cell.width + gap;
    width = Math.max(width, x);
    rowHeight = Math.max(rowHeight, cell.height);
  }
  return { placed, width: Math.max(width, gap * 2), height: y + rowHeight + gap };
}

/**
 * An attachment's name without what xcresulttool adds: the extension, and an `_<n>_<UUID>`
 * suffix ("app-aberdeen-snow_0_6F1C…-….png" is "app-aberdeen-snow").
 */
export function labelFor(name) {
  return basename(name, extname(name)).replace(/_\d+_[0-9A-Fa-f-]{36}$/, '');
}

/** File name → label, from a folder's manifest.json, when it has one. */
export function manifestLabels(folder) {
  const labels = new Map();
  const path = join(folder, 'manifest.json');
  if (!existsSync(path)) return labels;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return labels;
  }
  for (const test of Array.isArray(manifest) ? manifest : []) {
    for (const a of test?.attachments ?? []) {
      if (a?.exportedFileName) {
        labels.set(
          a.exportedFileName,
          labelFor(a.suggestedHumanReadableName ?? a.exportedFileName),
        );
      }
    }
  }
  return labels;
}

/** Every PNG under the folders, with its label, sorted by label (then path). */
export function collect(folders) {
  const found = [];
  for (const folder of folders) {
    if (!existsSync(folder)) continue;
    const labels = manifestLabels(folder);
    const files = readdirSync(folder, { recursive: true }).map(String).sort();
    for (const file of files) {
      if (extname(file).toLowerCase() !== '.png') continue;
      const path = join(folder, file);
      found.push({ path, label: labels.get(file) ?? labelFor(relative(folder, path)) });
    }
  }
  return found.sort((a, b) => a.label.localeCompare(b.label) || a.path.localeCompare(b.path));
}

/**
 * The sheet: each image scaled by `scale`, its label under it, wrapped into rows, with an
 * optional title along the top.
 */
export function contactSheet(images, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const line = textSize('x', o.textScale).height;
  const top = o.title ? o.gap + line : 0;
  const tiles = images.map(({ label, png }) => {
    const image = downscale(png, o.scale);
    const text = textSize(label, o.textScale);
    return {
      label,
      image,
      width: Math.max(image.width, text.width),
      height: image.height + o.gap / 2 + text.height,
    };
  });
  const { placed, width, height } = layout(tiles, { maxWidth: o.maxWidth, gap: o.gap, top });
  const sheet = blank(width, height, o.background);
  if (o.title) drawText(sheet, o.title, o.gap, o.gap, o.ink, o.textScale);
  for (const tile of placed) {
    composite(sheet, tile.image, tile.x, tile.y);
    drawText(sheet, tile.label, tile.x, tile.y + tile.image.height + o.gap / 2, o.ink, o.textScale);
  }
  return sheet;
}

function main(argv) {
  const folders = [];
  let out = null;
  let title = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i];
    else if (argv[i] === '--title') title = argv[++i] ?? '';
    else folders.push(argv[i]);
  }
  if (!out || !folders.length) {
    console.error('usage: contact-sheet.mjs <folder>... --out <file.png> [--title <text>]');
    return 2;
  }
  const found = collect(folders);
  if (!found.length) {
    console.error(`contact-sheet: no PNG attachments in ${folders.join(', ')}`);
    return 1;
  }
  const images = [];
  for (const { path, label } of found) {
    try {
      images.push({ label, png: PNG.sync.read(readFileSync(path)) });
    } catch (error) {
      console.error(`contact-sheet: skipped ${path}: ${error.message}`);
    }
  }
  if (!images.length) return 1;
  const sheet = contactSheet(images, { title });
  writeFileSync(out, PNG.sync.write(sheet));
  console.log(`contact-sheet: ${images.length} images, ${sheet.width}×${sheet.height}, in ${out}`);
  for (const { label } of images) console.log(`  ${label}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
