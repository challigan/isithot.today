/**
 * The snow glyphs as asset catalogue image sets for SnowKit (iOS build spec, sections 7.1 and
 * 7.2), from the website's SVG (`SNOW_GLYPHS` in apps/web/src/lib/snowGlyphs.ts, which
 * scripts/mobile-generate.ts passes in as strings).
 *
 * Each image set is a template image: drawn in black, so only its alpha counts, and SwiftUI
 * paints it in the foreground style (the palette's ink), as the website strokes it in
 * `currentColor`. A band's glyph is one set under the band's name. A glyph with flakes that drift
 * (the website's `class="drift"`, animated by global.css) has two more sets, `<band>-still` and
 * `<band>-drift`, which drawn one over the other make the whole glyph, so the app can move the
 * flakes alone.
 *
 * `Resources/Glyphs.xcassets` holds them as SVG, kept as vectors. `Fallback/Glyphs.xcassets`
 * holds the same sets as 1x, 2x and 3x PNGs rendered by resvg, which SnowKit uses instead if the
 * SVGs don't render correctly (V7: change the resource and the exclude in IsItKit's
 * Package.swift). `Generated/GlyphAssets.swift` names the sets, for `Glyphs`.
 */
import type { GeneratedFile } from './generate';
import { encodePng, render } from './png';
import { generatedHeader, swiftString } from './swift';

const SNOW_KIT = 'apps/ios/Packages/IsItKit/Sources/SnowKit';
export const GLYPHS_DIR = `${SNOW_KIT}/Resources/Glyphs.xcassets`;
export const GLYPHS_FALLBACK_DIR = `${SNOW_KIT}/Fallback/Glyphs.xcassets`;
export const SNOW_KIT_GENERATED_DIR = `${SNOW_KIT}/Generated`;
export const GLYPH_ASSETS_PATH = `${SNOW_KIT_GENERATED_DIR}/GlyphAssets.swift`;
const SOURCE = 'apps/web/src/lib/snowGlyphs.ts';

/** The glyphs' size in points: the website's view box. */
export const GLYPH_POINTS = 120;
export const GLYPH_SCALES = [1, 2, 3] as const;

/**
 * How the website draws every glyph (the `<svg>` in Now.astro, Today.astro and Week.astro), in
 * black: here on a group, where Core SVG is surest to inherit it.
 */
const STROKE =
  'fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"';

/** The shapes a glyph may use: SVG's basic shapes and paths, in groups. */
const ELEMENTS = new Set(['g', 'path', 'line', 'circle', 'ellipse', 'rect', 'polyline', 'polygon']);

export interface GlyphElement {
  /** The element as SVG, black where it was `currentColor`, without its class. */
  svg: string;
  /** Whether it drifts (`class="drift"`). */
  drift: boolean;
}

/**
 * A glyph's SVG body as its top-level elements. Throws on anything a template image can't show
 * as the website does: text between elements, an element other than a shape or group, a colour
 * other than `currentColor`, a CSS variable or reference, a `style`, or a class other than a
 * top-level `drift`.
 */
export function glyphElements(body: string): GlyphElement[] {
  const fail = (why: string): never => {
    throw new Error(`Glyph ${JSON.stringify(body.slice(0, 60))}…: ${why}`);
  };
  const found: GlyphElement[] = [];
  const tag = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
  let depth = 0;
  let start = 0;
  let drift = false;
  let last = 0;
  for (const m of body.matchAll(tag)) {
    const [whole, closing, name, attributes, selfClosing] = m as unknown as string[];
    if (body.slice(last, m.index).trim()) fail('text outside the elements');
    last = m.index + whole!.length;
    if (!ELEMENTS.has(name!)) fail(`<${name}> isn't a shape or a group`);
    if (closing) {
      depth -= 1;
      if (depth < 0) fail(`</${name}> closes nothing`);
    } else {
      for (const [, attribute, value] of attributes!.matchAll(/([\w:-]+)="([^"]*)"/g)) {
        if (attribute === 'class') {
          if (value !== 'drift') fail(`class "${value}" means nothing here`);
          if (depth > 0) fail('only a top-level element can drift');
        } else if (attribute === 'style') {
          fail('style could hide a colour: use attributes');
        } else if (
          (attribute === 'fill' || attribute === 'stroke') &&
          value !== 'currentColor' &&
          value !== 'none'
        ) {
          fail(`${attribute}="${value}": a template image has one colour, currentColor`);
        } else if (/var\(|url\(/.test(value!)) {
          fail(`${attribute}="${value}" refers to something only the page has`);
        }
      }
      if (depth === 0) {
        start = m.index;
        drift = / class="drift"/.test(attributes!);
      }
      if (!selfClosing) depth += 1;
    }
    if (depth === 0) {
      const svg = body
        .slice(start, last)
        .replace(' class="drift"', '')
        .replaceAll('currentColor', '#000');
      found.push({ svg, drift });
    }
  }
  if (body.slice(last).trim()) fail('text outside the elements');
  if (depth !== 0) fail('an element is never closed');
  if (!found.length) fail('nothing to draw');
  return found;
}

/** A whole SVG document drawing `elements` as the website does, in black. */
export function glyphSvg(elements: readonly GlyphElement[]): string {
  const size = GLYPH_POINTS;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<g ${STROKE}>${elements.map((e) => e.svg).join('')}</g></svg>\n`
  );
}

export interface ImageSet {
  /** Its name in the catalogue: the band, or the band with `-still` or `-drift`. */
  name: string;
  svg: string;
}

/** Every image set, in the bands' order: each glyph, then its still and drift layers if any. */
export function glyphImageSets(glyphs: Readonly<Record<string, string>>): ImageSet[] {
  const sets: ImageSet[] = [];
  for (const [band, body] of Object.entries(glyphs)) {
    const elements = glyphElements(body);
    sets.push({ name: band, svg: glyphSvg(elements) });
    const drifting = elements.filter((e) => e.drift);
    if (!drifting.length) continue;
    const still = elements.filter((e) => !e.drift);
    if (!still.length) throw new Error(`Glyph ${band}: nothing in it stays still`);
    sets.push({ name: `${band}-still`, svg: glyphSvg(still) });
    sets.push({ name: `${band}-drift`, svg: glyphSvg(drifting) });
  }
  return sets;
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const INFO = { author: 'xcode', version: 1 };

/** The glyph as a PNG at `scale`: black, on transparent. */
export function glyphPng(svg: string, scale: number): Uint8Array {
  const pixels = GLYPH_POINTS * scale;
  const image = render(svg, pixels);
  if (image.width !== pixels || image.height !== pixels) {
    throw new Error(
      `A glyph should render ${pixels}×${pixels}, not ${image.width}×${image.height}`,
    );
  }
  return encodePng(image, true);
}

/** `GlyphAssets.swift`: the sets' names, so `Glyphs` never retypes them. */
export function glyphAssetsSwift(sets: readonly ImageSet[]): string {
  const list = (names: string[]) => names.map((name) => `    ${swiftString(name)},`);
  const glyphs = sets.filter((s) => !/-(still|drift)$/.test(s.name)).map((s) => s.name);
  const drifting = glyphs.filter((name) => sets.some((s) => s.name === `${name}-drift`));
  return [
    generatedHeader(SOURCE),
    '',
    '/// The image sets in `Resources/Glyphs.xcassets` (and, as PNGs, `Fallback/Glyphs.xcassets`):',
    "/// each band's glyph under the band's name, and for a glyph with flakes that drift, its two",
    '/// layers, `<name>-still` and `<name>-drift`.',
    'enum GlyphAssets {',
    '  /// The bands with a glyph.',
    '  static let names: Set<String> = [',
    ...list(glyphs),
    '  ]',
    '',
    '  /// The glyphs with flakes that drift.',
    '  static let drifting: Set<String> = [',
    ...list(drifting),
    '  ]',
    '}',
    '',
  ].join('\n');
}

/** Both catalogues and `GlyphAssets.swift`. */
export function glyphFiles(glyphs: Readonly<Record<string, string>>): GeneratedFile[] {
  const sets = glyphImageSets(glyphs);
  const files: GeneratedFile[] = [
    { path: `${GLYPHS_DIR}/Contents.json`, contents: json({ info: INFO }) },
    { path: `${GLYPHS_FALLBACK_DIR}/Contents.json`, contents: json({ info: INFO }) },
  ];
  const properties = { 'template-rendering-intent': 'template' };
  for (const set of sets) {
    const dir = `${GLYPHS_DIR}/${set.name}.imageset`;
    files.push(
      {
        path: `${dir}/Contents.json`,
        contents: json({
          images: [{ filename: `${set.name}.svg`, idiom: 'universal' }],
          info: INFO,
          properties: { 'preserves-vector-representation': true, ...properties },
        }),
      },
      { path: `${dir}/${set.name}.svg`, contents: set.svg },
    );
    const fallback = `${GLYPHS_FALLBACK_DIR}/${set.name}.imageset`;
    const pngs = GLYPH_SCALES.map((scale) => ({ scale, filename: `${set.name}@${scale}x.png` }));
    files.push({
      path: `${fallback}/Contents.json`,
      contents: json({
        images: pngs.map((p) => ({
          filename: p.filename,
          idiom: 'universal',
          scale: `${p.scale}x`,
        })),
        info: INFO,
        properties,
      }),
    });
    for (const p of pngs) {
      files.push({ path: `${fallback}/${p.filename}`, contents: glyphPng(set.svg, p.scale) });
    }
  }
  files.push({ path: GLYPH_ASSETS_PATH, contents: glyphAssetsSwift(sets) });
  return files;
}
