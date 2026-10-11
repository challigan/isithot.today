import { describe, expect, it } from 'vitest';
import {
  BANDS,
  BANDS_BY_TOPIC,
  PALETTES,
  RAIN_BANDS,
  RAIN_PALETTES,
  SITES,
  SNOW_BANDS,
  SNOW_PALETTES,
  TOPICS,
  hostTopic,
  isSiteHost,
  paletteFor,
  parseTopic,
  sitePath,
  topicOfBand,
} from '../src/config';

describe('config', () => {
  it('finds the palette for a hot or a rain band', () => {
    for (const band of BANDS) expect(paletteFor(band)).toBe(PALETTES[band]);
    for (const band of RAIN_BANDS) expect(paletteFor(band)).toBe(RAIN_PALETTES[band]);
  });

  it('keeps hot and rain band names apart, so one name means one palette', () => {
    expect(BANDS.filter((b) => (RAIN_BANDS as readonly string[]).includes(b))).toEqual([]);
  });

  it('keeps band keys unique across every topic, as palettes, icons and previews use them', () => {
    const all = TOPICS.flatMap((t) => BANDS_BY_TOPIC[t]);
    expect(all).toEqual([...BANDS, ...RAIN_BANDS, ...SNOW_BANDS]);
    expect(new Set(all).size).toBe(18);
    // The pages carry them in data attributes that tests read with [a-z]+.
    for (const band of all) expect(band).toMatch(/^[a-z]+$/);
  });

  it('finds the topic and palette of every band', () => {
    for (const topic of TOPICS) {
      for (const band of BANDS_BY_TOPIC[topic]) expect(topicOfBand(band)).toBe(topic);
    }
    for (const band of SNOW_BANDS) expect(paletteFor(band)).toBe(SNOW_PALETTES[band]);
    expect(topicOfBand('blizzard')).toBeNull();
    expect(topicOfBand('')).toBeNull();
  });

  it('reads a topic from untrusted text', () => {
    for (const topic of TOPICS) expect(parseTopic(topic)).toBe(topic);
    expect(parseTopic('Snow')).toBe('hot');
    expect(parseTopic(undefined)).toBe('hot');
    expect(parseTopic(null)).toBe('hot');
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
    expect(hostTopic('willitsnow.today')).toBe('snow');
    expect(hostTopic('www.willitsnow.today')).toBe('snow');
    expect(isSiteHost('willitsnow.today')).toBe(true);
    expect(isSiteHost('www.willitsnow.today')).toBe(true);
    expect(hostTopic('snow.isithot.today')).toBe('hot');
  });

  it('links across all three sites', () => {
    const hosts = { hot: 'isithot.today', wet: 'isitwet.today', snow: 'willitsnow.today' };
    for (const from of TOPICS) {
      for (const to of TOPICS) {
        expect(sitePath(to, '/in/oslo-no', hosts[from])).toBe(
          from === to ? '/in/oslo-no' : `${SITES[to].url}/in/oslo-no`,
        );
      }
    }
    expect(sitePath('snow', '/', 'www.isitwet.today')).toBe('https://willitsnow.today/');
  });

  it('keeps snow pages under /snow on previews and local servers', () => {
    const preview = 'deploy-preview-4--isithotapp.netlify.app';
    expect(sitePath('snow', '/', preview)).toBe('/snow');
    expect(sitePath('snow', '/in/oslo-no', preview)).toBe('/snow/in/oslo-no');
    expect(sitePath('snow', '/?lat=1&lon=2', 'localhost')).toBe('/snow?lat=1&lon=2');
    expect(sitePath('hot', '/?lat=1&lon=2', 'localhost')).toBe('/?lat=1&lon=2');
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
