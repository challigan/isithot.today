/**
 * The app's three surfaces and their tokens (DECISIONS, "The iPhone app in the website's look"):
 * every pair they make, on every band and on the content palette, at its worst point on the
 * screen, pinned to the figure the design measured (rounded down to one decimal), so a palette
 * or share change can't pass quietly, and every text pair at WCAG AA. The two website values the
 * app leaves out are pinned below 4.5:1, which is why.
 */
import { SNOW_PALETTES, type Palette, type SnowBand } from '@isithot/core';
import { describe, expect, it } from 'vitest';
import {
  BACKGROUND,
  BACKGROUND_MODEL,
  BRAND_COLOURS_PATH,
  BRAND_COLOURS_SOURCE,
  BRAND_SHARES,
  CONTENT_PALETTE,
  SCREEN,
  SURFACES,
  SURFACES_PATH,
  SURFACE_SAMPLES,
  UNUSED_SHARES,
  bandPairs,
  brandColoursSwift,
  card,
  colour,
  contentPairs,
  contrast,
  hex,
  luminance,
  mix,
  over,
  pageAt,
  sheetAt,
  surfaceAt,
  surfacePalettes,
  surfaceTextPairs,
  surfacesJson,
  unusedPairs,
  worst,
  type BandPairs,
  type ContentPairs,
  type Rgb,
  type Surface,
} from '../src/brandColours';
import { UI_TESTS_GENERATED_DIR } from '../src/exportHomeScreens';
import {
  BODY_TEXT_CONTRAST,
  CONTENT_BAND,
  UNKNOWN_BAND_DRAWS_AS,
  opacity,
} from '../src/exportPalettes';
import { generatedHeader } from '../src/swift';

/** A ratio rounded down to one decimal, as the design's floors are. */
const floor = (ratio: number) => Math.floor(ratio * 10 + 1e-9) / 10;

/**
 * The design's table (DESIGN.md section 1.3), each figure rounded down to one decimal, but for
 * ink on a chip: the chip is opaque `pill` since PR #34's macOS runs, so that pair is `pill` on
 * ink.
 */
const BAND_FLOORS: Record<SnowBand, BandPairs> = {
  nosnow: pairs(10.0, 13.6, 13.6, 13.0, 8.5, 10.3, 7.1, 7.6, 3.4),
  flakes: pairs(8.2, 13.1, 13.1, 12.3, 8.3, 9.8, 6.9, 7.3, 3.4),
  maybesnow: pairs(4.8, 8.9, 8.9, 8.9, 7.0, 6.4, 5.1, 5.7, 3.9),
  snow: pairs(4.8, 11.5, 11.5, 11.5, 8.7, 8.2, 6.4, 7.1, 4.6),
  heavysnow: pairs(6.1, 15.4, 15.4, 15.4, 11.3, 10.9, 8.4, 9.4, 5.5),
  deepsnow: pairs(6.1, 19.0, 19.0, 19.0, 13.8, 13.9, 10.5, 11.7, 6.2),
};

function pairs(...ratios: number[]): BandPairs {
  const [inkOnPage, inkOnChip, pillOnInk, inkOnSheet, softOnSheet, inkOnWash] = ratios;
  const [softOnPressedRow, placeholderOnField, fieldBorder] = ratios.slice(6);
  return {
    inkOnPage: inkOnPage!,
    inkOnChip: inkOnChip!,
    pillOnInk: pillOnInk!,
    inkOnSheet: inkOnSheet!,
    softOnSheet: softOnSheet!,
    inkOnWash: inkOnWash!,
    softOnPressedRow: softOnPressedRow!,
    placeholderOnField: placeholderOnField!,
    fieldBorder: fieldBorder!,
  };
}

const CONTENT_FLOORS: ContentPairs = {
  inkOnPage: 4.8,
  inkOnPageIncreased: 7.3,
  inkOnCard: 14.2,
  softOnCard: 10.6,
  inkOnWash: 10.0,
  softOnPressedRow: 7.7,
  pillOnInk: 11.5,
  hairlineOnCard: 1.9,
};

const bands = Object.entries(SNOW_PALETTES) as [SnowBand, Palette][];

describe('the pairs on every band', () => {
  it.each(bands)('%s: each is the figure the design measured', (band, palette) => {
    const measured = bandPairs(palette);
    const floored = Object.fromEntries(
      Object.entries(measured).map(([pair, ratio]) => [pair, floor(ratio)]),
    );
    expect(floored).toEqual(BAND_FLOORS[band]);
  });

  it.each(bands)('%s: every text pair meets AA, and the search box’s edge 3:1', (_, palette) => {
    const { fieldBorder, ...text } = bandPairs(palette);
    for (const [pair, ratio] of Object.entries(text)) {
      expect(ratio, pair).toBeGreaterThanOrEqual(BODY_TEXT_CONTRAST);
    }
    expect(fieldBorder).toBeGreaterThanOrEqual(3);
  });

  it.each(bands)('%s: a chip is flat, opaque `pill`, with no gradient through it', (_, p) => {
    expect(BRAND_SHARES.chip).toBe(1);
    const { inkOnChip, pillOnInk } = bandPairs(p);
    expect(inkOnChip).toBe(pillOnInk);
  });

  it('puts the page’s worst points under the glow on the two mid bands, where words sit on chips', () => {
    for (const band of ['maybesnow', 'snow'] as const) {
      const p = SNOW_PALETTES[band];
      const { inkOnPage, inkOnChip } = bandPairs(p);
      expect(inkOnPage).toBeLessThan(5);
      expect(inkOnChip).toBeGreaterThan(8);
      // At the glow's centre (354, 52), the status bar and the top bar's right end.
      const centre = contrast(colour(p.ink), pageAt(p, 0.88 * SCREEN.width, 0.06 * SCREEN.height));
      expect(ratioOf(centre)).toBeLessThanOrEqual(inkOnPage + 0.01);
    }
  });
});

/** A ratio rounded down to two decimals. */
const ratioOf = (ratio: number) => Math.floor(ratio * 100 + 1e-9) / 100;

describe('the content surface', () => {
  it('is the website’s content palette, snow’s, with the plum card', () => {
    expect(CONTENT_BAND).toBe('snow');
    expect(CONTENT_PALETTE).toBe(SNOW_PALETTES.snow);
    expect(hex(card(CONTENT_PALETTE))).toBe('#401a4f');
  });

  it('makes each pair the design measured, every text pair at AA', () => {
    const measured = contentPairs();
    const floored = Object.fromEntries(
      Object.entries(measured).map(([pair, ratio]) => [pair, floor(ratio)]),
    );
    expect(floored).toEqual(CONTENT_FLOORS);
    const { hairlineOnCard, ...text } = measured;
    for (const [pair, ratio] of Object.entries(text)) {
      expect(ratio, pair).toBeGreaterThanOrEqual(BODY_TEXT_CONTRAST);
    }
    // Decorative: the rows' words carry the structure.
    expect(hairlineOnCard).toBeLessThan(3);
    expect(contentPairs(CONTENT_PALETTE)).toEqual(measured);
  });
});

describe('the website’s values the app leaves out', () => {
  it('fall short of 4.5:1: ink at 10% as a page button, ink at 85% and 90% on the gradient', () => {
    expect(UNUSED_SHARES).toEqual({ pageButton: 0.1, pageSoft: 0.85, pageDetail: 0.9 });
    const maybe = unusedPairs(SNOW_PALETTES.maybesnow);
    expect(floor(maybe.inkOnPageButton)).toBe(4.0);
    expect(maybe.inkOnPageButton).toBeLessThan(BODY_TEXT_CONTRAST);
    const content = unusedPairs(CONTENT_PALETTE);
    expect(floor(content.softOnPage)).toBe(4.0);
    expect(content.softOnPage).toBeLessThan(BODY_TEXT_CONTRAST);
    const snow = unusedPairs(SNOW_PALETTES.snow);
    expect(floor(snow.detailOnPage)).toBe(4.3);
    expect(snow.detailOnPage).toBeLessThan(BODY_TEXT_CONTRAST);
  });

  it('pass on the pale bands, which is why only the darker ones decide', () => {
    const { inkOnPageButton, softOnPage, detailOnPage } = unusedPairs(SNOW_PALETTES.nosnow);
    for (const ratio of [inkOnPageButton, softOnPage, detailOnPage]) {
      expect(ratio).toBeGreaterThan(BODY_TEXT_CONTRAST);
    }
  });
});

describe('the background models', () => {
  const p = SNOW_PALETTES.snow;

  it('draw the page’s gradient from g1 at the top left to g2 at the bottom right, under the glow', () => {
    expect(hex(pageAt(p, 0, 0, false))).toBe(p.g1);
    expect(hex(pageAt(p, SCREEN.width, SCREEN.height, false))).toBe(p.g2);
    // The glow fades out well before the foot of the screen.
    expect(pageAt(p, 0, SCREEN.height)).toEqual(pageAt(p, 0, SCREEN.height, false));
    // At its centre it is g3 at the glow's opacity over the gradient.
    const [cx, cy] = [0.88 * SCREEN.width, 0.06 * SCREEN.height];
    expect(pageAt(p, cx, cy)).toEqual(mix(pageAt(p, cx, cy, false), colour(p.g3), 0.2));
  });

  it('draw the sheet from pill to pill with 15% of g2, with no glow', () => {
    expect(hex(sheetAt(p, 0, 0))).toBe(p.pill);
    expect(sheetAt(p, SCREEN.width, SCREEN.height)).toEqual(
      mix(colour(p.pill), colour(p.g2), BRAND_SHARES.sheetEnd),
    );
    // Nothing of g3, at the glow's centre or anywhere.
    const noGlow = { ...p, g3: '#000000', glow: '100%' };
    expect(sheetAt(noGlow, SCREEN.width * 0.88, SCREEN.height * 0.06)).toEqual(
      sheetAt(p, SCREEN.width * 0.88, SCREEN.height * 0.06),
    );
  });

  it('move a card away from the ink: toward black under white ink, toward white under dark', () => {
    expect(hex(card(SNOW_PALETTES.snow))).toBe('#401a4f');
    expect(hex(card(SNOW_PALETTES.nosnow))).toBe('#f8f2fb');
    expect(luminance(card(SNOW_PALETTES.nosnow))).toBeGreaterThan(
      luminance(colour(SNOW_PALETTES.nosnow.pill)),
    );
  });
});

describe('the surfaces the UI tests’ contrast proof reads', () => {
  const sheetP = SNOW_PALETTES.maybesnow;

  it('name the background models’ numbers, which the page draws by', () => {
    expect(BACKGROUND_MODEL).toEqual({
      from: [0.4, 0],
      to: [0.6, 1],
      glowCentre: [0.88, 0.06],
      glowReach: 0.52,
    });
    // The points the Linux harness checks the UI tests' Swift at: a place nearby on no snow, and
    // "Use my location" under the glow on snow.
    expect(hex(pageAt(SNOW_PALETTES.nosnow, 139.33, 712.67))).toBe('#e5d0eb');
    expect(hex(pageAt(SNOW_PALETTES.snow, 245, 134))).toBe('#85529a');
  });

  it('lay each fill, text colour and mark as the tokens do, over the background models', () => {
    for (const [, p] of bands) {
      const [ink, pill] = [colour(p.ink), colour(p.pill)];
      const page = surfaceAt(SURFACES.page, p, 120, 300);
      expect(page.fills).toEqual({
        [BACKGROUND]: pageAt(p, 120, 300),
        chip: over(pill, BRAND_SHARES.chip, pageAt(p, 120, 300)),
      });
      expect(page.texts).toEqual({ 'ink/background': ink, 'ink/chip': ink });
      expect(page.marks).toEqual({ 'border/chip': over(ink, BRAND_SHARES.border, pill) });
      const sheet = surfaceAt(SURFACES.sheet, p, 120, 300);
      const under = sheetAt(p, 120, 300);
      const wash = over(ink, BRAND_SHARES.wash, under);
      const field = over(ink, BRAND_SHARES.field, under);
      expect(sheet.fills).toEqual({ [BACKGROUND]: under, wash, field });
      expect(sheet.texts).toEqual({
        'ink/background': ink,
        'ink/wash': ink,
        'ink/field': ink,
        'soft/background': over(ink, BRAND_SHARES.soft, under),
        'soft/wash': over(ink, BRAND_SHARES.soft, wash),
        'soft/field': over(ink, BRAND_SHARES.soft, field),
      });
      expect(sheet.marks).toEqual({ 'border/wash': over(ink, BRAND_SHARES.border, wash) });
    }
    const p = CONTENT_PALETTE;
    const content = surfaceAt(SURFACES.content, p, 30, 600);
    const [ink, plum] = [colour(p.ink), card(p)];
    const track = over(ink, BRAND_SHARES.wash, plum);
    expect(content.fills).toEqual({ [BACKGROUND]: pageAt(p, 30, 600), card: plum, track });
    expect(content.texts).toEqual({
      'ink/background': ink,
      'ink/card': ink,
      'ink/track': ink,
      'soft/card': over(ink, BRAND_SHARES.soft, plum),
      'soft/track': over(ink, BRAND_SHARES.soft, track),
    });
    expect(content.marks).toEqual({
      'hairline/card': over(ink, BRAND_SHARES.hairline, plum),
      'affordance/card': over(ink, BRAND_SHARES.affordance, plum),
    });
  });

  it('allow soft text only on flat fills, never on a page’s gradient', () => {
    for (const s of [SURFACES.page, SURFACES.content]) {
      const soft = s.texts.find((t) => t.name === 'soft');
      expect(soft?.on ?? []).not.toContain(BACKGROUND);
    }
    expect(SURFACES.content.band).toBe(CONTENT_BAND);
    expect(SURFACES.page.band).toBeNull();
    expect(SURFACES.sheet.band).toBeNull();
  });

  it('throw for a fill over, or ink on, a fill not yet laid', () => {
    const before: Surface = {
      ...SURFACES.sheet,
      fills: [{ name: 'late', colour: '#123456', share: 1, over: 'early' }],
    };
    expect(() => surfaceAt(before, sheetP, 0, 0)).toThrow(/No fill early before it/);
    const nowhere: Surface = { ...SURFACES.page, texts: [{ name: 'ink', share: 1, on: ['card'] }] };
    expect(() => surfaceAt(nowhere, sheetP, 0, 0)).toThrow(/No fill card before it/);
  });

  it('give every text pair 4.5:1 or more at its worst point, on every band each is drawn in', () => {
    expect(surfacePalettes(SURFACES.page).map(([band]) => band)).toEqual(
      Object.keys(SNOW_PALETTES),
    );
    expect(surfacePalettes(SURFACES.content)).toEqual([[CONTENT_BAND, CONTENT_PALETTE]]);
    for (const s of Object.values(SURFACES)) {
      for (const [band, p] of surfacePalettes(s)) {
        for (const [pair, ratio] of Object.entries(surfaceTextPairs(s, p))) {
          expect(ratio, `${band} ${pair}`).toBeGreaterThanOrEqual(BODY_TEXT_CONTRAST);
        }
      }
    }
  });

  it('make the pairs the design measured, so the proof and the tokens are one model', () => {
    for (const [band, p] of bands) {
      const pairs = bandPairs(p);
      expect(surfaceTextPairs(SURFACES.page, p), band).toEqual({
        'ink/background': pairs.inkOnPage,
        'ink/chip': pairs.inkOnChip,
      });
      const sheet = surfaceTextPairs(SURFACES.sheet, p);
      expect(sheet['ink/background'], band).toBe(pairs.inkOnSheet);
      expect(sheet['soft/background'], band).toBe(pairs.softOnSheet);
      expect(sheet['ink/wash'], band).toBe(pairs.inkOnWash);
      expect(sheet['soft/wash'], band).toBe(pairs.softOnPressedRow);
      expect(sheet['soft/field'], band).toBe(pairs.placeholderOnField);
    }
    const content = contentPairs();
    expect(surfaceTextPairs(SURFACES.content, CONTENT_PALETTE)).toEqual({
      'ink/background': content.inkOnPage,
      'ink/card': content.inkOnCard,
      'ink/track': content.inkOnWash,
      'soft/card': content.softOnCard,
      'soft/track': content.softOnPressedRow,
    });
  });
});

describe('surfacesJson', () => {
  const text = surfacesJson();
  const file = JSON.parse(text);

  it('sits beside HomeScreens.json, in the UI tests’ generated folder', () => {
    expect(SURFACES_PATH).toBe(`${UI_TESTS_GENERATED_DIR}/Surfaces.json`);
  });

  it('gives the models, the least contrast, the band a page with none draws as, and every palette', () => {
    expect(file.source).toBe(`${BRAND_COLOURS_SOURCE} (SURFACES), by surfacesJson`);
    expect(file.screen).toEqual({ width: SCREEN.width, height: SCREEN.height });
    expect(file.background).toEqual({ ...BACKGROUND_MODEL, sheetEnd: BRAND_SHARES.sheetEnd });
    expect(file.minimum).toBe(BODY_TEXT_CONTRAST);
    expect(file.unknownBand).toBe(UNKNOWN_BAND_DRAWS_AS);
    expect(Object.keys(file.palettes)).toEqual(Object.keys(SNOW_PALETTES));
    for (const [band, p] of bands) {
      const { g1, g2, g3, ink, pill } = p;
      expect(file.palettes[band], band).toEqual({ g1, g2, g3, glow: opacity(p.glow), ink, pill });
    }
    expect(file.surfaces).toEqual(JSON.parse(JSON.stringify(SURFACES)));
  });

  it('samples each surface in each palette it is drawn in, as surfaceAt lays it', () => {
    const drawn = Object.values(SURFACES).reduce((n, s) => n + surfacePalettes(s).length, 0);
    expect(file.samples).toHaveLength(drawn * SURFACE_SAMPLES.length);
    expect(SURFACE_SAMPLES).toContainEqual([0, 0]);
    expect(SURFACE_SAMPLES).toContainEqual([SCREEN.width, SCREEN.height]);
    for (const sample of file.samples) {
      const s = SURFACES[sample.surface as keyof typeof SURFACES];
      const at = surfaceAt(s, SNOW_PALETTES[sample.band as SnowBand], sample.x, sample.y);
      const hexes = (c: Record<string, Rgb>) =>
        Object.fromEntries(Object.entries(c).map(([k, v]) => [k, hex(v)]));
      expect(sample.fills).toEqual(hexes(at.fills));
      expect(sample.texts).toEqual(hexes(at.texts));
      expect(sample.marks).toEqual(hexes(at.marks));
    }
    expect(file.samples[0]).toEqual({
      surface: 'page',
      band: 'nosnow',
      x: 0,
      y: 0,
      fills: { background: '#f8ecf2', chip: '#f6eef9' },
      texts: { 'ink/background': '#341a3c', 'ink/chip': '#341a3c' },
      marks: { 'border/chip': '#c0b3c4' },
    });
  });

  it('writes a line a palette, surface or sample, the same every time', () => {
    const lines = text.split('\n');
    const palettes = lines.indexOf('  "palettes": {');
    expect(lines.slice(palettes + 1, palettes + 7).map((l) => l.trim().split('"')[1])).toEqual(
      Object.keys(SNOW_PALETTES),
    );
    // `{` and five fields; each block's opening and closing lines round its own; then `}` and
    // the empty string after the last newline.
    const blocks = Object.keys(SNOW_PALETTES).length + 3 + file.samples.length;
    expect(lines.length).toBe(6 + 3 * 2 + blocks + 2);
    expect(text.endsWith('\n  ]\n}\n')).toBe(true);
    expect(surfacesJson()).toBe(text);
  });
});

describe('the colour arithmetic', () => {
  it('mixes in sRGB, rounded to 8 bits, and lays a colour over another', () => {
    expect(mix([0, 0, 0], [255, 255, 255], 0.5)).toEqual([128, 128, 128]);
    expect(mix([10, 20, 30], [10, 20, 30], 0.3)).toEqual([10, 20, 30]);
    expect(over([255, 255, 255], 0.12, [0, 0, 0])).toEqual([31, 31, 31]);
    expect(colour('#552269')).toEqual([0x55, 0x22, 0x69]);
    expect(hex([0, 10, 255])).toBe('#000aff');
  });

  it('works out WCAG 2’s ratios: 21 for black on white, 1 for a colour on itself', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 6);
    expect(contrast([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 6);
    expect(contrast([85, 34, 105], [85, 34, 105])).toBe(1);
    expect(luminance([5, 5, 5])).toBeCloseTo(5 / 255 / 12.92, 9);
  });

  it('finds the worst point of the screen, every 6 points, rounded down', () => {
    const seen: [number, number][] = [];
    expect(
      worst((x, y) => {
        seen.push([x, y]);
        return 3 + x / 1000 + y / 10_000 + 0.004_9;
      }),
    ).toBe(3);
    expect(seen).toHaveLength(68 * 146);
    expect(seen.at(-1)).toEqual([402, 870]);
  });
});

describe('brandColoursSwift', () => {
  const swift = brandColoursSwift();

  it('goes into IsItModel, with the header first, importing nothing', () => {
    expect(BRAND_COLOURS_PATH).toBe(
      'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated/BrandColours.swift',
    );
    expect(swift.split('\n')[0]).toBe(generatedHeader(BRAND_COLOURS_SOURCE));
    expect(swift.split('\n').filter((l) => l.startsWith('import '))).toEqual([]);
  });

  it('writes every share as a Double, in order, and the content card', () => {
    const lets = [...swift.matchAll(/^ {2}public static let (\w+): Double = ([\d.]+)$/gm)];
    expect(lets.map((m) => [m[1], Number(m[2])])).toEqual(Object.entries(BRAND_SHARES));
    expect(Object.keys(BRAND_SHARES)).toEqual([
      'chip',
      'soft',
      'wash',
      'field',
      'fieldBorder',
      'border',
      'hairline',
      'increasedLine',
      'affordance',
      'card',
      'sheetEnd',
    ]);
    expect(swift).toContain('  public static let contentCard: UInt32 = 0x401a4f\n');
  });

  it('is the same every time, within 100 columns', () => {
    expect(brandColoursSwift()).toBe(swift);
    for (const line of swift.split('\n')) expect(line.length, line).toBeLessThanOrEqual(100);
  });
});
