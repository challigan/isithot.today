/**
 * `Palettes.swift` (iOS build spec, sections 7.1, 10.1 and 16): the snow bands' colours, the
 * website's own (core `SNOW_PALETTES`), with the contrast of each band's `ink` against both ends
 * of its gradient, and `Palettes.content`, the app's own pages' (`CONTENT_BAND`). It is plain
 * data, keyed by the band, so it goes into IsItModel beside `SnowBand`, where every target reaches
 * it, the widget too, and it compiles and is tested on Linux. SnowKit's `Color(rgb:)` and
 * IsItUI's turn a value into a colour. The spec put it in IsItUI, which the widget doesn't link.
 * The shares the app mixes them by are brandColours.ts's.
 */
import { SNOW_PALETTES, type Palette, type SnowBand } from '@isithot/core';
import { generatedHeader, swiftCall, swiftCase, swiftDouble, swiftIdentifier } from './swift';

export const PALETTES_PATH =
  'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated/Palettes.swift';

export const PALETTES_SOURCE = 'packages/core/src/palettes.ts';

/** What a band the app doesn't know draws as (Swift's `SnowBand.unknown`). */
export const UNKNOWN_BAND_DRAWS_AS: SnowBand = 'nosnow';

/**
 * The band whose palette the app's own pages wear (`Palettes.content`: Settings and every page it
 * opens), fixed in both appearances: the website's content pages' (apps/web `LOOKS.snow.content`,
 * its About, Privacy, Support and Terms).
 */
export const CONTENT_BAND: SnowBand = 'snow';

/** WCAG AA for body text, which every band's ink meets on both ends of its gradient. */
export const BODY_TEXT_CONTRAST = 4.5;

/** "#f6eef9" as its red, green and blue, 0 to 255. Anything but six hex digits throws. */
export function rgb(hex: string): [number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Not a #rrggbb colour: ${hex}`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2's relative luminance of an sRGB colour, as scripts/palette-contrast.mjs works it out. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG 2's contrast ratio between two colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * A ratio for the generated file: rounded down to two decimals, so a pair under 4.5:1 can never
 * read as 4.5. The tiny allowance keeps 4.58 from reading 4.57 where the double sits just under.
 */
export function ratioDown(ratio: number): number {
  return Math.floor(ratio * 100 + 1e-9) / 100;
}

/** "#f6eef9" as the Swift literal 0xf6eef9. */
export function swiftHex(hex: string): string {
  rgb(hex);
  return `0x${hex.slice(1).toLowerCase()}`;
}

/** "85%" as 0.85. */
export function opacity(percent: string): number {
  const match = /^(\d+(?:\.\d+)?)%$/.exec(percent);
  if (!match) throw new Error(`Not a percentage: ${percent}`);
  return Number(match[1]) / 100;
}

/** The arguments of a band's `Palette(…)`. */
export function paletteArguments(p: Palette): string[] {
  return [
    `g1: ${swiftHex(p.g1)}`,
    `g2: ${swiftHex(p.g2)}`,
    `g3: ${swiftHex(p.g3)}`,
    `ink: ${swiftHex(p.ink)}`,
    `pill: ${swiftHex(p.pill)}`,
    `glow: ${swiftDouble(opacity(p.glow))}`,
    `inkOnG1: ${swiftDouble(ratioDown(contrastRatio(p.ink, p.g1)))}`,
    `inkOnG2: ${swiftDouble(ratioDown(contrastRatio(p.ink, p.g2)))}`,
  ];
}

export function palettesSwift(): string {
  const bands = Object.keys(SNOW_PALETTES) as SnowBand[];
  const fallback = UNKNOWN_BAND_DRAWS_AS;
  return [
    generatedHeader(PALETTES_SOURCE),
    '',
    "/// One band's colours (core `Palette`), each 0xRRGGBB in sRGB: the page's gradient from `g1`",
    '/// to `g2`, the glow of `g3` at `glow` opacity (0 to 1) at its centre, the text colour `ink`,',
    "/// and `pill`, the controls' colour. `inkOnG1` and `inkOnG2` are ink's WCAG 2 contrast ratio",
    '/// against each end of the gradient, rounded down to two decimals.',
    'public struct Palette: Sendable, Equatable {',
    '  public let g1: UInt32',
    '  public let g2: UInt32',
    '  public let g3: UInt32',
    '  public let ink: UInt32',
    '  public let pill: UInt32',
    '  public let glow: Double',
    '  public let inkOnG1: Double',
    '  public let inkOnG2: Double',
    '}',
    '',
    "/// The bands' palettes, the website's own (core `SNOW_PALETTES`).",
    'public enum Palettes {',
    `  /// A band's palette. A band the app doesn't know draws as \`${fallback}\`.`,
    '  public static func snow(_ band: SnowBand) -> Palette {',
    '    switch band {',
    ...bands.flatMap((band) =>
      swiftCase(
        '    ',
        band === fallback ? `.${swiftIdentifier(band)}, .unknown` : `.${swiftIdentifier(band)}`,
        `Snow.${swiftIdentifier(band)}`,
      ),
    ),
    '    }',
    '  }',
    '',
    "  /// The app's own pages' palette (Settings and every page it opens), fixed in both",
    "  /// appearances: the website's content pages' (apps/web `LOOKS.snow.content`, its About,",
    '  /// Privacy, Support and Terms).',
    `  public static let content = Snow.${swiftIdentifier(CONTENT_BAND)}`,
    '',
    "  /// Each band by name, in core's order.",
    '  public enum Snow {',
    ...bands.flatMap((band) =>
      swiftCall(
        '    ',
        `public static let ${swiftIdentifier(band)} = Palette`,
        paletteArguments(SNOW_PALETTES[band]),
      ),
    ),
    '  }',
    '}',
    '',
  ].join('\n');
}
