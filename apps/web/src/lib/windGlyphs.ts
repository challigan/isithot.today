/**
 * Icons for "Is it windy?", drawn like the wet and snow glyphs (wetGlyphs.ts, snowGlyphs.ts):
 * 120×120 viewBox, stroke currentColor at width 3 with round caps and joins (set on the <svg>),
 * drawn in place and never filled with a background colour. The signs follow the Beaufort scale's:
 * a flag that hangs, then flies; the wind itself; whole trees in motion; twigs torn off; a storm.
 *
 * Moving parts carry a class the page animates (styles/global.css): "gust" (a wind line slides
 * downwind and fades, then returns from upwind), "flap" (the flag ripples about its pole), "sway"
 * (the tree bends further and back about the foot of its trunk) and "blow" (a torn leaf is carried
 * off and comes back). All end on the complete icon within 4.2 seconds, and none move with reduced
 * motion. Nothing that moves has a transform attribute, which the animation would replace. The wind
 * always blows from the left: wind lines curl at their downwind end, and the flag and trees stream
 * to the right. The lower left of the breezy icon stays empty, where "A bit." reaches under it.
 */
import type { WindBand } from '@isithot/core';

const n = (v: number): number => Number(v.toFixed(1));

/**
 * A wind line from x0 to x1 at height y, ending in a curl of radius r that turns up (dir -1) or
 * down (dir 1) through three quarters of a turn. With r = 0, a plain line.
 */
const gust = (x0: number, y: number, x1: number, r = 0, dir = -1, cls = 'gust'): string =>
  `<path${cls ? ` class="${cls}"` : ''} d="M${x0} ${y}H${x1}${r ? `a${r} ${r} 0 1 ${dir < 0 ? 0 : 1} ${-r} ${n(dir * r)}` : ''}"/>`;

/** The hot glyphs' cloud (view.ts), raised, and tinted when stormy. */
const CLOUD = 'M36 92h48a17 17 0 0 0 1-34 24 24 0 0 0-45-4 19 19 0 0 0-4 38z';
const cloud = (dx: number, dy: number, tint = 0): string =>
  `<path d="${CLOUD}" transform="translate(${dx} ${dy})"${tint ? ` fill="currentColor" fill-opacity="${tint}"` : ''}/>`;

/** A flagpole at x, from the ground (y 108) up to a round finial. */
const pole = (x: number): string => `<path d="M${x} 108V22"/><circle cx="${x}" cy="18" r="3"/>`;

/**
 * A leaf about (cx, cy), tipped by `a` degrees: a pointed oval with its midrib. The tip is a
 * transform on the inner path, so the group carrying the class is free to move.
 */
const leaf = (cx: number, cy: number, a: number): string =>
  `<g class="blow"><path d="M${cx - 8} ${cy}q8-8 16 0q-8 8-16 0zM${cx - 8} ${cy}h11" transform="rotate(${a} ${cx} ${cy})"/></g>`;

/**
 * A tree in the wind, as one group so it sways as one: a trunk curving downwind from the ground
 * and a crown streamed out into ragged tails, with a branch inside it. Bending (very windy) and
 * bent hard (gale). The sway turns about the group's lower left: the trunk's foot.
 */
const TREES = {
  bending:
    '<path d="M40 108c0-14 3-28 12-40"/>' +
    '<path d="M52 68c-14 1-21-10-14-20-3-12 9-21 19-16 6-8 20-7 24 2 9-1 17 4 23 6-6 2-9 4-5 9-7 0-10 2-8 7-8 1-12 3-14 6-8 4-17 6-25 6z"/>' +
    '<path d="M52 68c5-8 12-13 24-16" opacity=".6"/>',
  bent:
    '<path d="M30 108c0-14 6-27 20-36"/>' +
    '<path d="M50 72c-13 2-20-8-14-17-1-10 11-16 20-11 8-6 21-4 25 3 10-1 20 3 29 3-6 3-10 5-6 9-8 0-12 2-9 6-9 0-14 2-17 5-9 3-19 3-28 2z"/>' +
    '<path d="M50 72c7-6 15-10 30-12" opacity=".6"/>',
};
const tree = (shape: keyof typeof TREES): string => `<g class="sway">${TREES[shape]}</g>`;

/** From still air to a storm. */
export const WIND_GLYPHS: Record<WindBand, string> = {
  // Calm (the scale's "smoke rises vertically", flags hang): the flag hangs against its pole.
  // Static: there is no wind to show.
  calm: `${pole(54)}<path d="M54 24c10 0 17 5 18 13 2 14-5 26 0 43l-10 4c-4-12-8-22-8-30"/><path d="M62 30c2 14-4 30 0 50" opacity=".6"/><path d="M40 108h28" opacity=".6"/>`,
  // Breezy ("light flags extended"): the flag flies and ripples, and one wind line passes.
  breezy: `${pole(30)}<path class="flap" d="M30 24c10-5 20 4 30 0s16-2 22 2v26c-6-3-12-5-22-1s-20-4-30 1z"/>${gust(56, 74, 100, 7, 1)}<path d="M18 108h24" opacity=".6"/>`,
  // Windy: the wind itself, the familiar three lines curling at their downwind ends.
  windy: `${gust(16, 42, 80, 10, -1)}${gust(8, 62, 98, 12, -1)}${gust(22, 82, 74, 9, 1)}`,
  // Very windy ("whole trees in motion"): a tree bending downwind, two wind lines.
  verywindy: `${tree('bending')}${gust(72, 20, 104)}${gust(62, 90, 104)}`,
  // Gale ("twigs broken off trees"): the tree bent hard, leaves torn away.
  gale: `${tree('bent')}${gust(58, 28, 102)}${gust(62, 92, 112)}${leaf(108, 40, -20)}${leaf(106, 80, 25)}`,
  // Storm: the heavy cloud of Wet's and Snow's worst bands, violent gusts and a torn leaf.
  storm: `${cloud(0, -30, 0.35)}${gust(14, 76, 92, 9, -1)}${gust(6, 94, 104, 11, 1)}${gust(26, 112, 76)}${leaf(106, 70, -30)}`,
};

/** The Wind toggle button's 16px icon (24×24 viewBox, stroke width 2): three wind lines. */
export const WIND_TOPIC_ICON =
  '<path d="M3 8.5h10a3 3 0 1 0-3-3M3 12h15.5a3 3 0 1 1-3 3M3 15.5h6"/>';
