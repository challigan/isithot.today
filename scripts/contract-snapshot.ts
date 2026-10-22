/**
 * Writes the contract test's snapshot of the website's answers (packages/server/test/contract.ts):
 *
 *   tsx scripts/contract-snapshot.ts
 *
 * It was taken before the app additions, and leaves out the fields they add, so running it again
 * must leave the file unchanged: a difference is a change to a field the website reads.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractSnapshot } from '../packages/server/test/contract';

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  '../packages/server/test/fixtures/contract.json',
);
const { now, responses } = await contractSnapshot();
// One response a line, so a difference shows which one changed.
const lines = responses.map((r) => JSON.stringify(r)).join(',\n');
writeFileSync(out, `{"now":${JSON.stringify(now)},"responses":[\n${lines}\n]}\n`);
console.log(`wrote ${out}`);
