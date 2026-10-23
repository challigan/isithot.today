#!/usr/bin/env tsx
/**
 * The notifications' run as a dry run, on synthetic forecasts at a fixed moment: every city
 * page's place registered in °C and in °F with every switch on (as the devices handler would
 * store it), then each notification the run would send, title and body. Nothing is sent, nothing
 * leaves this machine, and the store is in memory. The quickest check of the copy (iOS build
 * spec, section 8.7).
 *
 *   pnpm tsx scripts/alerts-dry-run.ts --now 2026-10-18T18:05:00Z
 *
 * At that moment the synthetic data gives section 8.5's example for Durham, "Snow likely in Durham
 * tomorrow" / "1 to 2cm of snow. Mostly between 2am and 6am. 5 of 6 forecasts expect snow." The
 * spec's own example moment, 2026-12-01T18:05:00Z, has no snow in Durham in synthetic data.
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { TodayResponse, Units } from '../packages/core/src/index';
import { createSyntheticFetch } from '../packages/providers/src/index';
import {
  CITIES,
  MemoryAlertStore,
  MemoryKV,
  getToday,
  idsKey,
  regKey,
  registrationId,
  resolveServerConfig,
  runAlerts,
  runSummary,
  type AlertRecord,
  type ServerDeps,
} from '../packages/server/src/index';

const UNITS: readonly Units[] = ['c', 'f'];
const DEGREES: Record<Units, string> = { c: '°C', f: '°F' };

/** A made-up device token for a place and units: 64 hex characters, the same every time. */
const tokenFor = (slug: string, units: Units): string =>
  createHash('sha256').update(`alerts-dry-run:${slug}:${units}`).digest('hex');

/** Every line the dry run prints for `now`: a heading, the run's counts, then each notification. */
export async function dryRunLines(now: Date): Promise<string[]> {
  const deps: ServerDeps = {
    config: resolveServerConfig(() => undefined),
    cache: new MemoryKV(10_000),
    fetch: createSyntheticFetch(CITIES, () => now),
    now: () => now,
    waitUntil: (promise) => void promise.catch(() => {}),
    log: () => {},
  };
  // The registrations' own cache, so the run's counts show what it would fetch.
  const seeding: ServerDeps = { ...deps, cache: new MemoryKV(10_000) };
  const store = new MemoryAlertStore();
  const at = now.toISOString();
  for (const city of CITIES) {
    // The devices handler reads the place's zone from its forecast, as here.
    const today = await getToday(new URLSearchParams({ place: city.slug }), null, seeding);
    if (today.status !== 200) throw new Error(`no forecast for ${city.slug}`);
    const tz = (today.body as TodayResponse).location.timezone;
    for (const units of UNITS) {
      const token = tokenFor(city.slug, units);
      const id = registrationId('snow', token);
      const record: AlertRecord = {
        v: 1,
        id,
        app: 'snow',
        platform: 'ios',
        env: 'sandbox',
        token,
        query: `place=${city.slug}`,
        name: city.name,
        tz,
        units,
        alerts: { snow: { evening: true, morning: true, possible: true } },
        createdAt: at,
        updatedAt: at,
        seenAt: at,
        appVersion: 'dry run',
      };
      await store.set(regKey(tz, 'snow', id), record);
      await store.set(idsKey('snow', id), { tz });
    }
  }

  const result = await runAlerts({
    deps,
    store,
    sender: () => {
      throw new Error('a dry run never connects to Apple');
    },
    keys: {},
    now: now.getTime(),
    budgetMs: 10 * 60_000,
    dryRun: true,
    maxFetches: Infinity,
    // Fixed, so the counts line is the same every time.
    clock: () => 0,
  });
  const order = (n: (typeof result.notifications)[number]) =>
    `${n.name}\u0000${n.kind}\u0000${n.units}`;
  const notes = [...result.notifications].sort((a, b) => order(a).localeCompare(order(b)));
  return [
    `Dry run at ${at} on synthetic forecasts: ${CITIES.length} places, each in °C and °F, every switch on.`,
    runSummary(result),
    ...(notes.length ? [''] : []),
    ...notes.flatMap((n) => [
      `${n.name}, ${n.kind}, ${DEGREES[n.units]}`,
      `  ${n.title}`,
      `  ${n.body}`,
    ]),
    `${notes.length} ${notes.length === 1 ? 'notification' : 'notifications'}.`,
  ];
}

function argument(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const iso = argument('--now');
  const now = new Date(iso ?? '');
  if (!iso || Number.isNaN(now.getTime())) {
    console.error('Usage: pnpm tsx scripts/alerts-dry-run.ts --now 2026-10-18T18:05:00Z');
    process.exitCode = 2;
  } else {
    for (const line of await dryRunLines(now)) console.log(line);
  }
}
