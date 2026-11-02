import pngjs from 'pngjs';
import { describe, expect, it } from 'vitest';
import {
  ACROSS,
  BAND,
  BLOCK,
  banner,
  decodePng,
  describe as say,
  difference,
  main,
  sayBanner,
} from '../../apps/ios/ci/banner.mjs';

const { PNG } = pngjs;

/** A `width`×`height` PNG, each pixel `paint(x, y)` (RGB), as RGBA or as RGB. */
function png(width, height, paint, colorType = 6) {
  const image = new PNG({ width, height, colorType, inputColorType: 6 });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) image.data.set([...paint(x, y), 255], (y * width + x) * 4);
  }
  return PNG.sync.write(image, { colorType, inputColorType: 6 });
}

// A screen with something in every row, so pngjs picks each of the five filters somewhere.
const busy = (x, y) => [(x * 7 + y * 3) % 256, (x * y) % 256, (255 - y * 5) % 256];
const plain = () => [40, 60, 120];
const white = [250, 250, 250];

describe('decodePng', () => {
  it('reads RGBA and RGB screenshots as pngjs does, whatever filter each row has', () => {
    for (const colorType of [6, 2]) {
      const bytes = png(37, 41, busy, colorType);
      const mine = decodePng(bytes);
      const theirs = PNG.sync.read(bytes);
      expect([mine.width, mine.height]).toEqual([37, 41]);
      expect(Buffer.compare(mine.data, theirs.data)).toBe(0);
    }
  });

  it('refuses what simctl never writes', () => {
    expect(() => decodePng(Buffer.from('GIF89a'))).toThrow('not a PNG');
    const grey = new PNG({ width: 2, height: 2, colorType: 0, inputColorType: 6 });
    expect(() => decodePng(PNG.sync.write(grey, { colorType: 0, inputColorType: 6 }))).toThrow(
      'colour type 0',
    );
  });
});

// A 20 by 100 screen: the band is rows 0 to 24, and a banner is a block of at least 5 rows each
// changed in at least 16 of the 20 columns, ending above row 24.
const [W, H] = [20, 100];
const base = decodePng(png(W, H, plain));
/** The plain screen with each box, [top, bottom, left, right], painted white. */
const painted = (...boxes) =>
  decodePng(
    png(W, H, (x, y) =>
      boxes.some(
        ([top, bottom, left = 0, right = W - 1]) =>
          y >= top && y <= bottom && x >= left && x <= right,
      )
        ? white
        : plain(),
    ),
  );

describe('difference', () => {
  it('is nothing for the same screen', () => {
    expect(difference(base, decodePng(png(W, H, plain)))).toBeNull();
    expect(say(null, 'the baseline')).toBe('the same as the baseline');
  });

  it('says where a change lies, over the whole screen or in the rows above the one asked for', () => {
    const change = difference(base, painted([3, 20], [60, 70, 2, 5]));
    expect(change).toEqual({ top: 3, bottom: 70, left: 0, right: 19, pixels: 404 });
    expect(say(change, 'the baseline')).toBe(
      '404 pixels unlike the baseline, rows 3 to 70, columns 0 to 19',
    );
    expect(difference(base, painted([60, 70, 2, 5]), 25)).toBeNull();
    expect(difference(base, painted([3, 20], [60, 70, 2, 5]), 25)).toMatchObject({
      bottom: 20,
      pixels: 360,
    });
  });

  it('takes a screen of another size as changed all over', () => {
    const other = decodePng(png(W, H + 1, plain));
    expect(difference(base, other)).toMatchObject({ pixels: -1 });
    expect(say(difference(base, other), 'the baseline')).toBe(
      'a screen of another size than the baseline',
    );
  });
});

describe('banner', () => {
  it('is a block of rows changed across the width within the band, ending above its foot', () => {
    expect([BAND, ACROSS, BLOCK]).toEqual([0.25, 0.8, 0.05]);
    const seen = banner(base, painted([3, 20]));
    expect(seen).toMatchObject({ held: true, block: [3, 20], below: 0 });
    expect(sayBanner(seen)).toBe(
      "a banner: rows 3 to 20 changed across the width, within the banner's band (rows 0 to 24)",
    );
  });

  it('is seen over the app however the page redraws below the band, which it names', () => {
    const seen = banner(base, painted([3, 20], [60, 70, 2, 5], [80, 80]));
    expect(seen).toMatchObject({ held: true, block: [3, 20], below: 64 });
    expect(sayBanner(seen)).toMatch(/^a banner: rows 3 to 20 .*; and 64 pixels below the band$/);
  });

  it('is never a screen dimmed or changed all over, as by an alert or SpringBoard restarting', () => {
    const dimmed = banner(base, decodePng(png(W, H, () => [20, 30, 60])));
    expect(dimmed).toMatchObject({ held: false, block: [0, 24], below: 1500 });
    expect(sayBanner(dimmed)).toBe(
      "no banner: rows 0 to 24 changed across the width down to the band's foot, as a screen " +
        'dimmed or redrawn all over is; and 1500 pixels below the band',
    );
    const other = banner(base, decodePng(png(W, H + 1, plain)));
    expect(other.held).toBe(false);
    expect(sayBanner(other)).toBe('no banner: a screen of another size than the baseline');
  });

  it('is never a change in the status bar alone, nor in a row of icons', () => {
    const bar = banner(base, painted([0, 2, 14, 19]));
    expect(bar).toMatchObject({ held: false, block: null });
    expect(sayBanner(bar)).toBe(
      'no banner: nothing in the band changed across the width (18 pixels unlike the ' +
        'baseline, rows 0 to 2, columns 14 to 19)',
    );
    const icons = banner(base, painted([8, 14, 1, 4], [8, 14, 7, 10], [8, 14, 13, 16]));
    expect(icons).toMatchObject({ held: false, block: null });
  });

  it('is never a strip too thin to be one', () => {
    const thin = banner(base, painted([10, 13]));
    expect(thin).toMatchObject({ held: false, block: [10, 13] });
    expect(sayBanner(thin)).toBe(
      'no banner: rows 10 to 13 changed across the width, 4 rows, fewer than the 5 a banner takes',
    );
  });

  it('is nothing when the band is as it was', () => {
    const read = banner(base, painted([60, 70]));
    expect(read).toMatchObject({ held: false, block: null, below: 220 });
    expect(sayBanner(read)).toBe(
      'no banner: the band the same as the baseline; and 220 pixels below the band',
    );
  });
});

describe('the command line', () => {
  it('asks for a deadline, and for push, its five operands and a deadline for the going', () => {
    expect(main(['line', 'file', 'prefix'])).toBe(2);
    expect(main(['push', 'u', 'b', 'p', 'base', 'out', '--gone', '40'])).toBe(2);
    expect(main(['push', 'u', 'b', 'p', 'base', '--within', '20'])).toBe(2);
    expect(main(['push', 'u', 'b', 'p', 'base', 'out', '--within', '20', '--gone', 'x'])).toBe(2);
    expect(main(['settle', 'u', 'out'])).toBe(2);
    expect(main(['look', 'u', 'out', '--within', '20'])).toBe(2);
  });
});
