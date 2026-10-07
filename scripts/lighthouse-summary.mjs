#!/usr/bin/env node
/** Prints Lighthouse category scores and the key metrics from a JSON report. */
import { existsSync, readFileSync } from 'node:fs';

const [file, label = ''] = process.argv.slice(2);
if (!existsSync(file)) {
  console.log(`${label}: no Lighthouse report`);
  process.exit(0);
}
const r = JSON.parse(readFileSync(file, 'utf8'));
const scores = Object.values(r.categories)
  .map((c) => `${c.title}=${Math.round(c.score * 100)}`)
  .join(' ');
const a = r.audits;
const metric = (id) => a[id]?.displayValue ?? '-';
console.log(`${label}: ${scores}`);
console.log(
  `  LCP=${metric('largest-contentful-paint')} CLS=${metric('cumulative-layout-shift')} TBT=${metric('total-blocking-time')} FCP=${metric('first-contentful-paint')}`,
);
for (const c of Object.values(r.categories)) {
  for (const ref of c.auditRefs) {
    const audit = a[ref.id];
    if (ref.weight > 0 && audit && audit.score !== null && audit.score < 0.9) {
      console.log(`  - ${c.title}: ${audit.title} (${audit.displayValue ?? audit.score})`);
    }
  }
}
