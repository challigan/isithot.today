/**
 * Everything `pnpm mobile:generate` writes into apps/ios, by path from the repo root, and how the
 * files on disk differ from it (`pnpm mobile:check`). The files are committed, so the Mac and CI
 * build the app without Node, and the check stops a hand edit or a stale copy.
 */
import { APP_COPY_PATH, appCopySwift } from './exportAppCopy';
import { CONSTANTS_PATH, constantsSwift } from './exportConstants';
import { CORE_COPY_PATH, coreCopySwift } from './exportCoreCopy';
import { KEYS_PATH, keysSwift } from './exportKeys';
import { PALETTES_PATH, palettesSwift } from './exportPalettes';
import { QUESTIONS_PATH, questionsSwift } from './exportQuestions';
import { FIXTURES, fixtureJson, makeFixture } from './fixtures';

/**
 * The Swift package's test resources, read by every test target through `IsItTestSupport`, and
 * bundled into the app's Debug builds for its `-fixture` launch argument.
 */
export const FIXTURES_DIR = 'apps/ios/Packages/IsItCore/Tests/IsItTestSupport/Resources/Fixtures';

/** IsItModel's generated Swift: the copy, the questions, the constants and the keys. */
export const MODEL_GENERATED_DIR = 'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated';

/** IsItUI's generated Swift: the palettes. */
export const UI_GENERATED_DIR = 'apps/ios/Packages/IsItKit/Sources/IsItUI/Generated';

/**
 * Folders the generator owns: every file in them is generated, so one it no longer writes is
 * stale. Hidden files (a Mac's `.DS_Store`) don't count.
 */
export const OWNED_DIRS: readonly string[] = [FIXTURES_DIR, MODEL_GENERATED_DIR, UI_GENERATED_DIR];

export interface GeneratedFile {
  path: string;
  contents: string;
}

export async function generatedFiles(): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [
    { path: CORE_COPY_PATH, contents: coreCopySwift() },
    { path: QUESTIONS_PATH, contents: questionsSwift() },
    { path: APP_COPY_PATH, contents: appCopySwift() },
    { path: CONSTANTS_PATH, contents: constantsSwift() },
    { path: KEYS_PATH, contents: keysSwift() },
    { path: PALETTES_PATH, contents: palettesSwift() },
  ];
  for (const spec of FIXTURES) {
    files.push({
      path: `${FIXTURES_DIR}/${spec.name}.json`,
      contents: fixtureJson(await makeFixture(spec)),
    });
  }
  return files;
}

export interface Drift {
  path: string;
  /** Not on disk; different on disk; or on disk in an owned folder but no longer generated. */
  problem: 'missing' | 'changed' | 'stale';
}

/**
 * How the files on disk differ from `expected`, by path. `onDisk` holds the contents of every
 * expected file that exists, and of every file in the owned folders.
 */
export function drift(
  expected: readonly GeneratedFile[],
  onDisk: ReadonlyMap<string, string>,
): Drift[] {
  const wanted = new Map(expected.map((f) => [f.path, f.contents]));
  const found: Drift[] = [];
  for (const [path, contents] of wanted) {
    const disk = onDisk.get(path);
    if (disk === undefined) found.push({ path, problem: 'missing' });
    else if (disk !== contents) found.push({ path, problem: 'changed' });
  }
  for (const path of onDisk.keys()) {
    if (!wanted.has(path)) found.push({ path, problem: 'stale' });
  }
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
