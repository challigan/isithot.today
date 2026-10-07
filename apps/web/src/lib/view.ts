/**
 * Markup shared by server-rendered pages and the browser, so both paint exactly the same
 * thing. Everything here is built from numbers and our own model names; place names are
 * never passed through these helpers.
 */
import type { ApiDay, Band } from '@isithot/core';

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

export interface StripLayout {
  band: { left: number; width: number };
  dots: Array<{ left: number; out: boolean; title: string }>;
}

const clamp = (v: number): number => Math.min(100, Math.max(0, v));

/** Positions (in %) for the agreement band and one dot per model. */
export function stripLayout(day: ApiDay): StripLayout {
  const lo = day.scale.min;
  const hi = day.scale.max;
  const pos = (t: number): number => clamp(((t - lo) / (hi - lo || 1)) * 100);
  const left = pos(day.consensus.bandLow);
  const right = pos(day.consensus.bandHigh);
  return {
    band: { left, width: right - left },
    dots: day.models.map((m) => ({
      left: pos(m.value),
      out: !m.agrees,
      title: `${m.name} ${m.high}°`,
    })),
  };
}

const pct = (v: number): string => `${Number(v.toFixed(3))}%`;

export function stripHtml(day: ApiDay): string {
  const layout = stripLayout(day);
  return (
    `<div class="band" style="left:${pct(layout.band.left)};width:${pct(layout.band.width)}"></div>` +
    layout.dots
      .map(
        (d) =>
          `<div class="dot${d.out ? ' out' : ''}" style="left:${pct(d.left)}" title="${d.title}"></div>`,
      )
      .join('')
  );
}

export function listHtml(day: ApiDay): string {
  return day.models
    .map(
      (m) =>
        `<li class="${m.agrees ? '' : 'out'}"><span class="t">${m.high}°</span><span class="n">${m.name}</span></li>`,
    )
    .join('');
}

export { pct };
