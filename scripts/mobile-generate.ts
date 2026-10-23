/**
 * Writes what packages/mobile generates for the native apps into apps/ios (iOS build spec,
 * section 7.1): for now, `Keys.swift` and the fixtures the Swift tests decode.
 *
 *   pnpm mobile:generate   writes the files, and removes stale ones from the folders it owns
 *   pnpm mobile:check      changes nothing; fails, listing each file, when any differs
 *
 * The generated files are never edited by hand: change the TypeScript and generate again.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNED_DIRS, drift, generatedFiles } from '../packages/mobile/src/index';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--check');
if (unknown.length) {
  console.error(`mobile-generate: unknown argument ${unknown.join(' ')} (only --check)`);
  process.exit(2);
}
const check = args.includes('--check');

const files = await generatedFiles();
const onDisk = new Map<string, string>();
const read = (path: string) => {
  const full = join(root, path);
  if (existsSync(full)) onDisk.set(path, readFileSync(full, 'utf8'));
};
for (const f of files) read(f.path);
for (const dir of OWNED_DIRS) {
  if (!existsSync(join(root, dir))) continue;
  // Hidden files (a Mac's .DS_Store) aren't the generator's.
  const names = readdirSync(join(root, dir)).filter((name) => !name.startsWith('.'));
  for (const name of names) read(`${dir}/${name}`);
}
const drifted = drift(files, onDisk);

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
  console.log(`mobile:check: all ${files.length} generated files are up to date`);
} else {
  const contents = new Map(files.map((f) => [f.path, f.contents]));
  for (const d of drifted) {
    const full = join(root, d.path);
    if (d.problem === 'stale') {
      rmSync(full);
    } else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, contents.get(d.path)!);
    }
    console.log(`  ${d.problem === 'stale' ? 'removed' : 'wrote  '} ${d.path}`);
  }
  const written = drifted.filter((d) => d.problem !== 'stale').length;
  const removed = drifted.length - written;
  console.log(
    `mobile:generate: ${files.length} files, ${written} written, ${removed} stale removed`,
  );
}
