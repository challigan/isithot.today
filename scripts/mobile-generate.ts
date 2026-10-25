/**
 * Writes what packages/mobile generates for the native apps into apps/ios (iOS build spec,
 * section 7.1): the Swift for the copy, questions, constants, keys, fonts and palettes, the
 * fixtures the Swift tests decode, the golden vectors their ports are checked against, the snow
 * glyphs' asset catalogues, the app icon and the fonts: the answer word's and the text faces.
 *
 *   pnpm mobile:generate   writes the files, and removes stale ones from the folders it owns
 *   pnpm mobile:check      changes nothing; fails, listing each file, when any differs
 *
 * The generated files are never edited by hand: change the TypeScript and generate again.
 *
 * This script reads what the generators take from the website (the glyphs' SVG and the favicon)
 * and passes it in. The fonts are built by scripts/make-answer-font.py and
 * scripts/make-text-fonts.py, which need Python and fontTools, so they are checked by their
 * recipes instead (packages/mobile/src/exportFont.ts), and generating runs the Python only when a
 * font is out of date.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SNOW_GLYPHS } from '../apps/web/src/lib/snowGlyphs';
import {
  FONT_PATH,
  FONT_SCRIPT,
  OWNED_DIRS,
  TEXT_FONTS,
  TEXT_FONT_SCRIPT,
  TEXT_RECIPE,
  WEB_FONT,
  drift,
  fontPath,
  fontRecipe,
  fontSourcePath,
  fontState,
  generatedFiles,
  textFontRecipe,
  textFontSourcePaths,
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

const pnpm = readdirSync(at('node_modules/.pnpm'));
// The fonts that aren't current: in a check, reported as they are, since they can't be compared
// without building them.
const fontDrift: Drift[] = [];
function needsPython(script: string, built: string): never {
  console.error(
    `mobile:generate: ${built} is out of date, and ${script} couldn't build it. ` +
      'It needs python3 with fontTools 4.66.1 and brotli: pip install fonttools==4.66.1 brotli',
  );
  process.exit(1);
}
const read = (path: string) => (existsSync(at(path)) ? readFileSync(at(path)) : undefined);

// The answer font: current when the recipe stamped in it is that of the files in the repo now.
const recipe = fontRecipe(
  readFileSync(at(FONT_SCRIPT)),
  readFileSync(at(fontSourcePath(pnpm))),
  readFileSync(at(WEB_FONT)),
);
const committedFont = read(FONT_PATH);
const font = fontState(committedFont, recipe);
if (font === 'current') {
  files.push({ path: FONT_PATH, contents: committedFont! });
} else if (check) {
  fontDrift.push({ path: FONT_PATH, problem: font });
} else {
  let built: Buffer;
  try {
    built = execFileSync('python3', [at(FONT_SCRIPT), '--ttf', '--out', '-'], {
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch {
    needsPython(`${FONT_SCRIPT} --ttf`, FONT_PATH);
  }
  if (fontState(built, recipe) !== 'current') {
    console.error(
      `mobile:generate: ${FONT_SCRIPT} stamped another recipe than exportFont.ts expects`,
    );
    process.exit(1);
  }
  files.push({ path: FONT_PATH, contents: built });
}

// The text faces, each current when it carries the recipe of the script and the two subsets now.
// The script builds all three at once, so when any isn't current it builds them into a folder
// of their own, and those that come out the same as the committed ones aren't written.
const textRecipe = textFontRecipe(
  readFileSync(at(TEXT_FONT_SCRIPT)),
  ...(textFontSourcePaths(pnpm).map((path) => readFileSync(at(path))) as [Buffer, Buffer]),
);
const textFonts = TEXT_FONTS.map((face) => {
  const path = fontPath(face.name);
  const committed = read(path);
  return { path, committed, state: fontState(committed, textRecipe, TEXT_RECIPE) };
});
if (textFonts.every((f) => f.state === 'current')) {
  for (const f of textFonts) files.push({ path: f.path, contents: f.committed! });
} else if (check) {
  for (const f of textFonts) {
    if (f.state === 'current') files.push({ path: f.path, contents: f.committed! });
    else fontDrift.push({ path: f.path, problem: f.state });
  }
} else {
  const out = mkdtempSync(join(tmpdir(), 'text-fonts-'));
  let built: Buffer[] | undefined;
  try {
    execFileSync('python3', [at(TEXT_FONT_SCRIPT), '--out', out], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    built = TEXT_FONTS.map((face) => readFileSync(join(out, `${face.name}.ttf`)));
  } catch {
    // Said below, once the folder is gone.
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
  if (!built) needsPython(TEXT_FONT_SCRIPT, textFonts.find((f) => f.state !== 'current')!.path);
  for (const [i, f] of textFonts.entries()) {
    if (fontState(built[i], textRecipe, TEXT_RECIPE) !== 'current') {
      console.error(
        `mobile:generate: ${TEXT_FONT_SCRIPT} stamped another recipe than exportFont.ts expects`,
      );
      process.exit(1);
    }
    files.push({ path: f.path, contents: built[i]! });
  }
}

const onDisk = new Map<string, Buffer>();
const load = (path: string) => {
  if (existsSync(at(path))) onDisk.set(path, readFileSync(at(path)));
};
for (const f of files) load(f.path);
// Every file in the folders the generator owns, at any depth. Hidden files (a Mac's .DS_Store)
// aren't the generator's.
const walk = (dir: string) => {
  for (const name of readdirSync(at(dir))) {
    if (name.startsWith('.')) continue;
    const path = `${dir}/${name}`;
    if (statSync(at(path)).isDirectory()) walk(path);
    else load(path);
  }
};
for (const dir of OWNED_DIRS) if (existsSync(at(dir))) walk(dir);
// A font that isn't current can't be compared without building it: it is reported as it is.
for (const d of fontDrift) onDisk.delete(d.path);
const drifted = [...drift(files, onDisk), ...fontDrift].sort((a, b) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
);
const total = files.length + fontDrift.length;

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
