/**
 * Icons for "Will it snow?", drawn like the wet glyphs (wetGlyphs.ts): 120×120 viewBox, stroke
 * currentColor at width 3 with round caps and joins (set on the <svg>), drawn in place and never
 * filled with a background colour. Flakes carry class="drift" so the page can let them drift down
 * twice (under 5 seconds in all, and not at all with reduced motion); at rest every icon is
 * complete.
 */
import type { SnowBand } from '@isithot/core';

const n = (v: number): number => Number(v.toFixed(1));
const rad = (d: number): number => (d / 180) * Math.PI;

/** Sun rays from r1 to r2 out from (cx, cy), at the given angles (degrees, clockwise from east). */
const rays = (angles: number[], r1: number, r2: number, cx = 60, cy = 60): string =>
  angles
    .map((d) => {
      const [c, s] = [Math.cos(rad(d)), Math.sin(rad(d))];
      return `<line x1="${n(cx + c * r1)}" y1="${n(cy + s * r1)}" x2="${n(cx + c * r2)}" y2="${n(cy + s * r2)}"/>`;
    })
    .join('');

/** The hot glyphs' cloud (view.ts), moved up to leave room for the snow, and tinted when heavy. */
const CLOUD = 'M36 92h48a17 17 0 0 0 1-34 24 24 0 0 0-45-4 19 19 0 0 0-4 38z';
const cloud = (dx: number, dy: number, tint = 0): string =>
  `<path d="${CLOUD}" transform="translate(${dx} ${dy})"${tint ? ` fill="currentColor" fill-opacity="${tint}"` : ''}/>`;

/** A six-armed flake of radius r centred on (cx, cy), one path so it drifts as one. */
const flake = (cx: number, cy: number, r = 6): string => {
  const [dx, dy] = [n(r * Math.cos(rad(30))), n(r * Math.sin(rad(30)))];
  return `<path class="drift" d="M${cx} ${n(cy - r)}V${n(cy + r)}M${n(cx - dx)} ${n(cy - dy)}L${n(cx + dx)} ${n(cy + dy)}M${n(cx - dx)} ${n(cy + dy)}L${n(cx + dx)} ${n(cy - dy)}"/>`;
};

/**
 * A flake with branches (the larger single flakes and the toggle's icon): six arms of radius r,
 * each with a V of branches whose point sits on the arm at `at` × r and whose ends reach out by
 * `len` × r, spread `w` × r either side. A plain six-armed flake this size reads as "*".
 */
const crystal = (cx: number, cy: number, r: number, at = 0.55, len = 0.3, w = 0.22): string => {
  let d = '';
  for (const a of [270, 330, 30, 90, 150, 210]) {
    const [c, s] = [Math.cos(rad(a)), Math.sin(rad(a))];
    if (a === 270 || a === 330 || a === 30) {
      d += `M${n(cx - c * r)} ${n(cy - s * r)}L${n(cx + c * r)} ${n(cy + s * r)}`;
    }
    const [tx, ty] = [cx + c * r * at, cy + s * r * at];
    const [ox, oy] = [cx + c * r * (at + len), cy + s * r * (at + len)];
    d += `M${n(ox - s * r * w)} ${n(oy + c * r * w)}L${n(tx)} ${n(ty)}L${n(ox + s * r * w)} ${n(oy - c * r * w)}`;
  }
  return d;
};

/**
 * From a clear winter day to deep snow: a low sun, then one flake, more flakes and a heavier
 * cloud, then a drift. Small flakes are staggered, never in a row: a row of them reads as a
 * masked password ("****").
 */
export const SNOW_GLYPHS: Record<SnowBand, string> = {
  // A low sun on the horizon. Static: only Hot's suns turn.
  nosnow: `<path d="M36 78a24 24 0 0 1 48 0"/>${rays([200, 235, 270, 305, 340], 31, 39, 60, 78)}<path d="M16 78h88"/><path d="M36 90h48" opacity=".6"/>`,
  flakes: `${cloud(0, -16)}<path class="drift" d="${crystal(60, 98, 9, 0.5, 0.5, 0.32)}"/>`,
  // As Wet's showers: one flake under the cloud's right-hand end, clear of "Maybe." (two small
  // flakes there read as footnote marks, "Maybe.**").
  maybesnow: `<g opacity=".85"><path d="M31.5 47.1A14 14 0 1 1 53.7 33.1"/>${rays([135, 180, 225, 270, 315], 21, 28, 40, 36)}</g>${cloud(8, -8)}<path class="drift" d="${crystal(105, 93, 9, 0.5, 0.5, 0.32)}"/>`,
  snow: `${cloud(0, -16)}${flake(42, 90)}${flake(64, 96)}${flake(86, 90)}${flake(53, 110)}${flake(75, 110)}`,
  heavysnow: `${cloud(0, -18, 0.15)}${flake(36, 84)}${flake(57, 90)}${flake(78, 84)}${flake(99, 91)}${flake(43, 106)}${flake(65, 111)}${flake(88, 106)}`,
  // Snowed in: a heavier cloud, flakes and a drift.
  deepsnow: `${cloud(0, -24, 0.35)}${flake(38, 80, 5.5)}${flake(60, 85, 5.5)}${flake(82, 80, 5.5)}${flake(102, 86, 5.5)}${flake(48, 97, 5.5)}${flake(71, 99, 5.5)}<path d="M8 119c13-8 28-10 40-4 15-7 37-9 64 2" opacity=".8"/>`,
};

/** The Snow toggle button's 16px icon (24×24 viewBox, stroke width 2): a branched flake. */
export const SNOW_TOPIC_ICON = `<path d="${crystal(12, 12, 9.5, 0.6, 0.4, 0.26)}"/>`;
