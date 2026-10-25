import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ANSWER_RECIPE,
  BRAND_FONTS,
  FONTS_DIR,
  FONT_NAME,
  FONT_PATH,
  FONT_SCRIPT,
  TEXT_FONTS,
  TEXT_FONT_FAMILY,
  TEXT_FONT_SCRIPT,
  TEXT_RECIPE,
  WEB_FONT,
  fontNames,
  fontPath,
  fontRecipe,
  fontSourcePath,
  fontStamp,
  fontState,
  readSfnt,
  textFontRecipe,
  textFontSourcePaths,
} from '../src/exportFont';

const repo = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url));
const TTF = new Uint8Array(repo(FONT_PATH));
const pnpm = () => readdirSync(new URL('../../../node_modules/.pnpm', import.meta.url));
const recipeNow = () => fontRecipe(repo(FONT_SCRIPT), repo(fontSourcePath(pnpm())), repo(WEB_FONT));
const textRecipeNow = () => {
  const [latin, ext] = textFontSourcePaths(pnpm());
  return textFontRecipe(repo(TEXT_FONT_SCRIPT), repo(latin), repo(ext));
};
/** Each text face as committed. */
const faces = TEXT_FONTS.map((face) => ({ face, ttf: new Uint8Array(repo(fontPath(face.name))) }));

/**
 * The code points a font's Windows Unicode BMP cmap (format 4) gives a glyph, as Core Text finds
 * them: the text faces have only that subtable.
 */
function cmapCodePoints(ttf: Uint8Array): Set<number> {
  const cmap = readSfnt(ttf).tables.get('cmap')!;
  const view = new DataView(cmap.buffer, cmap.byteOffset, cmap.byteLength);
  const found = new Set<number>();
  for (let i = 0; i < view.getUint16(2); i++) {
    const record = 4 + 8 * i;
    if (view.getUint16(record) !== 3 || view.getUint16(record + 2) !== 1) continue;
    const table = view.getUint32(record + 4);
    expect(view.getUint16(table)).toBe(4);
    const segments = view.getUint16(table + 6) / 2;
    const ends = table + 14;
    const starts = ends + 2 * segments + 2;
    const deltas = starts + 2 * segments;
    const rangeOffsets = deltas + 2 * segments;
    for (let s = 0; s < segments; s++) {
      const [start, end] = [view.getUint16(starts + 2 * s), view.getUint16(ends + 2 * s)];
      const delta = view.getUint16(deltas + 2 * s);
      const rangeOffset = view.getUint16(rangeOffsets + 2 * s);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph: number;
        if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
        else {
          const at = rangeOffsets + 2 * s + rangeOffset + 2 * (c - start);
          const raw = view.getUint16(at);
          glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
        }
        if (glyph !== 0) found.add(c);
      }
    }
  }
  return found;
}

describe('fontSourcePath', () => {
  it('finds the one Bricolage Grotesque variable package', () => {
    expect(
      fontSourcePath([
        '@fontsource+bricolage-grotesque@5.3.0',
        '@fontsource-variable+bricolage-grotesque@5.3.0',
      ]),
    ).toBe(
      'node_modules/.pnpm/@fontsource-variable+bricolage-grotesque@5.3.0/node_modules/' +
        '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2',
    );
  });

  it('finds the text faces’ two subsets in the same package', () => {
    expect(textFontSourcePaths(['@fontsource-variable+bricolage-grotesque@5.3.0'])).toEqual(
      ['latin', 'latin-ext'].map(
        (subset) =>
          'node_modules/.pnpm/@fontsource-variable+bricolage-grotesque@5.3.0/node_modules/' +
          `@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-${subset}-opsz-normal.woff2`,
      ),
    );
    expect(() => textFontSourcePaths([])).toThrow(/found 0/);
  });

  it('refuses none, or two, as make-answer-font.py does', () => {
    expect(() => fontSourcePath(['pngjs@7.0.0'])).toThrow(/found 0/);
    expect(() =>
      fontSourcePath([
        '@fontsource-variable+bricolage-grotesque@5.3.0',
        '@fontsource-variable+bricolage-grotesque@5.4.0',
      ]),
    ).toThrow(/found 2/);
  });
});

describe('fontRecipe', () => {
  const [a, b, c] = ['script', 'source', 'web'].map((s) => new TextEncoder().encode(s)) as [
    Uint8Array,
    Uint8Array,
    Uint8Array,
  ];

  it('is a SHA-256 of the three files’ SHA-256s, in order, as the script computes it', () => {
    const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest();
    const expected = createHash('sha256')
      .update(Buffer.concat([sha(a), sha(b), sha(c)]))
      .digest('hex');
    expect(fontRecipe(a, b, c)).toBe(expected);
  });

  it('changes with any of them, or their order', () => {
    const recipes = new Set([
      fontRecipe(a, b, c),
      fontRecipe(a, b, a),
      fontRecipe(c, b, a),
      fontRecipe(new Uint8Array([1]), b, c),
    ]);
    expect(recipes.size).toBe(4);
  });

  it('is computed the same way for the text faces, over the script and the two subsets', () => {
    expect(textFontRecipe(a, b, c)).toBe(fontRecipe(a, b, c));
    expect(textFontRecipe(a, c, b)).not.toBe(textFontRecipe(a, b, c));
  });
});

describe('readSfnt', () => {
  it('reads the committed font’s tables, with every checksum right', () => {
    const { tables, problems } = readSfnt(TTF);
    expect(problems).toEqual([]);
    expect([...tables.keys()].sort()).toEqual(
      ['GDEF', 'GPOS', 'GSUB', 'OS/2', 'STAT', 'cmap', 'gasp', 'glyf', 'head', 'hhea']
        .concat(['hmtx', 'loca', 'maxp', 'name', 'post', 'prep'])
        .sort(),
    );
  });

  it('finds a changed byte in a table, and a changed font checksum', () => {
    const { tables } = readSfnt(TTF);
    const glyf = tables.get('glyf')!;
    const edited = Uint8Array.from(TTF);
    edited[glyf.byteOffset + 40]! ^= 1;
    expect(readSfnt(edited).problems).toEqual([
      "glyf's checksum is wrong",
      "the font's checksum is wrong",
    ]);
    const adjusted = Uint8Array.from(TTF);
    adjusted[tables.get('head')!.byteOffset + 8]! ^= 1;
    expect(readSfnt(adjusted).problems).toEqual(["the font's checksum is wrong"]);
  });

  it('refuses what isn’t a whole TrueType font', () => {
    expect(readSfnt(new Uint8Array(4)).problems).toEqual(['not a TrueType font']);
    expect(readSfnt(new TextEncoder().encode('wOF2 and more bytes')).problems).toEqual([
      'not a TrueType font',
    ]);
    expect(readSfnt(TTF.subarray(0, 40)).problems).toEqual(['the table directory is cut short']);
    const tables = [...readSfnt(TTF).tables];
    const [last] = tables.reduce((a, b) => (b[1].byteOffset > a[1].byteOffset ? b : a));
    expect(readSfnt(TTF.subarray(0, TTF.length - 100)).problems).toContain(
      `${last} runs past the end of the file`,
    );
    const headless = Uint8Array.from(TTF);
    const at = [...readSfnt(TTF).tables.keys()].indexOf('head');
    headless.set(new TextEncoder().encode('hea_'), 12 + 16 * at);
    expect(readSfnt(headless).problems).toContain('there is no head table');
  });
});

describe('fontNames and fontStamp', () => {
  const names = fontNames(readSfnt(TTF).tables.get('name')!);

  it('name the committed font BricolageAnswer, for Font.custom, with the OFL', () => {
    expect([names.get(1), names.get(4), names.get(6)]).toEqual([FONT_NAME, FONT_NAME, FONT_NAME]);
    expect(names.get(2)).toBe('Regular');
    expect(names.get(0)).toMatch(/^Copyright 2022 The Bricolage Grotesque Project Authors/);
    expect(names.get(13)).toBe(
      'This Font Software is licensed under the SIL Open Font License, Version 1.1.',
    );
    expect(names.get(14)).toBe('https://scripts.sil.org/OFL');
  });

  it('read the recipe from the end of the version string', () => {
    expect(names.get(5)).toMatch(/^Version 1\.001;make-answer-font\.py recipe [0-9a-f]{64}$/);
    expect(fontStamp(names)).toBe(names.get(5)!.slice(-64));
    expect(fontStamp(new Map([[5, 'Version 1.001;gftools[0.9.33]']]))).toBeNull();
    expect(fontStamp(new Map([[5, 'Version 1.001;make-answer-font.py recipe abc']]))).toBeNull();
    expect(fontStamp(new Map())).toBeNull();
  });

  it('read only the stamp of the script asked for', () => {
    expect(ANSWER_RECIPE).toBe('make-answer-font.py recipe ');
    expect(TEXT_RECIPE).toBe('make-text-fonts.py recipe ');
    expect(fontStamp(names, TEXT_RECIPE)).toBeNull();
    const text = fontNames(readSfnt(faces[0]!.ttf).tables.get('name')!);
    expect(fontStamp(text, TEXT_RECIPE)).toBe(text.get(5)!.slice(-64));
    expect(fontStamp(text)).toBeNull();
  });
});

describe('fontState', () => {
  it('says the committed font is current: made by this script, from these fonts', () => {
    expect(fontState(TTF, recipeNow())).toBe('current');
  });

  it('says each committed text face is current, by its own script’s stamp', () => {
    for (const { face, ttf } of faces) {
      expect(fontState(ttf, textRecipeNow(), TEXT_RECIPE), face.name).toBe('current');
      // Stamped by the other script: not the answer font, whatever its recipe.
      expect(fontState(ttf, textRecipeNow()), face.name).toBe('changed');
    }
    expect(fontState(TTF, recipeNow(), TEXT_RECIPE)).toBe('changed');
  });

  it('says a text face is missing, or changed when its recipe is stale or the file isn’t whole', () => {
    for (const { face, ttf } of faces) {
      expect(fontState(undefined, textRecipeNow(), TEXT_RECIPE), face.name).toBe('missing');
      // What a changed script or source would give.
      expect(fontState(ttf, '0'.repeat(64), TEXT_RECIPE), face.name).toBe('changed');
      const edited = Uint8Array.from(ttf);
      edited[edited.length - 8]! ^= 1;
      expect(fontState(edited, textRecipeNow(), TEXT_RECIPE), face.name).toBe('changed');
    }
  });

  it('says missing, or changed when the recipe differs or the file isn’t whole', () => {
    expect(fontState(undefined, recipeNow())).toBe('missing');
    expect(fontState(TTF, '0'.repeat(64))).toBe('changed');
    const edited = Uint8Array.from(TTF);
    edited[edited.length - 8]! ^= 1;
    expect(fontState(edited, recipeNow())).toBe('changed');
    expect(fontState(new Uint8Array(100), recipeNow())).toBe('changed');
  });
});

describe('the text faces', () => {
  it('are the three make-text-fonts.py builds, in its order, with the same settings', () => {
    const script = repo(TEXT_FONT_SCRIPT).toString('utf8');
    const built = [...script.matchAll(/^ {4}\("([\w-]+)", "(\w+)", (\d+), (\d+)\),$/gm)].map(
      ([, name, style, weight, size]) => ({ name, style, weight: +weight!, opticalSize: +size! }),
    );
    expect(built).toEqual(
      TEXT_FONTS.map(({ name, style, weight, opticalSize }) => ({
        name,
        style,
        weight,
        opticalSize,
      })),
    );
    expect(script).toContain(`FAMILY = "${TEXT_FONT_FAMILY}"`);
    expect(script).toContain(`RECIPE = "${TEXT_RECIPE}"`);
    expect(TEXT_FONTS.map((f) => [f.key, f.name, f.weight])).toEqual([
      ['textRegular', 'BricolageText-Regular', 400],
      ['textMedium', 'BricolageText-Medium', 500],
      ['textSemiBold', 'BricolageText-SemiBold', 600],
    ]);
  });

  it('are named for Font.custom, each its own PostScript name in one family, with the OFL', () => {
    for (const { face, ttf } of faces) {
      const { tables, problems } = readSfnt(ttf);
      expect(problems, face.name).toEqual([]);
      const names = fontNames(tables.get('name')!);
      expect(
        [...names.keys()].sort((a, b) => a - b),
        face.name,
      ).toEqual([0, 1, 2, 3, 4, 5, 6, 13, 14]);
      expect(names.get(1)).toBe(TEXT_FONT_FAMILY);
      expect(names.get(2)).toBe(face.style);
      expect(names.get(3)).toBe(`1.001;${face.name}`);
      expect(names.get(4)).toBe(`${TEXT_FONT_FAMILY} ${face.style}`);
      expect(names.get(5)).toMatch(/^Version 1\.001;make-text-fonts\.py recipe [0-9a-f]{64}$/);
      expect(names.get(6)).toBe(face.name);
      expect(names.get(0)).toMatch(/^Copyright 2022 The Bricolage Grotesque Project Authors/);
      expect(names.get(13)).toBe(
        'This Font Software is licensed under the SIL Open Font License, Version 1.1.',
      );
      expect(names.get(14)).toBe('https://scripts.sil.org/OFL');
      // OS/2's usWeightClass, and fsSelection with only USE_TYPO_METRICS and, at 400, REGULAR.
      const os2 = tables.get('OS/2')!;
      const view = new DataView(os2.buffer, os2.byteOffset, os2.byteLength);
      expect(view.getUint16(4), face.name).toBe(face.weight);
      expect(view.getUint16(62), face.name).toBe(face.weight === 400 ? 0xc0 : 0x80);
    }
  });

  it('hold a glyph for every letter of a place or a credit the app shows, latin-ext too', () => {
    const sample = 'Météo-France Łódź Reykjavík Kraków Malmö 0.9cm 100% ° ’ … · –';
    for (const { face, ttf } of faces) {
      const mapped = cmapCodePoints(ttf);
      expect(mapped.size, face.name).toBe(374);
      const missing = [...sample].filter((c) => !mapped.has(c.codePointAt(0)!));
      expect(missing, face.name).toEqual([]);
    }
    // And the answer font, a subset of letters and punctuation, has no Ł: the reason for these.
    expect(cmapCodePoints(TTF).has(0x141)).toBe(false);
  });

  it('are every font in the folder, with the answer font, as BrandFont lists them', () => {
    expect(BRAND_FONTS.map((f) => [f.key, f.name])).toEqual([
      ...TEXT_FONTS.map((f) => [f.key, f.name]),
      ['answer', FONT_NAME],
    ]);
    expect(BRAND_FONTS.map((f) => fontPath(f.name))).toContain(FONT_PATH);
    const folder = readdirSync(new URL(`../../../${FONTS_DIR}`, import.meta.url));
    expect(folder.filter((name) => !name.startsWith('.')).sort()).toEqual(
      BRAND_FONTS.map((f) => `${f.name}.ttf`).sort(),
    );
  });
});
