import { describe, expect, it } from 'vitest';
import { outboundLinks } from '../src/outbound';
import { localDate } from '../src/dates';

describe('outboundLinks', () => {
  it('links to the home pages without a place', () => {
    expect(outboundLinks(null).map((l) => l.name)).toEqual([
      'BBC Weather',
      'Met Office',
      'AccuWeather',
    ]);
  });

  it('deep-links with a GeoNames ID and geohash', () => {
    const links = outboundLinks({
      name: 'Newcastle upon Tyne',
      lat: 54.97,
      lon: -1.61,
      geonameId: 2641673,
    });
    expect(links[0]!.url).toBe('https://www.bbc.co.uk/weather/2641673');
    expect(links[1]!.url).toMatch(
      /^https:\/\/www\.metoffice\.gov\.uk\/weather\/forecast\/gcy[0-9a-z]{6}$/,
    );
    expect(links[2]!.url).toBe(
      'https://www.accuweather.com/en/search-locations?query=Newcastle%20upon%20Tyne',
    );
  });

  it('falls back to BBC search without a GeoNames ID', () => {
    const links = outboundLinks({ name: 'Hexham', lat: 54.97, lon: -2.1 });
    expect(links[0]!.url).toBe('https://www.bbc.co.uk/weather/search?s=Hexham');
  });
});

describe('localDate', () => {
  const now = new Date('2026-10-06T23:30:00Z');

  it('gives the calendar date in the time zone', () => {
    expect(localDate('Europe/London', now)).toBe('2026-10-07');
    expect(localDate('America/New_York', now)).toBe('2026-10-06');
    expect(localDate('Asia/Tokyo', now)).toBe('2026-10-07');
    expect(localDate('UTC', now)).toBe('2026-10-06');
  });

  it('falls back to UTC for an unknown zone', () => {
    expect(localDate('Not/AZone', now)).toBe('2026-10-06');
  });

  it('defaults to now', () => {
    expect(localDate('UTC')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
