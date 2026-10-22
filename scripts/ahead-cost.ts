/**
 * What `ahead=snow` adds to an answer (DECISIONS "API contract"), on synthetic data: the bytes,
 * raw and gzipped, for a snowy, a mixed and a dry place, and the CPU time per request. Warm is
 * the forecast and normals cached and the code run before: whole requests with and without
 * `ahead`, and `snowAhead` alone. Cold is `snowAhead`'s first run in a new process, after that
 * process's first request has done the rest of the work. Also what the fields every answer
 * gained with it (`links`, `updated`, the week rows' counts and snow days' `bandLabel`) add.
 *
 *   tsx scripts/ahead-cost.ts
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  AHEAD,
  judgeSnowSeries,
  localDate,
  snowAhead,
  snowSeries,
  type MonthlyNormals,
} from '../packages/core/src/index';
import { createSyntheticFetch, type Forecast } from '../packages/providers/src/index';
import {
  CITIES,
  MemoryKV,
  getToday,
  resolveServerConfig,
  type KV,
} from '../packages/server/src/index';
import { withoutAdditions } from '../packages/server/test/contract';

const PLACES = [
  { kind: 'snowy', place: 'aberdeen-gb', at: '2026-12-02T09:05:00Z' },
  { kind: 'mixed', place: 'reykjavik-is', at: '2026-12-02T15:05:00Z' },
  { kind: 'dry', place: 'leeds-gb', at: '2026-10-19T09:05:00Z' },
];

/** The server at `iso`, keeping the forecast and snow normals its answers are worked out from. */
function serverAt(iso: string) {
  const now = new Date(iso);
  const memory = new MemoryKV();
  const kept: { forecast?: Forecast; normals?: MonthlyNormals | null } = {};
  const cache: KV = {
    get: (key) => memory.get(key),
    set: (key, value) => {
      if (key.startsWith('forecast/')) kept.forecast = (value as { forecast: Forecast }).forecast;
      if (key.startsWith('climate-snow/')) {
        kept.normals = (value as { normals: MonthlyNormals | null }).normals;
      }
      return memory.set(key, value);
    },
  };
  const deps = {
    config: resolveServerConfig(() => undefined),
    cache,
    fetch: createSyntheticFetch(CITIES, () => now),
    now: () => now,
    waitUntil: () => {},
    log: () => {},
  };
  /** `snowAhead` on what getToday gives it (once a request has filled the cache). */
  const ahead = () => {
    const { timezone, days } = kept.forecast!;
    const judged = judgeSnowSeries(snowSeries(days), 'c', timezone);
    const today = localDate(timezone, now);
    const from = days.filter((d) => d.date >= today);
    return () => snowAhead(judged, from, now.getTime(), AHEAD.hours, 'c', kept.normals ?? null);
  };
  return { deps, ahead };
}

const query = (place: string, ahead: boolean) =>
  new URLSearchParams(`place=${place}&units=c${ahead ? '&ahead=snow' : ''}`);

/** How long `run` takes, ms. */
async function time(run: () => unknown): Promise<number> {
  const start = performance.now();
  await run();
  return performance.now() - start;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!;
const gz = (text: string) => gzipSync(text).length;
const kb = (bytes: number) => `${(bytes / 1024).toFixed(2)} KB`;
const ms = (value: number) => `${value.toFixed(2)} ms`;

// A new process: its first request without `ahead`, then snowAhead's first run.
if (process.argv[2] === '--cold') {
  const [, , , place, iso] = process.argv;
  const server = serverAt(iso!);
  const request = await time(() => getToday(query(place!, false), null, server.deps));
  const run = server.ahead();
  console.log(JSON.stringify({ request, ahead: await time(run) }));
  process.exit(0);
}

const self = fileURLToPath(import.meta.url);
const cold = (place: string, iso: string): { request: number; ahead: number } =>
  JSON.parse(
    execFileSync(process.execPath, [...process.execArgv, self, '--cold', place, iso], {
      encoding: 'utf8',
    }),
  );

for (const { kind, place, at } of PLACES) {
  const server = serverAt(at);
  const body = (await getToday(query(place, true), null, server.deps)).body;
  const snow = (body as { snow: { ahead: { today: { band: string } }[] } }).snow;
  const { ahead, ...rest } = snow;
  const full = JSON.stringify(body);
  const without = JSON.stringify({ ...body, snow: rest });
  const before = JSON.stringify(withoutAdditions(body));
  console.log(`${place} (${kind}) at ${at}: Today ${ahead.map((e) => e.today.band).join(', ')}`);
  console.log(
    `  ahead: ${ahead.length} entries, +${kb(full.length - without.length)} raw, ` +
      `+${kb(gz(full) - gz(without))} gzipped (${kb(gz(without))} to ${kb(gz(full))})`,
  );
  console.log(
    `  links, updated and the row fields: +${kb(without.length - before.length)} raw, ` +
      `+${kb(gz(without) - gz(before))} gzipped`,
  );

  // Warm: the two requests in turn on one cache, after a few to settle; then snowAhead alone.
  const plain: number[] = [];
  const asked: number[] = [];
  for (let i = 0; i < 220; i++) {
    const a = await time(() => getToday(query(place, false), null, server.deps));
    const b = await time(() => getToday(query(place, true), null, server.deps));
    if (i >= 20) {
      plain.push(a);
      asked.push(b);
    }
  }
  const run = server.ahead();
  const alone: number[] = [];
  const text: number[][] = [[], []];
  for (let i = 0; i < 220; i++) {
    const t = await time(run);
    // The response's JSON, without and with the entries.
    const a = await time(() => JSON.stringify({ ...body, snow: rest }));
    const b = await time(() => JSON.stringify(body));
    if (i >= 20) {
      alone.push(t);
      text[0]!.push(a);
      text[1]!.push(b);
    }
  }
  console.log(
    `  warm (medians of 200): requests ${ms(median(plain))} without, ${ms(median(asked))} with; ` +
      `snowAhead ${ms(median(alone))}; JSON ${ms(median(text[0]!))} without, ` +
      `${ms(median(text[1]!))} with`,
  );

  const runs = Array.from({ length: 15 }, () => cold(place, at));
  const firsts = runs.map((r) => r.ahead).sort((a, b) => a - b);
  console.log(
    `  cold (medians of ${runs.length} new processes): snowAhead's first run ${ms(median(firsts))} ` +
      `(${ms(firsts[0]!)} to ${ms(firsts.at(-1)!)}), after a first request of ` +
      `${ms(median(runs.map((r) => r.request)))}`,
  );
}
