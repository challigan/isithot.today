/**
 * The app icon (iOS build spec, section 7.1; Carl approves it, Q9): the website's snow favicon
 * (apps/web/public/snow/favicon.svg, which scripts/mobile-generate.ts passes in) as the three
 * 1024×1024 PNGs of a single-size AppIcon set, from which Xcode makes every size.
 *
 * - any: the favicon, full bleed. iOS rounds the corners itself, so its rounded rectangle becomes
 *   a square, and nothing is transparent.
 * - dark (iOS 18): the favicon's gradient taken most of the way to black, and the flake in its top
 *   colour taken half way to white.
 * - tinted (iOS 18): a white flake on black. iOS tints the greys.
 *
 * App Store Connect refuses an icon with an alpha channel, so each PNG is RGB, and rendering
 * fails unless every pixel is opaque.
 */
import type { GeneratedFile } from './generate';
import { encodePng, pngHeader, render } from './png';

export const ASSETS_DIR = 'apps/ios/Apps/Snow/Resources/Assets.xcassets';
export const APP_ICON_DIR = `${ASSETS_DIR}/AppIcon.appiconset`;
export const ICON_SIZE = 1024;
export const ICON_VARIANTS = ['any', 'dark', 'tinted'] as const;
export type IconVariant = (typeof ICON_VARIANTS)[number];

/** How much of each gradient colour the dark icon keeps (the rest is black). */
const DARK_BACKGROUND = 0.25;
/** How far the dark icon's flake goes from the gradient's top colour to white. */
const DARK_FLAKE = 0.5;

/** `a` taken the fraction `t` of the way to `b`, both `#rrggbb`. */
export function mix(a: string, b: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  let out = '#';
  for (let i = 0; i < 3; i++) {
    const value = Math.round(channel(a, i) * (1 - t) + channel(b, i) * t);
    out += value.toString(16).padStart(2, '0');
  }
  return out;
}

interface Favicon {
  /** The background, which fills the 120×120 view box. */
  rect: string;
  /** The gradient's stop colours, top first. */
  stops: string[];
  /** The flake: a group stroked in white. */
  flake: string;
}

const once = (svg: string, pattern: RegExp, what: string): string => {
  const found = svg.match(new RegExp(pattern, 'g')) ?? [];
  if (found.length !== 1) {
    throw new Error(`favicon.svg: expected one ${what}, found ${found.length}`);
  }
  return found[0]!;
};

/** The parts of favicon.svg the icons change; throws when it isn't shaped as they expect. */
function faviconParts(svg: string): Favicon {
  once(svg, /<svg [^>]*viewBox="0 0 120 120"[^>]*>/, '120×120 view box');
  const rect = once(svg, /<rect [^>]*\/>/, 'background rectangle');
  if (!/ width="120" height="120" /.test(rect) || !rect.includes('fill="url(#g)"')) {
    throw new Error('favicon.svg: the background should fill the view box with the gradient #g');
  }
  const gradient = once(svg, /<linearGradient id="g"[^>]*>.*?<\/linearGradient>/, 'gradient #g');
  const stops = [...gradient.matchAll(/ stop-color="(#[0-9a-f]{6})"/g)].map((m) => m[1]!);
  if (stops.length < 2) throw new Error('favicon.svg: the gradient should have #rrggbb stops');
  const flake = once(svg, /<g [^>]*stroke="#fff"[^>]*>.*?<\/g>/, 'flake stroked in white');
  return { rect, stops, flake };
}

/** The SVG for one of the icon's appearances. */
export function iconSvg(favicon: string, variant: IconVariant): string {
  const { rect, stops, flake } = faviconParts(favicon);
  const square = rect.replace(/ rx="[^"]*"/, '');
  let svg = favicon.replace(rect, square);
  if (variant === 'dark') {
    for (const stop of new Set(stops)) {
      svg = svg.replaceAll(
        `stop-color="${stop}"`,
        `stop-color="${mix(stop, '#000000', 1 - DARK_BACKGROUND)}"`,
      );
    }
    const light = mix(stops[0]!, '#ffffff', DARK_FLAKE);
    svg = svg.replace(flake, flake.replace('stroke="#fff"', `stroke="${light}"`));
  } else if (variant === 'tinted') {
    svg = svg.replace(square, square.replace('fill="url(#g)"', 'fill="#000"'));
  }
  return svg;
}

/** `svg` as a 1024×1024 RGB PNG; throws unless it fills the square opaquely. */
export function iconPng(svg: string): Uint8Array {
  const image = render(svg, ICON_SIZE);
  if (image.width !== ICON_SIZE || image.height !== ICON_SIZE) {
    throw new Error(
      `The icon should be ${ICON_SIZE}×${ICON_SIZE}, not ${image.width}×${image.height}`,
    );
  }
  const png = encodePng(image, false);
  const header = pngHeader(png);
  if (header.colourType !== 2 || header.chunks.includes('tRNS')) {
    throw new Error('The icon PNG has an alpha channel');
  }
  return png;
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The asset catalogue's own Contents.json, and the AppIcon set's files. */
export function iconFiles(favicon: string): GeneratedFile[] {
  const images = ICON_VARIANTS.map((variant) => ({
    ...(variant === 'any' ? {} : { appearances: [{ appearance: 'luminosity', value: variant }] }),
    filename: `${variant}.png`,
    idiom: 'universal',
    platform: 'ios',
    size: `${ICON_SIZE}x${ICON_SIZE}`,
  }));
  return [
    {
      path: `${ASSETS_DIR}/Contents.json`,
      contents: json({ info: { author: 'xcode', version: 1 } }),
    },
    {
      path: `${APP_ICON_DIR}/Contents.json`,
      contents: json({ images, info: { author: 'xcode', version: 1 } }),
    },
    ...ICON_VARIANTS.map((variant) => ({
      path: `${APP_ICON_DIR}/${variant}.png`,
      contents: iconPng(iconSvg(favicon, variant)),
    })),
  ];
}
