import { describe, expect, it } from 'vitest';
import { locateFromIpOnly } from '../src/today';

describe('locateFromIpOnly', () => {
  it("locates a town and its point from the connection, on the forecast's grid", async () => {
    const located = await locateFromIpOnly({
      city: 'Newcastle upon Tyne',
      country: 'GB',
      region: 'England',
      lat: 54.9881,
      lon: -1.6194,
    });
    expect(located).toMatchObject({
      name: 'Newcastle upon Tyne',
      country: 'GB',
      lat: 55,
      lon: -1.6,
      source: 'ip',
    });
  });

  it('gives nothing for coordinates with no town: a country alone is not where someone is', async () => {
    expect(await locateFromIpOnly({ country: 'GB', lat: 54.9881, lon: -1.6194 })).toBeNull();
    expect(
      await locateFromIpOnly({ city: '', country: 'GB', lat: 54.9881, lon: -1.6194 }),
    ).toBeNull();
  });

  it('gives nothing without geo or its coordinates, and never the fallback city', async () => {
    expect(await locateFromIpOnly(null)).toBeNull();
    expect(await locateFromIpOnly(undefined)).toBeNull();
    expect(await locateFromIpOnly({})).toBeNull();
    expect(await locateFromIpOnly({ city: 'Leeds', country: 'GB' })).toBeNull();
    expect(await locateFromIpOnly({ city: 'Leeds', lat: 91, lon: -1.55 })).toBeNull();
  });
});
