/**
 * Markup shared by server-rendered pages and the browser, so both paint exactly the same
 * thing. The layout and words come from core `viewDisplay`; everything here is built from
 * numbers, our own model names and our own copy. Place names are never passed through these
 * helpers.
 */
import {
  UV_LEVEL_LABELS,
  type AnyBand,
  type Band,
  type NowItem,
  type TodayModels,
  type UvDisplay,
  type WeekItem,
} from '@isithot/core';
import { SNOW_GLYPHS } from './snowGlyphs';
import { RAIN_GLYPHS } from './wetGlyphs';

const rays = (n: number, r1: number, r2: number, cx = 60, cy = 60): string =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const p = (r: number) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r].map((v) => v.toFixed(1));
    const [x1, y1] = p(r1);
    const [x2, y2] = p(r2);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }).join('');

const CLOUD = 'M36 92h48a17 17 0 0 0 1-34 24 24 0 0 0-45-4 19 19 0 0 0-4 38z';

/** Icons from the approved prototype: 120×120 viewBox, stroke currentColor. */
export const GLYPHS: Record<Band, string> = {
  freezing: `<g>${[0, 60, 120]
    .map(
      (d) =>
        `<g transform="rotate(${d} 60 60)"><line x1="60" y1="18" x2="60" y2="102"/><path d="M50 26l10 10 10-10M50 94l10-10 10 10"/></g>`,
    )
    .join('')}</g>`,
  cold: `<path d="${CLOUD}" /><path d="M24 104h40M70 104h14M34 112h30" opacity=".7"/>`,
  mild: `<g opacity=".85"><circle cx="44" cy="44" r="15"/>${rays(8, 23, 30, 44, 44)}</g><path d="${CLOUD}" transform="translate(8 6)" fill="var(--g2)"/>`,
  warm: `<circle cx="60" cy="60" r="20"/><g class="spin">${rays(12, 30, 38)}</g>`,
  hot: `<circle cx="60" cy="60" r="22" fill="currentColor" fill-opacity=".18"/><g class="spin">${rays(12, 31, 46)}</g>`,
  scorching: `<circle cx="60" cy="60" r="22" fill="currentColor" fill-opacity=".3"/><circle cx="60" cy="60" r="29" opacity=".5"/><g class="spin">${rays(16, 36, 54)}</g>`,
};

/** Every topic's icons, by band: band keys are unique across topics. */
const ALL_GLYPHS: Record<AnyBand, string> = { ...GLYPHS, ...RAIN_GLYPHS, ...SNOW_GLYPHS };

/** The icon for any topic's band, or nothing without one. */
export function glyphFor(band: AnyBand | null): string {
  return (band && ALL_GLYPHS[band]) || '';
}

const pct = (v: number): string => `${Number(v.toFixed(3))}%`;

/** The highlighted zone and one dot per model. */
export function stripHtml(models: TodayModels): string {
  const zone = models.zone
    ? `<div class="band" style="left:${pct(models.zone.left)};width:${pct(models.zone.width)}"></div>`
    : '';
  return (
    zone +
    models.dots
      .map(
        (d) =>
          `<div class="dot${d.out ? ' out' : ''}" style="left:${pct(d.left)}" title="${d.title}"></div>`,
      )
      .join('')
  );
}

export function listHtml(models: TodayModels): string {
  return models.items
    .map(
      (m) =>
        `<li class="${m.out ? 'out' : ''}"><span class="t">${m.value}</span><span class="n">${m.name}</span></li>`,
    )
    .join('');
}

/**
 * The next few hours: the value over the time, like the model list. Rows with their own
 * screen reader text ("60% chance at 3pm") read that instead of the two figures.
 */
export function hoursHtml(items: readonly NowItem[]): string {
  return items
    .map((h) =>
      h.sr
        ? `<li><span class="t" aria-hidden="true">${h.value}</span><span class="n" aria-hidden="true">${h.label}</span><span class="sr-only">${h.sr}</span></li>`
        : `<li><span class="t">${h.value}</span><span class="n">${h.label}</span></li>`,
    )
    .join('');
}

/**
 * The hot views' UV line: "UV 7 · High, highest around 1pm" with the level in bold, read out as
 * "UV index 7, high, highest around 1pm". Empty without one.
 */
export function uvHtml(uv: UvDisplay | null): string {
  if (!uv) return '';
  const level = UV_LEVEL_LABELS[uv.level];
  return `<span aria-hidden="true">${uv.text.replace(level, `<b>${level}</b>`)}</span><span class="sr-only">${uv.sr}</span>`;
}

/** One row per day: name, a dot on the week's scale, the value and its band. */
export function weekHtml(items: readonly WeekItem[]): string {
  return items
    .map(
      (d) =>
        `<li><span class="d">${d.label}</span><span class="track" aria-hidden="true">${d.left === null ? '' : `<span class="dot" style="left:${pct(d.left)}"></span>`}</span><span class="t">${d.value}</span><span class="a">${d.bandLabel}</span></li>`,
    )
    .join('');
}

export { pct };
