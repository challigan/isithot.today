/**
 * Colours for the rain bands ("Is it wet?"), in the same shape as the hot palettes in config.ts.
 * A sunny sky when dry, grey for spots, then slate-teal, teal and deep teal as the rain builds,
 * and indigo for a washout, so a switch between the two topics always changes the page's colour
 * family (Hot's Cold and Freezing are slate and navy blue). The glow dims and greys as the rain
 * gets heavier. Light bands carry dark text; from Showers up the text is white, and the glow is
 * kept dim enough for small text even at its brightest point (scripts/palette-contrast.mjs).
 * e2e/contrast.spec.ts checks every pair on the rendered page.
 */
import type { Palette, RainBand, SnowBand, WindBand } from './config';

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

/**
 * Colours for the snow bands ("Will it snow?"): winter dusk, from a pale lilac sky with a low sun
 * when there is no snow, through lavender and violet to plum and an aubergine night as the snow
 * deepens. Every blue is taken by Hot's Cold and Freezing and by all of Wet, so a switch between
 * the topics always changes the colour family, and snow itself is the white of the text and the
 * icon, never the background. The two pale bands carry dark text; from Maybe up the text is
 * white, with the glow kept dim enough for small text (scripts/palette-contrast.mjs).
 */
export const SNOW_PALETTES: Record<SnowBand, Palette> = {
  nosnow: {
    g1: '#f6eef9',
    g2: '#e1c9e8',
    g3: '#ffe3d3',
    ink: '#341a3c',
    pill: '#f6eef9',
    glow: '85%',
  },
  flakes: {
    g1: '#ebe4f5',
    g2: '#c4b1db',
    g3: '#ffffff',
    ink: '#281938',
    pill: '#ebe4f5',
    glow: '70%',
  },
  maybesnow: {
    g1: '#70548f',
    g2: '#583d75',
    g3: '#ede2fb',
    ink: '#ffffff',
    pill: '#583d75',
    glow: '14%',
  },
  snow: {
    g1: '#783d90',
    g2: '#552269',
    g3: '#f6e9fd',
    ink: '#ffffff',
    pill: '#552269',
    glow: '20%',
  },
  heavysnow: {
    g1: '#642a64',
    g2: '#3e113f',
    g3: '#e8cee7',
    ink: '#ffffff',
    pill: '#3e113f',
    glow: '24%',
  },
  deepsnow: {
    g1: '#37243d',
    g2: '#160c19',
    g3: '#eae4f7',
    ink: '#ffffff',
    pill: '#160c19',
    glow: '30%',
  },
};

/**
 * Colours for the wind bands ("Is it windy?"): from a still, hazy day to a storm. Every blue and
 * violet is taken (Hot's Cold and Freezing, all of Wet, all of Snow), so wind takes the free part of
 * the wheel, yellow to green: pale straw with a warm sun for calm, fresh spring green for breezy,
 * then the greens of trees in the wind, darkening to a pine-dark gale and a storm's charcoal under a
 * yellow-green storm light. The two pale bands carry dark text; from Windy up the text is white,
 * with the glow kept dim enough for small text (scripts/palette-contrast.mjs). Every palette is at
 * least 13.4 (CIEDE2000) from every Hot, Wet and Snow palette; the closest existing cross-topic pair
 * is 11.7 (Hot's Mild and Wet's Spots).
 */
export const WIND_PALETTES: Record<WindBand, Palette> = {
  calm: {
    g1: '#fbf6db',
    g2: '#f1e7a5',
    g3: '#fff8e0',
    ink: '#2a2b0a',
    pill: '#fbf6db',
    glow: '85%',
  },
  breezy: {
    g1: '#ecfad6',
    g2: '#bbe98b',
    g3: '#ffffff',
    ink: '#172d12',
    pill: '#ecfad6',
    glow: '70%',
  },
  windy: {
    g1: '#2c7043',
    g2: '#0e5632',
    g3: '#ddf7d8',
    ink: '#ffffff',
    pill: '#0e5632',
    glow: '12%',
  },
  verywindy: {
    g1: '#155b3d',
    g2: '#063b28',
    g3: '#d1f2d7',
    ink: '#ffffff',
    pill: '#063b28',
    glow: '18%',
  },
  gale: {
    g1: '#28432e',
    g2: '#0d2517',
    g3: '#d7edcb',
    ink: '#ffffff',
    pill: '#0d2517',
    glow: '24%',
  },
  storm: {
    g1: '#2d3322',
    g2: '#0c1109',
    g3: '#eaeaa3',
    ink: '#ffffff',
    pill: '#0c1109',
    glow: '30%',
  },
};
