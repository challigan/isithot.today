import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import {
  APP_ICON_DIR,
  ASSETS_DIR,
  ICON_SIZE,
  iconFiles,
  iconPng,
  iconSvg,
  mix,
} from '../src/exportIcon';
import { encodePng, pngHeader, render } from '../src/png';

const FAVICON = readFileSync(
  new URL('../../../apps/web/public/snow/favicon.svg', import.meta.url),
  'utf8',
);

describe('mix', () => {
  it('takes a colour part of the way to another', () => {
    expect(mix('#9a5cc4', '#000000', 0)).toBe('#9a5cc4');
    expect(mix('#9a5cc4', '#000000', 1)).toBe('#000000');
    expect(mix('#9a5cc4', '#ffffff', 0.5)).toBe('#cdaee2');
    expect(mix('#5a2580', '#000000', 0.75)).toBe('#170920');
  });
});

describe('iconSvg', () => {
  it('any: the favicon full bleed, its corners square', () => {
    const svg = iconSvg(FAVICON, 'any');
    expect(svg).toBe(FAVICON.replace(' rx="26"', ''));
  });

  it('dark: the gradient mostly black, and the flake a light tint of its top colour', () => {
    const svg = iconSvg(FAVICON, 'dark');
    expect(svg).toContain('<stop offset="0" stop-color="#271731"/>');
    expect(svg).toContain('<stop offset="1" stop-color="#170920"/>');
    expect(svg).toContain('stroke="#cdaee2"');
    expect(svg).not.toContain('#9a5cc4');
    expect(svg).not.toContain('stroke="#fff"');
    expect(svg).not.toContain(' rx=');
  });

  it('tinted: a white flake on black', () => {
    const svg = iconSvg(FAVICON, 'tinted');
    expect(svg).toContain('<rect width="120" height="120" fill="#000"/>');
    expect(svg).toContain('stroke="#fff"');
  });

  it('refuses a favicon shaped otherwise, rather than drawing the wrong icon', () => {
    const broken: [string, RegExp][] = [
      [FAVICON.replace('viewBox="0 0 120 120"', 'viewBox="0 0 24 24"'), /120×120 view box/],
      [FAVICON.replace(/<rect [^>]*\/>/, ''), /one background rectangle, found 0/],
      [FAVICON.replace('<rect ', '<rect width="1" height="1"/><rect '), /found 2/],
      [
        FAVICON.replace('width="120" height="120" rx', 'width="100" height="120" rx'),
        /fill the view box/,
      ],
      [FAVICON.replace('fill="url(#g)"', 'fill="#fff"'), /fill the view box with the gradient/],
      [FAVICON.replace(/stop-color="#[0-9a-f]{6}"/g, 'stop-color="purple"'), /#rrggbb stops/],
      [FAVICON.replace('stroke="#fff"', 'stroke="#eee"'), /one flake stroked in white/],
    ];
    for (const [svg, why] of broken) expect(() => iconSvg(svg, 'any')).toThrow(why);
  });
});

describe('iconPng', () => {
  it('is 1024×1024, 8-bit RGB with no alpha channel and no transparency chunk', () => {
    const header = pngHeader(iconPng(iconSvg(FAVICON, 'any')));
    expect(header).toEqual({
      width: 1024,
      height: 1024,
      bitDepth: 8,
      colourType: 2,
      chunks: ['IHDR', 'IDAT', 'IEND'],
    });
  });

  it('fills the square: the corners are the gradient’s, not cut away', () => {
    const png = PNG.sync.read(Buffer.from(iconPng(iconSvg(FAVICON, 'any'))));
    expect([...png.data.subarray(0, 4)]).toEqual([0x9a, 0x5c, 0xc4, 255]);
    const last = png.data.length - 4;
    // The far corner is near the gradient's bottom colour, #5a2580.
    const [r, g, b] = png.data.subarray(last, last + 3);
    expect(Math.abs(r! - 0x5a) + Math.abs(g! - 0x25) + Math.abs(b! - 0x80)).toBeLessThan(24);
  });

  it('refuses an icon with transparent pixels, such as the favicon’s rounded corners', () => {
    expect(() => iconPng(FAVICON)).toThrow(/transparent pixels/);
  });

  it('refuses an icon that isn’t square', () => {
    const wide = FAVICON.replace('viewBox="0 0 120 120"', 'viewBox="0 0 120 60"');
    expect(() => iconPng(wide)).toThrow(/should be 1024×1024, not 1024×512/);
  });
});

describe('iconFiles', () => {
  const files = iconFiles(FAVICON);
  const byPath = new Map(files.map((f) => [f.path, f.contents]));

  it('writes the catalogue’s Contents.json and the AppIcon set: any, dark and tinted', () => {
    expect(files.map((f) => f.path)).toEqual([
      `${ASSETS_DIR}/Contents.json`,
      `${APP_ICON_DIR}/Contents.json`,
      `${APP_ICON_DIR}/any.png`,
      `${APP_ICON_DIR}/dark.png`,
      `${APP_ICON_DIR}/tinted.png`,
    ]);
    expect(APP_ICON_DIR).toBe('apps/ios/Apps/Snow/Resources/Assets.xcassets/AppIcon.appiconset');
    expect(JSON.parse(byPath.get(`${ASSETS_DIR}/Contents.json`) as string)).toEqual({
      info: { author: 'xcode', version: 1 },
    });
    const size = `${ICON_SIZE}x${ICON_SIZE}`;
    expect(JSON.parse(byPath.get(`${APP_ICON_DIR}/Contents.json`) as string)).toEqual({
      images: [
        { filename: 'any.png', idiom: 'universal', platform: 'ios', size },
        {
          appearances: [{ appearance: 'luminosity', value: 'dark' }],
          filename: 'dark.png',
          idiom: 'universal',
          platform: 'ios',
          size,
        },
        {
          appearances: [{ appearance: 'luminosity', value: 'tinted' }],
          filename: 'tinted.png',
          idiom: 'universal',
          platform: 'ios',
          size,
        },
      ],
      info: { author: 'xcode', version: 1 },
    });
  });

  it('writes each PNG without an alpha channel', () => {
    for (const variant of ['any', 'dark', 'tinted']) {
      const header = pngHeader(byPath.get(`${APP_ICON_DIR}/${variant}.png`) as Uint8Array);
      expect([header.width, header.height, header.colourType]).toEqual([1024, 1024, 2]);
      expect(header.chunks).not.toContain('tRNS');
    }
  });

  // Renders every PNG again: a second or two alone, more beside the whole suite.
  it('gives the same bytes every time', () => {
    const again = iconFiles(FAVICON);
    for (const [i, f] of again.entries()) {
      expect(Buffer.from(f.contents).equals(Buffer.from(files[i]!.contents))).toBe(true);
    }
  }, 120_000);
});

describe('encodePng and pngHeader', () => {
  it('keep the alpha channel when asked, and refuse to drop it from a transparent image', () => {
    const image = render(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="1" height="2"/></svg>',
      2,
    );
    expect(pngHeader(encodePng(image, true)).colourType).toBe(6);
    expect(() => encodePng(image, false)).toThrow(/needs its alpha channel/);
  });

  it('refuse what isn’t a PNG', () => {
    expect(() => pngHeader(new Uint8Array(40))).toThrow(/Not a PNG/);
    const notHeaderFirst = new Uint8Array(40);
    notHeaderFirst.set([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x44, 0x41, 0x54,
    ]);
    expect(() => pngHeader(notHeaderFirst)).toThrow(/Not a PNG/);
  });
});
