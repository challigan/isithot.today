import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pngjs from 'pngjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULTS,
  FONT,
  blank,
  collect,
  composite,
  contactSheet,
  downscale,
  drawText,
  labelFor,
  layout,
  manifestLabels,
  textSize,
} from '../../apps/ios/ci/contact-sheet.mjs';

const { PNG } = pngjs;
const SCRIPT = new URL('../../apps/ios/ci/contact-sheet.mjs', import.meta.url).pathname;

/** A `width`×`height` image of one colour. */
function solid(width, height, [r, g, b, a = 255]) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([r, g, b, a], i);
  return png;
}
const pixel = (png, x, y) => [
  ...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4),
];

const folders = [];
function folder() {
  const dir = mkdtempSync(join(tmpdir(), 'contact-sheet-'));
  folders.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the font', () => {
  it('has 7 rows of 5 for every glyph', () => {
    for (const [ch, rows] of Object.entries(FONT)) {
      expect(rows, ch).toHaveLength(7);
      for (const row of rows) expect(row, ch).toMatch(/^[#.]{5}$/);
    }
  });

  it('has every character a test or attachment name uses', () => {
    for (const ch of 'abcdefghijklmnopqrstuvwxyz0123456789 -_.:/()?')
      expect(FONT[ch], ch).toBeDefined();
  });

  it('measures text: 6 pixels a character less the last gap, 7 tall, times the scale', () => {
    expect(textSize('abc', 1)).toEqual({ width: 17, height: 7 });
    expect(textSize('abc', 2)).toEqual({ width: 34, height: 14 });
    expect(textSize('', 2)).toEqual({ width: 0, height: 14 });
  });

  it('draws only where the glyph has pixels, in capitals, with "?" for what it lacks', () => {
    const png = blank(12, 7, [0, 0, 0]);
    drawText(png, '-', 0, 0, [255, 255, 255], 1);
    expect(pixel(png, 0, 3)).toEqual([255, 255, 255, 255]);
    expect(pixel(png, 4, 3)).toEqual([255, 255, 255, 255]);
    expect(pixel(png, 0, 2)).toEqual([0, 0, 0, 255]);

    const upper = blank(5, 7, [0, 0, 0]);
    const lower = blank(5, 7, [0, 0, 0]);
    drawText(upper, 'A', 0, 0, [255, 255, 255], 1);
    drawText(lower, 'a', 0, 0, [255, 255, 255], 1);
    expect(upper.data).toEqual(lower.data);

    const unknown = blank(5, 7, [0, 0, 0]);
    const question = blank(5, 7, [0, 0, 0]);
    drawText(unknown, '❄', 0, 0, [255, 255, 255], 1);
    drawText(question, '?', 0, 0, [255, 255, 255], 1);
    expect(unknown.data).toEqual(question.data);
  });

  it('clips text at the image’s edges', () => {
    const png = blank(3, 3, [0, 0, 0]);
    expect(() => drawText(png, 'wide text', -2, -2, [255, 0, 0], 2)).not.toThrow();
  });
});

describe('downscale', () => {
  it('averages the pixels each output pixel covers', () => {
    const png = solid(6, 6, [0, 0, 0]);
    // The top-left 3×3 block: one white pixel in nine.
    png.data.set([255, 255, 255, 255], 0);
    const out = downscale(png, 1 / 3);
    expect([out.width, out.height]).toEqual([2, 2]);
    expect(pixel(out, 0, 0)).toEqual([28, 28, 28, 255]);
    expect(pixel(out, 1, 1)).toEqual([0, 0, 0, 255]);
  });

  it('weights colour by alpha, so transparent pixels don’t darken an edge', () => {
    const png = solid(2, 1, [255, 0, 0]);
    png.data.set([0, 0, 0, 0], 4);
    const out = downscale(png, 1 / 2);
    expect(pixel(out, 0, 0)).toEqual([255, 0, 0, 128]);
    expect(pixel(downscale(solid(2, 2, [9, 9, 9, 0]), 1 / 2), 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('never scales up, and keeps at least one pixel', () => {
    const png = solid(4, 2, [1, 2, 3]);
    expect([downscale(png, 2).width, downscale(png, 2).height]).toEqual([4, 2]);
    expect([downscale(png, 0.01).width, downscale(png, 0.01).height]).toEqual([1, 1]);
  });
});

describe('composite', () => {
  it('blends by alpha, and skips what falls outside', () => {
    const dst = blank(2, 1, [0, 0, 255]);
    const src = solid(2, 1, [255, 0, 0, 255]);
    src.data.set([255, 0, 0, 0], 4);
    composite(dst, src, 0, 0);
    expect(pixel(dst, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(dst, 1, 0)).toEqual([0, 0, 255, 255]);
    expect(() => composite(dst, src, 1, 0)).not.toThrow();
  });
});

describe('layout', () => {
  it('fills rows left to right and wraps before passing the width', () => {
    const cells = [
      { width: 100, height: 50 },
      { width: 100, height: 80 },
      { width: 100, height: 10 },
    ];
    const { placed, width, height } = layout(cells, { maxWidth: 300, gap: 10 });
    expect(placed.map(({ x, y }) => [x, y])).toEqual([
      [10, 10],
      [120, 10],
      [10, 100],
    ]);
    expect(width).toBe(230);
    expect(height).toBe(120);
  });

  it('puts a cell wider than the sheet on a row of its own, and leaves room for a title', () => {
    const { placed } = layout(
      [
        { width: 50, height: 5 },
        { width: 500, height: 5 },
      ],
      { maxWidth: 100, gap: 10, top: 30 },
    );
    expect(placed.map(({ x, y }) => [x, y])).toEqual([
      [10, 40],
      [10, 55],
    ]);
    expect(layout([], { gap: 10 })).toEqual({ placed: [], width: 20, height: 20 });
  });
});

describe('names', () => {
  it('drops the extension and xcresulttool’s _<n>_<UUID>', () => {
    expect(labelFor('app-aberdeen-snow_0_6F1C2A3B-4D5E-4F60-8A7B-9C0D1E2F3A4B.png')).toBe(
      'app-aberdeen-snow',
    );
    expect(labelFor('widget_small_2_6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b.png')).toBe(
      'widget_small',
    );
    expect(labelFor('plain.png')).toBe('plain');
  });

  it('reads the labels from manifest.json, and copes without one or with a broken one', () => {
    const dir = folder();
    expect(manifestLabels(dir).size).toBe(0);
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify([
        {
          testIdentifier: 'T/a()',
          attachments: [
            {
              exportedFileName: 'A.png',
              suggestedHumanReadableName: 'app-x_0_6F1C2A3B-4D5E-4F60-8A7B-9C0D1E2F3A4B.png',
            },
            { exportedFileName: 'B.png' },
            {},
          ],
        },
        null,
      ]),
    );
    expect([...manifestLabels(dir)]).toEqual([
      ['A.png', 'app-x'],
      ['B.png', 'B'],
    ]);
    writeFileSync(join(dir, 'manifest.json'), '{ not json');
    expect(manifestLabels(dir).size).toBe(0);
  });

  it('collects every PNG, labelled and sorted, and skips other files and missing folders', () => {
    const dir = folder();
    mkdirSync(join(dir, 'deeper'));
    writeFileSync(join(dir, 'Z1.png'), PNG.sync.write(solid(1, 1, [0, 0, 0])));
    writeFileSync(join(dir, 'deeper', 'b.PNG'), PNG.sync.write(solid(1, 1, [0, 0, 0])));
    writeFileSync(join(dir, 'notes.txt'), 'not an image');
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify([
        {
          attachments: [{ exportedFileName: 'Z1.png', suggestedHumanReadableName: 'a-first.png' }],
        },
      ]),
    );
    expect(collect([dir, join(dir, 'missing')]).map((f) => [f.label, f.path])).toEqual([
      ['a-first', join(dir, 'Z1.png')],
      ['b', join(dir, 'deeper', 'b.PNG')],
    ]);
  });
});

describe('contactSheet', () => {
  it('draws each image at a third of its size, labelled, on the background', () => {
    const sheet = contactSheet(
      [
        { label: 'red', png: solid(30, 60, [255, 0, 0]) },
        { label: 'blue', png: solid(60, 60, [0, 0, 255, 128]) },
      ],
      { gap: 10, textScale: 1 },
    );
    // Cells: red 10×20 (its label is 17 wide), blue 20×20 (label 23 wide), each with a label under.
    expect(sheet.width).toBe(10 + 17 + 10 + 23 + 10);
    expect(sheet.height).toBe(10 + 20 + 5 + 7 + 10);
    expect(pixel(sheet, 10, 10)).toEqual([255, 0, 0, 255]);
    const half = 128 / 255;
    const over = [0, 0, 255].map((c, i) =>
      Math.round(c * half + DEFAULTS.background[i] * (1 - half)),
    );
    expect(pixel(sheet, 37, 10)).toEqual([...over, 255]);
    expect(pixel(sheet, 0, 0)).toEqual([...DEFAULTS.background, 255]);
    const label = [...Array(17).keys()].map((x) => pixel(sheet, 10 + x, 35 + 3));
    expect(label.some((p) => p[0] === DEFAULTS.ink[0])).toBe(true);
  });

  it('puts a title along the top', () => {
    const plain = contactSheet([{ label: 'a', png: solid(3, 3, [0, 0, 0]) }], {
      gap: 10,
      textScale: 1,
    });
    const titled = contactSheet([{ label: 'a', png: solid(3, 3, [0, 0, 0]) }], {
      gap: 10,
      textScale: 1,
      title: 'run 1',
    });
    expect(titled.height - plain.height).toBe(17);
  });
});

describe('the command', () => {
  it('writes the sheet, and says what it drew', () => {
    const dir = folder();
    writeFileSync(join(dir, 'A.png'), PNG.sync.write(solid(9, 9, [0, 255, 0])));
    writeFileSync(join(dir, 'broken.png'), 'not a png');
    const out = join(dir, 'sheet.png');
    const log = execFileSync('node', [SCRIPT, dir, '--out', out, '--title', 'run'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(log).toContain('contact-sheet: 1 images');
    const sheet = PNG.sync.read(readFileSync(out));
    expect(sheet.width).toBeGreaterThan(0);
  });

  it('fails without images, and explains its arguments', () => {
    const dir = folder();
    const run = (args) => {
      try {
        execFileSync('node', [SCRIPT, ...args], { stdio: 'pipe' });
        return 0;
      } catch (error) {
        return error.status;
      }
    };
    expect(run([dir, '--out', join(dir, 'x.png')])).toBe(1);
    expect(run([])).toBe(2);
  });
});
