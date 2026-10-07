import { describe, expect, it } from 'vitest';
import {
  BANDS,
  PALETTES,
  RAIN_BANDS,
  RAIN_PALETTES,
  SITES,
  TOPICS,
  hostTopic,
  isSiteHost,
  paletteFor,
  sitePath,
} from '../src/config';

describe('config', () => {
  it('finds the palette for a hot or a rain band', () => {
    for (const band of BANDS) expect(paletteFor(band)).toBe(PALETTES[band]);
    for (const band of RAIN_BANDS) expect(paletteFor(band)).toBe(RAIN_PALETTES[band]);
  });

  it('keeps hot and rain band names apart, so one name means one palette', () => {
    expect(BANDS.filter((b) => (RAIN_BANDS as readonly string[]).includes(b))).toEqual([]);
  });

  it('has a site for every topic', () => {
    for (const topic of TOPICS) {
      expect(SITES[topic].url).toBe(`https://${SITES[topic].name}`);
    }
  });

  it('knows which topic each host opens on', () => {
    expect(hostTopic('isitwet.today')).toBe('wet');
    expect(hostTopic('www.isitwet.today')).toBe('wet');
    expect(hostTopic('isithot.today')).toBe('hot');
    expect(hostTopic('deploy-preview-4--isithotapp.netlify.app')).toBe('hot');
    expect(isSiteHost('www.isithot.today')).toBe(true);
    expect(isSiteHost('127.0.0.1')).toBe(false);
  });

  it('links within a site, or across to the other one', () => {
    expect(sitePath('wet', '/in/leeds-gb', 'isitwet.today')).toBe('/in/leeds-gb');
    expect(sitePath('wet', '/in/leeds-gb', 'isithot.today')).toBe(
      'https://isitwet.today/in/leeds-gb',
    );
    expect(sitePath('hot', '/', 'www.isitwet.today')).toBe('https://isithot.today/');
    expect(sitePath('hot', '/?lat=1&lon=2', 'isithot.today')).toBe('/?lat=1&lon=2');
  });

  it('keeps wet pages under /wet on previews and local servers', () => {
    const preview = 'deploy-preview-4--isithotapp.netlify.app';
    expect(sitePath('wet', '/', preview)).toBe('/wet');
    expect(sitePath('wet', '/in/leeds-gb', preview)).toBe('/wet/in/leeds-gb');
    expect(sitePath('wet', '/?lat=1&lon=2', '127.0.0.1')).toBe('/wet?lat=1&lon=2');
    expect(sitePath('hot', '/in/leeds-gb', preview)).toBe('/in/leeds-gb');
  });
});
