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
const shifts = a['layout-shifts']?.details?.items ?? [];
for (const item of shifts.slice(0, 5)) {
  console.log(
    `  shift ${item.score?.toFixed?.(3) ?? item.score}: ${item.node?.selector ?? '?'} ${item.node?.snippet ?? ''}`,
  );
}
const lcp = a['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node;
if (lcp) console.log(`  LCP element: ${lcp.selector} ${lcp.snippet}`);
for (const c of Object.values(r.categories)) {
  for (const ref of c.auditRefs) {
    const audit = a[ref.id];
    if (ref.weight > 0 && audit && audit.score !== null && audit.score < 0.9) {
      console.log(`  - ${c.title}: ${audit.title} (${audit.displayValue ?? audit.score})`);
    }
  }
}

// Why LCP took as long as it did, and where main-thread time went.
const phases = a['largest-contentful-paint-element']?.details?.items?.[1]?.items ?? [];
if (phases.length) {
  console.log(
    `  LCP phases: ${phases.map((p) => `${p.phase}=${Math.round(p.timing)}ms`).join(' ')}`,
  );
}
const api = (a['network-requests']?.details?.items ?? []).filter((i) => i.url.includes('/api/'));
for (const i of api) {
  console.log(
    `  request ${new URL(i.url).pathname}${new URL(i.url).search}: ${Math.round(i.networkRequestTime ?? i.startTime)}-${Math.round(i.networkEndTime ?? i.endTime)}ms status=${i.statusCode}`,
  );
}
const work = a['mainthread-work-breakdown']?.details?.items ?? [];
console.log(
  `  main thread: ${work
    .slice(0, 5)
    .map((w) => `${w.groupLabel ?? w.group}=${Math.round(w.duration)}ms`)
    .join(' ')}`,
);
for (const t of (a['long-tasks']?.details?.items ?? []).slice(0, 5)) {
  console.log(`  long task ${Math.round(t.startTime)}ms +${Math.round(t.duration)}ms ${t.url}`);
}
for (const id of ['color-contrast']) {
  for (const item of (a[id]?.details?.items ?? []).slice(0, 8)) {
    console.log(`  ${id}: ${item.node?.selector} ${item.node?.explanation?.split('\n')[1] ?? ''}`);
  }
}
