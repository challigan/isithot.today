/**
 * Everything `pnpm mobile:generate` writes into apps/ios, by path from the repo root, and how the
 * files on disk differ from it (`pnpm mobile:check`). The files are committed, so the Mac and CI
 * build the app without Node, and the check stops a hand edit or a stale copy.
 */
import { BRAND_COLOURS_PATH, SURFACES_PATH, brandColoursSwift, surfacesJson } from './brandColours';
import { APP_COPY_PATH, appCopySwift } from './exportAppCopy';
import { CONFIGS_GENERATED_DIR, CONFIG_COPY_PATH, configCopy } from './exportConfigCopy';
import { CONSTANTS_PATH, constantsSwift } from './exportConstants';
import { CORE_COPY_PATH, coreCopySwift } from './exportCoreCopy';
import { CREDITS_PATH, creditsSwift } from './exportCredits';
import { BRAND_FONTS_PATH, FONTS_DIR, brandFontsSwift } from './exportFont';
import {
  GLYPHS_DIR,
  GLYPHS_FALLBACK_DIR,
  SNOW_KIT_GENERATED_DIR,
  glyphFiles,
} from './exportGlyphs';
import { HOME_SCREENS_PATH, UI_TESTS_GENERATED_DIR, homeScreensJson } from './exportHomeScreens';
import { ASSETS_DIR, iconFiles } from './exportIcon';
import { KEYS_PATH, keysSwift } from './exportKeys';
import { PALETTES_PATH, palettesSwift } from './exportPalettes';
import { QUESTIONS_PATH, questionsSwift } from './exportQuestions';
import { STOREKIT_DIR, STOREKIT_PATH, storeKitJson } from './exportStoreKit';
import {
  FIXTURES,
  SEARCH_FIXTURES,
  fixtureJson,
  makeFixture,
  makeSearchFixture,
  type Fixture,
} from './fixtures';
import { vectorFiles, vectorJson } from './vectors';

/**
 * The Swift package's test resources, read by every test target through `IsItTestSupport`, and
 * bundled into the app's Debug builds for its `-fixture` launch argument.
 */
export const FIXTURES_DIR = 'apps/ios/Packages/IsItCore/Tests/IsItTestSupport/Resources/Fixtures';

/** The search fixtures, in a folder of their own inside the fixtures', so they ship with them. */
export const SEARCH_FIXTURES_DIR = `${FIXTURES_DIR}/Search`;

/** The golden vectors, beside the fixtures they name, for IsItLogic's tests (phase 3). */
export const VECTORS_DIR = 'apps/ios/Packages/IsItCore/Tests/IsItTestSupport/Resources/Vectors';

/**
 * IsItModel's generated Swift: the copy, the questions, the constants, the credits, the keys,
 * the fonts' names, the palettes and the shares the app mixes them by.
 */
export const MODEL_GENERATED_DIR = 'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated';

/**
 * Folders the generator owns, with everything in them: every file there is generated, so one it
 * no longer writes is stale. Hidden files (a Mac's `.DS_Store`) don't count. The fonts' folder is
 * the font scripts' to fill (`exportFont.ts`).
 */
export const OWNED_DIRS: readonly string[] = [
  FIXTURES_DIR,
  VECTORS_DIR,
  MODEL_GENERATED_DIR,
  GLYPHS_DIR,
  GLYPHS_FALLBACK_DIR,
  SNOW_KIT_GENERATED_DIR,
  ASSETS_DIR,
  FONTS_DIR,
  CONFIGS_GENERATED_DIR,
  STOREKIT_DIR,
  UI_TESTS_GENERATED_DIR,
];

export interface GeneratedFile {
  path: string;
  /** Text, written as UTF-8, or bytes (the PNGs and the fonts). */
  contents: string | Uint8Array;
}

/** What the asset generators take from the website, read by scripts/mobile-generate.ts. */
export interface AssetSources {
  /** `SNOW_GLYPHS` from apps/web/src/lib/snowGlyphs.ts: each band's SVG body. */
  glyphs: Readonly<Record<string, string>>;
  /** apps/web/public/snow/favicon.svg. */
  favicon: string;
}

/**
 * Every file but the fonts, in order: IsItModel's Swift (the palettes and brand colours last),
 * the Info.plist's strings (`Copy.xcconfig`), the StoreKit configuration (`Snow.storekit`), each
 * fixture, each search fixture, each vector file, worked out from the fixtures exactly as their
 * files have them, the UI tests' screens (from page.json) and surfaces (from brandColours.ts),
 * then the glyphs and the app icon.
 */
export async function generatedFiles(sources: AssetSources): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [
    { path: CORE_COPY_PATH, contents: coreCopySwift() },
    { path: QUESTIONS_PATH, contents: questionsSwift() },
    { path: APP_COPY_PATH, contents: appCopySwift() },
    { path: CONSTANTS_PATH, contents: constantsSwift() },
    { path: CREDITS_PATH, contents: creditsSwift() },
    { path: KEYS_PATH, contents: keysSwift() },
    { path: BRAND_FONTS_PATH, contents: brandFontsSwift() },
    { path: PALETTES_PATH, contents: palettesSwift() },
    { path: BRAND_COLOURS_PATH, contents: brandColoursSwift() },
    { path: CONFIG_COPY_PATH, contents: configCopy() },
    { path: STOREKIT_PATH, contents: storeKitJson() },
  ];
  const fixtures = new Map<string, Fixture>();
  for (const spec of FIXTURES) {
    const contents = fixtureJson(await makeFixture(spec));
    files.push({ path: `${FIXTURES_DIR}/${spec.name}.json`, contents });
    fixtures.set(spec.name, JSON.parse(contents) as Fixture);
  }
  for (const spec of SEARCH_FIXTURES) {
    const contents = fixtureJson(await makeSearchFixture(spec));
    files.push({ path: `${SEARCH_FIXTURES_DIR}/${spec.name}.json`, contents });
  }
  const vectors = vectorFiles(fixtures);
  for (const { name, vectors: file } of vectors) {
    files.push({ path: `${VECTORS_DIR}/${name}.json`, contents: vectorJson(file) });
  }
  const page = vectors.find((v) => v.name === 'page');
  if (!page) throw new Error('No page.json');
  files.push({ path: HOME_SCREENS_PATH, contents: homeScreensJson(fixtures, page.vectors) });
  files.push({ path: SURFACES_PATH, contents: surfacesJson() });
  files.push(...glyphFiles(sources.glyphs), ...iconFiles(sources.favicon));
  return files;
}

export interface Drift {
  path: string;
  /** Not on disk; different on disk; or on disk in an owned folder but no longer generated. */
  problem: 'missing' | 'changed' | 'stale';
}

const bytes = (contents: string | Uint8Array): Uint8Array =>
  typeof contents === 'string' ? Buffer.from(contents, 'utf8') : contents;

/** Whether two files' contents are the same bytes, text being UTF-8. */
export function sameContents(a: string | Uint8Array, b: string | Uint8Array): boolean {
  return Buffer.from(bytes(a)).equals(bytes(b));
}

/**
 * How the files on disk differ from `expected`, by path. `onDisk` holds the contents of every
 * expected file that exists, and of every file in the owned folders.
 */
export function drift(
  expected: readonly GeneratedFile[],
  onDisk: ReadonlyMap<string, string | Uint8Array>,
): Drift[] {
  const wanted = new Map(expected.map((f) => [f.path, f.contents]));
  const found: Drift[] = [];
  for (const [path, contents] of wanted) {
    const disk = onDisk.get(path);
    if (disk === undefined) found.push({ path, problem: 'missing' });
    else if (!sameContents(disk, contents)) found.push({ path, problem: 'changed' });
  }
  for (const path of onDisk.keys()) {
    if (!wanted.has(path)) found.push({ path, problem: 'stale' });
  }
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
