/**
 * Which city pages each site lists, and how its places page groups them: the UK by nation, then
 * the rest of the world by country. Every site has a page for every city; willitsnow.today
 * leaves out of search engines the places where it never snows (SNOWLESS in config.ts).
 */
import { SNOWLESS, type Topic } from './config';
import { COPY } from './copy';
import type { City } from './types';

/** Whether it never snows at a place: near the equator and below the mountains (SNOWLESS). */
export function snowless(place: { lat: number; elevation?: number }): boolean {
  // A place without a recorded height counts as low, as nearly all such places are.
  return Math.abs(place.lat) < SNOWLESS.latitude && (place.elevation ?? 0) < SNOWLESS.elevation;
}

/**
 * Whether a city's page on a topic's site is for search engines: in its sitemap and places page,
 * without noindex. A snow page where it never snows would say No all year, so it is not.
 */
export function listed(city: City, topic: Topic): boolean {
  return topic !== 'snow' || !snowless(city);
}

export interface PlaceGroup {
  /** A UK nation ("Scotland") or a country ("Spain"). */
  name: string;
  /** A to Z. */
  cities: City[];
}

export interface PlaceGroups {
  /** England, Scotland, Wales, then Northern Ireland, each with its city pages. */
  uk: PlaceGroup[];
  /** The other countries A to Z. */
  world: PlaceGroup[];
}

/** The four nations in the order the places page lists them. */
const NATIONS = ['England', 'Scotland', 'Wales', 'Northern Ireland'];
const UK = 'GB';

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, 'en-GB');

/** Cities grouped by `key`, the groups and their cities A to Z. */
function groupBy(cities: readonly City[], key: (c: City) => string): PlaceGroup[] {
  const groups = new Map<string, City[]>();
  for (const city of cities) {
    const name = key(city);
    groups.set(name, [...(groups.get(name) ?? []), city]);
  }
  return [...groups].map(([name, list]) => ({ name, cities: list.sort(byName) })).sort(byName);
}

/** A site's places page: every city page it lists, the UK by nation, then the world by country. */
export function placeGroups(cities: readonly City[], topic: Topic): PlaceGroups {
  const shown = cities.filter((c) => listed(c, topic));
  const nation = (c: City): string => (c.region && NATIONS.includes(c.region) ? c.region : COPY.uk);
  const uk = groupBy(
    shown.filter((c) => c.country === UK),
    nation,
  ).sort((a, b) => rank(a.name) - rank(b.name));
  const world = groupBy(
    shown.filter((c) => c.country !== UK),
    (c) => c.countryName,
  );
  return { uk, world };
}

/** A nation's place in the list; a UK city without one comes last. */
const rank = (name: string): number => {
  const i = NATIONS.indexOf(name);
  return i < 0 ? NATIONS.length : i;
};
