/**
 * The native apps' fixtures (iOS build spec, section 7.3): real answers from the real
 * `handleToday`, as the apps ask for them (`todayQuery` with `ahead=snow`), on synthetic data at a
 * fixed moment. The Swift tests decode them, so an API change that breaks the app's decoder fails
 * there. Nothing here touches the disk: `scripts/mobile-generate.ts` writes the files.
 */
import type { TodayResponse, Units } from '@isithot/core';
import { todayQuery, type Target } from '@isithot/client';
import { createSyntheticFetch } from '@isithot/providers';
import { CITIES, MemoryKV, createDeps, handleToday, type Platform } from '@isithot/server';

export interface FixtureSpec {
  /** The file's name, without `.json`. */
  name: string;
  target: Target;
  /** As the app sends them: null for a first launch, which takes the server's. */
  units: Units | null;
  /** The moment the server answers at, ISO 8601 UTC. */
  now: string;
  /** What the answer shows, and why this moment. */
  note: string;
}

/** What each file says about itself: the query asked, the moment and the note. */
export interface FixtureInfo {
  query: string;
  now: string;
  note: string;
}

export type Fixture = { _fixture: FixtureInfo } & TodayResponse;

export const FIXTURES: readonly FixtureSpec[] = [
  {
    name: 'aberdeen-snow',
    target: { kind: 'city', slug: 'aberdeen-gb' },
    units: 'c',
    now: '2026-12-02T09:05:00.000Z',
    note:
      'Snow today, and snow for the rest of the day in every hour ahead. It is raining at 9am, ' +
      'so Now says No until the snow comes.',
  },
  {
    name: 'leeds-dry',
    target: { kind: 'city', slug: 'leeds-gb' },
    units: 'c',
    now: '2026-12-01T09:05:00.000Z',
    note:
      'No snow today (rain, not snow) or tomorrow (dry), and a week of No with only a few flakes ' +
      'on Saturday, so every reason appears: rain, dry and too warm. The rest of the day is rain ' +
      'until 2pm, then dry. Chosen because the synthetic forecast for Leeds gives all of that at ' +
      '9:05am on 1 December.',
  },
];

const ENV: Record<string, string> = { DATA_SOURCE: 'synthetic' };

/**
 * The server's dependencies for `DATA_SOURCE=synthetic`, with the clock fixed at `now`: the
 * synthetic upstream makes its forecast from the same clock, and a memory cache of its own means
 * no answer depends on one asked before it.
 */
function fixedAt(now: Date) {
  return (platform: Platform) => ({
    ...createDeps(platform),
    cache: new MemoryKV(),
    fetch: createSyntheticFetch(CITIES, () => now),
    now: () => now,
  });
}

/**
 * The server's answer to `spec`'s request at `spec.now`, as it sends it, with `_fixture` first.
 * Run one at a time: the server shares a forecast request in flight for the same place.
 */
export async function makeFixture(spec: FixtureSpec): Promise<Fixture> {
  const now = new Date(spec.now);
  const query = todayQuery(spec.target, spec.units, { ahead: ['snow'] });
  const res = await handleToday(
    new Request(`https://willitsnow.today/api/v1/today?${query}`),
    { env: (name) => ENV[name] },
    fixedAt(now),
  );
  const text = await res.text();
  if (res.status !== 200) {
    throw new Error(`${spec.name}: the server answered ${res.status}: ${text}`);
  }
  const body = JSON.parse(text) as TodayResponse;
  return { _fixture: { query, now: now.toISOString(), note: spec.note }, ...body };
}

/** A fixture as its file has it: two-space JSON in the server's key order, then a newline. */
export function fixtureJson(fixture: Fixture): string {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}
