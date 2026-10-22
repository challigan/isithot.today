/**
 * The website's own requests to /api/v1/today, answered on synthetic data at a fixed moment, for
 * the contract test (contract.test.ts) and the snapshot it compares with
 * (fixtures/contract.json, written by `tsx scripts/contract-snapshot.ts`). The snapshot was taken
 * before the app additions (README "API", DECISIONS "API contract"), and leaves out the fields
 * they add, so the test proves every other field, and the headers, are as they were.
 */
import { createSyntheticFetch } from '@isithot/providers';
import { CITIES, MemoryKV, getToday, resolveServerConfig, type VisitorGeo } from '../src';

/** The answers' moment: 9am in London. */
export const CONTRACT_NOW = '2026-10-06T08:00:00Z';

/** The approximate place of the IP requests. */
const LEEDS: VisitorGeo = {
  city: 'Leeds',
  country: 'GB',
  region: 'England',
  lat: 53.7997,
  lon: -1.5492,
};

const SEARCHED =
  'lat=40.7&lon=-74&name=New+York&region=New+York&country=US&geonameId=5128581&elevation=10&source=search';

/**
 * The query strings the website sends (apps/web/src/scripts/app.ts `apiUrl`, and the city pages'
 * `todayForCity`): a city, device coordinates, a searched place and the IP location, each with
 * and without `units`, with `windUnits`, and with the `t` that asks past the caches.
 */
export const CONTRACT_REQUESTS: ReadonlyArray<{
  name: string;
  query: string;
  geo?: VisitorGeo;
}> = [
  { name: 'city', query: 'place=london-gb' },
  { name: 'city with units', query: 'place=london-gb&units=c' },
  { name: 'snowy city with units', query: 'place=reykjavik-is&units=c' },
  { name: 'city in °F with wind units', query: 'place=new-york-city-us&units=f&windUnits=mph' },
  { name: 'device', query: 'lat=54.95&lon=-1.6&source=device' },
  { name: 'device with units', query: 'lat=54.95&lon=-1.6&source=device&units=c' },
  { name: 'searched', query: SEARCHED },
  { name: 'searched with units', query: `${SEARCHED}&units=f` },
  { name: 'ip', query: '', geo: LEEDS },
  { name: 'ip with units', query: 'units=c', geo: LEEDS },
  { name: 'city asked past the caches', query: 'place=london-gb&units=c&t=494232' },
];

type Json = Record<string, unknown>;

const each = (rows: unknown, keys: readonly string[]): void => {
  if (!Array.isArray(rows)) return;
  for (const row of rows as Json[]) for (const k of keys) delete row[k];
};

/**
 * A response as the website receives it (through JSON), without the fields S1 to S3 add to every
 * answer and the opt-in `snow.ahead`.
 */
export function withoutAdditions(body: unknown): Json {
  const out = JSON.parse(JSON.stringify(body)) as Json;
  delete out.links;
  delete out.updated;
  const rain = out.rain as Json | undefined;
  each((rain?.week as Json | undefined)?.days, ['chance', 'wet', 'total']);
  const snow = out.snow as Json | undefined;
  if (snow) {
    delete snow.ahead;
    each(snow.days, ['bandLabel']);
    each((snow.week as Json | undefined)?.days, ['chance', 'snowy', 'total', 'reason']);
  }
  return out;
}

/** One request's answer at CONTRACT_NOW, on a cache of its own. */
export async function contractResponse(query: string, geo: VisitorGeo | null = null) {
  const now = new Date(CONTRACT_NOW);
  const r = await getToday(new URLSearchParams(query), geo, {
    config: resolveServerConfig(() => undefined),
    cache: new MemoryKV(),
    fetch: createSyntheticFetch(CITIES, () => now),
    now: () => now,
    waitUntil: () => {},
    log: () => {},
  });
  return { status: r.status, headers: r.headers, body: r.body };
}

/**
 * Every request's answer, as the snapshot keeps it: a body the same as an earlier request's (the
 * units given are the default) names that request instead of repeating it.
 */
export async function contractSnapshot() {
  const responses = [];
  const seen = new Map<string, string>();
  for (const { name, query, geo } of CONTRACT_REQUESTS) {
    const r = await contractResponse(query, geo ?? null);
    const body = withoutAdditions(r.body);
    const text = JSON.stringify(body);
    const same = seen.get(text);
    if (!same) seen.set(text, name);
    responses.push({
      name,
      query,
      status: r.status,
      headers: r.headers,
      ...(same ? { sameBodyAs: same } : { body }),
    });
  }
  return { now: CONTRACT_NOW, responses };
}
