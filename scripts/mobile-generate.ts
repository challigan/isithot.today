/**
 * Writes what packages/mobile generates for the native apps into apps/ios (iOS build spec,
 * section 7.1): `Keys.swift`, the fixtures the Swift tests decode, the snow glyphs' asset
 * catalogues, the app icon and the answer font.
 *
 *   pnpm mobile:generate   writes the files, and removes stale ones from the folders it owns
 *   pnpm mobile:check      changes nothing; fails, listing each file, when any differs
 *
 * The generated files are never edited by hand: change the TypeScript and generate again.
 *
 * This script reads what the generators take from the website (the glyphs' SVG and the favicon)
 * and passes it in. The answer font is built by scripts/make-answer-font.py, which needs Python
 * and fontTools, so it is checked by its recipe instead (packages/mobile/src/exportFont.ts), and
 * generating runs the Python only when the font is out of date.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SNOW_GLYPHS } from '../apps/web/src/lib/snowGlyphs';
import {
  FONT_PATH,
  FONT_SCRIPT,
  OWNED_DIRS,
  WEB_FONT,
  drift,
  fontRecipe,
  fontSourcePath,
  fontState,
  generatedFiles,
  type Drift,
} from '../packages/mobile/src/index';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--check');
if (unknown.length) {
  console.error(`mobile-generate: unknown argument ${unknown.join(' ')} (only --check)`);
  process.exit(2);
}
const check = args.includes('--check');
const at = (path: string) => join(root, path);

const files = await generatedFiles({
  glyphs: SNOW_GLYPHS,
  favicon: readFileSync(at('apps/web/public/snow/favicon.svg'), 'utf8'),
});

// The answer font: current when the recipe stamped in it is that of the files in the repo now.
const recipe = fontRecipe(
  readFileSync(at(FONT_SCRIPT)),
  readFileSync(at(fontSourcePath(readdirSync(at('node_modules/.pnpm'))))),
  readFileSync(at(WEB_FONT)),
);
const committedFont = existsSync(at(FONT_PATH)) ? readFileSync(at(FONT_PATH)) : undefined;
const font = fontState(committedFont, recipe);
let fontDrift: Drift | undefined;
if (font === 'current') {
  files.push({ path: FONT_PATH, contents: committedFont! });
} else if (check) {
  fontDrift = { path: FONT_PATH, problem: font };
} else {
  let built: Buffer;
  try {
    built = execFileSync('python3', [at(FONT_SCRIPT), '--ttf', '--out', '-'], {
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch {
    console.error(
      `mobile:generate: ${FONT_PATH} is out of date, and ${FONT_SCRIPT} --ttf couldn't build it. ` +
        'It needs python3 with fontTools 4.66.1 and brotli: pip install fonttools==4.66.1 brotli',
    );
    process.exit(1);
  }
  if (fontState(built, recipe) !== 'current') {
    console.error(
      `mobile:generate: ${FONT_SCRIPT} stamped another recipe than exportFont.ts expects`,
    );
    process.exit(1);
  }
  files.push({ path: FONT_PATH, contents: built });
}

const onDisk = new Map<string, Buffer>();
const read = (path: string) => {
  if (existsSync(at(path))) onDisk.set(path, readFileSync(at(path)));
};
for (const f of files) read(f.path);
// Every file in the folders the generator owns, at any depth. Hidden files (a Mac's .DS_Store)
// aren't the generator's.
const walk = (dir: string) => {
  for (const name of readdirSync(at(dir))) {
    if (name.startsWith('.')) continue;
    const path = `${dir}/${name}`;
    if (statSync(at(path)).isDirectory()) walk(path);
    else read(path);
  }
};
for (const dir of OWNED_DIRS) if (existsSync(at(dir))) walk(dir);
// A font that isn't current can't be compared without building it: it is reported as it is.
if (fontDrift) onDisk.delete(FONT_PATH);
const drifted = [...drift(files, onDisk), ...(fontDrift ? [fontDrift] : [])].sort((a, b) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
);
const total = files.length + (fontDrift ? 1 : 0);

if (check) {
  if (drifted.length) {
    console.error(
      `mobile:check: ${drifted.length} of the files packages/mobile generates differ from what it writes now:`,
    );
    for (const d of drifted) console.error(`  ${d.problem.padEnd(7)} ${d.path}`);
    console.error(
      'Run pnpm mobile:generate and commit the result. Never edit these files by hand.',
    );
    process.exit(1);
  }
  console.log(`mobile:check: all ${total} generated files are up to date`);
} else {
  const contents = new Map(files.map((f) => [f.path, f.contents]));
  for (const d of drifted) {
    const full = at(d.path);
    if (d.problem === 'stale') {
      rmSync(full);
      // Folders the removal emptied, such as an image set's, up to the owned folder.
      const owner = OWNED_DIRS.find((dir) => d.path.startsWith(`${dir}/`))!;
      for (let dir = dirname(d.path); dir !== owner && !readdirSync(at(dir)).length;) {
        rmdirSync(at(dir));
        dir = dirname(dir);
      }
    } else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, contents.get(d.path)!);
    }
    console.log(`  ${d.problem === 'stale' ? 'removed' : 'wrote  '} ${d.path}`);
  }
  const written = drifted.filter((d) => d.problem !== 'stale').length;
  const removed = drifted.length - written;
  console.log(`mobile:generate: ${total} files, ${written} written, ${removed} stale removed`);
}
