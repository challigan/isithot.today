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
  // Each model's rain (mm) and snowfall (cm) per day as the parser works them out: the value at
  // stamp t + 1 fell in the hour from t, and a day needs all 24 hours (the forecast's very last
  // hour excepted). Snowfall is before the parser's warm guard and its cap at the precipitation.
  for (const [what, prefix, unit] of [
    ['rain', 'precipitation', 'mm'],
    ['snow', 'snowfall', 'cm'],
  ]) {
    const keys = Object.keys(f.hourly ?? {}).filter((k) => k.startsWith(prefix));
    if (!keys.length) console.log(`  ${what}: no ${prefix} in this recording`);
    for (const d of keys.length ? dates : []) {
      const hours = times.flatMap((t, i) => (t.startsWith(d) ? [i] : []));
      const totals = keys
        .map((key) => hours.map((i) => f.hourly[key][i + 1] ?? (i === times.length - 1 ? 0 : null)))
        .filter((values) => values.length === 24 && values.every((v) => v !== null))
        .map((values) => values.reduce((a, b) => a + b, 0))
        .sort((a, b) => a - b);
      const show = (v) => (v === undefined ? '-' : `${Math.round(v * 10) / 10}${unit}`);
      const mid = totals.length / 2;
      const median =
        totals.length % 2 ? totals[Math.floor(mid)] : (totals[mid - 1] + totals[mid]) / 2;
      console.log(
        `  ${what} ${d}: ${totals.length}/${keys.length} models with a full day,` +
          ` min ${show(totals[0])} median ${show(totals.length ? median : undefined)} max ${show(totals.at(-1))}`,
      );
    }
  }
}
for (const place of ['newcastle', 'seville', 'london', 'singapore']) {
  for (const name of [
    `nasa-power-${place}.json`,
    `nasa-power-rain-${place}.json`,
    `nasa-power-snow-${place}.json`,
  ]) {
    const nasa = read(name);
    console.log(
      `${name} ${JSON.stringify(nasa.geometry?.coordinates)}: ${JSON.stringify(nasa.properties?.parameter)}`,
    );
  }
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
