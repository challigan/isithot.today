#!/usr/bin/env node
/** Prints which models returned data in the recorded fixtures (used in CI logs). */
import { readFileSync } from 'node:fs';

const dir = new URL('../packages/providers/test/fixtures/', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));

for (const name of ['open-meteo-forecast-newcastle.json', 'open-meteo-forecast-seville.json']) {
  const f = read(name);
  const times = f.hourly?.time ?? [];
  const dates = [...new Set(times.map((t) => t.slice(0, 10)))];
  console.log(`${name}: timezone=${f.timezone} offset=${f.utc_offset_seconds} dates=${dates}`);
  for (const [key, values] of Object.entries(f.hourly ?? {})) {
    if (key === 'time') continue;
    // Each day's maximum and how many hours have a value.
    const days = dates.map((d) => {
      const v = values.filter((_, i) => times[i].startsWith(d) && values[i] !== null);
      return v.length ? `${Math.max(...v)}(${v.length}h)` : '-';
    });
    console.log(`  ${key}: ${days.join(' ')}`);
  }
}
for (const place of ['newcastle', 'seville', 'london', 'singapore']) {
  const nasa = read(`nasa-power-${place}.json`);
  console.log(
    `nasa ${place} ${JSON.stringify(nasa.geometry?.coordinates)}: ${JSON.stringify(nasa.properties?.parameter)}`,
  );
}
const search = read('open-meteo-search-newcastle.json');
console.log(
  `search: ${search.results?.map((r) => `${r.name}/${r.country_code}/${r.id}`).join(', ')}`,
);

// Compact copies for the log, so they can be committed as test fixtures.
if (process.argv.includes('--print')) {
  const { readdirSync } = await import('node:fs');
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    console.log(`FIXTURE ${name} ${JSON.stringify(read(name))}`);
  }
}
