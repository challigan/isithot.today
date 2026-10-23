/**
 * Everything `pnpm mobile:generate` writes into apps/ios, by path from the repo root, and how the
 * files on disk differ from it (`pnpm mobile:check`). The files are committed, so the Mac and CI
 * build the app without Node, and the check stops a hand edit or a stale copy.
 */
import { FONTS_DIR } from './exportFont';
import {
  GLYPHS_DIR,
  GLYPHS_FALLBACK_DIR,
  SNOW_KIT_GENERATED_DIR,
  glyphFiles,
} from './exportGlyphs';
import { ASSETS_DIR, iconFiles } from './exportIcon';
import { KEYS_PATH, keysSwift } from './exportKeys';
import { FIXTURES, fixtureJson, makeFixture } from './fixtures';

/**
 * The Swift package's test resources, read by every test target through `IsItTestSupport`, and
 * bundled into the app's Debug builds for its `-fixture` launch argument.
 */
export const FIXTURES_DIR = 'apps/ios/Packages/IsItCore/Tests/IsItTestSupport/Resources/Fixtures';

/** IsItModel's generated Swift: `Keys` now, then the copy and the constants. */
export const MODEL_GENERATED_DIR = 'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated';

/**
 * Folders the generator owns, with everything in them: every file there is generated, so one it
 * no longer writes is stale. Hidden files (a Mac's `.DS_Store`) don't count. The answer font's
 * folder is the script's to fill (`exportFont.ts`).
 */
export const OWNED_DIRS: readonly string[] = [
  FIXTURES_DIR,
  MODEL_GENERATED_DIR,
  GLYPHS_DIR,
  GLYPHS_FALLBACK_DIR,
  SNOW_KIT_GENERATED_DIR,
  ASSETS_DIR,
  FONTS_DIR,
];

export interface GeneratedFile {
  path: string;
  /** Text, written as UTF-8, or bytes (the PNGs and the font). */
  contents: string | Uint8Array;
}

/** What the asset generators take from the website, read by scripts/mobile-generate.ts. */
export interface AssetSources {
  /** `SNOW_GLYPHS` from apps/web/src/lib/snowGlyphs.ts: each band's SVG body. */
  glyphs: Readonly<Record<string, string>>;
  /** apps/web/public/snow/favicon.svg. */
  favicon: string;
}

export async function generatedFiles(sources: AssetSources): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [{ path: KEYS_PATH, contents: keysSwift() }];
  for (const spec of FIXTURES) {
    files.push({
      path: `${FIXTURES_DIR}/${spec.name}.json`,
      contents: fixtureJson(await makeFixture(spec)),
    });
  }
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
