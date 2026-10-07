#!/usr/bin/env node
/** Prints which models returned data in the recorded fixtures (used in CI logs). */
import { readFileSync } from 'node:fs';

const dir = new URL('../packages/providers/test/fixtures/', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));

for (const name of ['open-meteo-forecast-newcastle.json', 'open-meteo-forecast-seville.json']) {
  const f = read(name);
  console.log(`${name}: timezone=${f.timezone} dates=${f.daily.time.join(',')}`);
  for (const [key, values] of Object.entries(f.daily)) {
    if (key === 'time') continue;
    console.log(`  ${key}: ${JSON.stringify(values)}`);
  }
  const hourlyKeys = Object.keys(f.hourly ?? {}).filter((k) => k !== 'time');
  console.log(`  hourly keys: ${hourlyKeys.join(', ')}`);
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
