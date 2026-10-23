import { describe, expect, it } from 'vitest';
import { GRID, roundToGrid, type SearchResult } from '@isithot/core';
import { todayQuery } from '../src/query';
import { deviceTarget, searchTarget, targetFromQuery, targetKey, type Target } from '../src/target';

const hexham: SearchResult = {
  name: 'Hexham',
  region: 'England',
  country: 'GB',
  countryName: 'United Kingdom',
  lat: 54.97,
  lon: -2.1,
  geonameId: 2647356,
  elevation: 50,
};

describe('targetKey', () => {
  it('names each place once, whatever else it carries', () => {
    expect(targetKey({ kind: 'ip' })).toBe('ip');
    expect(targetKey({ kind: 'city', slug: 'leeds-gb' })).toBe('city:leeds-gb');
    expect(targetKey({ kind: 'city', slug: 'leeds-gb', name: 'Leeds' })).toBe('city:leeds-gb');
    expect(targetKey({ kind: 'coords', source: 'device', lat: 53.8, lon: -1.55 })).toBe(
      'device:53.8,-1.55',
    );
    expect(targetKey(searchTarget(hexham))).toBe('search:54.95,-2.1');
  });
});

describe('deviceTarget', () => {
  it('rounds to the forecast grid as core does, halves up as Math.round does', () => {
    const cases: [number, number][] = [
      [-1.575, -1.55],
      [-1.525, -1.5],
      [-0.025, 0],
      [0.025, 0.05],
      [53.825, 53.85],
      [179.975, 179.95],
    ];
    for (const [value, rounded] of cases) {
      const t = deviceTarget(value, value);
      expect(t).toEqual({ kind: 'coords', source: 'device', lat: rounded, lon: rounded });
      expect(t.lat).toBe(roundToGrid(value, GRID.forecast));
    }
  });

  it('never gives -0, which would print as a different place', () => {
    const t = deviceTarget(-0.024, -0.01);
    expect(Object.is(t.lat, 0) && Object.is(t.lon, 0)).toBe(true);
    expect(targetKey(t)).toBe('device:0,0');
  });
});

describe('searchTarget', () => {
  it('goes to a city page when the result has one', () => {
    expect(searchTarget({ ...hexham, slug: 'hexham-gb' })).toEqual({
      kind: 'city',
      slug: 'hexham-gb',
      name: 'Hexham',
    });
  });

  it('otherwise keeps the rounded point, with what the search knew about it', () => {
    expect(searchTarget(hexham)).toEqual({
      kind: 'coords',
      source: 'search',
      lat: 54.95,
      lon: -2.1,
      name: 'Hexham',
      region: 'England',
      country: 'GB',
      geonameId: 2647356,
      elevation: 50,
    });
    const bare = searchTarget({ ...hexham, region: null, country: null, elevation: undefined });
    expect(bare).toMatchObject({ region: null, country: null, elevation: undefined });
  });
});

describe('targetFromQuery', () => {
  it('reads a city, coordinates or nothing, as the server does', () => {
    expect(targetFromQuery('place=durham-gb')).toEqual({ kind: 'city', slug: 'durham-gb' });
    expect(targetFromQuery('?place=durham-gb&units=c')).toEqual({
      kind: 'city',
      slug: 'durham-gb',
    });
    expect(targetFromQuery('lat=53.8&lon=-1.55&source=device')).toEqual({
      kind: 'coords',
      source: 'device',
      lat: 53.8,
      lon: -1.55,
    });
    // Coordinates win over a city, and without a source they are the device's.
    expect(targetFromQuery('place=durham-gb&lat=53.8&lon=-1.55')).toEqual({
      kind: 'coords',
      source: 'device',
      lat: 53.8,
      lon: -1.55,
    });
    expect(targetFromQuery('')).toEqual({ kind: 'ip' });
    expect(targetFromQuery('units=f')).toEqual({ kind: 'ip' });
  });

  it('keeps everything a searched place carries', () => {
    expect(
      targetFromQuery(
        'lat=54.95&lon=-2.1&name=Hexham&region=England&country=GB&geonameId=2647356&elevation=50&source=search&units=c',
      ),
    ).toEqual(searchTarget(hexham));
    // Sea level is a height too.
    expect(targetFromQuery('lat=50&lon=-5&elevation=0&source=search')).toMatchObject({
      elevation: 0,
    });
  });

  it('is null for a malformed place, and leaves out malformed extras', () => {
    for (const query of [
      'place=',
      'lat=54.95',
      'lon=-2.1',
      'lat=&lon=',
      'lat=north&lon=-2.1',
      'lat=1e2&lon=0',
      'lat=91&lon=0',
      'lat=0&lon=180.5',
    ]) {
      expect(targetFromQuery(query), query).toBeNull();
    }
    expect(targetFromQuery('lat=54.95&lon=-2.1&geonameId=x&elevation=high&source=search')).toEqual({
      kind: 'coords',
      source: 'search',
      lat: 54.95,
      lon: -2.1,
    });
  });

  it('reads back what todayQuery writes, names with any characters included', () => {
    const targets: Target[] = [
      { kind: 'ip' },
      { kind: 'city', slug: 'newcastle-upon-tyne-gb' },
      deviceTarget(-33.87, 151.21),
      searchTarget(hexham),
      { kind: 'coords', source: 'search', lat: 45.8, lon: 6.85, name: 'Saint-Gervais & Les Bains' },
      { kind: 'coords', source: 'search', lat: 60.15, lon: 24.95, name: 'Pålsböle + $ ü' },
      { kind: 'coords', source: 'search', lat: 35.7, lon: 139.7, name: '東京', country: 'JP' },
    ];
    for (const t of targets) {
      expect(targetFromQuery(todayQuery(t, 'c', { ahead: ['snow'] })), targetKey(t)).toEqual(t);
    }
  });
});
