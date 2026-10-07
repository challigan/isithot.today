import { distanceKm, nearest } from '@isithot/core';
import { CITIES } from './cities';

export interface NamedPlace {
  geonameId: number;
  name: string;
  country: string;
  region: string | null;
  lat: number;
  lon: number;
}

type Row = [number, string, string, number, number, string];

let index: Map<string, Row[]> | null = null;

const cellKey = (lat: number, lon: number): string => `${Math.floor(lat)},${Math.floor(lon)}`;

async function loadIndex(): Promise<Map<string, Row[]>> {
  if (index) return index;
  const data = (await import('../../../data/places.json')).default as unknown as { rows: Row[] };
  const map = new Map<string, Row[]>();
  for (const row of data.rows) {
    const key = cellKey(row[3], row[4]);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  index = map;
  return map;
}

/** A city page this close to the rounded point wins over a nearer small town. */
export const CITY_PREFERENCE_KM = 6;

/**
 * Names a rounded point. Coordinates are rounded to 0.05° (about 5 km) before they leave the
 * browser, so a city page within a few km is preferred (central Newcastle rounds to a point in
 * Gateshead). Otherwise the nearest town (GeoNames, population 5,000+, or 1,000+ in the UK and
 * Ireland) within `maxKm`. Open-Meteo has no reverse geocoding, so this runs offline.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  maxKm = 30,
): Promise<NamedPlace | null> {
  const [city] = nearest(CITIES, { lat, lon }, 1);
  if (city && distanceKm(city, { lat, lon }) <= CITY_PREFERENCE_KM) {
    return {
      geonameId: city.geonameId,
      name: city.name,
      country: city.country,
      region: city.region,
      lat: city.lat,
      lon: city.lon,
    };
  }
  const map = await loadIndex();
  const baseLat = Math.floor(lat);
  const baseLon = Math.floor(lon);
  let best: Row | null = null;
  let bestKm = Infinity;
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLon = -1; dLon <= 1; dLon++) {
      const rows = map.get(`${baseLat + dLat},${baseLon + dLon}`);
      if (!rows) continue;
      for (const row of rows) {
        const d = distanceKm({ lat, lon }, { lat: row[3], lon: row[4] });
        if (d < bestKm) {
          bestKm = d;
          best = row;
        }
      }
    }
  }
  if (!best || bestKm > maxKm) return null;
  return {
    geonameId: best[0],
    name: best[1],
    country: best[2],
    region: best[5] || null,
    lat: best[3],
    lon: best[4],
  };
}
