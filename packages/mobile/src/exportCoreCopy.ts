/**
 * `CoreCopy.swift` (iOS build spec, section 7.1): the strings the app shares with the website,
 * from core's `copy.ts`, so the two never word the same thing differently. Only the `COPY` keys
 * the app uses are written, in `COPY`'s order; the labels keyed by a view, units, band, reason or
 * error code become functions over the Swift type, with a case for each key in core's order. A
 * key core adds that the Swift type lacks fails the build, not the app.
 */
import {
  COPY,
  CREDIT_LINKS,
  ERROR_MESSAGES,
  SNOW_BAND_LABELS,
  SNOW_REASON_LABELS,
  TOMORROW_LABEL,
  UNITS_LABELS,
  UNIT_NAMES,
  VIEWS,
  VIEW_LABELS,
  WEEKDAYS,
} from '@isithot/core';
import {
  generatedHeader,
  swiftCall,
  swiftCase,
  swiftIdentifier,
  swiftLet,
  swiftString,
} from './swift';

export const CORE_COPY_PATH =
  'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated/CoreCopy.swift';

export const CORE_COPY_SOURCE = 'packages/core/src/copy.ts';

/**
 * The `COPY` keys the app shows: section 10.9's list, and the picker's title, close button and
 * locating line, the switcher's label and the credits. `UNITS_LABELS.snow` is written as
 * `snowUnitsLabel`, so `COPY.snowUnitsLabel` (the same string) isn't listed.
 */
export const CORE_COPY_KEYS = [
  'viewsLabel',
  'notAvailable',
  'checking',
  'unavailable',
  'retry',
  'approximate',
  'useMyLocation',
  'locating',
  'locationDenied',
  'searchLabel',
  'searchPlaceholder',
  'searchNoResults',
  'searchTooShort',
  'close',
  'outboundIntro',
  'nearby',
  'forecastCredit',
  'metOfficeCredit',
  'climateCredit',
  'nextHoursSnow',
  'stale',
  'updated',
  'yesterday',
  'howItWorks',
  'metOfficeWarnings',
] as const satisfies readonly (keyof typeof COPY)[];

/** A `switch` over a Swift enum, a case per key: `case .now: "Now"`. */
function switchOver(
  value: string,
  labels: Readonly<Record<string, string>>,
  rest: string[] = [],
): string[] {
  return [
    `    switch ${value} {`,
    ...Object.entries(labels).flatMap(([key, label]) =>
      swiftCase('    ', `.${swiftIdentifier(key)}`, swiftString(label)),
    ),
    ...rest,
    '    }',
  ];
}

/** The credits' linked phrases as Swift, each an https link, or it throws. */
function creditLinks(): string[] {
  return CREDIT_LINKS.flatMap((link) => {
    if (new URL(link.url).protocol !== 'https:') throw new Error(`Not an https link: ${link.url}`);
    return swiftCall(
      '    ',
      'CreditLink',
      [`phrase: ${swiftString(link.phrase)}`, `url: ${swiftString(link.url)}`],
      ',',
    );
  });
}

export function coreCopySwift(): string {
  const wanted = new Set<string>(CORE_COPY_KEYS);
  const copy = Object.entries(COPY).filter(([key]) => wanted.has(key));
  // In VIEWS' order, left to right, whatever VIEW_LABELS' own order.
  const views = Object.fromEntries(VIEWS.map((view) => [view, VIEW_LABELS[view]]));
  return [
    generatedHeader(CORE_COPY_SOURCE),
    '',
    '/// The words the app shares with the website (core `copy.ts`). The server words the answers',
    "/// themselves, and the app's own strings are `AppCopy`.",
    'public enum CoreCopy {',
    ...copy.flatMap(([key, text]) =>
      swiftLet('  ', `public static let ${swiftIdentifier(key)}`, swiftString(text)),
    ),
    '',
    "  /// The snow units control's label (core `UNITS_LABELS.snow`).",
    ...swiftLet('  ', 'public static let snowUnitsLabel', swiftString(UNITS_LABELS.snow)),
    '',
    "  /// The middle view's label while it answers for tomorrow (core `TOMORROW_LABEL`).",
    ...swiftLet('  ', 'public static let tomorrowLabel', swiftString(TOMORROW_LABEL)),
    '',
    "  /// The days of the week, Sunday first (core `WEEKDAYS`): a day of the week's rows as",
    '  /// VoiceOver reads it, "Tuesday" for the row labelled "Tue".',
    '  public static let weekdays: [String] = [',
    ...WEEKDAYS.map((day) => `    ${swiftString(day)},`),
    '  ]',
    '',
    "  /// A view's tab label (core `VIEW_LABELS`). `MiddleDay.label` says when Today reads",
    '  /// `tomorrowLabel` instead.',
    '  public static func viewLabel(_ view: AppView) -> String {',
    ...switchOver('view', views),
    '  }',
    '',
    "  /// The snow units control's choices (core `UNIT_NAMES.snow`): cm with °C, inches with °F.",
    '  public static func snowUnitName(_ units: Units) -> String {',
    ...switchOver('units', UNIT_NAMES.snow),
    '  }',
    '',
    "  /// A band's label (core `SNOW_BAND_LABELS`), or nil for a band the app doesn't know.",
    '  public static func snowBandLabel(_ band: SnowBand) -> String? {',
    ...switchOver('band', SNOW_BAND_LABELS, ['    case .unknown: nil']),
    '  }',
    '',
    '  /// Why a day without snow has none (core `SNOW_REASON_LABELS`), or nil for a reason the app',
    "  /// doesn't know.",
    '  public static func snowReasonLabel(_ reason: SnowReason) -> String? {',
    ...switchOver('reason', SNOW_REASON_LABELS, ['    case .unknown: nil']),
    '  }',
    '',
    '  /// A phrase of the credits that links out, and where to (core `CREDIT_LINKS`).',
    '  public struct CreditLink: Sendable, Equatable {',
    '    public let phrase: String',
    '    public let url: String',
    '  }',
    '',
    "  /// The credits' linked phrases, in core's order, which `Credits.parts(_:)` (IsItLogic) splits",
    '  /// a credit by, as core `creditParts` does.',
    '  public static let creditLinks: [CreditLink] = [',
    ...creditLinks(),
    '  ]',
    '',
    "  /// The API error envelope's message for its code (core `ERROR_MESSAGES`), or nil for a code",
    "  /// the app doesn't know.",
    '  public static func errorMessage(code: String) -> String? {',
    '    switch code {',
    ...Object.entries(ERROR_MESSAGES).flatMap(([code, message]) =>
      swiftCase('    ', swiftString(code), swiftString(message)),
    ),
    '    default: nil',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
}
