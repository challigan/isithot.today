import { describe, expect, it } from 'vitest';
import { ELEVATION } from '../src/config';
import {
  cellKey,
  distanceKm,
  forecastHeight,
  snapToCell,
  geohash,
  gridKey,
  isValidLatLon,
  nearest,
  parseElevation,
  roundPoint,
  roundToGrid,
  slugify,
} from '../src/geo';

describe('grid rounding', () => {
  it('rounds to 0.05° without float noise', () => {
    expect(roundToGrid(54.9783, 0.05)).toBe(55);
    expect(roundToGrid(54.97, 0.05)).toBe(54.95);
    expect(roundToGrid(54.976, 0.05)).toBe(55);
    expect(roundToGrid(-1.6178, 0.05)).toBe(-1.6);
    expect(roundToGrid(0.3, 0.05)).toBe(0.3);
    expect(Object.is(roundToGrid(-0.01, 0.05), 0)).toBe(true);
    expect(roundToGrid(12, 1)).toBe(12);
  });

  it('rounds to 0.5° for climate cells', () => {
    expect(roundToGrid(54.98, 0.5)).toBe(55);
    expect(roundToGrid(-1.61, 0.5)).toBe(-1.5);
  });

  it("snaps to rectangular cells like NASA POWER's 0.5° × 0.625° grid", () => {
    expect(snapToCell({ lat: 54.97, lon: -1.61 }, { lat: 0.5, lon: 0.625 })).toEqual({
      lat: 55,
      lon: -1.875,
    });
    expect(snapToCell({ lat: 37.39, lon: -5.98 }, { lat: 0.5, lon: 0.625 })).toEqual({
      lat: 37.5,
      lon: -6.25,
    });
    expect(cellKey({ lat: 54.97, lon: -1.61 }, { lat: 0.5, lon: 0.625 })).toBe('55.0,-1.875');
  });

  it('builds stable keys', () => {
    expect(gridKey({ lat: 54.97, lon: -1.6178 }, 0.05)).toBe('54.95,-1.60');
    expect(gridKey({ lat: 54.98, lon: -1.61 }, 0.5)).toBe('55.0,-1.5');
    expect(roundPoint({ lat: 51.507, lon: -0.128 }, 0.05)).toEqual({ lat: 51.5, lon: -0.15 });
  });
});

describe('place heights', () => {
  it('keeps plausible heights in whole metres', () => {
    expect(parseElevation(48)).toBe(48);
    expect(parseElevation(1234.5)).toBe(1235);
    expect(parseElevation(-430)).toBe(-430);
    expect(Object.is(parseElevation(-0.3), 0)).toBe(true);
    expect(parseElevation(ELEVATION.min)).toBe(-500);
    expect(parseElevation(ELEVATION.max)).toBe(9000);
    for (const bad of [-500.5, 9000.5, Number.NaN, Infinity, '300', null, undefined, {}]) {
      expect(parseElevation(bad)).toBeNull();
    }
  });

  it('fetches and caches a forecast for the height in 50 m bands, or none without one', () => {
    expect(forecastHeight(1034)).toBe(1050);
    expect(forecastHeight(1024)).toBe(1000);
    expect(forecastHeight(1025)).toBe(1050);
    expect(forecastHeight(-430)).toBe(-450);
    expect(Object.is(forecastHeight(-20), 0)).toBe(true);
    expect(forecastHeight(null)).toBeNull();
    expect(forecastHeight(undefined)).toBeNull();
  });
});

describe('isValidLatLon', () => {
  it('accepts real coordinates only', () => {
    expect(isValidLatLon(54.98, -1.61)).toBe(true);
    expect(isValidLatLon(90, 180)).toBe(true);
    expect(isValidLatLon(91, 0)).toBe(false);
    expect(isValidLatLon(0, -181)).toBe(false);
    expect(isValidLatLon(Number.NaN, 0)).toBe(false);
    expect(isValidLatLon('1', 0)).toBe(false);
    expect(isValidLatLon(0, undefined)).toBe(false);
  });
});

describe('distance and nearest', () => {
  const london = { lat: 51.5074, lon: -0.1278, name: 'London' };
  const paris = { lat: 48.8566, lon: 2.3522, name: 'Paris' };
  const newcastle = { lat: 54.9783, lon: -1.6178, name: 'Newcastle' };
  const sunderland = { lat: 54.9069, lon: -1.3838, name: 'Sunderland' };

  it('measures great-circle distance', () => {
    expect(distanceKm(london, paris)).toBeGreaterThan(340);
    expect(distanceKm(london, paris)).toBeLessThan(345);
    expect(distanceKm(london, london)).toBe(0);
  });

  it('finds the nearest items, with an optional filter', () => {
    const items = [london, paris, newcastle, sunderland];
    expect(nearest(items, newcastle, 2).map((c) => c.name)).toEqual(['Newcastle', 'Sunderland']);
    expect(nearest(items, newcastle, 2, (c) => c.name !== 'Newcastle').map((c) => c.name)).toEqual([
      'Sunderland',
      'London',
    ]);
  });
});

describe('slugify', () => {
  it('builds city-country slugs', () => {
    expect(slugify('Newcastle upon Tyne', 'GB')).toBe('newcastle-upon-tyne-gb');
    expect(slugify('São Paulo', 'BR')).toBe('sao-paulo-br');
    expect(slugify('Düsseldorf', 'DE')).toBe('dusseldorf-de');
    expect(slugify("King's Lynn", 'GB')).toBe('kings-lynn-gb');
    expect(slugify('Łódź', 'PL')).toBe('lodz-pl');
    expect(slugify('Kraków', 'PL')).toBe('krakow-pl');
    expect(slugify('Ho Chi Minh City', 'VN')).toBe('ho-chi-minh-city-vn');
    expect(slugify('Gießen', 'DE')).toBe('giessen-de');
    expect(slugify('Tromsø', 'NO')).toBe('tromso-no');
    expect(slugify('Đà Nẵng', 'VN')).toBe('da-nang-vn');
    expect(slugify(' St. Albans ', 'GB')).toBe('st-albans-gb');
  });
});

describe('geohash', () => {
  it('matches known values', () => {
    expect(geohash(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
    expect(geohash(51.5074, -0.1278)).toBe('gcpvj0duq');
    expect(geohash(-33.8688, 151.2093, 5)).toBe('r3gx2');
  });
});
