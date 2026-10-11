#!/usr/bin/env node
/**
 * Adds each city's height (whole metres) to data/cities.json from a GeoNames dump, so city pages
 * are forecast for the city's height rather than the terrain at the rounded grid point.
 *
 *   node scripts/city-heights.mjs <cities1000.txt | allCountries.txt>
 *
 * The dump is GeoNames' tab-separated format (https://download.geonames.org/export/dump/,
 * CC BY 4.0). A city takes GeoNames' `elevation`, else its `dem` (the terrain model's height at
 * the point; -9999 means none). Run it again after `pnpm cities` picks new cities; that script
 * keeps the heights already recorded.
 */
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dump = process.argv[2];
if (!dump) {
  console.error('Usage: node scripts/city-heights.mjs <GeoNames dump, e.g. cities1000.txt>');
  process.exit(1);
}

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'data/cities.json');
const cities = JSON.parse(readFileSync(file, 'utf8'));
const wanted = new Set(cities.map((c) => String(c.geonameId)));

/** GeoNames columns (0-based): 0 geonameid, 15 elevation, 16 dem. */
const heights = new Map();
const lines = createInterface({ input: createReadStream(dump, 'utf8'), crlfDelay: Infinity });
for await (const line of lines) {
  const cols = line.split('\t');
  if (!wanted.has(cols[0])) continue;
  const elevation = cols[15] === '' ? NaN : Number(cols[15]);
  const dem = cols[16] === '' ? NaN : Number(cols[16]);
  const height = Number.isFinite(elevation) ? elevation : dem !== -9999 ? dem : NaN;
  if (Number.isFinite(height)) heights.set(cols[0], Math.round(height));
}

let missing = 0;
const out = cities.map((c) => {
  const { elevation: _old, ...rest } = c;
  const height = heights.get(String(c.geonameId));
  if (height === undefined) {
    missing++;
    console.warn(`No height for ${c.name} (${c.geonameId})`);
    return rest;
  }
  return { ...rest, elevation: height };
});
writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log(`data/cities.json: heights for ${cities.length - missing} of ${cities.length} cities`);
