import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { SNOW_GLYPHS } from '../../../apps/web/src/lib/snowGlyphs';
import {
  GLYPHS_DIR,
  GLYPHS_FALLBACK_DIR,
  GLYPH_ASSETS_PATH,
  glyphAssetsSwift,
  glyphElements,
  glyphFiles,
  glyphImageSets,
  glyphPng,
  glyphSvg,
} from '../src/exportGlyphs';
import { pngHeader } from '../src/png';
import { generatedHeader } from '../src/swift';

const text = (contents: string | Uint8Array) => contents as string;

describe('glyphElements', () => {
  it('splits a glyph at its top-level elements, in black, marking the ones that drift', () => {
    expect(
      glyphElements(
        '<path d="M1 2"/><g opacity=".85"><line x1="1"/><path d="M3 4"/></g>' +
          '<path class="drift" d="M5 6" fill="currentColor" fill-opacity=".2"/>',
      ),
    ).toEqual([
      { svg: '<path d="M1 2"/>', drift: false },
      { svg: '<g opacity=".85"><line x1="1"/><path d="M3 4"/></g>', drift: false },
      { svg: '<path d="M5 6" fill="#000" fill-opacity=".2"/>', drift: true },
    ]);
  });

  it('takes a group that drifts as one element, and closing tags written out', () => {
    expect(glyphElements('<g class="drift"><circle r="2"></circle></g><rect width="3"/>')).toEqual([
      { svg: '<g><circle r="2"></circle></g>', drift: true },
      { svg: '<rect width="3"/>', drift: false },
    ]);
  });

  it('refuses what a template image can’t draw as the website does', () => {
    const refused: [string, RegExp][] = [
      ['<path d="M1 2"/>flakes', /text outside the elements/],
      ['x<path d="M1 2"/>', /text outside the elements/],
      ['<text>Yes</text>', /<text> isn't a shape or a group/],
      ['<path stroke="#fff" d="M1 2"/>', /a template image has one colour/],
      ['<path fill="var(--g2)" d="M1 2"/>', /a template image has one colour/],
      ['<path opacity="var(--o)" d="M1 2"/>', /refers to something only the page has/],
      ['<path filter="url(#blur)" d="M1 2"/>', /refers to something only the page has/],
      ['<path class="spin" d="M1 2"/>', /class "spin" means nothing here/],
      ['<path style="stroke:#fff" d="M1 2"/>', /style could hide a colour/],
      ['<g><path class="drift" d="M1 2"/></g>', /only a top-level element can drift/],
      ['<g><path d="M1 2"/>', /never closed/],
      ['<path d="M1 2"/></g>', /closes nothing/],
      ['', /nothing to draw/],
    ];
    for (const [body, why] of refused) expect(() => glyphElements(body)).toThrow(why);
  });

  it('reads every snow glyph', () => {
    for (const body of Object.values(SNOW_GLYPHS)) {
      const elements = glyphElements(body);
      expect(elements.map((e) => e.svg).join('')).toBe(
        body.replaceAll(' class="drift"', '').replaceAll('currentColor', '#000'),
      );
    }
  });
});

describe('glyphSvg', () => {
  it('is a 120-point SVG, stroked as the website strokes its glyphs, in black', () => {
    expect(glyphSvg([{ svg: '<path d="M1 2"/>', drift: false }])).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">' +
        '<g fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M1 2"/></g></svg>\n',
    );
  });
});

describe('glyphImageSets', () => {
  const sets = glyphImageSets(SNOW_GLYPHS);

  it('has each band’s glyph, and the still and drift layers of each with flakes that drift', () => {
    expect(sets.map((s) => s.name)).toEqual([
      'nosnow',
      ...['flakes', 'flakes-still', 'flakes-drift'],
      ...['maybesnow', 'maybesnow-still', 'maybesnow-drift'],
      ...['snow', 'snow-still', 'snow-drift'],
      ...['heavysnow', 'heavysnow-still', 'heavysnow-drift'],
      ...['deepsnow', 'deepsnow-still', 'deepsnow-drift'],
    ]);
  });

  it('splits each glyph into layers that together draw the whole of it', () => {
    const body = (svg: string) => svg.replace(/^.*?<g [^>]*>/, '').replace(/<\/g><\/svg>\n$/, '');
    for (const [band, source] of Object.entries(SNOW_GLYPHS)) {
      const whole = sets.find((s) => s.name === band)!;
      const still = sets.find((s) => s.name === `${band}-still`);
      const drift = sets.find((s) => s.name === `${band}-drift`);
      const elements = glyphElements(source);
      expect(body(whole.svg)).toBe(elements.map((e) => e.svg).join(''));
      if (band === 'nosnow') {
        expect([still, drift]).toEqual([undefined, undefined]);
        continue;
      }
      // Each layer keeps its elements in the glyph's order. Between the layers the order doesn't
      // matter: in one colour, painting a over b covers what painting b over a does.
      const layer = (drifts: boolean) =>
        elements
          .filter((e) => e.drift === drifts)
          .map((e) => e.svg)
          .join('');
      expect(body(still!.svg)).toBe(layer(false));
      expect(body(drift!.svg)).toBe(layer(true));
      expect(layer(true)).not.toBe('');
      expect(layer(true)).not.toContain('<path d="M36 92h48');
    }
  });

  it('refuses a glyph that is nothing but drifting flakes', () => {
    expect(() => glyphImageSets({ flurry: '<path class="drift" d="M1 2"/>' })).toThrow(
      /nothing in it stays still/,
    );
  });
});

describe('glyphPng', () => {
  const svg = glyphImageSets(SNOW_GLYPHS).find((s) => s.name === 'snow')!.svg;

  it('renders 120, 240 and 360 pixels square for 1x, 2x and 3x, with an alpha channel', () => {
    for (const scale of [1, 2, 3]) {
      const header = pngHeader(glyphPng(svg, scale));
      expect([header.width, header.height, header.bitDepth, header.colourType]).toEqual([
        120 * scale,
        120 * scale,
        8,
        6,
      ]);
    }
  });

  it('draws in black on transparent, so a tint is all that colours it', () => {
    const png = PNG.sync.read(Buffer.from(glyphPng(svg, 2)));
    let drawn = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i + 3]! > 0) {
        drawn += 1;
        expect([png.data[i], png.data[i + 1], png.data[i + 2]]).toEqual([0, 0, 0]);
      }
    }
    expect(drawn).toBeGreaterThan(2000);
    expect(png.data[3]).toBe(0);
  });
});

describe('glyphAssetsSwift', () => {
  const swift = glyphAssetsSwift(glyphImageSets(SNOW_GLYPHS));

  it('names the glyphs and the ones that drift, under the header', () => {
    const lines = swift.split('\n');
    expect(lines[0]).toBe(generatedHeader('apps/web/src/lib/snowGlyphs.ts'));
    const list = (from: string) => {
      const start = lines.indexOf(`  static let ${from}: Set<String> = [`);
      return lines.slice(start + 1, lines.indexOf('  ]', start));
    };
    const bands = ['flakes', 'maybesnow', 'snow', 'heavysnow', 'deepsnow'];
    expect(list('names')).toEqual(['nosnow', ...bands].map((b) => `    "${b}",`));
    expect(list('drifting')).toEqual(bands.map((b) => `    "${b}",`));
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(100);
  });
});

describe('glyphFiles', () => {
  const files = glyphFiles(SNOW_GLYPHS);
  const byPath = new Map(files.map((f) => [f.path, f.contents]));
  const json = (path: string) => JSON.parse(text(byPath.get(path)!));

  it('writes both catalogues, each set in each, and GlyphAssets.swift', () => {
    const sets = glyphImageSets(SNOW_GLYPHS);
    expect(files.length).toBe(2 + sets.length * (2 + 4) + 1);
    expect(json(`${GLYPHS_DIR}/Contents.json`)).toEqual({ info: { author: 'xcode', version: 1 } });
    expect(json(`${GLYPHS_FALLBACK_DIR}/Contents.json`)).toEqual({
      info: { author: 'xcode', version: 1 },
    });
    for (const set of sets) {
      expect(byPath.get(`${GLYPHS_DIR}/${set.name}.imageset/${set.name}.svg`)).toBe(set.svg);
      for (const scale of [1, 2, 3]) {
        const png = byPath.get(
          `${GLYPHS_FALLBACK_DIR}/${set.name}.imageset/${set.name}@${scale}x.png`,
        );
        expect(png).toBeInstanceOf(Uint8Array);
      }
    }
    expect(byPath.get(GLYPH_ASSETS_PATH)).toBe(glyphAssetsSwift(sets));
  });

  it('marks the SVG sets as templates kept as vectors, and the PNG sets as templates', () => {
    expect(json(`${GLYPHS_DIR}/snow-drift.imageset/Contents.json`)).toEqual({
      images: [{ filename: 'snow-drift.svg', idiom: 'universal' }],
      info: { author: 'xcode', version: 1 },
      properties: {
        'preserves-vector-representation': true,
        'template-rendering-intent': 'template',
      },
    });
    expect(json(`${GLYPHS_FALLBACK_DIR}/snow-drift.imageset/Contents.json`)).toEqual({
      images: [1, 2, 3].map((s) => ({
        filename: `snow-drift@${s}x.png`,
        idiom: 'universal',
        scale: `${s}x`,
      })),
      info: { author: 'xcode', version: 1 },
      properties: { 'template-rendering-intent': 'template' },
    });
  });

  // Renders every PNG again: a second or two alone, more beside the whole suite.
  it('gives the same bytes every time', () => {
    const again = glyphFiles(SNOW_GLYPHS);
    expect(again.map((f) => f.path)).toEqual(files.map((f) => f.path));
    for (const [i, f] of again.entries()) {
      expect(Buffer.from(f.contents).equals(Buffer.from(files[i]!.contents))).toBe(true);
    }
  }, 120_000);
});
