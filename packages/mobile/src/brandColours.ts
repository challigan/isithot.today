/**
 * The app's colours beyond the palettes themselves (DECISIONS, "The iPhone app in the website's
 * look"): the shares of ink and pill each surface mixes for its tokens, and the contrast of every
 * pair they make, worked out here so a palette or share change can't pass quietly.
 *
 * Every screen is one of three surfaces, each from a core palette:
 *
 * - **page**: the home screen's pages, in the band of the page on screen, over `PageBackground`
 *   (the 168° gradient from g1 to g2 and the g3 glow at (88%, 6%));
 * - **sheet**: the place picker, in the band of the page it opened over, over `SheetBackground`
 *   (pill to pill 85% + g2 15% at 168°, no glow: the website's `.sheet`);
 * - **content**: Settings and every page it opens, in `Palettes.content` (core
 *   `SNOW_PALETTES.snow`, the website's own content pages' palette), over `PageBackground`.
 *
 * The model is the app's own, the same as `PageBackground` and the UI tests' `PageColours`: its
 * approximation of the website's 168° (`along`), not CSS's own line. Mixes are in sRGB, rounded
 * to 8 bits as a screen draws them, and a pair's ratio is its worst anywhere on a 402 by 874
 * point screen, sampled every 6 points, rounded down.
 * `brandColoursSwift` writes the shares and the content card's colour into IsItModel, where
 * IsItUI and the Linux tests read the same numbers.
 */
import { SNOW_PALETTES, type Palette } from '@isithot/core';
import { CONTENT_BAND, opacity, ratioDown, rgb } from './exportPalettes';
import { generatedHeader, swiftDouble, swiftIdentifier } from './swift';

/** An sRGB colour: red, green and blue, 0 to 255. */
export type Rgb = readonly [number, number, number];

/**
 * How much of each colour a token takes (0 to 1). Each is the website's where it passes, and
 * otherwise the least that does:
 */
export const BRAND_SHARES = {
  /**
   * `pill`, opaque: a page's chips, its tab track and its Retry. Not the website's 85% over the
   * background: Apple's contrast check failed that chip over the gradient on every fixture of
   * PR #34's macOS runs (the tabs not selected and "Use my exact location"), so the build plan's
   * fallback, a flat fill, the case that has never failed.
   */
  chip: 1,
  /** Ink, for secondary text on a flat fill only (the sheet, a card): never on the gradient. */
  soft: 0.85,
  /**
   * Ink over what is beneath: the sheet's Close and pressed rows, a card's pressed rows and the
   * units track. One wash for every surface, Settings' 12% rather than the picker's 10%.
   */
  wash: 0.12,
  /** Ink: the search box's fill. */
  field: 0.08,
  /** Ink: the search box's edge, which WCAG 1.4.11 holds to 3:1 (the website's 45% gives 2.65). */
  fieldBorder: 0.55,
  /** Ink: the edge of a page's Retry and the sheet's Close. */
  border: 0.28,
  /** Ink: a rule, above a page's credits and between a card's rows. */
  hairline: 0.22,
  /** Ink: hairlines and borders under Increase Contrast. */
  increasedLine: 0.4,
  /** Ink: chevrons and arrows on a card (not text, and hidden from VoiceOver). */
  affordance: 0.7,
  /** How far a card moves `pill` away from the ink: toward black under white ink. */
  card: 0.25,
  /** How much g2 the sheet's background takes at its end. */
  sheetEnd: 0.15,
} as const;

/**
 * The website's values the app doesn't use, because they fall short of 4.5:1 somewhere
 * (`unusedPairs`): ink at 10% as a page button's fill (the website's `.button`), and ink at 85%
 * and 90% as text on a page's gradient (the website's soft text and its detail).
 */
export const UNUSED_SHARES = { pageButton: 0.1, pageSoft: 0.85, pageDetail: 0.9 } as const;

/** The screen the pairs are measured on, in points: an iPhone 17's, sampled every `step`. */
export const SCREEN = { width: 402, height: 874, step: 6 } as const;

/** The content surface's palette: the website's content pages' (`Palettes.content`). */
export const CONTENT_PALETTE: Palette = SNOW_PALETTES[CONTENT_BAND];

/** `#rrggbb` as an `Rgb`. */
export const colour = (hex: string): Rgb => rgb(hex);

/** An `Rgb` as `#rrggbb`. */
export const hex = (c: Rgb): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** `a` with `t` of `b` mixed in, in sRGB, rounded to 8 bits (CSS `color-mix`, as drawn). */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as unknown as Rgb;
}

/** `top` at `alpha` over `bottom`. */
export const over = (top: Rgb, alpha: number, bottom: Rgb): Rgb => mix(bottom, top, alpha);

/** WCAG 2's relative luminance. */
export function luminance(c: Rgb): number {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG 2's contrast ratio, 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * How far along the 168° gradient a point is, 0 to 1: the app's own approximation of the
 * website's 168°, from 40% across the top to 60% across the bottom, as `PageBackground` draws it
 * (CSS's own line, corner to corner, tilts about 12°).
 */
function along(x: number, y: number): number {
  const [dx, dy] = [0.2 * SCREEN.width, SCREEN.height];
  const t = ((x - 0.4 * SCREEN.width) * dx + y * dy) / (dx * dx + dy * dy);
  return Math.min(Math.max(t, 0), 1);
}

/**
 * A page's background at (x, y): the gradient from g1 to g2, and over it the g3 glow centred at
 * (88%, 6%), from `glow` to nothing at 52% of the way to the farthest corner. Without the glow
 * under Increase Contrast.
 */
export function pageAt(p: Palette, x: number, y: number, glow = true): Rgb {
  const base = mix(colour(p.g1), colour(p.g2), along(x, y));
  if (!glow) return base;
  const [cx, cy] = [0.88 * SCREEN.width, 0.06 * SCREEN.height];
  const radius =
    Math.hypot(Math.max(cx, SCREEN.width - cx), Math.max(cy, SCREEN.height - cy)) * 0.52;
  const fade = Math.max(0, 1 - Math.hypot(x - cx, y - cy) / radius);
  return mix(base, colour(p.g3), opacity(p.glow) * fade);
}

/** The sheet's background at (x, y): `pill` to pill with `sheetEnd` of g2, at 168°, no glow. */
export function sheetAt(p: Palette, x: number, y: number): Rgb {
  const pill = colour(p.pill);
  return mix(pill, mix(pill, colour(p.g2), BRAND_SHARES.sheetEnd), along(x, y));
}

/** Whether a palette's ink is the light one (white on the dark bands). */
const lightInk = (p: Palette): boolean => luminance(colour(p.ink)) > 0.5;

/**
 * A card's colour: `pill` moved `card` of the way away from the ink, toward black under light
 * ink and white under dark, opaque. `#401a4f` for the content palette.
 */
export function card(p: Palette): Rgb {
  return mix(colour(p.pill), lightInk(p) ? [0, 0, 0] : [255, 255, 255], BRAND_SHARES.card);
}

/** The worst of `ratio` at every sampled point of the screen, rounded down to two decimals. */
export function worst(ratio: (x: number, y: number) => number): number {
  let least = Infinity;
  for (let x = 0; x <= SCREEN.width; x += SCREEN.step) {
    for (let y = 0; y <= SCREEN.height; y += SCREEN.step) least = Math.min(least, ratio(x, y));
  }
  return ratioDown(least);
}

/** Every pair a band's page and sheet make, each its worst on the screen. */
export interface BandPairs {
  /** Page: ink on the gradient and glow (headings, the answer, the detail). */
  inkOnPage: number;
  /** Page: ink on a chip (the place, the gear, the tabs, Retry). */
  inkOnChip: number;
  /** Every surface: `pill` on ink (the selected tab, the units thumb, the primary button). */
  pillOnInk: number;
  /** Sheet: ink on its background. */
  inkOnSheet: number;
  /** Sheet: soft on its background (a row's region and country). */
  softOnSheet: number;
  /** Sheet: ink on the wash (Close, a pressed row). */
  inkOnWash: number;
  /** Sheet: soft on a pressed row. */
  softOnPressedRow: number;
  /** Sheet: soft on the search box (its placeholder). */
  placeholderOnField: number;
  /** Sheet: the search box's edge against the sheet, a non-text pair that needs 3:1. */
  fieldBorder: number;
}

export function bandPairs(p: Palette): BandPairs {
  const [ink, pill] = [colour(p.ink), colour(p.pill)];
  const page = (x: number, y: number) => pageAt(p, x, y);
  const sheet = (x: number, y: number) => sheetAt(p, x, y);
  const soft = (under: Rgb) => contrast(over(ink, BRAND_SHARES.soft, under), under);
  const washed = (x: number, y: number) => over(ink, BRAND_SHARES.wash, sheet(x, y));
  const field = (x: number, y: number) => over(ink, BRAND_SHARES.field, sheet(x, y));
  return {
    inkOnPage: worst((x, y) => contrast(ink, page(x, y))),
    inkOnChip: worst((x, y) => contrast(ink, over(pill, BRAND_SHARES.chip, page(x, y)))),
    pillOnInk: ratioDown(contrast(pill, ink)),
    inkOnSheet: worst((x, y) => contrast(ink, sheet(x, y))),
    softOnSheet: worst((x, y) => soft(sheet(x, y))),
    inkOnWash: worst((x, y) => contrast(ink, washed(x, y))),
    softOnPressedRow: worst((x, y) => soft(washed(x, y))),
    placeholderOnField: worst((x, y) => soft(field(x, y))),
    fieldBorder: worst((x, y) =>
      contrast(over(ink, BRAND_SHARES.fieldBorder, sheet(x, y)), sheet(x, y)),
    ),
  };
}

/** Every pair the content surface makes. */
export interface ContentPairs {
  /** Ink on the page: titles, headings and the version, one line each. */
  inkOnPage: number;
  /** The same under Increase Contrast, with no glow. */
  inkOnPageIncreased: number;
  /** Ink on a card: rows and paragraphs. */
  inkOnCard: number;
  /** Soft on a card: row details, the units footnote. */
  softOnCard: number;
  /** Ink on a pressed row, or on the units track (the wash on a card). */
  inkOnWash: number;
  /** Soft on a pressed row. */
  softOnPressedRow: number;
  /** `pill` on ink: the chosen unit, "Copy address". */
  pillOnInk: number;
  /** A hairline against its card: decorative, so no ratio is needed. */
  hairlineOnCard: number;
}

export function contentPairs(p: Palette = CONTENT_PALETTE): ContentPairs {
  const [ink, pill, fill] = [colour(p.ink), colour(p.pill), card(p)];
  const washed = over(ink, BRAND_SHARES.wash, fill);
  return {
    inkOnPage: worst((x, y) => contrast(ink, pageAt(p, x, y))),
    inkOnPageIncreased: worst((x, y) => contrast(ink, pageAt(p, x, y, false))),
    inkOnCard: ratioDown(contrast(ink, fill)),
    softOnCard: ratioDown(contrast(over(ink, BRAND_SHARES.soft, fill), fill)),
    inkOnWash: ratioDown(contrast(ink, washed)),
    softOnPressedRow: ratioDown(contrast(over(ink, BRAND_SHARES.soft, washed), washed)),
    pillOnInk: ratioDown(contrast(pill, ink)),
    hairlineOnCard: ratioDown(contrast(over(ink, BRAND_SHARES.hairline, fill), fill)),
  };
}

/** The pairs the website's values would make on a band's page, which the app doesn't use. */
export interface UnusedPairs {
  /** Ink on a page button filled with ink at 10%. */
  inkOnPageButton: number;
  /** Ink at 85% on the gradient. */
  softOnPage: number;
  /** Ink at 90% on the gradient (the website's detail). */
  detailOnPage: number;
}

export function unusedPairs(p: Palette): UnusedPairs {
  const ink = colour(p.ink);
  const page = (x: number, y: number) => pageAt(p, x, y);
  const faded = (share: number) =>
    worst((x, y) => contrast(over(ink, share, page(x, y)), page(x, y)));
  return {
    inkOnPageButton: worst((x, y) =>
      contrast(ink, over(ink, UNUSED_SHARES.pageButton, page(x, y))),
    ),
    softOnPage: faded(UNUSED_SHARES.pageSoft),
    detailOnPage: faded(UNUSED_SHARES.pageDetail),
  };
}

export const BRAND_COLOURS_PATH =
  'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated/BrandColours.swift';

export const BRAND_COLOURS_SOURCE = 'packages/mobile/src/brandColours.ts';

/** What each share is for, in the Swift's doc comments. */
const SHARE_DOCS: Record<keyof typeof BRAND_SHARES, string> = {
  chip: '`pill` over a page, opaque: its chips, tab track and Retry.',
  soft: "Ink: secondary text on a flat fill (the sheet, a card), never on a page's gradient.",
  wash: "Ink over what is beneath: the sheet's Close, pressed rows and the units track.",
  field: "Ink: the search box's fill.",
  fieldBorder: "Ink: the search box's edge, 3:1 or more against the sheet.",
  border: "Ink: the edge of a page's Retry and of the sheet's Close.",
  hairline: "Ink: a rule, above a page's credits and between a card's rows.",
  increasedLine: 'Ink: hairlines and borders under Increase Contrast.',
  affordance: 'Ink: chevrons and arrows on a card (not text, hidden from VoiceOver).',
  card: 'How far a card moves `pill` away from the ink: toward black under white ink.',
  sheetEnd: "How much g2 the sheet's background takes at its end.",
};

/** `BrandColours.swift`: the shares, and the content surface's card colour. */
export function brandColoursSwift(): string {
  const [r, g, b] = card(CONTENT_PALETTE);
  const cardHex = `0x${hex([r, g, b]).slice(1)}`;
  return [
    generatedHeader(BRAND_COLOURS_SOURCE),
    '',
    "/// How much of a palette's colours each token of the app's three surfaces takes, 0 to 1: the",
    '/// page (the home screen, in the band on screen), the sheet (the place picker) and content',
    '/// (Settings and its pages, in `Palettes.content`). packages/mobile measures every pair they',
    '/// make on every band, at its worst point on the screen.',
    'public enum BrandShares {',
    ...(Object.keys(BRAND_SHARES) as (keyof typeof BRAND_SHARES)[]).flatMap((key) => [
      `  /// ${SHARE_DOCS[key]}`,
      `  public static let ${swiftIdentifier(key)}: Double = ${swiftDouble(BRAND_SHARES[key])}`,
    ]),
    '}',
    '',
    "/// The app's own colours beyond the palettes, each 0xRRGGBB in sRGB.",
    'public enum BrandColours {',
    "  /// The content surface's cards, opaque: `Palettes.content`'s pill a quarter of the way to",
    `  /// black, ${hex([r, g, b])}.`,
    `  public static let contentCard: UInt32 = ${cardHex}`,
    '}',
    '',
  ].join('\n');
}
