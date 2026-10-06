/**
 * Records real upstream responses for the provider tests:
 *
 *   tsx scripts/record-fixtures.ts            # live APIs
 *   tsx scripts/record-fixtures.ts --synthetic # offline stand-in
 *
 * Tests never call the network; they read these files.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS } from '../packages/core/src/index';
import {
  NASA_POWER_URL,
  OPEN_METEO_FREE,
  buildClimatologyUrl,
  buildForecastUrl,
  buildSearchUrl,
  createSyntheticFetch,
} from '../packages/providers/src/index';
import cities from '../data/cities.json' with { type: 'json' };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'packages/providers/test/fixtures');
mkdirSync(out, { recursive: true });

const synthetic = process.argv.includes('--synthetic');
const fetcher = synthetic
  ? createSyntheticFetch(cities, () => new Date('2026-10-06T08:00:00Z'))
  : (url: string) => fetch(url, { headers: { 'user-agent': 'isithot.today fixture recorder' } });

const NEWCASTLE = { lat: 54.95, lon: -1.6 };
const SEVILLE = { lat: 37.4, lon: -6 };

const jobs: Array<[string, string]> = [
  ['open-meteo-forecast-newcastle.json', buildForecastUrl(OPEN_METEO_FREE, NEWCASTLE, MODELS)],
  ['open-meteo-forecast-seville.json', buildForecastUrl(OPEN_METEO_FREE, SEVILLE, MODELS)],
  ['open-meteo-search-newcastle.json', buildSearchUrl(OPEN_METEO_FREE, 'Newcastle', 8)],
  ['open-meteo-search-none.json', buildSearchUrl(OPEN_METEO_FREE, 'Xqzvbnm', 8)],
  ['nasa-power-newcastle.json', buildClimatologyUrl(NASA_POWER_URL, { lat: 55, lon: -1.5 })],
];

for (const [file, url] of jobs) {
  const res = await fetcher(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status} ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  writeFileSync(join(out, file), JSON.stringify(body, null, 1) + '\n');
  console.log(`${synthetic ? 'synthetic' : 'recorded'} ${file} (${text.length} bytes)`);
}
writeFileSync(
  join(out, 'SOURCE.md'),
  synthetic
    ? 'These fixtures are synthetic stand-ins in the upstream formats. Re-record with `pnpm fixtures`.\n'
    : `Recorded from the live APIs on ${new Date().toISOString()}.\n`,
);
