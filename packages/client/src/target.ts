/**
 * Where an answer is for: approximate IP location, a city page's place, or coordinates (the
 * device's, or a searched place's). The website keeps the chosen one in local storage, and the
 * apps in their App Group (`place.v1`), so this shape is stored: only ever add optional fields.
 *
 * Swift: `IsItModel/Target.swift`, checked against the golden vectors in `target.json`.
 */
import { GRID, isValidLatLon, roundToGrid, type SearchResult } from '@isithot/core';

export type Target =
  | { kind: 'ip' }
  | { kind: 'city'; slug: string; name?: string }
  | {
      kind: 'coords';
      source: 'device' | 'search';
      lat: number;
      lon: number;
      name?: string | undefined;
      region?: string | null | undefined;
      country?: string | null | undefined;
      geonameId?: number | undefined;
      /** A searched place's height, whole metres, when the search knew it. */
      elevation?: number | undefined;
    };

/** A place someone chose (a city or coordinates), as opposed to approximate IP location. */
export type PlaceTarget = Exclude<Target, { kind: 'ip' }>;
export type CoordsTarget = Extract<Target, { kind: 'coords' }>;

/** One key per place: whether a saved answer, or a recent place, is for the same one. */
export function targetKey(t: Target): string {
  if (t.kind === 'ip') return 'ip';
  if (t.kind === 'city') return `city:${t.slug}`;
  return `${t.source}:${t.lat},${t.lon}`;
}

/** The device's location, rounded to the forecast grid before it goes anywhere. */
export function deviceTarget(lat: number, lon: number): CoordsTarget {
  return {
    kind: 'coords',
    source: 'device',
    lat: roundToGrid(lat, GRID.forecast),
    lon: roundToGrid(lon, GRID.forecast),
  };
}

/** A search result's place: its city page's, when it has one, else its rounded coordinates. */
export function searchTarget(r: SearchResult): PlaceTarget {
  if (r.slug) return { kind: 'city', slug: r.slug, name: r.name };
  return {
    kind: 'coords',
    source: 'search',
    lat: roundToGrid(r.lat, GRID.forecast),
    lon: roundToGrid(r.lon, GRID.forecast),
    name: r.name,
    region: r.region,
    country: r.country,
    geonameId: r.geonameId,
    elevation: r.elevation,
  };
}

// The server's own checks on the numbers in a query.
const COORD = /^-?\d{1,3}(\.\d+)?$/;
const HEIGHT = /^-?\d{1,4}(\.\d+)?$/;
const GEONAME_ID = /^\d{1,10}$/;

const parse = (value: string | null, pattern: RegExp): number | null =>
  value !== null && pattern.test(value) ? Number(value) : null;

/**
 * The place a today query asks about (`todayQuery`'s place part, read back), read as the server
 * reads it: coordinates when it has any, else a city, else approximate IP location. Null when the
 * coordinates or the city are malformed. A notification carries its place this way.
 */
export function targetFromQuery(query: string): Target | null {
  const q = new URLSearchParams(query);
  if (q.has('lat') || q.has('lon')) {
    const lat = parse(q.get('lat'), COORD);
    const lon = parse(q.get('lon'), COORD);
    if (!isValidLatLon(lat, lon)) return null;
    const t: CoordsTarget = {
      kind: 'coords',
      source: q.get('source') === 'search' ? 'search' : 'device',
      lat: lat!,
      lon: lon!,
    };
    const name = q.get('name');
    const region = q.get('region');
    const country = q.get('country');
    const geonameId = parse(q.get('geonameId'), GEONAME_ID);
    const elevation = parse(q.get('elevation'), HEIGHT);
    if (name) t.name = name;
    if (region) t.region = region;
    if (country) t.country = country;
    if (geonameId) t.geonameId = geonameId;
    if (elevation !== null) t.elevation = elevation;
    return t;
  }
  if (q.has('place')) {
    const slug = q.get('place');
    return slug ? { kind: 'city', slug } : null;
  }
  return { kind: 'ip' };
}
