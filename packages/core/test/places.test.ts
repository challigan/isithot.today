import { describe, expect, it } from 'vitest';
import { listed, placeGroups, snowless } from '../src/places';
import type { City } from '../src/types';

const city = (over: Partial<City> & Pick<City, 'name'>): City => ({
  slug: over.name.toLowerCase(),
  region: null,
  country: 'GB',
  countryName: 'United Kingdom',
  lat: 52,
  lon: -1,
  population: 1000,
  geonameId: 1,
  ...over,
});

const CITIES: City[] = [
  city({ name: 'York', region: 'England' }),
  city({ name: 'Cardiff', region: 'Wales' }),
  city({ name: 'Belfast', region: 'Northern Ireland' }),
  city({ name: 'Aberdeen', region: 'Scotland' }),
  city({ name: 'Bath', region: 'England' }),
  city({ name: 'Edinburgh', region: 'Scotland' }),
  city({ name: 'Málaga', country: 'ES', countryName: 'Spain', lat: 36.7, elevation: 22 }),
  city({ name: 'Singapore', country: 'SG', countryName: 'Singapore', lat: 1.3, elevation: 23 }),
  city({ name: 'Ávila', country: 'ES', countryName: 'Spain', lat: 40.7, elevation: 1131 }),
  city({ name: 'Brisbane', country: 'AU', countryName: 'Australia', lat: -27.5 }),
  city({ name: 'Oslo', country: 'NO', countryName: 'Norway', lat: 59.9, elevation: 23 }),
];

describe('snowless', () => {
  it('is near the equator and below the mountains', () => {
    expect(snowless({ lat: 1.3, elevation: 23 })).toBe(true);
    expect(snowless({ lat: -26.2, elevation: 1767 })).toBe(true);
    expect(snowless({ lat: 29.9, elevation: 2999 })).toBe(true);
    // A place without a recorded height counts as low.
    expect(snowless({ lat: -27.5 })).toBe(true);
  });

  it('is not from 30° away from the equator, or from 3,000 m up', () => {
    expect(snowless({ lat: 30, elevation: 20 })).toBe(false);
    expect(snowless({ lat: -33.9, elevation: 58 })).toBe(false);
    expect(snowless({ lat: -16.5, elevation: 3640 })).toBe(false);
  });
});

describe('listed', () => {
  it('lists every city on the hot and wet sites, and only snowy ones on the snow site', () => {
    const singapore = CITIES.find((c) => c.name === 'Singapore')!;
    const oslo = CITIES.find((c) => c.name === 'Oslo')!;
    expect(listed(singapore, 'hot')).toBe(true);
    expect(listed(singapore, 'wet')).toBe(true);
    expect(listed(singapore, 'snow')).toBe(false);
    expect(listed(oslo, 'snow')).toBe(true);
  });
});

describe('placeGroups', () => {
  const names = (groups: { name: string; cities: City[] }[]) =>
    groups.map((g) => [g.name, g.cities.map((c) => c.name)]);

  it('groups the UK by nation, then the world by country, all A to Z', () => {
    const groups = placeGroups(CITIES, 'hot');
    expect(names(groups.uk)).toEqual([
      ['England', ['Bath', 'York']],
      ['Scotland', ['Aberdeen', 'Edinburgh']],
      ['Wales', ['Cardiff']],
      ['Northern Ireland', ['Belfast']],
    ]);
    expect(names(groups.world)).toEqual([
      ['Australia', ['Brisbane']],
      ['Norway', ['Oslo']],
      ['Singapore', ['Singapore']],
      // Accents sort with their letters.
      ['Spain', ['Ávila', 'Málaga']],
    ]);
  });

  it('leaves places where it never snows off the snow site', () => {
    const groups = placeGroups(CITIES, 'snow');
    expect(names(groups.world)).toEqual([
      ['Norway', ['Oslo']],
      ['Spain', ['Ávila', 'Málaga']],
    ]);
    expect(groups.uk).toHaveLength(4);
  });

  it('puts a UK city without a nation last, under the United Kingdom', () => {
    const groups = placeGroups(
      [city({ name: 'Somewhere' }), city({ name: 'Leeds', region: 'England' })],
      'wet',
    );
    expect(names(groups.uk)).toEqual([
      ['England', ['Leeds']],
      ['United Kingdom', ['Somewhere']],
    ]);
  });
});
