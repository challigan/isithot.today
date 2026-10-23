/**
 * `AppCredits.swift` (iOS build spec, sections 7.1 and 10.6): the credits the app's "Credits and
 * licences" screen lists beyond core's (`credits.ts`), as plain data. Every link is https, and
 * every notice names a file the app bundles, or the generator stops.
 */
import { CREDIT_LINKS } from '@isithot/core';
import {
  DATA_CREDITS,
  NOTICES,
  modelAgencies,
  type CreditLink,
  type DataCredit,
  type Notice,
} from './credits';
import { generatedHeader, swiftLet, swiftString } from './swift';

export const CREDITS_PATH =
  'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated/AppCredits.swift';

export const CREDITS_SOURCE = 'packages/mobile/src/credits.ts';

/** `url`, or it throws when it isn't an https link. */
function https(url: string): string {
  if (new URL(url).protocol !== 'https:') throw new Error(`Not an https link: ${url}`);
  return url;
}

/**
 * A call with labelled arguments, on one line when it fits in 100 columns; otherwise each
 * argument on a line of its own, and a string too long for its line on the next line under its
 * label, as swift-format lays them out. `args` are `[label, value]` pairs.
 */
export function swiftLabelledCall(
  indent: string,
  head: string,
  args: readonly (readonly [string, string])[],
  tail = '',
): string[] {
  const line = `${indent}${head}(${args.map(([l, v]) => `${l}: ${v}`).join(', ')})${tail}`;
  if (line.length <= 100) return [line];
  const inner = `${indent}  `;
  return [
    `${indent}${head}(`,
    ...args.flatMap(([label, value], i) => {
      const comma = i < args.length - 1 ? ',' : '';
      const whole = `${inner}${label}: ${value}${comma}`;
      return whole.length <= 100 || !value.startsWith('"')
        ? [whole]
        : [`${inner}${label}:`, `${inner}  ${value}${comma}`];
    }),
    `${indent})${tail}`,
  ];
}

const link = (l: CreditLink): string =>
  `Link(phrase: ${swiftString(l.phrase)}, url: ${swiftString(https(l.url))})`;

const dataCredit = (c: DataCredit): string[] =>
  swiftLabelledCall(
    '    ',
    'DataCredit',
    [
      ['text', swiftString(c.text)],
      ['links', `[${c.links.map(link).join(', ')}]`],
    ],
    ',',
  );

const notice = (n: Notice): string[] =>
  swiftLabelledCall(
    '    ',
    'Notice',
    [
      ['name', swiftString(n.name)],
      ['summary', swiftString(n.summary)],
      ['url', swiftString(https(n.url))],
      ['file', swiftString(n.file)],
    ],
    ',',
  );

export function creditsSwift(): string {
  // The credits' links beyond core's must not repeat core's: Credits.parts takes both.
  for (const c of DATA_CREDITS) {
    for (const l of c.links) {
      if (CREDIT_LINKS.some((core) => core.phrase === l.phrase)) {
        throw new Error(`${l.phrase} is linked by core's CREDIT_LINKS already`);
      }
    }
  }
  return [
    generatedHeader(CREDITS_SOURCE),
    '',
    '/// What the app\'s "Credits and licences" lists beyond core\'s credits (`CoreCopy`): who runs the',
    "/// forecast models, the climate records' and the place names' credits, and the typeface and",
    '/// software in the app, each with the notice it bundles.',
    'public enum AppCredits {',
    '  /// A phrase of a credit that links out, and where to.',
    '  public struct Link: Sendable, Equatable {',
    '    public let phrase: String',
    '    public let url: String',
    '  }',
    '',
    "  /// A credit for the data, with the links it needs beyond core's (`CoreCopy.creditLinks`).",
    '  public struct DataCredit: Sendable, Equatable {',
    '    public let text: String',
    '    public let links: [Link]',
    '  }',
    '',
    '  /// A typeface or software in the app: what it does, its copyright and licence, its',
    "  /// project's page, and its notice in full, the app's resource `file`.txt.",
    '  public struct Notice: Sendable, Equatable {',
    '    public let name: String',
    '    public let summary: String',
    '    public let url: String',
    '    public let file: String',
    '  }',
    '',
    '  /// Who runs the forecast models (core `MODELS` and `MODEL_AGENCIES`), as the About page',
    '  /// lists them.',
    ...swiftLet('  ', 'public static let modelAgencies', swiftString(modelAgencies())),
    '',
    "  /// The climate records' and the place names' credits.",
    '  public static let data: [DataCredit] = [',
    ...DATA_CREDITS.flatMap(dataCredit),
    '  ]',
    '',
    '  /// The typeface and the software, in the order the screen lists them.',
    '  public static let notices: [Notice] = [',
    ...NOTICES.flatMap(notice),
    '  ]',
    '}',
    '',
  ].join('\n');
}
