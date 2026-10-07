/**
 * Colours for the rain bands ("Is it wet?"), in the same shape as the hot palettes in config.ts.
 * A sunny sky when dry, grey for spots, then slate-teal, teal and deep teal as the rain builds,
 * and indigo for a washout, so a switch between the two topics always changes the page's colour
 * family (Hot's Cold and Freezing are slate and navy blue). The glow dims and greys as the rain
 * gets heavier. Light bands carry dark text; from Showers up the text is white, and the glow is
 * kept dim enough for small text even at its brightest point (scripts/palette-contrast.mjs).
 * e2e/contrast.spec.ts checks every pair on the rendered page.
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
    glow: '65%',
  },
  showers: {
    g1: '#33626a',
    g2: '#244a50',
    g3: '#cfe3e3',
    ink: '#ffffff',
    pill: '#244a50',
    glow: '18%',
  },
  rain: {
    g1: '#155e6b',
    g2: '#0d4651',
    g3: '#9cccd3',
    ink: '#ffffff',
    pill: '#0d4651',
    glow: '20%',
  },
  heavy: {
    g1: '#0c4752',
    g2: '#072f38',
    g3: '#5f959e',
    ink: '#ffffff',
    pill: '#072f38',
    glow: '25%',
  },
  drenched: {
    g1: '#2f2b6e',
    g2: '#18153f',
    g3: '#6e68ad',
    ink: '#ffffff',
    pill: '#18153f',
    glow: '26%',
  },
};
