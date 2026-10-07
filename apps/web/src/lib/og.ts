/**
 * Renders the 1200×630 Open Graph image: band gradient, answer and city, matching the page.
 * Fonts and the resvg wasm are fetched once per function instance from our own static assets.
 */
import satori from 'satori';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import wasmUrl from '@resvg/resvg-wasm/index_bg.wasm?url';
import font500 from '@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-500-normal.woff?url';
import font700 from '@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff?url';
import font800 from '@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff?url';
import { PALETTES, type Band } from '@isithot/core';
import { GLYPHS } from './view';

export interface OgContent {
  band: Band;
  question: string;
  answer: string;
  verdict: string;
  detail: string;
}

let ready: Promise<{ name: string; data: ArrayBuffer; weight: 500 | 700 | 800 }[]> | null = null;

async function assets(origin: string) {
  const get = async (path: string) => {
    const res = await fetch(new URL(path, origin));
    if (!res.ok) throw new Error(`asset ${path}: ${res.status}`);
    return res.arrayBuffer();
  };
  const [wasm, f5, f7, f8] = await Promise.all([
    get(wasmUrl),
    get(font500),
    get(font700),
    get(font800),
  ]);
  await initWasm(wasm);
  return [
    { name: 'Bricolage Grotesque', data: f5, weight: 500 as const },
    { name: 'Bricolage Grotesque', data: f7, weight: 700 as const },
    { name: 'Bricolage Grotesque', data: f8, weight: 800 as const },
  ];
}

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, children?: unknown): Node => ({
  type,
  props: { style, children },
});

export async function renderOg(content: OgContent, origin: string): Promise<Uint8Array> {
  ready ??= assets(origin).catch((err) => {
    ready = null;
    throw err;
  });
  const fonts = await ready;
  const p = PALETTES[content.band];
  const glyph = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="300" height="300" fill="none" stroke="${p.ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[content.band].replaceAll('currentColor', p.ink).replace('var(--g2)', p.g2)}</svg>`;
  const tree = h(
    'div',
    {
      width: 1200,
      height: 630,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '64px 80px',
      color: p.ink,
      fontFamily: 'Bricolage Grotesque',
      position: 'relative',
      backgroundColor: p.g1,
      backgroundImage: `radial-gradient(circle at 88% 6%, ${rgba(p.g3, 0.85)} 0%, ${rgba(p.g3, 0)} 52%), linear-gradient(168deg, ${p.g1} 0%, ${p.g2} 100%)`,
    },
    [
      {
        type: 'img',
        props: {
          src: `data:image/svg+xml;base64,${btoa(glyph)}`,
          width: 300,
          height: 300,
          style: { position: 'absolute', top: 48, right: 64, opacity: 0.95 },
        },
      },
      h('div', { display: 'flex', fontSize: 34, fontWeight: 700 }, [
        h('span', {}, 'isithot'),
        h('span', { opacity: 0.6, fontWeight: 500 }, '.today'),
      ]),
      h('div', { display: 'flex', flexDirection: 'column' }, [
        h('div', { fontSize: 44, fontWeight: 500, opacity: 0.9 }, content.question),
        h(
          'div',
          { fontSize: 230, fontWeight: 800, letterSpacing: '-0.055em', lineHeight: 0.9 },
          content.answer,
        ),
        h(
          'div',
          { fontSize: 56, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 20 },
          content.verdict,
        ),
      ]),
      h('div', { fontSize: 30, fontWeight: 500, opacity: 0.92 }, content.detail),
    ],
  );
  const svg = await satori(tree as never, { width: 1200, height: 630, fonts });
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}
