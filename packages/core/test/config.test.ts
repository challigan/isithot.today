import { describe, expect, it } from 'vitest';
import {
  BANDS,
  PALETTES,
  RAIN_BANDS,
  RAIN_PALETTES,
  SITES,
  TOPICS,
  paletteFor,
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
});
