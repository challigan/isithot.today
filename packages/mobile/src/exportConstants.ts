/**
 * `Constants.swift` (iOS build spec, section 7.1): the numbers the app shares with the server and
 * the website, from core's `config.ts` (and the models' agencies from `copy.ts`) and the client's
 * `config.ts`, under the same names, and willitsnow.today's name, which the top bar shows, and its
 * pages and support address (core `SITES.snow` and `CONTACT_EMAIL`), which the app's Settings
 * open, so no URL or name is typed in Swift.
 * A group written whole (`SEARCH`, `AHEAD`, `WIDGET`, `CLIENT`, `PLACES`, `ADS`) gains a member
 * when core or the client adds a key, and stops the generator if the new value isn't a whole
 * number, so a Swift type is chosen for it rather than guessed. `ALERTS` is not written whole: it
 * holds the notifications run's windows, quiet hours and budgets too, and the app needs only
 * `heartbeatDays`.
 */
import {
  AHEAD,
  ALERTS,
  CACHE,
  CONTACT_EMAIL,
  GRID,
  MODELS,
  MODEL_AGENCIES,
  SEARCH,
  SITES,
  SNOW,
  TOMORROW_FROM_HOUR,
  WIDGET,
} from '@isithot/core';
import { ADS, CLIENT, PLACES } from '@isithot/client';
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

/**
 * willitsnow.today's own pages that the app's Settings open in Safari (iOS build spec, section
 * 10.4), by their paths on the website (`apps/web/src/pages/snow/`, where a test finds each).
 */
export const SITE_PAGES = { privacy: '/privacy', terms: '/terms', support: '/support' } as const;

/** A page of willitsnow.today: an https URL, or it throws. */
function sitePage(path: string): string {
  const url = new URL(path, SITES.snow.url);
  if (url.protocol !== 'https:') throw new Error(`Not an https page: ${url.href}`);
  return url.href;
}

/** The support address, or it throws: one plain address, for a mailto: URL. */
function contactEmail(address: string): string {
  if (!/^[a-z0-9.-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(address)) {
    throw new Error(`Not a plain email address: ${address}`);
  }
  return address;
}

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
    '/// so the app judges nothing differently, and the site it links to. Durations say their',
    '/// unit, as the TypeScript does.',
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
      ints('    ', { heartbeatDays: ALERTS.heartbeatDays }),
    ),
    ...group(
      [
        'Core `SNOW`: the share of forecasts that makes a day "Yes" (`likelyFrom`) and "Maybe"',
        "(`maybeFrom`), and a whole day's thresholds, cm.",
      ],
      'Snow',
      [
        ...doubles('    ', { likelyFrom: SNOW.likelyFrom, maybeFrom: SNOW.maybeFrom }),
        '    /// Centimetres of fresh snow from a millimetre of water (core `SNOW.cmPerMm`).',
        ...doubles('    ', { cmPerMm: SNOW.cmPerMm }),
        '    /// In an hour warmer than this, °C, nothing counts as snow (core `SNOW.warmAboveC`).',
        ...doubles('    ', { warmAboveC: SNOW.warmAboveC }),
        '',
        '    /// Core `SNOW.hour`: from these amounts an hour has snow, flakes, heavy and deep snow, cm.',
        '    public enum Hour {',
        ...doubles('      ', SNOW.hour),
        '    }',
        '',
        '    /// Core `SNOW.day`: from these amounts a whole day has snow, flakes, heavy and deep',
        '    /// snow, cm.',
        '    public enum Day {',
        ...doubles('      ', SNOW.day),
        '    }',
        '',
        "    /// Core `SNOW.normals`: when the climate records' snowfall is used, and how; the",
        "    /// records' cell must be within `maxHeightDifference` metres of the place's height.",
        '    public enum Normals {',
        ...doubles('      ', SNOW.normals),
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
    ...group(
      [
        "The picker's lists (client `PLACES`): the most recent places kept, and the most saved",
        'places.',
      ],
      'Places',
      ints('    ', PLACES),
    ),
    ...group(
      [
        'The ads in the free version (client `ADS`): a full-screen ad at most once every',
        '`interstitialGapMinutes`, and never one loaded `interstitialMaxAgeMinutes` or more ago; a',
        'failed load is asked for again after `retryFirstSeconds`, the wait doubling with each',
        'failure in a row, at most `retryMaxSeconds`.',
      ],
      'Ads',
      ints('    ', ADS),
    ),
    ...group(
      [
        "willitsnow.today (core `SITES.snow`): its name, which the top bar shows as the website's",
        'header does, the pages Settings opens in Safari, and the address people write to (core',
        '`CONTACT_EMAIL`), for Contact us and Report an ad.',
      ],
      'Site',
      [
        ...swiftLet('    ', 'public static let name', swiftString(SITES.snow.name)),
        ...Object.entries(SITE_PAGES).flatMap(([name, path]) =>
          swiftLet(
            '    ',
            `public static let ${swiftIdentifier(name)}`,
            swiftString(sitePage(path)),
          ),
        ),
        ...swiftLet(
          '    ',
          'public static let contactEmail',
          swiftString(contactEmail(CONTACT_EMAIL)),
        ),
      ],
    ),
    '}',
    '',
  ].join('\n');
}
