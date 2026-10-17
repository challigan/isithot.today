/**
 * Icons for "Is it wet?", drawn like the hot glyphs in view.ts: 120×120 viewBox, stroke
 * currentColor at width 3 with round caps and joins (set on the <svg>). Rain and drops carry
 * class="fall" so the page can let them drift down a few times; at rest every icon is complete.
 * They are drawn in place, never with a transform attribute, which the animation would replace.
 * Nothing is filled with a background colour, so an icon never hides the answer it overlaps.
 */
import type { RainBand, Topic } from '@isithot/core';
import { SNOW_TOPIC_ICON } from './snowGlyphs';
import { WIND_TOPIC_ICON } from './windGlyphs';

const n = (v: number): number => Number(v.toFixed(1));

/** Sun rays from r1 to r2 out from (cx, cy), at the given angles (degrees, clockwise from east). */
const rays = (angles: number[], r1: number, r2: number, cx = 60, cy = 60): string =>
  angles
    .map((d) => {
      const [c, s] = [Math.cos((d / 180) * Math.PI), Math.sin((d / 180) * Math.PI)];
      return `<line x1="${n(cx + c * r1)}" y1="${n(cy + s * r1)}" x2="${n(cx + c * r2)}" y2="${n(cy + s * r2)}"/>`;
    })
    .join('');

/** The hot glyphs' cloud (view.ts), moved up to leave room for the rain, and tinted when heavy. */
const CLOUD = 'M36 92h48a17 17 0 0 0 1-34 24 24 0 0 0-45-4 19 19 0 0 0-4 38z';
const cloud = (dx: number, dy: number, tint = 0): string =>
  `<path d="${CLOUD}" transform="translate(${dx} ${dy})"${tint ? ` fill="currentColor" fill-opacity="${tint}"` : ''}/>`;

/**
 * `count` rain lines `step` apart from x, every other one `stagger` lower (higher if negative),
 * all at one slant.
 */
const rain = (count: number, x: number, step: number, y: number, stagger: number, length: number) =>
  Array.from({ length: count }, (_, i) => {
    const [x1, y1] = [x + i * step, y + (i % 2) * stagger];
    return `<line class="fall" x1="${x1}" y1="${y1}" x2="${n(x1 - length * 0.34)}" y2="${y1 + length}"/>`;
  }).join('');

/** A raindrop with its round end (radius 5.5) centred on (cx, cy). */
const drop = (cx: number, cy: number): string =>
  `<path class="fall" d="M${cx} ${cy - 12}c-2.5 4.4-5.5 7.6-5.5 12a5.5 5.5 0 0 0 11 0c0-4.4-3-7.6-5.5-12z"/>`;

const EIGHT = [0, 45, 90, 135, 180, 225, 270, 315];

/** From a dry day to a washout: the sun, then more cloud, more and longer rain, then puddles. */
export const RAIN_GLYPHS: Record<RainBand, string> = {
  // Static: only Hot's suns turn.
  dry: `<circle cx="60" cy="60" r="20"/>${rays(EIGHT, 30, 40)}`,
  spots: `${cloud(0, -16)}${drop(47, 100)}${drop(72, 93)}`,
  // The sun stops short of the cloud (its hidden part is not drawn). The rain falls from under
  // the cloud's right-hand end: "Maybe." and "Partly." reach under the rest of the icon at some
  // widths and text sizes, and the answer is drawn over the icon, so a line there would show
  // through the gaps in the letters. Checked from 320px to 1280px at 100-200% text.
  showers: `<g opacity=".85"><path d="M35.5 45.1A14 14 0 1 1 57.7 31.1"/>${rays([135, 180, 225, 270, 315], 21, 28, 44, 34)}</g>${cloud(12, -10)}${rain(2, 106, 7, 84, -3, 12)}`,
  rain: `${cloud(0, -16)}${rain(4, 42, 14, 86, 6, 16)}`,
  heavy: `${cloud(0, -18, 0.15)}${rain(6, 37, 12, 82, 7, 20)}`,
  drenched: `${cloud(0, -24, 0.35)}${rain(7, 34, 10, 76, 6, 16)}<g opacity=".75"><ellipse cx="60" cy="108" rx="30" ry="8"/><ellipse cx="60" cy="108" rx="15" ry="3.5"/></g>`,
};

/**
 * 16px icons for the Hot | Wet | Snow | Wind toggle: 24×24 viewBox, stroke currentColor at width
 * 2.
 */
export const TOPIC_ICONS: Record<Topic, string> = {
  hot: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  wet: '<path d="M12 3c3.6 4.4 6 7.6 6 10.7a6 6 0 0 1-12 0C6 10.6 8.4 7.4 12 3z"/>',
  snow: SNOW_TOPIC_ICON,
  wind: WIND_TOPIC_ICON,
};
