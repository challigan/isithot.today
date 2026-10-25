/**
 * The app's and its widget's fonts, Bricolage Grotesque as the website sets it (iOS build spec,
 * sections 7.1, 9.7 and 10.1; DECISIONS, "The iPhone app in the website's look"):
 *
 * - the answer word's, `BricolageAnswer.ttf`, which `scripts/make-answer-font.py --ttf` builds
 *   with fontTools from the same instance and subset as the website's woff2;
 * - the three text faces (`TEXT_FONTS`), `BricolageText-{Regular,Medium,SemiBold}.ttf`, which
 *   `scripts/make-text-fonts.py` builds from the website's variable font, its latin and latin-ext
 *   subsets merged.
 *
 * CI checks the generated files with Node alone, and fontTools is Python, so `pnpm mobile:check`
 * checks each font by what it was made from: the build ends the font's version string with its
 * recipe, a SHA-256 of the script and the files it reads, and the font is current when that
 * recipe is the one the files in the repo give now, and the file is whole (every table's
 * checksum, and the font's). `pnpm mobile:generate` builds them afresh (needing Python and
 * fontTools 4.66.1) only when one isn't current. Each build is byte for byte the same each time,
 * and the answer font's script refuses to build it unless the website's woff2 has the same
 * tables.
 *
 * `brandFontsSwift` names every font for the Swift (`BrandFont`, IsItModel), so no face's name is
 * typed in the app.
 */
import { createHash } from 'node:crypto';
import { generatedHeader, swiftIdentifier, swiftString } from './swift';

export const FONTS_DIR = 'apps/ios/Apps/Snow/Resources/Fonts';
export const FONT_PATH = `${FONTS_DIR}/BricolageAnswer.ttf`;
export const FONT_SCRIPT = 'scripts/make-answer-font.py';
export const WEB_FONT = 'apps/web/src/fonts/bricolage-answer.woff2';
/** Its family and PostScript name, for `Font.custom`, and its file's name, for `UIAppFonts`. */
export const FONT_NAME = 'BricolageAnswer';

/** The text faces' builder. */
export const TEXT_FONT_SCRIPT = 'scripts/make-text-fonts.py';

/** One of the app's fonts, as `BrandFont` names it. */
export interface BrandFontFile {
  /** Its case in Swift's `BrandFont`. */
  key: string;
  /**
   * Its PostScript name, which `Font.custom` and `UIFont(name:)` ask for; its file is named
   * after it, `<name>.ttf`, as `UIAppFonts` lists it.
   */
  name: string;
}

/** A text face: a static instance of the website's variable font. */
export interface TextFont extends BrandFontFile {
  /** Its style, name ID 2: its family is `TEXT_FONT_FAMILY`. */
  style: string;
  /** Its `wght` and `opsz`. */
  weight: number;
  opticalSize: number;
}

/** The text faces' family, name ID 1. */
export const TEXT_FONT_FAMILY = 'Bricolage Text';

/**
 * The text faces, as make-text-fonts.py's FACES builds them: the website's text at opsz 16, which
 * draws every size it sets text at (12.5 to 24 px) within 1% of the website's own optical size.
 * Regular for most text, Medium for buttons and Settings' rows, SemiBold for headings, tabs and
 * the verdict.
 */
export const TEXT_FONTS: readonly TextFont[] = [
  {
    key: 'textRegular',
    name: 'BricolageText-Regular',
    style: 'Regular',
    weight: 400,
    opticalSize: 16,
  },
  {
    key: 'textMedium',
    name: 'BricolageText-Medium',
    style: 'Medium',
    weight: 500,
    opticalSize: 16,
  },
  {
    key: 'textSemiBold',
    name: 'BricolageText-SemiBold',
    style: 'SemiBold',
    weight: 600,
    opticalSize: 16,
  },
];

/** Every font the app and the widget bundle and register, in `BrandFont`'s order. */
export const BRAND_FONTS: readonly BrandFontFile[] = [
  ...TEXT_FONTS,
  { key: 'answer', name: FONT_NAME },
];

/** A font's file, by its PostScript name, from the repo root. */
export const fontPath = (name: string): string => `${FONTS_DIR}/${name}.ttf`;

/** The source's package folder in node_modules/.pnpm, which both scripts look in too. */
const SOURCE_PACKAGE = '@fontsource-variable+bricolage-grotesque@';
const SOURCE_FILES = 'node_modules/@fontsource-variable/bricolage-grotesque/files';
const LATIN = 'bricolage-grotesque-latin-opsz-normal.woff2';
const LATIN_EXT = 'bricolage-grotesque-latin-ext-opsz-normal.woff2';
/** What each version string says before the recipe (each script's RECIPE). */
export const ANSWER_RECIPE = 'make-answer-font.py recipe ';
export const TEXT_RECIPE = 'make-text-fonts.py recipe ';

/**
 * The source package's folder from the repo root, given the names in node_modules/.pnpm: there
 * must be exactly one Bricolage Grotesque variable package, as both scripts require.
 */
function sourceFolder(pnpmEntries: readonly string[]): string {
  const found = pnpmEntries.filter((name) => name.startsWith(SOURCE_PACKAGE));
  if (found.length !== 1) {
    throw new Error(`Expected one ${SOURCE_PACKAGE}* in node_modules/.pnpm, found ${found.length}`);
  }
  return `node_modules/.pnpm/${found[0]}/${SOURCE_FILES}`;
}

/** The answer font's source, the latin subset, from the repo root. */
export function fontSourcePath(pnpmEntries: readonly string[]): string {
  return `${sourceFolder(pnpmEntries)}/${LATIN}`;
}

/** The text faces' sources, the latin and latin-ext subsets, in that order. */
export function textFontSourcePaths(pnpmEntries: readonly string[]): [string, string] {
  const folder = sourceFolder(pnpmEntries);
  return [`${folder}/${LATIN}`, `${folder}/${LATIN_EXT}`];
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest();

/** A SHA-256 of each part's SHA-256, in order, as both scripts compute their recipes. */
function recipeOf(parts: readonly Uint8Array[]): string {
  const digest = createHash('sha256');
  for (const part of parts) digest.update(sha256(part));
  return digest.digest('hex');
}

/** The recipe make-answer-font.py stamps: a SHA-256 of the three files' SHA-256s, in order. */
export function fontRecipe(script: Uint8Array, source: Uint8Array, web: Uint8Array): string {
  return recipeOf([script, source, web]);
}

/**
 * The recipe make-text-fonts.py stamps in each face: a SHA-256 of the SHA-256s of the script
 * and the two subsets, in order.
 */
export function textFontRecipe(script: Uint8Array, latin: Uint8Array, ext: Uint8Array): string {
  return recipeOf([script, latin, ext]);
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

/**
 * The recipe a font's version string ends with, after `marker` (whose script stamped it: the
 * answer font's by default), or null when it has none.
 */
export function fontStamp(
  names: ReadonlyMap<number, string>,
  marker: string = ANSWER_RECIPE,
): string | null {
  const version = names.get(5) ?? '';
  const at = version.lastIndexOf(marker);
  if (at < 0) return null;
  const recipe = version.slice(at + marker.length);
  return /^[0-9a-f]{64}$/.test(recipe) ? recipe : null;
}

export type FontState = 'current' | 'missing' | 'changed';

/**
 * What `pnpm mobile:check` makes of a committed font, `ttf` (undefined when there is none),
 * given the recipe of the files in the repo now and the script whose stamp it should carry (the
 * answer font's by default, `TEXT_RECIPE` for a text face).
 */
export function fontState(
  ttf: Uint8Array | undefined,
  recipe: string,
  marker: string = ANSWER_RECIPE,
): FontState {
  if (!ttf) return 'missing';
  const { tables, problems } = readSfnt(ttf);
  const name = tables.get('name');
  if (problems.length || !name) return 'changed';
  try {
    return fontStamp(fontNames(name), marker) === recipe ? 'current' : 'changed';
  } catch {
    // A name table whose records point outside it.
    return 'changed';
  }
}

export const BRAND_FONTS_PATH =
  'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated/BrandFonts.swift';

export const BRAND_FONTS_SOURCE = 'packages/mobile/src/exportFont.ts';

/**
 * `BrandFonts.swift`: every font the app and the widget register, by its PostScript name, which
 * `Font.custom` asks for, and its file, which `UIAppFonts` lists. In IsItModel, which the app's
 * views, the widget's and the unit tests all reach.
 */
export function brandFontsSwift(): string {
  return [
    generatedHeader(BRAND_FONTS_SOURCE),
    '',
    "/// The app's fonts, Bricolage Grotesque as the website sets it, each by its PostScript name,",
    '/// which `Font.custom` and `UIFont(name:)` ask for: the text faces, static instances of the',
    "/// website's variable font at opsz 16, and the answer word's. The app and the widget bundle",
    '/// every one and list its `file` in `UIAppFonts`.',
    'public enum BrandFont: String, CaseIterable, Sendable {',
    ...BRAND_FONTS.map((f) => `  case ${swiftIdentifier(f.key)} = ${swiftString(f.name)}`),
    '',
    "  /// Its file in the app's and the widget's bundles, as `UIAppFonts` names it.",
    '  public var file: String { rawValue + ".ttf" }',
    '}',
    '',
  ].join('\n');
}
