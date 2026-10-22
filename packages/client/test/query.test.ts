import { describe, expect, it } from 'vitest';
import { freshQuery, searchQuery, todayQuery } from '../src/query';
import { deviceTarget, type CoordsTarget } from '../src/target';

const HOUR = 3_600_000;
const london = { kind: 'city', slug: 'london-gb' } as const;
// A searched place, as the website stores it.
const hexham: CoordsTarget = {
  kind: 'coords',
  source: 'search',
  lat: 54.95,
  lon: -2.1,
  name: 'Hexham',
  region: 'England',
  country: 'GB',
  elevation: 50,
};

describe('todayQuery', () => {
  it('writes the website’s requests byte for byte', () => {
    // The places and units the e2e suites ask for (cache, home, search-city and topic specs).
    expect(todayQuery({ kind: 'ip' }, null)).toBe('');
    expect(todayQuery(london, 'c')).toBe('place=london-gb&units=c');
    expect(todayQuery(london, 'c', { windUnits: 'kmh' })).toBe(
      'place=london-gb&units=c&windUnits=kmh',
    );
    expect(todayQuery({ kind: 'city', slug: 'reykjavik-is' }, 'f', { windUnits: 'mph' })).toBe(
      'place=reykjavik-is&units=f&windUnits=mph',
    );
    expect(todayQuery(deviceTarget(52.48, -1.9), 'c')).toBe(
      'lat=52.5&lon=-1.9&source=device&units=c',
    );
    expect(todayQuery(hexham, 'c')).toBe(
      'lat=54.95&lon=-2.1&name=Hexham&region=England&country=GB&elevation=50&source=search&units=c',
    );
    expect(todayQuery({ ...hexham, geonameId: 2647356 }, null, { windUnits: null })).toBe(
      'lat=54.95&lon=-2.1&name=Hexham&region=England&country=GB&geonameId=2647356&elevation=50&source=search',
    );
  });

  it('leaves out what a place does not have, and encodes names as a form does', () => {
    expect(
      todayQuery(
        {
          kind: 'coords',
          source: 'search',
          lat: 45.9,
          lon: 6.85,
          name: 'Bø & Co + $ü',
          region: null,
        },
        'c',
      ),
    ).toBe('lat=45.9&lon=6.85&name=B%C3%B8+%26+Co+%2B+%24%C3%BC&source=search&units=c');
  });

  it('asks for the hours ahead last, in the toggle’s order, once each', () => {
    expect(todayQuery(london, 'c', { ahead: ['snow'] })).toBe('place=london-gb&units=c&ahead=snow');
    expect(todayQuery(london, 'c', { windUnits: 'mph', ahead: ['wind', 'snow', 'wind'] })).toBe(
      'place=london-gb&units=c&windUnits=mph&ahead=snow%2Cwind',
    );
    expect(todayQuery(london, 'c', { ahead: [] })).toBe('place=london-gb&units=c');
  });
});

describe('freshQuery', () => {
  it('adds the UTC hour, so each hour has a new address', () => {
    const at = Date.parse('2026-12-01T18:00:00Z');
    expect(freshQuery('place=london-gb&units=c', at)).toBe(
      `place=london-gb&units=c&t=${at / HOUR}`,
    );
    expect(freshQuery('place=london-gb&units=c', at - 1)).toBe(
      `place=london-gb&units=c&t=${at / HOUR - 1}`,
    );
    expect(freshQuery('', at + HOUR - 1)).toBe(`t=${at / HOUR}`);
  });
});

describe('searchQuery', () => {
  it('encodes the text as the website always has', () => {
    expect(searchQuery('Leeds')).toBe('q=Leeds');
    expect(searchQuery('St Albans & Co')).toBe('q=St%20Albans%20%26%20Co');
    expect(searchQuery('Zürich')).toBe('q=Z%C3%BCrich');
  });
});
