export interface LatLon {
  lat: number;
  lon: number;
}

function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Rounds a coordinate to the nearest multiple of `step`, without float noise or -0. */
export function roundToGrid(value: number, step: number): number {
  const rounded = Number((Math.round(value / step) * step).toFixed(decimalsOf(step)));
  return rounded === 0 ? 0 : rounded;
}

export function roundPoint(point: LatLon, step: number): LatLon {
  return { lat: roundToGrid(point.lat, step), lon: roundToGrid(point.lon, step) };
}

/** Snaps a point to the centre of a rectangular grid cell (e.g. NASA POWER's 0.5° × 0.625°). */
export function snapToCell(point: LatLon, cell: LatLon): LatLon {
  return { lat: roundToGrid(point.lat, cell.lat), lon: roundToGrid(point.lon, cell.lon) };
}

/** Cache key for a rectangular grid cell, e.g. "55.0,-1.875". */
export function cellKey(point: LatLon, cell: LatLon): string {
  const r = snapToCell(point, cell);
  return `${r.lat.toFixed(decimalsOf(cell.lat))},${r.lon.toFixed(decimalsOf(cell.lon))}`;
}

/** Cache key for a grid cell, e.g. "54.95,-1.60". */
export function gridKey(point: LatLon, step: number): string {
  const d = decimalsOf(step);
  const r = roundPoint(point, step);
  return `${r.lat.toFixed(d)},${r.lon.toFixed(d)}`;
}

export function isValidLatLon(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in km. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The `count` items closest to `point`, nearest first. */
export function nearest<T extends LatLon>(
  items: readonly T[],
  point: LatLon,
  count: number,
  include: (item: T) => boolean = () => true,
): T[] {
  return items
    .filter(include)
    .map((item) => ({ item, d: distanceKm(point, item) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, count)
    .map((x) => x.item);
}

/** "Newcastle upon Tyne", "GB" → "newcastle-upon-tyne-gb". */
export function slugify(name: string, countryCode: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[øØ]/g, 'o')
    .replace(/[łŁ]/g, 'l')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base}-${countryCode.toLowerCase()}`;
}

const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Standard geohash, used by the Met Office for forecast page URLs. */
export function geohash(lat: number, lon: number, precision = 9): string {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let evenBit = true;
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        ch = ch * 2 + 1;
        lonMin = mid;
      } else {
        ch = ch * 2;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch = ch * 2 + 1;
        latMin = mid;
      } else {
        ch = ch * 2;
        latMax = mid;
      }
    }
    evenBit = !evenBit;
    if (++bit === 5) {
      hash += GEOHASH_BASE32.charAt(ch);
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}
