/**
 * The query strings the clients send, without the "?". The same state always makes the same
 * string, so every client asking for a place shares the CDN's entry for it.
 *
 * Swift: `IsItModel/TodayQuery.swift`, checked against the golden vectors in `query.json`.
 */
import { HOUR, TOPICS, type Topic, type Units, type WindUnit } from '@isithot/core';
import type { Target } from './target';

/**
 * The query for `/api/v1/today`, always in this order: the place, `units`, `windUnits`, then
 * `ahead` (the apps' hours ahead, in the toggle's order of topics). "place=leeds-gb&units=c" is
 * the website's; "place=leeds-gb&units=c&ahead=snow" an app's. The apps never send `windUnits`.
 */
export function todayQuery(
  t: Target,
  units: Units | null,
  opts: { windUnits?: WindUnit | null; ahead?: readonly Topic[] } = {},
): string {
  const p = new URLSearchParams();
  if (t.kind === 'city') p.set('place', t.slug);
  if (t.kind === 'coords') {
    p.set('lat', String(t.lat));
    p.set('lon', String(t.lon));
    if (t.name) p.set('name', t.name);
    if (t.region) p.set('region', t.region);
    if (t.country) p.set('country', t.country);
    if (t.geonameId) p.set('geonameId', String(t.geonameId));
    // The forecast is then for the place's own height (only a searched place has one).
    if (t.elevation !== undefined) p.set('elevation', String(t.elevation));
    p.set('source', t.source);
  }
  if (units) p.set('units', units);
  if (opts.windUnits) p.set('windUnits', opts.windUnits);
  const ahead = TOPICS.filter((topic) => opts.ahead?.includes(topic));
  if (ahead.length) p.set('ahead', ahead.join(','));
  return p.toString();
}

/**
 * The same query past the browser's and the CDN's caches, with a new address each hour (UTC):
 * for an answer that is out of date already when it arrives (client `outOfDate`).
 */
export function freshQuery(query: string, now: number): string {
  return `${query ? `${query}&` : ''}t=${Math.floor(now / HOUR)}`;
}

/** The query for `/api/v1/search`. */
export function searchQuery(q: string): string {
  return `q=${encodeURIComponent(q)}`;
}
