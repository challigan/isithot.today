/**
 * The answer word's font for the app and its widget (iOS build spec, sections 7.1, 9.7 and
 * 10.1): `BricolageAnswer.ttf`, which `scripts/make-answer-font.py --ttf` builds with fontTools
 * from the same instance and subset as the website's woff2.
 *
 * CI checks the generated files with Node alone, and fontTools is Python, so `pnpm mobile:check`
 * checks the font by what it was made from: the build ends the font's version string with its
 * recipe, a SHA-256 of the script, the source font and the website's woff2, and the font is
 * current when that recipe is the one the files in the repo give now, and the file is whole
 * (every table's checksum, and the font's). `pnpm mobile:generate` builds it afresh (needing
 * Python and fontTools 4.66.1) only when it isn't current. The build is byte for byte the same
 * each time, and the script refuses to build it unless the website's woff2 has the same tables.
 */
import { createHash } from 'node:crypto';

export const FONTS_DIR = 'apps/ios/Apps/Snow/Resources/Fonts';
export const FONT_PATH = `${FONTS_DIR}/BricolageAnswer.ttf`;
export const FONT_SCRIPT = 'scripts/make-answer-font.py';
export const WEB_FONT = 'apps/web/src/fonts/bricolage-answer.woff2';
/** Its family and PostScript name, for `Font.custom`, and its file's name, for `UIAppFonts`. */
export const FONT_NAME = 'BricolageAnswer';

/** The source's package folder in node_modules/.pnpm, which make-answer-font.py looks in too. */
const SOURCE_PACKAGE = '@fontsource-variable+bricolage-grotesque@';
const SOURCE_FILE =
  'node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2';
/** What the version string says before the recipe (make-answer-font.py's RECIPE). */
const RECIPE = 'make-answer-font.py recipe ';

/**
 * The source font's path from the repo root, given the names in node_modules/.pnpm: there must
 * be exactly one Bricolage Grotesque variable package, as the script requires.
 */
export function fontSourcePath(pnpmEntries: readonly string[]): string {
  const found = pnpmEntries.filter((name) => name.startsWith(SOURCE_PACKAGE));
  if (found.length !== 1) {
    throw new Error(`Expected one ${SOURCE_PACKAGE}* in node_modules/.pnpm, found ${found.length}`);
  }
  return `node_modules/.pnpm/${found[0]}/${SOURCE_FILE}`;
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest();

/** The recipe make-answer-font.py stamps: a SHA-256 of the three files' SHA-256s, in order. */
export function fontRecipe(script: Uint8Array, source: Uint8Array, web: Uint8Array): string {
  const digest = createHash('sha256');
  for (const part of [script, source, web]) digest.update(sha256(part));
  return digest.digest('hex');
}

/** OpenType's CalcTableChecksum: big-endian 32-bit words summed, the last padded with zeros. */
function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    const word =
      ((bytes[i] ?? 0) << 24) |
      ((bytes[i + 1] ?? 0) << 16) |
      ((bytes[i + 2] ?? 0) << 8) |
      (bytes[i + 3] ?? 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum;
}

export interface Sfnt {
  tables: Map<string, Uint8Array>;
  /** What is wrong with the file, if anything: then don't trust the tables. */
  problems: string[];
}

/** A TrueType font's tables, and whether its checksums hold (OpenType, "Font file"). */
export function readSfnt(bytes: Uint8Array): Sfnt {
  const tables = new Map<string, Uint8Array>();
  const problems: string[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || view.getUint32(0) !== 0x00010000) {
    return { tables, problems: ['not a TrueType font'] };
  }
  const count = view.getUint16(4);
  if (12 + 16 * count > bytes.length)
    return { tables, problems: ['the table directory is cut short'] };
  for (let i = 0; i < count; i++) {
    const record = 12 + 16 * i;
    const tag = String.fromCharCode(...bytes.subarray(record, record + 4));
    const expected = view.getUint32(record + 4);
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    if (offset + length > bytes.length) {
      problems.push(`${tag} runs past the end of the file`);
      continue;
    }
    const data = bytes.subarray(offset, offset + length);
    tables.set(tag, data);
    // head's checksum is taken with its checkSumAdjustment (bytes 8 to 11) as zero.
    const summed = tag === 'head' ? Uint8Array.from(data).fill(0, 8, 12) : data;
    if (checksum(summed) !== expected) problems.push(`${tag}'s checksum is wrong`);
  }
  if (!tables.has('head')) problems.push('there is no head table');
  else if (checksum(bytes) !== 0xb1b0afba) problems.push("the font's checksum is wrong");
  return { tables, problems };
}

/** The name table's Windows English (US) names, by name ID. */
export function fontNames(name: Uint8Array): Map<number, string> {
  const view = new DataView(name.buffer, name.byteOffset, name.byteLength);
  const names = new Map<number, string>();
  const count = view.getUint16(2);
  const strings = view.getUint16(4);
  for (let i = 0; i < count; i++) {
    const record = 6 + 12 * i;
    const [platform, encoding, language, id, length, offset] = [0, 2, 4, 6, 8, 10].map((at) =>
      view.getUint16(record + at),
    ) as [number, number, number, number, number, number];
    if (platform !== 3 || encoding !== 1 || language !== 0x409) continue;
    let text = '';
    for (let at = strings + offset; at < strings + offset + length; at += 2) {
      text += String.fromCharCode(view.getUint16(at));
    }
    names.set(id, text);
  }
  return names;
}

/** The recipe a font's version string ends with, or null when it has none. */
export function fontStamp(names: ReadonlyMap<number, string>): string | null {
  const version = names.get(5) ?? '';
  const at = version.lastIndexOf(RECIPE);
  if (at < 0) return null;
  const recipe = version.slice(at + RECIPE.length);
  return /^[0-9a-f]{64}$/.test(recipe) ? recipe : null;
}

export type FontState = 'current' | 'missing' | 'changed';

/**
 * What `pnpm mobile:check` makes of the committed font, `ttf` (undefined when there is none),
 * given the recipe of the files in the repo now.
 */
export function fontState(ttf: Uint8Array | undefined, recipe: string): FontState {
  if (!ttf) return 'missing';
  const { tables, problems } = readSfnt(ttf);
  const name = tables.get('name');
  if (problems.length || !name) return 'changed';
  try {
    return fontStamp(fontNames(name)) === recipe ? 'current' : 'changed';
  } catch {
    // A name table whose records point outside it.
    return 'changed';
  }
}
