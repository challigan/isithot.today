import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FONT_NAME,
  FONT_PATH,
  FONT_SCRIPT,
  WEB_FONT,
  fontNames,
  fontRecipe,
  fontSourcePath,
  fontStamp,
  fontState,
  readSfnt,
} from '../src/exportFont';

const repo = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url));
const TTF = new Uint8Array(repo(FONT_PATH));
const recipeNow = () =>
  fontRecipe(
    repo(FONT_SCRIPT),
    repo(fontSourcePath(readdirSync(new URL('../../../node_modules/.pnpm', import.meta.url)))),
    repo(WEB_FONT),
  );

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
});

describe('fontState', () => {
  it('says the committed font is current: made by this script, from these fonts', () => {
    expect(fontState(TTF, recipeNow())).toBe('current');
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
