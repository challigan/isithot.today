#!/usr/bin/env tsx
/**
 * The notifications' run as a dry run, on synthetic forecasts at a fixed moment: every city
 * page's place registered in °C and in °F with every switch on (as the devices handler would
 * store it), and two of them saved on a phone in Tokyo, then each notification the run would
 * send, title and body, a line for each place of a phone. Nothing is sent, nothing leaves this
 * machine, and the store is in memory. The quickest check of the copy (iOS build spec, section
 * 8.7).
 *
 *   pnpm tsx scripts/alerts-dry-run.ts --now 2026-10-18T18:05:00Z
 *
 * At that moment the synthetic data gives section 8.5's example for Durham, "Snow likely in Durham
 * tomorrow" / "1 to 2cm of snow. Mostly between 2am and 6am. 5 of 6 forecasts expect snow." The
 * spec's own example moment, 2026-12-01T18:05:00Z, has no snow in Durham in synthetic data. At
 * 18:05 in London it is 03:05 in Tokyo, so the saved places' notifications go silently.
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
  placeId,
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
/** The city pages saved, in °C, on a phone in Tokyo (with snow in Kendal and Shrewsbury then). */
const SAVED = ['kendal-gb', 'shrewsbury-gb'];
const PHONE_TZ = 'Asia/Tokyo';

/** A made-up 64-hex value for a name, the same every time: a device token, or a salt's source. */
const hexFor = (name: string): string =>
  createHash('sha256').update(`alerts-dry-run:${name}`).digest('hex');

/** A made-up device token for a place and units. */
const tokenFor = (slug: string, units: Units): string => hexFor(`${slug}:${units}`);

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
  const registered = (
    token: string,
    city: (typeof CITIES)[number],
    tz: string,
    units: Units,
  ): AlertRecord => ({
    v: 1,
    id: registrationId('snow', token),
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
  });
  const zones = new Map<string, string>();
  for (const city of CITIES) {
    // The devices handler reads the place's zone from its forecast, as here.
    const today = await getToday(new URLSearchParams({ place: city.slug }), null, seeding);
    if (today.status !== 200) throw new Error(`no forecast for ${city.slug}`);
    const tz = (today.body as TodayResponse).location.timezone;
    zones.set(city.slug, tz);
    for (const units of UNITS) {
      const record = registered(tokenFor(city.slug, units), city, tz, units);
      await store.set(regKey(tz, 'snow', record.id), record);
      await store.set(idsKey('snow', record.id), { tz });
    }
  }
  // The phone in Tokyo: no free place, and each saved place under its pid, with the phone's zone.
  const phone = hexFor('a phone in Tokyo');
  const phoneId = registrationId('snow', phone);
  const salt = hexFor('salt').slice(0, 32);
  const saved: string[] = [];
  for (const slug of SAVED) {
    const city = CITIES.find((c) => c.slug === slug)!;
    const record = registered(phone, city, zones.get(slug)!, 'c');
    const key = regKey(record.tz, 'snow', phoneId, placeId(salt, record.query));
    await store.set(key, { ...record, deviceTz: PHONE_TZ });
    saved.push(key);
  }
  await store.set(idsKey('snow', phoneId), { v: 2, saved, salt, updatedAt: at });

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
    `${n.name}\u0000${n.kind}\u0000${n.units}\u0000${n.slot ?? ''}`;
  const notes = [...result.notifications].sort((a, b) => order(a).localeCompare(order(b)));
  return [
    `Dry run at ${at} on synthetic forecasts: ${CITIES.length} places, each in °C and °F, every switch on, and ${SAVED.length} of them saved on a phone in Tokyo.`,
    runSummary(result),
    ...(notes.length ? [''] : []),
    ...notes.flatMap((n) => [
      [
        `${n.name}, ${n.kind}, ${DEGREES[n.units]}`,
        ...(n.slot ? [`saved place ${n.slot}`] : []),
        ...(n.silent ? ['silent'] : []),
      ].join(', '),
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
