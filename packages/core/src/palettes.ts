/**
 * Colours for the rain bands ("Is it wet?"), in the same shape as the hot palettes in config.ts.
 * Teal for showers to heavy rain and indigo for a washout, so a switch between the two topics
 * always changes the page's colour family (Hot's Cold and Freezing are slate and navy blue).
 * Light bands carry dark text; from Showers up the text is white. Every pair is checked by
 * e2e/contrast.spec.ts on the rendered page.
 */
import type { Palette, RainBand } from './config';

export const RAIN_PALETTES: Record<RainBand, Palette> = {
  dry: {
    g1: '#e2f1f8',
    g2: '#a9d3ea',
    g3: '#fff6d6',
    ink: '#0f2c3d',
    pill: '#e2f1f8',
    glow: '85%',
  },
  spots: {
    g1: '#e4e9ed',
    g2: '#b4c2cc',
    g3: '#ffffff',
    ink: '#1c2a35',
    pill: '#e4e9ed',
    glow: '70%',
  },
  showers: {
    g1: '#33626a',
    g2: '#244a50',
    g3: '#bfe0df',
    ink: '#ffffff',
    pill: '#244a50',
    glow: '30%',
  },
  rain: {
    g1: '#155e6b',
    g2: '#0d4651',
    g3: '#a8dde3',
    ink: '#ffffff',
    pill: '#0d4651',
    glow: '40%',
  },
  heavy: {
    g1: '#0c4752',
    g2: '#072f38',
    g3: '#8fcfd6',
    ink: '#ffffff',
    pill: '#072f38',
    glow: '30%',
  },
  drenched: {
    g1: '#2f2b6e',
    g2: '#18153f',
    g3: '#a9a3e6',
    ink: '#ffffff',
    pill: '#18153f',
    glow: '35%',
  },
};
