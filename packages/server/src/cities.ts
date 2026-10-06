import { distanceKm, nearest, type City, type LatLon } from '@isithot/core';
import citiesData from '../../../data/cities.json';

export const CITIES: readonly City[] = citiesData as City[];

const bySlug = new Map(CITIES.map((c) => [c.slug, c]));
const byGeonameId = new Map(CITIES.map((c) => [c.geonameId, c]));

export function cityBySlug(slug: string): City | undefined {
  return bySlug.get(slug.toLowerCase());
}

/** The 4 nearest other city pages, for internal linking. */
export function nearbyCities(point: LatLon, count = 4, excludeSlug?: string): City[] {
  return nearest(CITIES, point, count, (c) => c.slug !== excludeSlug);
}

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The city page for a searched place, matched by GeoNames ID or by name and distance. */
export function cityForPlace(place: {
  name: string;
  country: string | null;
  lat: number;
  lon: number;
  geonameId?: number | null;
}): City | undefined {
  if (place.geonameId) {
    const match = byGeonameId.get(place.geonameId);
    if (match) return match;
  }
  const name = fold(place.name);
  return CITIES.find(
    (c) =>
      c.country === place.country &&
      fold(c.name) === name &&
      distanceKm(c, { lat: place.lat, lon: place.lon }) < 15,
  );
}
