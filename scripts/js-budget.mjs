#!/usr/bin/env node
/**
 * Fails when the site's JavaScript grows past the budget (25 KB gzipped, from the spec).
 * The dev-only ?preview=1 chunk is loaded on demand and does not count.
 *
 *   node scripts/js-budget.mjs [apps/web/dist]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET = 25 * 1024;
const dir = join(process.argv[2] ?? 'apps/web/dist', '_astro');
let total = 0;
for (const name of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const size = gzipSync(readFileSync(join(dir, name)), { level: 9 }).length;
  const counted = !name.startsWith('preview.');
  if (counted) total += size;
  console.log(
    `${String(size).padStart(7)} B  ${name}${counted ? '' : '  (on demand, not counted)'}`,
  );
}
console.log(`${String(total).padStart(7)} B  total gzipped (budget ${BUDGET} B)`);
if (total > BUDGET) {
  console.error('Site JavaScript is over budget.');
  process.exit(1);
}
