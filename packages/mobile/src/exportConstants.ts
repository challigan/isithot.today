/**
 * `Constants.swift` (iOS build spec, section 7.1): the numbers the app shares with the server and
 * the website, from core's `config.ts` (and the models' agencies from `copy.ts`) and the client's
 * `config.ts`, under the same names. A group written whole (`SEARCH`, `AHEAD`, `WIDGET`, `ALERTS`,
 * `CLIENT`) gains a member when core adds a key, and stops the generator if the new value isn't a
 * whole number, so a Swift type is chosen for it rather than guessed.
 */
import {
  AHEAD,
  ALERTS,
  CACHE,
  GRID,
  MODELS,
  MODEL_AGENCIES,
  SEARCH,
  SNOW,
  TOMORROW_FROM_HOUR,
  WIDGET,
} from '@isithot/core';
import { CLIENT } from '@isithot/client';
import {
  generatedHeader,
  swiftCall,
  swiftDouble,
  swiftIdentifier,
  swiftInt,
  swiftLet,
  swiftString,
} from './swift';

export const CONSTANTS_PATH =
  'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated/Constants.swift';

export const CONSTANTS_SOURCE =
  'packages/core/src/config.ts, packages/core/src/copy.ts and packages/client/src/config.ts';

type Numbers = Readonly<Record<string, number>>;

const ints = (indent: string, values: Numbers): string[] =>
  Object.entries(values).flatMap(([name, value]) =>
    swiftLet(indent, `public static let ${swiftIdentifier(name)}`, swiftInt(value)),
  );

const doubles = (indent: string, values: Numbers): string[] =>
  Object.entries(values).flatMap(([name, value]) =>
    swiftLet(indent, `public static let ${swiftIdentifier(name)}: Double`, swiftDouble(value)),
  );

/** `public enum Name { … }`, with its doc comment, at two spaces in. */
const group = (doc: string[], name: string, body: string[]): string[] => [
  '',
  ...doc.map((line) => `  /// ${line}`),
  `  public enum ${name} {`,
  ...body,
  '  }',
];

/** A model's agency, which every model must have: the credits name them all. */
function agency(id: string): string {
  const name = MODEL_AGENCIES[id];
  if (!name) throw new Error(`No agency for the model ${id} in core's MODEL_AGENCIES`);
  return name;
}

export function constantsSwift(): string {
  return [
    generatedHeader(CONSTANTS_SOURCE),
    '',
    '/// The numbers the app shares with the server and the website, under their TypeScript names,',
    '/// so the app judges nothing differently. Durations say their unit, as the TypeScript does.',
    'public enum Constants {',
    '  /// From this local hour at the place until midnight, the middle view answers for tomorrow',
    '  /// and the app opens on Now (core `TOMORROW_FROM_HOUR`).',
    `  public static let tomorrowFromHour = ${swiftInt(TOMORROW_FROM_HOUR)}`,
    ...group(
      [
        'Core `GRID`: coordinates are rounded to `forecast` degrees (about 5 km) before they leave',
        'the phone.',
      ],
      'Grid',
      doubles('    ', { forecast: GRID.forecast }),
    ),
    ...group(
      ['Core `SEARCH`: the fewest letters searched for, the most results, and the pause, ms.'],
      'Search',
      ints('    ', SEARCH),
    ),
    ...group(
      [
        'Core `CACHE.forecastStale`, seconds: the longest a forecast is shown after it was',
        'fetched.',
      ],
      'Cache',
      ints('    ', { forecastStale: CACHE.forecastStale }),
    ),
    ...group(
      ["Core `AHEAD`: the forecast hours after the answer's that `ahead=snow` answers."],
      'Ahead',
      ints('    ', AHEAD),
    ),
    ...group(
      ['Core `WIDGET`: how often the widgets fetch and reuse an answer, hours and minutes.'],
      'Widget',
      ints('    ', WIDGET),
    ),
    ...group(
      ['Core `ALERTS`: how often an app registers for notifications again while it is used.'],
      'Alerts',
      ints('    ', ALERTS),
    ),
    ...group(
      [
        'Core `SNOW`: the share of forecasts that makes a day "Yes" (`likelyFrom`) and "Maybe"',
        "(`maybeFrom`), and a whole day's thresholds, cm.",
      ],
      'Snow',
      [
        ...doubles('    ', { likelyFrom: SNOW.likelyFrom, maybeFrom: SNOW.maybeFrom }),
        '',
        '    /// Core `SNOW.day`: from these amounts a whole day has snow, flakes, heavy and deep',
        '    /// snow, cm.',
        '    public enum Day {',
        ...doubles('      ', SNOW.day),
        '    }',
      ],
    ),
    '',
    '  /// A forecast model the answers blend (core `MODELS`), and who runs it (core',
    '  /// `MODEL_AGENCIES`).',
    '  public struct Model: Sendable, Equatable {',
    "    /// Open-Meteo's ID for it.",
    '    public let id: String',
    '    /// "ECMWF", "GFS"',
    '    public let name: String',
    '    /// "NOAA", "the Met Office": worded for the middle of a sentence.',
    '    public let agency: String',
    '  }',
    '',
    "  /// The models, in core's order.",
    '  public static let models: [Model] = [',
    ...MODELS.flatMap((m) =>
      swiftCall(
        '    ',
        'Model',
        [
          `id: ${swiftString(m.id)}`,
          `name: ${swiftString(m.name)}`,
          `agency: ${swiftString(agency(m.id))}`,
        ],
        ',',
      ),
    ),
    '  ]',
    ...group(
      [
        "The client's own timings (client `CLIENT`), ms: back after `refreshAfterMs` away, the",
        'app opens afresh; a refetch while open waits up to `refreshJitterMs` past the hour;',
        'opened within `reuseMs` of its last answer, it keeps it; it waits `requestTimeoutMs` for',
        'an answer, and after a 429 asks again `retryAfterMs` later.',
      ],
      'Client',
      ints('    ', CLIENT),
    ),
    '}',
    '',
  ].join('\n');
}
